"""Local VLM engine — llama-server subprocess lifecycle (module-level singleton).

本地视觉分析引擎：按需 spawn llama-server（主模型 + mmproj 视觉投影器），
OpenAI 兼容接口（/v1），单实例单模型，切换模型 = 重启进程。
"""

from __future__ import annotations

import atexit
import glob
import os
import platform
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

from loguru import logger

from .config import BASE_DIR, LOG_DIR

# ── 模型清单（体积为 HF API 实测值，2026-08-16）──────────────────────
MODELS: dict[str, dict] = {
    "qwen3-vl-8b": {
        "label": "Qwen3-VL 8B",
        "quant": "Q4_K_M",
        "repo": "Qwen/Qwen3-VL-8B-Instruct-GGUF",
        "main_file": "Qwen3VL-8B-Instruct-Q4_K_M.gguf",
        "mmproj_file": "mmproj-Qwen3VL-8B-Instruct-F16.gguf",
        "size_gb": 5.76,
        "min_ram_gb": 12,
    },
    "qwen3-vl-30b-a3b": {
        "label": "Qwen3-VL 30B-A3B (MoE)",
        "quant": "Q4_K_M",
        "repo": "Qwen/Qwen3-VL-30B-A3B-Instruct-GGUF",
        "main_file": "Qwen3VL-30B-A3B-Instruct-Q4_K_M.gguf",
        "mmproj_file": "mmproj-Qwen3VL-30B-A3B-Instruct-F16.gguf",
        "size_gb": 18.29,
        "min_ram_gb": 32,
    },
}

MODELS_DIR = BASE_DIR / "backend" / "models" / "vlm"
BASE_PORT = 8080
CONTEXT_SIZE = 32768  # 单窗 64 帧 × ~400 token + prompt + JSON 输出的预算
STARTUP_TIMEOUT = 180  # 冷加载 17GB 模型可能较慢

# 健康检查/本地调用必须绕过代理环境变量（127.0.0.1 不能走 proxy）
_no_proxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_lock = threading.Lock()
_proc: subprocess.Popen | None = None
_model_id: str | None = None
_port: int | None = None
_started_at: float = 0.0


def _llama_server_path() -> Path | None:
    """按平台解析 llama-server 二进制（绝对路径，不依赖 PATH）。TODO: 打包后改从应用资源目录解析。"""
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        plat_dir = "darwin-arm64"
    else:
        return None
    candidates = sorted(glob.glob(str(BASE_DIR / "electron" / "resources" / "bin" / plat_dir / "llama-b*" / "llama-server")))
    return Path(candidates[-1]) if candidates else None


def installed_models() -> list[dict]:
    out = []
    for mid, m in MODELS.items():
        d = MODELS_DIR / mid
        installed = (d / m["main_file"]).exists() and (d / m["mmproj_file"]).exists()
        out.append({"id": mid, "label": m["label"], "quant": m["quant"],
                    "size_gb": m["size_gb"], "min_ram_gb": m["min_ram_gb"],
                    "installed": installed})
    return out


def status() -> dict:
    running = _proc is not None and _proc.poll() is None
    server = _llama_server_path()
    return {
        "running": running,
        "model_id": _model_id if running else None,
        "port": _port if running else None,
        "base_url": f"http://127.0.0.1:{_port}/v1" if running else None,
        "uptime": round(time.time() - _started_at, 1) if running else 0,
        "binary": str(server) if server else None,
        "models": installed_models(),
    }


def _free_port(start: int) -> int:
    for p in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise RuntimeError(f"{start}-{start + 19} 端口均被占用")


def _wait_ready(port: int, timeout: float) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if _proc is not None and _proc.poll() is not None:
            raise RuntimeError("llama-server 启动过程中退出（查看 data/logs/llama-server.log）")
        try:
            with _no_proxy_opener.open(f"http://127.0.0.1:{port}/health", timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.5)
    raise TimeoutError(f"llama-server {timeout}s 内未就绪")


def _stop_locked() -> None:
    global _proc, _model_id, _port
    if _proc is None:
        return
    try:
        os.killpg(os.getpgid(_proc.pid), signal.SIGTERM)
        _proc.wait(timeout=10)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(os.getpgid(_proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass
    except (PermissionError, OSError):
        pass
    _proc, _model_id, _port = None, None, None
    logger.info("llama-server stopped")


def ensure(model_id: str) -> dict:
    """保证 llama-server 以指定模型运行；模型切换时重启。返回 status()。"""
    global _proc, _model_id, _port, _started_at
    if model_id not in MODELS:
        raise ValueError(f"未知模型: {model_id}")
    m = MODELS[model_id]
    d = MODELS_DIR / model_id
    main_p, mm_p = d / m["main_file"], d / m["mmproj_file"]
    if not (main_p.exists() and mm_p.exists()):
        raise FileNotFoundError(f"模型未下载: {m['label']}（{d}）")
    server = _llama_server_path()
    if server is None:
        raise FileNotFoundError("llama-server 二进制未找到（electron/resources/bin/<平台>/）")

    with _lock:
        if _proc is not None and _proc.poll() is None:
            if _model_id == model_id:
                return status()
            logger.info("switching local VLM model: {} -> {}", _model_id, model_id)
            _stop_locked()
        port = _free_port(BASE_PORT)
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_f = open(LOG_DIR / "llama-server.log", "ab")
        try:
            _proc = subprocess.Popen(
                [str(server), "-m", str(main_p), "--mmproj", str(mm_p),
                 "--host", "127.0.0.1", "--port", str(port), "-c", str(CONTEXT_SIZE)],
                stdout=log_f, stderr=subprocess.STDOUT,
                start_new_session=True,  # 独立进程组，便于整组回收
            )
        except Exception:
            log_f.close()
            raise
        _model_id, _port, _started_at = model_id, port, time.time()
        logger.info("llama-server starting: model={} port={} pid={}", model_id, port, _proc.pid)
        try:
            _wait_ready(port, STARTUP_TIMEOUT)
        except Exception:
            _stop_locked()
            raise
        logger.info("llama-server ready: model={} port={} load={:.1f}s",
                    model_id, port, time.time() - _started_at)
        return status()


def stop() -> dict:
    with _lock:
        _stop_locked()
    return status()


# 应用退出时回收 llama-server（异常退出如 kill -9 时可能残留，进程组可手动清理）
atexit.register(lambda: _stop_locked())
