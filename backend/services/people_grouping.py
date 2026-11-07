"""Local threshold calibration from explicit, undoable human decisions."""
import base64
import json

from flask import current_app
import numpy as np

from ..db import get_setting

DEFAULT_THRESHOLD = .55
MIN_THRESHOLD = .45
MAX_THRESHOLD = .85


def _groups(snapshot):
    groups = {}
    for face in snapshot.get('people_faces', []):
        feature = face.get('feature')
        if not face.get('active') or face.get('assignment') == 'not_face' or face.get('person_id') is None or face.get('quality', 0) < .5 or not isinstance(feature, dict):
            continue
        try:
            vector = np.frombuffer(base64.b64decode(feature['blob']), dtype=np.float32)
            if not 1 <= len(vector) <= 4096 or not np.isfinite(vector).all() or np.linalg.norm(vector) < 1e-10:
                continue
            groups.setdefault((face['model_key'], face['person_id']), []).append({**face, '_vector': vector / np.linalg.norm(vector)})
        except (KeyError, ValueError, TypeError):
            continue
    return groups


def _representatives(faces):
    if not faces:
        return []
    anchor = min(faces, key=lambda f: f['id'])
    best = sorted(faces, key=lambda f: (-f['quality'], f['id']))[:4]
    return [anchor, *(f for f in best if f['id'] != anchor['id'])]


def _score(left, right):
    left, right = _representatives(left), _representatives(right)
    if not left or not right or len(left[0]['_vector']) != len(right[0]['_vector']):
        return None
    return float(np.clip(np.min(np.stack([f['_vector'] for f in left]) @ np.stack([f['_vector'] for f in right]).T), -1, 1))


def _samples(kind, before, after):
    groups = _groups(before)
    scores = {}
    def add(model, same, left, right):
        score = _score(left, right)
        if score is not None:
            scores.setdefault((model, same), []).append(score)
    if kind == 'merge':
        redirects = {p['id']: p['redirect_id'] for p in after.get('people_persons', []) if p.get('redirect_id') is not None}
        for (model, source), faces in groups.items():
            if source in redirects:
                target = redirects[source]
                target_faces = groups.get((model, target), [])
                if not target_faces:
                    target_faces = next((g for (m, p), g in groups.items() if m == model and p != source and redirects.get(p) == target), [])
                add(model, True, faces, target_faces)
    elif kind == 'faces':
        changed = {f['id']: f for f in after.get('people_faces', [])}
        for (model, old), faces in groups.items():
            for face in faces:
                new = changed.get(face['id'], {})
                target = new.get('person_id')
                if new.get('assignment') != 'manual' or target is None:
                    continue
                if target != old:
                    retained = [f for f in faces if changed.get(f['id'], f).get('person_id') == old]
                    add(model, False, [face], retained)
                    add(model, True, [face], groups.get((model, target), []))
                elif face.get('assignment') != 'manual':
                    add(model, True, [face], [f for f in faces if f['id'] != face['id']])
    elif kind == 'review':
        old = {(r['left_id'], r['right_id']) for r in before.get('people_distinct', [])}
        for relation in after.get('people_distinct', []):
            left, right = relation['left_id'], relation['right_id']
            if (left, right) not in old:
                for model, person in groups:
                    if person == left:
                        add(model, False, groups[(model, left)], groups.get((model, right), []))
    # One operation contributes at most one observation of each kind per model.
    return [(model, same, float(np.median(values)) if same else max(values)) for (model, same), values in scores.items()]


def _feedback(db):
    rows = db.execute("SELECT id,kind FROM people_changes WHERE state='applied' AND kind IN ('merge','faces','review') ORDER BY id DESC LIMIT 100").fetchall()
    revision = tuple(r['id'] for r in rows)
    cache = current_app.extensions.get('people_grouping_feedback')
    if cache is not None and cache[0] == revision:
        return cache[1]
    samples = []
    for row in rows:
        change = db.execute('SELECT before_state,after_state FROM people_changes WHERE id=?', (row['id'],)).fetchone()
        samples.extend(_samples(row['kind'], json.loads(change['before_state']), json.loads(change['after_state'])))
    current_app.extensions['people_grouping_feedback'] = (revision, samples)
    return samples


def calibration(db, model_key):
    base = float(get_setting(db, 'people_similarity_threshold', str(DEFAULT_THRESHOLD)))
    enabled = get_setting(db, 'people_adaptive_threshold', 'true') == 'true'
    samples = [(same, score) for model, same, score in _feedback(db) if model == model_key]
    positive = [score for same, score in samples if same]
    negative = [score for same, score in samples if not same]
    target = base
    if enabled and len(positive) >= 5:
        target = min(target, float(np.quantile(positive, .2)) - .02)
    if enabled and len(negative) >= 3:
        target = max(target, float(np.quantile(negative, .9)) + .02)
    effective = round(float(np.clip(target, max(MIN_THRESHOLD, base-.05), min(MAX_THRESHOLD, base+.05))), 2)
    return {'base_threshold': base, 'effective_threshold': effective, 'enabled': enabled,
            'positive_feedback': len(positive), 'negative_feedback': len(negative),
            'calibrated': enabled and (len(positive) >= 5 or len(negative) >= 3)}
