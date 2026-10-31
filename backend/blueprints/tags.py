from flask import Blueprint, request, jsonify
from ..db import get_db
from ..services import taxonomy as tx

bp = Blueprint('tags', __name__)


@bp.route('/')
def list_tags():
    db = get_db()
    rows = db.execute('SELECT t.id,COALESCE(n.name,t.name) name,COUNT(mt.media_id) usage_count '
        'FROM tags t LEFT JOIN taxonomy_nodes n ON n.id=t.id LEFT JOIN media_tags mt ON mt.tag_id=t.id '
        "WHERE COALESCE(n.status,'active')!='merged' GROUP BY t.id ORDER BY name,t.id").fetchall()
    return jsonify({'data':[dict(r) for r in rows]})


@bp.route('/', methods=['POST'])
def create_tag():
    db=get_db(); data=request.get_json(silent=True) or {}
    if not str(data.get('name','')).strip(): return jsonify({'error':'Name required'}),400
    try:
        with db: node=tx.create_node(db,data['name'])
        return jsonify({'id':node['id'],'name':node['name']}),201
    except tx.Conflict as exc:
        return jsonify({'error':str(exc)}),409


@bp.route('/<int:tag_id>', methods=['DELETE'])
def delete_tag(tag_id):
    db=get_db()
    try:
        with db:
            node=tx._ensure_node(db,tag_id)
            if len(tx.descendants(db,tag_id))>1:
                raise tx.Conflict('包含子标签，请从标签维护预览影响后停用')
            affected=[r[0] for r in db.execute('SELECT media_id FROM media_tags WHERE tag_id=?',(tag_id,))]
            tx.decide(db,affected,tag_id,'exclude')
            tx.update_node(db,tag_id,{'status':'inactive'},node['version'])
        return jsonify({'ok':True})
    except tx.Conflict as exc:
        return jsonify({'error':str(exc)}),409


@bp.route('/assign', methods=['POST'])
def assign_tags():
    db=get_db(); data=request.get_json(silent=True) or {}; mid=data.get('media_id')
    if not mid: return jsonify({'error':'media_id required'}),400
    try:
        with db:
            for name in data.get('tags',[]):
                name=str(name).strip()
                if not name: continue
                nodes=tx.resolve(db,name)
                if len(nodes)>1: raise tx.Conflict('标签有多种含义，请在标签树选择完整路径')
                node=nodes[0] if nodes else tx.create_node(db,name)
                tx.decide(db,[mid],node['id'],'confirm')
        return jsonify({'ok':True})
    except tx.Conflict as exc:
        return jsonify({'error':str(exc)}),409
