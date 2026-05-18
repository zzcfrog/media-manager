import os
from collections import defaultdict

from flask import Blueprint, request, jsonify
import jieba

from ..db import get_db


def _segment(text):
    return " ".join(jieba.cut(text))


def _segment_query(q):
    words = [w.strip() for w in jieba.cut(q) if w.strip() and w.strip() not in ("，", "。", "、", "的", "了", "在", "是", "和", "与", "有", "被", "把", "让", "向", "从", "到", "为", "着", "也", "都", "又", "而", "及", "等", "中", "上", "下", "里")]
    return " AND ".join(words) if words else q


bp = Blueprint("library", __name__)


@bp.route("/")
def list_media():
    db = get_db()
    page = max(1, request.args.get("page", 1, type=int))
    per_page = max(1, min(200, request.args.get("per_page", 50, type=int)))
    sort = request.args.get("sort", "imported_at")
    order = "ASC" if request.args.get("order") == "asc" else "DESC"
    media_type = request.args.get("media_type")
    rating = request.args.get("rating", type=int)
    color_label = request.args.get("color_label")
    favorite = request.args.get("favorite")
    analysis_status = request.args.get("analysis_status")
    folder = request.args.get("folder")
    q = request.args.get("q", "").strip()

    allowed_sorts = {"imported_at", "date_taken", "rating", "file_name", "file_size", "duration", "resolution"}
    if sort not in allowed_sorts:
        sort = "imported_at"

    where_clauses = []
    params = []

    if media_type and media_type != "all":
        where_clauses.append("media_type = ?")
        params.append(media_type)
    if rating is not None:
        where_clauses.append("rating >= ?")
        params.append(rating)
    if color_label:
        where_clauses.append("color_label = ?")
        params.append(color_label)
    if favorite == "true":
        where_clauses.append("favorite = 1")
    if analysis_status == "analyzed":
        where_clauses.append("analysis_status = 'done'")
    if folder:
        where_clauses.append("file_path LIKE ?")
        params.append(folder.rstrip("/") + "/%")

    if q:
        seg_q = _segment_query(q)
        where_clauses.append(
            "id IN (SELECT media_id FROM media_fts WHERE media_fts MATCH ?)"
        )
        params.append(seg_q)

    where = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    order_expr = "(width * height)" if sort == "resolution" else sort

    total = db.execute(f"SELECT COUNT(*) FROM media{where}", params).fetchone()[0]

    rows = db.execute(
        f"SELECT * FROM media{where} ORDER BY {order_expr} {order} LIMIT ? OFFSET ?",
        params + [per_page, (page - 1) * per_page],
    ).fetchall()

    data = []
    for r in rows:
        d = dict(r)
        d.pop("embedding", None)
        data.append(d)

    return jsonify({
        "data": data,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page,
        },
    })


@bp.route("/folders")
def list_folders():
    db = get_db()
    rows = db.execute("SELECT file_path FROM media").fetchall()

    if not rows:
        return jsonify({"data": []})

    dir_counts = defaultdict(int)
    for row in rows:
        d = os.path.dirname(row["file_path"])
        dir_counts[d] += 1

    all_dirs = set(dir_counts.keys())
    for d in list(all_dirs):
        parts = d.split("/")
        for i in range(2, len(parts) + 1):
            all_dirs.add("/" + "/".join(parts[1:i]))

    total_counts = dict(dir_counts)
    for d in sorted(all_dirs, key=lambda x: x.count("/"), reverse=True):
        parent = os.path.dirname(d)
        if parent and parent in all_dirs:
            total_counts[parent] = total_counts.get(parent, 0) + total_counts.get(d, 0)

    nodes = {}
    for d in sorted(all_dirs, key=lambda x: x.count("/")):
        label = d.split("/")[-1] if "/" in d else d
        nodes[d] = {
            "label": label,
            "path": d,
            "totalCount": total_counts.get(d, 0),
            "children": [],
        }

    roots = []
    for d in sorted(all_dirs):
        node = nodes[d]
        parent = os.path.dirname(d)
        if parent and parent in nodes:
            nodes[parent]["children"].append(node)
        else:
            roots.append(node)

    return jsonify({"data": roots})


@bp.route("/<int:media_id>")
def get_media(media_id):
    db = get_db()
    row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    media = dict(row)
    tags = db.execute(
        "SELECT t.id, t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
        (media_id,),
    ).fetchall()
    media["tags"] = [dict(t) for t in tags]
    return jsonify(media)


@bp.route("/import-one", methods=["POST"])
def import_one():
    from ..services.importer import import_single_file
    data = request.get_json()
    file_path = data.get("path", "")
    if not file_path:
        return jsonify({"error": "No path"}), 400
    result = import_single_file(file_path)
    if result:
        return jsonify({"data": result})
    return jsonify({"data": None})


@bp.route("/scan", methods=["POST"])
def scan_paths():
    from ..services.importer import scan_only
    data = request.get_json()
    paths = data.get("paths", [])
    result, skipped = scan_only(paths)
    return jsonify({"data": result, "skipped": skipped})


@bp.route("/backfill-hashes", methods=["POST"])
def backfill_hashes():
    from ..services.importer import _compute_file_hash, _compute_phash
    from ..services.embedding import compute_embedding
    from pathlib import Path
    db = get_db()
    rows = db.execute("SELECT id, file_path, media_type, duration, file_hash, phash, embedding FROM media WHERE file_hash IS NULL OR phash IS NULL OR (embedding IS NULL AND media_type = 'image')").fetchall()
    count = 0
    for row in rows:
        fp = Path(row["file_path"])
        if not fp.exists():
            continue
        fh = _compute_file_hash(fp) if row["file_hash"] is None else row["file_hash"]
        ph = _compute_phash(fp, row["media_type"], row["duration"]) if row["phash"] is None else row["phash"]
        emb = compute_embedding(fp, row["media_type"], row["duration"]) if row["media_type"] == "image" and row["embedding"] is None else row["embedding"]
        db.execute("UPDATE media SET file_hash = ?, phash = ?, embedding = ? WHERE id = ?", (fh, ph, emb, row["id"]))
        count += 1
    db.commit()
    return jsonify({"ok": True, "count": count})


@bp.route("/backfill-picture-control", methods=["POST"])
def backfill_picture_control():
    from ..services.importer import _run_exiftool, _apply_exif_tags
    from pathlib import Path
    db = get_db()
    rows = db.execute("SELECT id, file_path, camera_make FROM media WHERE picture_control IS NULL").fetchall()
    count = 0
    for row in rows:
        fp = Path(row["file_path"])
        if not fp.exists():
            continue
        meta = {"picture_control": None, "camera_make": row["camera_make"]}
        tags = _run_exiftool(fp)
        if tags:
            _apply_exif_tags(tags, meta)
        # DJI fallback: filename _D suffix
        if not meta["picture_control"] and meta["camera_make"] == "DJI" and fp.stem.endswith("_D"):
            meta["picture_control"] = "D-Log M"
        if meta["picture_control"]:
            db.execute("UPDATE media SET picture_control = ? WHERE id = ?", (meta["picture_control"], row["id"]))
            count += 1
    db.commit()
    return jsonify({"ok": True, "count": count})


@bp.route("/duplicates")
def find_duplicates():
    db = get_db()
    dup_type = request.args.get("type", "exact")

    if dup_type == "exact":
        rows = db.execute(
            "SELECT id, file_path, file_name, media_type, file_size, file_hash, thumbnail_path "
            "FROM media WHERE file_hash IS NOT NULL AND file_hash IN "
            "(SELECT file_hash FROM media WHERE file_hash IS NOT NULL GROUP BY file_hash HAVING COUNT(*) > 1) "
            "ORDER BY file_hash, id"
        ).fetchall()
        groups = []
        current = None
        for r in rows:
            if current is None or current["hash"] != r["file_hash"]:
                current = {"hash": r["file_hash"], "items": []}
                groups.append(current)
            current["items"].append(dict(r))
        groups.sort(key=lambda g: (-len(g["items"]),))
        return jsonify({"groups": groups})

    else:  # similar — HDBSCAN clustering on ResNet50 embeddings
        import numpy as np
        import hdbscan

        rows = db.execute(
            "SELECT id, file_path, file_name, media_type, file_size, embedding, thumbnail_path "
            "FROM media WHERE embedding IS NOT NULL"
        ).fetchall()
        if not rows:
            return jsonify({"groups": []})

        vecs = np.array([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
        clusterer = hdbscan.HDBSCAN(min_cluster_size=2, metric="euclidean")
        labels = clusterer.fit_predict(vecs)

        groups = []
        for label in set(labels):
            if label == -1:
                continue
            indices = [i for i, l in enumerate(labels) if l == label]
            # Compute average pairwise cosine similarity within cluster
            cluster_vecs = vecs[indices]
            n = len(indices)
            sims = cluster_vecs @ cluster_vecs.T
            avg_sim = float((sims.sum() - n) / (n * (n - 1))) if n > 1 else 1.0
            items = []
            for i in indices:
                d = dict(rows[i])
                d.pop("embedding", None)
                items.append(d)
            groups.append({
                "similarity": round(avg_sim * 100),
                "items": items,
            })
        groups.sort(key=lambda g: (-len(g["items"]), -g["similarity"]))
        return jsonify({"groups": groups})


@bp.route("/<int:media_id>/write-xmp", methods=["POST"])
def write_xmp(media_id):
    from ..services.xmp_writer import write_xmp as _write_xmp
    from pathlib import Path
    db = get_db()
    row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    if row["media_type"] == "video":
        return jsonify({"error": "Video not supported"}), 400

    tags = db.execute(
        "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
        (media_id,),
    ).fetchall()
    tag_names = [t["name"] for t in tags]

    seg = db.execute(
        "SELECT visual, dominant_colors, main_subjects, scene_type, mood, weather, lighting FROM media_segment WHERE media_id = ? ORDER BY seq LIMIT 1",
        (media_id,),
    ).fetchone()
    description = seg["visual"] if seg else ""

    # Collect analysis keywords from segment fields
    if seg:
        import json
        for col in ("dominant_colors", "main_subjects"):
            try:
                vals = json.loads(seg[col]) if seg[col] else []
            except (json.JSONDecodeError, TypeError):
                vals = [seg[col]] if seg[col] else []
            tag_names.extend(v for v in vals if v)
        for col in ("scene_type", "mood", "weather", "lighting"):
            if seg[col]:
                tag_names.append(seg[col])

    try:
        ok = _write_xmp(
            Path(row["file_path"]),
            rating=row["rating"] or 0,
            tags=tag_names,
            description=description,
            color_label=row["color_label"],
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if ok:
        db.execute("UPDATE media SET has_xmp = 1 WHERE id = ?", (media_id,))
        db.commit()
    return jsonify({"ok": ok})


@bp.route("/batch-write-xmp", methods=["POST"])
def batch_write_xmp():
    from ..services.xmp_writer import write_xmp as _write_xmp
    from pathlib import Path
    db = get_db()
    data = request.get_json()
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No ids"}), 400

    count = 0
    for mid in ids:
        row = db.execute("SELECT * FROM media WHERE id = ?", (mid,)).fetchone()
        if not row or row["media_type"] == "video":
            continue

        tags = db.execute(
            "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
            (mid,),
        ).fetchall()
        tag_names = [t["name"] for t in tags]

        seg = db.execute(
            "SELECT visual, dominant_colors, main_subjects, scene_type, mood, weather, lighting FROM media_segment WHERE media_id = ? ORDER BY seq LIMIT 1",
            (mid,),
        ).fetchone()
        description = seg["visual"] if seg else ""

        if seg:
            import json
            for col in ("dominant_colors", "main_subjects"):
                try:
                    vals = json.loads(seg[col]) if seg[col] else []
                except (json.JSONDecodeError, TypeError):
                    vals = [seg[col]] if seg[col] else []
                tag_names.extend(v for v in vals if v)
            for col in ("scene_type", "mood", "weather", "lighting"):
                if seg[col]:
                    tag_names.append(seg[col])

        try:
            ok = _write_xmp(
                Path(row["file_path"]),
                rating=row["rating"] or 0,
                tags=tag_names,
                description=description,
                color_label=row["color_label"],
            )
            if ok:
                db.execute("UPDATE media SET has_xmp = 1 WHERE id = ?", (mid,))
                count += 1
        except Exception:
            continue

    db.commit()
    return jsonify({"ok": True, "count": count})


@bp.route("/<int:media_id>", methods=["PATCH"])
def update_media(media_id):
    db = get_db()
    data = request.get_json()
    fields = []
    params = []
    for col in ("rating", "color_label", "favorite", "notes"):
        if col in data:
            fields.append(f"{col} = ?")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    fields.append("updated_at = datetime('now')")
    params.append(media_id)
    db.execute(f"UPDATE media SET {', '.join(fields)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:media_id>", methods=["DELETE"])
def delete_media(media_id):
    db = get_db()
    row = db.execute("SELECT thumbnail_path FROM media WHERE id = ?", (media_id,)).fetchone()
    if row and row["thumbnail_path"]:
        from ..config import THUMB_DIR
        thumb = THUMB_DIR / row["thumbnail_path"]
        if thumb.exists():
            thumb.unlink()
    db.execute("DELETE FROM media_tags WHERE media_id = ?", (media_id,))
    db.execute("DELETE FROM collection_items WHERE media_id = ?", (media_id,))
    db.execute("DELETE FROM media_segment WHERE media_id = ?", (media_id,))
    db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    db.execute("DELETE FROM media WHERE id = ?", (media_id,))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/batch", methods=["POST"])
def batch_update():
    db = get_db()
    data = request.get_json()
    ids = data.get("ids", [])
    action = data.get("action")
    value = data.get("value")
    if not ids or not action:
        return jsonify({"error": "Missing ids or action"}), 400

    placeholders = ",".join("?" * len(ids))

    if action == "rate":
        db.execute(f"UPDATE media SET rating = ?, updated_at = datetime('now') WHERE id IN ({placeholders})", [value] + ids)
    elif action == "color_label":
        db.execute(f"UPDATE media SET color_label = ?, updated_at = datetime('now') WHERE id IN ({placeholders})", [value] + ids)
    elif action == "favorite":
        db.execute(f"UPDATE media SET favorite = ?, updated_at = datetime('now') WHERE id IN ({placeholders})", [value] + ids)
    elif action == "delete":
        rows = db.execute(f"SELECT thumbnail_path FROM media WHERE id IN ({placeholders})", ids).fetchall()
        for row in rows:
            if row["thumbnail_path"]:
                from ..config import THUMB_DIR
                thumb = THUMB_DIR / row["thumbnail_path"]
                if thumb.exists():
                    thumb.unlink()
        db.execute(f"DELETE FROM media_tags WHERE media_id IN ({placeholders})", ids)
        db.execute(f"DELETE FROM collection_items WHERE media_id IN ({placeholders})", ids)
        db.execute(f"DELETE FROM media_segment WHERE media_id IN ({placeholders})", ids)
        db.execute(f"DELETE FROM media_fts WHERE media_id IN ({placeholders})", ids)
        db.execute(f"DELETE FROM media WHERE id IN ({placeholders})", ids)

    db.commit()
    return jsonify({"ok": True})
