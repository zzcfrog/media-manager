# PRD: 本地视觉分析引擎（云端/本地双引擎配置）

## 一、背景与目标

### 问题
当前 AI 分析只支持云端智谱 GLM-4V 系列（[analyzer.py](../backend/analyzer.py) 硬编码 `CODING_BASE_URL`）：

1. **持续消耗 token**——素材量大的用户（一次导出几百段）分析成本高
2. **必须联网**——离线环境（外出拍摄、飞机上）完全无法分析
3. **隐私顾虑**——部分用户不接受素材经 API 上传（即便是压缩后）

### 目标
设置页支持**双引擎配置**：视频/图片分析既可选用**云端模型**（现状，质量最优），也可选用**本地模型**（免费、隐私、离线，质量够用）。本地引擎基于 llama-server + Qwen3-VL GGUF，与产品现有「云端 OpenAI 兼容调用」架构同构。

### 定位声明
本地档定位是「免费 · 隐私 · 离线 · 够用」，**不是**云端档的平替（Video-MME 约 69–74 vs 云端更高）；产品文案不得暗示质量等同。

---

## 二、用户故事

1. 作为不想付 API 费用的用户，我想在设置里把分析引擎切到本地模型，之后所有分析不再消耗 token
2. 作为注重隐私的用户，我想用本地模型分析，素材完全不经过网络
3. 作为经常离线的用户（外出拍摄），我想在无网环境下照常分析素材
4. 作为 32GB+ 内存的 Mac 用户，我想在 8B（快）和 30B-A3B（更准）两个本地模型间选择
5. 作为磁盘紧张的用户，我想把 24GB 的本地模型下载到外置盘，且下载能断点续传
6. 作为国内用户，我想模型下载默认走国内镜像，不用自己配代理
7. 作为已有 API Key 的用户，我想视频用云端、图片用本地（或反之），两条链路独立配置

---

## 三、功能规格

### 3.1 引擎选择（设置页）

- **视频 tab / 图片 tab** 各新增「分析引擎」单选：
  - **云端（智谱）**——现有 UI 原样保留（API Key + 模型选择 + 压缩参数）
  - **本地（Qwen3-VL）**——选中时：
    - 显示本地模型选择（仅列出已下载的；未下载的显示「未下载 · 体积 · 下载按钮」）
    - 隐藏 API Key（本地无需）
    - 图片压缩参数保留（base64 需要小图）；**视频压缩区块整体隐藏**——抽帧直接吃原片，抽帧时同步降分辨率（见 3.4）
- **本地模型全局唯一**：视频/图片共用同一个本地引擎实例和模型（llama-server 单实例单模型，30B 占 ~20GB 内存不可能双开）。切换模型 = 重启引擎加载新模型
- **默认值**：引擎默认云端（不改变现有用户体验）；两个 tab 都可独立切换

### 3.2 本地模型管理

- **模型清单**（首版两项，结构上可扩展）：

| 模型 | 文件 | 体积 | 内存要求 | 特性 |
|---|---|---|---|---|
| Qwen3-VL-8B Q4_K_M | 主模型 + mmproj(F16) | ~5.8 GB | 12 GB+ | 视觉 |
| Qwen3-VL-30B-A3B Q4_K_M | 主模型 + mmproj(F16) | ~18.3 GB | 32 GB+ | 视觉 |
| Qwen3.6-35B-A3B UD-Q4_K_M | 主模型 + mmproj(F16)，repo `unsloth/Qwen3.6-35B-A3B-GGUF` | ~22.1 GB（+0.9 mmproj） | 32 GB+ | 视觉（文本/图片/视频） |
| Qwen3-Omni-30B-A3B Q4_K_M | 主模型 + mmproj(Q8_0)，repo `ggml-org/Qwen3-Omni-30B-A3B-Instruct-GGUF` | ~18.6 GB（+1.3 mmproj） | 32 GB+ | **音频输入 + 视觉**（ASR，可音视频同析） |

- **Omni 音视频同析**（仅 Qwen3-Omni，新设置键 `local_asr_mode`：`separate`（默认）/`merged`）：merged 时每窗抽帧同时抽 16k 单声道音轨（`input_audio`）随帧送入模型，模型直接听原声，**跳过独立 whisper 转写**（分析档显示「视听分析」，流程少一步）；separate 时走原独立 whisper 链路（转写更稳）。llama.cpp libmtmd 支持 Qwen3-Omni 的 audio + vision 输入（语音**输出** talker 未集成，我们只用输入）

- **下载（已实现，2026-08-17；同日改自研下载器修复 0% 卡死）**：下载/删除按钮位于**本地模型下拉菜单内**（每选项右侧：已装=删除、未装=下载；点击先收起菜单再二次确认）；**自研下载器**（`local_vlm._download_file`：requests 流式 + 连接/读双超时 + 失败自动重试 ≤10 次指数退避 + Range 断点续传——hf_hub_download 0.22.2 数据流无读超时，镜像/代理静默掐断连接后 read() 永久阻塞、进度永远 0%；**≥128MB 文件 8 连接分片并发**，64MB 块级断点 sidecar，兼容旧单线程进度；镜像单连接限速实测 0.87~3.45MB/s，分片为唯一提速手段——HF 官方源直连/代理均不通）；`<file>.part` 直接落 `backend/models/vlm/<id>/`，完成校验大小后 rename（不再经 HF cache/软链）；**进度用轮询 GET `/api/local-vlm/download`**（1.5s 间隔，弹窗关闭/刷新页面不中断，后台线程续跑）——比 SSE 更适合 30min+ 的长任务；进度 = 已完成文件字节 + `.part` 实时字节（精确总量从镜像 API 拉取，失败回退注册表估算）；下载前磁盘空间检查（<1.05× 需求拒下）；同一时刻仅一个下载任务（其它未装模型按钮置灰）
- **下载目录**：默认 `backend/models/vlm/`（开发期）；产品化后默认应用数据目录，**用户可改**（外置盘）
- **磁盘/内存检查**：下载前检查剩余空间（已实现）；选模型时按本机内存提示推荐档位，内存不足仅提示不阻止（用户自负）——行内显示「需内存 N GB+ · 未下载」
- **删除（已实现）**：管理行删除按钮（二次确认，显示释放体积）；同时删模型目录软链与 HF 缓存仓库目录；引擎运行中/下载中的模型拒删（先停引擎）

### 3.3 引擎生命周期（llama-server）

- **按需启动**：首次用本地引擎发起分析时自动启动；切换模型时重启；启动期间分析请求排队并显示「引擎启动中（约 10–40s）」
- **端口**：默认 8080，被占用时自动顺延（8081、8082…）
- **二进制定位**：`electron/resources/bin/<platform>/llama-b*/llama-server`（绝对路径，不依赖 PATH——见打包待办的 PATH 教训）；开发期从项目内找，找不到时提示
- **自动退出**：空闲 30 分钟自动关闭释放内存（可关）；应用退出时关闭
- **失败处理**：启动失败（内存不足/文件损坏）→ 明确报错 + 日志入口

### 3.4 分析链路适配

- **图片**：本地引擎直接吃现有 `image_url` base64——**链路零改动**，仅换 base_url/模型名
- **视频**：本地栈不接受 `video_url` 视频，改为**抽帧多图**：
  - ffmpeg **直接从原片抽帧**（无压缩中间产物，10 分钟视频省一次全片重编码 + 一个临时文件），抽帧 filter 同步做 `fps=N,scale=W:H`（短边 = `local_frames_res`，240/480/720 三档）；macOS 加 `-hwaccel videotoolbox` 硬解（4K 10bit HEVC 软解极重且与 llama-server 推理抢核，实测硬解省 30× CPU）。fps 可调 **0.5–10**：预设「0.5 省 / 1 标准 / 2 均衡 / 5 精细 / 10 极致」；单窗帧数上限默认 32（16–128 可调）。**成本随 fps × 分辨率线性增长**：窗口时长 = 帧数上限 ÷ fps，fps 越高窗口越短、请求越多（10 分钟视频：1 fps ≈ 10 次请求 ≈ 15–20 分钟；5 fps ≈ 47 次 ≈ 1 小时+，30B 实测后校准）。快切素材（<1s 镜头）均匀采样天然会漏镜，靠调高 fps 缓解；场景切换检测抽帧（ffmpeg scene detection 混合采样）列为后续优化
  - 每帧作为 `image_url` + prompt 中标注对应时间戳，让模型按现有 `video_prompt.txt` 输出**同样结构的分镜 JSON**
  - **长视频分窗**：超过单窗时长（`local_frames_max` ÷ fps 秒）的视频按窗切块，每窗独立抽帧+请求，prompt 中帧标注**绝对时间戳**（实测模型可正确输出跨窗连续的绝对时间，无需事后偏移；仍保留「窗内相对时间 → 平移回绝对」的兜底），窗边界相接且连续的分镜后处理合并。内存与上下文消耗恒定，不随视频时长增长。**实测（2026-08-16，8B）**：每帧约 190 token（240p）/ 400（480p）/ ~900（720p，线性推算）——`local_frames_max` 默认 32（480p 64 帧 ≈ 2.6 万 token 逼近 32K 上下文，不安全）
  - prompt 中 ASR 行固定为「由独立语音模型提供」——**本地模式默认走 faster-whisper**（帧无音频），whisper 直接吃**原片音轨**（未经压缩再编码，音质更好），「视频分析」页的语音分析子模块照常可配 whisper 型号；**例外**：支持音频输入的模型 + `local_asr_mode=merged` 时音轨随帧送入模型（input_audio），无独立转写步（见 3.2）
- **用量统计**：本地无 token 计费，分析记录的 usage 显示为空/「本地」

### 3.5 边界与非目标（本期不做）

- 不做 Windows/Linux 本地引擎（架构按平台解析二进制预留）
- 不做多本地模型并行
- 不做模型自动更新
- 不做本地「创作构思」（creative）链路——本期只覆盖视频/图片分析

---

## 四、数据模型

settings 表新增 key（沿用扁平 KV，[settings.py](../backend/blueprints/settings.py) 零改动）：

| key | 取值 | 默认 |
|---|---|---|
| `video_engine` | `cloud` / `local` | `cloud` |
| `image_engine` | `cloud` / `local` | `cloud` |
| `local_model` | `qwen3-vl-8b` / `qwen3-vl-30b-a3b` | `qwen3-vl-8b` |
| `local_frames_fps` | `0.5`–`10`（步进 0.5） | `1` |
| `local_frames_max` | `16`–`128` | `32` |
| `local_frames_res` | `240` / `480` / `720`（帧短边像素） | `480` |
| `local_asr_mode` | `separate`（独立 whisper）/ `merged`（Omni 音视频一起）——仅 Qwen3-Omni 生效，UI 上选其它模型时不显示该选项 | `separate` |
| `local_download_dir` | 路径 | 空=项目内默认 |
| `local_hf_endpoint` | URL | `https://hf-mirror.com` |

模型元信息（清单、体积、内存要求、HF repo/文件名）后端硬编码常量表，不进 DB。

---

## 五、UI 交互规格

- **设置弹窗**（[index.html](../frontend/index.html) 现有 tab 结构不变，现为 4 tab：通用/图片分析/视频分析/剪辑构思，语音分析为视频页内子模块）：
  - 视频/图片 tab 顶部加「分析引擎」radio 组；选「本地」时该 tab 下方的 API Key 区域折叠、本地模型区展开；视频 tab 的压缩区块（压缩分辨率/帧率/硬件加速/估算码率）整体隐藏，替换为本地参数（模型/抽帧帧率/单窗帧数上限/帧分辨率三档）
  - 本地模型区：模型卡片列表（名称 · 量化 · 体积 · 内存要求 · 状态徽标[已下载/未下载/下载中 x%]）+ 下载/删除按钮 + 「所有引擎共用此本地模型」说明文字
  - 下载中：卡片内进度条 + 取消按钮；下载完成 toast
- **分析确认弹窗**（画廊右键批量分析）：模型行显示引擎标识——云端「智谱 GLM-4.6V」/ 本地「本地 Qwen3-VL-8B」
- **顶部分析进度条**：本地引擎首次启动时任务状态多一档「等待引擎启动」；本地视频阶段列表 = **本地引擎启动 → 抽帧（逐窗 %）→ 视觉分析（窗 i/N）→ 语音转写（加载/识别）→ 合并保存**（无「压缩/编码」），进度事件携带 `engine` 字段驱动；引擎启动期间显示已耗时秒数
- **i18n**：所有新文案中英双语（[i18n.js](../frontend/js/i18n.js) `s.*` 命名空间）

---

## 六、技术方案

- **调用侧零新依赖**：[analyzer.py](../backend/analyzer.py) `analyze_image/analyze_video` 已收 `base_url`/`model` 参数，本地模式传 `http://127.0.0.1:<port>/v1` + 模型名即可；新增 `encode_video_frames()`（ffmpeg 抽帧 → base64 列表 → content 多图 + 时间戳标注）
- **引擎管理**：新建 `backend/local_vlm.py`——单例 spawn/健康检查/端口顺延/空闲退出，参考 [asr/\_\_init\_\_.py](../backend/asr/__init__.py) 的 preload 模式；llama-server 参数 `-m <主模型> --mmproj <投影器> --port <p> -c 32768`（默认 4K context 不够长视频 JSON 输出）
- **模型下载**：`huggingface_hub.hf_hub_download`（faster-whisper 已带此依赖）+ `HF_ENDPOINT` 切镜像，SSE 汇报进度（参考 [library.py](../backend/blueprints/library.py) 批量改时间的 SSE 模式）
- **新路由** `backend/blueprints/local_vlm.py`：`GET /api/local-vlm/status`、`GET /api/local-vlm/models`、`POST /api/local-vlm/download`（SSE）、`POST /api/local-vlm/delete`、`POST /api/local-vlm/start`
- **分析编排**：[analysis.py](../backend/blueprints/analysis.py) 读 `*_engine` 决定 base_url/模型；本地时强制 `use_multimodal=False`
- **Electron**：本期 backend 直接 spawn 二进制；产品化时移到 main.js 统一管理伴生进程（见打包待办）

---

## 七、实现步骤（建议顺序）

1. ✅ `local_vlm.py` 引擎管理 + 路由 + status/models 接口 → 验证：手动启停 llama-server、端口顺延
2. ✅ 图片本地分析打通（设置项 + analyzer 换 base_url + 设置页 UI）→ 验证：单图分析 JSON 结构与云端一致
3. ✅ 视频抽帧适配 `extract_video_frames()` + prompt 绝对时间戳标注 → 验证：真实视频分镜 JSON（2 窗拼接连续、whisper ASR 正确合入）
4. ~~模型下载管理（镜像源、断点续传、进度、删除）+ 设置页模型管理 UI~~ ✅ 2026-08-17 已实现（进度用轮询 GET，未用 SSE——长任务弹窗会关，轮询更稳）
5. 引擎自动启动/重启/空闲退出 + 分析确认弹窗/进度条的引擎标识
6. i18n 补全 + todo/UE/TECH 文档同步

## 八、验证清单

- [ ] 云端→本地→云端切换，两条链路各自正常，互不残留
- [ ] 本地图片分析：13/16 维字段齐全，可编辑、可写 XMP（与云端产物同构）
- [ ] 本地视频分析：分镜时间戳与帧标注对应、JSON 可解析
- [ ] 本地模式音频强制 whisper；视频页语音分析子模块切换 ASR 模型正常
- [ ] 8B ↔ 30B 切换触发引擎重启，期间请求排队不丢
- [ ] 下载：默认镜像源可达、断点续传（中断重开继续）、磁盘不足拦截、可删除
- [ ] 端口占用自动顺延；llama-server 启动失败有明确报错
- [ ] 内存 12GB 机器选 30B 有提示；48GB 机器两档均流畅
- [ ] 设置状态刷新后恢复（现有持久化机制）
- [ ] i18n 中英完整

## 九、后续优化（不在本期范围）

- 本地「创作构思」（creative）链路
- Windows/Linux 平台二进制与模型管理
- 帧数/分辨率的「质量 vs 速度」预设档
- 场景切换检测抽帧（ffmpeg scene detection + 均匀采样混合，精确捕捉快切镜头，比堆 fps 省 token）
- Qwen3-Omni 本地统一音视频模型（待 llama.cpp 音频输入成熟度验证，可能替代 VLM+whisper 双模型链路）
- 本地引擎的量化档位选择（Q8_0 等）
- MLX 后端（Apple Silicon 提速 ~2x）
