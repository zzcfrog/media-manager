"""Durable local people tasks. Imports only record intent; all inference is deferred."""
import hashlib
import io
import json
import os
import pickle
import tempfile
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


class _Observations:
    """Keep long-video inference bounded; the private spill file is auto-removed."""
    def __init__(self):
        self.stream=tempfile.SpooledTemporaryFile(max_size=8<<20,mode='w+b');self.count=0
    def append(self,value):
        pickle.dump(value,self.stream,protocol=5);self.count+=1
    def __len__(self):return self.count
    def __iter__(self):
        self.stream.seek(0)
        for _ in range(self.count):yield pickle.load(self.stream)
    def close(self):self.stream.close()


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
    values = {'enabled':get_setting(db,'people_enabled','false')=='true',
            'model_enabled':get_setting(db,'people_model_enabled','true')!='false',
            'model_dir':get_setting(db,'people_model_dir',''),
            'profile':get_setting(db,'people_profile','buffalo_l'),
            'max_frames':int(get_setting(db,'people_max_frames','24')),
            'video_fps':int(get_setting(db,'people_video_fps','1')),
            'video_resolution':get_setting(db,'people_video_resolution','1080p'),
            'video_identity_samples':int(get_setting(db,'people_video_identity_samples','4')),
            'similarity_threshold':float(get_setting(db,'people_similarity_threshold','.55')),
            'adaptive_threshold':get_setting(db,'people_adaptive_threshold','true')=='true',
            'detector_path':get_setting(db,'people_detector_path',''),
            'recognizer_path':get_setting(db,'people_recognizer_path',''),
            'verifier_path':get_setting(db,'people_verifier_path',''),
            'verify_enabled':get_setting(db,'people_verify_enabled','true' if get_setting(db,'people_profile','buffalo_l').startswith('raccoon_') else 'false')=='true'}
    from .face_model_downloads import stage_path
    for stage in ('detector', 'recognizer', 'verifier'):
        values[stage+'_model'] = get_setting(db, 'people_'+stage+'_model', '')
        if values[stage+'_model']:
            values[stage+'_path'] = stage_path(values[stage+'_model'], stage)
    return values


def configure(db,data):
    if not isinstance(data,dict) or set(data)-set(settings(db)):
        raise people.Conflict('人物设置字段无效')
    previous=settings(db);values=dict(previous);values.update(data)
    if values['profile']=='custom' and previous['profile']!='custom':
        raise people.Conflict('请选择 Buffalo 或 Raccoon 的规格')
    if values['profile']!=previous['profile'] and 'verify_enabled' not in data:
        values['verify_enabled']=str(values['profile']).startswith('raccoon_')
    for stage in ('detector', 'recognizer', 'verifier'):
        if stage+'_path' in data and data[stage+'_path'] != previous[stage+'_path'] and data.get(stage+'_model', previous[stage+'_model']) == previous[stage+'_model']:
            values[stage+'_model']=''
    if type(values['enabled']) is not bool:raise people.Conflict('自动整理设置需为开关')
    if type(values['model_enabled']) is not bool:raise people.Conflict('人脸识别启用状态需为开关')
    from .people_grouping import MIN_THRESHOLD, MAX_THRESHOLD
    if type(values['similarity_threshold']) not in (int,float) or not MIN_THRESHOLD<=values['similarity_threshold']<=MAX_THRESHOLD:
        raise people.Conflict('自动归组阈值应为 0.45～0.85')
    if abs(values['similarity_threshold']*100-round(values['similarity_threshold']*100))>1e-6:
        raise people.Conflict('自动归组阈值请以 0.01 为步长调整')
    if type(values['adaptive_threshold']) is not bool:raise people.Conflict('根据人工纠正校准需为开关')
    from .face_engine import PROFILES
    if values['profile'] not in (*PROFILES,'custom'):raise people.Conflict('人脸模型组合无效')
    if type(values['verify_enabled']) is not bool:raise people.Conflict('人脸复核设置需为开关')
    if type(values['video_fps']) is not int or values['video_fps'] not in (1,2,3):
        raise people.Conflict('视频人脸检测帧率请选择 1、2 或 3 帧/秒')
    if values['video_resolution'] not in ('1080p','original'):
        raise people.Conflict('视频人脸压缩请选择 1080p 或原片')
    if type(values['video_identity_samples']) is not int or not 1<=values['video_identity_samples']<=48:
        raise people.Conflict('每条轨迹的代表人脸上限应为 1～48 张')
    if type(values['max_frames']) is not int or not 1<=values['max_frames']<=48:
        raise people.Conflict('视频每个素材最多采样 1～48 帧')
    for key in ('model_dir','detector_path','recognizer_path','verifier_path'):
        path=values[key]
        if not isinstance(path,str) or len(path)>4096 or path and not Path(path).expanduser().is_absolute():
            raise people.Conflict('请选择模型的绝对路径')
        values[key]=str(Path(path).expanduser().resolve()) if path else ''
    from .face_model_downloads import stage_path
    for stage in ('detector', 'recognizer', 'verifier'):
        reference = values[stage+'_model']
        if not isinstance(reference, str):raise people.Conflict('人脸模型标识无效')
        if reference:
            values[stage+'_path'] = stage_path(reference, stage)
    for k,v in values.items():
        value=('true' if v else 'false') if type(v) is bool else str(v)
        db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)',('people_'+k,value))
    from .model_preferences import sync_people_jobs
    sync_people_jobs(db)
    if values['video_resolution']!=previous['video_resolution']:
        running=db.execute("SELECT j.* FROM people_jobs j JOIN media m ON m.id=j.media_id WHERE j.state='running' AND m.media_type='video'").fetchall()
        for job in running:
            replacement=enqueue(db,job['media_id'],job['priority'],force=True)
            if replacement is not None and replacement!=job['id']:
                db.execute("UPDATE people_jobs SET state='stale',lease=NULL,lease_until=NULL,error='视频人脸设置已更新',updated_at=datetime('now') WHERE id=?",(job['id'],))
    return values


def video_settings(db):
    mode=get_setting(db,'people_video_resolution','1080p')
    if mode not in ('1080p','original'):raise people.Conflict('视频人脸压缩请选择 1080p 或原片')
    cfg={'res':1080 if mode=='1080p' else None,
         'fps':int(get_setting(db,'people_video_fps','1'))}
    if cfg['fps'] not in (1,2,3):raise people.Conflict('视频人脸检测帧率无效，请检查人脸识别设置')
    return cfg


def _model_options(cfg):
    return {k:cfg[k] for k in ('detector_path','recognizer_path','verifier_path','verify_enabled')}


def _config_key(db,media_type='video'):
    s=settings(db)
    if media_type=='image':
        # Retain the historical photo key; this video-only setting must not rescan photos.
        local=get_setting(db,'video_engine','cloud')=='local'
        video={'res':int(get_setting(db,'local_frames_res' if local else 'resolution','480') or 480)}
    else:
        video=video_settings(db);video['identity_samples']=s['video_identity_samples']
    return hashlib.sha256(json.dumps([s['model_dir'],s['profile'],_model_options(s),video,'people-v5-sampled-tracks'],sort_keys=True).encode()).hexdigest()


def input_revision(db,media_id):
    row=db.execute('SELECT file_path,file_size,file_mtime,thumbnail_path,media_type,duration,fps FROM media WHERE id=?',(media_id,)).fetchone()
    return hashlib.sha256(json.dumps(list(row),ensure_ascii=False).encode()).hexdigest() if row else None


def enqueue(db,media_id,priority=0,force=False):
    from .model_preferences import people_enabled
    if not people_enabled(db):return None
    row=db.execute('SELECT media_type FROM media WHERE id=?',(media_id,)).fetchone()
    if not row or row[0] not in ('image','video'):return None
    revision=input_revision(db,media_id);key=_config_key(db,row['media_type'])
    db.execute('INSERT OR IGNORE INTO people_jobs(media_id,input_revision,config_key,priority) VALUES (?,?,?,?)',
               (media_id,revision,key,priority))
    job=db.execute('SELECT * FROM people_jobs WHERE media_id=? AND input_revision=? AND config_key=?',(media_id,revision,key)).fetchone()
    if force and job['state']!='running':
        db.execute("UPDATE people_jobs SET state='queued',priority=?,attempts=0,lease=NULL,lease_until=NULL,error='',updated_at=datetime('now') WHERE id=?",(priority,job['id']))
    return job['id']


_REVIEW_MEDIA_SQL = '''WITH pending_people AS (
    SELECT left_id AS id FROM people_reviews WHERE state='pending' AND kind='merge'
    UNION SELECT right_id FROM people_reviews WHERE state='pending' AND kind='merge'
)
SELECT f.media_id FROM people_reviews r JOIN people_faces f ON f.id=r.face_id
WHERE r.state='pending' AND r.kind='face'
UNION SELECT membership.media_id FROM ('''+people.MEMBERSHIP_SQL+''') membership
JOIN pending_people p ON p.id=membership.person_id'''


def review_scan_summary(db):
    row=db.execute("SELECT COUNT(*) total,COALESCE(SUM(EXISTS(SELECT 1 FROM people_jobs j WHERE j.media_id=m.id AND j.state IN ('queued','running'))),0) active "
                   "FROM media m WHERE m.media_type IN ('image','video') AND m.id IN ("+_REVIEW_MEDIA_SQL+')').fetchone()
    return dict(row)


def enqueue_scope(db,data):
    from .model_preferences import people_enabled, PEOPLE_OFF
    if not people_enabled(db):raise people.Conflict(PEOPLE_OFF)
    scope=data.get('scope')
    existing=data.get('existing','skip')
    if existing not in ('skip','rescan'):raise people.Conflict('请选择跳过或重新扫描已识别素材')
    params=[]
    where="media_type IN ('image','video')"
    if scope=='selected':
        ids=people._ids(data.get('media_ids',[]));people._media(db,ids)
        where+=' AND id IN ('+','.join('?' for _ in ids)+')';params=ids
    elif scope in ('folder','folders'):
        folders=[data.get('folder')] if scope=='folder' else data.get('folders')
        direct_folders=data.get('direct_folders',[])
        for paths in (folders,direct_folders):
            if not isinstance(paths,list) or any(not isinstance(f,str) or not f.strip() or not Path(f).is_absolute() for f in paths):
                raise people.Conflict('请选择资料库中的文件夹')
        if not 1<=len(folders)+len(direct_folders)<=1000:
            raise people.Conflict('请选择 1～1000 个资料库文件夹范围')
        from ..blueprints.library import _folder_pattern
        folders=list(dict.fromkeys(str(Path(f)) for f in folders))
        direct_folders=list(dict.fromkeys(str(Path(f)).rstrip(os.sep) for f in direct_folders))
        clauses=[]
        if folders:
            clauses.append("EXISTS (SELECT 1 FROM json_each(?) folders WHERE media.file_path LIKE folders.value ESCAPE '\\')")
            params.append(json.dumps([_folder_pattern(folder) for folder in folders]))
        if direct_folders:
            # Partially checked parents include their own files, never an unchecked descendant.
            clauses.append("EXISTS (SELECT 1 FROM json_each(?) folders WHERE "
                           "substr(media.file_path,1,length(folders.value)+1)=folders.value||? "
                           "AND instr(substr(media.file_path,length(folders.value)+2),?)=0)")
            params.extend([json.dumps(direct_folders),os.sep,os.sep])
        where+=' AND ('+' OR '.join(clauses)+')'
    elif scope=='review':
        if existing!='rescan':raise people.Conflict('待核对全量重扫请选择重新扫描')
        where+=' AND id IN ('+_REVIEW_MEDIA_SQL+')'
    elif scope=='all':
        if data.get('confirm_all') is not True:raise people.Conflict('请明确确认整理全部历史照片和视频')
    else:raise people.Conflict('人物整理范围无效')
    rows=db.execute('SELECT id FROM media WHERE '+where+' ORDER BY id',params).fetchall()
    queued=skipped=0
    for r in rows:
        mid=r[0];revision=input_revision(db,mid)
        active=db.execute("SELECT 1 FROM people_jobs WHERE media_id=? AND state IN ('queued','running') LIMIT 1",(mid,)).fetchone()
        completed=db.execute("SELECT 1 FROM people_jobs WHERE media_id=? AND input_revision=? AND state IN ('done','no_faces','quality_insufficient') LIMIT 1",(mid,revision)).fetchone()
        if active or (existing=='skip' and completed):skipped+=1;continue
        enqueue(db,mid,priority=100,force=True);queued+=1
    db.execute("INSERT OR REPLACE INTO settings VALUES ('people_paused','false')")
    return {'queued':queued,'skipped':skipped,'total':len(rows)}


def claim(db):
    from .model_preferences import people_enabled
    if not people_enabled(db):return None
    if get_setting(db,'people_paused','false')=='true':return None
    now=time.time()
    with db:
        db.execute("UPDATE people_jobs SET state='queued',lease=NULL,lease_until=NULL,error='中断后继续',updated_at=datetime('now') WHERE state='running' AND lease_until<?",(now,))
        while True:
            row=db.execute("SELECT j.*,m.media_type FROM people_jobs j JOIN media m ON m.id=j.media_id WHERE j.state='queued' ORDER BY j.priority DESC,j.id LIMIT 1").fetchone()
            if not row:return None
            if row['media_type']!='video' or row['config_key']==_config_key(db,'video'):break
            enqueue(db,row['media_id'],row['priority'],force=True)
            db.execute("UPDATE people_jobs SET state='stale',lease=NULL,lease_until=NULL,error='视频人脸设置已更新',updated_at=datetime('now') WHERE id=?",(row['id'],))
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
        rows=db.execute('SELECT people_jobs.*,media.media_type FROM people_jobs JOIN media ON media.id=people_jobs.media_id WHERE people_jobs.state IN ('+states+')').fetchall()
        for row in rows:
            revision=input_revision(db,row['media_id'])
            if revision!=row['input_revision'] or row['config_key']!=_config_key(db,row['media_type']):
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
    row=dict(db.execute('SELECT * FROM media WHERE id=?',(job['media_id'],)).fetchone())
    if row['media_type']=='video':
        from .video_runtime import VideoResult
        pipeline=VideoResult(cfg,row['file_path'],video_settings(db)['res'],job['_cancelled'])
        frames=pipeline.run()
        scope='tracked_video'
    else:
        frames,scope=face_engine.read_frames(row,cache,job['_cancelled'],revision=job['input_revision'])
        model=face_engine.load_engine(cfg['model_dir'],cfg['profile'],**_model_options(cfg))
    observations=_Observations();new_crops=[];feature_cache={}
    try:
        for value in frames:
            if job['_cancelled']():raise InterruptedError('人物整理已暂停')
            if scope=='tracked_video':
                faces=[value];timestamp=value['frame_time']
            else:
                timestamp,image=value
                faces=model.observe(image,timestamp,job['_cancelled'],feature_cache)
            # Deterministic frame/location keys keep human decisions attached on rescan.
            faces.sort(key=lambda f:(f['bbox'][0],f['bbox'][1]))
            for face in faces:
                face['sample_key']=str(timestamp)+':'+':'.join(str(round(v,4)) for v in face['bbox'])
                aligned=face.pop('crop')
                crop=face.pop('portrait',aligned)
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
        if scope=='tracked_video':logger.info('Video face tracking: {}',pipeline.stats)
        return {'model_key':pipeline.model_key if scope=='tracked_video' else model.info['key'],'observations':observations,'scope':scope,'new_crops':new_crops}
    except Exception:
        observations.close()
        _discard_crops(db,new_crops)
        raise
    finally:
        if hasattr(frames,'close'):frames.close()


def process(db,job,infer_fn=None):
    heartbeat=[time.time()]
    def cancelled():
        from .model_preferences import people_enabled, sync_people_jobs
        if not people_enabled(db):
            with db:sync_people_jobs(db)
            return True
        row=db.execute('SELECT state,lease FROM people_jobs WHERE id=?',(job['id'],)).fetchone()
        if not row or row['state']!='running' or row['lease']!=job['lease']:return True
        if job.get('_background'):
            from .classification_jobs import busy
            if busy(current_app.config['DATABASE']):
                db.execute("UPDATE people_jobs SET state='queued',lease=NULL,lease_until=NULL,error='前台操作优先，稍后继续',updated_at=datetime('now') WHERE id=? AND state='running' AND lease=?",
                           (job['id'],job['lease']))
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
            if input_revision(db,job['media_id'])!=job['input_revision'] or _config_key(db,row['media_type'])!=job['config_key'] or _stamp(row)!=before_stamp:
                db.execute("UPDATE people_jobs SET state='stale',lease=NULL,error='素材或模型设置已变化，请重试',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
                return False
            seen=[];chunk=[];usable=False;tracked=payload['scope']=='tracked_video';previous_track=None
            def record(batch):
                result=people.record_observations(db,job['media_id'],job['input_revision'],payload['model_key'],batch,finalize=False,tracked=tracked)
                seen.extend(f['id'] for f in result['faces'])
            for obs in payload['observations']:
                track=obs.get('track_id') if tracked else None
                if len(chunk)>=1000 and (not track or track!=previous_track):record(chunk);chunk=[]
                usable=usable or obs.get('feature') is not None and obs.get('quality',0)>=.35
                chunk.append(obs)
                previous_track=track
            if chunk or not seen:record(chunk)
            people.finish_observations(db,job['media_id'],job['input_revision'],seen)
            state='done'
            if not payload['observations']:state='quality_insufficient' if payload['scope']=='image_preview_lowres' else 'no_faces'
            elif not usable:state='quality_insufficient'
            db.execute("UPDATE people_jobs SET state=?,model_key=?,scope=?,face_count=?,lease=NULL,lease_until=NULL,error='',updated_at=datetime('now') WHERE id=? AND lease=?",
                       (state,payload['model_key'],payload['scope'],len(seen),job['id'],job['lease']))
            retained=True
        return True
    finally:
        if isinstance(payload['observations'],_Observations):payload['observations'].close()
        if not retained:
            _discard_crops(db,payload.get('new_crops',[]))


def status(db):
    from .face_engine import model_paths,model_info
    from .people_grouping import calibration
    cfg=settings(db)
    error='';model_key=None
    try:
        from .model_preferences import PEOPLE_OFF
        if not cfg['model_enabled']:raise ValueError(PEOPLE_OFF)
        paths=model_paths(cfg['model_dir'],cfg['profile'],**_model_options(cfg))
        available=all(p.is_file() and p.stat().st_size for p in paths)
        if not available:error='请选择完整的人脸模型文件'
        else:model_key=model_info(cfg['model_dir'],cfg['profile'],**_model_options(cfg))['key']
    except (ValueError,OSError) as exc:available=False;error=str(exc)
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
    return {'supports_direct_folders':True,'counts':counts,'unnamed_count':unnamed,'review_count':reviews,'revision':revision,'settings':cfg,
            'grouping':calibration(db,model_key),
            'model':{'ready':available,'profile':cfg['profile'],'error':error},
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
    with app.app_context():
        db=get_db()
        try:
            # Restore only the old automatic cutoff, never an explicit pause or opt-out.
            if get_setting(db,'people_paused','false')!='true' and settings(db)['model_enabled']:
                with db:
                    db.execute("UPDATE people_jobs SET state='queued',lease=NULL,lease_until=NULL,attempts=0,error='',updated_at=datetime('now') WHERE state='paused' AND error='达到本轮时间预算，可继续'")
            while True:
                if get_setting(db,'people_paused','false')=='true' or not settings(db)['model_enabled']:break
                if busy(key):
                    if not db.execute("SELECT 1 FROM people_jobs WHERE state='queued' LIMIT 1").fetchone():break
                    threading.Event().wait(.25);continue
                job=claim(db)
                if not job:break
                job['_background']=True
                try:
                    def waiting_cancelled():
                        row=db.execute('SELECT state,lease FROM people_jobs WHERE id=?',(job['id'],)).fetchone()
                        return not row or row['state']!='running' or row['lease']!=job['lease']
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
                    with db:db.execute("UPDATE people_jobs SET state='paused',lease=NULL,lease_until=NULL,error='任务已暂停',updated_at=datetime('now') WHERE id=? AND state='running' AND lease=?",(job['id'],job['lease']))
                except Exception as exc:
                    db.rollback();logger.warning('人物整理失败 job={} type={}',job['id'],type(exc).__name__)
                    with db:db.execute("UPDATE people_jobs SET state='failed',lease=NULL,error='本地人物整理失败，可重试',updated_at=datetime('now') WHERE id=? AND lease=?",(job['id'],job['lease']))
        finally:
            with _workers_lock:_workers.pop(key,None)
            pending=db.execute("SELECT 1 FROM people_jobs WHERE state='queued' LIMIT 1").fetchone()
            if pending and get_setting(db,'people_paused','false')!='true' and settings(db)['model_enabled']:
                ensure_worker(app)
            expiry=db.execute("SELECT MIN(lease_until) FROM people_jobs WHERE state='running'").fetchone()[0]
            if expiry and get_setting(db,'people_paused','false')!='true':
                timer=threading.Timer(max(.1,expiry-time.time()+.1),lambda:ensure_worker(app));timer.daemon=True
                with _workers_lock:_timers[key]=timer
                timer.start()
