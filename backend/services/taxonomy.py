"""Local taxonomy rules. Callers own transactions; no model or source-file I/O."""
import hashlib
import json
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone


class Conflict(ValueError):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def normalize(value):
    return unicodedata.normalize('NFKC', str(value)).strip().casefold()


# Existing two-column tags/media_tags remain intact. New business columns precede timestamps.
_DEFINITIONS = {
    'taxonomy_nodes': '''id INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
        name TEXT NOT NULL, normalized TEXT NOT NULL, parent_id INTEGER REFERENCES taxonomy_nodes(id),
        definition TEXT NOT NULL DEFAULT '', recognition_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1, legacy INTEGER NOT NULL DEFAULT 0,
        redirect_id INTEGER REFERENCES taxonomy_nodes(id)''',
    'taxonomy_expressions': '''id INTEGER PRIMARY KEY, tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
        text TEXT NOT NULL, normalized TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'alias',
        origin TEXT NOT NULL DEFAULT 'manual', UNIQUE(tag_id,normalized)''',
    'taxonomy_decisions': '''media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
        scope TEXT NOT NULL DEFAULT 'direct', decision TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(media_id,tag_id,scope)''',
    'taxonomy_sources': '''id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
        origin TEXT NOT NULL, source_key TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '{}',
        UNIQUE(media_id,tag_id,source_key)''',
    'taxonomy_candidates': '''id INTEGER PRIMARY KEY, media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES taxonomy_nodes(id), term TEXT NOT NULL, parent_id INTEGER,
        kind TEXT NOT NULL DEFAULT 'association', evidence TEXT NOT NULL DEFAULT '{}',
        source_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'pending', input_revision TEXT NOT NULL DEFAULT '' ''',
    'taxonomy_changes': '''id INTEGER PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL,
        before_state TEXT NOT NULL, after_state TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'applied' ''',
    'taxonomy_plans': '''id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
        before_state TEXT NOT NULL, expires_at TEXT NOT NULL''',
    'taxonomy_analysis_requests': '''media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0''',
    'taxonomy_jobs': '''id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        stage TEXT NOT NULL, input_revision TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
        priority INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        lease TEXT, lease_until REAL, error TEXT NOT NULL DEFAULT '',
        UNIQUE(media_id,stage,input_revision)''',
    'taxonomy_features': '''media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        model_key TEXT NOT NULL, input_revision TEXT NOT NULL, dimension INTEGER NOT NULL,
        vector BLOB NOT NULL, PRIMARY KEY(media_id,model_key)''',
    'taxonomy_text_features': '''tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
        model_key TEXT NOT NULL, text_revision TEXT NOT NULL, dimension INTEGER NOT NULL,
        vector BLOB NOT NULL, PRIMARY KEY(tag_id,model_key)''',
    'taxonomy_collections': '''id INTEGER PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'active' ''',
    'taxonomy_examples': '''tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('positive','negative')), input_revision TEXT NOT NULL,
        PRIMARY KEY(tag_id,media_id)''',
}
from .taxonomy_review import DEFINITIONS as _REVIEW_DEFINITIONS
_DEFINITIONS.update(_REVIEW_DEFINITIONS)
from .taxonomy_relations import DEFINITIONS as _RELATION_DEFINITIONS
_DEFINITIONS.update(_RELATION_DEFINITIONS)
TABLES = tuple(_DEFINITIONS)


def init_schema(db):
    # Constraints must come after timestamps in CREATE TABLE, while column order stays fixed.
    for table, definition in _DEFINITIONS.items():
        columns, constraints = definition, ''
        parts = re.split(r',\s*(?=(?:UNIQUE|PRIMARY KEY)\()', definition, maxsplit=1)
        columns = parts[0]
        constraints = ',' + parts[1] if len(parts) > 1 else ''
        db.execute(f'CREATE TABLE IF NOT EXISTS {table} ({columns},'
                   "created_at TEXT NOT NULL DEFAULT (datetime('now')),"
                   "updated_at TEXT NOT NULL DEFAULT (datetime('now'))" + constraints + ')')
    db.execute('CREATE INDEX IF NOT EXISTS idx_media_tags_concept ON media_tags(tag_id,media_id)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_taxonomy_parent ON taxonomy_nodes(parent_id,status)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_taxonomy_expression ON taxonomy_expressions(normalized)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_taxonomy_candidate_state ON taxonomy_candidates(state,tag_id)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_taxonomy_job_state ON taxonomy_jobs(state,priority,id)')
    for row in db.execute('SELECT t.id,t.name FROM tags t LEFT JOIN taxonomy_nodes n ON n.id=t.id WHERE n.id IS NULL').fetchall():
        db.execute('INSERT INTO taxonomy_nodes(id,name,normalized,legacy) VALUES (?,?,?,1)',(row[0],row[1],normalize(row[1])))
    db.execute("UPDATE taxonomy_nodes SET recognition_text=CASE WHEN definition!='' THEN definition ELSE name END WHERE recognition_text=''")
    db.execute("INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) "
               "SELECT media_id,tag_id,'legacy_unknown','legacy','{\"original_provenance\":\"unknown\"}' FROM media_tags mt WHERE NOT EXISTS (SELECT 1 FROM taxonomy_sources s WHERE s.media_id=mt.media_id AND s.tag_id=mt.tag_id)")


def _ensure_node(db, tag_id):
    db.execute('INSERT OR IGNORE INTO taxonomy_nodes(id,name,normalized,legacy) '
               'SELECT id,name,lower(name),1 FROM tags WHERE id=?', (tag_id,))
    db.execute("UPDATE taxonomy_nodes SET recognition_text=CASE WHEN definition!='' THEN definition ELSE name END WHERE id=? AND recognition_text=''",(tag_id,))
    return get_node(db, tag_id)


def get_node(db, tag_id, redirect=False):
    row = db.execute('SELECT * FROM taxonomy_nodes WHERE id=?', (tag_id,)).fetchone()
    if not row:
        old = db.execute('SELECT id,name FROM tags WHERE id=?', (tag_id,)).fetchone()
        if not old:
            raise Conflict('标签不存在')
        return dict(old, parent_id=None, version=0, status='active', legacy=1)
    value = dict(row)
    if redirect and value['redirect_id']:
        return get_node(db, value['redirect_id'], redirect=True)
    return value


def descendants(db, tag_id):
    _ = get_node(db, tag_id)
    return [r[0] for r in db.execute('WITH RECURSIVE tree(id) AS (SELECT ? UNION '
            'SELECT n.id FROM taxonomy_nodes n JOIN tree t ON n.parent_id=t.id) SELECT id FROM tree', (tag_id,))]


def ancestors(db, tag_id):
    result, seen = [], set()
    while tag_id is not None:
        if tag_id in seen:
            raise Conflict('标签树存在循环')
        seen.add(tag_id)
        n = get_node(db, tag_id)
        result.append(n['id'])
        tag_id = n['parent_id']
    return result


def _validate_parent(db, tag_id, parent_id):
    if parent_id is not None:
        parent = get_node(db, parent_id)
        if parent['status'] != 'active':
            raise Conflict('父标签不可用于新节点')
        if tag_id in ancestors(db, parent_id):
            raise Conflict('不能将标签移动到自身或后代')
    depth = len(ancestors(db, parent_id)) if parent_id is not None else 0
    height = 1
    if tag_id is not None:
        for child in descendants(db, tag_id):
            height = max(height, ancestors(db, child).index(tag_id)+1)
    if depth + height > 4:
        raise Conflict('标签最多四级')


def create_node(db, name, parent_id=None, definition='', recognition_text=''):
    name = str(name).strip()
    if not name or len(name) > 120:
        raise Conflict('标签名称需为 1～120 字')
    _validate_parent(db, None, parent_id)
    if db.execute('SELECT 1 FROM taxonomy_nodes WHERE normalized=? AND parent_id IS ? AND status!=?',
                  (normalize(name), parent_id, 'merged')).fetchone():
        raise Conflict('此路径已有同名标签')
    storage = name
    if db.execute('SELECT 1 FROM tags WHERE name=?', (storage,)).fetchone():
        storage = '@taxonomy:' + uuid.uuid4().hex
    tag_id = db.execute('INSERT INTO tags(name) VALUES (?)', (storage,)).lastrowid
    db.execute('INSERT INTO taxonomy_nodes(id,name,normalized,parent_id,definition,recognition_text) VALUES (?,?,?,?,?,?)',
               (tag_id, name, normalize(name), parent_id, definition, recognition_text or definition or name))
    touch_semantics(db)
    from .taxonomy_relations import queue
    queue(db,tag_id)
    return get_node(db, tag_id)


def update_node(db, tag_id, data, expected_version):
    node = _ensure_node(db, tag_id)
    old_description=recognition_description(db,node)
    if expected_version != node['version']:
        raise Conflict('标签已更新，请刷新后重试')
    fields = {k: data[k] for k in ('name','parent_id','definition','recognition_text','sort_order','status') if k in data}
    if 'name' in fields:
        fields['name'] = str(fields['name']).strip()
        if not fields['name'] or len(fields['name']) > 120:
            raise Conflict('标签名称需为 1～120 字')
        fields['normalized'] = normalize(fields['name'])
    if 'status' in fields and fields['status'] not in ('active','paused','inactive'):
        raise Conflict('标签状态无效')
    if 'parent_id' in fields and fields['parent_id']!=node['parent_id']:
        affected=set(descendants(db,tag_id)+ancestors(db,tag_id))
        if fields['parent_id'] is not None: affected.update(ancestors(db,fields['parent_id']))
        if db.execute("SELECT 1 FROM taxonomy_decisions WHERE scope='subtree' AND decision='exclude' AND tag_id IN ("+
                      ','.join('?' for _ in affected)+')',list(affected)).fetchone():
            raise Conflict('移动会改变子树排除范围，请先明确处理相关排除')
    _validate_parent(db, tag_id, fields.get('parent_id', node['parent_id']))
    if db.execute('SELECT 1 FROM taxonomy_nodes WHERE id!=? AND normalized=? AND parent_id IS ? AND status!=?',
                  (tag_id, fields.get('normalized',node['normalized']),fields.get('parent_id',node['parent_id']),'merged')).fetchone():
        raise Conflict('此路径已有同名标签')
    if fields:
        db.execute('UPDATE taxonomy_nodes SET '+','.join(k+'=?' for k in fields)+
                   ",version=version+1,updated_at=datetime('now') WHERE id=?",[*fields.values(),tag_id])
    updated=get_node(db,tag_id)
    if old_description!=recognition_description(db,updated) or node['status']!=updated['status']:
        touch_semantics(db)
        from .taxonomy_relations import queue
        queue(db,tag_id)
    if fields: touch_labels(db)
    return updated


def resolve(db, text):
    key = normalize(text)
    rows = db.execute('SELECT id FROM taxonomy_nodes WHERE normalized=? UNION SELECT tag_id FROM '
                      'taxonomy_expressions WHERE normalized=?', (key,key)).fetchall()
    ids = {get_node(db,r[0],redirect=True)['id'] for r in rows}
    return [with_split_info(db,get_node(db,i)) for i in sorted(ids) if get_node(db,i)['status'] in ('active','paused')]


def add_expression(db, tag_id, text, origin='manual'):
    _ensure_node(db, tag_id)
    if not normalize(text):
        raise Conflict('别名不能为空')
    db.execute('INSERT OR IGNORE INTO taxonomy_expressions(tag_id,text,normalized,origin) VALUES (?,?,?,?)',
               (tag_id,str(text).strip(),normalize(text),origin))
    db.execute('UPDATE taxonomy_nodes SET version=version+1 WHERE id=?',(tag_id,))
    touch_semantics(db)


def tag_rows(db, media_id):
    # Legacy FTS rebuild runs before the classification schema has been installed.
    installed=db.execute("SELECT 1 FROM sqlite_master WHERE name='taxonomy_nodes' AND type='table'").fetchone()
    if not installed:
        return [dict(r) for r in db.execute('SELECT t.id,t.name FROM tags t JOIN media_tags mt ON mt.tag_id=t.id WHERE mt.media_id=?',(media_id,))]
    return [dict(r) for r in db.execute('SELECT t.id,COALESCE(n.name,t.name) name FROM tags t '
            'JOIN media_tags mt ON mt.tag_id=t.id LEFT JOIN taxonomy_nodes n ON n.id=t.id '
            'WHERE mt.media_id=? ORDER BY name,t.id',(media_id,))]


def summaries(db, media_ids):
    result = {int(i):0 for i in media_ids}
    ids = list(result)
    for start in range(0,len(ids),400):
        chunk=ids[start:start+400]
        for row in db.execute('SELECT media_id,COUNT(*) n FROM media_tags WHERE media_id IN ('+
                              ','.join('?' for _ in chunk)+') GROUP BY media_id',chunk):
            result[row['media_id']]=row['n']
    return result


def _blocked(db, media_id, tag_id):
    parents = ancestors(db,tag_id)
    return bool(db.execute('SELECT 1 FROM taxonomy_decisions WHERE media_id=? AND decision=\'exclude\' AND '
            '(tag_id=? OR (scope=\'subtree\' AND tag_id IN ('+','.join('?' for _ in parents)+')))',
            [media_id,tag_id,*parents]).fetchone())


def decide(db, media_ids, tag_id, decision, scope='direct', clear_exclusion=False):
    _ensure_node(db,tag_id)
    tag_id = get_node(db,tag_id,redirect=True)['id']
    if decision not in ('confirm','exclude','remove') or scope not in ('direct','subtree'):
        raise Conflict('标签决定无效')
    ids = list(dict.fromkeys(int(i) for i in media_ids))
    # Validate the whole batch before touching any row.
    for mid in ids:
        if not db.execute('SELECT 1 FROM media WHERE id=?',(mid,)).fetchone():
            raise Conflict('部分素材已被移除')
        if decision == 'confirm' and _blocked(db,mid,tag_id) and not clear_exclusion:
            raise Conflict('命中人工排除，请明确解除后再添加')
    for mid in ids:
        if decision == 'confirm' and clear_exclusion:
            parents=ancestors(db,tag_id)
            db.execute('DELETE FROM taxonomy_decisions WHERE media_id=? AND decision=\'exclude\' AND '
                       '(tag_id=? OR (scope=\'subtree\' AND tag_id IN ('+','.join('?' for _ in parents)+')))',[mid,tag_id,*parents])
        previous=[dict(r) for r in db.execute('SELECT tag_id,scope,decision,version FROM taxonomy_decisions WHERE media_id=? AND tag_id=?',(mid,tag_id))]
        actual='exclude' if decision=='remove' else decision
        db.execute('INSERT INTO taxonomy_decisions(media_id,tag_id,scope,decision) VALUES (?,?,?,?) '
                   "ON CONFLICT(media_id,tag_id,scope) DO UPDATE SET decision=excluded.decision,version=version+1,updated_at=datetime('now')",
                   (mid,tag_id,scope,actual))
        db.execute('INSERT INTO taxonomy_decision_events(media_id,tag_id,action,scope,previous,current) VALUES (?,?,?,?,?,?)',
                   (mid,tag_id,decision,scope,_json(previous),_json({'decision':actual,'scope':scope})))
        if decision=='confirm':
            db.execute('INSERT OR IGNORE INTO media_tags VALUES (?,?)',(mid,tag_id))
            db.execute('INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?)',
                       (mid,tag_id,'manual','manual',_json({'decision':'confirm'})))
        else:
            targets=descendants(db,tag_id) if scope=='subtree' else [tag_id]
            db.execute('DELETE FROM media_tags WHERE media_id=? AND tag_id IN ('+','.join('?' for _ in targets)+')',[mid,*targets])
        from ..blueprints.analysis import refresh_media_fts
        refresh_media_fts(db,mid)
    touch_labels(db)


def add_automatic(db, media_id, tag_id, origin, validated=False, evidence=None):
    n=_ensure_node(db,tag_id)
    if not validated or n['status']!='active' or _blocked(db,media_id,tag_id):
        return False
    db.execute('INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?)',
               (media_id,tag_id,origin,origin,_json(evidence or {})))
    db.execute('INSERT OR IGNORE INTO media_tags VALUES (?,?)',(media_id,tag_id))
    touch_labels(db)
    return True


def filter_sql(db, positive, negative=(), mode='any', include_children=True):
    if mode not in ('any','all'):
        raise Conflict('标签组合必须为 any 或 all')
    clauses,params=[],[]
    for sign,values in ((True,positive),(False,negative)):
        group=[]
        for value in dict.fromkeys(values):
            tag_id=get_node(db,int(value),redirect=True)['id']
            targets=descendants(db,tag_id) if include_children else [tag_id]
            group.append('media.id IN (SELECT media_id FROM media_tags WHERE tag_id IN ('+
                         ','.join('?' for _ in targets)+'))')
            params.extend(targets)
        if group:
            operator=' AND ' if sign and mode=='all' else ' OR '
            clauses.append(('' if sign else 'NOT ')+'('+operator.join(group)+')')
    return ' AND '.join(clauses),params


_STATE_TABLES={'taxonomy_nodes':'id','taxonomy_expressions':'tag_id','taxonomy_decisions':'tag_id',
               'taxonomy_sources':'tag_id','media_tags':'tag_id','taxonomy_examples':'tag_id',
               'taxonomy_relations':'source_id','taxonomy_relation_locks':'tag_id','taxonomy_split_targets':'source_id',
               'taxonomy_relation_suggestions':'tag_id'}


def _snapshot(db, scope):
    result={}
    for table,column in _STATE_TABLES.items():
        predicate,params=_scope_predicate(table,column,scope)
        result[table]=[dict(r) for r in db.execute(f'SELECT * FROM {table} WHERE '+predicate+
                  ' ORDER BY '+('media_id,tag_id' if table=='media_tags' else 'rowid'),params)]
    members={r['media_id'] for r in result['media_tags']}
    result['_media_revisions']=[(mid,input_revision(db,mid,'image')) for mid in sorted(members)]
    result['_children']=[list(r) for r in db.execute('SELECT id,parent_id FROM taxonomy_nodes WHERE parent_id IN ('+
            ','.join('?' for _ in scope)+') ORDER BY id',scope)]
    return result


def _store_plan(db,kind,payload,scope):
    payload['scope']=scope
    state=_snapshot(db,scope)
    token=uuid.uuid4().hex
    db.execute('INSERT INTO taxonomy_plans(id,kind,payload,before_state,expires_at) VALUES (?,?,?,?,?)',
               (token,kind,_json(payload),_json(state),(datetime.now(timezone.utc)+timedelta(minutes=20)).isoformat()))
    affected=payload['sources']+[payload['target']] if kind=='merge' else [payload['source']]
    media=[dict(r) for r in db.execute('SELECT DISTINCT m.id,m.file_name FROM media m JOIN media_tags mt ON mt.media_id=m.id WHERE mt.tag_id IN ('+
           ','.join('?' for _ in affected)+') ORDER BY m.id',affected)]
    return {'id':token,'kind':kind,'media_count':len(media),'media_items':media,'scope':scope,'payload':payload}


def preview_merge(db, source_ids, target_id):
    sources=list(dict.fromkeys(int(i) for i in source_ids))
    target=_ensure_node(db,int(target_id))
    if target['status'] not in ('active','paused'): raise Conflict('目标标签不可用')
    if not sources or target['id'] in sources:
        raise Conflict('请选择不同的来源与目标标签')
    _check_merge_scope(db,sources,target['id'])
    scope=set(descendants(db,target['id']))
    for source in sources:
        if _ensure_node(db,source)['status'] not in ('active','paused'): raise Conflict('来源标签不可用')
        if target['id'] in descendants(db,source):
            raise Conflict('不能合并到来源的后代')
        scope.update(descendants(db,source))
    for tag_id in list(scope): scope.update(ancestors(db,tag_id))
    return _store_plan(db,'merge',{'sources':sources,'target':target['id']},sorted(scope))


def preview_split(db, source_id, assignments):
    _ensure_node(db,source_id)
    allowed={r[0] for r in db.execute('SELECT media_id FROM media_tags WHERE tag_id=?',(source_id,))}
    clean={}
    scope=set(descendants(db,source_id))
    for mid,targets in assignments.items():
        mid=int(mid)
        if mid not in allowed: raise Conflict('分配包含不属于原标签的素材')
        values=list(dict.fromkeys(int(t) for t in targets))
        if source_id in values: raise Conflict('拆分目标不能是原标签')
        for target in values:
            _ensure_node(db,target)
            if _blocked(db,mid,target): raise Conflict('拆分命中人工排除')
            scope.add(target)
        if values: clean[str(mid)]=values
    if not clean: raise Conflict('请选择至少一项明确分配')
    for tag_id in list(scope): scope.update(ancestors(db,tag_id))
    return _store_plan(db,'split',{'source':source_id,'assignments':clean},sorted(scope))


def apply_plan(db, plan):
    db.execute('UPDATE taxonomy_plans SET id=id WHERE id=?',(plan['id'],))
    row=db.execute('SELECT * FROM taxonomy_plans WHERE id=?',(plan['id'],)).fetchone()
    if not row or datetime.fromisoformat(row['expires_at'])<datetime.now(timezone.utc):
        raise Conflict('方案已过期，请重新预览')
    payload=json.loads(row['payload']);scope=payload['scope']
    from . import taxonomy_plans
    reviewed=payload.get('engine')==taxonomy_plans.ENGINE
    snapshot_fn=(lambda:taxonomy_plans.snapshot(db,payload)) if reviewed else (lambda:_snapshot(db,scope))
    before=snapshot_fn()
    if _json(before)!=row['before_state']: raise Conflict('范围内标签或人工决定已改变，请重新预览')
    with _savepoint(db):
        change_id=db.execute('INSERT INTO taxonomy_changes(kind,scope,before_state,after_state) VALUES (?,?,?,?)',
            (row['kind'],_json(scope),_json(before),'{}')).lastrowid
        if reviewed:
            result=taxonomy_plans.execute(db,row['kind'],payload) or {}
        elif row['kind']=='merge':
            # Older still-valid previews use the same reviewed rule engine for execution.
            checked=taxonomy_plans.preview_merge(db,payload['sources'],payload['target'])
            if checked['conflicts']:raise Conflict('需要重新查看并解决合并冲突')
            taxonomy_plans.execute(db,'merge',checked['payload']);result={}
        elif row['kind']=='split':
            checked=taxonomy_plans.preview_split(db,payload['source'],payload['assignments'])
            if checked['conflicts']:raise Conflict('需要重新查看并解决拆分冲突')
            taxonomy_plans.execute(db,'split',checked['payload']);result={}
        else: raise Conflict('未知方案类型')
        created=result.get('created_node_ids',[])
        scope=sorted(set(scope+created));payload['scope']=scope
        if row['kind']=='split':
            target_ids={int(t) for targets in payload['assignments'].values() for t in targets if int(t)>0}
            target_ids.update(result.get('resolved_target_ids',[]))
            for target in target_ids:
                db.execute('INSERT OR IGNORE INTO taxonomy_split_targets(source_id,target_id,change_id) VALUES (?,?,?)',
                           (payload['source'],target,change_id))
        after=taxonomy_plans.snapshot(db,payload) if reviewed else _snapshot(db,scope)
        if reviewed:
            context={k:payload[k] for k in ('scope','media_ids','dependency_aliases') if k in payload}
            before['_plan_context']=context;after['_plan_context']=context
        before['_created_node_ids']=created;after['_created_node_ids']=created
        db.execute('UPDATE taxonomy_changes SET scope=?,before_state=?,after_state=? WHERE id=?',
                   (_json(scope),_json(before),_json(after),change_id))
        db.execute('DELETE FROM taxonomy_plans WHERE id=?',(row['id'],))
        touch_semantics(db)
        _refresh_members(db,before,after)
    return {'change_id':change_id,'created_node_ids':created}


class _savepoint:
    def __init__(self,db): self.db=db; self.name='tx_'+uuid.uuid4().hex
    def __enter__(self): self.db.execute('SAVEPOINT '+self.name)
    def __exit__(self,kind,value,tb):
        if kind: self.db.execute('ROLLBACK TO '+self.name)
        self.db.execute('RELEASE '+self.name)


def _refresh_members(db,*states):
    from ..blueprints.analysis import refresh_media_fts
    for mid in {r['media_id'] for state in states for r in state['media_tags']}:
        refresh_media_fts(db,mid)


def undo(db,change_id):
    db.execute('UPDATE taxonomy_changes SET id=id WHERE id=?',(change_id,))
    row=db.execute('SELECT * FROM taxonomy_changes WHERE id=?',(change_id,)).fetchone()
    if not row or row['state']!='applied': raise Conflict('变更不可撤销')
    scope=json.loads(row['scope']);after=json.loads(row['after_state']);before=json.loads(row['before_state'])
    context=after.get('_plan_context')
    if context:
        from .taxonomy_plans import snapshot
        current=snapshot(db,context);current['_plan_context']=context
    else:current=_snapshot(db,scope)
    current['_created_node_ids']=after.get('_created_node_ids',[])
    if _json(current)!=row['after_state']: raise Conflict('有后续编辑，无法直接撤销')
    with _savepoint(db):
        for table,column in _STATE_TABLES.items():
            if table!='taxonomy_nodes':
                predicate,params=_scope_predicate(table,column,scope)
                db.execute(f'DELETE FROM {table} WHERE '+predicate,params)
            for data in before[table]:
                names=list(data)
                if table=='taxonomy_nodes':
                    db.execute('UPDATE taxonomy_nodes SET '+','.join(k+'=?' for k in names if k!='id')+' WHERE id=?',
                               [data[k] for k in names if k!='id']+[data['id']])
                else:db.execute(f'INSERT INTO {table} ('+','.join(names)+') VALUES ('+','.join('?' for _ in names)+')',list(data.values()))
        for tag_id in after.get('_created_node_ids',[]):
            db.execute("UPDATE taxonomy_nodes SET status='inactive',parent_id=NULL,version=version+1 WHERE id=?",(tag_id,))
        db.execute("UPDATE taxonomy_changes SET state='undone',updated_at=datetime('now') WHERE id=?",(change_id,))
        touch_semantics(db)
        _refresh_members(db,before,current)


def _scope_predicate(table,column,scope):
    placeholders=','.join('?' for _ in scope)
    predicate=f'{column} IN ('+placeholders+')';params=list(scope)
    if table in ('taxonomy_relations','taxonomy_split_targets','taxonomy_relation_suggestions'):
        predicate+=' OR target_id IN ('+placeholders+')';params+=scope
    return predicate,params


_QUERY_KEYS={'tag_ids','exclude_tag_ids','tag_mode','include_children','q','folder','media_type','favorite','rating','sort','order'}


def validate_query(db, query):
    if not isinstance(query,dict) or set(query)-_QUERY_KEYS:
        raise Conflict('图集包含不支持的条件，需要调整')
    for key in ('q','folder'):
        if key in query and (not isinstance(query[key],str) or len(query[key])>4096):
            raise Conflict('图集文字条件无效')
    allowed={'media_type':{'all','image','video','audio'},'favorite':{'true','false'},
             'sort':{'imported_at','date_taken','rating','file_name','file_size','duration','resolution'},
             'order':{'asc','desc'}}
    for key,values in allowed.items():
        if key in query and (not isinstance(query[key],str) or query[key] not in values):
            raise Conflict('图集条件无效：'+key)
    if 'rating' in query and (type(query['rating']) is not int or not 0<=query['rating']<=5):
        raise Conflict('图集评分条件无效')
    if 'include_children' in query and type(query['include_children']) is not bool:
        raise Conflict('图集子级条件无效')
    for key in ('tag_ids','exclude_tag_ids'):
        if key in query:
            if not isinstance(query[key],list): raise Conflict('标签条件无效')
            for value in query[key]:
                if type(value) is not int or value<=0: raise Conflict('图集标签 ID 无效')
                n=get_node(db,value)
                if n['status']=='inactive' or db.execute("SELECT 1 FROM taxonomy_split_targets st JOIN taxonomy_changes c ON c.id=st.change_id WHERE st.source_id=? AND c.state='applied'",(n['id'],)).fetchone(): raise Conflict('图集标签已停用或拆分，需要调整')
    if query.get('tag_mode','any') not in ('any','all'): raise Conflict('图集组合条件无效')
    return query


def save_collection(db,name,query):
    validate_query(db,query)
    if not str(name).strip(): raise Conflict('图集名称不能为空')
    collection_id=db.execute('INSERT INTO taxonomy_collections(name,query) VALUES (?,?)',(str(name).strip(),_json(query))).lastrowid
    return {'id':collection_id,'name':name,'query':query}


def collection_query(db,collection_id):
    row=db.execute('SELECT query FROM taxonomy_collections WHERE id=?',(collection_id,)).fetchone()
    if not row: raise Conflict('图集不存在')
    return validate_query(db,json.loads(row['query']))


def input_revision(db,media_id,stage='fast'):
    row=db.execute('SELECT thumbnail_path,file_size,file_mtime,analysis_date FROM media WHERE id=?',(media_id,)).fetchone()
    if not row: raise Conflict('素材已被移除')
    parts=_image_revision_parts(row)
    if stage=='analysis':
        parts += [list(r) for r in db.execute('SELECT id,main_subjects,scene_type,lighting,weather,time_start,time_end FROM media_segment WHERE media_id=? ORDER BY seq,id',(media_id,))]
    return hashlib.sha256(_json(parts).encode()).hexdigest()


def _image_revision_parts(row):
    parts=[row['thumbnail_path'],row['file_size'],row['file_mtime']]
    from ..config import THUMB_DIR
    preview=THUMB_DIR/(row['thumbnail_path'] or '')
    if preview.is_file():
        stat=preview.stat();parts.extend([stat.st_size,stat.st_mtime_ns])
    return parts


def example_candidates(db,tag_id,media_ids):
    import numpy as np
    node=get_node(db,tag_id)
    examples=[dict(r) for r in db.execute('SELECT * FROM taxonomy_examples WHERE tag_id=?',(tag_id,))]
    positives=[e for e in examples if e['role']=='positive']
    if not positives: raise Conflict('请先设置至少一个正例')
    for example in examples:
        if example['input_revision']!=input_revision(db,example['media_id'],'image'):
            raise Conflict('例图已变化，请重新确认例图')
    def features(mid):
        return {r['model_key']:r for r in db.execute('SELECT * FROM taxonomy_features WHERE media_id=? AND input_revision=?',
                (mid,input_revision(db,mid,'image')))}
    existing={e['media_id']:features(e['media_id']) for e in examples}
    common=set.intersection(*(set(existing[e['media_id']]) for e in examples))
    if not common: raise Conflict('例图缺少相同模型的有效特征，请先运行本地快速分类')
    key=sorted(common)[0]
    def vector(row):
        value=np.frombuffer(row['vector'],dtype=np.float32)
        if len(value)!=row['dimension'] or not np.all(np.isfinite(value)): raise Conflict('语义特征无效')
        return value
    pos=[vector(existing[e['media_id']][key]) for e in positives]
    neg=[vector(existing[e['media_id']][key]) for e in examples if e['role']=='negative']
    text=db.execute('SELECT * FROM taxonomy_text_features WHERE tag_id=? AND model_key=? AND text_revision=?',
        (tag_id,key,hashlib.sha256(recognition_description(db,node).encode()).hexdigest())).fetchone()
    text_vector=vector(text) if text else None
    parents=ancestors(db,tag_id)
    blocked={r[0] for r in db.execute("SELECT media_id FROM taxonomy_decisions WHERE decision='exclude' AND (tag_id=? OR (scope='subtree' AND tag_id IN ("+
        ','.join('?' for _ in parents)+')))',[tag_id,*parents])}
    blocked.update(r[0] for r in db.execute('SELECT media_id FROM media_tags WHERE tag_id=?',(tag_id,)))
    ids=[i for i in dict.fromkeys(int(i) for i in media_ids) if i not in blocked]
    result=[];missing=0
    for start in range(0,len(ids),400):
        chunk=ids[start:start+400]
        rows=db.execute('SELECT m.id,m.thumbnail_path,m.file_size,m.file_mtime,f.input_revision,f.dimension,f.vector '
            'FROM media m LEFT JOIN taxonomy_features f ON f.media_id=m.id AND f.model_key=? WHERE m.id IN ('+
            ','.join('?' for _ in chunk)+')',[key,*chunk]).fetchall()
        vectors=[];members=[]
        for row in rows:
            revision=hashlib.sha256(_json(_image_revision_parts(row)).encode()).hexdigest()
            if row['vector'] is None or row['input_revision']!=revision:missing+=1;continue
            value=vector(row)
            if value.shape!=pos[0].shape:raise Conflict('例图与候选的语义维度不一致')
            vectors.append(value);members.append(row['id'])
        if not vectors:continue
        matrix=np.stack(vectors)
        scores=(matrix@np.stack(pos).T).max(axis=1)
        negatives=(matrix@np.stack(neg).T).max(axis=1) if neg else np.full(len(members),-1.)
        text_scores=matrix@text_vector if text_vector is not None else None
        for i,mid in enumerate(members):
            rank=float(scores[i]-max(0.,negatives[i]))
            if text_scores is not None:rank=(rank+float(text_scores[i]))/2
            result.append({'media_id':mid,'score':float(scores[i]),'negative_similarity':float(negatives[i]),'rank':rank,
                           'definition_similarity':float(text_scores[i]) if text_scores is not None else None})
        result=sorted(result,key=lambda r:(-r['rank'],r['media_id']))[:200]
    return {'data':result,'missing_features':missing,'model_key':key,'definition_used':text_vector is not None}


def example_revision(db,tag_id):
    node=get_node(db,tag_id)
    examples=[dict(r) for r in db.execute('SELECT * FROM taxonomy_examples WHERE tag_id=? ORDER BY media_id',(tag_id,))]
    return hashlib.sha256(_json([node['version'],examples]).encode()).hexdigest()


def _check_merge_scope(db,sources,target):
    values=[*sources,target]
    if db.execute("SELECT 1 FROM taxonomy_decisions WHERE scope='subtree' AND decision='exclude' AND tag_id IN ("+
                  ','.join('?' for _ in values)+')',values).fetchone():
        raise Conflict('合并涉及子树排除范围变化，请先在人工决定中明确处理范围')


def recognition_description(db,node):
    parts=[]
    for parent_id in reversed(ancestors(db,node['id'])):
        current=get_node(db,parent_id)
        parts.append(current.get('recognition_text') or current.get('definition') or current['name'])
    if node.get('definition'): parts.append(node['definition'])
    parts.extend(r[0] for r in db.execute('SELECT text FROM taxonomy_expressions WHERE tag_id=? ORDER BY normalized',(node['id'],)))
    return '；'.join(dict.fromkeys(p for p in parts if p))


def touch_semantics(db):
    db.execute("INSERT INTO settings(key,value) VALUES ('classification_semantic_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1")
    touch_labels(db)


def touch_events(db):
    db.execute("INSERT INTO settings(key,value) VALUES ('classification_event_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1")


def touch_labels(db):
    db.execute("INSERT INTO settings(key,value) VALUES ('classification_label_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1")
    touch_events(db)


def with_split_info(db,node):
    targets=[dict(r) for r in db.execute("SELECT DISTINCT n.id,n.name FROM taxonomy_split_targets st JOIN taxonomy_changes c ON c.id=st.change_id JOIN taxonomy_nodes n ON n.id=st.target_id WHERE st.source_id=? AND c.state='applied'",(node['id'],))]
    if targets:
        for target in targets:target['path']=' / '.join(get_node(db,i)['name'] for i in reversed(ancestors(db,target['id'])))
        values=descendants(db,node['id'])
        node={**node,'split_targets':targets,'remaining_count':db.execute('SELECT COUNT(DISTINCT media_id) FROM media_tags WHERE tag_id IN ('+','.join('?' for _ in values)+')',values).fetchone()[0]}
    return node
