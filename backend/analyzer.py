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
