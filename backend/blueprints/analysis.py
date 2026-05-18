from flask import Blueprint, request, jsonify, Response, current_app
import os, json, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..db import get_db, get_setting
from ..compressor import compress_video, compress_image
from ..analyzer import analyze_video, analyze_image, CODING_BASE_URL
from ..asr import get_engine as get_asr_engine

bp = Blueprint("analysis", __name__)

_SEGMENT_COLS = "id, media_id, time_start, time_end, visual, asr, subtitle, dominant_colors, main_subjects, shot_type, focal_length, camera_angle, camera_movement, perspective, scene_type, mood, lighting, weather, seq"


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
        with app.app_context():
            try:
                analyze_path = file_path

                if image_resolution != "original":
                    max_edge = int(image_resolution)
                    yield f"data: {json.dumps({'type': 'progress', 'step': 'compressing', 'message': f'压缩图片至 {max_edge}px...'}, ensure_ascii=False)}\n\n"
                    cp, compress_time = compress_image(file_path, max_long_edge=max_edge)
                    compressed_path_holder[0] = str(cp)
                    analyze_path = str(cp)
                    size_kb = cp.stat().st_size / 1024
                    yield f"data: {json.dumps({'type': 'progress', 'step': 'compressed', 'message': f'压缩完成: {size_kb:.0f}KB, 耗时 {compress_time:.1f}s'}, ensure_ascii=False)}\n\n"

                yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'message': f'调用 {model} 分析中...'}, ensure_ascii=False)}\n\n"

                substep = {"name": "uploading", "chars": 0}

                def on_img_progress(status, chars=0):
                    if status == "first_token":
                        substep["name"] = "receiving"
                    elif status == "receiving":
                        substep["name"] = "receiving"
                        substep["chars"] = chars

                pool = ThreadPoolExecutor(max_workers=1)
                future = pool.submit(
                    analyze_image, analyze_path, image_api_key,
                    model=model, base_url=CODING_BASE_URL, on_progress=on_img_progress,
                )

                while not future.done():
                    yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'substep': substep['name'], 'chars': substep['chars']}, ensure_ascii=False)}\n\n"
                    time.sleep(0.5)

                result, analyze_time, usage = future.result()
                pool.shutdown(wait=False)

                segments = [result]
                save_segments(media_id, segments, model=model)

                usage_dict = None
                if usage:
                    usage_dict = usage

                yield f"data: {json.dumps({'type': 'done', 'message': '分析完成', 'analyze_time': round(analyze_time, 1), 'tokens': usage_dict, 'segments_count': 1}, ensure_ascii=False)}\n\n"
            except Exception as e:
                db = get_db()
                db.execute("UPDATE media SET analysis_status = 'error' WHERE id = ?", (media_id,))
                db.commit()
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            finally:
                cp = compressed_path_holder[0]
                if cp and Path(cp).exists():
                    try:
                        Path(cp).unlink()
                    except OSError:
                        pass

    def _cleanup_temp(path):
        if path and Path(path).exists():
            try:
                Path(path).unlink()
            except OSError:
                pass

    compressed_path_holder = [None]
    resp = Response(generate(), mimetype="text/event-stream")
    resp.call_on_close(lambda: _cleanup_temp(compressed_path_holder[0]))
    return resp


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
        compressed_path = None
        with app.app_context():
            try:
                # --- 压缩阶段：线程运行，轮询真实进度 ---
                compress_holder = [0.0]

                def on_compress_progress(pct):
                    compress_holder[0] = pct

                yield f"data: {json.dumps({'type': 'progress', 'step': 'compressing', 'message': '压缩视频中...'}, ensure_ascii=False)}\n\n"
                t0 = time.time()

                pool = ThreadPoolExecutor(max_workers=1)
                c_future = pool.submit(
                    compress_video, file_path,
                    resolution=resolution, fps=fps,
                    on_progress=on_compress_progress, hw_accel=hw_accel,
                )

                while not c_future.done():
                    pct = compress_holder[0]
                    yield f"data: {json.dumps({'type': 'progress', 'step': 'compressing', 'percent': round(pct, 1)}, ensure_ascii=False)}\n\n"
                    time.sleep(0.3)

                compressed_path, compress_time, cw, ch, cfps = c_future.result()
                pool.shutdown(wait=False)
                compressed_path_holder[0] = str(compressed_path)
                size_mb = compressed_path.stat().st_size / (1024 * 1024)
                size_bytes = compressed_path.stat().st_size
                yield f"data: {json.dumps({'type': 'progress', 'step': 'compressed', 'message': f'压缩完成: {size_mb:.1f}MB, 耗时 {compress_time:.1f}s', 'width': cw, 'height': ch, 'fps': cfps, 'size_bytes': size_bytes}, ensure_ascii=False)}\n\n"

                # --- 分析阶段：线程运行，轮询子步骤 ---
                substep = {"name": "uploading", "chars": 0}

                def on_analyze_progress(status, chars=0):
                    if status == "first_token":
                        substep["name"] = "receiving"
                    elif status == "receiving":
                        substep["name"] = "receiving"
                        substep["chars"] = chars

                if use_multimodal:
                    yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'message': f'AI 综合分析中（{model}）...'}, ensure_ascii=False)}\n\n"

                    pool2 = ThreadPoolExecutor(max_workers=1)
                    vlm_future = pool2.submit(
                        analyze_video, compressed_path, api_key, model=model,
                        base_url=CODING_BASE_URL, multimodal=True,
                        on_progress=on_analyze_progress,
                    )

                    while not vlm_future.done():
                        yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'substep': substep['name'], 'chars': substep['chars']}, ensure_ascii=False)}\n\n"
                        time.sleep(0.5)

                    segments, analyze_time, usage = vlm_future.result()
                    pool2.shutdown(wait=False)
                else:
                    asr_engine = get_asr_engine(asr_engine_name)

                    if asr_engine:
                        yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'message': f'AI 分析 & 语音识别并行中...'}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'progress', 'step': 'asr_start'}, ensure_ascii=False)}\n\n"

                        pool2 = ThreadPoolExecutor(max_workers=2)
                        vlm_future = pool2.submit(
                            analyze_video, compressed_path, api_key, model=model,
                            base_url=CODING_BASE_URL, multimodal=False,
                            on_progress=on_analyze_progress,
                        )

                        asr_substep = {"name": "loading"}

                        def on_asr_progress(status):
                            asr_substep["name"] = status

                        asr_future = pool2.submit(_run_asr, asr_engine, compressed_path, on_progress=on_asr_progress)

                        # Poll both VLM and ASR
                        vlm_done = False
                        asr_done = False
                        while not vlm_done or not asr_done:
                            if not vlm_done and vlm_future.done():
                                try:
                                    segments, analyze_time, usage = vlm_future.result()
                                except Exception:
                                    asr_future.cancel()
                                    pool2.shutdown(wait=False, cancel_futures=True)
                                    raise
                                vlm_done = True
                                yield f"data: {json.dumps({'type': 'progress', 'step': 'analyze_done'}, ensure_ascii=False)}\n\n"
                            if not asr_done and asr_future.done():
                                asr_segments = asr_future.result()
                                asr_done = True
                                if asr_segments:
                                    _merge_asr(segments, asr_segments)
                            if not vlm_done:
                                yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'substep': substep['name'], 'chars': substep['chars']}, ensure_ascii=False)}\n\n"
                            if not asr_done:
                                asr_label = "加载语音模型…" if asr_substep["name"] == "loading" else "语音识别中…"
                                yield f"data: {json.dumps({'type': 'progress', 'step': 'asr_progress', 'substep': asr_substep['name'], 'message': asr_label}, ensure_ascii=False)}\n\n"
                            time.sleep(0.5)

                        pool2.shutdown(wait=False)
                    else:
                        yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'message': f'调用 {model} 分析中...'}, ensure_ascii=False)}\n\n"

                        pool2 = ThreadPoolExecutor(max_workers=1)
                        vlm_future = pool2.submit(
                            analyze_video, compressed_path, api_key, model=model,
                            base_url=CODING_BASE_URL, multimodal=False,
                            on_progress=on_analyze_progress,
                        )

                        while not vlm_future.done():
                            yield f"data: {json.dumps({'type': 'progress', 'step': 'analyzing', 'substep': substep['name'], 'chars': substep['chars']}, ensure_ascii=False)}\n\n"
                            time.sleep(0.5)

                        segments, analyze_time, usage = vlm_future.result()
                        pool2.shutdown(wait=False)

                save_segments(media_id, segments, model=model)

                usage_dict = None
                if usage:
                    usage_dict = usage

                yield f"data: {json.dumps({'type': 'done', 'message': '分析完成', 'compress_time': round(compress_time, 1), 'analyze_time': round(analyze_time, 1), 'tokens': usage_dict, 'segments_count': len(segments)}, ensure_ascii=False)}\n\n"
            except Exception as e:
                db = get_db()
                db.execute("UPDATE media SET analysis_status = 'error' WHERE id = ?", (media_id,))
                db.commit()
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            finally:
                if compressed_path and compressed_path.exists():
                    try:
                        compressed_path.unlink()
                    except OSError:
                        pass

    def _cleanup_temp(path):
        if path and Path(path).exists():
            try:
                Path(path).unlink()
            except OSError:
                pass

    compressed_path_holder = [None]
    resp = Response(generate(), mimetype="text/event-stream")
    resp.call_on_close(lambda: _cleanup_temp(compressed_path_holder[0]))
    return resp


def _run_asr(engine, audio_path, on_progress=None):
    try:
        return engine.transcribe(audio_path, on_progress=on_progress)
    except Exception as e:
        print(f"ASR failed: {e}")
        return []


def _parse_time(ts: str) -> float:
    parts = ts.split(":")
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


def save_segments(media_id, segments, model=""):
    """Parse analysis result and save segments to DB."""
    import json
    db = get_db()
    db.execute("DELETE FROM media_segment WHERE media_id = ?", (media_id,))

    for i, seg in enumerate(segments):
        db.execute(
            "INSERT INTO media_segment (media_id, time_start, time_end, visual, asr, subtitle, dominant_colors, main_subjects, shot_type, focal_length, camera_angle, camera_movement, perspective, scene_type, mood, lighting, weather, seq) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                media_id,
                seg.get("time_start", ""),
                seg.get("time_end", ""),
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
    import json
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
    import json
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
    "mood", "lighting", "weather", "dominant_colors", "main_subjects",
}


@bp.route("/<int:media_id>/segments/<int:seg_id>", methods=["PATCH"])
def update_segment(media_id, seg_id):
    import json as _json
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
            val = _json.dumps(val if isinstance(val, list) else [val])
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
