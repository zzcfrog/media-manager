"""People management endpoints. Recognition and job routes are attached separately."""
from functools import wraps
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from ..db import get_db
from ..services import people

bp = Blueprint('people', __name__)


def operation(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        db = get_db()
        try:
            if request.method not in ('GET', 'HEAD') and not isinstance(request.get_json(silent=True), dict):
                raise people.Conflict('请求内容需为 JSON 对象')
            with db:
                return fn(db, *args, **kwargs)
        except (people.Conflict, ValueError, TypeError, KeyError) as exc:
            return jsonify({'error': str(exc)}), 409
    return wrapped


@bp.get('/')
@bp.get('/persons')
@operation
def persons(db):
    return jsonify({'data': people.list_people(db, request.args.get('view','all'), request.args.get('q',''), request.args.get('sort','recent'))})


@bp.post('/persons')
@operation
def create(db):
    return jsonify(people.create_person(db,(request.get_json() or {}).get('name',''))),201


@bp.route('/persons/<int:person_id>', methods=['GET','PATCH'])
@operation
def person(db, person_id):
    if request.method=='PATCH':
        data=request.get_json() or {}
        return jsonify(people.update_person(db,person_id,data,data.get('version')))
    return jsonify(people.get_person(db,person_id))


@bp.get('/media/<int:media_id>')
@operation
def media(db,media_id):
    return jsonify(people.media_people(db,media_id))


@bp.post('/media/decisions')
@operation
def decide_media(db):
    data=request.get_json() or {}
    return jsonify(people.decide_media(db,data.get('media_ids',[]),data['person_id'],data['decision']))


@bp.post('/faces/decide')
@operation
def decide_faces(db):
    data=request.get_json() or {}
    return jsonify(people.decide_faces(db,data.get('face_ids',[]),data['action'],data.get('target_id'),data.get('name',''),data.get('versions')))


@bp.post('/merge/preview')
@operation
def preview(db):
    data=request.get_json() or {}
    return jsonify(people.preview_merge(db,data.get('source_ids',[]),data['target_id']))


@bp.post('/merge/apply')
@operation
def merge(db):
    return jsonify(people.apply_merge(db,(request.get_json() or {})['plan_id']))


@bp.post('/undo/<int:change_id>')
@operation
def undo(db,change_id):
    return jsonify(people.undo(db,change_id))


@bp.get('/reviews/rescan')
@operation
def review_rescan(db):
    from ..services.people_jobs import review_scan_summary
    return jsonify(review_scan_summary(db))


@bp.get('/reviews')
@operation
def reviews(db):
    state=request.args.get('state','pending');kind=request.args.get('kind')
    page,size,offset=_page(40)
    data=people.list_reviews(db,state,kind,size,offset)
    total=db.execute('SELECT COUNT(*) FROM people_reviews WHERE state=?'+(' AND kind=?' if kind else ''),
                     (state,kind) if kind else (state,)).fetchone()[0]
    return jsonify({'data':data,'pagination':_pagination(page,size,total)})


def _page(default):
    page=int(request.args.get('page',1));size=int(request.args.get('per_page',default))
    if not 1<=page<=1000000 or not 1<=size<=200:raise people.Conflict('分页范围无效')
    return page,size,(page-1)*size


def _pagination(page,size,total):
    return {'page':page,'per_page':size,'total':total,'pages':(total+size-1)//size}


@bp.get('/persons/<int:person_id>/faces')
@operation
def person_faces(db,person_id):
    people._person(db,person_id)
    page,size,offset=_page(60)
    where="person_id=? AND active=1 AND assignment!='not_face' AND media_id IN (SELECT media_id FROM ("+people.MEMBERSHIP_SQL+') WHERE person_id=?)'
    total=db.execute('SELECT COUNT(*) FROM people_faces WHERE '+where,(person_id,person_id)).fetchone()[0]
    rows=db.execute('SELECT * FROM people_faces WHERE '+where+' ORDER BY quality DESC,id LIMIT ? OFFSET ?',
                    (person_id,person_id,size,offset)).fetchall()
    return jsonify({'data':[people._face(r) for r in rows],'pagination':_pagination(page,size,total)})


@bp.post('/reviews/<int:review_id>')
@operation
def review(db,review_id):
    return jsonify(people.review_decision(db,review_id,(request.get_json() or {})['decision']))


@bp.get('/faces/<int:face_id>/crop')
def crop(face_id):
    row=get_db().execute('SELECT crop_path FROM people_faces WHERE id=?',(face_id,)).fetchone()
    if not row or not row['crop_path']:
        abort(404)
    root=Path(current_app.config.get('PEOPLE_CACHE_DIR',Path(current_app.config['DATABASE']).parent/'people-cache')).resolve()
    path=Path(row['crop_path'])
    path=(root/path).resolve() if not path.is_absolute() else path.resolve()
    try:path.relative_to(root)
    except ValueError:abort(404)
    if path.suffix.lower() not in ('.jpg','.jpeg','.png') or not path.is_file():abort(404)
    return send_file(path,mimetype='image/png' if path.suffix.lower()=='.png' else 'image/jpeg',conditional=True)


@bp.get('/status')
@operation
def status(db):
    from ..services import people_jobs
    return jsonify(people_jobs.status(db))


@bp.patch('/settings')
@operation
def settings(db):
    from ..services import people_jobs
    was_enabled=people_jobs.settings(db)['model_enabled']
    result=people_jobs.configure(db,request.get_json())
    db.commit()
    if result['model_enabled'] and not was_enabled:people_jobs.ensure_worker(current_app._get_current_object())
    return jsonify(result)


@bp.post('/models/probe')
@operation
def model_probe(db):
    from ..services.face_engine import probe_model
    data=request.get_json()
    return jsonify(probe_model(data.get('path'),data.get('stage')))


@bp.get('/models/catalog')
def model_catalog():
    from ..services.face_model_downloads import catalog
    return jsonify(catalog())


@bp.route('/models/download',methods=['GET','POST'])
@operation
def model_download(db):
    from ..services import face_model_downloads as downloads
    key=current_app.config['DATABASE']
    if request.method=='GET':return jsonify(downloads.status(key))
    data=request.get_json()
    if set(data)-{'profile','directory','stage','subdirectory'}:raise ValueError('下载字段无效')
    return jsonify(downloads.start(key,data.get('profile'),data.get('directory'),data.get('stage'),data.get('subdirectory')))


@bp.post('/models/download/cancel')
@operation
def model_download_cancel(db):
    from ..services.face_model_downloads import cancel
    return jsonify(cancel(current_app.config['DATABASE'],request.get_json().get('id')))


@bp.post('/jobs')
@operation
def jobs(db):
    from ..services import people_jobs
    result=people_jobs.enqueue_scope(db,request.get_json())
    db.commit()
    people_jobs.ensure_worker(current_app._get_current_object())
    return jsonify(result)


@bp.post('/jobs/control')
@operation
def control(db):
    from ..services import people_jobs
    result=people_jobs.control(db,request.get_json()['action'])
    db.commit()
    people_jobs.ensure_worker(current_app._get_current_object())
    return jsonify(result)


@bp.post('/jobs/activity')
@operation
def activity(db):
    from ..services.classification_jobs import set_playback
    data=request.get_json()
    if type(data.get('active')) is not bool or not isinstance(data.get('client'),str) or len(data['client'])>100:
        raise people.Conflict('前台状态无效')
    set_playback(current_app.config['DATABASE'],data['client'],data['active'])
    return jsonify({'ok':True})
