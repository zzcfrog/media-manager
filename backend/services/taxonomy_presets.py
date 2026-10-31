"""Versioned starter vocabulary. It never labels media, queues AI or replaces user trees."""
import hashlib
import json
from pathlib import Path
import re
import uuid

from . import taxonomy as tx

DEFAULT_PATH=Path(__file__).resolve().parents[1]/'resources/default-taxonomy.v1.json'
MARKER='taxonomy_default_preset_v1'


def load_catalog(path=DEFAULT_PATH):
    data=json.loads(Path(path).read_text(encoding='utf-8'))
    validate(data)
    return data


def validate(data):
    if not isinstance(data,dict) or data.get('version')!=1 or not isinstance(data.get('nodes'),list) or not data['nodes']:
        raise tx.Conflict('默认标签预置格式无效')
    seen={};names={};siblings=set();depths={};aliases={}
    for node in data['nodes']:
        if not isinstance(node,dict):raise tx.Conflict('预置节点格式无效')
        key=node.get('key');parent=node.get('parent_key');name=node.get('name')
        if not isinstance(key,str) or not re.fullmatch(r'[a-z0-9_.-]{1,160}',key) or key in seen:
            raise tx.Conflict('预置节点键重复或无效')
        if parent is not None and parent not in seen:raise tx.Conflict('父节点需先定义')
        if not isinstance(name,str) or not name.strip() or len(name)>120:raise tx.Conflict('预置标签名称无效')
        pair=(parent,tx.normalize(name))
        if pair in siblings:raise tx.Conflict('同一路径存在重复标签')
        siblings.add(pair);names.setdefault(tx.normalize(name),set()).add(key)
        for field in ('definition','recognition_text'):
            if not isinstance(node.get(field),str) or not node[field].strip():raise tx.Conflict('预置缺少定义或识别描述')
        values=node.get('aliases',[])
        if not isinstance(values,list) or any(not isinstance(v,str) or not v.strip() or len(v)>120 for v in values):
            raise tx.Conflict('预置同义表达格式无效')
        for value in values:
            normalized=tx.normalize(value)
            if normalized==tx.normalize(name):continue
            if normalized in aliases and aliases[normalized]!=key:raise tx.Conflict('预置别名存在跨概念冲突')
            aliases[normalized]=key
        depths[key]=depths.get(parent,0)+1
        if depths[key]>4:raise tx.Conflict('预置标签最多四级')
        seen[key]=node
    if any(owners-{aliases[word]} for word,owners in names.items() if word in aliases):
        raise tx.Conflict('预置别名占用了其他标签名称')
    parents={n['parent_key'] for n in data['nodes'] if n['parent_key'] is not None}
    return {'nodes':len(seen),'aliases':len(aliases),'leaves':len(seen)-len(parents),'max_depth':max(depths.values()),
            'roots':[n['name'] for n in data['nodes'] if n['parent_key'] is None]}


def _installed(db,digest):
    row=db.execute('SELECT value FROM settings WHERE key=?',(MARKER,)).fetchone()
    if not row:return None
    result=json.loads(row[0])
    if result.get('digest')!=digest:raise tx.Conflict('该版本预置已安装且内容不同，请使用显式更新方案')
    return {**result,'already_installed':True}


def _check_unused(db,ids):
    if not ids:return
    placeholders=','.join('?' for _ in ids)
    # Saved JSON conditions and historical snapshots can contain references without SQL FKs.
    for table in ('taxonomy_collections','taxonomy_plans','taxonomy_changes'):
        if db.execute('SELECT 1 FROM '+table+' LIMIT 1').fetchone():
            raise tx.Conflict('已有图集或变更方案，需要明确处理旧标签引用')
    for table, in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        quoted='"'+table.replace('"','""')+'"'
        for fk in db.execute('PRAGMA foreign_key_list('+quoted+')').fetchall():
            if fk[2] not in ('tags','taxonomy_nodes') or table=='taxonomy_nodes' and fk[3]=='id':continue
            column='"'+fk[3].replace('"','""')+'"'
            if db.execute('SELECT 1 FROM '+quoted+' WHERE '+column+' IN ('+placeholders+') LIMIT 1',ids).fetchone():
                raise tx.Conflict('旧标签仍有引用，未执行移除')
    if db.execute('SELECT 1 FROM taxonomy_candidates WHERE parent_id IN ('+placeholders+') LIMIT 1',ids).fetchone():
        raise tx.Conflict('旧标签仍被父类建议引用')
    if db.execute("SELECT 1 FROM taxonomy_jobs WHERE state IN ('queued','running') LIMIT 1").fetchone():
        raise tx.Conflict('还有分类任务，请先停止任务')


def preview_install(db,data,remove_legacy_ids=()):
    stats=validate(data);digest=hashlib.sha256(tx._json(data).encode()).hexdigest()
    existing=_installed(db,digest)
    if existing:return existing
    ids=sorted(set(int(i) for i in remove_legacy_ids))
    nodes=[dict(r) for r in db.execute('SELECT * FROM taxonomy_nodes')]
    if {n['id'] for n in nodes}!=set(ids) or db.execute('SELECT COUNT(*) FROM tags').fetchone()[0]!=len(ids):
        raise tx.Conflict('已有自定义标签树，不自动覆盖或重复导入')
    if any(not n['legacy'] for n in nodes):raise tx.Conflict('只能显式清理未使用的旧扁平标签')
    _check_unused(db,ids)
    return {**stats,'already_installed':False,'removed_ids':ids,'removed_names':[n['name'] for n in nodes]}


def install(db,data,remove_legacy_ids=()):
    stats=validate(data);digest=hashlib.sha256(tx._json(data).encode()).hexdigest()
    existing=_installed(db,digest)
    if existing:return existing
    ids=sorted(set(int(i) for i in remove_legacy_ids))
    with tx._savepoint(db):
        db.execute('UPDATE settings SET value=value WHERE key=?',(MARKER,))
        existing=_installed(db,digest)
        if existing:return existing
        preview_install(db,data,ids)
        key_to_id={}
        # Insert before deleting the unused old nodes so their IDs are never reassigned.
        for order,node in enumerate(data['nodes']):
            storage=node['name']
            if db.execute('SELECT 1 FROM tags WHERE name=?',(storage,)).fetchone():storage='@taxonomy:'+uuid.uuid4().hex
            tag_id=db.execute('INSERT INTO tags(name) VALUES (?)',(storage,)).lastrowid
            db.execute('INSERT INTO taxonomy_nodes(id,name,normalized,parent_id,definition,recognition_text,sort_order) VALUES (?,?,?,?,?,?,?)',
                       (tag_id,node['name'],tx.normalize(node['name']),key_to_id.get(node['parent_key']),node['definition'],node['recognition_text'],order))
            expressions=set()
            for text in node.get('aliases',[]):
                normalized=tx.normalize(text)
                if normalized==tx.normalize(node['name']) or normalized in expressions:continue
                expressions.add(normalized)
                db.execute("INSERT INTO taxonomy_expressions(tag_id,text,normalized,origin) VALUES (?,?,?,'preset')",
                           (tag_id,text.strip(),normalized))
            key_to_id[node['key']]=tag_id
        if ids:
            placeholders=','.join('?' for _ in ids)
            db.execute('DELETE FROM taxonomy_nodes WHERE id IN ('+placeholders+')',ids)
            db.execute('DELETE FROM tags WHERE id IN ('+placeholders+')',ids)
        result={**stats,'version':data['version'],'digest':digest,'key_to_id':key_to_id,'removed_ids':ids,'already_installed':False}
        db.execute('INSERT INTO settings(key,value) VALUES (?,?)',(MARKER,tx._json(result)))
        tx.touch_semantics(db)
    return result


def ensure_defaults(db,data=None):
    if db.execute('SELECT 1 FROM settings WHERE key=?',(MARKER,)).fetchone() or db.execute('SELECT 1 FROM tags LIMIT 1').fetchone():
        return False
    install(db,data if data is not None else load_catalog())
    return True
