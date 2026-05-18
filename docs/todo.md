# TODO

## 已完成：设置迁移 + 多模态开关（2026-05-16）

将分析配置从每次分析弹窗迁移到全局设置弹窗，新增多模态音频分析开关。

**改动文件：**
- `backend/db.py` — 新增 `settings` 表 + `get_setting()` 辅助函数 + 6 个默认设置
- `backend/blueprints/settings.py` — 新增 GET/POST `/api/settings` 路由
- `backend/__init__.py` — 注册 settings 蓝图
- `backend/blueprints/analysis.py` — 从 settings 表读取配置，按 `use_multimodal` 走 3 阶段（多模态）或 4 阶段（独立 ASR）路径
- `backend/analyzer.py` — 新增 `multimodal` 参数，动态替换 prompt 中 ASR 指令
- `frontend/js/api.js` — 新增 `getSettings()`/`saveSettings()`，`startAnalysis()` 不再发送配置
- `frontend/index.html` — 重写设置弹窗（视频分析/模型/音频分析三个区域），设置变更自动保存
- `frontend/js/detail.js` — 分析弹窗改为确认弹窗（显示当前设置摘要+费用提示），分析阶段根据 multimodal 动态生成

**设置项：**
- `resolution`: 压缩分辨率（480/320/240）
- `fps`: 帧率（30/20/10）
- `vendor`: AI 厂商（预留）
- `model`: AI 模型
- `use_multimodal`: 使用视频模型做多模态解析（true=3阶段，false=4阶段+独立ASR）
- `asr_engine`: ASR 引擎选择
- `video_api_key`: 视频分析 API Key（必须设置，不回退环境变量）
- `asr_api_key`: 音频分析 API Key（云端 ASR 时使用，本地可留空）

**设置弹窗改进（2026-05-16）：**
- 重构为"视频分析"和"音频分析"两个分区，带分割线标题
- 视频/音频分析各自提供 API Key 输入框（密码模式+眼睛切换）
- 移除自动保存，改为"确定"按钮手动保存
- API Key 留空时自动回退到系统环境变量

## ASR：本地模型改为云端 API

当前使用 faster-whisper large-v3 本地模型做语音识别，模型常驻内存约 3-6GB。
产品发布后用户设备（尤其是小内存设备）无法承受，需要改为云端 ASR 方案。

待选方案：
- 智谱 GLM-ASR-2512（同一 API key，但限制 30 秒/25MB，需切片）
- 其他云端 ASR 服务

插件架构已就绪（`backend/asr/`），新增云端引擎实现即可切换。

## 已完成：文件夹目录浏览（2026-05-17）

侧边栏新增 Lightroom 风格的文件夹目录树，展示导入媒体的目录结构，支持按文件夹筛选画廊。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `GET /api/library/folders` 端点（从 `file_path` 构建目录树 + 媒体计数）；`list_media` 新增 `folder` 查询参数（`LIKE` 前缀匹配筛选）
- `frontend/js/api.js` — 新增 `getFolders()` 方法
- `frontend/index.html` — 侧边栏"素材库"改为 `q-expansion-item`，内部嵌套 `q-tree` 展示目录树；新增 `folderTree`/`selectedFolder`/`libraryExpanded` 数据和 `onFolderSelect`/`onLibraryToggle` 方法；抽屉宽度从 220px 增至 260px
- `frontend/js/gallery.js` — `load()` 和 `loadMore()` 读取 `$root.selectedFolder` 并作为 `folder` 参数传入 API 请求；`count()` 同步传递 `folder` 参数
- `frontend/css/main.css` — 新增 `q-tree` 相关样式（节点间距、选中高亮 `var(--accent-dim)`、暗色主题适配、文件夹名 ellipsis 截断、树箭头大小、children 缩进）

**无数据库变更** — 文件夹树从现有 `file_path` 列动态生成。

## 已完成：UI 交互优化（2026-05-17）

多项 UI 细节改进，提升交互体验和视觉一致性。

**改动文件：**
- `frontend/js/gallery.js` — 媒体类型筛选从 `q-btn-toggle` 改为 `q-btn-group` 包含独立 `q-btn` 元素（ALL/图片/视频），每个按钮带 `q-tooltip`（1s 延迟）；"ALL" 按钮使用 `label="ALL"` 文本替代图标；收藏/已分析筛选按钮包裹在 `gap:2px` 容器中
- `frontend/index.html` — 设置弹窗分区标题从 `border-bottom` 横线改为左侧强调条（`border-left: 3px solid var(--accent)`）；侧边栏文件夹树集成到素材库 `q-expansion-item` 内（非独立分区）
- `frontend/css/main.css` — 新增 `.q-menu--square { border-radius: 8px !important }` 覆盖 Quasar 方角下拉菜单；`q-btn-group` 样式调整；文件夹标签 ellipsis 截断 + tooltip

## 已完成：键盘快捷键（2026-05-17）

顶部工具栏新增快捷键按钮（键盘图标），点击弹出快捷键参考弹窗。Gallery 和 Detail 页均已实现快捷键。

**改动文件：**
- `frontend/index.html` — 新增快捷键按钮（设置图标左侧）、快捷键弹窗（通用/Gallery/Detail 三组）、全局键盘监听（`created()` 注册、`beforeUnmount()` 清理）、`showShortcuts` 数据、`getAdjacentId()`/`handleShortcut()` 方法
- `frontend/js/gallery.js` — 统一 `handleKey()` 方法替代旧 `onKeyDelete`/`onKeyEnter`，支持方向键（网格感知上下左右）、Delete 删除、Enter 详情、1-5 评分、F 收藏、G 视图切换、`/` 搜索聚焦；新增 `clearSelection()` 方法
- `frontend/js/detail.js` — `handleKey(e)` 方法：跳过 `isContentEditable` 元素避免与编辑冲突、←→ 上一个/下一个、1-5 评分、F 收藏、Space 播放/暂停、Backspace 返回画廊

**快捷键列表：**

| 快捷键 | Gallery | Detail |
|--------|---------|--------|
| `←` `→` `↑` `↓` | 网格内移动选中 | 上一个/下一个素材 |
| `Enter` | 打开详情 | - |
| `Delete` | 删除选中 | - |
| `1`-`5` | 评分 | 评分 |
| `F` | 切换收藏 | 切换收藏 |
| `G` | 切换网格/列表 | - |
| `/` | 搜索聚焦 | - |
| `Space` | - | 播放/暂停 |
| `Backspace` | - | 返回画廊 |

## 已完成：分析结果可编辑（2026-05-17）

详情页分析分段的全部字段支持点击即编辑，失焦自动保存。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `PATCH /api/analysis/<media_id>/segments/<seg_id>` 路由；`_EDITABLE_COLS` 白名单控制可更新字段；`dominant_colors`/`main_subjects` 数组字段 JSON 序列化；更新后调用 `_refresh_fts()` 刷新搜索索引
- `frontend/js/api.js` — 新增 `updateSegment(mediaId, segId, data)` 方法
- `frontend/js/detail.js` — 分段模板全部可编辑：文本字段（visual/asr/subtitle/镜头维度/场景维度）使用 `contenteditable` + `@blur` → `saveSegField()`；标签字段（colors/subjects）`×` 按钮移除 → `removeTag()`；`handleKey()` 跳过 `isContentEditable` 元素
- `frontend/css/main.css` — `.seg-editable` hover/focus 样式；`.seg-editable-tag` 可移除标签样式

**编辑逻辑：**
- `saveSegField(seg, field, value)` — 比较新旧值，无变化跳过；调 API 保存，失败时回滚并 Notify 提示
- `removeTag(seg, field, tag)` — 从数组中移除目标标签，调 API 保存，失败时回滚

## 已完成：重复素材检测 & 查找相似（2026-05-17）

基于文件哈希和感知哈希的两层重复/相似检测，侧边栏"查找重复"入口，全屏对话框展示结果。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `file_hash`（SHA256）和 `phash`（pHash）两列
- `backend/services/importer.py` — 导入时计算文件哈希（`_compute_file_hash`，分块 SHA256）和感知哈希（`_compute_phash`，imagehash 库 phash，视频取中间帧）；INSERT 语句扩展两列
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-hashes`（回填已有素材的哈希）和 `GET /api/library/duplicates?type=exact|similar&threshold=10`（查找重复/相似，exact 按 file_hash 分组，similar 按 phash 汉明距离 ≤ threshold 分组）
- `frontend/js/api.js` — 新增 `getDuplicates()` 和 `backfillHashes()` 方法
- `frontend/index.html` — 侧边栏新增"查找重复"菜单项（`content_copy` 图标）；全屏对话框包含完全重复/视觉相似切换、缩略图组展示、回填哈希按钮；新增 `showDupDialog`/`dupType`/`dupGroups`/`dupLoading` 数据和 `openDupDialog`/`loadDupGroups`/`backfillAndReload` 方法
- `frontend/css/main.css` — `.dup-group`/`.dup-thumb` 样式
- `requirements.txt` — 新增 `imagehash` 依赖

**重复检测逻辑：**
- 完全重复：SHA256 文件哈希完全一致（不同路径同一文件）
- 视觉相似：pHash 汉明距离 ≤ 10（同一照片不同分辨率/压缩版本）
- 相似模式不提供删除按钮，用户在画廊手动选中删除

## 已完成：ResNet50 + HDBSCAN 替代 pHash 相似检测（2026-05-18）

pHash 方案无法准确识别视觉相似照片（不同内容因亮度分布接近被错误匹配），改用 ResNet50 深度学习特征 + HDBSCAN 聚类。仅对图片做向量化，视频不参与相似检测。

**改动文件：**
- `backend/services/embedding.py` — **新建**：ResNet50 ONNX 特征提取模块
  - 加载 ResNet50 ONNX 模型（去掉最后 FC 层，输出 2048 维向量）
  - 支持 RAW（rawpy）、HEIF（pillow-heif）、标准图片格式
  - Singleton ONNX Session（CoreML + CPU 提供者）
  - L2 归一化后存为 SQLite BLOB（8KB/张）
- `backend/db.py` — `_MIGRATIONS` 新增 `embedding BLOB` 列
- `backend/services/importer.py` — 图片导入时调用 `compute_embedding()` 计算 embedding；视频不计算（存 NULL）；INSERT 扩展 `embedding` 列
- `backend/blueprints/library.py` — 相似检测改用 HDBSCAN（`metric="euclidean"`，对 L2 归一化向量等价余弦距离）；backfill 端点补算 embedding；移除 threshold 参数
- `frontend/js/gallery.js` — 视频右键菜单"查找相似"禁用（`:disable` 检测 `media_type === 'video'`）
- `frontend/js/api.js` — `getDuplicates(type)` 去掉 threshold 参数
- `frontend/js/duplicates.js` — 适配新接口（similarity 字段由后端计算）；backfill 按钮文案改为"计算特征向量"；默认展示"相似"
- `requirements.txt` — 新增 `onnxruntime>=1.17.0`、`scikit-learn>=1.3.0`、`hdbscan>=0.8.0`
- `.gitignore` — 新增 `backend/models/`（ONNX 模型文件 ~89.6MB）

**相似检测逻辑：**
- 完全重复：SHA256 文件哈希（不变）
- 视觉相似：ResNet50 提取 2048 维特征 → L2 归一化 → HDBSCAN 自动聚类（无需手动阈值）
- 仅图片参与相似检测，视频排除
- 每组显示平均余弦相似度百分比

**性能数据：**
- 428 张图片 → 55 个聚类 + 91 个噪声点，耗时 0.4 秒
- 同场景 JPG+NEF 配对正确分组
- 模型文件 `backend/models/resnet50.onnx`（89.6MB，首次用 `backend/export_model.py` 从 PyTorch 导出，运行时仅需 onnxruntime）

## 已完成：分析进度优化 + 硬件加速压缩 + ASR 修复（2026-05-18）

分析进度条从 0→100 瞬间跳变改为真实进度反馈，新增硬件加速压缩，修复 ASR 时间戳匹配问题。

**改动文件：**
- `backend/compressor.py` — `compress_video()` 改为 Popen 解析 ffmpeg stderr 的 `time=` 输出推送真实百分比；preset 改为 `ultrafast`；新增 `detect_hw_encoder()` 自动检测硬件编码器（videotoolbox/nvenc/qsv）；硬件加速模式用 `-hwaccel videotoolbox` GPU 解码 + libx264 CPU 编码（4K HEVC 提速 6 倍）；动态码率 `_calc_bitrate()` 按分辨率/帧率等比缩放
- `backend/analyzer.py` — `analyze_video()`/`analyze_image()` 新增 `on_progress` 回调，报告子步骤（`uploading` → `first_token` → `receiving` + 字符数）
- `backend/asr/__init__.py` — `AsrEngine.transcribe()` 接口新增 `on_progress` 参数
- `backend/asr/engines/whisper.py` — 启用 `vad_filter=True` + `word_timestamps=True`，用词级起止时间替代段级时间戳；`on_progress` 回调报告 `loading`/`transcribing` 两阶段
- `backend/blueprints/analysis.py` — 压缩和分析均在线程中运行，generator 轮询推 SSE；SSE 新事件：`compressing` 带真实百分比、`analyzing` 带子步骤（`uploading`/`receiving`）、`analyze_done`（VLM 完成立刻标记）、`asr_start`/`asr_progress`（ASR 独立推进）；`_merge_asr()` 从重叠匹配改为最佳匹配（每段 ASR 只匹配重叠最多的 VLM 分段）
- `backend/blueprints/settings.py` — GET 接口返回 `hw_encoder` 字段
- `backend/db.py` — `_DEFAULTS` 新增 `hw_accel`
- `frontend/index.html` — 设置弹窗视频区域新增"硬件加速压缩"开关（仅检测到硬件编码器时显示）；帧率下方实时显示预估码率；`loadSettings()`/`saveSettings()` 同步新字段
- `frontend/js/detail.js` — SSE 事件处理新增 `percent`（压缩真实进度）和 `substep`（AI 分析子步骤）；`_setStageProgress()`/`_setAnalyzeSubstep()`/`_setAsrSubstep()` 方法；编码阶段完成显示文件大小；分析确认弹窗显示码率；ASR 阶段独立显示加载模型/语音识别子步骤
- `frontend/css/main.css` — `.img-meta-bar` 加 `flex-wrap: wrap` 支持折行；区块标题字号调至 12px，标题与内容间距增加

**分析进度子步骤：**
- 压缩：ffmpeg 真实百分比进度条
- AI 分析：上传至 AI 服务 → 接收结果 (N 字)
- 独立 ASR 模式：VLM 完成立刻标记 → ASR 独立显示"加载语音模型"→"语音识别中"

## 下一阶段优化计划

### 体验提升
- [ ] **批量分析** — 支持选中多个素材一键排队分析

### 功能完善
- [ ] **智能相册** — 按拍摄日期、相机型号、分辨率等自动分组
- [x] ~~**视频播放器集成**~~ — 已实现
- [x] ~~**重复素材检测**~~ — 已实现：文件哈希去重 + ResNet50 + HDBSCAN 相似检测

### 导出与分享
- [ ] **分析报告导出** — 导出 AI 分析结果为 PDF/文本

## 已完成：图片压缩分析 + 详情页布局重构 + 色彩曲线检测（2026-05-17）

在 XMP 写入基础上，新增图片压缩分析流程、详情页布局全面重构、色彩曲线检测。

**改动文件：**
- `backend/compressor.py` — 新增 `compress_image()` 函数，Pillow 缩放 + rawpy 解码 RAW 格式（NEF/DNG/CR2/ARW 等），保存为 JPEG quality=85
- `backend/db.py` — `_DEFAULTS` 新增 `image_resolution`、`image_api_key`、`image_model`；`_MIGRATIONS` 新增 `picture_control` 列
- `backend/blueprints/analysis.py` — `_start_image_analysis()` 从设置读取图片独立配置（API Key 不回退视频 Key），压缩后再分析，SSE 推送压缩进度
- `backend/services/importer.py` — 导入时读取 `PictureControlName`（尼康 N-Log），DJI 文件名 `_D` 后缀推断 D-Log M；INSERT 扩展 `picture_control` 列；exiftool 命令增加 `-PictureControlName`
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-picture-control` 回填历史数据；XMP 写入端点增加分析字段（dominant_colors/main_subjects/scene_type/mood/weather/lighting）作为 dc:Subject 关键字
- `frontend/index.html` — 设置弹窗新增"图片分析"区块（压缩尺寸/模型/API Key），排在视频分析之前
- `frontend/js/detail.js` — 详情页布局重构：元数据从右侧边栏移至媒体上方横排显示；视频信息分两列；图片缩放（滚轮/触控板双指张合）+ 拖拽平移（触控板双指滑动/鼠标拖拽）；缩放条贴在图片底边内侧；XMP 写入按钮使用自定义 SVG 图标；图片分析结果隐藏时间范围/片段数/删除按钮
- `frontend/js/gallery.js` — 卡片新增 XMP 徽章（右下角，自定义 SVG 图标，ungrouped 和 grouped 两种模板均已添加）
- `frontend/css/main.css` — `.img-meta-bar`/`.img-meta-block`/`.img-meta-title` 横排元数据样式；`.img-zoom-bar` 缩放条贴图底；`.xmp-badge` 移至右下角 right:28px（与类型图标并排）
- `frontend/img/` — 新增 3 个自定义 SVG 图标：`xmp-badge.svg`（文件+XMP文字）、`xmp-write.svg`（文件+XMP+左箭头）、`xmp-refresh.svg`（文件+XMP+循环箭头）
- `requirements.txt` — 新增 `rawpy>=0.20.0`

**色彩曲线检测逻辑：**
- 尼康：从 exiftool 的 `PictureControlName` 读取（如 N-Log），准确
- 大疆：从文件名后缀 `_D` 推断 D-Log M，可能不准确
- 前端显示时带叹号图标，悬停提示两种来源的准确性差异

**图片压缩流程：**
```
图片分析请求 → 读取 image_resolution 设置 → compress_image()
  ├── RAW 格式 → rawpy 解码 → Pillow 缩放 → 临时 JPEG
  └── 普通格式 → Pillow 直接缩放 → 临时 JPEG
→ analyze_image() → 清理临时文件
```

## 已完成：XMP 侧车文件写入（2026-05-17）

将评分、标签、AI 分析摘要写入 XMP 侧车文件（仅照片），供 Lightroom、Bridge 等专业软件识别。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `has_xmp` 列（INTEGER DEFAULT 0）
- `backend/services/xmp_writer.py` — **新文件** — XMP 侧车文件写入模块，使用 exiftool CLI
  - `write_xmp()` — 写入评分（`xmp:Rating`）、标签（`dc:Subject`）、描述（`dc:Description`）、颜色标签（`xmp:Label`）
  - 已有 XMP 文件：exiftool 直接修改，保留其他字段
  - 无 XMP 文件：先从源图提取创建，再写入字段
- `backend/blueprints/library.py` — 新增 `POST /api/library/<id>/write-xmp`（单张写入）和 `POST /api/library/batch-write-xmp`（批量写入，仅处理照片）
- `frontend/js/api.js` — 新增 `writeXmp()` 和 `batchWriteXmp()` 方法
- `frontend/js/detail.js` — 工具栏新增"写入 XMP"按钮（仅图片显示，图标 `description`），写入后按钮变蓝；元数据侧边栏显示 XMP 标记
- `frontend/js/gallery.js` — 卡片新增 XMP 徽章（缩略图左下角）；右键菜单新增"写入 XMP"选项；批量选中后可批量写入
- `frontend/css/main.css` — `.xmp-badge` 样式（半透明黑色背景，位于 AI 徽章右侧）

**XMP 字段映射：**
| 数据库字段 | XMP 字段 | 说明 |
|-----------|---------|------|
| `rating` | `xmp:Rating` | 1-5 评分 |
| tags (media_tags) | `dc:Subject` | 标签列表 |
| segment.visual | `dc:Description` | AI 分析摘要（第一段） |
| `color_label` | `xmp:Label` | 颜色标签 |

## 第一轮审计：内存 & 硬盘

### 已解决

- **#1** 孤儿缩略图从未清理 — 已修复：清理了现有 10 个孤儿文件；`_import_one` 重复导入时删除旧缩略图
- **#2** 批量删除媒体时跳过缩略图文件删除 — 已修复：`batch_update` 删除前查询并删除缩略图文件
- **#3** SSE 客户端断连时压缩临时视频残留 — 已修复：`Response.call_on_close()` 注册回调确保断连时清理
- **#4** `temp_video/` 启动时从不清理 — 已修复：`compressor.py` 新增 `cleanup_temp()`，启动时调用
- **#5** WAL 文件从不 checkpoint — 已修复：`init_db` 末尾执行 `PRAGMA wal_checkpoint(TRUNCATE)`
- **#6** 无 VACUUM，数据库只增不减 — 已修复：`init_db` 末尾执行 `VACUUM`
- **#7** `data/uploads/` 空目录无清理机制 — 已删除该目录，当前无代码使用
- **#10** SSE 闭包持有 app 和 compressed_path 引用 — ✓ 已评估，捕获的都是小对象，无需处理
- **#11** SSE 错误处理中 db2 连接可能泄漏 — ✓ 已评估，`get_db()` 返回同一连接，无泄漏，已统一变量名
- **#12** ASR engine 每次调用创建新实例 — ✓ 已修复，改为单例缓存
- **#13** 每个连接重复执行 WAL PRAGMA — ✓ 已修复，WAL 改为 init_db 执行一次

### 遗留项

- **#8** Whisper 模型常驻内存 3-6GB — 等云端 ASR 切换后自然解决
- **#9** 视频分析时整个视频 base64 编码在内存（约为文件 1.33 倍）— 大文件场景需关注

## 第二轮审计：安全 / 并发 / 数据一致性 / 前端

### 高优先级

- **A1** 路径遍历：`serve_thumbnail` 从 DB 读取 `thumbnail_path` 拼接路径，无验证是否在 `THUMB_DIR` 内 — `serve.py:162-168`
- **A2** 任意文件读取：`import-one` 接受任意文件系统路径，可将服务器任意文件导入并暴露 — `library.py:95-105`
- **A3** 并发分析竞态：两个请求同时分析同一视频，会互相覆盖 segments — `analysis.py:45-61`
- **A4** WhisperModel 线程安全：`faster_whisper` 的 CTranslate2 后端在并发调用时可能有隐患 — `asr/engines/whisper.py:9-17`
- **A5** `compress_video` 返回值与类型注解不匹配（注解写 2 元组，实际返回 5 元组）— `compressor.py:27,63`
- **A6** `loadWaveform` 下载整个视频到浏览器内存做波形可视化，大文件会 OOM — `detail.js:625-652`
- **A7** Gallery `load()` 竞态：快速切换筛选时并发请求，最后 resolve 的覆盖结果 — `gallery.js:380-409`
- **A8** 详情页 URL 无 ID 校验：`#/detail/` 或 `#/detail/abc` 导致请求 `/api/library/NaN` — `detail.js:252-254`
- **A9** `startAnalysis` 绕过统一 API 错误处理，直接用原始 `fetch()` — `api.js:66-71`

### 中优先级

- **A10** SSE 断连后 `analysis_status` 卡在 `processing`，无超时恢复机制 — `analysis.py:71-93`
- **A11** `save_segments` DELETE + INSERT 无事务保护，崩溃会丢数据 — `analysis.py:196-233`
- **A12** `resolution`/`fps` 参数无校验，恶意值可导致资源消耗 — `analysis.py:97-100`
- **A13** JSON 解析失败时将原始文本存为 segment，`analysis_status` 仍设为 `done` — `analyzer.py:92-109`
- **A14** `media_segment` 表缺少 `REFERENCES media(id) ON DELETE CASCADE`，依赖手动删除 — `db.py:67-87`
- **A15** FTS5 搜索含特殊字符（`*`、`"`、`OR`）会导致 500 错误 — `library.py:51-56`
- **A16** 转码流式响应无大小/时间限制，超大视频消耗资源 — `serve.py:60-84`
- **A17** `analyze_image` 缺少 try/except，API 调用失败时无上下文信息 — `analyzer.py:124-145`
- **A18** `add_items`/`assign_tags` 不验证关联记录是否存在，外键违反导致 500 — `collections.py:38-47`、`tags.py:41-62`
- **A19** `cleanup_temp` 使用相对路径 `Path("temp_video")`，工作目录变化会失效 — `compressor.py:12-21`
- **A20** Gallery 加载失败时显示空状态，无错误提示 — `gallery.js:406-408`
- **A21** Collection 视图忽略排序/筛选控件 — `gallery.js:388-403`
- **A22** SSE 流未检查 `resp.body` 是否存在，可能 TypeError — `detail.js:513-516`
- **A23** Scope 渲染累积不清除，逐渐全白 — `detail.js:828-838`
- **A24** 选中检测用 `Array.includes` O(n)，应改 `Set` — `gallery.js:64-65`

### 低优先级

- **A25** `update_media`/`delete_media`/`batch_update` 不检查记录是否存在，返回假成功
- **A26** `_merge_asr` 静默吞掉时间戳解析错误，无日志
- **A27** `_parse_time` 不处理 `HH:MM:SS` 三段格式
- **A28** `_refresh_fts` 每次调用执行 `from .library import _segment`，存在循环依赖风险
- **A29** `import_single_file` 不区分"已存在"和"导入失败"，统一返回 null
- **A30** `import_one` 失败时返回 HTTP 200 + `{"data": null}`，应为 4xx
- **A31** VACUUM 每次启动执行，大库会拖慢启动
- **A32** Schema 和 migration 对 `camera_make`/`lens_model` 列定义不一致
- **A33** FTS5 搜索含特殊字符需转义，`_segment_query` 未处理
- **A34** 多处 API 调用无 try/catch，失败时无用户反馈（`setRating`、`setColor`、`toggleFav` 等）
- **A35** 批量删除中途失败，部分已删部分未删，无回滚
- **A36** 右键菜单位置不检查视口边界，可能溢出屏幕 — `gallery.js:217-229`
- **A37** 缩略图 fallback `@error` 无限循环风险 — `gallery.js:73,105`
