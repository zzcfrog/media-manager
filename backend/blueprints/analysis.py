from flask import Blueprint, request, jsonify, Response, current_app
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from loguru import logger
from pathlib import Path

from ..db import get_db, get_setting
from ..compressor import compress_video, compress_image
from ..config import HEIF_EXTS, ANALYSIS_API_CONCURRENCY, ANALYSIS_THREAD_POOL_SIZE
from ..analyzer import analyze_video, analyze_image, CODING_BASE_URL
from ..asr import get_engine as get_asr_engine, preload_all, reload_engine

bp = Blueprint("analysis", __name__)

_api_semaphore = threading.Semaphore(ANALYSIS_API_CONCURRENCY)
_analysis_pool = ThreadPoolExecutor(max_workers=ANALYSIS_THREAD_POOL_SIZE)
_active_progress = {}  # media_id → progress dict (registered by thread, cleaned up on exit)


_SEGMENT_COLS = "id, media_id, time_start, time_end, visual, asr, subtitle, dominant_colors, main_subjects, shot_type, focal_length, camera_angle, camera_movement, perspective, scene_type, mood, lighting, weather, color_tone, tone, dof, style, composition, seq"


def _cleanup_temp(path):
    if path and Path(path).exists():
        try:
            Path(path).unlink()
        except OSError:
            pass


@bp.route("/<int:media_id>")
def get_analysis(media_id):
    db = get_db()
    row = db.execute("SELECT analysis_model, analysis_date, analysis_status FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    seg_rows = db.execute(f"SELECT {_SEGMENT_COLS} FROM media_segment WHERE media_id = ? ORDER BY seq, id", (media_id,)).fetchall()
    segments = [_segment_to_dict(r) for r in seg_rows]
    return jsonify({
        "status": row["analysis_status"],
        "model": row["analysis_model"],
        "date": row["analysis_date"],
        "segments": segments,
    })


@bp.route("/progress")
def get_progress():
    result = []
    db = get_db()
    for mid, p in dict(_active_progress).items():
        item = {"id": mid, "step": p.get("step", ""), "media_type": p.get("media_type", "")}
        media = db.execute("SELECT file_name FROM media WHERE id = ?", (mid,)).fetchone()
        if media:
            item["file_name"] = media["file_name"]
        if p.get("step") == "compressing":
            item["compress_pct"] = p.get("compress_pct", 0)
        if p.get("step") == "analyzing":
            item["substep"] = p.get("substep", "uploading")
            item["chars"] = p.get("chars", 0)
        result.append(item)
    return jsonify(result)


@bp.route("/<int:media_id>", methods=["DELETE"])
def delete_analysis(media_id):
    db = get_db()
    media = db.execute("SELECT id FROM media WHERE id = ?", (media_id,)).fetchone()
    if not media:
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM media_segment WHERE media_id = ?", (media_id,))
    db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    db.execute("UPDATE media SET analysis_status = 'none', analysis_model = NULL, analysis_date = NULL WHERE id = ?", (media_id,))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:media_id>", methods=["POST"])
def start_analysis(media_id):
    logger.info("API start_analysis: media_id={}", media_id)
    db = get_db()
    media = db.execute("SELECT id, file_path, media_type FROM media WHERE id = ?", (media_id,)).fetchone()
    if not media:
        return jsonify({"error": "Not found"}), 404

    app = current_app._get_current_object()

    if media["media_type"] == "video":
        return _start_video_analysis(media_id, media, app)
    elif media["media_type"] == "image":
        return _start_image_analysis(media_id, media, app)
    else:
        return jsonify({"error": "Unsupported media type"}), 400


@bp.route("/batch", methods=["POST"])
def start_batch_analysis():
    ids = request.json.get("ids", [])
    skip_done = request.json.get("skip_done", False)
    logger.info("API start_batch_analysis: ids={} skip_done={}", ids, skip_done)
    if not ids:
        return jsonify({"error": "No ids provided"}), 400

    db = get_db()
    app = current_app._get_current_object()
    submitted = []

    for media_id in ids:
        media = db.execute(
            "SELECT id, file_path, media_type, analysis_status FROM media WHERE id = ?",
            (media_id,),
        ).fetchone()
        if not media:
            continue
        if media["analysis_status"] == "processing":
            continue
        if skip_done and media["analysis_status"] == "done":
            continue

        file_path = media["file_path"]
        db.execute("UPDATE media SET analysis_status = 'processing' WHERE id = ?", (media_id,))
        db.commit()
        progress = {"step": "queued", "substep": "uploading", "chars": 0}

        if media["media_type"] == "video":
            api_key = get_setting(db, "video_api_key", "")
            model = get_setting(db, "model", "glm-4.6v")
            resolution = get_setting(db, "resolution", "480")
            fps = get_setting(db, "fps", "30")
            hw_accel = get_setting(db, "hw_accel", "false") == "true"
            use_multimodal = get_setting(db, "use_multimodal", "true") == "true"
            asr_engine_name = get_setting(db, "asr_engine", "whisper")
            _analysis_pool.submit(_process_video, media_id, file_path, api_key, model,
                        resolution, fps, hw_accel, use_multimodal, asr_engine_name, app, progress)
        elif media["media_type"] == "image":
            image_api_key = get_setting(db, "image_api_key", "")
            image_model = get_setting(db, "image_model", "glm-4.6v")
            image_resolution = get_setting(db, "image_resolution", "1920")
            _analysis_pool.submit(_process_image, media_id, file_path, image_api_key, image_model,
                        image_resolution, app, progress)

        submitted.append(media_id)

    logger.info("API start_batch_analysis done: submitted={} skipped={}", submitted, len(ids) - len(submitted))
    return jsonify({"submitted": submitted, "skipped": len(ids) - len(submitted)})


def _sse(event_dict):
    return f"data: {json.dumps(event_dict, ensure_ascii=False)}\n\n"


# ---------------------------------------------------------------------------
# Thread functions: ALL work (compress + API + ASR + save) runs here.
# Generator only polls the shared progress dict and yields SSE.
# ---------------------------------------------------------------------------

def _process_video(media_id, file_path, api_key, model, resolution, fps, hw_accel,
                   use_multimodal, asr_engine_name, app, progress):
    """Full video pipeline in a thread: compress → VLM (semaphore) → ASR → save."""
    _active_progress[media_id] = progress
    progress["media_type"] = "video"
    progress["step"] = "queued"
    logger.info("Video analysis thread started: media_id={} file={}", media_id, Path(file_path).name)
    compressed_path = None
    try:
        with app.app_context():
            # --- Compress (parallel OK) ---
            progress["step"] = "compressing"

            def on_compress(pct):
                progress["compress_pct"] = pct

            compressed_path, compress_time, cw, ch, cfps = compress_video(
                file_path, resolution=resolution, fps=fps,
                on_progress=on_compress, hw_accel=hw_accel,
            )
            size_mb = compressed_path.stat().st_size / (1024 * 1024)
            size_bytes = compressed_path.stat().st_size
            progress["compressed_info"] = {
                "message": f"压缩完成: {size_mb:.1f}MB, 耗时 {compress_time:.1f}s",
                "width": cw, "height": ch, "fps": cfps, "size_bytes": size_bytes,
            }
            progress["compress_time"] = compress_time

            # --- VLM Analyze (bounded by API concurrency) ---
            _api_semaphore.acquire()
            try:
                progress["step"] = "analyzing"

                def on_analyze_progress(status, chars=0):
                    if status == "first_token":
                        progress["substep"] = "receiving"
                    elif status == "receiving":
                        progress["substep"] = "receiving"
                        progress["chars"] = chars

                segments, analyze_time, usage = analyze_video(
                    str(compressed_path), api_key, model=model,
                    base_url=CODING_BASE_URL, multimodal=use_multimodal,
                    on_progress=on_analyze_progress,
                )
            finally:
                _api_semaphore.release()

            # --- ASR (parallel OK) ---
            if not use_multimodal:
                asr_engine = get_asr_engine(asr_engine_name) if asr_engine_name else None
                if asr_engine:
                    try:
                        asr_model_name = get_setting(get_db(), "asr_model", "large-v3")
                        asr_segments = asr_engine.transcribe(str(compressed_path), model_name=asr_model_name)
                        if asr_segments:
                            _merge_asr(segments, asr_segments)
                    except Exception as e:
                        logger.error("ASR failed: {}", e)

            # --- Save ---
            save_segments(media_id, segments, model=model)
            progress["step"] = "done"
            logger.info("Video analysis thread done: media_id={} segments={}", media_id, len(segments))
            progress["result"] = {"segments": segments, "analyze_time": analyze_time, "usage": usage}
    except Exception as e:
        logger.error("Video processing failed: media_id={} file={} error={}", media_id, Path(file_path).name, e)
        try:
            with app.app_context():
                db = get_db()
                db.execute("UPDATE media SET analysis_status = 'error' WHERE id = ?", (media_id,))
                db.commit()
        except Exception:
            pass
        progress["step"] = "error"
        progress["error"] = str(e)
    finally:
        if compressed_path:
            _cleanup_temp(str(compressed_path))
        _active_progress.pop(media_id, None)
        logger.info("Video analysis thread exited: media_id={}", media_id)


def _process_image(media_id, file_path, image_api_key, model, image_resolution,
                   app, progress):
    """Full image pipeline in a thread: compress → VLM (semaphore) → save."""
    _active_progress[media_id] = progress
    progress["media_type"] = "image"
    progress["step"] = "queued"
    logger.info("Image analysis thread started: media_id={} file={}", media_id, Path(file_path).name)
    analyze_path = file_path
    compressed = False
    try:
        with app.app_context():
            needs_compress = image_resolution != "original" or Path(file_path).suffix.lower() in HEIF_EXTS
            if needs_compress:
                progress["step"] = "compressing"
                cp, compress_time = compress_image(file_path, max_long_edge=int(image_resolution) if image_resolution != "original" else 99999)
                analyze_path = str(cp)
                compressed = True
                size_kb = cp.stat().st_size / 1024
                progress["compressed_info"] = {
                    "message": f"压缩完成: {size_kb:.0f}KB, 耗时 {compress_time:.1f}s",
                }

            # VLM Analyze (bounded by API concurrency)
            _api_semaphore.acquire()
            try:
                progress["step"] = "analyzing"

                def on_progress(status, chars=0):
                    if status == "first_token":
                        progress["substep"] = "receiving"
                    elif status == "receiving":
                        progress["substep"] = "receiving"
                        progress["chars"] = chars

                result, analyze_time, usage = analyze_image(
                    analyze_path, image_api_key,
                    model=model, base_url=CODING_BASE_URL, on_progress=on_progress,
                )
            finally:
                _api_semaphore.release()

            segments = [result]
            save_segments(media_id, segments, model=model)
            progress["step"] = "done"
            logger.info("Image analysis thread done: media_id={}", media_id)
            progress["result"] = {"analyze_time": analyze_time, "usage": usage}
    except Exception as e:
        logger.error("Image processing failed: media_id={} file={} error={}", media_id, Path(file_path).name, e)
        try:
            with app.app_context():
                db = get_db()
                db.execute("UPDATE media SET analysis_status = 'error' WHERE id = ?", (media_id,))
                db.commit()
        except Exception:
            pass
        progress["step"] = "error"
        progress["error"] = str(e)
    finally:
        if compressed:
            _cleanup_temp(analyze_path)
        _active_progress.pop(media_id, None)
        logger.info("Image analysis thread exited: media_id={}", media_id)


# ---------------------------------------------------------------------------
# SSE generators: only poll progress dict and yield events.
# All real work is in the thread functions above.
# ---------------------------------------------------------------------------

def _start_image_analysis(media_id, media, app):
    db = get_db()
    model = get_setting(db, "image_model", "glm-4.6v")
    image_api_key = get_setting(db, "image_api_key", "")
    if not image_api_key:
        return jsonify({"error": "图片 API Key 未设置，请在设置中配置"}), 400
    image_resolution = get_setting(db, "image_resolution", "1920")
    file_path = media["file_path"]

    db.execute("UPDATE media SET analysis_status = 'processing' WHERE id = ?", (media_id,))
    db.commit()

    def generate():
        progress = {"step": "queued", "substep": "uploading", "chars": 0}
        _analysis_pool.submit(_process_image, media_id, file_path, image_api_key, model,
                    image_resolution, app, progress)

        emitted = {"compress_start": False, "compressed": False, "analyze_start": False}
        while progress["step"] not in ("done", "error"):
            step = progress["step"]
            if step == "queued":
                yield _sse({'type': 'progress', 'step': 'queued', 'message': '排队等待中...'})
            elif step == "compressing":
                if not emitted["compress_start"]:
                    emitted["compress_start"] = True
                    yield _sse({'type': 'progress', 'step': 'compressing',
                                'message': f'压缩图片至 {image_resolution}px...'})
            elif step == "analyzing":
                if not emitted["compressed"]:
                    emitted["compressed"] = True
                    ci = progress.get("compressed_info")
                    if ci:
                        yield _sse({'type': 'progress', 'step': 'compressed', **ci})
                if not emitted["analyze_start"]:
                    emitted["analyze_start"] = True
                    yield _sse({'type': 'progress', 'step': 'analyzing',
                                'message': f'调用 {model} 分析中...'})
                yield _sse({'type': 'progress', 'step': 'analyzing',
                            'substep': progress.get('substep', 'uploading'),
                            'chars': progress.get('chars', 0)})
            time.sleep(0.3)

        pool.shutdown(wait=False)
        if progress["step"] == "done":
            r = progress.get("result", {})
            yield _sse({'type': 'done', 'message': '分析完成',
                        'analyze_time': round(r.get('analyze_time', 0), 1),
                        'tokens': r.get('usage'), 'segments_count': 1})
        else:
            yield _sse({'type': 'error', 'message': progress.get('error', 'Unknown error')})

    return Response(generate(), mimetype="text/event-stream")


def _start_video_analysis(media_id, media, app):
    db = get_db()
    model = get_setting(db, "model", "glm-4.6v")
    resolution = get_setting(db, "resolution", "480")
    fps = get_setting(db, "fps", "30")
    use_multimodal = get_setting(db, "use_multimodal", "true") == "true"
    asr_engine_name = get_setting(db, "asr_engine", "whisper")
    api_key = get_setting(db, "video_api_key", "")
    if not api_key:
        return jsonify({"error": "API Key 未设置，请在设置中配置"}), 400
    hw_accel = get_setting(db, "hw_accel", "false") == "true"
    file_path = media["file_path"]

    def generate():
        progress = {"step": "queued", "compress_pct": 0, "substep": "uploading", "chars": 0}
        _analysis_pool.submit(_process_video, media_id, file_path, api_key, model,
                    resolution, fps, hw_accel, use_multimodal, asr_engine_name,
                    app, progress)

        emitted = {"compress_start": False, "compressed": False, "analyze_start": False}
        while progress["step"] not in ("done", "error"):
            step = progress["step"]
            if step == "queued":
                yield _sse({'type': 'progress', 'step': 'queued', 'message': '排队等待中...'})
            elif step == "compressing":
                if not emitted["compress_start"]:
                    emitted["compress_start"] = True
                    yield _sse({'type': 'progress', 'step': 'compressing',
                                'message': '压缩视频中...'})
                yield _sse({'type': 'progress', 'step': 'compressing',
                            'percent': round(progress.get('compress_pct', 0), 1)})
            elif step == "analyzing":
                if not emitted["compressed"]:
                    emitted["compressed"] = True
                    ci = progress.get("compressed_info")
                    if ci:
                        yield _sse({'type': 'progress', 'step': 'compressed', **ci})
                if not emitted["analyze_start"]:
                    emitted["analyze_start"] = True
                    msg = f'AI 综合分析中（{model}）...' if use_multimodal else f'调用 {model} 分析中...'
                    yield _sse({'type': 'progress', 'step': 'analyzing', 'message': msg})
                yield _sse({'type': 'progress', 'step': 'analyzing',
                            'substep': progress.get('substep', 'uploading'),
                            'chars': progress.get('chars', 0)})
            time.sleep(0.3)

        pool.shutdown(wait=False)
        if progress["step"] == "done":
            r = progress.get("result", {})
            yield _sse({'type': 'done', 'message': '分析完成',
                        'compress_time': round(progress.get('compress_time', 0), 1),
                        'analyze_time': round(r.get('analyze_time', 0), 1),
                        'tokens': r.get('usage'),
                        'segments_count': len(r.get('segments', []))})
        else:
            yield _sse({'type': 'error', 'message': progress.get('error', 'Unknown error')})

    return Response(generate(), mimetype="text/event-stream")


def _parse_time(ts: str) -> float:
    parts = ts.split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    return float(ts)


def _merge_asr(vlm_segments, asr_segments):
    for asr in asr_segments:
        try:
            asr_start = _parse_time(asr.time_start)
            asr_end = _parse_time(asr.time_end)
        except (ValueError, IndexError):
            continue
        best_seg = None
        best_overlap = 0
        for seg in vlm_segments:
            try:
                seg_start = _parse_time(seg.get("time_start", "0"))
                seg_end = _parse_time(seg.get("time_end", "0"))
            except (ValueError, IndexError):
                continue
            overlap = min(asr_end, seg_end) - max(asr_start, seg_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_seg = seg
        if best_seg and best_overlap > 0:
            if best_seg.get("asr"):
                best_seg["asr"] += "; " + asr.text
            else:
                best_seg["asr"] = asr.text


def _normalize_timestamp(ts: str) -> str:
    """Fix timestamps where seconds >= 60 or minutes >= 60 (LLM output error)."""
    try:
        parts = ts.split(":")
        if len(parts) == 3:
            h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
            total = h * 3600 + m * 60 + s
        elif len(parts) == 2:
            total = float(parts[0]) * 60 + float(parts[1])
        else:
            return ts
        h = int(total // 3600)
        m = int((total % 3600) // 60)
        s = total % 60
        return f"{h:02d}:{m:02d}:{s:05.2f}"
    except (ValueError, IndexError):
        return ts


def save_segments(media_id, segments, model=""):
    db = get_db()
    db.execute("DELETE FROM media_segment WHERE media_id = ?", (media_id,))

    for i, seg in enumerate(segments):
        db.execute(
            "INSERT INTO media_segment (media_id, time_start, time_end, visual, asr, subtitle, dominant_colors, main_subjects, shot_type, focal_length, camera_angle, camera_movement, perspective, scene_type, mood, lighting, weather, color_tone, tone, dof, style, composition, seq) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                media_id,
                _normalize_timestamp(seg.get("time_start", "")),
                _normalize_timestamp(seg.get("time_end", "")),
                seg.get("visual", ""),
                seg.get("asr", ""),
                seg.get("subtitle", ""),
                json.dumps(seg.get("dominant_colors", []), ensure_ascii=False),
                json.dumps(seg.get("main_subjects", []), ensure_ascii=False),
                seg.get("shot_type", ""),
                seg.get("focal_length", ""),
                seg.get("camera_angle", ""),
                seg.get("camera_movement", ""),
                seg.get("perspective", ""),
                seg.get("scene_type", ""),
                seg.get("mood", ""),
                seg.get("lighting", ""),
                seg.get("weather", ""),
                seg.get("color_tone", ""),
                seg.get("tone", ""),
                seg.get("dof", ""),
                seg.get("style", ""),
                seg.get("composition", ""),
                i,
            ),
        )

    db.execute(
        "UPDATE media SET analysis_status = 'done', analysis_model = ?, analysis_date = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        (model, media_id),
    )
    _refresh_fts(db, media_id, segments)
    db.commit()


def _refresh_fts(db, media_id, segments):
    from .library import _segment
    visual, asr, subtitle = [], [], []
    subjects, colors = set(), set()
    for seg in segments:
        if seg.get("visual"):
            visual.append(seg["visual"])
        if seg.get("asr") and seg["asr"] != "无":
            asr.append(seg["asr"])
        if seg.get("subtitle") and seg["subtitle"] != "无":
            subtitle.append(seg["subtitle"])
        for s in seg.get("main_subjects", []):
            subjects.add(s)
        for c in seg.get("dominant_colors", []):
            colors.add(c)
    row = db.execute("SELECT file_name FROM media WHERE id = ?", (media_id,)).fetchone()
    file_name = row["file_name"] if row else ""
    tag_rows = db.execute(
        "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
        (media_id,),
    ).fetchall()
    tags_str = " ".join(r["name"] for r in tag_rows)

    db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    db.execute(
        "INSERT INTO media_fts (media_id, file_name, visual, asr, subtitle, subjects, colors, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (media_id, _segment(file_name), _segment(" ".join(visual)), _segment(" ".join(asr)),
         _segment(" ".join(subtitle)), _segment(" ".join(subjects)), _segment(" ".join(colors)), _segment(tags_str)),
    )


def _segment_to_dict(row):
    d = dict(row)
    for col in ("dominant_colors", "main_subjects"):
        v = d.get(col, "")
        if isinstance(v, str) and v:
            try:
                d[col] = json.loads(v)
            except json.JSONDecodeError:
                d[col] = [v]
        elif not v:
            d[col] = []
    return d


_EDITABLE_COLS = {
    "time_start", "time_end", "visual", "asr", "subtitle", "shot_type", "focal_length",
    "camera_angle", "camera_movement", "perspective", "scene_type",
    "mood", "lighting", "weather", "color_tone", "tone", "dof", "style", "composition",
    "dominant_colors", "main_subjects",
}


@bp.route("/<int:media_id>/segments/<int:seg_id>", methods=["PATCH"])
def update_segment(media_id, seg_id):
    db = get_db()
    row = db.execute("SELECT id FROM media_segment WHERE id = ? AND media_id = ?", (seg_id, media_id)).fetchone()
    if not row:
        return jsonify({"error": "Segment not found"}), 404

    data = request.get_json()
    fields, params = [], []
    for col in _EDITABLE_COLS:
        if col not in data:
            continue
        val = data[col]
        if col in ("dominant_colors", "main_subjects"):
            val = json.dumps(val if isinstance(val, list) else [val], ensure_ascii=False)
        fields.append(f"{col} = ?")
        params.append(val)

    if not fields:
        return jsonify({"error": "No fields to update"}), 400

    params.append(seg_id)
    db.execute(f"UPDATE media_segment SET {', '.join(fields)} WHERE id = ?", params)

    segments = [_segment_to_dict(r) for r in db.execute(f"SELECT {_SEGMENT_COLS} FROM media_segment WHERE media_id = ? ORDER BY seq", (media_id,)).fetchall()]
    _refresh_fts(db, media_id, segments)
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:media_id>/segments/<int:seg_id>", methods=["DELETE"])
def delete_segment(media_id, seg_id):
    db = get_db()
    seg = db.execute("SELECT id, seq, time_start, time_end FROM media_segment WHERE id = ? AND media_id = ?", (seg_id, media_id)).fetchone()
    if not seg:
        return jsonify({"error": "Segment not found"}), 404

    adjust = request.args.get("adjust", "")

    if adjust == "prev":
        prev = db.execute("SELECT id FROM media_segment WHERE media_id = ? AND seq < ? ORDER BY seq DESC LIMIT 1", (media_id, seg["seq"])).fetchone()
        if prev:
            db.execute("UPDATE media_segment SET time_end = ? WHERE id = ?", (seg["time_end"], prev["id"]))
    elif adjust == "next":
        nxt = db.execute("SELECT id FROM media_segment WHERE media_id = ? AND seq > ? ORDER BY seq ASC LIMIT 1", (media_id, seg["seq"])).fetchone()
        if nxt:
            db.execute("UPDATE media_segment SET time_start = ? WHERE id = ?", (seg["time_start"], nxt["id"]))

    db.execute("DELETE FROM media_segment WHERE id = ?", (seg_id,))

    segments = [_segment_to_dict(r) for r in db.execute(f"SELECT {_SEGMENT_COLS} FROM media_segment WHERE media_id = ? ORDER BY seq, id", (media_id,)).fetchall()]
    _refresh_fts(db, media_id, segments)
    db.commit()
    return jsonify({"ok": True})


@bp.route("/asr-reload", methods=["POST"])
def asr_reload():
    data = request.get_json(force=True)
    model_name = data.get("asr_model", "large-v3")
    engine_name = data.get("asr_engine", "whisper")
    logger.info("ASR model reload requested: {} {}", engine_name, model_name)
    reload_engine(engine_name, model_name)
    return jsonify({"ok": True, "message": f"Reloading {engine_name} model: {model_name}"})
