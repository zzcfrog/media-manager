import base64
import cgi
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
import webbrowser
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse, unquote, parse_qs

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
LOG_DIR = BASE_DIR / "logs"

load_dotenv(BASE_DIR / ".env")

LOG_DIR.mkdir(exist_ok=True)
logger = logging.getLogger("viewer")
logger.setLevel(logging.INFO)
_file_handler = RotatingFileHandler(LOG_DIR / "viewer.log", maxBytes=10*1024*1024, backupCount=5, encoding="utf-8")
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logger.addHandler(_file_handler)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/" or path == "/viewer.html":
            self._serve_file(BASE_DIR / "viewer.html", "text/html")
        elif path == "/api/analyses":
            self._json_response(self._list_analyses())
        elif path == "/api/find":
            qs = parse_qs(urlparse(self.path).query)
            video_name = qs.get("name", [""])[0]
            self._find_analysis(video_name)
        elif path.startswith("/api/analysis/"):
            name = unquote(path[len("/api/analysis/"):])
            self._serve_analysis(name)
        elif path == "/video":
            qs = parse_qs(urlparse(self.path).query)
            video_path = Path(qs["path"][0])
            self._serve_video(video_path)
        elif path == "/api/probe":
            qs = parse_qs(urlparse(self.path).query)
            video_path = qs.get("path", [""])[0]
            self._probe_video(video_path)
        else:
            self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/analyze":
            self._handle_analyze()
        elif path == "/api/retry-analyze":
            self._handle_retry_analyze()
        else:
            self.send_error(404)

    def _handle_analyze(self):
        content_type = self.headers.get("Content-Type", "")
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                environ={"REQUEST_METHOD": "POST",
                                         "CONTENT_TYPE": content_type})
        file_item = form["video"]
        if not file_item.filename:
            self.send_error(400, "No video file")
            return

        model = form.getvalue("model", "glm-4.6v")
        resolution = form.getvalue("resolution", "480")
        fps = form.getvalue("fps", "30")

        # Save uploaded file to temp
        suffix = Path(file_item.filename).suffix or ".mp4"
        tmp_dir = Path("temp_video")
        tmp_dir.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        uploaded_path = tmp_dir / f"upload_{ts}{suffix}"
        with open(uploaded_path, "wb") as f:
            f.write(file_item.file.read())

        video_name = file_item.filename
        logger.info(f"analyze start video={video_name} model={model} size={uploaded_path.stat().st_size / (1024*1024):.1f}MB")

        # SSE streaming response
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def send_sse(data):
            self.wfile.write(data.encode("utf-8"))
            self.wfile.flush()

        def send_event(event_type, payload):
            send_sse(f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n")

        compressed_path = None
        success = False
        try:
            # Step 1: compress
            send_event("progress", {"step": "compressing", "message": f"压缩视频 480p 30fps..."})
            t0 = time.time()
            compressed_path, compress_time = _compress_video(uploaded_path, resolution=resolution, fps=fps)
            size_mb = compressed_path.stat().st_size / (1024 * 1024)
            send_event("progress", {"step": "compressed", "message": f"压缩完成: {size_mb:.1f}MB, 耗时 {compress_time:.1f}s"})

            # Step 2: encode
            send_event("progress", {"step": "encoding", "message": "Base64编码中..."})
            video_url = _encode_base64(compressed_path)
            b64_mb = len(video_url) / (1024 * 1024)
            send_event("progress", {"step": "encoded", "message": f"编码完成: {b64_mb:.1f}MB"})

            # Step 3: analyze
            send_event("progress", {"step": "analyzing", "message": f"调用 {model} 分析中..."})

            api_key = os.getenv("ZHIPUAI_API_KEY")
            if not api_key:
                send_event("error", {"message": "API Key未配置"})
                return

            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url="https://open.bigmodel.cn/api/coding/paas/v4/")
            prompt = (BASE_DIR / "prompt.txt").read_text(encoding="utf-8")

            t1 = time.time()
            full_content = ""
            usage = None

            stream = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": [
                    {"type": "video_url", "video_url": {"url": video_url}},
                    {"type": "text", "text": prompt},
                ]}],
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
                    full_content += delta.content
                    send_sse(f"data: {json.dumps({'type': 'content', 'text': delta.content}, ensure_ascii=False)}\n\n")

            analyze_time = time.time() - t1

            # Parse
            segments = _parse_response(full_content)

            usage_dict = None
            if usage:
                usage_dict = {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens, "total": usage.total_tokens}

            # Save
            base_name = Path(video_name).stem
            data = {"source_video": video_name, "segments": segments}

            send_event("done", {
                "message": "分析完成",
                "compress_time": round(compress_time, 1),
                "analyze_time": round(analyze_time, 1),
                "tokens": usage_dict,
                "segments_count": len(segments),
            })
            success = True
            logger.info(f"analyze done video={video_name} segments={len(segments)} compress={compress_time:.1f}s analyze={analyze_time:.1f}s tokens={usage_dict}")

        except Exception as e:
            send_event("error", {"message": str(e), "compressed_path": str(compressed_path) if compressed_path else ""})
            logger.error(f"analyze failed video={video_name} error={e}")
        finally:
            # Cleanup uploaded file
            if uploaded_path.exists():
                uploaded_path.unlink()
            # Only cleanup compressed file on success
            if success and compressed_path and compressed_path.exists():
                compressed_path.unlink()

    def _handle_retry_analyze(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        compressed_path = Path(body.get('compressed_path', ''))
        model = body.get('model', 'glm-4.6v')
        video_name = body.get('video_name', 'video')
        logger.info(f"retry start video={video_name} model={model}")

        if not compressed_path.exists():
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(f"data: {json.dumps({'type': 'error', 'message': '临时文件已过期，请重新上传分析'}, ensure_ascii=False)}\n\n".encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def send_sse(data):
            self.wfile.write(data.encode("utf-8"))
            self.wfile.flush()

        def send_event(event_type, payload):
            send_sse(f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n")

        success = False
        try:
            send_event("progress", {"step": "encoding", "message": "Base64编码中..."})
            video_url = _encode_base64(compressed_path)
            b64_mb = len(video_url) / (1024 * 1024)
            send_event("progress", {"step": "encoded", "message": f"编码完成: {b64_mb:.1f}MB"})

            send_event("progress", {"step": "analyzing", "message": f"调用 {model} 分析中..."})

            api_key = os.getenv("ZHIPUAI_API_KEY")
            if not api_key:
                send_event("error", {"message": "API Key未配置"})
                return

            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url="https://open.bigmodel.cn/api/coding/paas/v4/")
            prompt = (BASE_DIR / "prompt.txt").read_text(encoding="utf-8")

            t1 = time.time()
            full_content = ""
            usage = None

            stream = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": [
                    {"type": "video_url", "video_url": {"url": video_url}},
                    {"type": "text", "text": prompt},
                ]}],
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
                    full_content += delta.content
                    send_sse(f"data: {json.dumps({'type': 'content', 'text': delta.content}, ensure_ascii=False)}\n\n")

            analyze_time = time.time() - t1

            segments = _parse_response(full_content)

            usage_dict = None
            if usage:
                usage_dict = {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens, "total": usage.total_tokens}

            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            base_name = Path(video_name).stem
            data = {"source_video": video_name, "segments": segments}

            send_event("done", {
                "message": "分析完成",
                "compress_time": 0,
                "analyze_time": round(analyze_time, 1),
                "tokens": usage_dict,
                "segments_count": len(segments),
            })
            success = True
            logger.info(f"retry done video={video_name} segments={len(segments)} analyze={analyze_time:.1f}s tokens={usage_dict}")
        except Exception as e:
            send_event("error", {"message": str(e), "compressed_path": str(compressed_path)})
            logger.error(f"retry failed video={video_name} error={e}")
        finally:
            if success and compressed_path.exists():
                compressed_path.unlink()

    def _list_analyses(self):
        if not OUTPUT_DIR.exists():
            return []
        return sorted(f.name for f in OUTPUT_DIR.glob("*.json"))

    def _find_analysis(self, video_name):
        if not video_name or not OUTPUT_DIR.exists():
            self._json_response(None)
            return
        stem = Path(video_name).stem
        for f in sorted(OUTPUT_DIR.glob("*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            src = data.get("source_video", "")
            if Path(src).stem == stem or f.stem.startswith(stem):
                self._json_response({"file": f.name, "data": data})
                return
        self._json_response(None)

    def _serve_analysis(self, name):
        fpath = OUTPUT_DIR / name
        if not fpath.exists():
            self.send_error(404)
            return
        data = json.loads(fpath.read_text(encoding="utf-8"))
        self._json_response(data)

    def _serve_video(self, video_path):
        if not video_path.exists():
            self.send_error(404)
            return
        size = video_path.stat().st_size
        ext = video_path.suffix.lower()
        mime = {".mp4": "video/mp4", ".mov": "video/quicktime",
                ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
                ".webm": "video/webm"}.get(ext, "video/mp4")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        with open(video_path, "rb") as f:
            self.end_headers()
            self.wfile.write(f.read())

    def _probe_video(self, video_path):
        video_path = Path(video_path)
        if not video_path.exists() or not shutil.which("ffprobe"):
            self._json_response(None)
            return
        try:
            cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(video_path)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            info = json.loads(result.stdout)
            vs = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
            fmt = info.get("format", {})
            self._json_response({
                "resolution": f"{vs.get('width', '?')}x{vs.get('height', '?')}" if vs.get("width") else None,
                "fps": vs.get("r_frame_rate"),
                "codec": vs.get("codec_name"),
                "duration": fmt.get("duration"),
                "size_mb": round(int(fmt.get("size", 0)) / (1024 * 1024), 1) if fmt.get("size") else None,
                "camera": vs.get("tags", {}).get("com.apple.quicktime.model") or vs.get("tags", {}).get("model"),
                "path": str(video_path),
            })
        except Exception:
            self._json_response(None)

    def _serve_file(self, fpath, content_type):
        if not fpath.exists():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        content = fpath.read_bytes()
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _json_response(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # Suppress default stderr logging


RES_MAP = {"480": 854, "320": 640, "240": 426}

def _compress_video(input_path: Path, resolution="480", fps="30") -> tuple[Path, float]:
    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    tmp_dir = Path("temp_video")
    tmp_dir.mkdir(exist_ok=True)
    output_path = tmp_dir / f"{input_path.stem}_{suffix}.mp4"
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found")
    w = RES_MAP.get(resolution, 854)
    h = int(w * 9 / 16)  # keep 16:9, even height
    h = h + (h % 2)  # ensure even
    cmd = ["ffmpeg", "-i", str(input_path), "-vf", f"scale={w}:{h},fps={fps}",
           "-c:v", "libx264", "-crf", "28", "-preset", "fast",
           "-c:a", "aac", "-b:a", "64k", "-y", str(output_path)]
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - t0
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[:200]}")
    return output_path, elapsed


def _encode_base64(video_path: Path) -> str:
    with open(video_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:video/mp4;base64,{data}"


def _parse_response(content: str) -> list[dict]:
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)
    try:
        result = json.loads(content)
        if isinstance(result, list):
            return result
        raise ValueError("Not a JSON array")
    except json.JSONDecodeError:
        return [{"raw_response": content}]


def main():
    port = 8080
    for p in range(port, port + 10):
        try:
            server = HTTPServer(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue
    else:
        print("No available port found")
        return

    url = f"http://127.0.0.1:{port}"
    print(f"Viewer running at {url}")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nViewer stopped.")


if __name__ == "__main__":
    main()
