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

# ── 模型清单（体积为 HF API 实测值，2026-08-16/17）──────────────────────
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
    "qwen3.6-35b-a3b": {
        "label": "Qwen3.6 35B-A3B (MoE)",
        "quant": "UD-Q4_K_M",
        "repo": "unsloth/Qwen3.6-35B-A3B-GGUF",
        "main_file": "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
        "mmproj_file": "mmproj-F16.gguf",
        "size_gb": 22.13,   # mmproj 另 +0.90GB
        "min_ram_gb": 32,
    },
    "qwen3-omni-30b-a3b": {
        "label": "Qwen3-Omni 30B-A3B (MoE·音频)",
        "quant": "Q4_K_M",
        "repo": "ggml-org/Qwen3-Omni-30B-A3B-Instruct-GGUF",
        "main_file": "Qwen3-Omni-30B-A3B-Instruct-Q4_K_M.gguf",
        "mmproj_file": "mmproj-Qwen3-Omni-30B-A3B-Instruct-Q8_0.gguf",
        "size_gb": 18.56,   # mmproj 另 +1.33GB
        "min_ram_gb": 32,
        "audio": True,  # llama.cpp libmtmd 支持 audio input → 可选「音视频一起分析」
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
                    "installed": installed, "audio": bool(m.get("audio"))})
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


# ── 模型下载管理（hf-mirror 镜像 + 自研断点续传下载器）────────────────
# 不用 huggingface_hub.hf_hub_download：0.22.2 的数据流无读超时，镜像 CDN/代理
# 静默掐断长连接后 read() 永久阻塞（表现为进度永远 0% 且不报错）。
import json  # noqa: E402
import shutil  # noqa: E402

MIRROR = "https://hf-mirror.com"

_download_state = {"state": "idle", "model_id": None, "error": None,
                   "total_bytes": 0, "files_done_bytes": 0,
                   "_last_bytes": 0, "_last_t": 0.0, "speed_bps": 0.0}


def _hf_hub_dir() -> Path:
    return Path(os.environ.get("HF_HUB_CACHE",
                               Path.home() / ".cache" / "huggingface" / "hub"))


def _repo_cache_dir(repo: str) -> Path:
    return _hf_hub_dir() / ("models--" + repo.replace("/", "--"))


def download_status() -> dict:
    """轮询端点数据源：累计已下字节 = 已完成文件字节 + 当前 *.part 字节。"""
    st = _download_state
    out = {"state": st["state"], "model_id": st["model_id"], "error": st["error"],
           "total_bytes": st["total_bytes"], "done_bytes": st["files_done_bytes"],
           "speed_bps": 0}
    if st["state"] == "downloading" and st["model_id"]:
        m = MODELS.get(st["model_id"])
        if m:
            d = MODELS_DIR / st["model_id"]
            inc = sum(f.stat().st_size for f in d.glob("*.part") if f.is_file())
            done = st["files_done_bytes"] + inc
            now = time.time()
            if st["_last_t"] and now > st["_last_t"] + 0.2:
                st["speed_bps"] = max(0, (done - st["_last_bytes"]) / (now - st["_last_t"]))
            st["_last_bytes"], st["_last_t"] = done, now
            out["done_bytes"] = done
            out["speed_bps"] = round(st["speed_bps"], 0)
    return out


_SEG = 8            # 大文件并发连接数（镜像单连接限速，多段并发提升总吞吐）
_SEG_BLOCK = 64 << 20  # 每段推进单位（断点续传粒度，块内中断则该块重下）
_SEG_MIN = 128 << 20   # 超过此大小才启用分片


def _download_file(repo: str, filename: str, dest: Path, expected_size: int,
                   session=None) -> None:
    """带超时与重试的断点续传下载：dest.part 落盘，完成校验大小后 rename。
    大文件（≥128MB 且已知大小）走 _SEG 段并发分片；小文件单连接。"""
    url = f"{MIRROR}/{repo}/resolve/main/{filename}"
    part = dest.with_name(dest.name + ".part")
    part.parent.mkdir(parents=True, exist_ok=True)
    if expected_size >= _SEG_MIN:
        _download_segmented(url, filename, part, expected_size)
    else:
        _download_plain(url, filename, part, session)
    got = part.stat().st_size
    if expected_size and got != expected_size:
        part.unlink(missing_ok=True)
        raise RuntimeError(f"文件大小不符: {filename} 期望 {expected_size} 实得 {got}")
    if dest.exists() or dest.is_symlink():
        dest.unlink()
    part.rename(dest)
    part.with_name(part.name + ".json").unlink(missing_ok=True)  # 分片进度 sidecar


def _download_plain(url: str, filename: str, part: Path, session=None) -> None:
    """单连接断点续传（小文件 / 大小未知时）。"""
    import requests
    s = session or requests.Session()
    retries = 0
    while True:
        pos = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={pos}-"} if pos else {}
        try:
            r = s.get(url, stream=True, timeout=(10, 60), headers=headers)
            if r.status_code == 416:  # Range 越界 = 已下完
                r.close()
                break
            r.raise_for_status()
            append = r.status_code == 206  # 200 = 服务器不支持续传，重写
            with open(part, "ab" if append else "wb") as f:
                for chunk in r.iter_content(256 * 1024):
                    f.write(chunk)
            r.close()
            break
        except Exception as e:
            retries += 1
            if retries > 10:
                raise RuntimeError(f"下载失败（已重试 {retries} 次）: {e}")
            logger.warning("download retry #{}: {} (at {:.1f}MB) {}",
                           retries, e, pos / 1048576, filename)
            time.sleep(min(30, 2 ** retries))


def _download_segmented(url: str, filename: str, part: Path, total: int) -> None:
    """N 段并发分片：预分配 part 整文件，各线程 pwrite 自己区间；
    `<part>.json` 记录每段连续完成前缀（块级断点），全部完成后由调用方校验+rename。
    兼容旧单线程 .part：无 json 时把已有顺序前缀映射为各段进度。"""
    meta_path = part.with_name(part.name + ".json")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
    else:
        segs = [0] * _SEG
        if part.exists():
            # 旧单线程顺序 .part → [0,X) 区间完整：整段落在 X 内的算完成
            x = part.stat().st_size
            bounds = [(i * total // _SEG, (i + 1) * total // _SEG - 1) for i in range(_SEG)]
            for i, (lo, hi) in enumerate(bounds):
                segs[i] = (hi - lo + 1) if x > hi else 0
        meta = {"segs": segs}
        meta_path.write_text(json.dumps(meta))
    bounds = [(i * total // _SEG, (i + 1) * total // _SEG - 1) for i in range(_SEG)]
    with open(part, "r+b" if part.exists() else "wb") as f:
        f.truncate(total)

    errors: dict[int, Exception] = {}

    def worker(i: int, lo: int, hi: int) -> None:
        import requests
        seg_len = hi - lo + 1
        s = requests.Session()
        retries = 0
        done = meta["segs"][i]
        while done < seg_len:
            pos = lo + done
            want = min(_SEG_BLOCK, hi - pos + 1)
            try:
                r = s.get(url, stream=True, timeout=(10, 60),
                          headers={"Range": f"bytes={pos}-{pos + want - 1}"})
                if r.status_code == 416:
                    r.close()
                    done = seg_len
                else:
                    r.raise_for_status()
                    n = 0
                    with open(part, "r+b") as f:
                        f.seek(pos)
                        for chunk in r.iter_content(256 * 1024):
                            f.write(chunk)
                            n += len(chunk)
                    r.close()
                    if n != want:
                        raise RuntimeError(f"块不完整: 期望 {want} 实收 {n}")
                    done += want
                meta["segs"][i] = done
                meta_path.write_text(json.dumps(meta))
                retries = 0
            except Exception as e:
                retries += 1
                if retries > 10:
                    errors[i] = RuntimeError(f"段 {i} 下载失败（已重试 {retries} 次）: {e}")
                    return
                logger.warning("seg download retry #{}: {} (at {:.1f}MB) {}",
                               retries, e, pos / 1048576, filename)
                time.sleep(min(30, 2 ** retries))

    threads = [threading.Thread(target=worker, args=(i, lo, hi),
                                daemon=True, name=f"dl-seg{i}")
               for i, (lo, hi) in enumerate(bounds)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise RuntimeError("; ".join(str(e) for e in errors.values()))


def _download_thread(model_id: str) -> None:
    try:
        m = MODELS[model_id]
        # 精确字节数（失败回退注册表估算）
        sizes = {}
        try:
            with _no_proxy_opener.open(f"{MIRROR}/api/models/{m['repo']}/tree/main",
                                       timeout=15) as r:
                for f in json.loads(r.read().decode()):
                    if f.get("path") in (m["main_file"], m["mmproj_file"]):
                        sizes[f["path"]] = int(f.get("size", 0))
        except Exception as e:
            logger.warning("model size query failed (fallback to estimate): {}", e)
        total = sum(sizes.values()) or int((m["size_gb"] + 1.0) * 1e9)
        _download_state.update(state="downloading", model_id=model_id, error=None,
                               total_bytes=total, files_done_bytes=0,
                               _last_bytes=0, _last_t=0.0, speed_bps=0.0)

        d = MODELS_DIR / model_id
        d.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(d).free
        if free < total * 1.05:
            raise RuntimeError(f"磁盘空间不足：需 {total / 1e9:.1f}GB，剩余 {free / 1e9:.1f}GB")
        for name in (m["main_file"], m["mmproj_file"]):
            _download_file(m["repo"], name, d / name, sizes.get(name, 0))
            _download_state["files_done_bytes"] += sizes.get(name, 0) or \
                (d / name).stat().st_size
        _download_state.update(state="done", model_id=model_id)
        logger.info("model downloaded: {} ({:.1f}GB)", model_id, total / 1e9)
    except Exception as e:
        _download_state.update(state="error", error=str(e))
        logger.error("model download failed: {} {}", model_id, e)


def start_download(model_id: str) -> dict:
    if model_id not in MODELS:
        raise ValueError(f"未知模型: {model_id}")
    if _download_state["state"] == "downloading":
        raise RuntimeError("已有下载任务进行中，请等待完成")
    m = MODELS[model_id]
    if (MODELS_DIR / model_id / m["main_file"]).exists():
        raise RuntimeError("模型已下载")
    threading.Thread(target=_download_thread, args=(model_id,),
                     daemon=True, name=f"dl-{model_id}").start()
    return {"state": "downloading", "model_id": model_id}


def delete_model(model_id: str) -> dict:
    """删除模型：软链目录 + HF 缓存仓库目录。引擎运行中/下载中的模型拒删。"""
    if model_id not in MODELS:
        raise ValueError(f"未知模型: {model_id}")
    if _download_state["state"] == "downloading" and _download_state["model_id"] == model_id:
        raise RuntimeError("该模型正在下载，无法删除")
    running = _proc is not None and _proc.poll() is None and _model_id == model_id
    if running:
        raise RuntimeError("本地引擎正在运行该模型，请先停止引擎（或重启应用）后再删除")
    removed = []
    d = MODELS_DIR / model_id
    if d.exists():
        shutil.rmtree(d)
        removed.append(str(d))
    cache = _repo_cache_dir(MODELS[model_id]["repo"])
    if cache.exists():
        shutil.rmtree(cache)
        removed.append(str(cache))
    logger.info("model deleted: {} ({})", model_id, removed)
    return {"removed": removed}


# 应用退出时回收 llama-server（异常退出如 kill -9 时可能残留，进程组可手动清理）
atexit.register(lambda: _stop_locked())
