"""Durable, cancellable local classification that yields to foreground work."""
import functools
import hashlib
import json
from pathlib import Path
import re
import threading
import time
import uuid

from flask import current_app
from loguru import logger
from ..db import get_db, get_setting
from . import taxonomy as tx
from . import taxonomy_review as review

_workers = {}
_workers_lock = threading.Lock()
_activity = {}
_basis_cache = {}
_recovery_timers = {}


def foreground_work(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        with _workers_lock:
            _activity['import'] = _activity.get('import', 0) + 1
        try:
            return fn(*args, **kwargs)
        finally:
            with _workers_lock:
                _activity['import'] -= 1
    return wrapped


def set_playback(library, client, active):
    with _workers_lock:
        key=(library, client)
        if active: _activity[key]=time.monotonic()+15
        else: _activity.pop(key, None)


def busy(library):
    from ..blueprints.analysis import _active_progress
    now=time.monotonic()
    with _workers_lock:
        return bool(_activity.get('import') or _active_progress or any(
            isinstance(k,tuple) and k[0]==library and deadline>now for k,deadline in _activity.items()))


def matching_basis(db, stage, media_id=None):
    if stage == 'analysis':
        terms=map_analysis(db,{'media_id':media_id})['candidates'] if media_id is not None else []
        return {'policy':'structured-mapping-v4','terms':[(v['term'],[
            (n['id'],n['status'],tx.recognition_description(db,n)) for n in tx.resolve(db,v['term'])]) for v in terms]}
    model = get_setting(db,'classification_omni_model','qwen3-omni-30b-a3b')
    if stage == 'omni':
        return {'policy':'local-observation-v2','model':model}
    from .classification_models import configured_directory
    directory=configured_directory(db)
    manifest=Path(directory)/'classification.json'
    try:
        config=json.loads(manifest.read_text())
        model=config.get('fingerprint','invalid')
    except (OSError,ValueError):
        model='missing:'+hashlib.sha256(directory.encode()).hexdigest()
    revision=get_setting(db,'classification_semantic_revision','0')
    cache_key=(current_app.config['DATABASE'], model, revision)
    if cache_key not in _basis_cache:
        descriptions=[(r['id'],review.digest(tx.recognition_description(db,dict(r)))) for r in
                      db.execute("SELECT * FROM taxonomy_nodes WHERE status='active' ORDER BY id")]
        _basis_cache.clear()
        _basis_cache[cache_key]={'model':model,'descriptions':review.digest(descriptions),'policy':'paired-text-v2'}
    return _basis_cache[cache_key]


def enqueue(db, media_id, stage='fast', priority=0, batch_id=None):
    from .model_preferences import classification_enabled
    if not classification_enabled(db,stage):return None
    media=db.execute('SELECT media_type FROM media WHERE id=?',(media_id,)).fetchone()
    if not media or media[0] not in ('image','video'): return None
    revision=tx.input_revision(db,media_id,stage)
    if stage=='analysis' and not db.execute('SELECT 1 FROM media_segment WHERE media_id=?',(media_id,)).fetchone():
        return None
    basis=matching_basis(db,stage,media_id) if priority>0 or stage=='analysis' else {'deferred':True,'stage':stage}
    key='deferred' if basis.get('deferred') else review.digest(basis)
    db.execute('INSERT OR IGNORE INTO taxonomy_jobs(media_id,stage,input_revision,priority) VALUES (?,?,?,?)',
               (media_id,stage,revision,priority))
    job=db.execute('SELECT * FROM taxonomy_jobs WHERE media_id=? AND stage=? AND input_revision=?',
                   (media_id,stage,revision)).fetchone()
    old=db.execute('SELECT * FROM taxonomy_job_context WHERE job_id=?',(job['id'],)).fetchone()
    # Import hooks must not replace a prepared basis or restart finished work.
    if old and key=='deferred': return job['id']
    if priority>job['priority']:
        db.execute('UPDATE taxonomy_jobs SET priority=? WHERE id=?',(priority,job['id']))
    if old and old['matching_key']!=key:
        db.execute("UPDATE taxonomy_jobs SET state='queued',lease=NULL,attempts=0,error='' WHERE id=?",(job['id'],))
    elif priority>0 and job['state'] in ('failed','waiting','paused','stale'):
        db.execute("UPDATE taxonomy_jobs SET state='queued',lease=NULL,attempts=0,error='' WHERE id=?",(job['id'],))
    db.execute('INSERT INTO taxonomy_job_context(job_id,batch_id,matching_key,basis) VALUES (?,?,?,?) '
               'ON CONFLICT(job_id) DO UPDATE SET matching_key=excluded.matching_key,basis=excluded.basis',
               (job['id'],batch_id or (old['batch_id'] if old else uuid.uuid4().hex),key,tx._json(basis)))
    return job['id']


def map_analysis(db,job):
    evidence={};snapshot=[]
    for row in db.execute('SELECT id,main_subjects,scene_type,lighting,weather,time_start,time_end FROM media_segment WHERE media_id=? ORDER BY seq,id',(job['media_id'],)):
        snapshot.append(dict(row))
        try: subjects=json.loads(row['main_subjects'] or '[]')
        except ValueError: subjects=[]
        if not isinstance(subjects,list): subjects=[]
        for field,values in [('main_subjects',subjects),*[(k,[row[k]]) for k in ('scene_type','lighting','weather')]]:
            origin=db.execute('SELECT origin,value_hash FROM taxonomy_field_provenance WHERE segment_id=? AND field=?',(row['id'],field)).fetchone()
            provenance=origin['origin'] if origin and origin['value_hash']==review.digest(row[field]) else 'unknown'
            for term in values:
                if not isinstance(term,str) or not term.strip() or term.strip() in ('无','未知','None'): continue
                evidence.setdefault(term.strip(),[]).append({'segment_id':row['id'],'field':field,'start':row['time_start'],
                    'end':row['time_end'],'original_provenance':provenance})
    return {'candidates':[{'term':term,'evidence':{'origin':'analysis_mapping','segments':details}} for term,details in evidence.items()],
            'historical_snapshot':snapshot}


def process(db,job,infer=None):
    def cancelled():
        from .model_preferences import classification_enabled, sync_classification_jobs
        if not classification_enabled(db,job['stage']):
            with db:sync_classification_jobs(db)
            return True
        r=db.execute('SELECT state,lease FROM taxonomy_jobs WHERE id=?',(job['id'],)).fetchone()
        if r and r['state']=='running' and r['lease']==job['lease'] and job['stage']!='analysis' and busy(current_app.config['DATABASE']):
            with db:
                db.execute("UPDATE taxonomy_jobs SET state='queued',lease=NULL,lease_until=NULL,attempts=MAX(0,attempts-1),error='等待前台任务结束' WHERE id=? AND state='running' AND lease=?",(job['id'],job['lease']))
            return True
        if r and r['state']=='running' and r['lease']==job['lease'] and time.monotonic()>=job.get('_deadline',float('inf')):
            with db:db.execute("UPDATE taxonomy_jobs SET state='paused',lease=NULL,error='已达到本轮时间预算' WHERE id=? AND lease=?",(job['id'],job['lease']))
            return True
        return (not r or r['state']!='running' or r['lease']!=job['lease'] or
                time.monotonic()>=job.get('_deadline',float('inf')))
    if cancelled(): return False
    context=db.execute('SELECT * FROM taxonomy_job_context WHERE job_id=?',(job['id'],)).fetchone()
    if context and context['matching_key']=='deferred':
        basis=matching_basis(db,job['stage'],job['media_id'])
        with db:db.execute('UPDATE taxonomy_job_context SET matching_key=?,basis=? WHERE job_id=?',(review.digest(basis),tx._json(basis),job['id']))
        context=db.execute('SELECT * FROM taxonomy_job_context WHERE job_id=?',(job['id'],)).fetchone()
    expected=context['matching_key'] if context else review.digest(matching_basis(db,job['stage'],job['media_id']))
    if job['stage']=='analysis': values=map_analysis(db,job)
    else:
        if infer is None:
            from .semantic_classifier import classify
            infer=classify
        from .background_work import inference_slot
        with inference_slot(cancelled):
            values=infer(db,{**job,'_cancelled':cancelled})
    payload=values if isinstance(values,dict) else {'candidates':values}
    with db:
        db.execute('UPDATE taxonomy_jobs SET id=id WHERE id=?',(job['id'],))
        if cancelled(): return False
        if tx.input_revision(db,job['media_id'],job['stage'])!=job['input_revision']:
            db.execute("UPDATE taxonomy_jobs SET state='stale',lease=NULL WHERE id=?",(job['id'],));return False
        feature=payload.get('image_feature')
        if feature:
            model,revision,vector,dimension=feature
            db.execute('INSERT INTO taxonomy_features(media_id,model_key,input_revision,vector,dimension) VALUES (?,?,?,?,?) '
                       "ON CONFLICT(media_id,model_key) DO UPDATE SET input_revision=excluded.input_revision,vector=excluded.vector,dimension=excluded.dimension,updated_at=datetime('now')",
                       (job['media_id'],model,revision,vector,dimension))
            for tag_id,text_revision,text_vector,dimension in payload.get('text_features',[]):
                db.execute('INSERT INTO taxonomy_text_features(tag_id,model_key,text_revision,vector,dimension) VALUES (?,?,?,?,?) '
                           'ON CONFLICT(tag_id,model_key) DO UPDATE SET text_revision=excluded.text_revision,vector=excluded.vector,dimension=excluded.dimension',
                           (tag_id,model,text_revision,text_vector,dimension))
        if expected!=review.digest(matching_basis(db,job['stage'],job['media_id'])):
            enqueue(db,job['media_id'],job['stage'],max(1,job['priority']));return False
        batch_id=context['batch_id'] if context else 'legacy'
        for value in payload['candidates']:
            term=str(value['term']).strip()
            if not term or len(term)>120 or re.search(r'\d{7,}|身份证号|护照号码|手机号|性取向|宗教信仰|种族推断',term): continue
            matches=tx.resolve(db,term)
            tag_id=matches[0]['id'] if len(matches)==1 else None
            evidence=value.get('evidence',{})
            if job['stage']=='fast' and evidence.get('tag_id'):
                node=tx.get_node(db,evidence['tag_id'])
                if review.digest(tx.recognition_description(db,node))!=evidence.get('description_revision',review.digest(tx.recognition_description(db,node))): continue
                tag_id=node['id']
            if tag_id and (tx._blocked(db,job['media_id'],tag_id) or db.execute('SELECT 1 FROM media_tags WHERE media_id=? AND tag_id=?',(job['media_id'],tag_id)).fetchone()): continue
            meaning=review.digest([tag_id,tx.normalize(term),evidence.get('parent'),evidence.get('definition')])
            key=review.digest([job['stage'],job['media_id'],job['input_revision'],expected,meaning])
            db.execute('INSERT OR IGNORE INTO taxonomy_candidates(media_id,tag_id,term,kind,evidence,source_key,input_revision) VALUES (?,?,?,?,?,?,?)',
                (job['media_id'],tag_id,term,job['stage'],tx._json(evidence),key,job['input_revision']))
            cid=db.execute('SELECT id FROM taxonomy_candidates WHERE source_key=?',(key,)).fetchone()[0]
            review.track_candidate(db,cid,batch_id)
            from .taxonomy_relations import try_auto_association
            try_auto_association(db,cid)
        if 'historical_snapshot' in payload:
            db.execute('INSERT OR IGNORE INTO taxonomy_historical_snapshots(media_id,job_id,source_revision,fields) VALUES (?,?,?,?)',
                       (job['media_id'],job['id'],job['input_revision'],tx._json(payload['historical_snapshot'])))
        tx.touch_events(db)
        db.execute("UPDATE taxonomy_jobs SET state='done',lease=NULL,error='',updated_at=datetime('now') WHERE id=?",(job['id'],))
        if job['stage']=='fast' and get_setting(db,'classification_omni_enabled','false')=='true':
            enqueue(db,job['media_id'],'omni',batch_id=batch_id)
    return True


def claim(db,oldest=False,allow_heavy=True):
    now=time.time()
    with db:
        db.execute("UPDATE taxonomy_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,lease=NULL WHERE state='running' AND COALESCE(lease_until,0)<?",(now,))
        from .model_preferences import sync_classification_jobs
        sync_classification_jobs(db)
        condition="state='queued' AND attempts<3" + ('' if allow_heavy else " AND stage='analysis'")
        row=db.execute('SELECT * FROM taxonomy_jobs WHERE '+condition+' ORDER BY '+('id' if oldest else 'priority DESC,id')+' LIMIT 1').fetchone()
        if not row: return None
        token=uuid.uuid4().hex
        result=db.execute("UPDATE taxonomy_jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state='queued'",(token,now+600,row['id']))
        if result.rowcount!=1: return None
        return dict(db.execute('SELECT * FROM taxonomy_jobs WHERE id=?',(row['id'],)).fetchone())


def ensure_worker(app):
    key=app.config['DATABASE']
    with _workers_lock:
        if key in _workers and _workers[key].is_alive(): return
        worker=threading.Thread(target=_run,args=(app,key),daemon=True,name='classification')
        _workers[key]=worker;worker.start()


def _resume_expired_leases(app,key,db):
    next_time=db.execute("SELECT MIN(expires) FROM (SELECT lease_until expires FROM taxonomy_jobs WHERE state='running' "
        "UNION ALL SELECT CAST(strftime('%s',updated_at) AS REAL)+600 expires FROM taxonomy_relation_jobs WHERE state='running')").fetchone()[0]
    if next_time is None:return
    def resume():
        with _workers_lock:_recovery_timers.pop(key,None)
        ensure_worker(app)
    with _workers_lock:
        existing=_recovery_timers.get(key)
        if existing and existing.is_alive():return
        timer=threading.Timer(max(.1,next_time-time.time()+.1),resume)
        timer.daemon=True;_recovery_timers[key]=timer;timer.start()


def _run(app,key):
    completed=0
    with app.app_context():
        db=get_db()
        try:
            # Recover only identifiable legacy resource cutoffs; explicit pauses stay paused.
            with db:
                db.execute("UPDATE taxonomy_jobs SET state='queued',lease=NULL,attempts=0,error='' WHERE state='paused' AND error IN ('已达到本轮时间预算','达到本轮额外内存预算')")
                db.execute("UPDATE taxonomy_relation_jobs SET state='queued',lease=NULL,error='' WHERE state='paused' AND error='已达到本轮时间预算'")
            while True:
                job=claim(db,oldest=completed%10==9,allow_heavy=not busy(key))
                if not job:
                    from .taxonomy_relations import process_next
                    if not busy(key) and process_next(db):
                        completed+=1;continue
                    if busy(key) and (db.execute("SELECT 1 FROM taxonomy_jobs WHERE state='queued' LIMIT 1").fetchone() or
                                      db.execute("SELECT 1 FROM taxonomy_relation_jobs WHERE state='queued' LIMIT 1").fetchone()):
                        threading.Event().wait(.25);continue
                    break
                try: process(db,job)
                except FileNotFoundError as exc:
                    db.rollback()
                    with db: db.execute("UPDATE taxonomy_jobs SET state='waiting',lease=NULL,error=? WHERE id=? AND lease=?",(str(exc),job['id'],job['lease']))
                except InterruptedError:
                    db.rollback()
                    with db: db.execute("UPDATE taxonomy_jobs SET state='paused',lease=NULL,error='任务已暂停' WHERE id=? AND lease=?",(job['id'],job['lease']))
                except Exception as exc:
                    db.rollback()
                    logger.warning('分类任务失败 id={} stage={} type={}',job['id'],job['stage'],type(exc).__name__)
                    with db: db.execute("UPDATE taxonomy_jobs SET state='failed',lease=NULL,error='分类失败，可重试' WHERE id=? AND lease=?",(job['id'],job['lease']))
                completed+=1
        finally:
            with _workers_lock:
                if _workers.get(key) is threading.current_thread(): _workers.pop(key,None)
                pending=db.execute("SELECT 1 FROM taxonomy_jobs WHERE state='queued' AND attempts<3 LIMIT 1").fetchone()
                pending=pending or db.execute("SELECT 1 FROM taxonomy_relation_jobs WHERE state='queued' OR (state='running' AND updated_at<datetime('now','-600 seconds')) LIMIT 1").fetchone()
            if pending: ensure_worker(app)
            elif not pending:_resume_expired_leases(app,key,db)
