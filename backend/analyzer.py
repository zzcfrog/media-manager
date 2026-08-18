import base64
import io
import json
import math
import wave
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from loguru import logger
from openai import OpenAI

from .emotion_labels import render_label_table

# VLM (Vision Language Model) API calls for video/image analysis.

PROMPT_FILE = Path(__file__).parent / "prompts" / "video_prompt.txt"
IMG_PROMPT_FILE = Path(__file__).parent / "prompts" / "img_prompt.txt"
MUSIC_PROMPT_FILE = Path(__file__).parent / "prompts" / "music_prompt.txt"
MUSIC_TAXONOMY_FILE = Path(__file__).parent / "prompts" / "music_taxonomy.json"


def _openai_client(api_key: str, base_url: str) -> OpenAI:
    """本地引擎（127.0.0.1）必须绕过代理：httpx 默认 trust_env 会读 macOS 系统代理，
    把本地请求发给代理导致挂起（系统代理的本地例外列表 httpx 不识别）。"""
    if "127.0.0.1" in base_url or "localhost" in base_url:
        return OpenAI(api_key=api_key, base_url=base_url,
                      http_client=httpx.Client(trust_env=False, timeout=600.0))
    return OpenAI(api_key=api_key, base_url=base_url)


def load_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8").replace("{emotion_labels}", render_label_table())


def load_img_prompt() -> str:
    return IMG_PROMPT_FILE.read_text(encoding="utf-8").replace("{emotion_labels}", render_label_table())


def _render_music_taxonomy() -> str:
    """渲染 music_taxonomy.json 为 prompt 受控词表块（单一事实源在 JSON，与
    emotion_labels.render_label_table 同构）。"""
    tax = json.loads(MUSIC_TAXONOMY_FILE.read_text(encoding="utf-8"))
    lines = ["受控词表（label 输出英文规范值，括号内为中文含义，仅供理解）："]

    def _vals(dim):
        return " | ".join(f'{x["en"]}({x["zh"]})' for x in tax[dim])

    lines.append(f'mood（情绪）: {_vals("mood")}')
    lines.append(f'genre（曲风）: {_vals("genre")}')
    lines.append(f'instrument（乐器）: {_vals("instrument")}')
    lines.append(f'video_theme（适用画面）: {_vals("video_theme")}')
    lines.append(f'vocals（人声，单选）: {_vals("vocals")}')
    lines.append("vocals_language（歌词语言，单选，无歌词时留空）: "
                 + " | ".join(x["en"] for x in tax["vocals_language"]))
    lines.append("watermark（水印，单选）: None(无) | Present(有)")
    return "\n".join(lines)


def load_music_prompt() -> str:
    return (MUSIC_PROMPT_FILE.read_text(encoding="utf-8")
            .replace("{music_taxonomy}", _render_music_taxonomy()))


def music_taxonomy_labels(dim: str) -> set[str]:
    """词表某维度的合法英文值集合（sanitize 白名单用）。"""
    tax = json.loads(MUSIC_TAXONOMY_FILE.read_text(encoding="utf-8"))
    return {x["en"] for x in tax.get(dim, [])}


def encode_image_base64(image_path: str | Path) -> str:
    image_path = Path(image_path)
    with open(image_path, "rb") as f:
        img_data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:image/jpeg;base64,{img_data}"


def encode_video_base64(video_path: str | Path) -> str:
    video_path = Path(video_path)
    with open(video_path, "rb") as f:
        video_data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:video/mp4;base64,{video_data}"


CODING_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4/"

_ASR_LINE_SEPARATE = "语音内容（由独立语音模型提供，无需填写，留空即可）"
_ASR_LINE_MULTIMODAL = "语音内容（识别说话人和内容，详细转写语音对话、旁白等音频）"


def analyze_video(video_path: str | Path, api_key: str, model: str = "glm-4.6v",
                  base_url: str = CODING_BASE_URL, multimodal: bool = True,
                  on_chunk=None, on_progress=None) -> tuple[list[dict], float, dict | None]:
    video_url = encode_video_base64(video_path)
    prompt = load_prompt()
    if multimodal:
        prompt = prompt.replace(_ASR_LINE_SEPARATE, _ASR_LINE_MULTIMODAL)

    client = _openai_client(api_key, base_url)

    if on_chunk:
        on_chunk(f"data: {json.dumps({'status': 'analyzing', 'model': model}, ensure_ascii=False)}\n\n")

    if on_progress:
        on_progress("uploading")

    t0 = time.time()
    full_content = ""
    usage = None
    first_token = True
    try:
        logger.info("Video API call starting: model={} file={}", model, Path(video_path).name)
        stream = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "video_url", "video_url": {"url": video_url}},
                    {"type": "text", "text": prompt},
                ],
            }],
            stream=True,
            stream_options={"include_usage": True},
        )

        for chunk in stream:
            if chunk.usage:
                usage = chunk.usage
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                if first_token:
                    if on_progress:
                        on_progress("first_token")
                    first_token = False
                logger.trace("stream chunk: {}", repr(delta.content))
                full_content += delta.content
                if on_progress:
                    on_progress("receiving", chars=len(full_content))
                if on_chunk:
                    on_chunk(f"data: {json.dumps({'content': delta.content}, ensure_ascii=False)}\n\n")
    except Exception as e:
        logger.error("Video API call failed after {:.1f}s: {}, file={}", time.time() - t0, e, Path(video_path).name)
        raise

    elapsed = time.time() - t0
    logger.info("Video API call done: {:.1f}s, {} chars, file={}", elapsed, len(full_content), Path(video_path).name)

    usage_dict = None
    if usage:
        usage_dict = {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens, "total": usage.total_tokens}

    return _parse_response(full_content), elapsed, usage_dict


# ---------------------------------------------------------------------------
# 本地引擎视频分析：抽帧多图（本地栈 llama.cpp 无视频解码器，不接受 video_url）
# ---------------------------------------------------------------------------

def _fmt_ts(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _parse_ts(x) -> float | None:
    try:
        v = 0.0
        for p in str(x).split(":"):
            v = v * 60 + float(p)
        return v
    except (ValueError, TypeError):
        return None


def extract_video_frames(video_path: str | Path, fps: float = 1.0,
                         max_frames: int = 32,
                         frame_res: int = 480,
                         on_extract=None,
                         with_audio=False) -> tuple[list[list[tuple[float, str]]], list[str | None]]:
    """ffmpeg 分窗抽帧（直接降采样率 + 降到 frame_res 短边，无需压缩中间产物）：
    每窗 ≤ max_frames 帧（窗时长 = max_frames/fps）。
    返回 (windows, audios)：windows = [窗][(绝对时间戳秒, data URL)]，内存占用与视频总时长无关；
    with_audio 时 audios = [窗](wav base64 | None)（16k 单声道，供 Omni 音视频同析）。
    on_extract(cur, total)：每完成一窗回调一次（进度展示用）。"""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg 未安装或不在 PATH")
    video_path = Path(video_path)
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True)
    try:
        duration = float(r.stdout.strip())
    except ValueError:
        raise RuntimeError(f"无法读取视频时长: {r.stderr[:200]}")
    if duration <= 0:
        raise RuntimeError(f"视频时长异常: {duration}")

    # 目标帧尺寸：短边 = frame_res（横片即 480p/240p 语义，竖片等比）
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True)
    try:
        sw, sh = (int(x) for x in r.stdout.strip().split(","))
    except ValueError:
        raise RuntimeError(f"无法读取视频分辨率: {r.stderr[:200]}")
    if sw >= sh:
        new_h = frame_res
        new_w = int(sw * frame_res / sh) // 2 * 2
    else:
        new_w = frame_res
        new_h = int(sh * frame_res / sw) // 2 * 2
    scale_vf = f"fps={fps},scale={new_w}:{new_h}"
    # macOS 4K 10bit HEVC 软解极重（与 llama-server 推理抢核）；videotoolbox 硬解+自动拷回，
    # 实测墙钟 1.7×、CPU 30× 省余
    hw_args = ["-hwaccel", "videotoolbox"] if sys.platform == "darwin" else []

    window_sec = max_frames / fps
    total_windows = max(1, math.ceil((duration - 0.05) / window_sec))
    windows: list[list[tuple[float, str]]] = []
    audios: list[str | None] = []
    with tempfile.TemporaryDirectory(prefix="vlm_frames_") as td:
        seq = 0
        start = 0.0
        while start < duration - 0.05:
            end = min(start + window_sec, duration)
            out_dir = Path(td) / f"w{seq}"
            out_dir.mkdir()
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *hw_args,
                 "-ss", f"{start:.3f}", "-i", str(video_path),
                 "-t", f"{end - start:.3f}", "-vf", scale_vf,
                 "-q:v", "5", str(out_dir / "f_%04d.jpg")],
                check=True)
            files = sorted(out_dir.glob("f_*.jpg"))
            frames = [(start + i / fps, encode_image_base64(f))
                      for i, f in enumerate(files)]
            if with_audio:
                # Omni 音视频同析：16k 单声道 PCM → 自建 wav 头 → base64（input_audio 格式）。
                # 不用 `-f wav pipe:1`：管道不可 seek，ffmpeg 写不回长度字段（头部是占位值）。
                # 与 frames 同进同出（无帧的窗口整体跳过，保持两列表对齐）
                r = subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error",
                     "-ss", f"{start:.3f}", "-i", str(video_path),
                     "-t", f"{end - start:.3f}", "-vn", "-ac", "1", "-ar", "16000",
                     "-f", "s16le", "pipe:1"],
                    capture_output=True)
                if r.stdout:
                    buf = io.BytesIO()
                    w = wave.open(buf, "wb")
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
                    w.writeframes(r.stdout)
                    w.close()
                    audio_b64 = base64.b64encode(buf.getvalue()).decode()
                else:
                    audio_b64 = None
            else:
                audio_b64 = None
            if frames:
                windows.append(frames)
                audios.append(audio_b64)
            if on_extract:
                on_extract(len(windows), total_windows)
            start = end
            seq += 1
    if not windows:
        raise RuntimeError("抽帧失败：未得到任何帧")
    logger.info("Extracted {} windows x {}-{} frames: fps={} max={} res={}x{} audio={} file={}",
                len(windows), min(len(w) for w in windows), max(len(w) for w in windows),
                fps, max_frames, new_w, new_h, len(audios), video_path.name)
    return windows, audios


def analyze_video_frames(video_path: str | Path, api_key: str, model: str = "qwen3-vl-8b",
                         base_url: str = CODING_BASE_URL, fps: float = 1.0,
                         max_frames: int = 32, frame_res: int = 480,
                         on_progress=None, on_window=None,
                         on_extract=None, on_extract_done=None,
                         with_audio=False) -> tuple[list[dict], float, dict | None]:
    """本地视频分析：分窗抽帧多图 + 绝对时间戳标注 → 分窗请求 → 拼接 segments。
    直接吃原片（抽帧时同步降分辨率，无压缩中间产物）。
    with_audio=True（Omni 音视频同析）：每窗附 16k wav 音轨（OpenAI input_audio），
    模型直接听原声——此时调用方应跳过独立 whisper 转写。
    on_extract(cur, total) 逐窗抽帧回调；on_extract_done(窗数, 总帧数) 抽帧完成回调。"""
    client = _openai_client(api_key, base_url)
    prompt = load_prompt()
    windows, audios = extract_video_frames(video_path, fps=fps, max_frames=max_frames,
                                           frame_res=frame_res, on_extract=on_extract,
                                           with_audio=with_audio)
    if on_extract_done:
        on_extract_done(len(windows), sum(len(w) for w in windows))

    all_segments: list[dict] = []
    usage_sum = {"prompt": 0, "completion": 0, "total": 0}
    has_usage = False
    t0 = time.time()
    logger.info("Local video analysis: model={} windows={} fps={} res={} audio={} file={}",
                model, len(windows), fps, frame_res, with_audio, Path(video_path).name)
    for wi, frames in enumerate(windows):
        if on_window:
            on_window(wi + 1, len(windows))
        audio = audios[wi] if with_audio and wi < len(audios) else None
        head = (f"以下是视频按时间顺序抽取的 {len(frames)} 帧，每帧上方的 [时:分:秒] 为该帧在视频中的时间点"
                + ("，最后附该段视频的原始音轨（含人声/环境声）：" if audio else "："))
        content: list[dict] = [{"type": "text", "text": head}]
        if audio:
            content.append({"type": "input_audio",
                            "input_audio": {"data": audio, "format": "wav"}})
        for ts, url in frames:
            content.append({"type": "text", "text": f"[{_fmt_ts(ts)}]"})
            content.append({"type": "image_url", "image_url": {"url": url}})
        content.append({"type": "text", "text": prompt})
        if on_progress:
            on_progress("uploading")

        full_content = ""
        usage = None
        first_token = True
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
            stream=True,
            stream_options={"include_usage": True},
        )
        for chunk in stream:
            if chunk.usage:
                usage = chunk.usage
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                if first_token:
                    if on_progress:
                        on_progress("first_token")
                    first_token = False
                full_content += delta.content
                if on_progress:
                    on_progress("receiving", chars=len(full_content))

        segs = _parse_response(full_content)
        # 时间戳兜底：帧标注为绝对时间，若模型输出成窗内相对时间则平移回绝对
        w_start = frames[0][0]
        times = [v for s in segs for v in (_parse_ts(s.get("time_start")), _parse_ts(s.get("time_end"))) if v is not None]
        w_dur = frames[-1][0] + 1.0 / fps - w_start
        if w_start > 1.0 and times and max(times) <= w_dur + 2.0:
            for s in segs:
                for k in ("time_start", "time_end"):
                    v = _parse_ts(s.get(k))
                    if v is not None:
                        s[k] = _fmt_ts(w_start + v)
        all_segments.extend(segs)

        if usage:
            has_usage = True
            usage_sum["prompt"] += usage.prompt_tokens
            usage_sum["completion"] += usage.completion_tokens
            usage_sum["total"] += usage.total_tokens

    elapsed = time.time() - t0
    logger.info("Local video analysis done: {:.1f}s, {} segments, {} windows, file={}",
                elapsed, len(all_segments), len(windows), Path(video_path).name)
    return all_segments, elapsed, (usage_sum if has_usage else None)


# ── 音乐分析（分段音频 → Omni input_audio → 受控标签 + 双轴 + 水印）──────

MUSIC_MAX_ANALYSIS_SEC = 1500   # 整曲上限 25 分钟（音频 token≈15/s + prompt，守住 32k 上下文）


def probe_audio_duration(audio_path: str | Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(audio_path)],
        capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise RuntimeError(f"无法读取音频时长: {r.stderr[:200]}")


def extract_audio_segment(audio_path: str | Path, start: float, dur: float) -> str:
    """单段 16k 单声道 PCM → wave 自建头 → base64（复用视频同析的音频通路；
    不用 `-f wav pipe:1`——管道不可 seek，头部时长是占位值）。"""
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-ss", f"{start:.3f}", "-i", str(audio_path),
         "-t", f"{dur:.3f}", "-vn", "-ac", "1", "-ar", "16000",
         "-f", "s16le", "pipe:1"],
        capture_output=True)
    if not r.stdout:
        raise RuntimeError(f"音频段抽取失败: {Path(audio_path).name} @ {start:.1f}s")
    buf = io.BytesIO()
    w = wave.open(buf, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(r.stdout)
    w.close()
    return base64.b64encode(buf.getvalue()).decode()


def analyze_music(audio_path: str | Path, api_key: str, model: str = "qwen3-omni-30b-a3b",
                  base_url: str = CODING_BASE_URL,
                  on_progress=None) -> tuple[list[dict], float, dict | None]:
    """整曲分析（2026-08-18 按用户决定取消分段）：一次性把全曲送 Omni，
    返回单段 dict（time 强制 0~时长）。音频 token ≈ 15/s，超长曲截断保护上下文。"""
    client = _openai_client(api_key, base_url)
    prompt = load_music_prompt()
    duration = probe_audio_duration(audio_path)
    dur = min(duration, MUSIC_MAX_ANALYSIS_SEC)
    if dur < duration:
        logger.warning("audio too long, truncated to {}s: {}", int(dur), Path(audio_path).name)
    t0 = time.time()
    logger.info("Music analysis: model={} duration={:.0f}s file={}",
                model, duration, Path(audio_path).name)

    b64 = extract_audio_segment(audio_path, 0, dur)
    content = [
        {"type": "text", "text":
            f"这是一首完整的音乐作品（时长 {int(duration)} 秒{'' if dur >= duration else f'，仅提供前 {int(dur)} 秒'}），请分析整首曲目："},
        {"type": "input_audio", "input_audio": {"data": b64, "format": "wav"}},
        {"type": "text", "text": prompt},
    ]

    full_content = ""
    usage = None
    first_token = True
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        stream=True,
        stream_options={"include_usage": True},
    )
    for chunk in stream:
        if chunk.usage:
            usage = chunk.usage
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            if first_token:
                if on_progress:
                    on_progress("first_token")
                first_token = False
            full_content += delta.content
            if on_progress:
                on_progress("receiving", chars=len(full_content))

    seg = sanitize_music_segment(parse_music_segment(full_content), 0, duration)
    elapsed = time.time() - t0
    u = {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens,
         "total": usage.total_tokens} if usage else None
    logger.info("Music analysis done: {:.1f}s, seg={} file={}",
                elapsed, seg is not None, Path(audio_path).name)
    return ([seg] if seg else []), elapsed, u


def parse_music_segment(content: str) -> dict | None:
    """剥 ``` 围栏 → 解析单个 JSON 对象；失败返回 None（该段跳过聚合）。"""
    content = (content or "").strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    try:
        obj = json.loads(content)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        logger.warning("Music segment parse failed: {}", (content or "")[:120])
        return None


def sanitize_music_segment(obj: dict | None, start: float, end: float) -> dict | None:
    """词表白名单 + 权重归一 100 + 数值 clamp + 时间强制。"""
    if obj is None:
        return None
    tag_dims = ("mood", "genre", "instrument", "theme")
    key_map = {"theme": "video_theme"}
    out = {"time_start": _fmt_ts(start), "time_end": _fmt_ts(end)}
    for dim in tag_dims:
        raw = obj.get(key_map.get(dim, dim)) or []
        if not isinstance(raw, list):
            raw = []
        allowed = music_taxonomy_labels(key_map.get(dim, dim))
        items, acc = [], 0.0
        for it in raw:
            if not isinstance(it, dict):
                continue
            label = str(it.get("label", "")).strip()
            if label not in allowed:
                continue
            try:
                w = float(it.get("weight", 0))
            except (TypeError, ValueError):
                continue
            if w <= 0:
                continue
            items.append([label, w])
            acc += w
        if not items:                       # 全被过滤：该维度留空而不是丢段
            out[dim] = []
            continue
        norm = [{ "label": l, "weight": round(w / acc * 100) } for l, w in items]
        # 修整：归一后合计应=100（round 误差补到第一项）
        diff = 100 - sum(x["weight"] for x in norm)
        if norm and diff:
            norm[0]["weight"] = max(1, norm[0]["weight"] + diff)
        out[dim] = norm

    def _num(key, lo, hi, default):
        try:
            v = float(obj.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, v))

    out["arousal"] = _num("arousal", 0.0, 1.0, 0.5)
    out["valence"] = _num("valence", -1.0, 1.0, 0.0)

    voc_allowed = music_taxonomy_labels("vocals") | {""}
    lang_allowed = music_taxonomy_labels("vocals_language") | {""}
    voc = str(obj.get("vocals", "") or "").strip()
    out["vocals"] = voc if voc in voc_allowed else ""
    lang = str(obj.get("vocals_language", "") or "").strip()
    out["vocals_language"] = lang if lang in lang_allowed else ""
    # 无歌词形态强制语言为空
    if out["vocals"] in ("Instrumental", "Wordless Vocals", ""):
        out["vocals_language"] = ""
    wm = str(obj.get("watermark", "") or "").strip()
    out["watermark"] = "Present" if wm == "Present" else "None"
    out["watermark_text"] = str(obj.get("watermark_text", "") or "")[:300] if out["watermark"] == "Present" else ""
    return out


def _parse_response(content: str) -> list[dict]:
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)

    try:
        result = json.loads(content)
        if isinstance(result, list):
            logger.info("Video analysis result: {} segments, {}", len(result), json.dumps(result, ensure_ascii=False)[:2000])
            return result
        raise ValueError("Response is not a JSON array")
    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON from response")
        return [{"raw_response": content}]


def analyze_image(image_path: str | Path, api_key: str, model: str = "glm-4.6v",
                  base_url: str = CODING_BASE_URL, on_progress=None) -> tuple[dict, float, dict | None]:
    """Analyze a single image. Returns (result_dict, elapsed_seconds, usage_dict)."""

    image_url = encode_image_base64(image_path)
    client = _openai_client(api_key, base_url)

    if on_progress:
        on_progress("uploading")

    t0 = time.time()
    full_content = ""
    usage = None
    first_token = True

    logger.info("Image API call starting: model={} file={}", model, Path(image_path).name)
    stream = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_url}},
                {"type": "text", "text": load_img_prompt()},
            ],
        }],
        stream=True,
        stream_options={"include_usage": True},
    )

    for chunk in stream:
        if chunk.usage:
            usage = chunk.usage
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            if first_token:
                if on_progress:
                    on_progress("first_token")
                first_token = False
            logger.trace("image chunk: {}", repr(delta.content))
            full_content += delta.content
            if on_progress:
                on_progress("receiving", chars=len(full_content))

    elapsed = time.time() - t0
    logger.info("Image API call done: {:.1f}s, {} chars, file={}", elapsed, len(full_content), Path(image_path).name)

    usage_dict = None
    if usage:
        usage_dict = {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens, "total": usage.total_tokens}

    result = _parse_image_response(full_content)
    return result, elapsed, usage_dict


def _parse_image_response(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    try:
        result = json.loads(content)
        if isinstance(result, dict):
            logger.info("Image analysis result: {}", json.dumps(result, ensure_ascii=False))
            return result
        raise ValueError("Response is not a JSON object")
    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON from response")
        return {"raw_response": content}
