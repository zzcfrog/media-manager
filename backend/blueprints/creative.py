"""AI Creative Guide — creative brief management and AI generation."""

import json
from flask import Blueprint, jsonify, request
from loguru import logger
from ..db import get_db, get_setting
from ..emotion_labels import aggregate_emotions, render_label_table

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
    if isinstance(creative_brief, str):
        creative_brief = json.loads(creative_brief)
    if not creative_brief:
        # Default brief for projects created outside the wizard
        creative_brief = {
            "template": "free_creation",
            "structure": "three_act",
            "emotion_arc": "gradual_build",
            "duration_target": 3,
            "voice": {"style": "mixed"},
            "opening": {"type": "atmosphere"},
            "ending": {"type": "elevation"},
        }

    # Read API key from settings
    api_key = get_setting(db, "video_api_key", "")
    if not api_key:
        return jsonify({"error": "API key not configured"}), 400

    model = get_setting(db, "creative_model", "glm-5-turbo")

    # Load all segments for this project's media
    from .workbench import _SEG_COLS
    seg_rows = db.execute(
        f"SELECT {_SEG_COLS}, m.file_name "
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
        asr_text = (d.get("asr") or "")[:50]
        # Derived arousal/valence from the emotion distribution (curve-alignment axes).
        # NOTE: we deliberately do NOT ship the full emotions array here — it was the
        # single largest field and bloated the prompt past the model context limit.
        # arousal+valence+mood carry the matchable signal; the full distribution stays
        # in the DB for display (seg-emotions component).
        agg = aggregate_emotions(_parse_json_field(d.get("emotions")))
        seg_item = {
            "segment_id": d["id"],
            "media_id": d["media_id"],
            "video_name": d.get("file_name", ""),
            "time_start": d["time_start"],
            "time_end": d["time_end"],
            "visual": d.get("visual") or "",
            "mood": d.get("mood", ""),
            "arousal": agg["arousal"],
            "valence": agg["valence"],
            "scene_type": d.get("scene_type", ""),
            "shot_type": d.get("shot_type", ""),
            "dominant_colors": _parse_json_field(d.get("dominant_colors")),
            "main_subjects": _parse_json_field(d.get("main_subjects")),
            "asr": asr_text if asr_text else None,
        }
        # Include highlights for long segments (key moments with timestamps)
        highlights = _parse_json_field(d.get("highlights"))
        if highlights:
            seg_item["highlights"] = highlights
        segments_json.append(seg_item)

    # Load prompt template
    import os
    prompt_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "creative_prompt.txt")
    with open(prompt_path, "r") as f:
        prompt_template = f.read()

    # Build messages
    brief_text = render_brief_text(creative_brief)
    # Compact JSON (no indent) — indent=2 added ~150K chars of whitespace and pushed
    # the prompt past the model context limit (empty response). Compact is parsed fine.
    segments_part = json.dumps(segments_json, ensure_ascii=False)
    user_content = prompt_template.replace(
        "{brief_text}", brief_text
    ).replace(
        "{segments_json}", segments_part
    ).replace(
        "{emotion_labels}", render_label_table()
    )
    # Log prompt without segments (too noisy)
    prompt_without_segments = prompt_template.replace("{brief_text}", brief_text).replace("{segments_json}", "... ({} segments) ...".format(len(segments_json))).replace("{emotion_labels}", render_label_table())
    logger.info("Creative generate [pid={}]: model={}, segments_count={}, prompt_length={}\n--- PROMPT ---\n{}\n--- END ---", pid, model, len(segments_json), len(user_content), prompt_without_segments)

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
                logger.error("Creative plan parse failed [pid={}]. Response length={}, first 500 chars:\n{}", pid, len(full_text), full_text[:500])
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
            logger.info("Creative generate [pid={}]: done, acts={}, shots={}", pid, len(plan.get("acts", [])), sum(len(a.get("shots", [])) for a in plan.get("acts", [])))

          except Exception as e:
            progress["error"] = str(e)
            logger.error("Creative generate [pid={}]: error — {}", pid, e)
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


@bp.route("/<int:pid>/plan", methods=["PUT"])
def save_plan(pid):
    """Save updated AI plan (from mindmap edits)."""
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    plan = request.get_json(force=True)
    db.execute("UPDATE projects SET ai_plan = ? WHERE id = ?", (json.dumps(plan, ensure_ascii=False), pid))
    db.commit()
    return jsonify({"ok": True})


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
        "SELECT ms.id, ms.media_id, ms.time_start, ms.time_end, ms.asr FROM media_segment ms "
        "JOIN project_media pm ON pm.media_id = ms.media_id "
        "WHERE pm.project_id = ?",
        (pid,),
    ).fetchall()
    seg_map = {r["id"]: dict(r) for r in seg_rows}

    tracks = []
    position = 0.0

    for act in ai_plan.get("acts", []):
        act_start = position

        for narrative in act.get("narratives", []):
            nar_start = position

            for shot in narrative.get("shots", []):
                seg_id = shot.get("segment_id")
                seg = seg_map.get(seg_id)
                if not seg:
                    continue

                # Use src_start/src_end if provided (sub-clip), otherwise full segment
                src_start = shot.get("src_start") or seg["time_start"]
                src_end = shot.get("src_end") or seg["time_end"]
                try:
                    dur = _parse_time(src_end) - _parse_time(src_start)
                except (ValueError, TypeError):
                    dur = 5.0  # fallback 5 seconds
                if dur <= 0:
                    dur = 5.0

                ts = _fmt_time(position)
                te = _fmt_time(position + dur)

                # Video track item
                tracks.append({
                    "track_type": "video",
                    "segment_id": seg_id,
                    "position": len(tracks),
                    "time_start": ts,
                    "time_end": te,
                    "metadata": json.dumps({
                        "purpose": shot.get("purpose", ""),
                        "act_id": act.get("act_id", ""),
                        "narrative_id": narrative.get("narrative_id", ""),
                        "srcMediaId": seg["media_id"],
                        "srcStart": src_start,
                        "srcEnd": src_end,
                    }, ensure_ascii=False),
                })

                # Emotion track item
                tracks.append({
                    "track_type": "emotion",
                    "emotion_value": shot.get("emotion", 0.5),
                    "content": shot.get("purpose", ""),
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

            # Narrative track item (one per narrative group, spans all its shots)
            nar_text = narrative.get("text", "")
            if nar_text and nar_start < position:
                tracks.append({
                    "track_type": "text",
                    "content": nar_text,
                    "position": len(tracks),
                    "time_start": _fmt_time(nar_start),
                    "time_end": _fmt_time(position),
                })

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


def render_brief_text(brief):
    """Convert structured creative brief JSON into a rich natural language description."""
    if not brief or not isinstance(brief, dict):
        return "（无创作指令）"

    TEMPLATES = {
        "long_documentary": (
            "这是一部长纪录片风格的视频创作。要求构建完整的多幕叙事结构，注重镜头语言的细腻表达——"
            "通过景别变化、运动方式和构图传递信息。节奏上要有张有弛，快慢交替，"
            "给观众充裕的时间感受每个画面。整体追求沉浸式观影体验，让观众跟随叙事自然流动，"
            "而不是被快速剪辑推着走。每个镜头都应该有其存在的叙事价值，不要堆砌无意义的空镜。"
        ),
        "quick_montage": (
            "这是一支快节奏的混剪视频。核心诉求是「短平快」——在最短时间内制造最强的视觉冲击和情绪感染力。"
            "节奏要紧凑有力，镜头切换频繁但有序，通过快速剪辑和音乐节拍的配合驱动观众情绪。"
            "每个镜头停留时间短（通常 1-3 秒），信息密度要高，让观众目不暇接但又不会迷失重点。"
            "注意在快节奏中制造一两个「呼吸点」（稍长的镜头），避免全程高压导致观众疲劳。"
        ),
        "free_creation": (
            "这是一次自由创作，不受固定模板和叙事规则的约束。请充分发挥创意，"
            "根据手头素材的特点（画质、内容、情绪）灵活组织叙事。"
            "可以尝试非常规的结构、节奏和表现手法——只要最终效果好。"
            "不过仍需遵循基本视听语言规律：镜头衔接要流畅，情绪走向要有逻辑，信息传达要清晰。"
        ),
    }
    OPENINGS = {
        "suspense": (
            "开头策略：悬念式开场。前 5-10 秒是观众决定是否继续看的关键窗口，"
            "必须用一个引人好奇的画面、一个未解的问题或一段反常规的镜头组合制造悬念——"
            "让观众心里产生「这是什么？」「接下来会怎样？」的好奇心，从而锁定注意力。"
            "建议使用非常规角度（仰拍/俯拍/局部特写）、反常的画面（如静止中的突然变化）"
            "或一段耐人寻味的同期声作为钩子。"
        ),
        "atmosphere": (
            "开头策略：氛围营造式开场。用 5-10 秒的大景别空镜或慢节奏画面建立全片的基调和情绪氛围——"
            "让观众在没有任何文字和旁白的情况下，单纯通过画面（光线、色调、天气、环境）"
            "就感受到这部视频的情感底色。适合用延时摄影、航拍、水面倒影、光影变化等画面。"
            "节奏要慢，给观众「进入」的时间和空间。这类开头虽然不追求瞬间的冲击力，"
            "但胜在余韵悠长，为后续叙事奠定了扎实的情感基础。"
        ),
        "character": (
            "开头策略：人物切入式开场。用一个具体人物的面部特写、手部动作或背影作为第一个画面——"
            "人脑对人脸和人体有天生的注意力偏好，这是最快建立情感连接的方式。"
            "可以是人物的某个细微表情、一个意味深长的眼神、一段自然状态下的小动作。"
            "不需要立刻交代人物的身份和背景，保留一些神秘感，"
            "让观众通过后续镜头逐渐拼凑出这个人的故事。"
        ),
        "quote": (
            "开头策略：引言式开场。以一段精心撰写的旁白文案、一句有力的引言或一段原始同期声开场——"
            "文字/语言直接点明主题和立意，让观众立刻知道这部视频要讲什么。"
            "画面可以是黑屏/纯色背景+文字字幕，也可以是配合文字的意境画面。"
            "引言的内容需要有分量——要么是一个深刻的观点，要么是一个触动人心的问题，"
            "要么是一段来自真实人物的真实话语。避免空洞的抒情和无意义的口号。"
        ),
    }
    ENDINGS = {
        "bookend": (
            "结尾策略：首尾呼应。在结尾处回溯到开头使用的画面、场景或意象，"
            "但赋予它新的含义——同样的画面在经历了全片的叙事之后，观众会产生截然不同的感受。"
            "这种手法在结构上形成完整的闭环，给观众以「故事讲完了」的圆满感。"
            "具体做法可以是：回到开头的同一地点但时间不同、用同一首曲子的不同段落、"
            "或重复开头的某个镜头但配上新的旁白。"
        ),
        "elevation": (
            "结尾策略：情绪升华。在全片积累的情感和叙事基础上，"
            "在最后 10-15 秒推向全片的最高情感点——可以是最壮美的画面配上最激昂的音乐，"
            "也可以是最打动人心的一段文字配上最安静的画面（以静制动）。"
            "注意高潮前的铺垫必须充分：前面的镜头要为这个高潮蓄势，"
            "而不是突然拔高。最后一帧画面要在情绪最高点定格或渐隐，"
            "让观众的情绪停留在最高处。"
        ),
        "open": (
            "结尾策略：开放式结尾。不给出一个明确的结论或答案，"
            "而是留下一个悬而未决的问题、一个未完成的动作或一个意味深长的画面——"
            "让观众在视频结束后仍然在思考和回味。"
            "这种结尾适合有深度、有思考价值的主题。具体做法可以是："
            "最后一个镜头缓缓拉远、人物望向远方、一个正在发生但未结束的场景。"
            "避免使用「未完待续」或字幕提示，让画面本身传达留白。"
        ),
        "call": (
            "结尾策略：号召式结尾。在视频的最后直接向观众传达核心信息或发出行动号召——"
            "适合宣传片、公益片、品牌视频等有明确传播目标的创作。"
            "具体做法可以是：一段有力的旁白总结+行动指引（「让我们一起……」），"
            "或全片精华画面的快速闪回+核心标语。注意号召不能生硬——"
            "它应该建立在全片叙事和情感积累的基础上，水到渠成而非突然跳出。"
        ),
    }
    STRUCTURES = {
        "timeline": (
            "叙事结构：时间线结构。按照事件发生的时间先后顺序组织素材，从过去到现在（或从现在回溯到过去）。"
            "这种结构的优势是逻辑清晰、因果关系明确，观众容易跟随和理解。"
            "注意要点：（1）时间跨度大的素材之间需要用转场或旁白过渡，避免跳跃感；"
            "（2）同一时间段的素材可以集中呈现，制造「某一时刻」的丰富感；"
            "（3）如果素材时间跨度不够覆盖目标时长，可以适当延长某些关键时刻的镜头长度。"
        ),
        "thematic": (
            "叙事结构：主题式结构。按照主题或维度分类组织素材，而非时间顺序。"
            "例如：「城市」主题——把所有城市相关的镜头集中在一起，然后切换到「自然」主题，再回到「人物」主题。"
            "这种结构的优势是对比鲜明、主题突出，适合素材来源多样的创作。"
            "注意要点：（1）同一主题内部的镜头要有视觉连贯性（色调、光线、景别相近）；"
            "（2）不同主题之间需要明确的分界（可以是黑屏、转场或音乐变化）；"
            "（3）主题之间的排列要有递进感，不能随机堆砌。"
        ),
        "three_act": (
            "叙事结构：经典三幕式。这是最成熟的叙事框架——\n"
            "第一幕「建置」（约占 25% 时长）：建立世界观、介绍环境和氛围，让观众了解「这是一个什么样的故事」。"
            "镜头以大景别、慢节奏为主，配合旁白或字幕交代背景。\n"
            "第二幕「发展」（约占 50% 时长）：引入变化、冲突或转折，逐步升温。镜头节奏加快，景别从中景到特写逐渐收紧，"
            "信息密度增大。这一幕是全片的主体，要确保内容丰富、节奏有变化。\n"
            "第三幕「高潮与收束」（约占 25% 时长）：推向全片的情感顶点，然后回归平静。"
            "可以是一个震撼的画面序列，也可以是一段安静的旁白。最后几秒要留出「余韵」——不要戛然而止。"
        ),
        "contrast": (
            "叙事结构：对比式结构。将两种截然不同的场景、情绪或观点交替呈现——"
            "通过反差和碰撞制造张力和思考空间。例如：城市/自然、快/慢、热闹/安静、日/夜。\n"
            "具体做法：（1）A 面和B 面的素材在视觉上要有明显区分（色调、光线、景别）；"
            "（2）A→B 的切换要干脆利落，不要缓慢过渡——反差的力量来自突兀的并置；"
            "（3）经过几轮对比后，A 和B 可以在某一点融合，暗示对立中的统一；"
            "（4）对比不限于视觉，也可以是声音（喧闹/寂静）、节奏（快/慢）或情绪（欢快/沉重）。"
        ),
    }
    ARCS = {
        "gradual_build": (
            "情绪弧线：渐进式攀升。情绪从低位开始，像爬坡一样持续升温——"
            "前 1/3 段保持平静、舒缓，建立基调（情绪值 0.2-0.4）；"
            "中间 1/3 段逐步升温，引入变化和能量（情绪值 0.4-0.7）；"
            "最后 1/3 段陡然攀升到全片的最高点（情绪值 0.8-1.0），在高潮中收尾。\n"
            "这种弧线最适合纪录片和叙事类视频，因为它给观众足够的时间进入状态，"
            "然后被逐步推高，最终获得最大的情感释放。"
            "注意中间段不能平淡——需要有持续的微小变化维持观众的兴趣。"
        ),
        "rollercoaster": (
            "情绪弧线：过山车式。情绪波动剧烈，高潮和低谷交替出现，至少有 3 次明显的起落——"
            "从一个高点迅速跌入低谷，然后在观众以为要结束时再次拉起。\n"
            "这种弧线适合节奏感强、视觉冲击力大的混剪和快剪视频。"
            "要点：（1）每个情绪高点都要有足够强烈的视觉/听觉支撑；"
            "（2）低谷不能太长（1-2 个镜头即可），否则观众会失去耐心；"
            "（3）每次起落的幅度要递增——第二个高点要高于第一个，第三个要更高。"
        ),
        "deep_narrative": (
            "情绪弧线：深度叙事。前 70-80% 的时间保持低位（情绪值 0.2-0.4），缓慢铺垫和积累——"
            "像一根被持续压缩的弹簧，观众能感受到某种力量在暗中积蓄。"
            "然后在最后的 20-30% 时间内大幅爆发（情绪值飙升至 0.8-1.0），形成全片唯一的、也是最强的高潮。\n"
            "这种弧线适合情感深沉、主题厚重的长叙事。"
            "关键挑战：低位段的镜头和叙事必须有足够的信息量和美感来维持观众的注意力——"
            "不能因为情绪低就拍得无聊，要让观众感受到「暴风雨前的宁静」。"
        ),
        "custom": (
            "情绪弧线：自定义。没有预设的弧线模式，请根据素材的内容特点和创作意图，"
            "自行设计最合适的情绪走向。建议先分析可用素材的整体情绪分布，"
            "然后找到一条能让现有素材发挥最大效果的情绪路径——"
            "而不是设计一个完美的弧线再去硬凑素材。"
        ),
    }
    MONTAGE_STYLES = {
        "beat": (
            "混剪风格：节拍驱动。镜头切换严格与音乐节拍对齐——每个重拍切一次镜头，"
            "副拍可以做细微的运动或缩放。节奏感极强，视觉冲击力大。\n"
            "要点：（1）选择节奏鲜明的音乐（鼓点清晰、BPM 适中）；"
            "（2）每个镜头的入点和出点都要踩在节拍上，不能有半拍的偏差；"
            "（3）在音乐的高潮段落可以加快切换频率（每半拍一切），在间奏段落可以放慢；"
            "（4）关键歌词或旋律变化处建议配合最有冲击力的画面。"
        ),
        "montage": (
            "混剪风格：蒙太奇。通过镜头的并列和叠加产生新的含义——"
            "两个单独看意义有限的镜头放在一起，会产生第三种意思。\n"
            "要点：（1）注重画面之间的隐喻和对比关系——不是随机排列，而是有内在逻辑；"
            "（2）可以用叠化（dissolve）让前后画面短暂共存，强化对比或关联；"
            "（3）节奏可以不拘泥于音乐节拍，而是以内容和含义的递进驱动剪辑；"
            "（4）适合表达抽象主题和情感，而非线性叙事。"
        ),
        "transition": (
            "混剪风格：转场驱动。通过创意转场连接不同场景——让画面之间的过渡本身成为视觉亮点。\n"
            "常见转场手法：（1）运动匹配——前一个镜头向右运动，下一个镜头也从右入画；"
            "（2）遮挡转场——利用画面中的物体遮挡镜头，切到下一个场景；"
            "（3）甩镜头——快速甩动产生模糊，衔接到下一个清晰画面；"
            "（4）相似图形匹配——两个画面中有相似的形状或线条。\n"
            "注意转场不能喧宾夺主——它应该服务于叙事和情绪，而不是为了炫技。"
        ),
    }
    VOICE_STYLES = {
        "narration": (
            "声音策略：以旁白为主。需要为每个镜头（或每组镜头）撰写旁白文案——"
            "旁白承担叙事推进和信息传递的核心角色。文案要求：简洁有力、有画面感、不空洞。"
            "每段旁白控制在 5-15 秒，避免过长的独白让观众疲劳。"
            "旁白的语气应与视频整体调性一致——纪录片可以沉稳客观，混剪可以简短有力。"
        ),
        "asr": (
            "声音策略：以同期声（ASR）为主。优先使用素材中原始收录的人声和环境音——"
            "保留真实的语气、口音和环境氛围，让观众感受到「真实发生」的力量。\n"
            "要点：（1）选择语音清晰、内容有意义的同期声片段；"
            "（2）同期声的入点和出点要干净——不要从一个词语中间切入；"
            "（3）如果同期声有口误或犹豫，可以考虑保留（增加真实感）或跳过（保持流畅）；"
            "（4）同期声之间可以用纯画面+音乐过渡，避免声音拼接的突兀感。"
        ),
        "mixed": (
            "声音策略：旁白+同期声混合使用。两者各司其职——\n"
            "旁白负责：交代背景和上下文、串联不相关的镜头、提供视角和观点；\n"
            "同期声负责：传递真实情感、展现人物个性、提供第一手信息。\n"
            "安排原则：（1）一段同期声之后可以用旁白进行解读或延伸；"
            "（2）转场处用旁白过渡，让叙事平滑衔接；"
            "（3）高潮段落优先用同期声——真实的声音比旁白更有力量；"
            "（4）两者之间要有呼吸空间，不要紧挨着切换。"
        ),
        "none": (
            "声音策略：纯视觉叙事，不使用任何人声（旁白和同期声都不用）。"
            "完全依靠画面+音乐+音效来传达信息和情绪。\n"
            "这意味着镜头的选择和排列必须足够清晰和有逻辑——"
            "观众在没有文字辅助的情况下也能理解叙事。"
            "适合视觉表现力强的素材（壮美的风光、精彩的动作、丰富的色彩）。"
            "建议选择情绪饱满的纯音乐作为支撑，让音乐替代旁白承担情绪引导的角色。"
        ),
    }

    parts = []

    # Template
    tpl = brief.get("template", "long_documentary")
    parts.append(TEMPLATES.get(tpl, TEMPLATES["long_documentary"]))

    # Theme
    theme = brief.get("theme_description", "").strip()
    if theme:
        parts.append(f"创作主题：{theme}")

    # Creator's intent
    intent = brief.get("creator_intent", "").strip()
    if intent:
        parts.append(f"创作者意图：{intent}")

    # Duration
    dur = brief.get("duration_target")
    if dur:
        parts.append(f"目标总时长：{dur} 分钟（可 ±10% 浮动）。请合理分配各幕时长，确保总时长接近目标。")

    # Opening
    opening_type = (brief.get("opening") or {}).get("type", "atmosphere")
    parts.append(OPENINGS.get(opening_type, OPENINGS["atmosphere"]))

    # Structure
    struct = brief.get("structure", "three_act")
    parts.append(STRUCTURES.get(struct, STRUCTURES["three_act"]))

    # Emotion arc
    arc = brief.get("emotion_arc", "gradual_build")
    parts.append(ARCS.get(arc, ARCS["gradual_build"]))

    # Montage style (only for quick_montage template)
    if tpl == "quick_montage":
        ms = brief.get("montage_style", "beat")
        parts.append(MONTAGE_STYLES.get(ms, MONTAGE_STYLES["beat"]))

    # Voice
    voice_style = (brief.get("voice") or {}).get("style", "mixed")
    parts.append(VOICE_STYLES.get(voice_style, VOICE_STYLES["mixed"]))

    # Music
    music = brief.get("music") or {}
    music_parts = []
    if music.get("mood"):
        music_parts.append(f"情绪氛围为「{music['mood']}」")
    if music.get("tempo"):
        music_parts.append(f"节奏为「{music['tempo']}」")
    if music.get("style"):
        music_parts.append(f"风格偏好「{music['style']}」")
    if music.get("reference"):
        music_parts.append(f"参考作品：「{music['reference']}」")
    if music_parts:
        parts.append("音乐指导：" + "，".join(music_parts) + "。音乐应与画面情绪同步变化，在情绪高点加强力度，在过渡段保持低调。")

    # Ending

    # Ending
    ending_type = (brief.get("ending") or {}).get("type", "bookend")
    parts.append(ENDINGS.get(ending_type, ENDINGS["bookend"]))

    return "\n\n".join(parts)


def _parse_creative_response(text):
    """Extract JSON from LLM response text."""
    # Try to find JSON block
    text = text.strip()
    if not text:
        logger.warning("Empty response from LLM")
        return None
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
    except json.JSONDecodeError as e:
        logger.warning("Direct JSON parse failed: {}. Trying to extract JSON substring...", e)
        # Try to find JSON object in text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError as e2:
                logger.error("JSON substring parse also failed: {}. Substring length={}, first 300 chars:\n{}", e2, end - start, text[start:start+300])
                return None
        logger.error("No JSON object found in response. Text length={}, first 300 chars:\n{}", len(text), text[:300])
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
