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
| 哈希去重 | hashlib SHA256 + imagehash pHash |
| 端口 | 6622 |

## 2. 项目结构

```
video_analyzer/
├── run.py                     # 入口：创建 Flask app，加载 .env
├── requirements.txt
├── .env                       # ZHIPUAI_API_KEY
├── backend/
│   ├── __init__.py            # create_app() 工厂函数
│   ├── config.py              # 路径、文件扩展名配置
│   ├── db.py                  # SQLite schema、迁移、连接管理
│   ├── analyzer.py            # VLM API 调用（视频/图片分析）
│   ├── compressor.py          # ffmpeg 视频压缩 + temp 清理
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
│   │   ├── collections.py     # 合集管理
│   │   ├── tags.py            # 标签管理
│   │   └── settings.py        # 全局设置 CRUD
│   └── services/
│       ├── importer.py        # 文件扫描、元数据提取、缩略图生成
│       └── xmp_writer.py     # XMP 侧车文件写入（仅照片）
├── frontend/
│   ├── index.html             # SPA 主页面（Vue app + 路由 + 弹窗）
│   ├── css/main.css           # 暗色/亮色主题
│   └── js/
│       ├── api.js             # API 客户端
│       ├── gallery.js         # Gallery 页组件
│       └── detail.js          # Detail 页组件
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

`run.py` → `create_app()` → 初始化目录 → 清理 temp_video → 初始化数据库（schema + 迁移 + checkpoint + VACUUM）→ 注册蓝图。

### 3.2 蓝图路由

| 蓝图 | 前缀 | 职责 |
|------|------|------|
| `serve` | 无 | 媒体文件服务 |
| `library` | `/api/library` | 媒体库 CRUD、文件夹树 |
| `analysis` | `/api/analysis` | AI 分析 + 分段编辑 |
| `collections` | `/api/collections` | 合集管理 |
| `tags` | `/api/tags` | 标签管理 |
| `settings` | `/api/settings` | 全局设置 CRUD |

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
       file_hash, phash, has_xmp,
       analysis_status, analysis_model, analysis_date,
       rating, color_label, favorite, notes,
       imported_at, updated_at)

-- 分段分析结果
media_segment (id, media_id, time_start, time_end,
               visual, asr, subtitle, dominant_colors, main_subjects,
               shot_type, focal_length, camera_angle, camera_movement,
               perspective, scene_type, mood, lighting, weather, seq)

-- 合集
collections (id, name, cover_id FK→media.id, created_at)
collection_items (collection_id FK CASCADE, media_id FK CASCADE, PK)

-- 标签
tags (id, name UNIQUE)
media_tags (media_id FK CASCADE, tag_id FK CASCADE, PK)

-- 全文搜索
media_fts (FTS5: media_id UNINDEXED, file_name, visual, asr, subtitle,
           subjects, colors, tags, tokenize=unicode61)

-- 全局设置
settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
-- 默认值: resolution, fps, vendor, model, use_multimodal, asr_engine, video_api_key, asr_api_key, image_resolution, image_api_key, image_model
```

**迁移系统**：`_MIGRATIONS` 列表 + `_migrate()` 函数，通过 `PRAGMA table_info` 检测缺失列并 ALTER TABLE。特殊情况（如 dialogue→asr 重命名 + FTS 重建）在 `_migrate()` 中硬编码处理。

### 3.4 文件夹树 API

从 `media` 表的 `file_path` 列动态构建目录树，无需额外数据库表。

**端点**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/library/folders` | GET | 返回目录树结构 |
| `/api/library/?folder=<path>` | GET | 按文件夹前缀筛选媒体列表 |

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

### 3.5 分段编辑 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/analysis/<media_id>/segments/<seg_id>` | PATCH | 更新单个分段的部分字段 |

**`_EDITABLE_COLS` 白名单**：`visual`, `asr`, `subtitle`, `shot_type`, `focal_length`, `camera_angle`, `camera_movement`, `perspective`, `scene_type`, `mood`, `lighting`, `weather`, `dominant_colors`, `main_subjects`

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
import_single_file() × 3 并发
    ├── _import_one() — 检查重复（清理旧缩略图）
    ├── _probe() / _probe_image() — ffprobe + exiftool 元数据
    │   ├── 视频额外检测：DJI 文件名 _D 后缀推断 D-Log M
    │   └── 图片额外检测：XMP 侧车文件是否存在
    ├── _compute_file_hash() — SHA256 文件哈希
    ├── _compute_phash() — 感知哈希（pHash，用于相似检测）
    ├── _generate_thumbnail() — ffmpeg 截帧 / exiftool 提取（RAW 内嵌缩略图）
    └── INSERT media + media_fts
```

### 4.2 视频分析流程

分析参数从 `settings` 表读取（非请求 body），通过 `get_setting(db, key)` 获取。

**多模态模式**（`use_multimodal=true`，默认）：VLM 同时处理视觉和语音，3 阶段。

```
POST /api/analysis/<id>
    ↓
读取 settings（model, resolution, fps, use_multimodal）
    ↓
compress_video() — ffmpeg 压缩到 temp_video/
    ↓
analyze_video(multimodal=True) — prompt 中恢复 ASR 指令，VLM 识别画面和语音
    ↓
save_segments() → _refresh_fts() → call_on_close()
```

**独立 ASR 模式**（`use_multimodal=false`）：VLM + ASR 并行，4 阶段。

```
POST /api/analysis/<id>
    ↓
读取 settings（model, resolution, fps, use_multimodal, asr_engine）
    ↓
compress_video() — ffmpeg 压缩到 temp_video/
    ↓
┌─────────────────────────┬──────────────────────┐
│  analyze_video()        │  _run_asr()           │
│  (base64 → VLM API)    │  (faster-whisper)     │  ← ThreadPoolExecutor 并行
└─────────────────────────┴──────────────────────┘
    ↓
_merge_asr() — 按 time_start/time_end 重叠匹配，拼接 ASR 文本到 VLM 分段
    ↓
save_segments() — DELETE 旧分段 → INSERT 新分段 → UPDATE status
    ↓
_refresh_fts() — DELETE 旧 FTS → jieba 分词 → INSERT 新 FTS
    ↓
call_on_close() — 清理 temp_video/
```

进度通过 **SSE（Server-Sent Events）** 实时推送到前端，事件类型：`progress`（步骤更新）、`done`（完成）、`error`（失败）。

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

当前实现：`WhisperEngine`（faster-whisper large-v3, device=auto, 语言自动检测）。

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
| 无限滚动 | IntersectionObserver，200px rootMargin |
| 分析进度 | SSE → ReadableStream + TextDecoder → 逐行解析 JSON |
| 框选 | mousedown/mousemove/mouseup + `elementFromPoint` 命中测试 |
| 音频波形 | Web Audio API 解码 → Canvas 绘制峰值 |
| 视频示波器 | Canvas，0.2x 离屏缩放，~15fps requestAnimationFrame |
| 直方图 | 离屏 Canvas 采样 → RGB 三通道曲线 |
| 动画 | Lottie（`lottie.min.js`） |
| 文件夹树 | Quasar `q-tree` 组件，嵌套在素材库 `q-expansion-item` 内（`content-inset-level="0.1"`），应用启动时 `getFolders()` 加载，点击节点设 `selectedFolder` |
| 媒体类型筛选 | `q-btn-group` 包含独立 `q-btn`（带 `q-tooltip`），替代 `q-btn-toggle` |
| 分段编辑 | `contenteditable` + `@blur` → `saveSegField()`（文本字段）；`×` 按钮 → `removeTag()`（标签字段） |
| 键盘快捷键 | `document.addEventListener("keydown")` 全局监听，`created()` 注册 / `beforeUnmount()` 清理；`isContentEditable` 检测避免编辑冲突 |

### 5.3 文件夹筛选数据流

```
App.mounted()
  └── loadSidebar() → API.getFolders() → this.folderTree  (侧边栏素材库树渲染)

用户点击树节点
  └── onFolderSelect(path)
      └── this.selectedFolder = path  (toggle: 再次点击设 null)

用户展开/收起素材库
  └── onLibraryToggle()  → this.libraryExpanded = !this.libraryExpanded

路由切换
  └── resolveRoute()
      ├── 切到收藏/合集 → this.libraryExpanded = false (自动收起)
      └── 切回画廊       → this.libraryExpanded = true  (自动展开)

Gallery.load() / Gallery.loadMore()
  └── 读取 this.$root.selectedFolder
      └── 作为 folder 参数传入 API.getLibrary({ folder })
          └── 后端 WHERE file_path LIKE '<folder>/%'
```

`selectedFolder` 同时控制侧边栏"素材库"入口的高亮状态（`selectedFolder` 非空时不高亮），确保文件夹筛选和导航入口互斥。素材库使用 `q-expansion-item` 包裹目录树，`libraryExpanded` 控制展开/收起状态。

## 6. 外部依赖

| 工具 | 用途 |
|------|------|
| ffmpeg/ffprobe | 视频压缩、截帧缩略图、实时转码、元数据提取 |
| exiftool | 相机/镜头元数据、拍摄日期、RAW 内嵌缩略图提取、XMP 侧车文件写入 |
| faster-whisper | 本地 ASR（large-v3 模型，CTranslate2 后端） |

### Python 包

```
openai>=1.0.0       # 智谱 AI VLM API（OpenAI 兼容端点）
python-dotenv>=1.0.0
flask>=3.0
Pillow>=10.0        # 图片处理 + 压缩
faster-whisper>=1.0.0  # 本地 ASR
rawpy>=0.20.0       # RAW 格式解码（NEF/DNG/CR2/ARW 等）
imagehash           # 感知哈希（pHash）用于相似图片检测
```

运行时额外依赖（非 requirements.txt）：`jieba`、`rawpy`、`pillow-heif`。

## 7. 媒体文件服务

| 路由 | 策略 |
|------|------|
| `/media/video/<id>` | 原生格式（mp4/m4v/webm/mov）直接发送（支持 Range）；其他格式实时 ffmpeg 转码为 H.264 |
| `/media/image/<id>` | JPG/PNG 等直接发送；RAW 用 rawpy 解码为 JPEG；HEIC/AVIF 用 pillow-heif 解码 |
| `/media/thumbnail/<id>` | 从 DB 查 thumbnail_path，与 THUMB_DIR 拼接后发送 |

## 8. 已知技术问题

详见 [docs/todo.md](todo.md)。

### 待解决的关键项

- **ASR 本地模型改云端**：faster-whisper 占用 3-6GB 内存，产品化后需切换为云端 API
- **安全**：路径遍历、任意文件读取（A1/A2）发布前需修
- **并发分析竞态**（A3）：同时分析同一视频会互相覆盖
- **JSON 解析失败处理**（A13）：应标记为 error 而非 done
