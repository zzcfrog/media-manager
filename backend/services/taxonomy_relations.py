"""AI-proposed vocabulary relationships and independently validated auto policies."""
import difflib
import json
import math
import time
import uuid
from ..db import get_setting
from . import taxonomy as tx
from . import taxonomy_review as review

DEFINITIONS={
 'taxonomy_relations': '''id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id),
    target_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id),kind TEXT NOT NULL,origin TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,UNIQUE(source_id,target_id,kind)''',
 'taxonomy_relation_locks': '''tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
    area TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tag_id,area)''',
 'taxonomy_relation_jobs': '''id INTEGER PRIMARY KEY,tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',lease TEXT,error TEXT NOT NULL DEFAULT '',
    UNIQUE(tag_id,revision)''',
 'taxonomy_relation_suggestions': '''id INTEGER PRIMARY KEY,tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id),
    target_id INTEGER REFERENCES taxonomy_nodes(id),expression TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,
    evidence TEXT NOT NULL,revision TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',source_key TEXT NOT NULL UNIQUE''',
 'taxonomy_validation_profiles': '''id INTEGER PRIMARY KEY,kind TEXT NOT NULL,model_key TEXT NOT NULL,
    tag_id INTEGER REFERENCES taxonomy_nodes(id),recognition_revision TEXT NOT NULL DEFAULT '',
    threshold REAL NOT NULL,dataset_sha TEXT NOT NULL,results TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1''',
}

LEASE_SECONDS = 600


def _node_revision(db,node):
    return review.digest([tx.recognition_description(db,node),node['parent_id'],node['status'],
                          get_setting(db,'classification_omni_model','qwen3-omni-30b-a3b')])


def queue(db,tag_id,explicit=False):
    from .model_preferences import classification_enabled
    if not classification_enabled(db,'omni'):return None
    if not explicit and get_setting(db,'classification_relations_enabled','false')!='true': return None
    node=tx.get_node(db,tag_id)
    if node['status'] not in ('active','paused'): return None
    revision=_node_revision(db,node)
    db.execute('INSERT INTO taxonomy_relation_jobs(tag_id,revision) VALUES (?,?) ON CONFLICT(tag_id,revision) DO UPDATE SET '
               "state=CASE WHEN state IN ('failed','waiting','paused','stale') THEN 'queued' ELSE state END,"
               "updated_at=datetime('now')",(tag_id,revision))
    return db.execute('SELECT id FROM taxonomy_relation_jobs WHERE tag_id=? AND revision=?',(tag_id,revision)).fetchone()[0]


def locked(db,tag_id,area):
    return bool(db.execute('SELECT 1 FROM taxonomy_relation_locks WHERE tag_id=? AND area IN (?,\'all\') AND locked=1',(tag_id,area)).fetchone())


def _context(db,tag_id,target_id=None):
    values=[tx.get_node(db,tag_id)]
    if target_id: values.append(tx.get_node(db,target_id))
    return review.digest([[n['id'],tx.recognition_description(db,n),n['parent_id'],n['status']] for n in values])


def _profile(db,kind,model,tag_id,score):
    if not isinstance(model,str) or not model.strip() or not math.isfinite(score): return None
    node=tx.get_node(db,tag_id)
    revision=review.digest(tx.recognition_description(db,node))
    return db.execute("SELECT * FROM taxonomy_validation_profiles WHERE kind=? AND enabled=1 AND model_key=? "
                      "AND (tag_id IS NULL OR (tag_id=? AND recognition_revision=?)) AND threshold<=? "
                      "ORDER BY tag_id IS NOT NULL DESC,id DESC LIMIT 1",(kind,model,tag_id,revision,score)).fetchone()


def _record_change(db,kind,scope,before,after,context=None):
    for state in (before,after):
        state['_created_node_ids']=[]
        if context is not None: state['_plan_context']=context
    return db.execute('INSERT INTO taxonomy_changes(kind,scope,before_state,after_state) VALUES (?,?,?,?)',
                      (kind,tx._json(scope),tx._json(before),tx._json(after))).lastrowid


def apply_suggestion(db,row,automatic=False):
    # Hold the write lock and re-read the suggestion; UI snapshots are never authority.
    db.execute('UPDATE taxonomy_relation_suggestions SET id=id WHERE id=?',(row['id'],))
    row=db.execute('SELECT * FROM taxonomy_relation_suggestions WHERE id=?',(row['id'],)).fetchone()
    if not row: raise tx.Conflict('关系建议不存在')
    if row['state']!='pending': raise tx.Conflict('关系建议已处理')
    if row['revision']!=_context(db,row['tag_id'],row['target_id']): raise tx.Conflict('关系依据已变化，请重新整理')
    scope=sorted({row['tag_id'],row['target_id']} - {None})
    nodes=[tx.get_node(db,tag_id) for tag_id in scope]
    if any(n['status'] not in (('active',) if automatic else ('active','paused')) for n in nodes):
        raise tx.Conflict('关系端点已停用或暂停')
    if locked(db,row['tag_id'],row['kind']) or row['target_id'] and locked(db,row['target_id'],row['kind']):
        raise tx.Conflict('关系已人工锁定')
    evidence=json.loads(row['evidence'])
    profile=None
    if automatic:
        if get_setting(db,'classification_auto_relations_enabled','false')!='true':
            raise tx.Conflict('自动关系维护未启用')
        profile=_profile(db,row['kind'],evidence.get('model'),row['tag_id'],1.)
        if not profile: raise tx.Conflict('关系模型尚无有效独立验证')
    evidence={**evidence,'policy':'validated-relation-v1' if automatic else 'human-review-v1',
              'validation_profile':profile['id'] if profile else None,'revision':row['revision'],
              'versions':{str(n['id']):n['version'] for n in nodes}}
    with tx._savepoint(db):
        before=tx._snapshot(db,scope)
        if row['kind']=='alias':
            target=row['target_id'] or row['tag_id']
            expression=row['expression'].strip()
            if not expression or len(expression)>120: raise tx.Conflict('别名需为 1～120 字')
            resolved=tx.resolve(db,expression)
            if any(n['id']!=target for n in resolved): raise tx.Conflict('表达已有其他含义，请消歧或使用正式合并')
            # Never turn an existing second node into an alias implicitly.
            other=db.execute('SELECT id FROM taxonomy_nodes WHERE normalized=? AND id!=? AND status!=\'merged\'',(tx.normalize(expression),target)).fetchone()
            if other: raise tx.Conflict('表达已有独立概念，需正式合并方案')
            tx.add_expression(db,target,expression,'ai' if automatic else 'manual_review')
        elif row['kind'] in ('near','related'):
            if not row['target_id'] or row['target_id']==row['tag_id']: raise tx.Conflict('关系端点无效')
            source,target=sorted([row['tag_id'],row['target_id']])
            db.execute('INSERT OR IGNORE INTO taxonomy_relations(source_id,target_id,kind,origin,evidence) VALUES (?,?,?,?,?)',
                       (source,target,row['kind'],'ai' if automatic else 'manual_review',tx._json(evidence)))
        else:
            raise tx.Conflict('父类或已有概念合并提议需明确操作方案，不能作为自动关系执行')
        db.execute("UPDATE taxonomy_relation_suggestions SET state='accepted',evidence=?,updated_at=datetime('now') WHERE id=?",(tx._json(evidence),row['id']))
        after=tx._snapshot(db,scope)
        change_id=_record_change(db,'relation_auto' if automatic else 'relation_review',scope,before,after)
        tx.touch_events(db)
    return {'change_id':change_id}


def install_validation(db,data):
    # The application computes the metrics. Model self-ratings are never accepted as evidence.
    cases=data.get('cases',[])
    if data.get('annotation_source')!='human' or not isinstance(cases,list) or any(not isinstance(c,dict) for c in cases):
        raise tx.Conflict('需要独立人工真值样本')
    selected=[c for c in cases if c.get('split')=='selection']
    heldout=[c for c in cases if c.get('split')=='heldout']
    if len(selected)<10 or len(heldout)<20 or len({c.get('sample_id') for c in cases})!=len(cases):
        raise tx.Conflict('需至少10条选阈值样本及20条独立留出样本，样本ID不得重复')
    for c in cases:
        if (type(c.get('expected')) is not bool or type(c.get('score')) not in (int,float)
                or not math.isfinite(c['score']) or c.get('split') not in ('selection','heldout')
                or not isinstance(c.get('sample_id'),str) or not c['sample_id'].strip()):
            raise tx.Conflict('真值与分数格式无效')
    if type(data.get('threshold')) not in (int,float) or not math.isfinite(data['threshold']):
        raise tx.Conflict('阈值必须为有限数值')
    threshold=float(data['threshold'])
    positives=sum(c['expected'] for c in heldout);negatives=len(heldout)-positives
    tp=sum(c['expected'] and c['score']>=threshold for c in heldout)
    fp=sum(not c['expected'] and c['score']>=threshold for c in heldout)
    if positives<10 or negatives<10 or tp<10 or fp:
        raise tx.Conflict('留出集正反例各需至少10条，自动采用至少10条且无误报；本轮未达到自动应用门槛')
    kind=data['kind']
    if kind not in ('association','alias','near','related'): raise tx.Conflict('验证策略类型无效')
    model=data.get('model_key')
    if not isinstance(model,str) or not model.strip(): raise tx.Conflict('缺少验证模型标识')
    tag_id=data.get('tag_id')
    if kind=='association' and tag_id is None: raise tx.Conflict('素材分类验证必须指定概念')
    node=tx.get_node(db,tag_id) if tag_id is not None else None
    if node and node['status']!='active': raise tx.Conflict('验证概念必须启用')
    revision=review.digest(tx.recognition_description(db,node)) if node else ''
    results={'heldout_count':len(heldout),'positive':positives,'negative':negatives,'true_positive':tp,'false_positive':fp,
             'precision':tp/(tp+fp),'recall':tp/positives,'selection_count':len(selected),'annotation_source':'human'}
    profile=db.execute('INSERT INTO taxonomy_validation_profiles(kind,model_key,tag_id,recognition_revision,threshold,dataset_sha,results) VALUES (?,?,?,?,?,?,?)',
        (kind,model,tag_id,revision,threshold,review.digest(cases),tx._json(results))).lastrowid
    return {'id':profile,**results}


def try_auto_association(db,candidate_id):
    if get_setting(db,'classification_auto_enabled','false')!='true': return False
    db.execute('UPDATE taxonomy_candidates SET id=id WHERE id=?',(candidate_id,))
    row=db.execute('SELECT * FROM taxonomy_candidates WHERE id=?',(candidate_id,)).fetchone()
    if not row or row['state']!='pending' or row['tag_id'] is None: return False
    evidence=json.loads(row['evidence']);model=evidence.get('model')
    # Omni outputs only observed label presence; never use its self-reported confidence.
    score=evidence.get('cosine') if row['kind']=='fast' else 1. if row['kind']=='omni' else None
    if type(score) not in (int,float) or not math.isfinite(score) or not isinstance(model,str) or not model.strip(): return False
    node=tx.get_node(db,row['tag_id'])
    if node['status']!='active': return False
    revision=review.digest(tx.recognition_description(db,node))
    profile=db.execute("SELECT * FROM taxonomy_validation_profiles WHERE kind='association' AND enabled=1 AND model_key=? AND tag_id=? AND recognition_revision=? AND threshold<=? ORDER BY id DESC LIMIT 1",
                       (model,row['tag_id'],revision,score)).fetchone()
    if not profile: return False
    review.validate_candidate(db,row)
    from .taxonomy_plans import snapshot
    scope=[row['tag_id']]
    context={'scope':scope,'media_ids':[row['media_id']],'dependency_aliases':[]}
    with tx._savepoint(db):
        before=snapshot(db,context)
        if tx.add_automatic(db,row['media_id'],row['tag_id'],row['kind'],validated=True,evidence=evidence):
            db.execute("UPDATE taxonomy_candidates SET state='automatic' WHERE id=?",(row['id'],))
            after=snapshot(db,context)
            _record_change(db,'association_auto',scope,before,after,context)
            from ..blueprints.analysis import refresh_media_fts
            refresh_media_fts(db,row['media_id'])
            return True
    return False


def _infer(db,node,deadline,cancelled=None):
    from .model_preferences import classification_enabled, OMNI_OFF
    if not classification_enabled(db,'omni'):raise FileNotFoundError(OMNI_OFF)
    from .. import local_vlm
    import urllib.request
    model=get_setting(db,'classification_omni_model','qwen3-omni-30b-a3b')
    candidates=[dict(r) for r in db.execute("SELECT * FROM taxonomy_nodes WHERE status IN ('active','paused') AND id!=?",(node['id'],))]
    # Stable local branch/name retrieval, bounded context, no silent full-library image scan.
    candidates.sort(key=lambda n:(n['parent_id']==node['parent_id'],difflib.SequenceMatcher(None,tx.normalize(node['name']),tx.normalize(n['name'])).ratio()),reverse=True)
    selected=candidates[:48]
    context=[{'id':n['id'],'name':n['name'],'definition':n['definition'],'path':[tx.get_node(db,i)['name'] for i in reversed(tx.ancestors(db,n['id']))]} for n in selected]
    prompt={'task':'仅判断标签词关系，不操作素材或建立概念。返回JSON {"relationships":[{"kind":"alias|near|related|duplicate|parent","target_id":null,"expression":"表达","reason":"依据"}]}。同义只代表同一含义；上下位不能当同义。独立已有节点不能用别名合并。',
            'node':{'id':node['id'],'name':node['name'],'definition':node['definition']},'candidates':context}
    stopped=lambda:time.monotonic()>=deadline or bool(cancelled and cancelled())
    status=local_vlm.acquire_engine(model,background=True,cancelled=stopped)
    try:
        if stopped(): raise InterruptedError('关系整理已暂停')
        body={'model':model,'messages':[{'role':'user','content':json.dumps(prompt,ensure_ascii=False)}],'temperature':0,'max_tokens':1600}
        req=urllib.request.Request(status['base_url']+'/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with local_vlm._no_proxy_opener.open(req,timeout=max(.1,min(120,deadline-time.monotonic()))) as response: result=json.load(response)
        if stopped(): raise InterruptedError('关系整理已暂停')
        content=result['choices'][0]['message']['content'].strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
        return json.loads(content).get('relationships',[]),model
    finally: local_vlm.release_engine()


def control(db,ids,action):
    if action not in ('pause','resume','cancel'): raise tx.Conflict('任务操作无效')
    ids=list(dict.fromkeys(int(value) for value in ids))
    if not ids: raise tx.Conflict('请选择关系任务')
    old=('queued','waiting','running') if action=='pause' else ('paused','waiting','failed','stale') if action=='resume' else ('queued','waiting','running','paused','failed')
    state={'pause':'paused','resume':'queued','cancel':'cancelled'}[action]
    return db.execute("UPDATE taxonomy_relation_jobs SET state=?,lease=NULL,error='',updated_at=datetime('now') WHERE id IN ("+
                      ','.join('?' for _ in ids)+') AND state IN ('+','.join('?' for _ in old)+')',[state,*ids,*old]).rowcount


def _foreground_busy():
    from flask import current_app,has_app_context
    if not has_app_context(): return False
    from .classification_jobs import busy
    return busy(current_app.config['DATABASE'])


def process_next(db,deadline=float('inf'),infer=None,cancelled=None):
    from .model_preferences import classification_enabled, sync_classification_jobs
    if not classification_enabled(db,'omni'):
        with db:sync_classification_jobs(db)
        return False
    if time.monotonic()>=deadline or cancelled and cancelled() or _foreground_busy(): return False
    with db:
        db.execute("UPDATE taxonomy_relation_jobs SET state='queued',lease=NULL,error='上轮中断，已恢复队列',updated_at=datetime('now') "
                   "WHERE state='running' AND (lease IS NULL OR updated_at<=datetime('now',?))",('-'+str(LEASE_SECONDS)+' seconds',))
        row=db.execute("SELECT * FROM taxonomy_relation_jobs WHERE state='queued' ORDER BY id LIMIT 1").fetchone()
        if not row: return False
        token=uuid.uuid4().hex
        if db.execute("UPDATE taxonomy_relation_jobs SET state='running',lease=?,error='',updated_at=datetime('now') WHERE id=? AND state='queued'",(token,row['id'])).rowcount!=1:return False
    def stopped():
        if not classification_enabled(db,'omni'):
            with db:sync_classification_jobs(db)
            return True
        current=db.execute('SELECT state,lease FROM taxonomy_relation_jobs WHERE id=?',(row['id'],)).fetchone()
        return (not current or current['state']!='running' or current['lease']!=token or time.monotonic()>=deadline
                or bool(cancelled and cancelled()) or _foreground_busy())
    try:
        node=tx.get_node(db,row['tag_id'])
        if node['status'] not in ('active','paused') or row['revision']!=_node_revision(db,node):
            with db:db.execute("UPDATE taxonomy_relation_jobs SET state='stale',lease=NULL,updated_at=datetime('now') WHERE id=? AND lease=?",(row['id'],token))
            return True
        if stopped(): raise InterruptedError('关系整理已暂停')
        basis=(get_setting(db,'classification_semantic_revision','0'),get_setting(db,'classification_omni_model','qwen3-omni-30b-a3b'))
        values,model=infer(db,node,deadline) if infer else _infer(db,node,deadline,cancelled=stopped)
        if stopped(): raise InterruptedError('关系整理已暂停')
        if not isinstance(values,list) or not isinstance(model,str) or not model.strip(): raise ValueError('关系模型输出格式无效')
        with db:
            db.execute('UPDATE taxonomy_relation_jobs SET id=id WHERE id=?',(row['id'],))
            current=db.execute('SELECT state,lease FROM taxonomy_relation_jobs WHERE id=?',(row['id'],)).fetchone()
            if current['state']!='running' or current['lease']!=token:return True
            fresh=tx.get_node(db,row['tag_id'])
            fresh_basis=(get_setting(db,'classification_semantic_revision','0'),get_setting(db,'classification_omni_model','qwen3-omni-30b-a3b'))
            if row['revision']!=_node_revision(db,fresh) or basis!=fresh_basis:
                db.execute("UPDATE taxonomy_relation_jobs SET state='stale',lease=NULL,updated_at=datetime('now') WHERE id=?",(row['id'],));return True
            pending=[]
            for v in values[:50]:
                if not isinstance(v,dict):continue
                kind=v.get('kind');target=v.get('target_id');expression=str(v.get('expression','')).strip()[:120]
                if kind not in ('alias','near','related','duplicate','parent'):continue
                if target is not None:
                    try:
                        other=tx.get_node(db,int(target))
                        if other['status'] not in ('active','paused'):continue
                        target=other['id']
                    except (tx.Conflict,TypeError,ValueError):continue
                evidence={'reason':str(v.get('reason',''))[:1000],'model':model,'context_retrieval':'same_branch_and_name_top48'}
                revision=_context(db,node['id'],target)
                key=review.digest([node['id'],target,expression,kind,revision])
                db.execute('INSERT OR IGNORE INTO taxonomy_relation_suggestions(tag_id,target_id,expression,kind,evidence,revision,source_key) VALUES (?,?,?,?,?,?,?)',
                           (node['id'],target,expression,kind,tx._json(evidence),revision,key))
                pending.append(key)
            # Save all suggestions before applying any alias changes the recognition context.
            for key in pending:
                suggestion=db.execute('SELECT * FROM taxonomy_relation_suggestions WHERE source_key=?',(key,)).fetchone()
                kind=suggestion['kind']
                if get_setting(db,'classification_auto_relations_enabled','false')=='true' and kind in ('alias','near','related'):
                    try: apply_suggestion(db,suggestion,automatic=True)
                    except tx.Conflict: pass
            db.execute("UPDATE taxonomy_relation_jobs SET state='done',lease=NULL,error='',updated_at=datetime('now') WHERE id=?",(row['id'],))
    except FileNotFoundError:
        db.rollback()
        with db:db.execute("UPDATE taxonomy_relation_jobs SET state='waiting',lease=NULL,error='等待本地模型或资源',updated_at=datetime('now') WHERE id=? AND lease=?",(row['id'],token))
    except InterruptedError:
        db.rollback()
        foreground=_foreground_busy()
        with db:db.execute("UPDATE taxonomy_relation_jobs SET state=?,lease=NULL,error=?,updated_at=datetime('now') WHERE id=? AND lease=?",
                           ('queued' if foreground else 'paused','等待前台空闲' if foreground else '任务已暂停',row['id'],token))
    except Exception:
        db.rollback()
        with db:db.execute("UPDATE taxonomy_relation_jobs SET state='failed',lease=NULL,error='关系整理失败，可重试',updated_at=datetime('now') WHERE id=? AND lease=?",(row['id'],token))
    return True
