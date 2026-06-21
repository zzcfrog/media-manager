import json
import os
from collections import defaultdict

import numpy as np
from flask import Blueprint, request, jsonify, Response
from loguru import logger
import jieba

from ..db import get_db

# Core CRUD routes for the media library: list, detail, import, scan, delete,
# batch operations, duplicate detection, folder tree, and XMP sidecar export.


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
    exclude_ids = request.args.get("exclude_ids", "").strip()

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
    elif favorite == "false":
        where_clauses.append("favorite = 0")
    if analysis_status == "analyzed":
        where_clauses.append("analysis_status = 'done'")
    elif analysis_status == "not_analyzed":
        where_clauses.append("(analysis_status IS NULL OR analysis_status != 'done')")
    if folder:
        where_clauses.append("file_path LIKE ?")
        params.append(folder.rstrip("/") + "/%")
    if exclude_ids:
        ids = [x.strip() for x in exclude_ids.split(",") if x.strip().isdigit()]
        if ids:
            placeholders = ",".join("?" * len(ids))
            where_clauses.append(f"id NOT IN ({placeholders})")
            params.extend(ids)

    if q:
        seg_q = _segment_query(q)
        where_clauses.append(
            "id IN (SELECT media_id FROM media_fts WHERE media_fts MATCH ?)"
        )
        params.append(seg_q)

    where = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    order_expr = "(width * height)" if sort == "resolution" else sort

    total = db.execute(f"SELECT COUNT(*) FROM media{where}", params).fetchone()[0]

    # IDs-only mode (for select-all without loading full data)
    if request.args.get("fields") == "id":
        rows = db.execute(f"SELECT id FROM media{where}", params).fetchall()
        return jsonify({"data": [r["id"] for r in rows], "total": total})

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


@bp.route("/segment-stats", methods=["POST"])
def segment_stats():
    """Return segment statistics for a list of media IDs (no project required)."""
    media_ids = request.json.get("media_ids") or []
    if not media_ids:
        return jsonify({"total_segments": 0, "total_duration": 0, "video_count": 0, "image_count": 0,
                         "mood_distribution": {}, "scene_distribution": {}, "shot_distribution": {}, "asr_count": 0})
    db = get_db()
    placeholders = ",".join("?" * len(media_ids))
    # Media type counts
    media_rows = db.execute(f"SELECT media_type FROM media WHERE id IN ({placeholders})", media_ids).fetchall()
    video_count = sum(1 for r in media_rows if r["media_type"] == "video")
    image_count = sum(1 for r in media_rows if r["media_type"] == "image")
    # Segment stats
    rows = db.execute(
        f"SELECT mood, scene_type, asr, shot_type, time_start, time_end "
        f"FROM media_segment WHERE media_id IN ({placeholders})",
        media_ids,
    ).fetchall()
    total_segments = len(rows)
    total_duration = 0.0
    mood_dist = {}
    scene_dist = {}
    shot_dist = {}
    asr_count = 0
    for r in rows:
        try:
            ts = _parse_seg_time(r["time_start"])
            te = _parse_seg_time(r["time_end"])
            total_duration += te - ts
        except (ValueError, TypeError):
            pass
        if r["mood"]:
            mood_dist[r["mood"]] = mood_dist.get(r["mood"], 0) + 1
        if r["scene_type"]:
            scene_dist[r["scene_type"]] = scene_dist.get(r["scene_type"], 0) + 1
        if r["shot_type"]:
            shot_dist[r["shot_type"]] = shot_dist.get(r["shot_type"], 0) + 1
        if r["asr"]:
            asr_count += 1
    return jsonify({
        "total_segments": total_segments,
        "total_duration": round(total_duration, 1),
        "video_count": video_count,
        "image_count": image_count,
        "mood_distribution": mood_dist,
        "scene_distribution": scene_dist,
        "shot_distribution": shot_dist,
        "asr_count": asr_count,
    })


def _parse_seg_time(s):
    """Parse MM:SS.ss or HH:MM:SS.ss to seconds."""
    if not s:
        return 0.0
    parts = s.split(":")
    if len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    return 0.0


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
            "directCount": dir_counts.get(d, 0),
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
    media.pop("embedding", None)
    return jsonify(media)


@bp.route("/batch-get", methods=["POST"])
def batch_get():
    """Return basic info for multiple media items in one request."""
    ids = request.get_json().get("ids", [])
    if not ids:
        return jsonify([])
    placeholders = ",".join("?" * len(ids))
    db = get_db()
    rows = db.execute(f"SELECT id, file_name, media_type FROM media WHERE id IN ({placeholders})", ids).fetchall()
    return jsonify([dict(r) for r in rows])


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


@bp.route("/import-batch", methods=["POST"])
def import_batch():
    from flask import stream_with_context
    from ..services.importer import _import_one
    from pathlib import Path

    data = request.get_json()
    paths = data.get("paths", [])
    if not paths:
        return jsonify({"error": "No paths"}), 400

    def generate():
        db = get_db()
        imported = []
        failed = []
        done_count = 0

        for p in paths:
            done_count += 1
            filepath = Path(p)
            try:
                result = _import_one(db, filepath)
                if result:
                    result.pop("embedding", None)
                    imported.append(result)
                    yield f"data: {json.dumps({'type': 'ok', 'data': result, 'done': done_count, 'total': len(paths)})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'skip', 'done': done_count, 'total': len(paths)})}\n\n"
            except Exception as e:
                logger.exception("batch import failed: {} — {}", p, e)
                failed.append({"file_path": p, "error": str(e)})
                yield f"data: {json.dumps({'type': 'fail', 'file_path': p, 'error': str(e), 'done': done_count, 'total': len(paths)})}\n\n"

        logger.info("batch import done: {} imported, {} failed", len(imported), len(failed))
        db.commit()
        yield f"data: {json.dumps({'type': 'done', 'imported': len(imported), 'failed': len(failed)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


@bp.route("/<int:media_id>/reveal", methods=["POST"])
def reveal_file(media_id):
    import subprocess, sys
    db = get_db()
    row = db.execute("SELECT file_path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    path = row["file_path"]
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        elif sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", path])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/scan", methods=["POST"])
def scan_paths():
    from ..services.importer import scan_only
    data = request.get_json()
    paths = data.get("paths", [])
    result, skipped = scan_only(paths)
    return jsonify({"data": result, "skipped": skipped})


@bp.route("/backfill-embeddings", methods=["POST"])
def backfill_embeddings():
    from ..services.embedding import compute_embedding
    from pathlib import Path
    db = get_db()
    db.execute("PRAGMA busy_timeout = 30000")
    rows = db.execute(
        "SELECT id, file_path, media_type, duration, embedding FROM media "
        "WHERE embedding IS NULL AND media_type = 'image'"
    ).fetchall()
    count = 0
    for row in rows:
        fp = Path(row["file_path"])
        if not fp.exists():
            continue
        emb = compute_embedding(fp, "image")
        if emb:
            db.execute("UPDATE media SET embedding = ? WHERE id = ?", (emb, row["id"]))
            db.commit()
            count += 1
    return jsonify({"ok": True, "count": count})


@bp.route("/backfill-thumbnails", methods=["POST"])
def backfill_thumbnails():
    from ..services.importer import _generate_thumbnail
    from ..config import THUMB_DIR
    from pathlib import Path
    force = request.args.get("force") == "1" or request.get_json(silent=True, force=True) and request.get_json().get("force")
    db = get_db()
    if force:
        rows = db.execute("SELECT id, file_path, media_type, thumbnail_path FROM media").fetchall()
    else:
        rows = db.execute(
            "SELECT id, file_path, media_type, thumbnail_path FROM media "
            "WHERE thumbnail_path IS NULL OR thumbnail_path = ''"
        ).fetchall()
        existing = db.execute("SELECT id, file_path, media_type, thumbnail_path FROM media WHERE thumbnail_path IS NOT NULL").fetchall()
        for r in existing:
            if r["thumbnail_path"] and not (THUMB_DIR / r["thumbnail_path"]).exists():
                rows.append(r)
    count = 0
    for row in rows:
        fp = Path(row["file_path"])
        if not fp.exists():
            continue
        thumb = _generate_thumbnail(fp, row["media_type"])
        if thumb:
            if row["thumbnail_path"]:
                old = THUMB_DIR / row["thumbnail_path"]
                if old.exists():
                    old.unlink(missing_ok=True)
            # Fix width/height: read raw dimensions from exiftool, apply orientation swap
            if row["media_type"] == "image":
                import subprocess, json, shutil
                w, h = None, None
                orient = 1
                if shutil.which("exiftool"):
                    try:
                        cmd = ["exiftool", "-json", "-ImageWidth", "-ImageHeight", "-Orientation", str(fp)]
                        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                        if r.returncode == 0:
                            data = json.loads(r.stdout)[0]
                            w = int(data["ImageWidth"]) if data.get("ImageWidth") else None
                            h = int(data["ImageHeight"]) if data.get("ImageHeight") else None
                            o = data.get("Orientation", "")
                            s = str(o).strip()
                            if s.isdigit():
                                orient = int(s)
                            elif "90" in s:
                                orient = 6
                            elif "180" in s:
                                orient = 3
                            elif "270" in s:
                                orient = 8
                    except Exception:
                        pass
                # Fallback to ffprobe if exiftool didn't give dimensions
                if not w or not h:
                    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
                           "-show_streams", str(fp)]
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                    if r.returncode == 0:
                        vs = json.loads(r.stdout).get("streams", [{}])[0]
                        w = vs.get("width")
                        h = vs.get("height")
                if w and h:
                    if orient in (5, 6, 7, 8):
                        w, h = h, w
                    db.execute("UPDATE media SET thumbnail_path = ?, width = ?, height = ? WHERE id = ?",
                               (thumb, w, h, row["id"]))
                else:
                    db.execute("UPDATE media SET thumbnail_path = ? WHERE id = ?", (thumb, row["id"]))
            else:
                db.execute("UPDATE media SET thumbnail_path = ? WHERE id = ?", (thumb, row["id"]))
            count += 1
    db.commit()
    return jsonify({"ok": True, "count": count})
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


def _fetch_embedding_rows(db):
    rows = db.execute(
        "SELECT id, file_path, file_name, media_type, file_size, embedding, thumbnail_path "
        "FROM media WHERE embedding IS NOT NULL"
    ).fetchall()
    return rows


def _rows_to_groups(rows, indices_groups, sim_matrix=None, vecs=None):
    groups = []
    for indices in indices_groups:
        if len(indices) < 2:
            continue
        k = len(indices)
        if sim_matrix is not None:
            sub = sim_matrix[np.ix_(indices, indices)]
            avg_sim = float((sub.sum() - k) / (k * (k - 1)))
        elif vecs is not None:
            cv = vecs[indices]
            sims = cv @ cv.T
            avg_sim = float((sims.sum() - k) / (k * (k - 1))) if k > 1 else 1.0
        else:
            avg_sim = 1.0
        items = []
        for i in indices:
            d = dict(rows[i])
            d.pop("embedding", None)
            items.append(d)
        groups.append({"similarity": round(avg_sim * 100), "items": items})
    groups.sort(key=lambda g: (-len(g["items"]), -g["similarity"]))
    return groups


def _attach_excluded(groups, excluded_pairs, id_map, id_to_row):
    """Attach excluded photo info to each group based on exclusion pairs."""
    if not excluded_pairs:
        return groups
    for group in groups:
        group_ids = set(item["id"] for item in group["items"])
        excluded_map = {}  # excluded_id -> { ...item, excluded_with: [group_member_ids] }
        for a, b in excluded_pairs:
            in_a, in_b = a in group_ids, b in group_ids
            if in_a and not in_b:
                eid, with_id = b, a
            elif in_b and not in_a:
                eid, with_id = a, b
            else:
                continue
            if eid not in excluded_map:
                row = id_to_row.get(eid)
                if row:
                    excluded_map[eid] = {"id": eid, "file_name": row["file_name"], "excluded_with": [with_id]}
            else:
                excluded_map[eid]["excluded_with"].append(with_id)
        group["excluded"] = list(excluded_map.values())
    return groups


def _union_find_groups(sim_matrix, threshold, id_map=None, excluded_pairs=None):
    n = len(sim_matrix)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[a] = b

    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i][j] >= threshold:
                if excluded_pairs and id_map:
                    aid, bid = id_map[i], id_map[j]
                    key = (min(aid, bid), max(aid, bid))
                    if key in excluded_pairs:
                        continue
                union(i, j)

    cluster_map = {}
    for i in range(n):
        cluster_map.setdefault(find(i), []).append(i)
    return [v for v in cluster_map.values() if len(v) >= 2]


def _load_exclusions(db, dup_type):
    rows = db.execute(
        "SELECT media_id_a, media_id_b FROM dup_exclusions WHERE dup_type = ?",
        (dup_type,),
    ).fetchall()
    return {(r["media_id_a"], r["media_id_b"]) for r in rows}


@bp.route("/duplicates")
def find_duplicates():
    db = get_db()
    dup_type = request.args.get("type", "similar")
    excluded = _load_exclusions(db, dup_type)

    rows = _fetch_embedding_rows(db)
    if not rows:
        return jsonify({"groups": []})

    id_map = [r["id"] for r in rows]
    vecs = np.array([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])

    # Build id -> row mapping for excluded photo lookups
    id_to_row = {}
    for r in rows:
        d = dict(r)
        d.pop("embedding", None)
        id_to_row[r["id"]] = d

    if dup_type == "cluster":
        import hdbscan
        labels = hdbscan.HDBSCAN(min_cluster_size=2, metric="euclidean").fit_predict(vecs)
        indices_groups = [
            [i for i, l in enumerate(labels) if l == label]
            for label in set(labels) if label != -1
        ]
        # Post-process: split groups that contain excluded pairs
        if excluded:
            sim_matrix = vecs @ vecs.T
            split_groups = []
            for group in indices_groups:
                if len(group) < 2:
                    continue
                sub_sim = sim_matrix[np.ix_(group, group)]
                sub_ids = [id_map[i] for i in group]
                sub_excl = set()
                for ai in range(len(group)):
                    for bi in range(ai + 1, len(group)):
                        key = (min(sub_ids[ai], sub_ids[bi]), max(sub_ids[ai], sub_ids[bi]))
                        if key in excluded:
                            sub_excl.add((ai, bi))
                if not sub_excl:
                    split_groups.append(group)
                else:
                    # Re-run union-find on subgroup without excluded pairs
                    sub_parent = list(range(len(group)))
                    def sfind(x):
                        while sub_parent[x] != x:
                            sub_parent[x] = sub_parent[sub_parent[x]]
                            x = sub_parent[x]
                        return x
                    for ai in range(len(group)):
                        for bi in range(ai + 1, len(group)):
                            if (ai, bi) in sub_excl:
                                continue
                            if sub_sim[ai][bi] >= 0.5:
                                a, b = sfind(ai), sfind(bi)
                                if a != b:
                                    sub_parent[a] = b
                    sub_map = {}
                    for ai in range(len(group)):
                        sub_map.setdefault(sfind(ai), []).append(group[ai])
                    split_groups.extend(v for v in sub_map.values() if len(v) >= 2)
            return jsonify({"groups": _attach_excluded(_rows_to_groups(rows, split_groups, vecs=vecs), excluded, id_map, id_to_row)})

        return jsonify({"groups": _attach_excluded(_rows_to_groups(rows, indices_groups, vecs=vecs), excluded, id_map, id_to_row)})

    # near (0.96) or similar (0.90) — union-find on cosine similarity
    threshold = 0.96 if dup_type == "near" else 0.90
    sim_matrix = vecs @ vecs.T
    indices_groups = _union_find_groups(sim_matrix, threshold, id_map, excluded)
    return jsonify({"groups": _attach_excluded(_rows_to_groups(rows, indices_groups, sim_matrix=sim_matrix), excluded, id_map, id_to_row)})


@bp.route("/<int:media_id>/similar")
def find_similar(media_id):
    db = get_db()
    source = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not source:
        return jsonify({"error": "Not found"}), 404
    if not source["embedding"]:
        return jsonify({"source": dict(source), "near": [], "similar": [], "cluster": []})

    rows = _fetch_embedding_rows(db)
    id_list = [r["id"] for r in rows]
    if media_id not in id_list:
        return jsonify({"source": dict(source), "near": [], "similar": [], "cluster": []})

    source_idx = id_list.index(media_id)
    vecs = np.array([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    source_vec = vecs[source_idx]

    excluded_near = _load_exclusions(db, "near")
    excluded_similar = _load_exclusions(db, "similar")
    excluded_cluster = _load_exclusions(db, "cluster")

    def _item(row, similarity=None):
        d = dict(row)
        d.pop("embedding", None)
        if similarity is not None:
            d["similarity"] = round(float(similarity), 4)
        return d

    def _excluded(pair_set, a, b):
        return (min(a, b), max(a, b)) in pair_set

    # near (0.96) and similar (0.90)
    sims = vecs @ source_vec
    near_items, similar_items = [], []
    for i in range(len(rows)):
        if i == source_idx:
            continue
        sid = id_list[i]
        s = float(sims[i])
        if s >= 0.96 and not _excluded(excluded_near, media_id, sid):
            near_items.append(_item(rows[i], s))
        if s >= 0.90 and not _excluded(excluded_similar, media_id, sid):
            similar_items.append(_item(rows[i], s))
    near_items.sort(key=lambda x: -x.get("similarity", 0))
    similar_items.sort(key=lambda x: -x.get("similarity", 0))

    # cluster
    cluster_items = []
    try:
        import hdbscan
        labels = hdbscan.HDBSCAN(min_cluster_size=2, metric="euclidean").fit_predict(vecs)
        src_label = labels[source_idx]
        if src_label != -1:
            for i in range(len(rows)):
                if i == source_idx:
                    continue
                if labels[i] != src_label:
                    continue
                sid = id_list[i]
                if _excluded(excluded_cluster, media_id, sid):
                    continue
                cluster_items.append(_item(rows[i]))
    except Exception:
        pass

    return jsonify({
        "source": _item(source),
        "near": near_items,
        "similar": similar_items,
        "cluster": cluster_items,
    })


@bp.route("/dup-exclusions", methods=["POST"])
def add_dup_exclusions():
    data = request.get_json()
    pairs = data.get("pairs", [])
    dup_type = data.get("dup_type", "similar")
    if not pairs:
        return jsonify({"error": "No pairs"}), 400
    db = get_db()
    for a, b in pairs:
        lo, hi = min(a, b), max(a, b)
        db.execute(
            "INSERT OR IGNORE INTO dup_exclusions (media_id_a, media_id_b, dup_type) VALUES (?, ?, ?)",
            (lo, hi, dup_type),
        )
    db.commit()
    return jsonify({"ok": True})


@bp.route("/dup-exclusions", methods=["DELETE"])
def reset_dup_exclusions():
    dup_type = request.args.get("dup_type")
    db = get_db()
    if dup_type:
        db.execute("DELETE FROM dup_exclusions WHERE dup_type = ?", (dup_type,))
    else:
        db.execute("DELETE FROM dup_exclusions")
    db.commit()
    return jsonify({"ok": True})


@bp.route("/dup-exclusions/pairs", methods=["DELETE"])
def remove_dup_exclusion_pairs():
    data = request.get_json()
    pairs = data.get("pairs", [])
    dup_type = data.get("dup_type", "similar")
    db = get_db()
    for a, b in pairs:
        lo, hi = min(a, b), max(a, b)
        db.execute("DELETE FROM dup_exclusions WHERE media_id_a = ? AND media_id_b = ? AND dup_type = ?",
                   (lo, hi, dup_type))
    db.commit()
    return jsonify({"ok": True, "count": len(pairs)})


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
        logger.error("XMP write failed: media_id={} — {}", media_id, e)
        return jsonify({"error": str(e)}), 500

    if ok:
        db.execute("UPDATE media SET has_xmp = 1 WHERE id = ?", (media_id,))
        db.commit()
        logger.info("XMP written: media_id={}", media_id)
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
    logger.info("batch XMP written: {} images", count)
    return jsonify({"ok": True, "count": count})


@bp.route("/set-file-date-from-exif", methods=["POST"])
def set_file_date_from_exif():
    """用拍摄时间（DB date_taken，已含 CreateDate 回退）覆盖文件的创建时间和修改时间。

    时区：date_taken 是相机本地时间，exiftool `-FileCreateDate=` 按本机时区写入，
    Finder 即显示为拍摄本地日期（不做 UTC 换算，避免日期错位）。无 date_taken 或
    文件缺失的跳过。exiftool 不在则 500。该操作直接改文件系统时间戳，不可逆。
    """
    import shutil
    import subprocess

    db = get_db()
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    if not ids:
        return jsonify({"error": "No ids"}), 400
    if not shutil.which("exiftool"):
        return jsonify({"error": "exiftool not found"}), 500

    placeholders = ",".join("?" * len(ids))
    rows = db.execute(
        f"SELECT id, file_path, date_taken FROM media WHERE id IN ({placeholders})", ids
    ).fetchall()

    updated = 0
    skipped = 0
    errors = 0
    for r in rows:
        path = r["file_path"]
        dt = (r["date_taken"] or "").strip()
        if not path or not os.path.exists(path) or not dt:
            skipped += 1
            continue
        # ISO '2024-08-17 15:40:39' → exiftool '2024:08:17 15:40:39'
        exif_dt = dt.replace("-", ":", 2)
        cmd = [
            "exiftool", "-overwrite_original", "-q", "-q",
            f"-FileCreateDate={exif_dt}", f"-FileModifyDate={exif_dt}", path,
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if proc.returncode == 0:
                updated += 1
                # 文件 mtime 已被改成拍摄时间，同步 DB file_mtime 避免下次扫描误判变更
                try:
                    db.execute("UPDATE media SET file_mtime = ? WHERE id = ?", (os.path.getmtime(path), r["id"]))
                except OSError:
                    pass
            else:
                errors += 1
        except Exception:
            errors += 1

    db.commit()
    logger.info("set-file-date-from-exif: ids={} updated={} skipped={} errors={}", len(ids), updated, skipped, errors)
    return jsonify({"ok": True, "updated": updated, "skipped": skipped, "errors": errors})


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
    from ..services.importer import _delete_media_records
    db = get_db()
    row = db.execute("SELECT thumbnail_path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    _delete_media_records(db, [media_id], [row["thumbnail_path"]])
    db.commit()
    return jsonify({"ok": True})


@bp.route("/folder", methods=["DELETE"])
def delete_folder():
    """Remove all media under a folder path (including subfolders)."""
    from ..services.importer import _delete_media_records
    data = request.get_json()
    path = data.get("path") if data else None
    if not path:
        return jsonify({"error": "Missing path"}), 400
    db = get_db()
    like = str(path) + "/%"
    rows = db.execute(
        "SELECT id, thumbnail_path FROM media WHERE file_path LIKE ? OR file_path = ?",
        (like, str(path)),
    ).fetchall()
    _delete_media_records(db, [r["id"] for r in rows], [r["thumbnail_path"] for r in rows])
    db.commit()
    return jsonify({"ok": True, "count": len(rows)})


@bp.route("/sync-folder", methods=["POST"])
def sync_folder():
    """Scan a folder: import new files, update changed files, remove deleted files. SSE stream."""
    from flask import stream_with_context
    from ..services.importer import _import_one, _collect_files, _delete_media_records, VIDEO_EXTS, IMAGE_EXTS
    from pathlib import Path
    import json as _json

    data = request.get_json()
    path = data.get("path") if data else None
    if not path:
        return jsonify({"error": "Missing path"}), 400
    logger.info("sync-folder: {}", path)

    # Scan disk files outside generator (no DB needed)
    disk_files = set()
    for f in _collect_files([path]):
        if f.suffix.lower() in (VIDEO_EXTS | IMAGE_EXTS):
            disk_files.add(str(f))
    work = sorted(disk_files)

    def generate():
        db = get_db()

        # Get all DB records for this folder
        like = str(path) + "/%"
        db_rows = db.execute(
            "SELECT id, file_path, thumbnail_path FROM media WHERE file_path LIKE ? OR file_path = ?",
            (like, str(path)),
        ).fetchall()
        db_paths = {r["file_path"]: r for r in db_rows}

        # Remove records for files no longer on disk
        removed_ids, removed_thumbs = [], []
        for r in db_rows:
            if r["file_path"] not in disk_files:
                removed_ids.append(r["id"])
                removed_thumbs.append(r["thumbnail_path"])
        if removed_ids:
            _delete_media_records(db, removed_ids, removed_thumbs)
            db.commit()

        new_count, updated_count, fail_count, skip_count = 0, 0, 0, 0
        for fp_str in work:
            filepath = Path(fp_str)
            is_new = fp_str not in db_paths
            try:
                result = _import_one(db, filepath, force_update=True)
                if result:
                    row = db.execute("SELECT * FROM media WHERE id = ?", (result["id"],)).fetchone()
                    item = dict(row) if row else {}
                    item.pop("embedding", None)
                    if is_new:
                        new_count += 1
                        yield f"data: {_json.dumps({'type': 'ok', 'item': item, 'status': 'new'})}\n\n"
                    else:
                        updated_count += 1
                        yield f"data: {_json.dumps({'type': 'ok', 'item': item, 'status': 'updated'})}\n\n"
                else:
                    skip_count += 1
                    yield f"data: {_json.dumps({'type': 'skip', 'file': filepath.name})}\n\n"
            except Exception as e:
                fail_count += 1
                yield f"data: {_json.dumps({'type': 'fail', 'file': filepath.name, 'error': str(e)})}\n\n"
        db.commit()
        logger.info("sync-folder done: added={}, updated={}, removed={}, failed={}", new_count, updated_count, len(removed_ids), fail_count)
        summary = {"added": new_count, "updated": updated_count, "removed": len(removed_ids), "skipped": skip_count, "failed": fail_count}
        yield f"data: {_json.dumps({'type': 'done', 'summary': summary})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
        db.execute(f"DELETE FROM media_segment WHERE media_id IN ({placeholders})", ids)
        db.execute(f"DELETE FROM media_fts WHERE media_id IN ({placeholders})", ids)
        for mid in ids:
            db.execute("DELETE FROM dup_exclusions WHERE media_id_a = ? OR media_id_b = ?", (mid, mid))
        db.execute(f"DELETE FROM media WHERE id IN ({placeholders})", ids)

    db.commit()
    return jsonify({"ok": True})
