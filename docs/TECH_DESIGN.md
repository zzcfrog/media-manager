# TECH_DESIGN — 视频分析器

## 1. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.12, Flask 3.x |
| 前端 | Vue 3 (Options API), Quasar Framework (UMD) |
| 数据库 | SQLite 3 + FTS5 全文搜索 |
| 桌面端 | Electron 35.x |
| AI/VLM | 智谱 AI GLM-4.6V（OpenAI 兼容 SDK） |
| ASR | faster-whisper large-v3（本地），插件架构支持扩展 |
| 媒体处理 | ffmpeg/ffprobe, exiftool |
| RAW 解码 | rawpy + Pillow |
| HEIC 解码 | pillow-heif |
| 中文分词 | jieba（FTS5 索引） |
| 哈希去重 | 已移除 SHA256 级精确重复检测，仅保留视觉相似检测 |
| 日志 | loguru（文件输出 + 按天轮转 7 天保留） |
| 相似检测 | ResNet50 ONNX + HDBSCAN（图片视觉相似） |
| 端口 | 6622 |

## 2. 项目结构

```
video_analyzer/
├── run.py                     # 入口：创建 Flask app，加载 .env
├── requirements.txt
├── .env                       # ZHIPUAI_API_KEY
├── backend/
│   ├── __init__.py            # create_app() 工厂函数
│   ├── config.py              # 路径、文件扩展名、分析并发配置
│   ├── logger.py              # loguru 日志配置（文件输出 + 按天轮转）
│   ├── db.py                  # SQLite schema、迁移、连接管理
│   ├── analyzer.py            # VLM API 调用（视频/图片分析）
│   ├── compressor.py          # ffmpeg 视频压缩（真实进度 + 硬件加速） + temp 清理
│   ├── video_prompt.txt       # 视频分析提示词
│   ├── img_prompt.txt         # 图片分析提示词
│   ├── asr/
│   │   ├── __init__.py        # ASR 插件接口、注册表
│   │   └── engines/
│   │       ├── __init__.py
│   │       └── whisper.py     # faster-whisper 引擎
│   ├── blueprints/
│   │   ├── serve.py           # 媒体文件服务（视频/图片/缩略图）
│   │   ├── library.py         # 媒体库 CRUD、搜索、导入
│   │   ├── analysis.py        # AI 分析（SSE 流式）
│   │   ├── tags.py            # 标签管理
│   │   └── settings.py        # 全局设置 CRUD
│   └── services/
│       ├── importer.py        # 文件扫描、元数据提取、缩略图生成
│       ├── embedding.py       # ResNet50 ONNX 特征提取（图片相似检测）
│       └── xmp_writer.py     # XMP 侧车文件写入（仅照片）
├── frontend/
│   ├── index.html             # SPA 主页面（Vue app + 路由 + 弹窗）
│   ├── css/main.css           # 暗色/亮色主题
│   └── js/
│       ├── api.js             # API 客户端
│       ├── i18n.js            # 轻量 i18n（t() 翻译 + Vue.reactive 状态）
│       ├── gallery.js         # Gallery 页组件
│       ├── detail.js          # Detail 页组件
│       ├── workbench.js       # 创作工作台页组件
│       ├── folder-tree.js     # FolderTree 可复用组件（q-tree 封装）
│       ├── format.js          # 共享格式化函数（fmtSize/fmtDur）
│       └── duplicates.js      # 查找重复页组件
├── electron/
│   ├── main.js                # Electron 主进程（启动 Python 后端）
│   ├── preload.js             # 文件选择、Finder 集成 API
│   └── package.json
├── data/
│   ├── media.db               # SQLite 数据库
│   └── thumbnails/            # 生成的缩略图
├── temp_video/                # 压缩临时视频（启动时清理）
└── docs/
    ├── UE_DESIGN.md
    ├── PRD.md
    ├── TECH_DESIGN.md
    └── todo.md
```

## 3. 后端架构

### 3.1 应用启动

`run.py` → `create_app()` → loguru 日志初始化 → 初始化目录 → 清理 temp_video → 初始化数据库（schema + 迁移 + checkpoint + VACUUM）→ 注册蓝图 → 预加载本地 ASR 模型（仅本地引擎）。

### 3.2 蓝图路由

| 蓝图 | 前缀 | 职责 |
|------|------|------|
| `serve` | 无 | 媒体文件服务 |
| `library` | `/api/library` | 媒体库 CRUD、文件夹树、导入、相似检测、排除管理 |
| `analysis` | `/api/analysis` | AI 分析 + 批量分析 + 分段编辑 + 进度查询 |
| `tags` | `/api/tags` | 标签管理（后端保留，前端已移除） |
| `settings` | `/api/settings` | 全局设置 CRUD |
| `workbench` | `/api/workbench` | 创作工作台：工程 CRUD、segment 查询、多轨时间线管理 |

### 3.3 数据库

**连接管理**：`get_db()` 通过 Flask `g` 对象管理，每请求一个连接，teardown 时关闭。`PRAGMA foreign_keys=ON` 在每个连接设置。`PRAGMA journal_mode=WAL` 在 `init_db` 设置一次（持久化）。`get_setting(db, key, default)` 辅助函数从 `settings` 表读取单个配置值。API Key 仅从 `settings` 表读取（`video_api_key`、`asr_api_key`），未设置时返回 400 错误提示。

**启动维护**：`PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`。

#### Schema

```sql
-- 核心表
media (id, file_path UNIQUE, file_name, media_type, file_size, duration,
       width, height, fps, video_codec, video_profile, bit_rate,
       audio_codec, audio_sample_rate, audio_channels,
       color_space, color_range, pix_fmt,
       camera_make, camera_model, lens_model, picture_control,
       date_taken, thumbnail_path,
       file_hash TEXT, phash TEXT, embedding BLOB, has_xmp,
       analysis_status, analysis_model, analysis_date,
       rating, color_label, favorite, notes,
       imported_at, updated_at)

-- 分段分析结果
media_segment (id, media_id, time_start, time_end,
               visual, asr, subtitle, dominant_colors, main_subjects,
               shot_type, focal_length, camera_angle, camera_movement,
               perspective, scene_type, mood, lighting, weather,
               style, color_tone, tone, dof, composition, seq)

-- 标签
tags (id, name UNIQUE)
media_tags (media_id FK CASCADE, tag_id FK CASCADE, PK)

-- 全文搜索
media_fts (FTS5: media_id UNINDEXED, file_name, visual, asr, subtitle,
           subjects, colors, tags, tokenize=unicode61)

-- 全局设置
settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
-- 默认值: resolution, fps, vendor, model, use_multimodal, asr_engine, video_api_key, asr_api_key, image_resolution, image_api_key, image_model, hw_accel, language

-- 排除对（重复/相似检测排除）
dup_exclusions (media_id_a INTEGER, media_id_b INTEGER, dup_type TEXT, PRIMARY KEY(media_id_a, media_id_b, dup_type))

-- 创作工作台
projects (id PK, name TEXT, description TEXT, created_at TEXT, updated_at TEXT)
project_media (project_id FK, media_id FK, PK(project_id, media_id))
project_tracks (id PK, project_id FK, version INT, position INT, track_type TEXT CHECK(...), segment_id FK nullable, content TEXT, time_start TEXT, time_end TEXT, emotion_value REAL, metadata TEXT)
```

**迁移系统**：`_MIGRATIONS` 列表 + `_migrate()` 函数，通过 `PRAGMA table_info` 检测 `media` 和 `media_segment` 两张表的缺失列并 ALTER TABLE。特殊情况（如 dialogue→asr 重命名 + FTS 重建）在 `_migrate()` 中硬编码处理。

### 3.4 文件夹树 API

从 `media` 表的 `file_path` 列动态构建目录树，无需额外数据库表。

**端点**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/library/folders` | GET | 返回目录树结构 |
| `/api/library/?folder=<path>` | GET | 按文件夹前缀筛选媒体列表 |
| `/api/library/folder` | DELETE | 移除整个目录（按路径前缀删除所有媒体记录及缩略图文件） |
| `/api/library/sync-folder` | POST | 重新扫描目录（SSE 流：导入新文件、删除已移走文件、报告变更） |

**`/api/library/folders` 实现逻辑**：

1. 查询所有 `media.file_path`，取 `os.path.dirname()` 得到叶子目录及其直接媒体计数
2. 补全中间目录（拆分路径，生成分隔符层级 `/part1/part2/...`）
3. 从深到浅累加子目录计数到父目录，得到每个节点的 `totalCount`（含所有后代媒体）
4. 构建嵌套树结构，返回根节点数组

返回格式：
```json
{
  "data": [
    {
      "label": "Photos",
      "path": "/Users/.../Photos",
      "totalCount": 120,
      "children": [
        { "label": "2025", "path": "...", "totalCount": 80, "children": [] }
      ]
    }
  ]
}
```

**`folder` 筛选参数**：在 `list_media` 中通过 `file_path LIKE '<folder>/%'` 实现，匹配目标文件夹及其所有子文件夹下的媒体。

### 3.5 相似检测与排除 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/library/duplicates?type=<type>` | GET | 查找重复/相似分组（near/similar/cluster），返回 `groups` + 每组 `excluded` 排除信息 |
| `/api/library/<id>/similar` | GET | 查找与指定图片相似的其他图片（near/similar/cluster），用于画廊单图查找相似弹窗 |
| `/api/library/dup-exclusions` | POST | 添加排除对（`pairs: [[a,b], ...]`, `dup_type`） |
| `/api/library/dup-exclusions` | DELETE | 按 `dup_type` 全量删除排除记录 |
| `/api/library/dup-exclusions/pairs` | DELETE | 按具体 pair 删除排除记录（恢复排除功能使用） |

**排除表 `dup_exclusions`**：`(media_id_a INTEGER, media_id_b INTEGER, dup_type TEXT, PRIMARY KEY(a, b, dup_type))`，其中 `a < b` 保证唯一。

**`_attach_excluded()` 辅助函数**：在 `find_duplicates` 返回前，遍历每个 group 的成员，查找排除表中涉及该成员的 pair，将不在 group 内的被排除方信息（id/file_name/excluded_with）附加到 group。

**`GET /<id>/similar` 实现**：获取源图片 embedding → 与所有图片计算余弦相似度 → 按阈值（near 0.96 / similar 0.90）筛选 → 排除已排除的 pair → HDBSCAN 聚类取源图片所在聚类 → 返回 `{ source, near, similar, cluster }`。

### 3.6 分段编辑 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/analysis/<media_id>/segments/<seg_id>` | PATCH | 更新单个分段的部分字段 |

**`_EDITABLE_COLS` 白名单**：`visual`, `asr`, `subtitle`, `shot_type`, `focal_length`, `camera_angle`, `camera_movement`, `perspective`, `scene_type`, `mood`, `lighting`, `weather`, `style`, `color_tone`, `tone`, `dof`, `composition`, `dominant_colors`, `main_subjects`

**逻辑**：
1. 验证 `seg_id` 和 `media_id` 匹配
2. 遍历请求 body 中的字段，仅在 `_EDITABLE_COLS` 白名单内的才更新
3. `dominant_colors` / `main_subjects` 接收数组，JSON 序列化后存储
4. 动态构建 `UPDATE ... SET field1=?, field2=? ... WHERE id=?`
5. 更新后重新查询所有分段，调用 `_refresh_fts(db, media_id, segments)` 刷新搜索索引
6. 返回 `{ ok: true }`

**前端保存流程**：
- `saveSegField(seg, field, value)` — 比较新旧值，无变化跳过；乐观更新本地数据 → 调 API → 失败回滚 + Notify 错误
- `removeTag(seg, field, tag)` — 从数组中 filter 移除目标标签 → 调 API → 失败回滚 + Notify 错误

## 4. 核心流程

### 4.1 导入流程

```
用户选择路径
    ↓
_collect_files() — 递归扫描匹配文件，跳过 ._ 前缀
    ↓
scan_only() — 返回文件列表 + 已存在列表
    ↓
import_single_file() × 5 并发（ThreadPoolExecutor）
    ├── _import_one() — 检查重复（已存在则跳过，不删旧缩略图）
    ├── _probe() / _probe_image() — ffprobe + exiftool 元数据
    │   ├── 视频额外检测：DJI 文件名 _D 后缀推断 D-Log M
    │   └── 图片额外检测：XMP 侧车文件是否存在
    ├── compute_embedding() — ResNet50 ONNX 特征向量（仅图片，2048 维 L2 归一化）
    ├── _generate_thumbnail() — ffmpeg 截帧 / exiftool 提取（RAW 内嵌缩略图），UUID 随机文件名
    └── INSERT media + media_fts
```

**批量导入端点**：`POST /api/library/import-batch`（SSE 流，前端单次请求，后端 5 线程并发处理，实时推送 ok/fail/skip 事件）
    ├── _import_one() — 检查重复（已存在则跳过，不删旧缩略图）
    ├── _probe() / _probe_image() — ffprobe + exiftool 元数据
    │   ├── 视频额外检测：DJI 文件名 _D 后缀推断 D-Log M
    │   └── 图片额外检测：XMP 侧车文件是否存在
    ├── compute_embedding() — ResNet50 ONNX 特征向量（仅图片，2048 维 L2 归一化）
    ├── _generate_thumbnail() — ffmpeg 截帧 / exiftool 提取（RAW 内嵌缩略图），UUID 随机文件名
    └── INSERT media + media_fts
```

### 4.2 视频分析流程

分析参数从 `settings` 表读取（非请求 body），通过 `get_setting(db, key)` 获取。

**并发控制**：全局 `ThreadPoolExecutor(max_workers=ANALYSIS_THREAD_POOL_SIZE)` + `Semaphore(ANALYSIS_API_CONCURRENCY)` 信号量，参数定义在 `config.py`。信号量仅在 VLM API 调用阶段获取（串行），压缩/ASR 阶段不持有信号量（可并行）。processing 状态的素材自动跳过，防止重复提交。

**单条分析**：`POST /api/analysis/<id>` 返回 SSE 流，前端通过 SSE 跟踪进度。

**批量分析**：`POST /api/analysis/batch` 接收 `{ ids: [...], skip_done: bool }`，返回 JSON `{ submitted: [...], skipped: N }`。不使用 SSE，前端通过全局轮询 `_bgPollTimer` 跟踪进度。

**进度恢复**：`GET /api/analysis/progress` 返回所有活跃任务（含 `id`, `step`, `media_type`, `file_name`），前端页面刷新时调用恢复 `bgTasks`。

**多模态模式**（`use_multimodal=true`，默认）：VLM 同时处理视觉和语音，3 阶段。

```
POST /api/analysis/<id>
    ↓
读取 settings（model, resolution, fps, use_multimodal, hw_accel）
    ↓
compress_video() — ffmpeg 压缩到 temp_video/（线程运行，SSE 推送真实百分比）
    │   硬件加速开启时：-hwaccel videotoolbox（GPU 解码）+ libx264（CPU 编码）
    ↓
analyze_video(multimodal=True, on_progress) — 线程运行，SSE 推送子步骤
    │   子步骤：uploading → receiving (N 字符)
    ↓
save_segments() → _fix_segment_overlaps()（修正重叠时间戳）→ _refresh_fts() → call_on_close()
```

**独立 ASR 模式**（`use_multimodal=false`）：VLM + ASR 并行，VLM 完成立刻标记，ASR 独立推进。

```
POST /api/analysis/<id>
    ↓
读取 settings（model, resolution, fps, use_multimodal, asr_engine, hw_accel）
    ↓
compress_video() — ffmpeg 压缩（线程运行，SSE 推送真实百分比）
    ↓
┌─────────────────────────┬──────────────────────────────┐
│  analyze_video()        │  _run_asr()                   │
│  (base64 → VLM API)    │  (faster-whisper, VAD+词级)   │  ← ThreadPoolExecutor 并行
└─────────────────────────┴──────────────────────────────┘
    ↓ VLM 完成 → SSE analyze_done（立即标记）
    ↓ ASR 完成 → SSE asr_progress（加载模型 → 语音识别）
    ↓
_merge_asr() — 最佳匹配：每段 ASR 只匹配重叠时间最长的 VLM 分段
    ↓
save_segments() → _fix_segment_overlaps()（修正重叠时间戳）→ _refresh_fts() → call_on_close()
```

进度通过 **SSE（Server-Sent Events）** 实时推送到前端：
- `progress` 事件包含 `step`（compressing/compressed/analyzing/analyze_done/asr_start/asr_progress）和可选的 `percent`/`substep`/`chars`/`size_bytes` 字段
- `done`（完成）、`error`（失败）

### 4.3 ASR 插件架构

```python
class AsrEngine(ABC):
    name: str
    def transcribe(self, audio_path) -> list[AsrSegment]

@dataclass
class AsrSegment:
    time_start: str   # "MM:SS.ss"
    time_end: str
    text: str
```

- `register_engine(cls)` — 装饰器，注册到 `_ENGINES` 字典
- `get_engine(name)` — 返回单例实例（`_INSTANCES` 缓存）
- `_auto_register()` — 启动时 import `engines/whisper.py` 触发注册

当前实现：`WhisperEngine`（faster-whisper large-v3, device=auto, 语言自动检测, vad_filter=True, word_timestamps=True）。
- `vad_filter=True`：Silero VAD 过滤静默段，提升时间戳精度
- `word_timestamps=True`：词级时间戳，用首词起始/末词结束替代段级时间
- `on_progress` 回调报告 `loading`（模型加载）/ `transcribing`（语音识别）

扩展方式：在 `engines/` 下新建文件，实现 `AsrEngine`，用 `@register_engine` 注册即可。

## 5. 前端架构

### 5.1 整体结构

- Vue 3 Options API（非 Composition API）
- Hash 路由（`location.hash` + `hashchange` 事件）
- 无构建步骤，直接使用 Quasar UMD 构建
- Gallery 组件 `<keep-alive>` 缓存，Detail 组件每次重建

### 5.2 关键实现

| 功能 | 技术 |
|------|------|
| 无限滚动 | IntersectionObserver，200px rootMargin；小缩放时 `_checkFill()` 自动加载更多（`requestAnimationFrame` 后检测 `scrollHeight <= clientHeight + 200`） |
| 渲染优化 | `.media-card { content-visibility: auto }` 跳过屏幕外卡片渲染 |
| 分析进度 | SSE → ReadableStream + TextDecoder → 逐行解析 JSON；批量分析通过轮询 `getProgress()` 跟踪 |
| 筛选持久化 | localStorage 保存/恢复所有筛选、排序、视图、文件夹状态 |
| 任务恢复 | 页面刷新时调 `getProgress()` 从后端恢复运行中的 bgTasks |
| 框选 | mousedown/mousemove/mouseup + `elementFromPoint` 命中测试 |
| 音频波形 | Web Audio API 解码 → Canvas 绘制峰值 |
| 视频示波器 | Canvas，0.2x 离屏缩放，~15fps requestAnimationFrame |
| 直方图 | 离屏 Canvas 采样 → RGB 三通道曲线 |
| 动画 | Lottie（`lottie.min.js`） |
| 文件夹树 | `FolderTree` 可复用组件（`folder-tree.js`），封装 Quasar `q-tree`（`no-connectors` + `dense`）。VS Code 风格竖线缩进（`border-left` on `q-tree__children`）。侧边栏和 picker 各持有独立 `expanded` 状态 |
| 主题色统一 | 所有 UI 控件通过 CSS 变量 `--accent` / `--accent-dim` 跟随主题色。Quasar 组件通过 `style="--q-primary:var(--accent)"` 元素级覆盖。侧边栏选中使用 `.sidebar-active-item` 类 |
| 50% 缩放紧凑模式 | `gridScale <= 0.5` 时添加 `.grid-compact` class，隐藏 `.media-card .info` |
| 媒体类型筛选 | `q-btn-group` 包含独立 `q-btn`（带 `q-tooltip`），替代 `q-btn-toggle` |
| 分段编辑 | `contenteditable` + `@blur` → `saveSegField()`（文本字段）；`×` 按钮 → `removeTag()`（标签字段） |
| 键盘快捷键 | `document.addEventListener("keydown")` 全局监听，`created()` 注册 / `beforeUnmount()` 清理；`isContentEditable` 检测避免编辑冲突 |
| 全屏看图 | 浏览器 Fullscreen API（`imgContainer.requestFullscreen()`），`fullscreenchange` 事件追踪状态；F 键切换，仅图片类型生效 |
| 导航缩略图 | `computed: minimapRectStyle` 根据 imgZoom/imgPanX/imgPanY 和容器尺寸计算视口矩形（通过 `fitScale` 转换图片坐标到 minimap 坐标），`onMinimapClick` 反向映射点击位置到 pan 偏移 |
| 重复页布局 | CSS Grid `repeat(auto-fill, minmax(160px, 1fr))` 替代横向滚动 |
| 恢复排除 | 按被排除照片分行展示，每行左侧缩略图 + 中间排除对象小图标（可勾选）+ 右侧独立恢复按钮；`removeDupExclusionPairs` API 按 pair 删除 |

### 5.3 文件夹筛选数据流

```
App.mounted()
  └── loadSidebar() → API.getFolders() → this.folderTree  (侧边栏素材库树渲染)

用户点击"素材库"文字区域
  └── navToLibrary() → 清除筛选，导航到 #/gallery

用户点击展开箭头
  └── this.libraryExpanded = !this.libraryExpanded  (v-show 控制目录树显隐)

用户点击树节点
  └── onFolderSelect(path)
      └── this.selectedFolder = path  (toggle: 再次点击设 null)

路由切换 → 详情页
  └── resolveRoute()
      └── setFolder(filePath)
          ├── this.libraryExpanded = true
          ├── 计算祖先路径 → 加入 expandedFolders
          └── this.selectedFolder = dir

Gallery.load() / Gallery.loadMore()
  └── 读取 this.$root.selectedFolder
      └── 作为 folder 参数传入 API.getLibrary({ folder })
          └── 后端 WHERE file_path LIKE '<folder>/%'
```

`selectedFolder` 同时控制侧边栏"素材库"入口的高亮状态（`selectedFolder` 非空时不高亮），确保文件夹筛选和导航入口互斥。素材库菜单右侧独立箭头控制 `libraryExpanded`（`v-show` 控制目录树显隐），`expandedFolders` 数组通过 `:expanded` 属性响应式控制节点展开状态。

### 5.4 国际化（i18n）

**模块**：`frontend/js/i18n.js`

**核心 API**：
- `t(key, params)` — 翻译函数，支持插值参数（`{name}` 格式）
- `locale` — `Vue.reactive` 响应式对象，`locale.value` 为当前语言代码（`'zh'` / `'en'`）
- `setLocale(lang)` — 切换语言并保存到后端 settings

**翻译键组织**：按前缀分组，每个前缀对应一个 UI 区域：

| 前缀 | 覆盖范围 |
|------|---------|
| `g.*` | 通用（确认、取消、保存、删除等）、后台任务状态、API 错误 |
| `d.*` | 详情页（元数据标签、分析维度、按钮） |
| `dup.*` | 重复页（标签页标题、操作按钮） |
| `s.*` | 设置页（标签页标题、字段标签） |
| `side.*` | 侧边栏（菜单项） |
| `imp.*` | 导入弹窗（步骤、状态、结果） |
| `kb.*` | 快捷键参考弹窗 |
| `ctx.*` | 右键上下文菜单 |
| `wb.*` | 工作台（素材面板、轨道工具栏、播放器、错误通知） |
| `cg.*` | 创意引导器（模板、结构、弧线、声音、进度、统计） |

**回退链**：`translations[currentLocale][key]` → `translations['zh'][key]` → `key` 本身（开发时可见未翻译的键）。

**响应式集成**：
- Vue Options API 组件中通过 `computed` 属性访问翻译（如 `computed: { ratingLabel() { return t('d.rating') } }`），语言切换时自动更新
- 下拉选项标签使用 computed 数组（如设置页的分辨率/帧率选项），切换语言后选项文本即时刷新

**后端集成**：
- `language` 设置存储在 `settings` 表（`db.py` 的 `_DEFAULTS`，默认 `'zh'`）
- 前端 `mounted()` 时通过 `GET /api/settings` 获取语言设置，初始化 `locale.value`
- `setLocale()` 调用 `POST /api/settings` 持久化语言偏好

### 5.5 工作台媒体选择器架构

**对话框方案**：工作台的"添加素材"功能通过 `q-dialog`（persistent，fade 过渡）打开 90% 屏幕尺寸（90vw x 90vh）的对话框，内嵌完整的 `gallery-page` 组件复用所有筛选/排序/视图功能。

**独立文件夹处理器**：

选择器内的文件夹树使用独立的 `pickerFolderSelect(path)` 方法（替代主页面的 `onFolderSelect`），仅更新 `selectedFolder` 状态并触发表面画廊的 `load()` 重载。避免了共享 `onFolderSelect` 导致的两个问题：
1. hash 变更（`onFolderSelect` 内含路由导航逻辑，会意外改变 URL hash）
2. 无限请求（hash 变更触发 `hashchange` → 路由解析 → 画廊重建 → 反复请求）

**数据流**：

```
WorkbenchPage.openMediaPicker()
  ├── 设置 pickerProjectId / pickerSelected（预填已有素材 ID）
  └── pickerMode = true  →  q-dialog 打开

pickerGallery (gallery-page 组件, v-if="pickerMode")
  ├── 读取 $root.selectedFolder 作为 folder 参数
  ├── 读取所有筛选/排序状态（共享 root 数据）
  └── 卡片叠加 picker-check 复选框 → toggle 进 pickerSelected 数组

pickerFolderSelect(path)
  └── selectedFolder toggle + $nextTick(pickerGallery.load())  // 不触发 hash 变更

confirmPicker()
  └── API.updateProjectMedia(pickerProjectId, pickerSelected)
      └── 成功后关闭对话框 + 刷新工作台数据
```

**组件结构**：
- `picker-dialog-card`：CSS 90vw x 90vh，flex column 布局
- `picker-bar`（42px）：关闭按钮 + 标题 + 已选计数 + 确认按钮
- `picker-body`：flex row，左侧 `picker-sidebar`（220px `FolderTree` 组件）+ 右侧 `picker-gallery`（嵌入 gallery-page）

### 5.6 FolderTree 可复用组件

提取为独立组件 `frontend/js/folder-tree.js`，侧边栏和 picker 各持有独立 `expanded` 状态。

**Props**：`nodes`（树数据）、`selected`（选中路径）、`contextMenu`（是否启用右键菜单）、`countField`（计数字段名）。

**Emits**：`select`（节点点击）、`contextmenu`（右键事件）。

**样式特点**：
- `no-connectors` + `dense`：无默认连接线
- VS Code 风格竖线缩进：`q-tree__children { border-left: 1px solid var(--border) }`
- 叶节点箭头占位：`q-tree__node--child > .q-tree__node-header { padding-left: 22px }`
- 选中/悬浮高亮统一：CSS `q-tree__node-header` 全宽高亮

### 5.7 工作台素材面板架构

**数据模型**：素材面板以 `project.media`（完整视频列表）为单位，`segments` 仍加载供预览区和时间线使用。

**搜索**：后端 FTS5 搜索（`GET /api/workbench/:id?q=xxx`），复用 `library._segment_query()` 做 jieba 分词 + FTS MATCH。

**筛选/排序**：前端 computed `filteredMedia()` 应用类型筛选（`matType`）和排序（`matSort`：name/duration/date_taken）。

**辅助方法**：
- `mediaSegments(mediaId)` — 从 `this.segments` 中筛选指定 media 的 segments
- `fmtDur(sec)` — 秒数转 M:SS 或 H:MM:SS 格式
- `searchMedia()` — 调用 `API.getProject(id, q)` 更新 `project.media`

### 5.8 时间线工具栏架构

**播放控制**：`trackTogglePlay`/`trackSkipStart`/`trackSkipEnd` 联动预览区 `$refs.wbPlayer`，`trackSpeed` watch 同步 `playbackRate`。

**缩放**：`trackZoom`（1-10x）通过内联 `transform: scaleX()` + `minWidth` 百分比缩放 `.wb-track-content` 内容区域，超出时横向滚动。

**编辑操作**：
- **撤销/重做**：JSON 快照栈（`_undoStack` / `_redoStack`），每次编辑前调用 `_trackSnapshot()` 保存当前状态
- **分割**：`trackSplit()` 将选中轨道项按时间中点一分为二，插入两个新项替换原项
- **删除**：`trackDelete()` 从 `this.tracks` 移除选中项
- 所有编辑操作调用 `_trackSave()` 持久化，内部通过 `API.updateProjectTracks(id, tracks)` 发送 PUT 请求

**选中状态**：`trackSelectedItem` 记录选中轨道项 id，点击轨道项设置，编辑/删除后重置为 null。

## 6. 外部依赖

| 工具 | 用途 |
|------|------|
| ffmpeg/ffprobe | 视频压缩、截帧缩略图、实时转码、元数据提取 |
| exiftool | 相机/镜头元数据、拍摄日期、RAW 内嵌缩略图提取、XMP 侧车文件写入 |
| faster-whisper | 本地 ASR（large-v3 模型，CTranslate2 后端） |

### Python 包

openai>=1.0.0       # 智谱 AI VLM API（OpenAI 兼容端点）
loguru>=0.7.0       # 统一日志（文件输出 + 按天轮转）
python-dotenv>=1.0.0
flask>=3.0
Pillow>=10.0        # 图片处理 + 压缩
faster-whisper>=1.0.0  # 本地 ASR
rawpy>=0.20.0       # RAW 格式解码（NEF/DNG/CR2/ARW 等）
onnxruntime>=1.17.0 # ResNet50 ONNX 推理（图片特征提取）
scikit-learn>=1.3.0 # PCA 降维（可选）
hdbscan>=0.8.0      # HDBSCAN 聚类（图片相似检测）
```

运行时额外依赖（非 requirements.txt）：`jieba`、`rawpy`、`pillow-heif`。

## 7. 媒体文件服务

| 路由 | 策略 |
|------|------|
| `/media/video/<id>` | 原生格式（mp4/m4v/webm/mov）直接发送（支持 Range）；其他格式实时 ffmpeg 转码为 H.264 |
| `/media/image/<id>` | JPG/PNG 等直接发送；RAW 用 rawpy 解码为 JPEG；HEIC/AVIF 用 pillow-heif 解码 |
| `/media/thumbnail/<id>` | 从 DB 查 thumbnail_path，与 THUMB_DIR 拼接后发送；文件不存在时自动重新生成 |

## 8. 图片相似检测

### 8.1 特征提取

使用 ResNet50 ONNX 模型（去掉最后 FC 层）提取 2048 维特征向量。

- **模型**：`backend/models/resnet50.onnx`（~89.6MB，gitignored）
- **导出**：`backend/export_model.py`（一次性脚本，需临时安装 torch + torchvision）
- **运行时**：onnxruntime（CoreML + CPU 提供者），无需 PyTorch
- **预处理**：Resize(256) → CenterCrop(224) → ToTensor → ImageNet Normalize
- **输出**：2048 维向量 → L2 归一化 → float32 BLOB（8KB/张）
- **支持格式**：标准图片（PIL）、RAW（rawpy）、HEIF（pillow-heif）
- **仅图片**：视频不计算 embedding（存 NULL）

### 8.2 相似聚类

使用 HDBSCAN 密度聚类算法自动发现相似图片组，无需手动阈值。

```
查询所有 embedding 非 NULL 的图片
  ↓
构建 N×2048 向量矩阵
  ↓
HDBSCAN(min_cluster_size=2, metric="euclidean")
  ↓
按聚类标签分组，计算组内平均余弦相似度
  ↓
按组大小降序、相似度降序排列
```

- `metric="euclidean"`：对 L2 归一化向量等价于余弦距离
- `min_cluster_size=2`：最少 2 张图片成组
- 噪声点（label=-1）不输出
- 性能：428 张图片 → 55 聚类，耗时 0.4 秒

## 9. AI 创意引导器技术架构

详见 [PRD_AI_CREATIVE.md](PRD_AI_CREATIVE.md)。

### 9.1 新增后端模块

```
backend/
├── creative/
│   ├── __init__.py          # 模块入口，注册蓝图
│   ├── guide.py             # 创意引导器核心：组装输入、调用 LLM、解析输出
│   ├── assembler.py         # 时间线组装器：AI 方案 → project_tracks
│   ├── templates.py         # 模板定义与加载
│   └── prompt_builder.py    # Prompt 构建：填充素材数据 + 创作指令
├── templates/               # 创作模板 JSON 文件
│   ├── long_documentary.json
│   ├── quick_montage.json
│   └── free_creation.json
└── creative_prompt.txt      # AI 导演 Prompt 模板
```

### 9.2 新增 API 端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/workbench/<pid>/creative-brief` | POST | 组装素材数据 + 创作指令 → 调用大模型 → SSE 流式返回方案 |
| `/api/workbench/<pid>/creative-brief/preview` | POST | 仅组装输入 JSON 预览（不调用大模型，用于调试） |
| `/api/workbench/<pid>/creative-brief/apply` | POST | 接收 AI 方案 JSON → 组装为 tracks → 写入 project_tracks |

### 9.3 creative-brief 端点流程

```
POST /api/workbench/<pid>/creative-brief
Body: { template, duration_target, opening, structure, emotion_arc, voice, music, ending }

1. 验证工程存在且有已分析的视频素材
2. 查询工程所有 media + segments（按 date_taken / media_id / seq 排序）
3. templates.py 加载模板定义，合并用户选择
4. prompt_builder.py 组装：
   a. 系统提示词（角色 + 创作原则 + 输出 schema）
   b. 用户消息（创作指令 JSON + 素材数据 JSON）
5. 调用大模型 API（OpenAI 兼容 SDK，SSE 流式）
6. 流式返回：
   - 事件类型：progress（进度百分比）、shot（每生成一个 shot 实时推送）、done（完整方案）、error
7. 全部返回后解析完整 JSON，校验 segment_id 有效性
```

### 9.4 素材数据压缩策略

200+ segment 的完整元数据可能超出 token 限制，采用压缩策略：

| 策略 | 说明 |
|------|------|
| 精简维度 | 仅发送 AI 导演需要的维度：segment_id, duration, visual(截断100字), mood, scene_type, shot_type, asr(截断50字), dominant_colors |
| 去除空值 | ASR 为空的不发送 |
| 时长聚合 | 用秒数替代 MM:SS 格式 |
| 预估 | 每个 segment 约 50-80 tokens，200 segments ≈ 10k-16k tokens |

### 9.5 时间线组装器

`assembler.py` 将 AI 方案 JSON 转换为 `project_tracks` 记录：

```
AI 方案 JSON
    │
    │  遍历 acts → narratives → shots（三层结构）
    ▼
acts[i] → theme track item（标题 + purpose）
    │
narratives[j].text → text track item（叙事段落，跨多个 shot）
    │
narratives[j].shots[k] → video track item（segment_id + 时间范围）
    │
shots[k].narration → narration track item
    │
shots[k].emotion → emotion track item
    │
shots[k].use_asr + segment.asr → subtitle track item
    │
    ▼
PUT /api/workbench/<pid>/tracks（批量替换）
```

**segment_id 校验**：组装前验证所有 segment_id 存在于工程的素材中，无效的标记为缺口（ghost slot）。

### 9.6 前端实现

**创意引导器对话框**：`q-dialog`（全屏模式，`v-if="!pickerOpen"` 在素材选择器打开时销毁避免遮挡），内部分步表单组件（6 步：选素材 → 选模板 → 叙事结构 → 情绪弧线 → 声音设计 → 确认生成）。第 1 步进入时自动弹出全局素材选择器（90% 弹窗），选中后回到引导器显示已选素材摘要。

**素材选择器交互**：
- `openPicker()` 设置 `$root.pickerMode=true` 并注册 `_pickerCallback`，同时设 `pickerOpen=true` 销毁引导器 dialog
- 选择器确认后 callback 回传 ID 数组，重置 `pickerOpen=false` 恢复引导器
- 取消选择（`cancelPicker`）同样调用 callback 传空数组，确保引导器正常恢复

**成片大纲面板**：右侧面板新增 Tab 切换（成片大纲 / 分析结果），大纲数据从 `project_tracks` 的 `theme` 类型条目派生。

**素材统计查询**：`GET /api/creative/<pid>/stats` 返回聚合统计（总片段数、总时长），引导器各步底部显示内联统计摘要。

### 9.7 数据模型变更

无新增数据库表。AI 方案数据完全通过现有 `project_tracks` 表存储：

- `theme` 类型条目的 `metadata` JSON 增加 `purpose`（创作意图）和 `act_id`（幕标识）
- `video` 类型条目的 `metadata` JSON 增加 `purpose`（镜头意图）和 `act_id`
- `narration` 类型条目的 `content` 存储 AI 生成的旁白文案
- `emotion` 类型条目存储 AI 建议的情绪锚点值

`projects` 表增加可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `creative_brief` | TEXT | JSON，存储用户在引导器中的创作指令（可回溯/重新生成） |
| `ai_plan` | TEXT | JSON，存储 AI 返回的完整方案（可回溯） |

## 10. 已知技术问题

详见 [docs/todo.md](todo.md)。

### 待解决的关键项

- **ASR 本地模型改云端**：faster-whisper 占用 3-6GB 内存，产品化后需切换为云端 API
- **安全**：路径遍历、任意文件读取（A1/A2）发布前需修
- **并发分析竞态**（A3）：processing 状态防重复提交已实现，信号量控制 VLM API 并发
- **JSON 解析失败处理**（A13）：应标记为 error 而非 done
