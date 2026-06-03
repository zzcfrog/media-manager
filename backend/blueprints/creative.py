"""AI Creative Guide — creative brief management and AI generation."""

import json
from flask import Blueprint, jsonify, request
from ..db import get_db, get_setting

bp = Blueprint("creative", __name__)


# ── List creative plans ────────────────────────────────────────


@bp.route("/")
def list_creative_plans():
    """List projects that have a creative_brief (i.e. created via the ideation wizard)."""
    db = get_db()
    rows = db.execute(
        "SELECT p.*, (SELECT COUNT(*) FROM project_media WHERE project_id = p.id) AS media_count "
        "FROM projects p WHERE p.creative_brief IS NOT NULL "
        "ORDER BY p.updated_at DESC"
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})


# ── Create creative plan ───────────────────────────────────────


@bp.route("/", methods=["POST"])
def create_creative_plan():
    """Create a new creative plan (project with creative_brief)."""
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    description = data.get("description", "")
    media_ids = data.get("media_ids", [])
    creative_brief = data.get("creative_brief", {})

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO projects (name, description, creative_brief) VALUES (?, ?, ?)",
            (name, description, json.dumps(creative_brief, ensure_ascii=False)),
        )
        project_id = cur.lastrowid
        for mid in media_ids:
            db.execute(
                "INSERT OR IGNORE INTO project_media (project_id, media_id) VALUES (?, ?)",
                (project_id, mid),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    result = dict(row)
    result["media_count"] = len(media_ids)
    return jsonify({"data": result}), 201


# ── Get creative plan ──────────────────────────────────────────


@bp.route("/<int:pid>")
def get_creative_plan(pid):
    """Get creative plan with media list and segment statistics."""
    db = get_db()
    proj = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    result = dict(proj)

    # Parse JSON fields
    for field in ("creative_brief", "ai_plan"):
        val = result.get(field)
        if val and isinstance(val, str):
            try:
                result[field] = json.loads(val)
            except (ValueError, TypeError):
                pass

    # Load associated media
    media = db.execute(
        "SELECT m.id, m.file_name, m.media_type, m.thumbnail_path, m.duration, m.date_taken "
        "FROM media m JOIN project_media pm ON pm.media_id = m.id "
        "WHERE pm.project_id = ?",
        (pid,),
    ).fetchall()
    result["media"] = [dict(r) for r in media]
    result["media_count"] = len(media)
    return jsonify({"data": result})


# ── Update creative brief ──────────────────────────────────────


@bp.route("/<int:pid>/brief", methods=["PUT"])
def update_brief(pid):
    """Update the creative_brief JSON for a project."""
    data = request.json or {}
    brief = data.get("creative_brief")
    if brief is None:
        return jsonify({"error": "creative_brief is required"}), 400

    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404

    db.execute(
        "UPDATE projects SET creative_brief = ?, updated_at = datetime('now') WHERE id = ?",
        (json.dumps(brief, ensure_ascii=False), pid),
    )
    db.commit()
    return jsonify({"ok": True})


# ── Segment statistics ─────────────────────────────────────────


@bp.route("/<int:pid>/stats")
def get_stats(pid):
    """Get segment statistics for a creative plan's media."""
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404

    # Aggregate stats from all segments
    rows = db.execute(
        "SELECT ms.mood, ms.scene_type, ms.asr, ms.shot_type, ms.time_start, ms.time_end "
        "FROM media_segment ms "
        "JOIN project_media pm ON pm.media_id = ms.media_id "
        "WHERE pm.project_id = ?",
        (pid,),
    ).fetchall()

    total_segments = len(rows)
    total_duration = 0.0
    mood_dist = {}
    scene_dist = {}
    shot_dist = {}
    asr_count = 0

    for r in rows:
        # Duration
        try:
            ts = _parse_time(r["time_start"])
            te = _parse_time(r["time_end"])
            total_duration += te - ts
        except (ValueError, TypeError):
            pass

        # Mood
        mood = r["mood"] or ""
        if mood:
            mood_dist[mood] = mood_dist.get(mood, 0) + 1

        # Scene type
        scene = r["scene_type"] or ""
        if scene:
            scene_dist[scene] = scene_dist.get(scene, 0) + 1

        # Shot type
        shot = r["shot_type"] or ""
        if shot:
            shot_dist[shot] = shot_dist.get(shot, 0) + 1

        # ASR
        if r["asr"]:
            asr_count += 1

    # Count media by type
    media_rows = db.execute(
        "SELECT m.media_type FROM media m JOIN project_media pm ON pm.media_id = m.id WHERE pm.project_id = ?",
        (pid,),
    ).fetchall()
    video_count = sum(1 for r in media_rows if r["media_type"] == "video")
    image_count = sum(1 for r in media_rows if r["media_type"] == "image")

    return jsonify({
        "data": {
            "total_segments": total_segments,
            "total_duration": round(total_duration, 1),
            "video_count": video_count,
            "image_count": image_count,
            "mood_distribution": mood_dist,
            "scene_distribution": scene_dist,
            "shot_distribution": shot_dist,
            "asr_count": asr_count,
        }
    })


# ── AI Generate ────────────────────────────────────────────────


@bp.route("/<int:pid>/generate", methods=["POST"])
def generate_plan(pid):
    """Call LLM to generate a creative plan based on the brief and segment data.

    Returns SSE stream with progress events and the final plan.
    """
    db = get_db()
    proj = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404

    creative_brief = proj["creative_brief"]
    if not creative_brief:
        return jsonify({"error": "No creative brief set"}), 400
    if isinstance(creative_brief, str):
        creative_brief = json.loads(creative_brief)

    # Read API key from settings
    api_key = get_setting(db, "video_api_key", "")
    if not api_key:
        return jsonify({"error": "API key not configured"}), 400

    model = get_setting(db, "creative_model", "glm-4v-plus")

    # Load all segments for this project's media
    from .workbench import _SEG_COLS
    seg_rows = db.execute(
        f"SELECT {_SEG_COLS} "
        "FROM media_segment ms "
        "JOIN project_media pm ON pm.media_id = ms.media_id "
        "JOIN media m ON m.id = ms.media_id "
        "WHERE pm.project_id = ? ORDER BY m.date_taken, ms.seq",
        (pid,),
    ).fetchall()

    if not seg_rows:
        return jsonify({"error": "No analyzed segments found"}), 400

    # Compress segment data for prompt
    segments_json = []
    for r in seg_rows:
        d = dict(r)
        visual = (d.get("visual") or "")[:100]
        asr_text = (d.get("asr") or "")[:50]
        segments_json.append({
            "segment_id": d["id"],
            "media_id": d["media_id"],
            "time_start": d["time_start"],
            "time_end": d["time_end"],
            "visual": visual,
            "mood": d.get("mood", ""),
            "scene_type": d.get("scene_type", ""),
            "shot_type": d.get("shot_type", ""),
            "dominant_colors": _parse_json_field(d.get("dominant_colors")),
            "main_subjects": _parse_json_field(d.get("main_subjects")),
            "asr": asr_text if asr_text else None,
        })

    # Load prompt template
    import os
    prompt_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "creative_prompt.txt")
    with open(prompt_path, "r") as f:
        prompt_template = f.read()

    # Build messages
    user_content = prompt_template.replace(
        "{creative_brief_json}", json.dumps(creative_brief, ensure_ascii=False, indent=2)
    ).replace(
        "{segments_json}", json.dumps(segments_json, ensure_ascii=False, indent=2)
    )

    # SSE streaming response
    from flask import Response, stream_with_context, current_app

    progress = {"step": "starting", "percent": 0, "done": False, "result": None, "error": None}
    app = current_app._get_current_object()

    def do_generate():
        """Run in thread — call LLM API. Must use its own DB connection."""
        with app.app_context():
          try:
            thread_db = get_db()
            from openai import OpenAI
            base_url = get_setting(thread_db, "api_base_url", "https://open.bigmodel.cn/api/paas/v4")
            client = OpenAI(api_key=api_key, base_url=base_url)

            progress["step"] = "analyzing"
            progress["percent"] = 10

            stream = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "你是一位资深视频导演，擅长将素材组织成有叙事结构的中长视频。请严格按照 JSON 格式输出，不要输出任何其他内容。"},
                    {"role": "user", "content": user_content},
                ],
                stream=True,
                temperature=0.7,
            )

            progress["step"] = "generating"
            progress["percent"] = 30

            full_text = ""
            shot_count = 0
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    full_text += text
                    # Count shots generated
                    shot_count = full_text.count('"segment_id"')
                    progress["shots"] = shot_count
                    progress["percent"] = min(30 + shot_count * 2, 85)

            progress["step"] = "parsing"
            progress["percent"] = 90

            # Parse JSON from response
            plan = _parse_creative_response(full_text)
            if plan is None:
                progress["error"] = "AI 返回格式无效，请重试"
                progress["done"] = True
                return

            # Validate segment references
            valid_ids = {s["segment_id"] for s in segments_json}
            _validate_plan(plan, valid_ids)

            # Save to database
            thread_db.execute(
                "UPDATE projects SET ai_plan = ?, updated_at = datetime('now') WHERE id = ?",
                (json.dumps(plan, ensure_ascii=False), pid),
            )
            thread_db.commit()

            progress["result"] = plan
            progress["step"] = "done"
            progress["percent"] = 100

          except Exception as e:
            progress["error"] = str(e)
          finally:
            progress["done"] = True

    import threading
    thread = threading.Thread(target=do_generate)
    thread.start()

    def generate_sse():
        import time
        last_shots = 0
        while True:
            step_text = {
                "starting": "准备生成...",
                "analyzing": "分析素材内容...",
                "generating": "匹配镜头与情绪...",
                "parsing": "解析生成结果...",
                "done": "生成完成",
            }.get(progress.get("step", ""), "处理中...")

            event_data = {
                "step": progress.get("step", ""),
                "step_text": step_text,
                "percent": progress.get("percent", 0),
                "shots": progress.get("shots", 0),
            }

            if progress.get("error"):
                yield f"event: error\ndata: {json.dumps({'error': progress['error']})}\n\n"
                break

            if progress.get("done") and progress.get("result"):
                yield f"event: done\ndata: {json.dumps({'plan': progress['result']})}\n\n"
                break

            yield f"event: progress\ndata: {json.dumps(event_data)}\n\n"
            time.sleep(0.5)

        thread.join(timeout=30)

    return Response(
        stream_with_context(generate_sse()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Apply plan to tracks ───────────────────────────────────────


@bp.route("/<int:pid>/apply", methods=["POST"])
def apply_plan(pid):
    """Assemble AI plan into project_tracks."""
    db = get_db()
    proj = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404

    ai_plan = proj["ai_plan"]
    if not ai_plan:
        return jsonify({"error": "No AI plan generated"}), 400
    if isinstance(ai_plan, str):
        ai_plan = json.loads(ai_plan)

    # Get all segments for time calculation
    seg_rows = db.execute(
        "SELECT ms.id, ms.time_start, ms.time_end, ms.asr FROM media_segment ms "
        "JOIN project_media pm ON pm.media_id = ms.media_id "
        "WHERE pm.project_id = ?",
        (pid,),
    ).fetchall()
    seg_map = {r["id"]: dict(r) for r in seg_rows}

    tracks = []
    position = 0.0

    for act in ai_plan.get("acts", []):
        act_start = position

        for shot in act.get("shots", []):
            seg_id = shot.get("segment_id")
            seg = seg_map.get(seg_id)
            if not seg:
                continue

            # Calculate duration from segment
            try:
                dur = _parse_time(seg["time_end"]) - _parse_time(seg["time_start"])
            except (ValueError, TypeError):
                dur = 5.0  # fallback 5 seconds

            ts = _fmt_time(position)
            te = _fmt_time(position + dur)

            # Video track item
            tracks.append({
                "track_type": "video",
                "segment_id": seg_id,
                "position": len(tracks),
                "time_start": ts,
                "time_end": te,
                "metadata": json.dumps({"purpose": shot.get("purpose", ""), "act_id": act.get("act_id", "")}, ensure_ascii=False),
            })

            # Emotion track item
            tracks.append({
                "track_type": "emotion",
                "emotion_value": shot.get("emotion", 0.5),
                "position": len(tracks),
                "time_start": ts,
                "time_end": te,
            })

            # Narration track item
            narration = shot.get("narration", "")
            if narration:
                tracks.append({
                    "track_type": "narration",
                    "content": narration,
                    "position": len(tracks),
                    "time_start": ts,
                    "time_end": te,
                })

            # Subtitle track item (use ASR)
            if shot.get("use_asr") and seg.get("asr"):
                tracks.append({
                    "track_type": "subtitle",
                    "segment_id": seg_id,
                    "content": seg["asr"],
                    "position": len(tracks),
                    "time_start": ts,
                    "time_end": te,
                })

            position += dur

        # Theme track item (one per act)
        if act_start < position:
            tracks.append({
                "track_type": "theme",
                "content": act.get("title", ""),
                "position": len(tracks),
                "time_start": _fmt_time(act_start),
                "time_end": _fmt_time(position),
                "metadata": json.dumps({"purpose": act.get("purpose", ""), "act_id": act.get("act_id", "")}, ensure_ascii=False),
            })

            # Text track item (title card, 2 seconds)
            title_dur = min(2.0, position - act_start)
            tracks.append({
                "track_type": "text",
                "content": act.get("title", ""),
                "position": len(tracks),
                "time_start": _fmt_time(act_start),
                "time_end": _fmt_time(act_start + title_dur),
            })

    # Write tracks (atomic replace)
    try:
        db.execute("DELETE FROM project_tracks WHERE project_id = ? AND version = 1", (pid,))
        for tr in tracks:
            db.execute(
                "INSERT INTO project_tracks "
                "(project_id, version, position, track_type, segment_id, content, "
                "time_start, time_end, emotion_value, metadata) "
                "VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    pid,
                    tr.get("position", 0),
                    tr.get("track_type", "video"),
                    tr.get("segment_id"),
                    tr.get("content", ""),
                    tr.get("time_start", "00:00.00"),
                    tr.get("time_end", "00:05.00"),
                    tr.get("emotion_value", 0.5),
                    tr.get("metadata", "{}"),
                ),
            )
        db.execute("UPDATE projects SET updated_at = datetime('now') WHERE id = ?", (pid,))
        db.commit()
    except Exception:
        db.rollback()
        raise

    return jsonify({"ok": True, "track_count": len(tracks)})


# ── Helpers ────────────────────────────────────────────────────


def _parse_time(s):
    """Parse MM:SS.ss or HH:MM:SS.ss to seconds."""
    if not s:
        return 0.0
    parts = s.split(":")
    if len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    return 0.0


def _fmt_time(seconds):
    """Format seconds to MM:SS.ss."""
    m = int(seconds) // 60
    s = seconds - m * 60
    return f"{m:02d}:{s:05.2f}"


def _parse_json_field(val):
    """Parse a JSON string field, returning list or original value."""
    if not val:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (ValueError, TypeError):
            return [val]
    return []


def _parse_creative_response(text):
    """Extract JSON from LLM response text."""
    # Try to find JSON block
    text = text.strip()
    # Remove markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (```json and ```)
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                return None
        return None


def _validate_plan(plan, valid_segment_ids):
    """Validate segment references in the plan. Removes invalid shots."""
    for act in plan.get("acts", []):
        valid_shots = []
        for shot in act.get("shots", []):
            sid = shot.get("segment_id")
            if sid in valid_segment_ids:
                valid_shots.append(shot)
        act["shots"] = valid_shots
