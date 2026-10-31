"""Versioned review context, evidence and paged candidate groups."""
import hashlib
import json
from . import taxonomy as tx

DEFINITIONS = {
    'taxonomy_analysis_batches': '''media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL''',
    'taxonomy_candidate_context': '''candidate_id INTEGER PRIMARY KEY REFERENCES taxonomy_candidates(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL, meaning_key TEXT NOT NULL, group_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL, context TEXT NOT NULL''',
    'taxonomy_job_context': '''job_id INTEGER PRIMARY KEY REFERENCES taxonomy_jobs(id) ON DELETE CASCADE,
        batch_id TEXT NOT NULL, matching_key TEXT NOT NULL, basis TEXT NOT NULL''',
    'taxonomy_historical_snapshots': '''id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES taxonomy_jobs(id) ON DELETE CASCADE,
        source_revision TEXT NOT NULL, original_provenance TEXT NOT NULL DEFAULT 'unknown',
        fields TEXT NOT NULL, UNIQUE(job_id,source_revision)''',
    'taxonomy_field_provenance': '''segment_id INTEGER NOT NULL REFERENCES media_segment(id) ON DELETE CASCADE,
        field TEXT NOT NULL, value_hash TEXT NOT NULL, origin TEXT NOT NULL, PRIMARY KEY(segment_id,field)''',
    'taxonomy_decision_events': '''id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id), action TEXT NOT NULL, scope TEXT NOT NULL,
        previous TEXT NOT NULL, current TEXT NOT NULL''',
    'taxonomy_closed_proposals': '''meaning_key TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'rejected', reason TEXT NOT NULL DEFAULT '' ''',
    'taxonomy_split_targets': '''source_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id),
        target_id INTEGER NOT NULL REFERENCES taxonomy_nodes(id), change_id INTEGER NOT NULL REFERENCES taxonomy_changes(id),
        PRIMARY KEY(source_id,target_id,change_id)''',
}


def digest(value):
    return hashlib.sha256(tx._json(value).encode()).hexdigest()


def context_for(db, media_id, term, tag_id):
    matches = [n['id'] for n in tx.resolve(db, term)]
    context = {'matches': matches}
    if tag_id is not None:
        node = tx.get_node(db, tag_id)
        resolved = tx.get_node(db, tag_id, redirect=True)
        context['concept'] = {'id': tag_id, 'resolved_id': resolved['id'], 'status': node['status'],
                              'description': tx.recognition_description(db, node)}
        relevant = tx.ancestors(db, resolved['id'])
        context['decisions'] = [dict(r) for r in db.execute(
            'SELECT tag_id,scope,decision,version FROM taxonomy_decisions WHERE media_id=? AND tag_id IN (' +
            ','.join('?' for _ in relevant) + ') ORDER BY tag_id,scope', [media_id, *relevant])]
    return context


def track_candidate(db, candidate_id, batch_id):
    row = db.execute('SELECT * FROM taxonomy_candidates WHERE id=?', (candidate_id,)).fetchone()
    evidence = json.loads(row['evidence'])
    meaning = digest([tx.normalize(row['term']), row['tag_id'], row['parent_id'],
                      tx.normalize(evidence.get('parent', '')), evidence.get('definition', '')])
    group = digest([meaning, batch_id])
    context = context_for(db, row['media_id'], row['term'], row['tag_id'])
    db.execute('INSERT OR IGNORE INTO taxonomy_candidate_context(candidate_id,batch_id,meaning_key,group_key,fingerprint,context) '
               'VALUES (?,?,?,?,?,?)', (candidate_id, batch_id, meaning, group, digest(context), tx._json(context)))
    if row['tag_id'] is None and db.execute('SELECT 1 FROM taxonomy_closed_proposals WHERE meaning_key=? AND state=\'rejected\'', (meaning,)).fetchone():
        db.execute("UPDATE taxonomy_candidates SET state='rejected' WHERE id=?", (candidate_id,))


def validate_candidate(db, row):
    stage = 'analysis' if row['kind'] == 'analysis' else 'image'
    if row['input_revision'] != tx.input_revision(db, row['media_id'], stage):
        raise tx.Conflict('素材依据已变化，请重新整理')
    stored = db.execute('SELECT fingerprint FROM taxonomy_candidate_context WHERE candidate_id=?', (row['id'],)).fetchone()
    current = context_for(db, row['media_id'], row['term'], row['tag_id'])
    if not stored or stored[0] != digest(current):
        raise tx.Conflict('标签含义、表达或人工决定已变化，请重新校验并查看差异')
    if row['kind'] == 'example' and json.loads(row['evidence']).get('example_revision') != tx.example_revision(db, row['tag_id']):
        raise tx.Conflict('例图已变化，请重新寻找候选')


def revalidate(db, candidate_id):
    row = db.execute('SELECT * FROM taxonomy_candidates WHERE id=?', (candidate_id,)).fetchone()
    if not row: raise tx.Conflict('候选不存在')
    if row['input_revision'] != tx.input_revision(db, row['media_id'], 'analysis' if row['kind'] == 'analysis' else 'image'):
        raise tx.Conflict('图片或分析已变化，需要重新整理')
    if row['kind'] == 'example':
        raise tx.Conflict('例图候选请重新寻找，不能直接刷新依据')
    matches = tx.resolve(db, row['term'])
    tag_id = matches[0]['id'] if len(matches) == 1 else None
    previous = db.execute('SELECT context,batch_id FROM taxonomy_candidate_context WHERE candidate_id=?', (candidate_id,)).fetchone()
    old = json.loads(previous['context']) if previous else None
    db.execute("UPDATE taxonomy_candidates SET tag_id=?,updated_at=datetime('now') WHERE id=?", (tag_id, candidate_id))
    db.execute('DELETE FROM taxonomy_candidate_context WHERE candidate_id=?', (candidate_id,))
    track_candidate(db, candidate_id, previous['batch_id'] if previous else 'legacy')
    return {'previous': old, 'current': context_for(db, row['media_id'], row['term'], tag_id), 'tag_id': tag_id}


def target_context(db,ids,target):
    node=tx.get_node(db,int(target),redirect=True)
    if node['status'] not in ('active','paused'):raise tx.Conflict('目标标签已停用')
    parents=tx.ancestors(db,node['id']);decisions=[]
    for cid in sorted(set(ids)):
        row=db.execute('SELECT media_id FROM taxonomy_candidates WHERE id=?',(cid,)).fetchone()
        if not row:raise tx.Conflict('候选不存在')
        decisions.append([row[0],[list(r) for r in db.execute('SELECT tag_id,scope,decision,version FROM taxonomy_decisions WHERE media_id=? AND tag_id IN ('+
            ','.join('?' for _ in parents)+') ORDER BY tag_id,scope',[row[0],*parents])]])
    return digest([node['id'],node['status'],tx.recognition_description(db,node),decisions])


def review(db, ids, accept, target=None, baseline=False, expected_target=None):
    # Hold a write lock before checking any candidate's context, then validate all rows.
    db.execute('UPDATE taxonomy_candidates SET id=id WHERE id=?', (ids[0],))
    rows=[]
    for cid in dict.fromkeys(ids):
        row=db.execute("SELECT * FROM taxonomy_candidates WHERE id=? AND state='pending'", (cid,)).fetchone()
        if not row: raise tx.Conflict('候选已处理，请刷新')
        validate_candidate(db, row)
        tag_id = target or row['tag_id']
        if accept and tag_id is None: raise tx.Conflict('新词需先建词或选择已有标签，再确认来源素材')
        rows.append((row, tag_id))
    if accept and target is not None and any(row['tag_id']!=int(target) for row,_ in rows):
        if not expected_target or expected_target!=target_context(db,ids,target):
            raise tx.Conflict('映射目标或人工决定已变化，请重新预览映射范围')
    for row, tag_id in rows:
        if accept:
            tag_id=tx.get_node(db,tag_id,redirect=True)['id']
            tx.decide(db, [row['media_id']], tag_id, 'confirm')
            evidence=json.loads(row['evidence'])
            db.execute('INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?)',
                       (row['media_id'], tag_id, evidence.get('origin',row['kind']), 'candidate:'+str(row['id']), row['evidence']))
            if baseline:
                db.execute('INSERT INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?) '
                           'ON CONFLICT(media_id,tag_id,source_key) DO NOTHING',
                           (row['media_id'],tag_id,'confirmed_historical_baseline','baseline:'+str(row['id']),row['evidence']))
        elif row['tag_id'] is not None:
            tx.decide(db,[row['media_id']],row['tag_id'],'exclude')
        else:
            meaning=db.execute('SELECT meaning_key FROM taxonomy_candidate_context WHERE candidate_id=?',(row['id'],)).fetchone()[0]
            db.execute('INSERT OR REPLACE INTO taxonomy_closed_proposals(meaning_key,state) VALUES (?,\'rejected\')',(meaning,))
            db.execute("UPDATE taxonomy_candidates SET state='rejected' WHERE id IN (SELECT candidate_id FROM taxonomy_candidate_context WHERE meaning_key=?)",(meaning,))
        db.execute("UPDATE taxonomy_candidates SET state=?,updated_at=datetime('now') WHERE id=?",('accepted' if accept else 'rejected',row['id']))


def list_candidates(db,state='pending',page=1,per_page=60,group=None):
    condition='c.state=?';args=[state]
    if group:
        condition+=' AND x.group_key=?';args.append(group)
    total=db.execute('SELECT COUNT(*) FROM taxonomy_candidates c LEFT JOIN taxonomy_candidate_context x ON x.candidate_id=c.id WHERE '+condition,args).fetchone()[0]
    rows=db.execute('SELECT c.*,m.file_name,m.thumbnail_path,n.name tag_name,x.batch_id,x.group_key FROM taxonomy_candidates c '
                    'LEFT JOIN media m ON m.id=c.media_id LEFT JOIN taxonomy_nodes n ON n.id=c.tag_id '
                    'LEFT JOIN taxonomy_candidate_context x ON x.candidate_id=c.id WHERE '+condition+
                    ' ORDER BY c.term,c.id LIMIT ? OFFSET ?',[*args,per_page,(page-1)*per_page]).fetchall()
    data=[]
    for row in rows:
        item=dict(row)
        try: validate_candidate(db,row);item['needs_revalidation']=False
        except tx.Conflict as exc: item['needs_revalidation']=True;item['validation_error']=str(exc)
        data.append(item)
    return {'data':data,'total':total,'page':page,'per_page':per_page}


def groups(db,state='pending',page=1,per_page=20):
    total=db.execute('SELECT COUNT(*) FROM (SELECT x.group_key FROM taxonomy_candidates c JOIN taxonomy_candidate_context x ON x.candidate_id=c.id WHERE c.state=? GROUP BY x.group_key)',(state,)).fetchone()[0]
    rows=db.execute('SELECT x.group_key,x.batch_id,c.term,c.tag_id,COUNT(*) count,MIN(c.id) first_id FROM taxonomy_candidates c '
                    'JOIN taxonomy_candidate_context x ON x.candidate_id=c.id WHERE c.state=? GROUP BY x.group_key '
                    'ORDER BY first_id DESC LIMIT ? OFFSET ?',(state,per_page,(page-1)*per_page)).fetchall()
    data=[]
    for row in rows:
        item=dict(row)
        item['samples']=list_candidates(db,state,1,3,row['group_key'])['data']
        data.append(item)
    return {'data':data,'total':total,'page':page,'per_page':per_page}
