"""Reviewed taxonomy mutations: previews are data, execution requires a fresh snapshot.

This module never commits. The caller owns the write lock, snapshot check and
change record. A preview can only save a plan; it cannot change labels or nodes.
"""
import json
import math
import uuid
from datetime import datetime, timedelta, timezone

from . import taxonomy as tx

ENGINE = 'reviewed-v2'
DEFINITIONS = {}


def _ids(values):
    try:
        result = list(dict.fromkeys(int(v) for v in values))
    except (ValueError, TypeError):
        raise tx.Conflict('范围必须是有效 ID')
    if not result or any(v <= 0 for v in result):
        raise tx.Conflict('请选择明确的范围')
    return result


def _rows(db, table):
    return [dict(r) for r in db.execute('SELECT * FROM ' + table)]


def _nodes(db):
    return {r['id']: dict(r) for r in db.execute('SELECT * FROM taxonomy_nodes')}


def _desc(nodes, tag_id):
    result, pending = set(), [tag_id]
    while pending:
        current = pending.pop()
        if current in result:
            raise tx.Conflict('标签树存在循环')
        result.add(current)
        pending.extend(n['id'] for n in nodes.values() if n['parent_id'] == current and n['status'] != 'merged')
    return result


def _validate_tree(nodes):
    for n in nodes.values():
        if n['status'] == 'merged':
            continue
        current, path = n, []
        while current is not None:
            if current['id'] in path:
                raise tx.Conflict('选择的去向会形成循环')
            path.append(current['id'])
            current = nodes.get(current['parent_id'])
        if len(path) > 4:
            raise tx.Conflict('选择的去向会超过四级')
    siblings = {}
    for n in nodes.values():
        if n['status'] == 'merged':
            continue
        key = (n['parent_id'], tx.normalize(n['name']))
        if key in siblings:
            raise tx.Conflict('选择的去向存在同名子节点，请先改名或选择其他父级')
        siblings[key] = n['id']


def _scope(db, values):
    result = set()
    for value in values:
        tx.get_node(db, value)
        result.update(tx.descendants(db, value))
        result.update(tx.ancestors(db, value))
    return sorted(result)


def _conflict(conflicts, resolutions, key, kind, label, choices):
    valid = {tx._json(c['value']) for c in choices}
    if key in resolutions and tx._json(resolutions[key]) in valid:
        return resolutions[key]
    conflicts.append({'key': key, 'type': kind, 'label': label, 'choices': choices})
    return _UNRESOLVED


_UNRESOLVED = object()


def snapshot(db, payload):
    state = tx._snapshot(db, payload['scope'])
    state['_selected_media'] = [(mid, tx.input_revision(db, mid, 'image')) for mid in payload.get('media_ids', [])]
    state['_alias_owners'] = []
    for expression in payload.get('dependency_aliases', []):
        state['_alias_owners'].append([expression, [n['id'] for n in tx.resolve(db, expression)]])
    return state


def _store(db, kind, payload, conflicts, media_ids):
    payload = {**payload, 'engine': ENGINE, 'unresolved': bool(conflicts), 'media_ids': sorted(set(media_ids))}
    payload['scope'] = sorted(set(payload['scope']))
    state = snapshot(db, payload)
    token = uuid.uuid4().hex
    db.execute('INSERT INTO taxonomy_plans(id,kind,payload,before_state,expires_at) VALUES (?,?,?,?,?)',
               (token, kind, tx._json(payload), tx._json(state),
                (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()))
    media = []
    ids = payload['media_ids']
    for offset in range(0, len(ids), 400):
        chunk = ids[offset:offset + 400]
        media.extend(dict(r) for r in db.execute('SELECT id,file_name FROM media WHERE id IN (' +
                     ','.join('?' for _ in chunk) + ') ORDER BY id', chunk))
    if len(media) != len(ids):
        raise tx.Conflict('部分素材已经移除，请重新选择')
    return {'id': token, 'kind': kind, 'media_count': len(media), 'media_items': media,
            'payload': payload, 'scope': payload['scope'], 'conflicts': conflicts,
            'decision_deltas': payload.get('decision_deltas', []),
            'association_deltas': payload.get('association_deltas', []),
            'exclusion_changes': payload.get('exclusion_changes', []),
            'node_changes': payload.get('node_changes', [])}


def _members(db, tags):
    ids = list(tags)
    if not ids:
        return set()
    return {r[0] for r in db.execute('SELECT DISTINCT media_id FROM media_tags WHERE tag_id IN (' +
                                   ','.join('?' for _ in ids) + ')', ids)}


def _cover(nodes, members):
    """Represent an exact current-node set as direct and maximal subtree rules."""
    members = set(members)
    covered, rules = set(), []
    for tag_id in sorted(members, key=lambda i: _depth(nodes, i)):
        if tag_id in covered:
            continue
        descendants = _desc(nodes, tag_id)
        scope = 'subtree' if descendants <= members else 'direct'
        rules.append((tag_id, scope))
        covered.update(descendants if scope == 'subtree' else {tag_id})
    return rules


def _depth(nodes, tag_id):
    depth, seen = 0, set()
    while tag_id is not None:
        if tag_id in seen:
            raise tx.Conflict('标签树存在循环')
        seen.add(tag_id)
        depth += 1
        tag_id = nodes[tag_id]['parent_id']
    return depth


def _decision_changes(nodes, before, after):
    keys = set(before) | set(after)
    return [{'media_id': mid, 'tag_id': tag, 'name': nodes[tag]['name'], 'scope': scope,
             'before': before.get((mid, tag, scope)), 'after': after.get((mid, tag, scope))}
            for mid, tag, scope in sorted(keys) if before.get((mid, tag, scope)) != after.get((mid, tag, scope))]


def _association_changes(db, scope, nodes, after):
    before = {(r[0], r[1]) for r in db.execute('SELECT media_id,tag_id FROM media_tags WHERE tag_id IN (' +
              ','.join('?' for _ in scope) + ')', scope)}
    after = set(after)
    return [{'media_id': mid, 'tag_id': tag, 'name': nodes[tag]['name'], 'before': (mid, tag) in before,
             'after': (mid, tag) in after} for mid, tag in sorted(before ^ after)]


def _clear_exclusions(nodes, decisions, mid, tag, changes):
    parents, current = set(), tag
    while current is not None:
        parents.add(current)
        current = nodes[current]['parent_id']
    for key, value in list(decisions.items()):
        if key[0] == mid and value == 'exclude' and (key[1] == tag or key[2] == 'subtree' and key[1] in parents):
            decisions.pop(key)
            removed = _desc(nodes, key[1]) if key[2] == 'subtree' else {key[1]}
            changes.append({'media_id': mid, 'anchor_id': key[1], 'name': nodes[key[1]]['name'],
                            'before': [{'id': i, 'name': nodes[i]['name']} for i in sorted(removed)],
                            'after': [], 'choice': 'remove'})


def _transform_exclusions(before_nodes, after_nodes, decisions, mapping, resolutions, conflicts):
    """Translate only range-changing exclusions, with an explicit user choice."""
    result, changes = {}, []
    for (mid, tag, scope), value in decisions.items():
        mapped = mapping.get(tag, tag)
        if value != 'exclude' or scope != 'subtree':
            result.setdefault((mid, mapped, scope), []).append(value)
            continue
        old = {mapping.get(i, i) for i in _desc(before_nodes, tag)}
        new = _desc(after_nodes, mapped)
        if old == new and tag == mapped:
            result.setdefault((mid, mapped, scope), []).append(value)
            continue
        choice = _conflict(conflicts, resolutions, f'exclusion:{mid}:{tag}', 'exclusion_scope',
                           f'素材 #{mid} 的“{before_nodes[tag]["name"]}”子树排除范围会变化（原 {len(old)} 项，新 {len(new)} 项）',
                           [{'label': '保留原范围，新加入分支不自动排除', 'value': 'preserve'},
                            {'label': '排除合并／移动后的整个新范围', 'value': 'expand'},
                            {'label': '明确解除这条排除', 'value': 'remove'}])
        if choice is _UNRESOLVED:
            choice = 'preserve'
        selected = old if choice == 'preserve' else new if choice == 'expand' else set()
        for new_tag, new_scope in _cover(after_nodes, selected):
            result.setdefault((mid, new_tag, new_scope), []).append('exclude')
        changes.append({'media_id': mid, 'anchor_id': tag, 'name': before_nodes[tag]['name'],
                        'before': [{'id': i, 'name': after_nodes[i]['name']} for i in sorted(old)],
                        'after': [{'id': i, 'name': after_nodes[i]['name']} for i in sorted(selected)], 'choice': choice})
    return result, changes


def _resolve_decisions(nodes, grouped, positives, resolutions, conflicts):
    """Resolve same-key and inherited exclusion conflicts without silent overrides."""
    result = {}
    for key, values in grouped.items():
        unique = set(values)
        if len(unique) == 1:
            result[key] = values[0]
            continue
        mid, tag, scope = key
        choice = _conflict(conflicts, resolutions, f'decision:{mid}:{tag}:{scope}', 'manual_decision',
                           f'素材 #{mid} 的“{nodes[tag]["name"]}”存在确认与排除冲突',
                           [{'label': '保留人工确认并解除此处排除', 'value': 'confirm'},
                            {'label': '明确采用排除并移除标注', 'value': 'exclude'}])
        result[key] = choice if choice is not _UNRESOLVED else 'exclude'
    for mid, tags in positives.items():
        for tag in list(tags):
            blocking = [key for key, value in result.items() if key[0] == mid and value == 'exclude' and
                        (key[1] == tag or key[2] == 'subtree' and tag in _desc(nodes, key[1]))]
            if not blocking:
                continue
            if any(resolutions.get(f'decision:{mid}:{key[1]}:{key[2]}') == 'exclude' for key in blocking):
                tags.discard(tag)
                if result.get((mid, tag, 'direct')) == 'confirm': result[(mid, tag, 'direct')] = 'exclude'
                continue
            choice = _conflict(conflicts, resolutions, f'material:{mid}:{tag}', 'manual_decision',
                               f'素材 #{mid} 的“{nodes[tag]["name"]}”标注命中 {len(blocking)} 条人工排除',
                               [{'label': '保留标注，明确解除这张素材的冲突排除', 'value': 'keep_tag'},
                                {'label': '保留排除，明确移除这项标注', 'value': 'exclude'}])
            if choice == 'keep_tag':
                for key in blocking:
                    result.pop(key)
                result[(mid, tag, 'direct')] = 'confirm'
            else:
                tags.discard(tag)
                if result.get((mid, tag, 'direct')) == 'confirm':
                    result[(mid, tag, 'direct')] = 'exclude'
    return result


def _prepare_state(db, scope, before_nodes, after_nodes, mapping, resolutions, conflicts):
    decisions = {(r['media_id'], r['tag_id'], r['scope']): r['decision'] for r in
                 db.execute('SELECT * FROM taxonomy_decisions WHERE tag_id IN (' + ','.join('?' for _ in scope) + ')', scope)}
    positives = {}
    for row in db.execute('SELECT * FROM media_tags WHERE tag_id IN (' + ','.join('?' for _ in scope) + ')', scope):
        positives.setdefault(row['media_id'], set()).add(mapping.get(row['tag_id'], row['tag_id']))
    grouped, exclusion_changes = _transform_exclusions(before_nodes, after_nodes, decisions, mapping, resolutions, conflicts)
    final = _resolve_decisions(after_nodes, grouped, positives, resolutions, conflicts)
    deltas = _decision_changes(after_nodes, decisions, final)
    return decisions, final, positives, exclusion_changes, deltas


def preview_decision(db, data):
    media_ids = _ids(data.get('media_ids', []))
    tag_id = tx.get_node(db, int(data['tag_id']), redirect=True)['id']
    decision = data.get('decision')
    scope_name = data.get('scope', 'direct')
    if decision not in ('confirm', 'remove', 'exclude') or scope_name not in ('direct', 'subtree'):
        raise tx.Conflict('标签决定无效')
    affected = set(tx.descendants(db, tag_id)) if scope_name == 'subtree' else {tag_id}
    scope = _scope(db, [tag_id])
    nodes = _nodes(db)
    before = {(r['media_id'], r['tag_id'], r['scope']): r['decision'] for r in db.execute(
        'SELECT * FROM taxonomy_decisions WHERE tag_id IN (' + ','.join('?' for _ in scope) + ')', scope)}
    after = dict(before)
    associations = {(r[0], r[1]) for r in db.execute('SELECT media_id,tag_id FROM media_tags WHERE tag_id IN (' +
                    ','.join('?' for _ in scope) + ')', scope)}
    exclusion_changes = []
    for mid in media_ids:
        if not db.execute('SELECT 1 FROM media WHERE id=?', (mid,)).fetchone():
            raise tx.Conflict('部分素材已移除')
        if decision == 'confirm' and tx._blocked(db, mid, tag_id) and not data.get('clear_exclusion'):
            raise tx.Conflict('命中人工排除，请明确选择解除后再添加')
        if decision == 'confirm' and data.get('clear_exclusion'):
            _clear_exclusions(nodes, after, mid, tag_id, exclusion_changes)
        after[(mid, tag_id, scope_name)] = 'confirm' if decision == 'confirm' else 'exclude'
        if decision == 'confirm':
            associations.add((mid, tag_id))
        else:
            associations.difference_update((mid, tag) for tag in affected)
    payload = {'scope': scope, 'decision': decision, 'tag_id': tag_id, 'decision_scope': scope_name,
               'clear_exclusion': bool(data.get('clear_exclusion')), 'decision_deltas': _decision_changes(nodes, before, after),
               'association_deltas': _association_changes(db, scope, nodes, associations), 'exclusion_changes': exclusion_changes}
    return _store(db, 'decision', payload, [], media_ids)


def preview_edit(db, tag_id, data):
    tag_id = int(tag_id)
    node = tx.get_node(db, tag_id)
    if data.get('version') != node['version']:
        raise tx.Conflict('标签已更新，请刷新后重试')
    fields = {k: data[k] for k in ('name', 'parent_id', 'definition', 'recognition_text', 'sort_order', 'status') if k in data}
    if 'parent_id' in fields:
        fields['parent_id'] = int(fields['parent_id']) if fields['parent_id'] is not None else None
    for field in ('name', 'definition', 'recognition_text'):
        if field in fields:
            fields[field] = str(fields[field]).strip()
    if 'name' in fields and (not str(fields['name']).strip() or len(str(fields['name']).strip()) > 120):
        raise tx.Conflict('标签名称需为 1～120 字')
    if 'status' in fields and fields['status'] not in ('active', 'paused', 'inactive'):
        raise tx.Conflict('标签状态无效')
    parent = fields.get('parent_id', node['parent_id'])
    if parent is not None and tx.get_node(db, int(parent))['status'] != 'active':
        raise tx.Conflict('父标签不可用于新位置')
    nodes = _nodes(db)
    after = {i: dict(n) for i, n in nodes.items()}
    after[tag_id].update(fields)
    _validate_tree(after)
    roots = [tag_id] + ([parent] if parent is not None else [])
    scope = _scope(db, roots)
    resolutions = data.get('resolutions', {})
    conflicts = []
    old_decisions, final, positives, changes, deltas = _prepare_state(db, scope, nodes, after, {}, resolutions, conflicts)
    members = _members(db, tx.descendants(db, tag_id)) | {key[0] for key in old_decisions}
    payload = {'scope': scope, 'tag_id': tag_id, 'fields': fields, 'expected_version': node['version'],
               'resolutions': resolutions, 'final_decisions': [[*key, value] for key, value in sorted(final.items())],
               'final_associations': [[mid, tag] for mid, tags in sorted(positives.items()) for tag in sorted(tags)],
               'decision_deltas': deltas, 'exclusion_changes': changes,
               'association_deltas': _association_changes(db, scope, after, ((mid, tag) for mid, tags in positives.items() for tag in tags)),
               'node_changes': [{'tag_id': tag_id, 'name': node['name'], 'before_parent_id': node['parent_id'],
                                 'after_parent_id': parent, 'before_parent': nodes[node['parent_id']]['name'] if node['parent_id'] else '一级',
                                 'after_parent': nodes[parent]['name'] if parent else '一级'}]}
    return _store(db, 'edit', payload, conflicts, members)


def preview_merge(db, source_ids, target_id, resolutions=None):
    resolutions = resolutions or {}
    sources = _ids(source_ids)
    target = tx.get_node(db, int(target_id))
    if target['id'] in sources or target['status'] not in ('active', 'paused'):
        raise tx.Conflict('请选择不同且有效的合并目标')
    nodes = _nodes(db)
    mapping = {source: target['id'] for source in sources}
    for source in sources:
        tx.get_node(db,source)
        if nodes[source]['status'] not in ('active', 'paused') or target['id'] in tx.descendants(db, source):
            raise tx.Conflict('来源无效或目标位于来源子树内')
    after = {i: dict(n) for i, n in nodes.items()}
    for source in sources:
        after[source].update(status='merged', redirect_id=target['id'])
    conflicts, parents, node_changes = [], {}, []
    choices = [{'label': target['name'], 'value': target['id']}, {'label': '一级根位置', 'value': None}]
    for child in nodes.values():
        if child['parent_id'] not in sources or child['id'] in sources or child['status'] == 'merged':
            continue
        available = [*choices]
        old_parent = nodes[child['parent_id']]['parent_id']
        if old_parent not in sources and old_parent is not None and old_parent != target['id']:
            available.append({'label': '来源原父级：' + nodes[old_parent]['name'], 'value': old_parent})
        parent = _conflict(conflicts, resolutions, f'child:{child["id"]}', 'child_parent',
                           f'子标签“{child["name"]}”合并后放在哪里？', available)
        if parent is _UNRESOLVED:
            parent = target['id']
        parents[child['id']] = parent
        after[child['id']]['parent_id'] = parent
        node_changes.append({'tag_id': child['id'], 'name': child['name'], 'before_parent_id': child['parent_id'],
                             'after_parent_id': parent, 'before_parent': nodes[child['parent_id']]['name'],
                             'after_parent': nodes[parent]['name'] if parent else '一级'})
    if not any(c['type'] == 'child_parent' for c in conflicts):
        _validate_tree(after)
    scope = _scope(db, [*sources, target['id'], *[p for p in parents.values() if p is not None]])
    aliases = set()
    for source in sources:
        aliases.add(nodes[source]['name'])
        aliases.update(r[0] for r in db.execute('SELECT text FROM taxonomy_expressions WHERE tag_id=?', (source,)))
    for expression in sorted(aliases):
        owners = {n['id'] for n in tx.resolve(db, expression)} - set(sources) - {target['id']}
        if owners:
            _conflict(conflicts, resolutions, 'alias:' + tx.normalize(expression), 'alias_ambiguity',
                      f'“{expression}”还有其他独立含义；保留后搜索需要消歧',
                      [{'label': '保留全部含义和别名，搜索时明确选择路径', 'value': 'keep_ambiguous'}])
    original, final, positives, changes, deltas = _prepare_state(db, scope, nodes, after, mapping, resolutions, conflicts)
    example_roles = {}
    for row in db.execute('SELECT * FROM taxonomy_examples WHERE tag_id IN (' + ','.join('?' for _ in [*sources, target['id']]) + ')', [*sources, target['id']]):
        example_roles.setdefault(row['media_id'], set()).add(row['role'])
    example_choices = {}
    for mid, roles in example_roles.items():
        if len(roles) > 1:
            role = _conflict(conflicts, resolutions, f'example:{mid}', 'example_role', f'素材 #{mid} 同时被设为正例和易混反例',
                             [{'label': '作为正例', 'value': 'positive'}, {'label': '作为易混反例', 'value': 'negative'}])
            example_choices[mid] = role if role is not _UNRESOLVED else 'negative'
        else:
            example_choices[mid] = next(iter(roles))
    payload = {'scope': scope, 'sources': sources, 'target': target['id'], 'parents': parents,
               'resolutions': resolutions, 'dependency_aliases': sorted(aliases), 'example_roles': example_choices,
               'final_decisions': [[*key, value] for key, value in sorted(final.items())],
               'final_associations': [[mid, tag] for mid, tags in sorted(positives.items()) for tag in sorted(tags)],
               'decision_deltas': deltas, 'exclusion_changes': changes, 'node_changes': node_changes,
               'association_deltas': _association_changes(db, scope, after, ((mid, tag) for mid, tags in positives.items() for tag in tags))}
    members = _members(db, set().union(*(tx.descendants(db,s) for s in sources), {target['id']})) | {key[0] for key in original} | set(example_roles)
    return _store(db, 'merge', payload, conflicts, members)


def preview_split(db, source_id, assignments, resolutions=None):
    source_id = int(source_id)
    source = tx.get_node(db, source_id)
    if source['status'] not in ('active', 'paused'):
        raise tx.Conflict('来源标签不可拆分')
    resolutions = resolutions or {}
    members = _members(db, [source_id])
    clean, targets, conflicts, new_targets = {}, set(), [], {}
    nodes = _nodes(db)
    declaration_ids = {}
    for raw_mid, raw_targets in assignments.items():
        mid = int(raw_mid)
        if mid not in members:
            raise tx.Conflict('分配包含不属于原标签的素材')
        values = []
        for raw_target in raw_targets:
            if isinstance(raw_target, dict):
                spec = {k: raw_target[k] for k in ('name', 'parent_id', 'definition', 'recognition_text') if k in raw_target}
                spec['name'] = str(spec.get('name', '')).strip()
                spec['parent_id'] = int(spec['parent_id']) if spec.get('parent_id') is not None else None
                spec.setdefault('definition', '')
                spec.setdefault('recognition_text', '')
                if not spec['name'] or len(spec['name']) > 120:
                    raise tx.Conflict('新目标名称需为 1～120 字')
                if spec['parent_id'] is not None and tx.get_node(db, spec['parent_id'])['status'] != 'active':
                    raise tx.Conflict('新目标父级不可用')
                serialized = tx._json(spec)
                if serialized not in declaration_ids:
                    target = -(len(declaration_ids) + 1)
                    declaration_ids[serialized] = target
                    new_targets[str(target)] = spec
                    nodes[target] = {'id': target, 'name': spec['name'], 'parent_id': spec['parent_id'], 'status': 'active'}
                target = declaration_ids[serialized]
            else:
                target = int(raw_target)
                node = tx.get_node(db, target)
                if target == source_id or node['status'] not in ('active', 'paused'):
                    raise tx.Conflict('拆分目标不可用')
            if target not in values:
                values.append(target)
        for target in values:
            blocked = _blocked_virtual(db, nodes, mid, target) if target < 0 else tx._blocked(db, mid, target)
            if blocked:
                choice = _conflict(conflicts, resolutions, f'split:{mid}:{target}', 'manual_decision',
                                   f'素材 #{mid} 的拆分目标“{nodes[target]["name"]}”命中人工排除',
                                   [{'label': '明确解除冲突排除并转入目标', 'value': 'clear'},
                                    {'label': '不转移此目标，保留原标签', 'value': 'retain'}])
                if choice in (_UNRESOLVED, 'retain'):
                    continue
            targets.add(target)
        approved = [t for t in values if not (_blocked_virtual(db, nodes, mid, t) if t < 0 else tx._blocked(db, mid, t))
                    or resolutions.get(f'split:{mid}:{t}') == 'clear']
        if approved:
            clean[str(mid)] = approved
    if not clean and not conflicts:
        raise tx.Conflict('请选择至少一项明确分配')
    _validate_tree(nodes)
    existing = [t for t in targets if t > 0]
    parents = [spec['parent_id'] for spec in new_targets.values() if spec['parent_id'] is not None]
    scope = _scope(db, [source_id, *existing, *parents])
    before = {(r['media_id'], r['tag_id'], r['scope']): r['decision'] for r in db.execute(
        'SELECT * FROM taxonomy_decisions WHERE tag_id IN (' + ','.join('?' for _ in scope) + ')', scope)}
    after = dict(before)
    associations = {(r[0], r[1]) for r in db.execute('SELECT media_id,tag_id FROM media_tags WHERE tag_id IN (' +
                    ','.join('?' for _ in scope) + ')', scope)}
    exclusion_changes = []
    for raw_mid, approved in clean.items():
        mid = int(raw_mid)
        for target in approved:
            if resolutions.get(f'split:{mid}:{target}') == 'clear':
                _clear_exclusions(nodes, after, mid, target, exclusion_changes)
            after[(mid, target, 'direct')] = 'confirm'
            associations.add((mid, target))
        associations.discard((mid, source_id))
        for key, value in list(after.items()):
            if key[0] == mid and key[1] == source_id and value == 'confirm':
                after.pop(key)
    payload = {'scope': scope, 'source': source_id, 'assignments': clean, 'resolutions': resolutions,
               'target_ids': sorted(targets), 'new_targets': new_targets,
               'decision_deltas': _decision_changes(nodes, before, after),
               'association_deltas': _association_changes(db, scope, nodes, associations), 'exclusion_changes': exclusion_changes,
               'retained_count': len(members - {int(mid) for mid in clean})}
    return _store(db, 'split', payload, conflicts, members)


def _blocked_virtual(db, nodes, mid, tag_id):
    parents = []
    while tag_id is not None:
        parents.append(tag_id)
        tag_id = nodes[tag_id]['parent_id']
    existing = [i for i in parents if i > 0]
    if not existing:
        return False
    return bool(db.execute("SELECT 1 FROM taxonomy_decisions WHERE media_id=? AND scope='subtree' AND decision='exclude' AND tag_id IN (" +
                           ','.join('?' for _ in existing) + ')', [mid, *existing]).fetchone())


def _write_state(db, payload):
    scope = payload['scope']
    placeholders = ','.join('?' for _ in scope)
    old_decisions = {(r['media_id'], r['tag_id'], r['scope']): dict(r) for r in db.execute(
        'SELECT * FROM taxonomy_decisions WHERE tag_id IN (' + placeholders + ')', scope)}
    final = {(int(mid), int(tag), area): value for mid, tag, area, value in payload.get('final_decisions', [])}
    for key in sorted(set(old_decisions) | set(final)):
        before = old_decisions.get(key)
        after = final.get(key)
        if (before['decision'] if before else None) == after:
            continue
        mid, tag, area = key
        if after is None:
            db.execute('DELETE FROM taxonomy_decisions WHERE media_id=? AND tag_id=? AND scope=?', key)
        else:
            db.execute('INSERT INTO taxonomy_decisions(media_id,tag_id,scope,decision) VALUES (?,?,?,?) '
                       "ON CONFLICT(media_id,tag_id,scope) DO UPDATE SET decision=excluded.decision,version=version+1,updated_at=datetime('now')",
                       (mid, tag, area, after))
        db.execute('INSERT INTO taxonomy_decision_events(media_id,tag_id,action,scope,previous,current) VALUES (?,?,?,?,?,?)',
                   (mid, tag, 'reviewed_plan', area, tx._json(before or {}), tx._json({'decision': after})))
    old_associations = {(r[0], r[1]) for r in db.execute('SELECT media_id,tag_id FROM media_tags WHERE tag_id IN (' + placeholders + ')', scope)}
    final_associations = {(int(mid), int(tag)) for mid, tag in payload.get('final_associations', [])}
    db.executemany('DELETE FROM media_tags WHERE media_id=? AND tag_id=?', sorted(old_associations - final_associations))
    db.executemany('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES (?,?)', sorted(final_associations - old_associations))


def _write_node(db, tag_id, fields):
    values = {k: fields[k] for k in ('name', 'parent_id', 'definition', 'recognition_text', 'sort_order', 'status') if k in fields}
    if 'name' in values:
        values['normalized'] = tx.normalize(values['name'])
    if values:
        db.execute('UPDATE taxonomy_nodes SET ' + ','.join(k + '=?' for k in values) +
                   ",version=version+1,updated_at=datetime('now') WHERE id=?", [*values.values(), tag_id])
        from .taxonomy_relations import queue
        queue(db, tag_id)


def _execute_merge(db, payload):
    target, sources = payload['target'], payload['sources']
    for child, parent in payload['parents'].items():
        _write_node(db, int(child), {'parent_id': parent})
    for source in sources:
        node = tx.get_node(db, source)
        tx.add_expression(db, target, node['name'], 'merged')
        for alias in db.execute('SELECT text,origin FROM taxonomy_expressions WHERE tag_id=?', (source,)).fetchall():
            tx.add_expression(db, target, alias['text'], alias['origin'])
        for row in db.execute('SELECT * FROM taxonomy_sources WHERE tag_id=?', (source,)).fetchall():
            db.execute('INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?)',
                       (row['media_id'], target, row['origin'], f'merged:{source}:{row["source_key"]}', row['evidence']))
        for row in db.execute('SELECT * FROM taxonomy_examples WHERE tag_id=?', (source,)).fetchall():
            role = payload['example_roles'].get(str(row['media_id']), payload['example_roles'].get(row['media_id'], row['role']))
            prior = db.execute('SELECT role,input_revision FROM taxonomy_examples WHERE tag_id=? AND media_id=?', (target, row['media_id'])).fetchone()
            chosen_revision = row['input_revision']
            if prior and prior['role'] == role and (prior['input_revision'] == tx.input_revision(db, row['media_id'], 'image') or row['role'] != role):
                chosen_revision = prior['input_revision']
            db.execute('INSERT INTO taxonomy_examples(tag_id,media_id,role,input_revision) VALUES (?,?,?,?) '
                       "ON CONFLICT(tag_id,media_id) DO UPDATE SET role=excluded.role,input_revision=excluded.input_revision,updated_at=datetime('now')",
                       (target, row['media_id'], role, chosen_revision))
        # Retain original records as historical references; add canonical live edges.
        for row in db.execute('SELECT * FROM taxonomy_relations WHERE source_id=? OR target_id=?', (source, source)).fetchall():
            a = target if row['source_id'] in sources else row['source_id']
            b = target if row['target_id'] in sources else row['target_id']
            if a == b:
                continue
            a, b = sorted((a, b))
            db.execute('INSERT OR IGNORE INTO taxonomy_relations(source_id,target_id,kind,origin,evidence) VALUES (?,?,?,?,?)',
                       (a, b, row['kind'], row['origin'], row['evidence']))
        db.execute("UPDATE taxonomy_nodes SET status='merged',redirect_id=?,version=version+1,updated_at=datetime('now') WHERE id=?", (target, source))
    _write_state(db, payload)


def execute(db, kind, payload):
    """Apply only a server-stored, resolved plan; caller must compare snapshot."""
    if payload.get('engine') != ENGINE or payload.get('unresolved'):
        raise tx.Conflict('方案仍有未解决冲突，不能执行')
    with tx._savepoint(db):
        if kind == 'decision':
            tx.decide(db, payload['media_ids'], payload['tag_id'], payload['decision'],
                      payload['decision_scope'], payload.get('clear_exclusion', False))
        elif kind == 'edit':
            current = tx.get_node(db, payload['tag_id'])
            if current['version'] != payload['expected_version']:
                raise tx.Conflict('标签已改变，请重新预览')
            after = _nodes(db)
            after[payload['tag_id']].update(payload['fields'])
            _validate_tree(after)
            _write_node(db, payload['tag_id'], payload['fields'])
            _write_state(db, payload)
        elif kind == 'merge':
            _execute_merge(db, payload)
        elif kind == 'split':
            source = payload['source']
            created = {}
            used = {target for targets in payload['assignments'].values() for target in targets}
            for temporary, spec in payload.get('new_targets', {}).items():
                if int(temporary) in used:
                    created[int(temporary)] = tx.create_node(db, **spec)['id']
            payload['created_node_ids'] = sorted(created.values())
            payload['resolved_target_ids'] = sorted(created.get(t, t) for t in payload['target_ids'])
            for raw_mid, targets in payload['assignments'].items():
                mid = int(raw_mid)
                for original_target in targets:
                    target = created.get(original_target, original_target)
                    clear = payload['resolutions'].get(f'split:{mid}:{original_target}') == 'clear'
                    tx.decide(db, [mid], target, 'confirm', clear_exclusion=clear)
                    for row in db.execute('SELECT * FROM taxonomy_sources WHERE media_id=? AND tag_id=?', (mid, source)).fetchall():
                        db.execute('INSERT OR IGNORE INTO taxonomy_sources(media_id,tag_id,origin,source_key,evidence) VALUES (?,?,?,?,?)',
                                   (mid, target, row['origin'], f'split:{source}:{row["source_key"]}', row['evidence']))
                db.execute('DELETE FROM media_tags WHERE media_id=? AND tag_id=?', (mid, source))
                db.execute("DELETE FROM taxonomy_decisions WHERE media_id=? AND tag_id=? AND decision='confirm'", (mid, source))
            _write_node(db, source, {'status': 'paused'})
        else:
            raise tx.Conflict('未知方案类型')
        tx.touch_semantics(db)
    return {'created_node_ids': payload.get('created_node_ids', []), 'resolved_target_ids': payload.get('resolved_target_ids', payload.get('target_ids', []))}


def suggest(db, data):
    """Offer a draft from existing AI evidence; never create a node or association."""
    source_id = int(data['source_id'])
    source = tx.get_node(db, source_id)
    if source['status'] not in ('active', 'paused'):
        raise tx.Conflict('来源标签不可用于方案建议')
    kind = data.get('kind')
    from .taxonomy_relations import _context
    if kind == 'merge':
        # An accepted vocabulary relationship is local AI evidence, not an execution command.
        rows = db.execute("SELECT r.target_id,r.source_id,r.evidence FROM taxonomy_relations r WHERE (r.source_id=? OR r.target_id=?) AND r.origin IN ('ai','manual_review') AND r.kind='near' ORDER BY r.id DESC", (source_id, source_id)).fetchall()
        for row in rows:
            target = row['target_id'] if row['source_id'] == source_id else row['source_id']
            if tx.get_node(db, target)['status'] in ('active', 'paused') and target not in tx.descendants(db, source_id):
                return {'target_id': target, 'reason': '根据已审核的本地 AI 词关系生成建议；仍需检查定义与完整合并影响。', 'targets': [tx.get_node(db, target)]}
        suggestions = db.execute("SELECT target_id,evidence,revision FROM taxonomy_relation_suggestions WHERE tag_id=? AND kind='duplicate' AND target_id IS NOT NULL AND state!='rejected' ORDER BY id DESC", (source_id,)).fetchall()
        for suggestion in suggestions:
            target = suggestion['target_id']
            if tx.get_node(db, target)['status'] in ('active', 'paused') and target not in tx.descendants(db, source_id) and suggestion['revision'] == _context(db, source_id, target):
                return {'target_id': target, 'reason': '本地模型建议存在同义概念；建议本身没有执行权。', 'targets': [tx.get_node(db, target)]}
        raise tx.Conflict('尚无可用的本地 AI 关系依据，可先整理关系或手动选择合并目标')
    if kind != 'split':
        raise tx.Conflict('未知建议类型')
    targets = data.get('target_ids') or ([data['target_id']] if data.get('target_id') else [])
    if not targets:
        targets = [r['target_id'] for r in db.execute("SELECT target_id,revision FROM taxonomy_relation_suggestions WHERE tag_id=? AND kind IN ('related','near') AND target_id IS NOT NULL AND state!='rejected'", (source_id,))
                   if tx.get_node(db, r['target_id'])['status'] in ('active', 'paused') and r['revision'] == _context(db, source_id, r['target_id'])]
    targets = list(dict.fromkeys(int(i) for i in targets if int(i) != source_id))
    for target in targets:
        if tx.get_node(db, target)['status'] not in ('active', 'paused'):
            raise tx.Conflict('拆分目标不可用于新分配')
    if not targets:
        raise tx.Conflict('尚无明确拆分目标；可先建立或选择目标，模型缺失不影响手动拆分')
    members = _members(db, [source_id])
    selected = _ids(data['media_ids']) if data.get('media_ids') else sorted(members)
    if not set(selected) <= members:
        raise tx.Conflict('建议范围含非原标签素材')
    import numpy as np
    descriptions = {target: tx.recognition_description(db, tx.get_node(db, target)) for target in targets}
    text = {}
    for target in targets:
        revision = __import__('hashlib').sha256(descriptions[target].encode()).hexdigest()
        for row in db.execute('SELECT * FROM taxonomy_text_features WHERE tag_id=? AND text_revision=?', (target, revision)):
            text.setdefault(row['model_key'], {})[target] = dict(row)
    complete = {key: values for key, values in text.items() if len(values) == len(targets)}
    if not complete:
        raise tx.Conflict('缺少同模型的目标语义特征；请准备本地图文模型，或使用手动分配')
    key = sorted(complete)[0]
    vectors = {tag: np.frombuffer(row['vector'], dtype=np.float32) for tag, row in complete[key].items()}
    assignments, undecided, evidence = {}, [], []
    for mid in selected:
        row = db.execute('SELECT * FROM taxonomy_features WHERE media_id=? AND model_key=? AND input_revision=?',
                         (mid, key, tx.input_revision(db, mid, 'image'))).fetchone()
        if not row:
            undecided.append(mid)
            continue
        vector = np.frombuffer(row['vector'], dtype=np.float32)
        if not np.all(np.isfinite(vector)) or any(len(v) != len(vector) for v in vectors.values()):
            undecided.append(mid)
            continue
        scores = sorted(((float(vector @ v), tag) for tag, v in vectors.items()), reverse=True)
        if not scores or scores[0][0] <= 0 or any(not math.isfinite(score) for score, _ in scores) or len(scores) > 1 and abs(scores[0][0] - scores[1][0]) < 1e-6:
            undecided.append(mid)
            continue
        target = scores[0][1]
        if tx._blocked(db, mid, target):
            undecided.append(mid)
            continue
        assignments[str(mid)] = [target]
        evidence.append({'media_id': mid, 'target_id': target, 'similarity': scores[0][0]})
    return {'assignments': assignments, 'targets': [tx.get_node(db, t) for t in targets], 'undecided': undecided,
            'evidence': evidence, 'reason': '根据同一模型的缓存图文特征排序形成草案，相似度不是正确概率；请复核后再预览并确认。'}
