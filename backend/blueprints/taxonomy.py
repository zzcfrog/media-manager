"""Local classification API; all mutations are transactional."""
import json
from functools import wraps

from flask import Blueprint, current_app, jsonify, request
from ..db import get_db
from ..services import taxonomy as tx

bp = Blueprint('taxonomy', __name__)


def operation(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        db=get_db()
        try:
            with db:
                result=fn(db,*args,**kwargs)
                if request.method not in ('GET','HEAD') and not request.path.endswith('/activity'):
                    tx.touch_events(db)
            if request.method not in ('GET','HEAD') and db.execute("SELECT 1 FROM taxonomy_relation_jobs WHERE state='queued' LIMIT 1").fetchone():
                from ..services.classification_jobs import ensure_worker
                ensure_worker(current_app._get_current_object())
            return result
        except (tx.Conflict,ValueError,TypeError,KeyError) as exc:
            return jsonify({'error':str(exc)}),409
    return wrapped


@bp.get('/tree')
@operation
def tree(db):
    rows=[dict(r) for r in db.execute('SELECT * FROM taxonomy_nodes WHERE status!=\'merged\' ORDER BY sort_order,name,id')]
    direct={r[0]:r[1] for r in db.execute('SELECT tag_id,COUNT(*) FROM media_tags GROUP BY tag_id')}
    totals={r[0]:r[1] for r in db.execute('WITH RECURSIVE closure(root,id) AS (SELECT id,id FROM taxonomy_nodes UNION ALL '
        'SELECT c.root,n.id FROM closure c JOIN taxonomy_nodes n ON n.parent_id=c.id) '
        'SELECT c.root,COUNT(DISTINCT mt.media_id) FROM closure c JOIN media_tags mt ON mt.tag_id=c.id GROUP BY c.root')}
    by_id={n['id']:n for n in rows}
    expressions={}
    split_sources={r[0] for r in db.execute("SELECT DISTINCT st.source_id FROM taxonomy_split_targets st JOIN taxonomy_changes c ON c.id=st.change_id WHERE c.state='applied'")}
    for e in db.execute('SELECT id,tag_id,text,origin FROM taxonomy_expressions ORDER BY id'):
        expressions.setdefault(e['tag_id'],[]).append(dict(e))
    for n in rows:
        path=[]; current=n
        while current:
            path.append(current['name']);current=by_id.get(current['parent_id'])
        n['path']=' / '.join(reversed(path))
        n['direct_count']=direct.get(n['id'],0)
        n['total_count']=totals.get(n['id'],0)
        n['aliases']=expressions.get(n['id'],[])
    return jsonify({'data':[tx.with_split_info(db,n) if n['id'] in split_sources else n for n in rows]})


@bp.get('/resolve')
@operation
def resolve(db):
    return jsonify({'data':tx.resolve(db,request.args.get('q',''))})


@bp.post('/nodes')
@operation
def create(db):
    data=request.get_json() or {}
    return jsonify(tx.create_node(db,data.get('name',''),data.get('parent_id'),data.get('definition',''),data.get('recognition_text',''))),201


@bp.patch('/nodes/<int:tag_id>')
@operation
def edit(db,tag_id):
    data=request.get_json() or {}
    node=tx.update_node(db,tag_id,data,data.get('version'))
    from .analysis import refresh_media_fts
    for row in db.execute('SELECT media_id FROM media_tags WHERE tag_id=?',(tag_id,)).fetchall():
        refresh_media_fts(db,row[0])
    return jsonify(node)


@bp.post('/nodes/<int:tag_id>/aliases')
@operation
def alias(db,tag_id):
    tx.add_expression(db,tag_id,(request.get_json() or {}).get('text',''))
    return jsonify({'ok':True})


@bp.delete('/aliases/<int:expression_id>')
@operation
def remove_alias(db,expression_id):
    row=db.execute('SELECT tag_id FROM taxonomy_expressions WHERE id=?',(expression_id,)).fetchone()
    if row:
        db.execute('DELETE FROM taxonomy_expressions WHERE id=?',(expression_id,))
        db.execute('UPDATE taxonomy_nodes SET version=version+1 WHERE id=?',(row[0],))
        tx.touch_semantics(db)
    return jsonify({'ok':True})


@bp.post('/decisions')
@operation
def decide(db):
    data=request.get_json() or {}
    ids=data.get('media_ids',[])
    if not ids or len(ids)>10000: raise tx.Conflict('请选择 1～10000 个素材')
    tx.decide(db,ids,data['tag_id'],data['decision'],data.get('scope','direct'),data.get('clear_exclusion',False))
    return jsonify({'ok':True,'counts':tx.summaries(db,ids)})


@bp.post('/plans/<kind>')
@operation
def preview(db,kind):
    data=request.get_json() or {}
    from ..services import taxonomy_plans
    if kind=='merge': result=taxonomy_plans.preview_merge(db,data['source_ids'],data['target_id'],data.get('resolutions'))
    elif kind=='split': result=taxonomy_plans.preview_split(db,data['source_id'],data['assignments'],data.get('resolutions'))
    else: raise tx.Conflict('操作无效')
    return jsonify(result)


@bp.post('/apply')
@operation
def apply(db):
    return jsonify(tx.apply_plan(db,request.get_json() or {}))


@bp.get('/changes')
@operation
def changes(db):
    return jsonify({'data':[dict(r) for r in db.execute('SELECT id,kind,state,created_at FROM taxonomy_changes ORDER BY id DESC LIMIT 100')]})


@bp.post('/changes/<int:change_id>/undo')
@operation
def undo(db,change_id):
    tx.undo(db,change_id)
    return jsonify({'ok':True})


@bp.route('/collections',methods=['GET','POST'])
@operation
def collections(db):
    if request.method=='POST':
        data=request.get_json() or {}
        return jsonify(tx.save_collection(db,data.get('name',''),data.get('query',{}))),201
    rows=[]
    for row in db.execute('SELECT * FROM taxonomy_collections ORDER BY name,id'):
        item=dict(row); item['query']=json.loads(item['query'])
        try: tx.validate_query(db,item['query'])
        except tx.Conflict: item['state']='needs_adjustment'
        rows.append(item)
    return jsonify({'data':rows})


@bp.route('/collections/<int:collection_id>',methods=['GET','DELETE','PATCH'])
@operation
def collection(db,collection_id):
    if request.method=='DELETE':
        db.execute('DELETE FROM taxonomy_collections WHERE id=?',(collection_id,))
        return jsonify({'ok':True})
    if request.method=='PATCH':
        data=request.get_json() or {}
        name=data.get('name')
        if not isinstance(name,str) or not name.strip() or len(name.strip())>120:
            raise tx.Conflict('图集名称需要1至120个字符')
        if 'query' in data:
            query=tx.validate_query(db,data['query'])
            result=db.execute("UPDATE taxonomy_collections SET name=?,query=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?",
                     (name.strip(),tx._json(query),collection_id,data['version']))
        else:
            result=db.execute("UPDATE taxonomy_collections SET name=?,version=version+1,updated_at=datetime('now') WHERE id=? AND version=?",
                     (name.strip(),collection_id,data['version']))
        if result.rowcount!=1: raise tx.Conflict('图集已改变，请刷新')
        return jsonify({'query':json.loads(db.execute('SELECT query FROM taxonomy_collections WHERE id=?',(collection_id,)).fetchone()[0])})
    return jsonify({'query':tx.collection_query(db,collection_id)})


@bp.route('/examples/<int:tag_id>',methods=['GET','POST'])
@operation
def examples(db,tag_id):
    tx.get_node(db,tag_id)
    if request.method=='POST':
        data=request.get_json() or {}; mid=int(data['media_id'])
        if data.get('role') not in ('positive','negative'): raise tx.Conflict('例图角色无效')
        db.execute("UPDATE taxonomy_candidates SET state='stale' WHERE tag_id=? AND kind='example' AND state='pending'",(tag_id,))
        db.execute('INSERT INTO taxonomy_examples(tag_id,media_id,role,input_revision) VALUES (?,?,?,?) '
                   "ON CONFLICT(tag_id,media_id) DO UPDATE SET role=excluded.role,input_revision=excluded.input_revision,updated_at=datetime('now')",
                   (tag_id,mid,data['role'],tx.input_revision(db,mid)))
    return jsonify({'data':[dict(r) for r in db.execute('SELECT e.*,m.file_name,m.thumbnail_path FROM taxonomy_examples e JOIN media m ON m.id=e.media_id WHERE tag_id=?',(tag_id,))]})


@bp.delete('/examples/<int:tag_id>/<int:media_id>')
@operation
def remove_example(db,tag_id,media_id):
    db.execute('DELETE FROM taxonomy_examples WHERE tag_id=? AND media_id=?',(tag_id,media_id))
    db.execute("UPDATE taxonomy_candidates SET state='stale' WHERE tag_id=? AND kind='example' AND state='pending'",(tag_id,))
    return jsonify({'ok':True})


@bp.get('/candidates')
@operation
def candidates(db):
    from ..services import taxonomy_review
    return jsonify(taxonomy_review.list_candidates(db,request.args.get('state','pending'),
        max(1,request.args.get('page',1,type=int)),max(1,min(200,request.args.get('per_page',60,type=int))),request.args.get('group')))


@bp.get('/candidates/groups')
@operation
def candidate_groups(db):
    from ..services import taxonomy_review
    return jsonify(taxonomy_review.groups(db,request.args.get('state','pending'),
        max(1,request.args.get('page',1,type=int)),max(1,min(100,request.args.get('per_page',20,type=int)))))


@bp.post('/candidates/<int:candidate_id>/revalidate')
@operation
def revalidate_candidate(db,candidate_id):
    from ..services.taxonomy_review import revalidate
    return jsonify(revalidate(db,candidate_id))


@bp.post('/candidates/reopen')
@operation
def reopen_candidate(db):
    ids=(request.get_json() or {}).get('ids',[])
    if not ids or len(ids)>1000: raise tx.Conflict('请选择候选范围')
    for cid in ids:
        context=db.execute('SELECT meaning_key FROM taxonomy_candidate_context WHERE candidate_id=?',(cid,)).fetchone()
        if context: db.execute("UPDATE taxonomy_closed_proposals SET state='reopened' WHERE meaning_key=?",(context[0],))
        db.execute("UPDATE taxonomy_candidates SET state='pending' WHERE id=? AND state IN ('rejected','stale')",(cid,))
    return jsonify({'ok':True})


@bp.post('/candidates/review/preview')
@operation
def preview_candidate_mapping(db):
    from ..services.taxonomy_review import target_context
    data=request.get_json() or {};ids=data.get('ids',[]);target=data.get('tag_id')
    if not ids or len(ids)>10000 or target is None:raise tx.Conflict('请选择候选范围与映射目标')
    db.execute('UPDATE taxonomy_nodes SET id=id WHERE id=?',(int(target),))
    node=tx.get_node(db,int(target),redirect=True)
    return jsonify({'target_context':target_context(db,ids,target),
                    'target':{'id':node['id'],'description':tx.recognition_description(db,node),
                              'path':' / '.join(tx.get_node(db,i)['name'] for i in reversed(tx.ancestors(db,node['id'])))}})


@bp.post('/candidates/review')
@operation
def review(db):
    data=request.get_json() or {};ids=data.get('ids',[])
    if not ids or len(ids)>10000: raise tx.Conflict('请明确选择候选范围')
    from ..services import taxonomy_review
    taxonomy_review.review(db,ids,bool(data.get('accept')),data.get('tag_id'),bool(data.get('baseline')),data.get('target_context'))
    return jsonify({'ok':True,'closed_scope':'新词拒绝仅关闭相同含义的来源，不影响其它含义；已有标签拒绝作用于明确所选素材'})


@bp.post('/candidates/cleanup')
@operation
def cleanup_candidates(db):
    from ..db import get_setting
    data=request.get_json() or {}
    days=int(get_setting(db,'classification_candidate_retention_days','90'))
    ids=[r[0] for r in db.execute("SELECT id FROM taxonomy_candidates WHERE state IN ('rejected','stale') AND updated_at<datetime('now',?)",('-'+str(days)+' days',))]
    if data.get('confirm') is True and ids:
        # Sources, decisions and closed meanings deliberately outlive diagnostic candidates.
        db.execute("DELETE FROM taxonomy_candidates WHERE state IN ('rejected','stale') AND updated_at<datetime('now',?)",('-'+str(days)+' days',))
    return jsonify({'count':len(ids),'retention_days':days,'applied':data.get('confirm') is True,
                    'scope':'仅清理过期的已拒绝或过期候选；待审、正式标签、人工决定和来源保持完整'})


@bp.post('/jobs/preview')
@operation
def preview_history(db):
    from ..services.classification_jobs import map_analysis
    ids=list(dict.fromkeys(int(i) for i in (request.get_json() or {}).get('media_ids',[])))
    if not ids or len(ids)>10000:raise tx.Conflict('请明确选择最多一万项素材')
    available=0;existing=0;terms={}
    for mid in ids:
        row=db.execute('SELECT media_type FROM media WHERE id=?',(mid,)).fetchone()
        if not row:raise tx.Conflict('素材已移除，请刷新范围')
        if row[0] not in ('image','video'):continue
        values=map_analysis(db,{'media_id':mid})
        if not values['historical_snapshot']:continue
        available+=1
        existing+=db.execute('SELECT COUNT(*) FROM media_tags WHERE media_id=?',(mid,)).fetchone()[0]
        for value in values['candidates']:terms.setdefault(value['term'],set()).add(mid)
    buckets={'matched_terms':[],'ambiguous_terms':[],'unmatched_terms':[]}
    for term,members in sorted(terms.items()):
        matches=tx.resolve(db,term)
        for n in matches:n['path']=' / '.join(tx.get_node(db,i)['name'] for i in reversed(tx.ancestors(db,n['id'])))
        bucket='matched_terms' if len(matches)==1 else 'ambiguous_terms' if matches else 'unmatched_terms'
        buckets[bucket].append({'term':term,'count':len(members),'matches':matches})
    return jsonify({'media_count':len(ids),'available_count':available,'skipped_count':len(ids)-available,
                    'existing_label_count':existing,**buckets})


@bp.route('/jobs',methods=['GET','POST'])
@operation
def jobs(db):
    from ..services import classification_jobs as jobs
    if request.method=='POST':
        data=request.get_json() or {}; ids=data.get('media_ids',[])
        stage=data.get('stage','analysis')
        if not ids or len(ids)>10000 or stage not in ('analysis','fast','omni'): raise tx.Conflict('任务范围或阶段无效')
        for mid in dict.fromkeys(ids): jobs.enqueue(db,int(mid),stage,priority=100)
        db.commit()
        jobs.ensure_worker(current_app._get_current_object())
    return jsonify({'data':[dict(r) for r in db.execute('SELECT id,media_id,stage,state,attempts,error FROM taxonomy_jobs ORDER BY id DESC LIMIT 200')]})


@bp.post('/jobs/control')
@operation
def control(db):
    data=request.get_json() or {}; action=data.get('action')
    if action not in ('pause','resume','cancel'): raise tx.Conflict('任务操作无效')
    ids=data.get('ids',[])
    if not ids: raise tx.Conflict('请选择任务')
    old=('queued','waiting','running') if action=='pause' else ('paused','waiting','failed') if action=='resume' else ('queued','waiting','running','paused','failed')
    state={'pause':'paused','resume':'queued','cancel':'cancelled'}[action]
    db.execute('UPDATE taxonomy_jobs SET state=?,lease=NULL'+(',attempts=0' if action=='resume' else '')+' WHERE id IN ('+','.join('?' for _ in ids)+') AND state IN ('+','.join('?' for _ in old)+')',[state,*ids,*old])
    if action=='resume':
        db.commit()
        from ..services.classification_jobs import ensure_worker
        ensure_worker(current_app._get_current_object())
    return jsonify({'ok':True})


@bp.post('/examples/<int:tag_id>/find')
@operation
def find_examples(db,tag_id):
    data=request.get_json() or {}
    if data.get('all_cached') is True:
        ids=[r[0] for r in db.execute("SELECT id FROM media WHERE media_type IN ('image','video')")]
    else:
        ids=data.get('media_ids',[])
        if not ids: raise tx.Conflict('请明确选择检索范围')
    result=tx.example_candidates(db,tag_id,ids)
    revision=tx.example_revision(db,tag_id)
    for item in result['data']:
        media_revision=tx.input_revision(db,item['media_id'],'image')
        key='example:'+str(tag_id)+':'+str(item['media_id'])+':'+revision+':'+media_revision
        evidence={**item,'model':result['model_key'],'example_revision':revision}
        db.execute('INSERT OR IGNORE INTO taxonomy_candidates(media_id,tag_id,term,kind,evidence,source_key,input_revision) VALUES (?,?,?,?,?,?,?)',
            (item['media_id'],tag_id,tx.get_node(db,tag_id)['name'],'example',tx._json(evidence),key,media_revision))
        item['candidate_id']=db.execute('SELECT id FROM taxonomy_candidates WHERE source_key=?',(key,)).fetchone()[0]
        from ..services.taxonomy_review import track_candidate
        track_candidate(db,item['candidate_id'],'example:'+revision)
    return jsonify(result)


@bp.route('/configuration',methods=['GET','PATCH'])
@operation
def configuration(db):
    from ..db import get_setting
    keys={'classification_enabled':'false','classification_model_dir':'','classification_budget_seconds':'600',
          'classification_omni_model':'qwen3-omni-30b-a3b','classification_omni_enabled':'false',
          'classification_relations_enabled':'false','classification_auto_enabled':'false','classification_auto_relations_enabled':'false',
          'classification_resource_limit_mb':'4096','classification_candidate_retention_days':'90'}
    if request.method=='PATCH':
        data=request.get_json() or {}
        if set(data)-set(keys): raise tx.Conflict('未知分类设置')
        for key in ('classification_enabled','classification_omni_enabled','classification_relations_enabled','classification_auto_enabled','classification_auto_relations_enabled'):
            if data.get(key,'false') not in ('true','false'): raise tx.Conflict('开关无效')
        if 'classification_resource_limit_mb' in data and not 256<=int(data['classification_resource_limit_mb'])<=65536: raise tx.Conflict('资源预算范围为256～65536MB')
        if 'classification_candidate_retention_days' in data and not 1<=int(data['classification_candidate_retention_days'])<=3650: raise tx.Conflict('候选保留期范围为1～3650天')
        if 'classification_budget_seconds' in data and not 1<=int(data['classification_budget_seconds'])<=3600: raise tx.Conflict('时间预算范围为 1～3600 秒')
        if 'classification_omni_model' in data:
            from ..local_vlm import MODELS
            if data['classification_omni_model'] not in MODELS: raise tx.Conflict('未知本地模型')
        for key,value in data.items():
            db.execute('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,str(value)))
    return jsonify({k:get_setting(db,k,v) for k,v in keys.items()})


@bp.get('/media/<int:media_id>/labels')
@operation
def media_labels(db,media_id):
    if not db.execute('SELECT 1 FROM media WHERE id=?',(media_id,)).fetchone():
        return jsonify({'error':'素材不存在'}),404
    data=[]
    for label in tx.tag_rows(db,media_id):
        label['sources']=[dict(r) for r in db.execute('SELECT origin,evidence,created_at FROM taxonomy_sources WHERE media_id=? AND tag_id=? ORDER BY id',(media_id,label['id']))]
        label['decisions']=[dict(r) for r in db.execute('SELECT decision,scope,version FROM taxonomy_decisions WHERE media_id=? AND tag_id=?',(media_id,label['id']))]
        label['path']=' / '.join(tx.get_node(db,i)['name'] for i in reversed(tx.ancestors(db,label['id'])))
        data.append(label)
    return jsonify({'data':data,'decisions':[dict(r) for r in db.execute('SELECT tag_id,scope,decision,version FROM taxonomy_decisions WHERE media_id=?',(media_id,))]})


@bp.get('/relationships/jobs')
@operation
def relationship_jobs(db):
    return jsonify({'data':[dict(r) for r in db.execute('SELECT j.*,n.name FROM taxonomy_relation_jobs j JOIN taxonomy_nodes n ON n.id=j.tag_id ORDER BY j.id DESC LIMIT 200')]})


@bp.post('/relationships/jobs/control')
@operation
def relationship_control(db):
    from ..services.taxonomy_relations import control
    from ..services.classification_jobs import ensure_worker
    data=request.get_json() or {};ids=data.get('ids',[]);action=data.get('action')
    if not ids or len(ids)>1000 or action not in ('pause','resume','cancel'):raise tx.Conflict('请选择关系任务及有效操作')
    changed=control(db,ids,action)
    if action=='resume':db.commit();ensure_worker(current_app._get_current_object())
    return jsonify({'ok':True,'changed':changed})


@bp.get('/relationships')
@operation
def relationships(db):
    tag_id=request.args.get('tag_id',type=int)
    return jsonify({'data':[dict(r) for r in db.execute('SELECT r.*,a.name source_name,b.name target_name FROM taxonomy_relations r JOIN taxonomy_nodes a ON a.id=r.source_id JOIN taxonomy_nodes b ON b.id=r.target_id WHERE r.source_id=? OR r.target_id=?',(tag_id,tag_id))],
                    'locks':[dict(r) for r in db.execute('SELECT * FROM taxonomy_relation_locks WHERE tag_id=?',(tag_id,))]})


@bp.post('/relationships/organize')
@operation
def organize_relationships(db):
    from ..services import taxonomy_relations,classification_jobs
    ids=(request.get_json() or {}).get('tag_ids',[])
    if not ids or len(ids)>5000:raise tx.Conflict('请明确选择标签范围')
    jobs=[taxonomy_relations.queue(db,int(i),explicit=True) for i in dict.fromkeys(ids)]
    db.commit();classification_jobs.ensure_worker(current_app._get_current_object())
    return jsonify({'queued':jobs})


@bp.get('/relationships/suggestions')
@operation
def relationship_suggestions(db):
    tag_id=request.args.get('tag_id',type=int);state=request.args.get('state','pending')
    rows=db.execute('SELECT r.*,n.name target_name FROM taxonomy_relation_suggestions r LEFT JOIN taxonomy_nodes n ON n.id=r.target_id WHERE r.state=? AND (? IS NULL OR r.tag_id=?) ORDER BY r.id DESC',(state,tag_id,tag_id)).fetchall()
    return jsonify({'data':[dict(r) for r in rows],'total':len(rows)})


@bp.post('/relationships/review')
@operation
def relationship_review(db):
    from ..services.taxonomy_relations import apply_suggestion
    data=request.get_json() or {};ids=data.get('ids',[])
    if not ids:raise tx.Conflict('请选择关系建议')
    changes=[]
    for rid in ids:
        row=db.execute('SELECT * FROM taxonomy_relation_suggestions WHERE id=?',(rid,)).fetchone()
        if not row:raise tx.Conflict('关系建议不存在')
        if data.get('accept'):changes.append(apply_suggestion(db,row))
        else:db.execute("UPDATE taxonomy_relation_suggestions SET state='rejected' WHERE id=?",(rid,))
    return jsonify({'ok':True,'changes':changes})


@bp.post('/relationships/locks')
@operation
def relationship_locks(db):
    data=request.get_json() or {};tag_id=int(data['tag_id']);tx.get_node(db,tag_id)
    area=data.get('area','all')
    if area not in ('all','alias','near','related'):raise tx.Conflict('锁定范围无效')
    db.execute('INSERT INTO taxonomy_relation_locks(tag_id,area,locked) VALUES (?,?,?) ON CONFLICT(tag_id,area) DO UPDATE SET locked=excluded.locked',
               (tag_id,area,int(bool(data.get('locked')))))
    return jsonify({'ok':True})


@bp.route('/validation',methods=['GET','POST'])
@operation
def validation(db):
    from ..services.taxonomy_relations import install_validation
    if request.method=='POST': return jsonify(install_validation(db,request.get_json() or {}))
    return jsonify({'data':[dict(r) for r in db.execute('SELECT * FROM taxonomy_validation_profiles ORDER BY id DESC')]})


@bp.post('/jobs/activity')
@operation
def activity(db):
    data=request.get_json() or {};client=str(data.get('client',''))[:80]
    if not client:raise tx.Conflict('缺少客户端标识')
    from ..services.classification_jobs import set_playback
    set_playback(current_app.config['DATABASE'],client,bool(data.get('active')))
    return jsonify({'ok':True})


@bp.get('/status')
@operation
def status(db):
    from ..db import get_setting
    return jsonify({'revision':get_setting(db,'classification_event_revision','0'),
                    'label_revision':get_setting(db,'classification_label_revision','0')})


@bp.get('/validation/samples')
@operation
def validation_samples(db):
    import numpy as np
    tag_id=request.args.get('tag_id',type=int);node=tx.get_node(db,tag_id)
    from ..services import taxonomy_review
    text_revision=taxonomy_review.digest(tx.recognition_description(db,node))
    text=db.execute('SELECT * FROM taxonomy_text_features WHERE tag_id=? AND text_revision=? ORDER BY updated_at DESC LIMIT 1',(tag_id,text_revision)).fetchone()
    if not text:raise tx.Conflict('先运行本地快速分类，准备此标签的模型特征')
    vector=np.frombuffer(text['vector'],dtype=np.float32)
    candidates=[]
    for row in db.execute('SELECT f.*,m.file_name FROM taxonomy_features f JOIN media m ON m.id=f.media_id WHERE model_key=? ORDER BY media_id',(text['model_key'],)):
        if row['input_revision']!=tx.input_revision(db,row['media_id'],'image'):continue
        value=np.frombuffer(row['vector'],dtype=np.float32)
        if len(value)!=len(vector) or not np.all(np.isfinite(value)):continue
        candidates.append({'sample_id':str(row['media_id'])+':'+text['model_key'][:12], 'media_id':row['media_id'],'file_name':row['file_name'],
                           'score':float(value@vector),'expected':None,'split':'selection' if row['media_id']%3==0 else 'heldout'})
    candidates.sort(key=lambda c:c['score'],reverse=True)
    # Include score strata rather than only top matches; human expected values stay blank.
    if len(candidates)>120:
        indexes=np.linspace(0,len(candidates)-1,120,dtype=int)
        candidates=[candidates[int(i)] for i in indexes]
    return jsonify({'model_key':text['model_key'],'cases':candidates})


@bp.post('/decisions/preview')
@operation
def preview_decision(db):
    from ..services.taxonomy_plans import preview_decision
    return jsonify(preview_decision(db,request.get_json() or {}))


@bp.post('/nodes/<int:tag_id>/impact')
@operation
def preview_edit(db,tag_id):
    from ..services.taxonomy_plans import preview_edit
    return jsonify(preview_edit(db,tag_id,request.get_json() or {}))


@bp.post('/plans/suggest')
@operation
def suggest_plan(db):
    from ..services.taxonomy_plans import suggest
    return jsonify(suggest(db,request.get_json() or {}))
