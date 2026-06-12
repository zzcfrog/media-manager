import base64
import json
import time
from pathlib import Path

from loguru import logger
from openai import OpenAI

from .emotion_labels import render_label_table

# VLM (Vision Language Model) API calls for video/image analysis.

PROMPT_FILE = Path(__file__).parent / "video_prompt.txt"
IMG_PROMPT_FILE = Path(__file__).parent / "img_prompt.txt"


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

    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
    )

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
    client = OpenAI(api_key=api_key, base_url=base_url)

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
