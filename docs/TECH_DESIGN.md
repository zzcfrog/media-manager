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
│   ├── analyzer.py            # VLM API 调用（视频/图片分析；`_openai_client()` 本地 base_url 绕代理）
│   ├── local_vlm.py           # 本地视觉引擎管理（llama-server 子进程单例：spawn/健康检查/端口顺延/回收）
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
│   │   ├── settings.py        # 全局设置 CRUD
│   │   └── local_vlm.py       # 本地视觉引擎路由（status/models/start/stop）
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
│       ├── mindmap.js         # 脑图视图组件（三级层次、编辑、拖拽、删除）
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

`run.py` → `create_app()` → loguru 日志初始化 → 初始化目录 → 清理 temp_video → 初始化数据库（schema + 迁移 + checkpoint + VACUUM）→ 注册蓝图 → 按需预加载本地 ASR 模型（仅 `video_engine=local` 或 `use_multimodal=false` 时加载；云端+多模态跳过，首次使用时懒加载）。

### 3.2 蓝图路由

| 蓝图 | 前缀 | 职责 |
|------|------|------|
| `serve` | 无 | 媒体文件服务 |
| `library` | `/api/library` | 媒体库 CRUD、文件夹树、导入、相似检测、排除管理 |
| `analysis` | `/api/analysis` | AI 分析 + 批量分析 + 分段编辑 + 进度查询 |
| `tags` | `/api/tags` | 标签管理（后端保留，前端已移除） |
| `settings` | `/api/settings` | 全局设置 CRUD |
| `workbench` | `/api/workbench` | 创作工作台：工程 CRUD、segment 查询、多轨时间线管理、导出 FCPXML+SRT（`POST /<pid>/export-fcpxml`，由 [fcpxml_export.py](../backend/fcpxml_export.py) 生成） |
| `local_vlm` | `/api/local-vlm` | 本地视觉引擎管理：`GET status`/`GET models`/`POST start`/`POST stop`（llama-server 子进程生命周期） |

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
       date_taken, thumbnail_path, cover_art_path,
       file_hash TEXT, phash TEXT, embedding BLOB, has_xmp,
       analysis_status, analysis_model, analysis_date,
       rating, color_label, favorite, notes,
       imported_at, updated_at)

-- 分段分析结果
media_segment (id, media_id, time_start, time_end,
               visual, asr, subtitle, dominant_colors, main_subjects,
               shot_type, focal_length, camera_angle, camera_movement,
               perspective, scene_type, mood, lighting, weather,
               style, color_tone, tone, dof, composition, highlights, emotions, seq)

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

### 3.5 高级筛选 API（维度参数 + facets）

框架级「高级筛选」：切换媒体类型自动展开面板，每类型一组维度。前端只认桶 key + 标签 + facet 计数，**桶阈值在后端单点定义**（[library.py](../backend/blueprints/library.py) 模块常量）：

```python
RES_BUCKETS_IMAGE  = {"S":(0,8),  "M":(8,24),  "L":(24,45),  "XL":(45,None)}   # MP，半开区间
RES_BUCKETS_VIDEO  = {"480":(0,720), "720":(720,1080), "1080":(1080,2160), "2160":(2160,None)}  # height px
FPS_BUCKETS        = {"24":(23,26), "30":(26,33), "60":(48,80), "120":(100,None)}  # float，PAL 25/50 近似入 24/60
DUR_BUCKETS        = {"short":(0,60), "mid":(60,300), "long":(300,None)}          # 秒
FPS_AS_FLOAT       # SQL 表达式：把 "N/D" 文本 fps 转 float（NULL/空 → NULL），/0 除零在 _parse_fps 守卫
```

**`list_media` 新参数**（复用共享 `where_clauses`/`params` → total/分页/`fields=id` 自动继承，仅 `media_type != "all"` 分支生效）。所有视觉分析维度都在 `media_segment`（图片恰 1 条片段、视频 N 条）→ 图片/视频共用**片段语义**谓词：

```python
# 枚举维度（景别/焦段/视角/运镜/透视/场景/光线/天气/情绪/风格/色调/影调/景深/构图）：
EXISTS (SELECT 1 FROM media_segment ms WHERE ms.media_id = media.id AND ms.<col> = ?)
# 数组维度（颜色/主体，json.dumps ensure_ascii=False 存数组）：
EXISTS (SELECT 1 FROM media_segment ms WHERE ms.media_id = media.id AND instr(ms.<col>, ?) > 0)   # 参数 = json.dumps(value, ensure_ascii=False)
# 视频多片段：任一片段命中即视频命中（EXISTS 天然满足）
```

- image：片段枚举 dim + 数组 dim（`dominant_colors`/`main_subjects`）；`encoding` → `_ENCODING_CASE = ?`（按扩展名派生 JPG/RAW/HIF/OTHER，`_ENC_EXTS` 取自 config `RAW_EXTS`/`HEIF_EXTS`）；`orientation` → `_orient_pred`（w/h 比较 横/竖/方，替代 v1 aspect）；`camera_make`/`camera_model` 精确匹配；`date_from`/`date_to`。
- video：同片段 dim + `camera_movement`/`mood`；`res` → `_bucket_pred("height", RES_BUCKETS_VIDEO)`；`fps` → `_bucket_pred(FPS_AS_FLOAT, FPS_BUCKETS)`；`dur` → `_bucket_pred("duration", DUR_BUCKETS)`；`camera_make`/`camera_model`；`orientation`；`color_space = ?`。
- audio：`music_mood`/`music_genre`/`music_instrument`/`music_theme` → `instr(media.music_summary, ?) > 0`，参数 = `json.dumps({"label": value}, ensure_ascii=False)`（去首尾花括号，精确匹配 `"label": "Epic"`）；`music_vocals` → 同法匹配 `"vocals": value`。
- all：忽略全部维度。**匹配用 `instr` 而非 `json_each`**（空串/非法 JSON 会整查询报错；instr 精确匹配 JSON 字符串元素、空串天然不命中，转义由 `json.dumps` 保证）。NULL 维度行仅在对应筛选活跃时被排除。

**日期边界（真实 bug 修复沉淀）**：`date_taken` 存在两种存储格式——EXIF `"YYYY-MM-DD HH:MM:SS"` 与 mtime 回退 `"YYYY-MM-DDTHH:MM:SS.ffffff"`（isoformat）。`date_to` 用 **`substr(date_taken, 1, 10) <= ?`** 按前 10 位比较：既含整天，又天然兼容两种格式（若用 `<= 'YYYY-MM-DD 23:59:59'`，T-格式同一天行因 `'T' > ' '` 被错误排除）。

**新端点 `GET /api/library/facets?media_type=image|video|audio`**（`list_media` 后、`/segment-stats` 前；作用域仅 media_type，无交叉筛选；枚举 dim 的 facets 只含数据里出现的值，0 计数由前端禁用）：
- 通用片段 facet：`_seg_facet(db, col, mt)` = `SELECT ms.<col> AS value, COUNT(DISTINCT ms.media_id) AS count FROM media_segment ms JOIN media m ON m.id=ms.media_id WHERE m.media_type=? AND ms.<col>!='' GROUP BY ms.<col> ORDER BY count DESC, ms.<col> LIMIT 200`；数组维度 `_arr_facet` = Python 扫行 `json.loads` 逐元素计数（与 v1 桶计数同风格）。
- image → 全部片段 dim facets + `camera_make`/`camera_model`（既有）+ `encoding`/`orientation` GROUP BY + `date_min`/`date_max`（`substr(date_taken,1,10)`）+ `res` 桶计数。
- video → 片段 dim facets + `res`/`fps`/`dur` 桶计数（Python 扫行，fps 用 `_parse_fps`；桶为 **dict** `{key: count}`）+ `camera_make`/`camera_model` + `orientation` + `color_space` GROUP BY。
- audio → `music_mood`/`music_genre`/`music_instrument`/`music_theme` = Python 扫 `music_summary` 逐 label 计数；`music_vocals` = 扫 vocals 值计数。
- 非法 media_type → 400。

### 3.6 相似检测与排除 API

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

### 3.7 分段编辑 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/analysis/<media_id>/segments/<seg_id>` | PATCH | 更新单个分段的部分字段 |

**`_EDITABLE_COLS` 白名单**：`visual`, `asr`, `subtitle`, `shot_type`, `focal_length`, `camera_angle`, `camera_movement`, `perspective`, `scene_type`, `mood`, `emotions`, `lighting`, `weather`, `style`, `color_tone`, `tone`, `dof`, `composition`, `dominant_colors`, `main_subjects`

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
    ├── _extract_cover_art() — 音频内嵌封面（仅 media_type=audio）：ffmpeg `-an -map 0:v:0 -frames:v 1 -vf scale=320:-1` 主路径，`returncode==0 AND 存在 AND size>100` 守卫；exiftool `-Picture/-CoverArt/-PreviewImage` + PIL `ImageOps.exif_transpose` 兜底；失败清理半成品返回 None；结果存 `cover_art_path` 列（THUMB_DIR 扁平结构）
    └── INSERT media + media_fts
```

**批量导入端点**：`POST /api/library/import-batch`（SSE 流，前端单次请求，后端 5 线程并发处理，实时推送 ok/fail/skip 事件）

**用拍摄时间覆盖文件时间**：`POST /api/library/set-file-date-from-exif {ids}`（SSE 流式）——用 exiftool `-FileCreateDate=<dt> -FileModifyDate=<dt>` 把文件创建/修改时间改为 DB `date_taken`（导入时已带 CreateDate 回退）。**50 文件/批**用 `-execute` 链一个进程跑完（省 N 次启动），stderr `Error: ... - <path>` 解析失败文件。时区：date_taken 是相机本地时间，exiftool 按本机时区写入，Finder 显示拍摄本地日期（不做 UTC 换算）。无 date_taken / 文件缺失跳过；成功文件同步 `file_mtime`。每批 yield `progress`、末尾 `done`。素材库右键菜单，前端 `<q-dialog>` 进度框（`_streamFileOp` 消费 SSE）+ 二次确认（不可逆）。

**拍摄时间时区调整**：`POST /api/library/shift-shooting-time {ids,hours}`（SSE 流式）——exiftool 对 `DateTimeOriginal/CreateDate/TrackCreateDate/MediaCreateDate` 统一 `+=N:00:00`（或 `-=`），`hours` 限 `-24..+24`、0 直接返回。**同一偏移量 50 文件/批**一次 exiftool（多文件同 args），省 N 次启动。同步偏移 DB `date_taken`（`_shift_date_taken` 保留 ISO-Z/纯文本原格式）。用于校正相机时间/时区偏差（改嵌入元数据需重写整个 MP4，大文件慢是固有 I/O，SSE 保证不整体超时 + 有进度）。素材库右键菜单，前端滑杆 + ⚠ 不可逆提示 + 进度框。
    ├── _import_one() — 检查重复（已存在则跳过，不删旧缩略图）
    ├── _probe() / _probe_image() — ffprobe + exiftool 元数据
    │   ├── 视频额外检测：DJI 文件名 _D 后缀推断 D-Log M
    │   └── 图片额外检测：XMP 侧车文件是否存在
    ├── compute_embedding() — ResNet50 ONNX 特征向量（仅图片，2048 维 L2 归一化）
    ├── _generate_thumbnail() — ffmpeg 截帧 / exiftool 提取（RAW 内嵌缩略图），UUID 随机文件名
    ├── _extract_cover_art() — 音频内嵌封面（仅 media_type=audio），同单条导入路径，结果存 `cover_art_path`
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
compress_video() — ffmpeg 压缩（线程运行，SSE 推送真实百分比；本地引擎模式跳过此步，抽帧直接吃原片）
    ↓
┌─────────────────────────┬──────────────────────────────┐
│  analyze_video()        │  _run_asr()                   │
│  (base64 → VLM API)    │  (faster-whisper, VAD+词级)   │  ← ThreadPoolExecutor 并行
└─────────────────────────┴──────────────────────────────┘
    ↓ VLM 完成 → SSE analyze_done（立即标记）
    ↓ ASR 完成 → SSE asr_progress（加载模型 → 语音识别）
    ↓
_stitch_asr_sentences() — 句子缝合：whisper 常在句中停顿处切断，把「前段无终止标点 + 间隔 <1.2s」的相邻段拼回整句
    ↓
_merge_asr() — 最佳匹配：每段 ASR 只匹配重叠时间最长的 VLM 分段（整句归属，不切文本）
    ↓
_stitch_cross_segments() — 跨分镜缝合：前一分镜 asr 未说完（无终止标点）时把后一分镜 asr 拼回（多模态模式按镜头转写的兜底）
    ↓
save_segments() → _fix_segment_overlaps()（修正重叠时间戳）→ _refresh_fts() → call_on_close()
```

进度通过 **SSE（Server-Sent Events）** 实时推送到前端：
- `progress` 事件包含 `step` 和可选字段。**云端视频**：`compressing`(percent) → `compressed`(尺寸/码率) → `analyzing`(substep/chars) → `asr_start` → `asr_progress`(substep: loading/transcribing) → `merging`；**本地视频**：`queued`(engine) → `engine_starting`(message 带已耗时秒数) → `engine_ready`(elapsed=加载耗时) → `extracting`(percent=窗进度, window=i/N) → `extract_done`(windows/frames) → `analyzing`(window=i/N, substep/chars) → `asr_start` → `asr_progress` → `merging`
- 一次性事件（engine_ready/extract_done）由 worker 在完成瞬间写入 `engine_time`/`extract_info` 标志、生成器轮询时补发——不依赖 step 转迁检测，快速阶段（如合并 <1s）不会被 0.3s 轮询间隔漏掉；合并过快时前端在 done 事件收尾兜底
- `done`（完成，含 usage/segments_count）、`error`（失败）

**双引擎（云端/本地）**：`image_engine`/`video_engine`（settings 表，默认 cloud）决定分析走向（详见 [PRD_LOCAL_VLM.md](PRD_LOCAL_VLM.md)）。

- **图片链路（已实现）**：`_start_image_analysis` 读 `image_engine`，本地时免 API Key；`_process_image` 调 `local_vlm.ensure(local_model)`（SSE 推 `engine_starting`，幂等——已运行同模型直接复用，切换模型自动重启引擎）后以 `base_url=http://127.0.0.1:<port>/v1` 调 `analyze_image`，OpenAI 兼容接口零适配。
- **视频链路（已实现）**：本地栈无视频解码器，`analyze_video_frames()`（analyzer.py）走 **ffmpeg 分窗抽帧多图**——`extract_video_frames()` **直接吃原片**（本地模式跳过 compress_video，无 temp 中间产物），抽帧 filter 一步 `fps=N,scale=W:H`（短边 = `local_frames_res` 240/480/720；ffprobe 探宽高算精确 scale，16:9 横片与压缩语义一致），macOS 附 `-hwaccel videotoolbox`（4K 10bit HEVC 软解极重且抢推理核，实测硬解 CPU 省 30×）。每窗 ≤ `local_frames_max` 帧（窗时长 = 帧数上限 ÷ `local_frames_fps`，内存与视频时长无关），prompt 中每帧标注绝对时间戳 `[HH:MM:SS]`（模型可输出跨窗连续的绝对时间；保留相对时间平移兜底），分窗请求后拼接 segments。本地模式两个入口（单条 SSE + 批量）均强制 `use_multimodal=False` → ASR 走 whisper 分支**直接转写原片音轨**后 `_merge_asr` 合入。实测每帧约 190 token（240p）/ 400（480p），`local_frames_max` 默认 32。进度事件（`/progress` 与 SSE queued）携带 `engine` 字段（queued 另带 `asr_mode`），detail 页本地视频时间线为 **5 步：本地引擎启动（engine_starting 带已耗时，首次 4~40s）→ 抽帧（extracting 逐窗 percent，extract_done 报「N 窗 · M 帧」）→ 视觉分析（analyzing window=i/N + 接收字符数）→ 语音转写（asr loading/transcribing）→ 合并保存（merging）**；whisper 的 `transcribe(on_progress)` 接入 ASR 子步骤上报（此前从未上报，转写期间 UI 误显示「分析中」——云端独立 ASR 同步受益）。**Omni 音视频同析（`local_asr_mode=merged`，仅 qwen3-omni-30b-a3b）**：`extract_video_frames(with_audio=True)` 每窗另抽 16k 单声道 PCM（`-f s16le pipe:1`，wave 模块自建头——管道流式 `-f wav` 的头部长度是占位值不可用），`analyze_video_frames` 在帧前插入 `input_audio`（OpenAI 格式，base64 wav），模型直接听原声；`_process_video` 跳过独立 whisper，时间线变 4 步（引擎→抽帧→视听分析→合并）；模型清单新增 qwen3.6-35b-a3b（unsloth UD-Q4_K_M 22.1GB，纯视觉）与 qwen3-omni-30b-a3b（ggml-org Q4_K_M 18.6GB，audio+vision，MODELS 带 `audio: true`），`installed_models()` 输出 `audio` 字段，设置下拉列出全部模型（未下载禁选并标注）。
- **启动模型预加载进度**：`asr/__init__.py` 维护 `preload_state`（loading/done/error，`is_ready()` 校验），`/api/analysis/progress` 在加载中附带 `__preload__` 系统任务；前端顶部进度条渲染为任务条目（无缩略图、耗时爬升百分比），页面刷新可恢复。预加载按需触发：仅 `video_engine=local`（帧无音频强制 whisper）或 `use_multimodal=false`（独立 ASR）时启动加载，云端+多模态跳过（省 ~3GB 内存，whisper 首次使用时懒加载）；本地视觉模型（llama-server）不在启动加载，首次本地分析时 `ensure()` 按需启动。
- **⚠ 本地回环必须绕代理**：httpx（OpenAI SDK 底层）的 `trust_env=True` 会读 **macOS 系统代理**（scutil 层，环境变量为空也读；Clash「系统代理」常开），把 `127.0.0.1` 请求发给代理导致挂死；系统代理的本地例外列表 httpx 不识别。analyzer.py `_openai_client()` 对本地 base_url 用 `httpx.Client(trust_env=False, timeout=600)`（自定义 http_client 必须显式给 timeout，httpx 默认 5s）；local_vlm.py 健康检查用 `ProxyHandler({})` 同理。

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
| 高级筛选面板 | 声明式 spec `ADVANCED_FILTER_SPEC`（audio/image/video 各一组维度，image 19 / video 18 / audio 6；每 dim 可带 `group`（组 i18n 键，**同组必须连续**））+ `currentSpec` 驱动渲染；面板 **Office Ribbon 同屏组段布局**——`groupedSpec` computed 按连续 `group` 聚合成段，面板 = flex-wrap 容器，每段 `.adv-group`（段内 `.adv-group-dims` flex-wrap 一到两行 + 段底 `.adv-group-name` 10px 组名；`flex:0 1 auto + max-width:100% + min-width:0` 段过宽先收缩组内折两行、整段不拆散），段间 1px 竖分隔线（`:first-child` 与无组段 `.adv-group-plain` 无边线、无组名）；筛选栏「高级筛选」按钮（`v-if="currentSpec.length"`，三态 class：展开 `adv-btn-open`（底方角「卡舌」）> 有活跃 `adv-btn-active` > 普通，尾部 expand_less/expand_more 箭头）+ filter-bar 根 `adv-open` 类（底边透明）与面板顶边 2px accent-dim 融合；`q-select`（dense clearable options-dense，`:label`=维度标题）全下拉 + 音乐显示 toggle（displayOnly）；**拍摄日期合一控件**：单个只读 q-input（placeholder 居中走 `:placeholder-shown`；注意 q-input 真 input 类 = `q-field__native`，无 `q-field__input`），event 图标弹 QDate `range`（`advDatePick` v-model 就地状态 + `advDatePopup` v-model 控弹层，`onAdvDateRange` 仅 from+to 齐才提交并自动关），**自定义 cancel 图标清空两端**（Quasar `clearable` 对 readonly 字段不渲染 ×，这是「日期没法取消」的根因）；**两区字段**（34px）：空态 label 全宽居中（`right:-30px` 外扩抵消下拉箭头 append，因定位父级 `.q-field__control-container` 被箭头挤窄）、float 态 label [2,14] 小标签（0-4-0 特异性压 Quasar、`transform:none`）+ 值 [14,34]（`.q-select`/`.q-input` native 规则**拆分写**，日期 input 不吃 padding-top）；`.adv-dim.active` 强调（accent-dim 底/accent 底条/文字）；`dimOptions(dim)` 统一选项来源——枚举 + **count 独立字段**（菜单徽标渲染，非 label 拼接）+ 0 置灰（`off(v)=counts?cnt(v)===0:false` 守卫——无 facetKey（显示 toggle）与 facets 未加载/失败均不禁用）+ 并入 facets 新值、音乐从 `root.musicTax` 建项（en 值 + zh 显示）、动态 dim 走 facets；菜单 `popup-content-class="adv-select-menu"`（portal 到 body，CSS 全局写；紧凑规格 28px 行高/12px 字号/3px 内边距）+ option slot（`v-bind="scope.itemProps"` 自带 disable）渲染徽标/对勾/selected 底；`_buildParams` 遍历 spec 统一发射（displayOnly 跳过、dateRange 拆 `date_from`/`date_to`），load/loadMore/selectAll 共享；切换类型 watcher 只 `_loadFacets` 不自动展开；`_advFacets` 按类型缓存，加载成功后再补拉（曾失败自动重试，避免下拉全禁用）；`advPanelOpen` 随 `_saveFilters` 持久化、picker 模式不持久化；q-date 必须 `mask="YYYY-MM-DD"`（否则字典序比较静默失效） |
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

**轨道布局**：时间线分两层——情绪轨道独立 `.wb-track-row`（最上，svg 曲线）；下方 `.wb-content-group`（共享 labels 列 + `.wb-content-group-area`）容纳旁白/字幕/分镜 3 条贯穿 `.wb-content-lane`，area 是统一定位基准（`width=timelineWidth`，框/lane 共用 `trackItemPos` 零换算）。主旨/叙事是 `.wb-overlay-frame`（absolute 覆盖 area），主旨框（实线边框, z3）包叙事框（虚线, z4）。pointer-events：框主体 `none`（不挡块拖拽/点击/drop）、标题 `auto`（点选/改名/右键）、块 `z-index:5`。框编辑：点标题选中、Delete 删（`_cascadeDelete` 级联）、双击标题改名（`startFrameRename`→`_trackSave`→`_syncTracksToPlan` 回写 plan）。`addTrackItem` 对 theme/text return（由 apply 生成）。

**缩放**：`trackZoom`（1-10x）通过内联 `transform: scaleX()` + `minWidth` 百分比缩放 `.wb-track-content` 内容区域，超出时横向滚动。

**块定位 `trackItemPos(item)`**：返回 `{left, width}` **浮点 px**（亚像素），`left = time_start*pps`、`width = max(0.5, dur*pps)`。连续块 `time_end[i]==time_start[i+1]`，浮点保证右边界 `e*pps` 精确等于下一块左边界，避免 `round(s)+round(dur)` 偶尔超过 `round(s+dur)` 的 1px 重叠（小 zoom 尤甚，曾导致 137/170 块视觉重叠）。`.wb-track-item` 用 `box-sizing: border-box`，但**水平 padding 不放在块本体**（`padding: 2px 0`）——border-box 下块宽 < padding 时元素最小宽会被提升到 padding、撑大短块（曾让小 zoom 下短 video 块从 3px 撑到 16px，视频轨道比主旨/叙述长）；水平间距改放文字元素 `.wb-track-item-label` / `.wb-track-text`（`padding: 0 8px` + `min-width:0`，flex item + overflow hidden 不会撑大块）。

**编辑操作**：
- **撤销/重做**（时间线/脑图两视图通用，ToolBar 常驻）：JSON 快照栈（`_undoStack` / `_redoStack`），栈元素是 `{tracks, plan}` 成对快照（`_trackSnapshot()`→`_snapshotCurr()` 同时存 `this.tracks` 深拷贝与 `this.project.ai_plan` 字符串）。**为什么 plan 也要快照**：tracks 单独无法重建脑图的结构性删除——删叙事/段落后该 act/narrative 已从 plan 消失，而 `_syncTracksToPlan` 只能在「现存结构」内重排 shot，不能把已删的叙事变回来。成对快照让 undo 直接还原删除前的 plan。`trackUndo`/`trackRedo` 把当前态压入对侧栈，`_restoreSnapshot(entry)` 同时还原 `this.tracks`（+`_hydrateSegments()` 重挂运行时 `_segment`，深拷贝会切断与 `this.segments` 的引用，否则 video 块缩略图/标签显示 `?`）和 `this.project.ai_plan`（`mindMapData` 重算→脑图回到撤销前），再用 `_persistSnapshot()` 直接 PUT tracks+plan（**不走 `_trackSave`/`_syncTracksToPlan`**——那会从 tracks 反推 plan，把刚还原的结构再抹掉）。**脑图编辑也入统一历史栈**：`onPlanChanged()` 开头先 `_trackSnapshot()`（在 PUT/apply 前快照编辑前态；此时 `ai_plan` 尚未被更新，仍是编辑前值），`loadTracks()` 不再 `_resetUndoStacks()`（仅 `load()` 初始加载时整体 reset 一次）。`_cascadeDelete` 内不再单独 snapshot（由 `onPlanChanged` 统一快照，避免重复快照产生无效 undo 卡步）。
- ~~**分割**~~：已移除。ToolBar 原「分割」按钮删除（分割仅此一个入口），`trackSplit()` 方法随之删除。
- **删除**：ToolBar「删除」按钮已移除，但删除仍可通过轨道项右键菜单 + Delete/Backspace 快捷键。`trackDelete()` 对普通块直接移除；对 theme（主旨）/text（叙述）弹 `Quasar.Dialog` 确认后由 `_cascadeDelete(anchor)` 处理——结构性删除直接从 plan 移除对应 act/narrative（theme 用 `metadata.act_id`，text 按 `_narrativeDuration` 累加边界匹配起点），再 `onPlanChanged`（PUT plan + apply + loadTracks），让 theme/text/video 区间由 plan 正确重算（删叙事后所属主旨块缩短该叙事时长）。走 apply 而非 `_syncTracksToPlan`，因后者从残缺 tracks 反推会误算 narrative 边界（被删叙事的 video 已不在）。
- **缩放**：`onTrackItemDown` 仅 video 块在左右边缘进入 resize mode（改 `metadata.srcStart/srcEnd`）；非视频块边缘不进入 resize（时长由 `_normalizeVideoTrack` 跟随 video）。`onTrackItemHover` 只在 video 边缘显示 col-resize 光标。
- 所有编辑操作调用 `_trackSave()` 持久化：先 `_normalizeVideoTrack()` 归一化，`API.updateProjectTracks(id, tracks)` PUT 成功后再调 `_syncTracksToPlan()` 回写脑图（二者错误隔离，plan 回写失败不影响 tracks 已存）

**归一化与缩放联动 `_normalizeVideoTrack()`**：按数组顺序把 video 轨道排成从 0 起的连续段，记录每个段的 `{oldStart, oldEnd, newStart, newEnd}`（`oldEnd` 取归一化前的 `time_end`，即调整前的原始区间）。非 video 轨道按 start 落入某段 `[oldStart, oldEnd)` 命中后，**按比例缩放**映射进 `[newStart, newEnd]`（`scale = newRange/oldRange`，start 和 end 都映射），而非仅平移——这样拖短 video 片段时同区间的 emotion/旁白/字幕/文字块等比缩短。`oldRange≈0` 退化回平移。

**时间线→脑图回写 `_syncTracksToPlan()`**：深拷贝 `mindMapData`，先按当前 plan 的 shot 时长累加算出各 narrative 边界 `[nStart, nEnd)`，再用每个归一化后 video 的 `time_start` 落入区间决定 shot 的新 `act_id`/`narrative_id`（**位置驱动移动**）；按 narrative 重建 shots（按 timeline 顺序，同步 `src_start`/`src_end`，按时间区间匹配同段 emotion→`shot.emotion`、narration→`shot.narration`，匹配 text→`nar.text`，按 `metadata.act_id` 匹配 theme→`act.title`）；无 video 归属的空 shot/narrative/act 移除（删除同步）；`this.project.ai_plan = JSON.stringify(plan)` 触发 `mindMapData` 重算，并 `PUT /api/creative/<id>/plan` 持久化（**不调 apply**——tracks 已是权威源）。仅当存在 `mindMapData` 时执行。

**双向链路（已端到端验证）**：脑图→时间线靠 `apply_plan` 全量重建（时间由 plan shot 的 src 区间累加派生），时间线→脑图靠 `_normalizeVideoTrack`→`_syncTracksToPlan` 顺序执行（normalize 先重写 time_start，sync 再按新位置分配叙事）。两方向都从 0 绝对重算，来回编辑不累积漂移。非视频块的手调时长被禁（时长随所属 video 被动联动），避免其超出 plan 表达力（一个 shot 一个情绪/旁白值）导致 apply 时丢失；分割功能已整体移除。

**选中状态**：`trackSelectedItem` 记录选中轨道项 id，点击轨道项设置，编辑/删除后重置为 null。

### 5.9 导出到剪映

顶栏（`.wb-toolbar`）工程名右侧「导出工程」按钮 → `Quasar.Dialog` 填工程名 → `POST /api/workbench/<pid>/export-fcpxml` → 浏览器 Blob 下载 `<name>.fcpxml` + `<name>.srt` 两个文件。**为什么不用剪映原生草稿**：剪映 6.0+ 对草稿加密（`crypto_key_store.dat`，scheme `jianying_draft_encrypt_v2`），cipher 只在剪映二进制内，pyJianYingDraft 只能生成明文、仅兼容 ≤5.9；用户 10.8.7 打开明文草稿报「已损坏」。故改走开放格式 FCPXML——剪映「导入工程」、DaVinci Resolve、Final Cut Pro 都能直接导入。后端 [fcpxml_export.py](../backend/fcpxml_export.py) `build_fcpxml(pid,name)`：FCPXML 1.10，resources 里 `<format>`（画布跟随首个分镜 ffprobe 尺寸，如 3840×2160）+ 去重的 `<asset>`（file:// 源素材）；sequence/spine 上每分镜一个 `<asset-clip offset=时间线位置 start=src入点 duration=时长>`。时间用微秒有理数 `N/1000000s`。**源点映射**：`metadata.srcStart` = 绝对媒体入点（与 segment.time_start 同坐标系）→ `start`，`track.time_start` → `offset`，`srcEnd-srcStart` → `duration`。`build_srt(pid)` 把字幕/旁白文字导成 SRT（旁白前缀「旁白」）。缺 file_path 的分镜跳过 + warnings。

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
| `/media/cover/<id>` | 音频内嵌封面：非 audio → 404；查 cover_art_path 存在则发送；缺失且源文件在 → 懒提取 + UPDATE 落库（历史音频自动回填）后发送；否则 404 |

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
| `/api/creative/<pid>/plan` | PUT | 保存脑图编辑后的 ai_plan JSON（脑图内联编辑 + 时间线 `_syncTracksToPlan` 回写共用） |

### 9.2.1 脑图分镜拖拽实现要点（mindmap.js）

拖拽交互采用 **FLIP 重排 + 非响应式状态** 组合，避免 Vue 重渲染覆盖直接 DOM 操作：

- **稳定 key**：每个 shot 分配 `_mmid`（watch plan 时分配），v-for 用 `shot._mmid` 而非数组索引。Vue 据此真正移动 DOM 元素，使 FLIP 动画成为可能
- **非响应式拖拽状态**：`_dropHint`（非 `data()` 属性）+ 直接操作 hint 元素的 `style.display/left/src`。拖拽全程不触发 Vue 重新渲染，避免 patch 覆盖 transform/class
- **被拖卡片用 `:class` 绑定**：`.dragging` 通过 `isShotDragging(ai,ni,si)` 响应式绑定，跨重渲染保持（区别于会被擦掉的 `classList.add`）
- **FLIP 重排**：`onFlowDragOver` 中每个卡片按"松手后目标位置"设置 `--tx`（CSS 变量），translate 与 scale 通过 `var(--tx)` 分离，不互相覆盖
- **无缝释放**：`onFlowDrop` 释放前记录视觉位置 → 更新数据（Vue 移动元素）→ `_flipSettle` 在 `$nextTick` 清 stale `--tx` 并对残余 delta 做 FLIP。因拖拽时已就位，delta≈0 无多余动画。`_dropHandled` 标志让 `onDragEnd` 在成功 drop 后跳过 `--tx` 清理

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
| 精简维度 | 发送 AI 导演需要的维度：segment_id, duration, visual(完整), mood, emotions(分布)+派生 arousal/valence, scene_type, shot_type, camera_movement, color_tone, lighting, asr(截断50字), dominant_colors, highlights |
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
