"""Local people identities and human decisions. Callers own transactions."""
import base64
from functools import wraps
import hashlib
import json
import math
import re
import uuid

import numpy as np


class Conflict(ValueError):
    pass


_DEFINITIONS = {
    'people_persons': '''id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '',
        hidden INTEGER NOT NULL DEFAULT 0, cover_face_id INTEGER REFERENCES people_faces(id) ON DELETE SET NULL,
        redirect_id INTEGER REFERENCES people_persons(id), version INTEGER NOT NULL DEFAULT 1''',
    'people_faces': '''id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        input_revision TEXT NOT NULL, model_key TEXT NOT NULL, sample_key TEXT NOT NULL,
        frame_time REAL, bbox TEXT NOT NULL, feature BLOB, dimension INTEGER NOT NULL DEFAULT 0,
        quality REAL NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0, crop_path TEXT NOT NULL DEFAULT '',
        person_id INTEGER REFERENCES people_persons(id), assignment TEXT NOT NULL DEFAULT 'auto',
        active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(media_id,input_revision,sample_key)''',
    'people_media_decisions': '''person_id INTEGER NOT NULL REFERENCES people_persons(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, decision TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(person_id,media_id)''',
    'people_face_exclusions': '''face_id INTEGER NOT NULL REFERENCES people_faces(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES people_persons(id) ON DELETE CASCADE,
        PRIMARY KEY(face_id,person_id)''',
    'people_distinct': '''left_id INTEGER NOT NULL REFERENCES people_persons(id) ON DELETE CASCADE,
        right_id INTEGER NOT NULL REFERENCES people_persons(id) ON DELETE CASCADE,
        PRIMARY KEY(left_id,right_id)''',
    'people_reviews': '''id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
        left_id INTEGER REFERENCES people_persons(id) ON DELETE CASCADE,
        right_id INTEGER REFERENCES people_persons(id) ON DELETE CASCADE,
        face_id INTEGER REFERENCES people_faces(id) ON DELETE CASCADE,
        state TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL DEFAULT '{}', source_key TEXT NOT NULL UNIQUE''',
    'people_changes': '''id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, scope TEXT NOT NULL,
        before_state TEXT NOT NULL, after_state TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'applied' ''',
    'people_plans': '''id TEXT PRIMARY KEY, payload TEXT NOT NULL, before_state TEXT NOT NULL''',
}
TABLES = tuple(_DEFINITIONS)

# Reuse this exact derived relation for library filters, counts and inspector membership.
MEMBERSHIP_SQL = '''SELECT DISTINCT membership.person_id,membership.media_id FROM (
    SELECT person_id,media_id FROM people_faces WHERE active=1 AND person_id IS NOT NULL
        AND assignment!='not_face'
    UNION SELECT person_id,media_id FROM people_media_decisions WHERE decision='include'
) membership JOIN people_persons person ON person.id=membership.person_id
WHERE person.redirect_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM people_media_decisions d WHERE d.person_id=membership.person_id
    AND d.media_id=membership.media_id AND d.decision='exclude')'''


def init_schema(db):
    for table, definition in _DEFINITIONS.items():
        pieces = re.split(r',\s*(?=(?:UNIQUE|PRIMARY KEY)\()', definition, maxsplit=1)
        constraint = ',' + pieces[1] if len(pieces) > 1 else ''
        db.execute(f'CREATE TABLE IF NOT EXISTS {table} ({pieces[0]},'
                   "created_at TEXT NOT NULL DEFAULT (datetime('now')),"
                   "updated_at TEXT NOT NULL DEFAULT (datetime('now'))" + constraint + ')')
    db.execute('CREATE INDEX IF NOT EXISTS idx_people_faces_media ON people_faces(media_id,active)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_people_faces_person ON people_faces(person_id,active,model_key)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_people_reviews_state ON people_reviews(state,kind,id)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_people_decisions_media ON people_media_decisions(media_id,person_id)')


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def atomic(fn):
    @wraps(fn)
    def run(db, *args, **kwargs):
        # RELEASE of an outermost SQLite savepoint commits. Keep the caller's
        # transaction open even when this is its first mutation.
        if not db.in_transaction:
            db.execute('BEGIN')
        token = 'people_' + uuid.uuid4().hex
        db.execute('SAVEPOINT '+token)
        try:
            result = fn(db, *args, **kwargs)
            db.execute('RELEASE '+token)
            return result
        except Exception:
            db.execute('ROLLBACK TO '+token)
            db.execute('RELEASE '+token)
            raise
    return run


def _ids(values):
    if not isinstance(values, (list, tuple)) or not values or len(values) > 10000:
        raise Conflict('请选择 1～10000 项')
    if any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 for v in values):
        raise Conflict('项目编号无效')
    return sorted(set(values))


def _person(db, person_id, active=True):
    row = db.execute('SELECT * FROM people_persons WHERE id=?', (person_id,)).fetchone()
    if not row or active and row['redirect_id'] is not None:
        raise Conflict('人物不存在或已合并，请刷新')
    return dict(row)


def _media(db, media_ids):
    ids = _ids(media_ids)
    rows = db.execute('SELECT id FROM media WHERE id IN ('+','.join('?' for _ in ids)+')', ids).fetchall()
    if len(rows) != len(ids):
        raise Conflict('部分素材已不存在，请刷新')
    return ids


def _name(value):
    if not isinstance(value, str) or len(value.strip()) > 80:
        raise Conflict('人物姓名最多 80 字')
    return value.strip()


def create_person(db, name=''):
    person_id = db.execute('INSERT INTO people_persons(name) VALUES (?)', (_name(name),)).lastrowid
    return get_person(db, person_id)


def _face(row):
    result = {k: v for k, v in dict(row).items() if k not in ('feature', 'dimension', 'crop_path')}
    result['bbox'] = json.loads(result['bbox'])
    result['crop_url'] = '/api/people/faces/'+str(result['id'])+'/crop'
    return result


def _media_ids(db, person_id):
    return [r[0] for r in db.execute('SELECT media_id FROM ('+MEMBERSHIP_SQL+') WHERE person_id=?', (person_id,))]


def get_person(db, person_id):
    person = _person(db, person_id, active=False)
    counts = db.execute('SELECT m.media_type,COUNT(*) FROM ('+MEMBERSHIP_SQL+') p JOIN media m ON m.id=p.media_id '
                        'WHERE p.person_id=? GROUP BY m.media_type', (person_id,)).fetchall()
    by_type = dict(counts)
    person.update(photo_count=by_type.get('image', 0), video_count=by_type.get('video', 0),
                  media_count=sum(by_type.values()), display_name=person['name'] or '未命名人物 '+str(person_id).zfill(2))
    # A chosen cached portrait remains pinned through detector misses/model
    # changes. Explicit reassignment, rejection or media deletion invalidates it.
    cover = db.execute("SELECT id FROM people_faces WHERE person_id=? AND assignment!='not_face' AND (active=1 OR id=?) "
                       'ORDER BY (id=?) DESC,quality DESC,id LIMIT 1', (person_id, person['cover_face_id'], person['cover_face_id'])).fetchone()
    person['cover_face_id'] = cover[0] if cover else None
    person['cover_url'] = '/api/people/faces/'+str(cover[0])+'/crop' if cover else None
    person['manual_count'] = db.execute("SELECT COUNT(*) FROM people_faces WHERE person_id=? AND active=1 AND assignment='manual'",
                                        (person_id,)).fetchone()[0]
    person['last_seen'] = db.execute("SELECT MAX(COALESCE(datetime(NULLIF(m.date_taken,'')),datetime(m.imported_at),'')) "
                                    'FROM ('+MEMBERSHIP_SQL+') p JOIN media m ON m.id=p.media_id WHERE p.person_id=?',
                                    (person_id,)).fetchone()[0]
    return person


def list_people(db, view='all', q='', sort='recent'):
    if view not in ('all', 'unnamed', 'hidden') or sort not in ('recent', 'name', 'count'):
        raise Conflict('人物筛选无效')
    where = 'redirect_id IS NULL AND hidden='+('1' if view == 'hidden' else '0')
    if view == 'unnamed':
        where += " AND name=''"
    rows = [get_person(db, r[0]) for r in db.execute('SELECT id FROM people_persons WHERE '+where+' ORDER BY id DESC')]
    if q:
        rows = [p for p in rows if str(q).casefold() in p['display_name'].casefold()]
    if sort == 'name':
        rows.sort(key=lambda p: (p['display_name'].casefold(), p['id']))
    elif sort == 'count':
        rows.sort(key=lambda p: (-p['media_count'], p['id']))
    else:
        rows.sort(key=lambda p: (p['last_seen'] or '', p['id']), reverse=True)
    return rows


def media_people(db, media_id):
    _media(db, [media_id])
    persons = [get_person(db, r[0]) for r in db.execute('SELECT person_id FROM ('+MEMBERSHIP_SQL+') WHERE media_id=?', (media_id,))]
    faces = [_face(r) for r in db.execute('SELECT * FROM people_faces WHERE media_id=? AND active=1 ORDER BY frame_time,id', (media_id,))]
    return {'people': persons, 'faces': faces}


def _scope(person_ids=(), face_ids=()):
    return {'persons': sorted(set(person_ids)), 'faces': sorted(set(face_ids))}


def _snapshot(db, scope):
    p, f = scope['persons'], scope['faces']
    def clause(column, ids):
        return column+' IN ('+','.join('?' for _ in ids)+')' if ids else '0'
    # Constraints may point from an affected face to a person outside the scope.
    # Track those dependencies too, without snapshotting that unrelated person.
    f = sorted(set(f) | {r[0] for r in db.execute('SELECT id FROM people_faces WHERE '+clause('person_id',p),p)})
    rules = {
        'people_persons': (clause('id', p), p),
        'people_faces': (clause('person_id', p)+' OR '+clause('id', f), p+f),
        'people_media_decisions': (clause('person_id', p), p),
        'people_face_exclusions': (clause('person_id', p)+' OR '+clause('face_id', f), p+f),
        'people_distinct': (clause('left_id', p)+' OR '+clause('right_id', p), p+p),
        'people_reviews': (clause('left_id', p)+' OR '+clause('right_id', p)+' OR '+clause('face_id', f), p+p+f),
    }
    result = {}
    for table, (where, args) in rules.items():
        rows = []
        for r in db.execute('SELECT * FROM '+table+' WHERE '+where, args):
            rows.append({k: {'blob': base64.b64encode(v).decode()} if isinstance(v, bytes) else v for k, v in dict(r).items()})
        result[table] = sorted(rows, key=_json)
    return result


def _change(db, kind, scope, mutate):
    before = _snapshot(db, scope)
    result = mutate()
    after = _snapshot(db, scope)
    cid = db.execute('INSERT INTO people_changes(kind,scope,before_state,after_state) VALUES (?,?,?,?)',
                     (kind, _json(scope), _json(before), _json(after))).lastrowid
    return dict(result or {}, change_id=cid)


@atomic
def update_person(db, person_id, data, expected_version):
    person = _person(db, person_id)
    if expected_version != person['version']:
        raise Conflict('人物已更新，请刷新后重试')
    fields = {k: data[k] for k in ('name', 'hidden', 'cover_face_id') if k in data}
    if 'name' in fields:
        fields['name'] = _name(fields['name'])
    if 'hidden' in fields:
        if fields['hidden'] not in (True, False, 0, 1):
            raise Conflict('隐藏状态无效')
        fields['hidden'] = int(fields['hidden'])
    if fields.get('cover_face_id') is not None and not db.execute("SELECT 1 FROM people_faces WHERE id=? AND person_id=? AND active=1 AND assignment!='not_face'",
                                                                (fields['cover_face_id'], person_id)).fetchone():
        raise Conflict('封面人脸不属于此人物')
    def mutate():
        if fields:
            db.execute('UPDATE people_persons SET '+','.join(k+'=?' for k in fields)+
                       ",version=version+1,updated_at=datetime('now') WHERE id=?", [*fields.values(), person_id])
        return get_person(db, person_id)
    return _change(db, 'person', _scope([person_id]), mutate)


@atomic
def decide_media(db, media_ids, person_id, decision):
    _person(db, person_id)
    ids = _media(db, media_ids)
    if decision not in ('include', 'exclude'):
        raise Conflict('人物素材关系无效')
    def mutate():
        for mid in ids:
            db.execute('INSERT INTO people_media_decisions(person_id,media_id,decision) VALUES (?,?,?) '
                       'ON CONFLICT(person_id,media_id) DO UPDATE SET decision=excluded.decision,version=version+1,'
                       "updated_at=datetime('now')", (person_id, mid, decision))
        db.execute("UPDATE people_persons SET version=version+1,updated_at=datetime('now') WHERE id=?", (person_id,))
        return {'ok': True}
    return _change(db, 'media', _scope([person_id]), mutate)


@atomic
def decide_faces(db, face_ids, action, target_id=None, name='', versions=None):
    ids = _ids(face_ids)
    faces = [dict(r) for r in db.execute('SELECT * FROM people_faces WHERE id IN ('+','.join('?' for _ in ids)+')', ids)]
    if len(faces) != len(ids) or any(not f['active'] for f in faces):
        raise Conflict('部分人脸已更新或不存在')
    if action not in ('move', 'new', 'unassigned', 'not_face', 'confirm'):
        raise Conflict('人脸操作无效')
    if versions is not None and any(versions.get(str(f['id'])) != f['version'] for f in faces):
        raise Conflict('人脸归属已更新，请刷新')
    if action == 'move':
        _person(db, target_id)
    if action == 'confirm' and any(f['person_id'] is None or f['assignment'] == 'not_face' for f in faces):
        raise Conflict('请先指定人物')
    scope = _scope([f['person_id'] for f in faces if f['person_id'] is not None] + ([target_id] if target_id else []), ids)
    def mutate():
        destination = create_person(db, name)['id'] if action == 'new' else target_id
        if destination is not None and destination not in scope['persons']:
            scope['persons'].append(destination)
        for face in faces:
            new_id = face['person_id'] if action == 'confirm' else destination if action in ('move', 'new') else None
            assignment = 'not_face' if action == 'not_face' else 'unassigned' if action == 'unassigned' else 'manual'
            if face['person_id'] is not None and new_id != face['person_id']:
                db.execute('INSERT OR IGNORE INTO people_face_exclusions(face_id,person_id) VALUES (?,?)', (face['id'], face['person_id']))
            if new_id is not None:
                db.execute('DELETE FROM people_face_exclusions WHERE face_id=? AND person_id=?', (face['id'], new_id))
                excluded = db.execute("SELECT 1 FROM people_media_decisions WHERE person_id=? AND media_id=? AND decision='exclude'", (new_id, face['media_id'])).fetchone()
                if excluded:
                    raise Conflict('此素材已人工移出该人物相册，请先明确修改素材关系')
            db.execute("UPDATE people_faces SET person_id=?,assignment=?,version=version+1,updated_at=datetime('now') WHERE id=?",
                       (new_id, assignment, face['id']))
            db.execute("UPDATE people_reviews SET state='resolved',updated_at=datetime('now') WHERE face_id=? AND state='pending'", (face['id'],))
        for pid in scope['persons']:
            db.execute("UPDATE people_persons SET version=version+1,updated_at=datetime('now') WHERE id=?", (pid,))
        return {'ok': True, 'person_id': destination}
    return _change(db, 'faces', scope, mutate)


def _vector(feature):
    if feature is None:
        return None
    try:
        vector = np.frombuffer(feature, dtype=np.float32).copy() if isinstance(feature, bytes) else np.asarray(feature, dtype=np.float32)
    except (ValueError, TypeError):
        raise Conflict('人脸特征无效') from None
    if vector.ndim != 1 or not 1 <= len(vector) <= 4096 or not np.isfinite(vector).all():
        raise Conflict('人脸特征无效')
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-10:
        raise Conflict('人脸特征无效')
    return vector / norm


def _iou(a, b):
    x = max(0., min(a[0]+a[2], b[0]+b[2])-max(a[0], b[0]))
    y = max(0., min(a[1]+a[3], b[1]+b[3])-max(a[1], b[1]))
    overlap = x*y
    return overlap / max(1e-9, a[2]*a[3]+b[2]*b[3]-overlap)


def _review(db, kind, left_id=None, right_id=None, face_id=None, payload=None):
    if kind == 'merge':
        left_id, right_id = sorted((left_id, right_id))
        if db.execute('SELECT 1 FROM people_distinct WHERE left_id=? AND right_id=?', (left_id, right_id)).fetchone():
            return
    source = _json([kind, left_id, right_id, face_id])
    db.execute('INSERT OR IGNORE INTO people_reviews(kind,left_id,right_id,face_id,payload,source_key) VALUES (?,?,?,?,?,?)',
               (kind, left_id, right_id, face_id, _json(payload or {}), source))


@atomic
def record_observations(db, media_id, input_revision, model_key, observations, threshold=.6, review_threshold=.4):
    _media(db, [media_id])
    if not isinstance(input_revision, str) or not input_revision or not isinstance(model_key, str) or not model_key:
        raise Conflict('识别版本无效')
    if not isinstance(observations, list) or len(observations) > 10000:
        raise Conflict('检测结果超出范围')
    prepared, keys = [], set()
    for raw in observations:
        box = raw.get('bbox')
        if not isinstance(box, (list, tuple)) or len(box) != 4 or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in box):
            raise Conflict('人脸位置无效')
        if min(box) < 0 or box[2] <= 0 or box[3] <= 0 or box[0]+box[2] > 1.001 or box[1]+box[3] > 1.001:
            raise Conflict('人脸位置超出画面')
        key = str(raw.get('sample_key', ''))
        if not key or key in keys or len(key) > 200:
            raise Conflict('人脸样本编号无效或重复')
        keys.add(key)
        frame = raw.get('frame_time')
        if frame is not None and (not isinstance(frame, (int, float)) or not math.isfinite(frame) or frame < 0):
            raise Conflict('视频时间点无效')
        quality, score = float(raw.get('quality', 0)), float(raw.get('score', 0))
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in (quality, score)):
            raise Conflict('检测质量无效')
        prepared.append(dict(raw, sample_key=key, bbox=list(box), frame_time=frame, quality=quality, score=score, vector=_vector(raw.get('feature'))))
    # Source replacement hides obsolete observations, retaining identities and human decisions.
    db.execute("UPDATE people_faces SET active=0,version=version+1,updated_at=datetime('now') WHERE media_id=? AND input_revision!=? AND active=1", (media_id, input_revision))
    existing = [dict(r) for r in db.execute('SELECT * FROM people_faces WHERE media_id=? AND input_revision=?', (media_id, input_revision))]
    used, output, created = set(), [], []
    for obs in prepared:
        match = next((f for f in existing if f['sample_key'] == obs['sample_key'] and f['id'] not in used
                      and f['frame_time'] == obs['frame_time'] and _iou(json.loads(f['bbox']), obs['bbox']) >= .6), None)
        if match is None:
            candidates = [f for f in existing if f['id'] not in used and f['frame_time'] == obs['frame_time'] and _iou(json.loads(f['bbox']), obs['bbox']) >= .6]
            if candidates:
                match = max(candidates, key=lambda f: _iou(json.loads(f['bbox']), obs['bbox']))
        feature = obs['vector'].astype(np.float32).tobytes() if obs['vector'] is not None else None
        values = (model_key, obs['frame_time'], _json(obs['bbox']), feature, len(obs['vector']) if obs['vector'] is not None else 0,
                  obs['quality'], obs['score'], str(obs.get('crop_path', '')))
        if match:
            fid = match['id']; used.add(fid)
            # Rescans refresh observations, never replace a manual identity or rejection.
            db.execute('UPDATE people_faces SET model_key=?,frame_time=?,bbox=?,feature=?,dimension=?,quality=?,score=?,crop_path=?,active=1,'
                       "version=version+1,updated_at=datetime('now') WHERE id=?", (*values, fid))
            if match['assignment'] != 'auto':
                output.append(_face(db.execute('SELECT * FROM people_faces WHERE id=?', (fid,)).fetchone()))
                continue
        else:
            key = obs['sample_key']
            if db.execute('SELECT 1 FROM people_faces WHERE media_id=? AND input_revision=? AND sample_key=?',
                          (media_id,input_revision,key)).fetchone():
                # Detector indices can shift after a missed face. Reused keys
                # must not overwrite a different position or video timestamp.
                digest = hashlib.sha256(_json([obs['frame_time'],obs['bbox']]).encode()).hexdigest()[:24]
                base = key[:160]+':'+digest
                key = base; suffix = 0
                while db.execute('SELECT 1 FROM people_faces WHERE media_id=? AND input_revision=? AND sample_key=?',
                                 (media_id,input_revision,key)).fetchone():
                    suffix += 1; key = base+':'+str(suffix)
            fid = db.execute('INSERT INTO people_faces(media_id,input_revision,sample_key,model_key,frame_time,bbox,feature,dimension,quality,score,crop_path) '
                             'VALUES (?,?,?,?,?,?,?,?,?,?,?)', (media_id, input_revision, key, *values)).lastrowid
        identity = match['person_id'] if match else None
        if obs['vector'] is not None and obs['quality'] >= .35:
            groups = {}
            for row in db.execute("WITH representatives AS (SELECT f.id,f.person_id,"
                                  'ROW_NUMBER() OVER (PARTITION BY f.person_id ORDER BY f.id) anchor_rank,'
                                  'ROW_NUMBER() OVER (PARTITION BY f.person_id ORDER BY f.quality DESC,f.id) quality_rank '
                                  'FROM people_faces f JOIN people_persons p ON p.id=f.person_id '
                                  "WHERE f.active=1 AND f.assignment!='not_face' AND f.id!=? AND f.model_key=? AND f.dimension=? "
                                  "AND f.feature IS NOT NULL AND p.redirect_id IS NULL AND NOT EXISTS (SELECT 1 FROM people_face_exclusions e WHERE e.face_id=? AND e.person_id=f.person_id) "
                                  "AND NOT EXISTS (SELECT 1 FROM people_media_decisions d WHERE d.media_id=? AND d.person_id=f.person_id AND d.decision='exclude')) "
                                  'SELECT f.person_id,f.feature FROM representatives r JOIN people_faces f ON f.id=r.id '
                                  'WHERE r.anchor_rank=1 OR r.quality_rank<=4',
                                  (fid, model_key, len(obs['vector']), fid, media_id)):
                groups.setdefault(row['person_id'], []).append(np.frombuffer(row['feature'], dtype=np.float32))
            # Fixed earliest + quality/id representatives are chosen without the
            # candidate's similarity, so a long chain cannot drop its first anchor.
            scores = sorted(((float(np.min(np.stack(exemplars) @ obs['vector'])), pid) for pid, exemplars in groups.items()), reverse=True)
            best = scores[0] if scores else None
            if identity is None:
                if best and best[0] >= threshold and (len(scores) < 2 or best[0]-scores[1][0] >= .08):
                    identity = best[1]
                else:
                    identity = create_person(db)['id']; created.append(identity)
                    if best and best[0] >= review_threshold:
                        _review(db, 'merge', identity, best[1], payload={'similarity': round(best[0], 4)})
            elif best and best[1] != identity and best[0] >= review_threshold:
                _review(db, 'face', identity, best[1], fid, {'similarity': round(best[0], 4)})
        db.execute("UPDATE people_faces SET person_id=? WHERE id=?", (identity, fid))
        output.append(_face(db.execute('SELECT * FROM people_faces WHERE id=?', (fid,)).fetchone()))
    # A detector may no longer find an automatic face. Keep explicit human observations.
    seen_ids = [f['id'] for f in output]
    where = ' AND id NOT IN ('+','.join('?' for _ in seen_ids)+')' if seen_ids else ''
    db.execute("UPDATE people_faces SET active=0,version=version+1,updated_at=datetime('now') WHERE media_id=? AND input_revision=? AND assignment='auto' AND active=1"+where,
               [media_id, input_revision, *seen_ids])
    return {'faces': output, 'created_person_ids': created}


@atomic
def preview_merge(db, source_ids, target_id):
    sources = _ids(source_ids)
    if target_id in sources:
        raise Conflict('不能合并到自身')
    for pid in sources + [target_id]:
        _person(db, pid)
    scope = _scope(sources+[target_id])
    media = set()
    for pid in scope['persons']:
        media.update(_media_ids(db, pid))
    conflicts = []
    for a in scope['persons']:
        for b in scope['persons']:
            if a < b and db.execute('SELECT 1 FROM people_distinct WHERE left_id=? AND right_id=?', (a,b)).fetchone():
                conflicts.append({'kind': 'different_people', 'person_ids': [a,b]})
    marks = ','.join('?' for _ in scope['persons'])
    # Positive membership includes faces, not just explicit manual includes.
    # Moving those faces under any group's exclusion would silently hide media.
    exclusions = db.execute("SELECT DISTINCT media_id FROM people_media_decisions WHERE decision='exclude' AND person_id IN ("+marks+')', scope['persons']).fetchall()
    conflicts.extend({'kind': 'media_decision', 'media_id': r[0]} for r in exclusions if r[0] in media)
    if db.execute('SELECT 1 FROM people_face_exclusions e JOIN people_faces f ON f.id=e.face_id WHERE e.person_id IN ('+marks+') AND f.person_id IN ('+marks+') LIMIT 1', scope['persons']*2).fetchone():
        conflicts.append({'kind': 'face_exclusion'})
    plan_id = uuid.uuid4().hex
    payload = {'source_ids': sources, 'target_id': target_id, 'media_count': len(media), 'conflicts': conflicts}
    db.execute('INSERT INTO people_plans(id,payload,before_state) VALUES (?,?,?)', (plan_id, _json(payload), _json(_snapshot(db, scope))))
    return dict(payload, plan_id=plan_id, target=get_person(db,target_id), sources=[get_person(db,p) for p in sources])


@atomic
def apply_merge(db, plan_id):
    row = db.execute('SELECT * FROM people_plans WHERE id=?', (plan_id,)).fetchone()
    if not row:
        raise Conflict('合并预览不存在，请重新预览')
    plan = json.loads(row['payload']); sources = plan['source_ids']; target = plan['target_id']
    scope = _scope(sources+[target])
    if _snapshot(db, scope) != json.loads(row['before_state']):
        raise Conflict('合并范围已变化，请重新预览')
    if plan['conflicts']:
        raise Conflict('人物间存在人工归属或不同人约束冲突，请先核对')
    def mutate():
        for source in sources:
            db.execute("UPDATE people_faces SET person_id=?,version=version+1,updated_at=datetime('now') WHERE person_id=?", (target, source))
            for d in db.execute('SELECT * FROM people_media_decisions WHERE person_id=?', (source,)).fetchall():
                db.execute('INSERT OR IGNORE INTO people_media_decisions(person_id,media_id,decision) VALUES (?,?,?)', (target,d['media_id'],d['decision']))
            db.execute('DELETE FROM people_media_decisions WHERE person_id=?', (source,))
            for e in db.execute('SELECT face_id FROM people_face_exclusions WHERE person_id=?', (source,)).fetchall():
                db.execute('INSERT OR IGNORE INTO people_face_exclusions(face_id,person_id) VALUES (?,?)', (e[0],target))
            db.execute('DELETE FROM people_face_exclusions WHERE person_id=?', (source,))
            for d in db.execute('SELECT * FROM people_distinct WHERE left_id=? OR right_id=?', (source,source)).fetchall():
                other=d['right_id'] if d['left_id']==source else d['left_id']
                a,b=sorted((target,other))
                if a != b: db.execute('INSERT OR IGNORE INTO people_distinct(left_id,right_id) VALUES (?,?)', (a,b))
            db.execute('DELETE FROM people_distinct WHERE left_id=? OR right_id=?', (source,source))
            db.execute("UPDATE people_persons SET redirect_id=?,version=version+1,updated_at=datetime('now') WHERE id=?", (target,source))
            db.execute("UPDATE people_reviews SET state='resolved',updated_at=datetime('now') WHERE left_id=? OR right_id=?", (source,source))
        db.execute("UPDATE people_persons SET version=version+1,updated_at=datetime('now') WHERE id=?", (target,))
        db.execute('DELETE FROM people_plans WHERE id=?', (plan_id,))
        return {'ok': True, 'person_id': target}
    return _change(db, 'merge', scope, mutate)


@atomic
def undo(db, change_id):
    row = db.execute('SELECT * FROM people_changes WHERE id=?', (change_id,)).fetchone()
    if not row or row['state'] != 'applied':
        raise Conflict('此变更不可撤销')
    scope = json.loads(row['scope']); before = json.loads(row['before_state']); after = json.loads(row['after_state'])
    if _snapshot(db, scope) != after:
        raise Conflict('相关人物或成员之后已变化，不能覆盖后续决定')
    # Check all references at transaction end so circular cover/person references can be restored.
    db.execute('PRAGMA defer_foreign_keys=ON')
    tables = ('people_persons','people_faces','people_media_decisions','people_face_exclusions','people_distinct','people_reviews')
    primary = {table: [r[1] for r in db.execute('PRAGMA table_info('+table+')') if r[5]] for table in tables}
    for table in tables:
        columns = primary[table]
        for item in before.get(table, []):
            values = {k: base64.b64decode(v['blob']) if isinstance(v,dict) and 'blob' in v else v for k,v in item.items()}
            where = ' AND '.join(k+'=?' for k in columns)
            exists = db.execute('SELECT 1 FROM '+table+' WHERE '+where,[values[k] for k in columns]).fetchone()
            if exists:
                fields = [k for k in values if k not in columns]
                db.execute('UPDATE '+table+' SET '+','.join(k+'=?' for k in fields)+' WHERE '+where,
                           [values[k] for k in fields]+[values[k] for k in columns])
            else:
                db.execute('INSERT INTO '+table+' ('+','.join(values)+') VALUES ('+','.join('?' for _ in values)+')',list(values.values()))
    # Delete only records introduced by this change, after restoring old links.
    # Updating existing people/faces avoids cascading away unrelated constraints.
    for table in reversed(tables):
        columns = primary[table]
        old_keys = {tuple(item[k] for k in columns) for item in before.get(table,[])}
        for item in after.get(table,[]):
            key = tuple(item[k] for k in columns)
            if key not in old_keys:
                db.execute('DELETE FROM '+table+' WHERE '+' AND '.join(k+'=?' for k in columns),key)
    db.execute("UPDATE people_changes SET state='undone',updated_at=datetime('now') WHERE id=?", (change_id,))
    return {'ok': True}


def list_reviews(db, state='pending', kind=None, limit=200, offset=0):
    if state not in ('pending','resolved','dismissed') or kind not in (None,'merge','face'):
        raise Conflict('核对筛选无效')
    if not 1<=limit<=200 or offset<0:raise Conflict('核对分页无效')
    args=[state]+([kind] if kind else [])+[limit,offset]
    rows = db.execute('SELECT * FROM people_reviews WHERE state=?'+(' AND kind=?' if kind else '')+' ORDER BY id DESC LIMIT ? OFFSET ?',args).fetchall()
    result = []
    for row in rows:
        value=dict(row);value['payload']=json.loads(value['payload'])
        value['left']=get_person(db,value['left_id']) if value['left_id'] else None
        value['right']=get_person(db,value['right_id']) if value['right_id'] else None
        value['face']=_face(db.execute('SELECT * FROM people_faces WHERE id=?',(value['face_id'],)).fetchone()) if value['face_id'] else None
        result.append(value)
    return result


@atomic
def review_decision(db, review_id, decision):
    row=db.execute('SELECT * FROM people_reviews WHERE id=? AND state=\'pending\'',(review_id,)).fetchone()
    if not row or decision not in ('different','confirm','dismiss'):
        raise Conflict('核对项目已改变或操作无效')
    if decision=='confirm' and row['kind']=='face':
        return decide_faces(db,[row['face_id']],'confirm')
    scope=_scope([pid for pid in (row['left_id'],row['right_id']) if pid], [row['face_id']] if row['face_id'] else [])
    def mutate():
        if decision=='different':
            if row['kind']!='merge':raise Conflict('请使用人脸纠正操作')
            a,b=sorted((row['left_id'],row['right_id']))
            db.execute('INSERT OR IGNORE INTO people_distinct(left_id,right_id) VALUES (?,?)',(a,b))
        db.execute("UPDATE people_reviews SET state=?,updated_at=datetime('now') WHERE id=?",('dismissed' if decision=='dismiss' else 'resolved',review_id))
        return {'ok':True}
    return _change(db,'review',scope,mutate)
