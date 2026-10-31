"""Durable local people tasks. Imports only record intent; all inference is deferred."""
import hashlib
import io
import json
import os
from pathlib import Path
import threading
import time
import uuid

from flask import current_app
from loguru import logger

from ..db import get_db, get_setting
from . import people
from .background_work import inference_slot

_workers={}
_workers_lock=threading.Lock()
_timers={}
_STATES=('queued','running','done','waiting','failed','paused','cancelled','quality_insufficient','no_faces','stale')


def init_schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS people_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        input_revision TEXT NOT NULL, config_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until REAL,
        model_key TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
        face_count INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(media_id,input_revision,config_key))''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_people_jobs_state ON people_jobs(state,priority,id)')


def settings(db):
    return {'enabled':get_setting(db,'people_enabled','false')=='true',
            'model_dir':get_setting(db,'people_model_dir',''),
            'profile':get_setting(db,'people_profile','buffalo_l'),
            'max_frames':int(get_setting(db,'people_max_frames','24'))}


def configure(db,data):
    if not isinstance(data,dict) or set(data)-{'enabled','model_dir','profile','max_frames'}:
        raise people.Conflict('人物设置字段无效')
    values=settings(db);values.update(data)
    if type(values['enabled']) is not bool:raise people.Conflict('自动整理设置需为开关')
    if values['profile'] not in ('buffalo_l','raccoon_s'):raise people.Conflict('人脸模型组合无效')
    if type(values['max_frames']) is not int or not 1<=values['max_frames']<=48:
        raise people.Conflict('视频每个素材最多采样 1～48 帧')
    directory=values['model_dir']
    if not isinstance(directory,str) or len(directory)>4096 or directory and not Path(directory).expanduser().is_absolute():
        raise people.Conflict('请选择模型文件夹的绝对路径')
    values['model_dir']=str(Path(directory).expanduser().resolve()) if directory else ''
    for k,v in values.items():
        value=('true' if v else 'false') if type(v) is bool else str(v)
        db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)',('people_'+k,value))
    return values


def _config_key(db):
    s=settings(db)
    return hashlib.sha256(json.dumps([s['model_dir'],s['profile'],s['max_frames'],'people-v2-adaptive']).encode()).hexdigest()


def input_revision(db,media_id):
    row=db.execute('SELECT file_path,file_size,file_mtime,thumbnail_path,media_type,duration,fps FROM media WHERE id=?',(media_id,)).fetchone()
    return hashlib.sha256(json.dumps(list(row),ensure_ascii=False).encode()).hexdigest() if row else None


def enqueue(db,media_id,priority=0,force=False):
    row=db.execute('SELECT media_type FROM media WHERE id=?',(media_id,)).fetchone()
    if not row or row[0] not in ('image','video'):return None
    revision=input_revision(db,media_id);key=_config_key(db)
    db.execute('INSERT OR IGNORE INTO people_jobs(media_id,input_revision,config_key,priority) VALUES (?,?,?,?)',
               (media_id,revision,key,priority))
    job=db.execute('SELECT * FROM people_jobs WHERE media_id=? AND input_revision=? AND config_key=?',(media_id,revision,key)).fetchone()
    if force and job['state']!='running':
        db.execute("UPDATE people_jobs SET state='queued',priority=?,attempts=0,lease=NULL,lease_until=NULL,error='',updated_at=datetime('now') WHERE id=?",(priority,job['id']))
    return job['id']


def enqueue_scope(db,data):
    scope=data.get('scope')
    params=[]
    where="media_type IN ('image','video')"
    if scope=='selected':
        ids=people._ids(data.get('media_ids',[]));people._media(db,ids)
        where+=' AND id IN ('+','.join('?' for _ in ids)+')';params=ids
    elif scope=='folder':
        folder=data.get('folder')
        if not isinstance(folder,str) or not folder.strip() or not Path(folder).is_absolute():
            raise people.Conflict('请选择资料库中的文件夹')
        from ..blueprints.library import _folder_pattern
        where+=" AND file_path LIKE ? ESCAPE '\\'";params=[_folder_pattern(folder)]
    elif scope=='all':
        if data.get('confirm_all') is not True:raise people.Conflict('请明确确认整理全部历史照片和视频')
    else:raise people.Conflict('人物整理范围无效')
    rows=db.execute('SELECT id FROM media WHERE '+where+' ORDER BY id',params).fetchall()
    for r in rows:enqueue(db,r[0],priority=100,force=True)
    db.execute("INSERT OR REPLACE INTO settings VALUES ('people_paused','false')")
    return {'queued':len(rows)}


def claim(db):
    if get_setting(db,'people_paused','false')=='true':return None
    now=time.time()
    with db:
        db.execute("UPDATE people_jobs SET state='queued',lease=NULL,lease_until=NULL,error='中断后继续',updated_at=datetime('now') WHERE state='running' AND lease_until<?",(now,))
        row=db.execute("SELECT * FROM people_jobs WHERE state='queued' ORDER BY priority DESC,id LIMIT 1").fetchone()
        if not row:return None
        lease=uuid.uuid4().hex
        changed=db.execute("UPDATE people_jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1,updated_at=datetime('now') WHERE id=? AND state='queued'",(lease,now+300,row['id'])).rowcount
        if not changed:return None
        return dict(db.execute('SELECT * FROM people_jobs WHERE id=?',(row['id'],)).fetchone())


def control(db,action):
    if action not in ('pause','resume','retry','cancel'):raise people.Conflict('任务操作无效')
    pause=action in ('pause','cancel')
    db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('people_paused','true' if pause else 'false'))
    if pause:
        states="'queued','running'" if action=='pause' else "'queued','running','paused','waiting','failed'"
        db.execute("UPDATE people_jobs SET state=?,lease=NULL,lease_until=NULL,updated_at=datetime('now') WHERE state IN ("+states+')',('paused' if action=='pause' else 'cancelled',))
    else:
        states="'paused'" if action=='resume' else "'paused','waiting','failed','stale'"
        rows=db.execute('SELECT * FROM people_jobs WHERE state IN ('+states+')').fetchall()
        for row in rows:
            revision=input_revision(db,row['media_id'])
            if revision!=row['input_revision'] or row['config_key']!=_config_key(db):
                enqueue(db,row['media_id'],row['priority'],force=True)
                db.execute("UPDATE people_jobs SET state='stale',lease=NULL,updated_at=datetime('now') WHERE id=?",(row['id'],))
            else:
                db.execute("UPDATE people_jobs SET state='queued',attempts=0,lease=NULL,lease_until=NULL,error='',updated_at=datetime('now') WHERE id=?",(row['id'],))
    return {'ok':True}


def _stamp(row):
    try:
        stat=Path(row['file_path']).stat()
        return (stat.st_size,stat.st_mtime_ns)
    except OSError:return None


def _discard_crops(db,paths):
    root=Path(current_app.config.get('PEOPLE_CACHE_DIR',Path(current_app.config['DATABASE']).parent/'people-cache')).resolve()
    for item in paths:
        path=Path(item)
        if not path.resolve().is_relative_to(root):continue
        if db.execute('SELECT 1 FROM people_faces WHERE crop_path IN (?,?) LIMIT 1',(path.name,str(path))).fetchone():continue
        if db.execute('SELECT 1 FROM people_changes WHERE before_state LIKE ? OR after_state LIKE ? LIMIT 1',
                      ('%'+path.name+'%','%'+path.name+'%')).fetchone():continue
        path.unlink(missing_ok=True)


def infer(db,job):
    from . import face_engine
    cfg=settings(db);cache=Path(current_app.config.get('PEOPLE_CACHE_DIR',Path(current_app.config['DATABASE']).parent/'people-cache'))
    model=face_engine.load_engine(cfg['model_dir'],cfg['profile'])
    row=dict(db.execute('SELECT * FROM media WHERE id=?',(job['media_id'],)).fetchone())
    frames,scope=face_engine.read_frames(row,cache,job['_cancelled'],cfg['max_frames'],job['input_revision'])
    observations=[];new_crops=[];feature_cache={}
    try:
        for timestamp,image in frames:
            if job['_cancelled']():raise InterruptedError('人物整理已暂停')
            faces=model.observe(image,timestamp,job['_cancelled'],feature_cache)
            # Deterministic frame/location keys keep human decisions attached on rescan.
            faces.sort(key=lambda f:(f['bbox'][0],f['bbox'][1]))
            for face in faces:
                face['sample_key']=str(timestamp)+':'+':'.join(str(round(v,4)) for v in face['bbox'])
                crop=face.pop('crop')
                cache.mkdir(mode=0o700,parents=True,exist_ok=True)
                encoded=io.BytesIO();crop.save(encoded,format='JPEG',quality=90);content=encoded.getvalue()
                name=hashlib.sha256(content).hexdigest()+'.jpg';path=cache/name
                if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=path.stem:
                    temporary=cache/(uuid.uuid4().hex+'.tmp')
                    try:
                        temporary.write_bytes(content);temporary.replace(path)
                    finally:temporary.unlink(missing_ok=True)
                    new_crops.append(path)
                face['crop_path']=name
                observations.append(face)
        return {'model_key':model.info['key'],'observations':observations,'scope':scope,'new_crops':new_crops}
    except Exception:
        _discard_crops(db,new_crops)
        raise


def process(db,job,infer_fn=None):
    heartbeat=[time.time()]
    def cancelled():
        row=db.execute('SELECT state,lease FROM people_jobs WHERE id=?',(job['id'],)).fetchone()
        if not row or row['state']!='running' or row['lease']!=job['lease']:return True
        state=None
        if time.monotonic()>=job.get('_deadline',float('inf')):state='paused'
        elif job.get('_background'):
            from .classification_jobs import busy
            if busy(current_app.config['DATABASE']):state='queued'
        if state:
            db.execute("UPDATE people_jobs SET state=?,lease=NULL,error=?,updated_at=datetime('now') WHERE id=? AND lease=?",
                       (state,'前台操作优先，稍后继续' if state=='queued' else '达到本轮时间预算，可继续',job['id'],job['lease']))
            db.commit()
            return True
        if time.time()-heartbeat[0]>30 and not db.in_transaction:
            with db:db.execute('UPDATE people_jobs SET lease_until=? WHERE id=? AND lease=?',(time.time()+300,job['id'],job['lease']))
            heartbeat[0]=time.time()
        return False
    if cancelled():return False
    row=db.execute('SELECT * FROM media WHERE id=?',(job['media_id'],)).fetchone()
    if not row:return False
    before_stamp=_stamp(row)
    if before_stamp is not None and ((row['file_size'] is not None and before_stamp[0]!=row['file_size']) or
            (row['file_mtime'] is not None and abs(before_stamp[1]/1e9-row['file_mtime'])>.001)):
        with db:db.execute("UPDATE people_jobs SET state='stale',lease=NULL,error='原文件已变化，请重新导入后整理',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
        return False
    payload=(infer_fn or infer)(db,{**job,'_cancelled':cancelled})
    retained=False
    try:
        with db:
            db.execute('UPDATE people_jobs SET id=id WHERE id=?',(job['id'],))
            if cancelled():return False
            if input_revision(db,job['media_id'])!=job['input_revision'] or _config_key(db)!=job['config_key'] or _stamp(row)!=before_stamp:
                db.execute("UPDATE people_jobs SET state='stale',lease=NULL,error='素材或模型设置已变化，请重试',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
                return False
            result=people.record_observations(db,job['media_id'],job['input_revision'],payload['model_key'],payload['observations'])
            state='done'
            if not payload['observations']:state='quality_insufficient' if payload['scope']=='image_preview_lowres' else 'no_faces'
            elif not any(f.get('feature') is not None and f.get('quality',0)>=.35 for f in payload['observations']):state='quality_insufficient'
            db.execute("UPDATE people_jobs SET state=?,model_key=?,scope=?,face_count=?,lease=NULL,lease_until=NULL,error='',updated_at=datetime('now') WHERE id=? AND lease=?",
                       (state,payload['model_key'],payload['scope'],len(result['faces']),job['id'],job['lease']))
            retained=True
        return True
    finally:
        if not retained:
            _discard_crops(db,payload.get('new_crops',[]))


def status(db):
    from .face_engine import PROFILES
    cfg=settings(db)
    available=bool(cfg['model_dir']) and cfg['profile'] in PROFILES and all((Path(cfg['model_dir'])/n).is_file() for n in PROFILES[cfg['profile']])
    jobs={state:0 for state in _STATES}
    jobs.update(dict(db.execute('SELECT state,COUNT(*) FROM people_jobs GROUP BY state')))
    counts={'all':db.execute('SELECT COUNT(*) FROM people_persons WHERE redirect_id IS NULL AND hidden=0').fetchone()[0],
            'hidden':db.execute('SELECT COUNT(*) FROM people_persons WHERE redirect_id IS NULL AND hidden=1').fetchone()[0]}
    unnamed=db.execute("SELECT COUNT(*) FROM people_persons WHERE redirect_id IS NULL AND hidden=0 AND name=''").fetchone()[0]
    reviews=db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending'").fetchone()[0]
    revision=hashlib.sha256(json.dumps([list(db.execute('SELECT COUNT(*),SUM(version) FROM people_persons').fetchone()),
        list(db.execute('SELECT COUNT(*),SUM(version) FROM people_faces').fetchone()),
        db.execute('SELECT COALESCE(MAX(id),0) FROM people_changes').fetchone()[0],jobs,reviews]).encode()).hexdigest()
    recent=[dict(r) for r in db.execute("SELECT j.id,j.media_id,j.state,j.error,j.scope,j.face_count,m.file_name FROM people_jobs j JOIN media m ON m.id=j.media_id ORDER BY j.updated_at DESC,j.id DESC LIMIT 12")]
    return {'counts':counts,'unnamed_count':unnamed,'review_count':reviews,'revision':revision,'settings':cfg,
            'model':{'ready':available,'profile':cfg['profile'],'error':'' if available else '请选择完整的人脸模型目录'},
            'jobs':jobs,'recent':recent,'paused':get_setting(db,'people_paused','false')=='true'}


def ensure_worker(app):
    if app.config.get('TESTING') or app.config.get('PEOPLE_WORKER_DISABLED') or os.environ.get('MEDIA_MANAGER_SKIP_PEOPLE'):return
    key=app.config['DATABASE']
    with _workers_lock:
        if key in _workers and _workers[key].is_alive():return
        thread=threading.Thread(target=_run,args=(app,key),daemon=True,name='people-background')
        _workers[key]=thread;thread.start()


def _run(app,key):
    from .classification_jobs import busy
    started=time.monotonic();deadline=started+600
    with app.app_context():
        db=get_db()
        try:
            while time.monotonic()<deadline:
                if get_setting(db,'people_paused','false')=='true':break
                if busy(key):
                    if not db.execute("SELECT 1 FROM people_jobs WHERE state='queued' LIMIT 1").fetchone():break
                    threading.Event().wait(.25);continue
                job=claim(db)
                if not job:break
                job['_deadline']=deadline;job['_background']=True
                try:
                    def waiting_cancelled():
                        row=db.execute('SELECT state,lease FROM people_jobs WHERE id=?',(job['id'],)).fetchone()
                        return time.monotonic()>=deadline or not row or row['state']!='running' or row['lease']!=job['lease']
                    with inference_slot(waiting_cancelled):
                        if busy(key):
                            with db:db.execute("UPDATE people_jobs SET state='queued',lease=NULL,updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
                            continue
                        process(db,job)
                except (FileNotFoundError,ValueError) as exc:
                    db.rollback()
                    message='等待模型或素材：'+str(exc)[:160]
                    with db:db.execute("UPDATE people_jobs SET state='waiting',lease=NULL,error=?,updated_at=datetime('now') WHERE id=? AND lease=?",(message,job['id'],job['lease']))
                except InterruptedError:
                    db.rollback()
                    with db:db.execute("UPDATE people_jobs SET state='paused',lease=NULL,error='达到本轮时间预算，可继续',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
                except Exception as exc:
                    db.rollback();logger.warning('人物整理失败 job={} type={}',job['id'],type(exc).__name__)
                    with db:db.execute("UPDATE people_jobs SET state='failed',lease=NULL,error='本地人物整理失败，可重试',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
        finally:
            if time.monotonic()>=deadline:
                with db:db.execute("UPDATE people_jobs SET state='paused',error='达到本轮时间预算，可继续',updated_at=datetime('now') WHERE state='queued'")
            with _workers_lock:_workers.pop(key,None)
            pending=db.execute("SELECT 1 FROM people_jobs WHERE state='queued' LIMIT 1").fetchone()
            if pending and time.monotonic()<deadline and get_setting(db,'people_paused','false')!='true':
                ensure_worker(app)
            expiry=db.execute("SELECT MIN(lease_until) FROM people_jobs WHERE state='running'").fetchone()[0]
            if expiry and get_setting(db,'people_paused','false')!='true':
                timer=threading.Timer(max(.1,expiry-time.time()+.1),lambda:ensure_worker(app));timer.daemon=True
                with _workers_lock:_timers[key]=timer
                timer.start()
