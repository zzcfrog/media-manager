# PRD —— 音乐分析（素材库第三媒体类型）

> 状态：**已确认并实施完成**（2026-08-18；开放问题已全部拍板，见 §七）
> 日期：2026-08-18　　版本：v1.0（原临时 PRD v0.1 定稿）

## 一、背景与目标

产品当前支持图片/视频两类媒体的 AI 分析（云端智谱 + 本地 Qwen3-VL/Omni 双引擎）。本期将**音乐/BGM 升级为第三种一等媒体类型**：导入、浏览、播放、AI 分析（受控标签 + 情绪双轴 + 水印检测）、搜索全链路打通。

**技术底座（已实测验证，2026-08-17/18）**：
- 引擎：Qwen3-Omni-30B（llama-server `input_audio`，本地），3s/60s 段，~900 token/60s——乐器（含民乐精确到古筝/二胡）、人声语言（粤语/日语/中文/英语全中）、情绪、风格识别质量过硬
- 词表：`backend/prompts/music_taxonomy.json` 已定稿——Artlist 标准标签体系 + 扩展集（民乐/中国风/悲壮等 17 条，全部带来源标注）、权重制输出、Russell 唤醒×效价双轴（与视频侧 emotion_labels.py 同尺度）、水印独立维度
- 水印：可逐字转写平台语音水印（"Artlist.io. Music licensing reimagined."），能自动识别试听版

**用户价值**：
1. BGM 库可检索化——按情绪/乐器/场景/能量组合筛选，替代文件名人肉管理
2. 版权风险预警——水印曲自动标记"试听版"，商用前必须替换
3. 为 P2 的配乐匹配（音乐情绪曲线 vs 视频片段情绪曲线）铺路——双轴同尺度已对齐

## 二、用户与场景

- **主用户**：视频创作者（本产品现有用户），管理大量 BGM/歌曲文件
- **核心场景**：
  1. 导入 BGM 目录 → 批量 AI 分析 → 卡片上看到波形+水印标记
  2. 剪辑时找配乐："来一首 宁静为主+中国风+古筝 的曲子" → 筛选/搜索 → 详情页试听 + 看 arousal/valence 曲线判断情绪走向
  3. 检查库里哪些是 Artlist 试听版（带水印）→ 替换或购买

## 三、范围

### P1 本期（已确认全链路）
1. **导入**：音频扩展名识别、ffprobe 元数据、波形缩略图、内嵌封面提取（APIC/covr/FLAC PICTURE/OGG）
2. **素材库**：筛选第四档「音乐」、卡片封面优先（无封面回落波形）、**高级筛选面板**（音乐=显示切换 + 情绪/曲风/乐器/使用画面/人声词表下拉；图片=景别/焦段/视角/透视/场景/光线/天气/风格/色调/影调/景深/构图/颜色/主体/编码/相机品牌/型号/方向/拍摄日期；视频=景别/焦段/视角/运镜/透视/场景/光线/天气/情绪/颜色/主体/相机品牌/型号/方向/分辨率/帧率/时长/色彩空间）、水印角标、批量分析弹窗支持
3. **详情页**：播放器 + 波形 + 分析结果（标签/曲线/分段）+ 元信息
4. **分析**：`music_prompt.txt` + 本地 Omni（分段标签+权重+双轴+水印，两步水印判定）
5. **存储与搜索**：DB 迁移（media_type 加 'audio'）、音乐分段表、FTS 标签搜索
6. **设置**：「音乐分析」tab（引擎+分段参数）
7. i18n zh/en、文档同步

### 明确不做（P2+ 备忘）
- workbench/剪辑构思的音乐轨集成、配乐匹配推荐（曲线对齐）
- BPM 精确值（DSP）、音频指纹/相似音乐、音乐剪辑
- ID3 元数据编辑、云端音乐分析引擎（无现成 API，UI 留占位）

## 四、功能规格

### 4.1 导入（importer.py + config.py）
- `AUDIO_EXTS`：mp3/wav/m4a/flac/ogg/oga/aac/wma/aiff/aif/mp4音频（.mp4/.m4a 含视频轨的按视频导入——**仅纯音频容器**：以扩展名 mp3 等为准；用户库里「_音频.mp4」这类是从视频提取的音频轨，ffprobe 无视频流 → 判 audio，有视频流 → 判 video。判定规则：扩展名在 AUDIO_EXTS，或 ffprobe 仅有音频流）
- 加密格式（.ncm/.kwflac 等）：跳过，导入汇总提示"N 个加密格式已跳过"
- probe：duration/bit_rate/audio_codec/audio_sample_rate/audio_channels + ID3/元标签（title/artist/album，存新列，仅展示不编辑）
- **波形缩略图**：`ffmpeg -filter_complex showwavespic` 生成 320×? PNG，走现有 THUMB_DIR 扁平结构，卡片/后台任务栏复用 `/media/thumbnail/<id>`
- **封面提取**：`_extract_cover_art()` 主用 ffmpeg `-an -map 0:v:0 -frames:v 1 -vf scale=320:-1`（APIC/covr/FLAC PICTURE/OGG picture 通吃），`returncode==0 AND 存在 AND size>100` 守卫防损坏图；exiftool `-Picture/-CoverArt/-PreviewImage` + PIL 兜底；结果存 `cover_art_path` 列 + THUMB_DIR，卡片/详情经 `/media/cover/<id>`（懒生成，历史音频首次访问自动回填）。无封面 → None，保留波形

### 4.2 素材库（gallery.js）
- 筛选条四档：全部/图片/视频/音乐（图标 music_note）
- 卡片：**封面优先**（有封面显示封面，无封面回落波形；封面以现有 16:9 卡 `object-fit:cover` 居中裁剪，不挂 `.portrait` 防正方形封面 contain 留黑边）+ 时长角标 + 音符类型角标 + **水印角标**（分析后且 watermark=有 时显示小标识）+ mood 主标签 chip（分析后）
- **高级筛选面板**：筛选栏「高级筛选」按钮收起/展开（展开独占一行中性浅灰面板、按钮下侧无分隔线平滑相连，有活跃维度高亮；切换类型不自动展开、只刷新 facets），面板内筛选条件 **Office Ribbon 同屏组段布局**（每个分组占一块组段：段内维度下拉**固定上下两行**、段顶小字组名、段间竖分隔线；组段恒单行、放不下横向滚动；字段定宽四字宽、每维带语义小图标、有值时隐藏三角小 × 靠右替换显示），下拉空值居中显示维度标题、有选中值强调显示：
  - **音乐（「音乐特征」1 组段）**：「显示」封面/波形两档（无组段名/无边线，`.engine-toggle` 药丸，**默认封面**，`localStorage` 持久化，不参与 disable 判定；混排视图恒封面优先且切换隐藏；displayOnly 不参与过滤）+ **5 个词表下拉**：情绪 mood / 曲风 genre / 乐器 instrument / 使用画面 theme / 人声 vocals（选项来自 `music_taxonomy.json` 词表，en 值 + zh 显示，独立计数徽标、0 置灰；数据已按词表白名单清洗，无需并入新值）
  - **图片（19 维）**：景别 · 焦段 · 视角 · 透视 · 场景 · 光线 · 天气 · 风格 · 色调 · 影调 · 景深 · 构图 · 颜色 · 主体 · 编码（JPG/RAW/HIF）· 相机品牌 · 相机型号 · 方向（横/竖/方）· 拍摄日期范围
  - **视频（18 维）**：景别 · 焦段 · 视角 · 运镜 · 透视 · 场景 · 光线 · 天气 · 情绪 · 颜色 · 主体 · 相机品牌 · 相机型号 · 方向 · 分辨率档（480/720/1080/2160）· 帧率档（24/30/60/120）· 时长档（短片/中片/长片）· 色彩空间；**任一片段命中即视频命中**
  - 选项 = 标准枚举 + 并入数据新值（带计数）；每维下拉自带 clear ×；活跃维度出现在 Footer 筛选条件标签（音乐值显示 zh 标签）
- 批量分析弹窗：混选含音乐时显示「音乐 N 个」与音乐模型行；右键菜单沿用（「查找相似」对音乐隐藏）

### 4.3 详情页（detail.js 第三分支）
- **主视图**：大波形（全曲，分段按 arousal 着色深浅）+ 播放器（播放/暂停/seek/时间/音量；`<audio>` + `/media/audio/<id>`）
- **情绪曲线**：arousal（0-1）与 valence（-1~+1）双线图，播放标线随动，点击曲线 seek
- **右侧分析侧栏**：
  - 全曲汇总：mood/genre/instrument/video_theme 权重标签 chips（按权重排序、权重%显示）+ vocals/语言 + 能量档 + 水印状态（有则红标"试听版水印"）
  - 分段列表：时间区间 + 该段标签（mood 变化/乐器变化）
- **元信息条**：文件块 + 音频块（编码/采样率/声道/码率/时长）+ 标签块（ID3：标题/艺术家/专辑）
- **进度时间线**（本地引擎 3 步）：引擎启动 → 分段分析（窗口 i/N + 接收字符）→ 合并保存
- **确认弹窗**：引擎（本地 Omni）+ 分段参数（段长）+ 本地免费提示（含水印检测说明）

### 4.4 分析引擎（music_prompt.txt + analyzer.py + analysis.py）
- **prompt**（与 img/video_prompt.txt 同构）：角色「专业音乐分析师」+ 分段规则（按设定段长切分，尾段不足并入或保留）+ 每段字段：`time_start/time_end`（复用 HH:MM:SS.ss）+ `mood/genre/instrument/video_theme`（受控标签+权重，维度内合计 100）+ `arousal`（0-1）+ `valence`（-1~+1）+ `vocals`（6 值）+ `vocals_language`（有歌词才给）+ `watermark`（无/有 + watermark_text 逐字转写）+ `{music_taxonomy}` 词表注入 + 严格 JSON 数组示例
- **两步水印判定**（实测结论：联合判断偶发漏网）：第一次推理逐段识别并转写水印 → 后端聚合时若任一段 watermark=有，曲级标水印；vocals 以"排除水印"口径由 prompt 指令保证 + 后端规则复核（watermark 段的 vocals 若为念白/语言与水印文本同语 → 归纯音乐/无词吟唱复核）
- **全曲汇总由后端聚合**（不额外请求）：权重加权平均 arousal/valence、标签跨段加权聚合取 top、vocals 多数一致
- **调用**：本地 Omni（`ensure` 支持 audio 的模型；音乐分析要求模型 audio=true，设置里模型下拉只列 audio 模型）；逐段流式请求（复用视频分窗的 on_window/usage 累加模式）
- **进度事件**：复用现有 SSE 协议（queued/engine_starting/engine_ready/analyzing(window=i/N)/merging/done）

### 4.5 设置「音乐分析」tab
- 引擎药丸：本地（默认）/云端（占位提示"云端音乐分析引擎即将支持"）
- 本地模型下拉：仅列支持音频输入的模型（Omni 系，复用现有下拉+下载/删除交互）
- 参数：分段时长（15s 省 / 30s 标准 / 60s 粗略）
- 提示：本地免费 + 水印检测说明

### 4.6 数据模型（db.py）
- `media_type` CHECK 加 `'audio'`：SQLite 需表重建迁移（CREATE→COPY→RENAME，保外键与索引）
- media 表新增：`music_title/music_artist/music_album`（TEXT，ID3，可空）——或合并为一个 JSON 列（实施定）
- **新表 `music_segment`**（音乐字段结构与视频分镜完全不同，不塞 media_segment）：
  `id/media_id/time_start/time_end/mood_json/genre_json/instrument_json/theme_json/arousal REAL/valence REAL/vocals/vocals_language/watermark/watermark_text/seq`
- 曲级汇总不落库（查询时聚合自 music_segment），`analysis_status/analysis_model/analysis_date` 复用
- FTS：音乐标签文本（mood/genre/instrument/theme/vocals 词）拼入 media_fts 现有 tags 列（不加列）

### 4.7 serve
- `GET /media/audio/<id>`：原生格式（mp3/wav/m4a/aac/ogg/flac 浏览器支持度不一）——策略：浏览器原生可播的直接 `send_file(conditional=True)`；不可播的（flac/wma/aiff）流式转码 AAC（复用 `_transcode_to_mp4` 模式改纯音频）

## 五、非功能需求
- 性能：3 分钟曲 ≈ 6 段（30s 段），本地 Omni 每段 3-5s + 段间开销 ≈ 1 分钟内完成；波形缩略图 <2s/首
- 成本：本地免费；~500 token/段
- 兼容：DB 迁移可安全重跑（幂等）；旧库无音乐数据零影响

## 六、验收标准
1. 导入用户 BGM 目录（mp3/mp3 含 _音频.mp4/ncm 跳过提示）→ 卡片显示波形
2. 单曲分析 → 详情页标签/曲线/分段/水印（Veils of Ruin 应标"试听版水印"）
3. 批量分析含音乐的混合选择 → 弹窗计数/模型正确
4. FTS 搜「古筝」「史诗」「中国风」命中对应曲目
5. 设置 tab 切段长/引擎；重新分析生效
6. 全流程 zh/en；TODO/PRD/UE/TECH 文档同步

## 七、已确认决策（2026-08-18 用户拍板）
1. ID3 元数据（标题/艺术家/专辑）：**提取并展示**（仅展示，不做编辑）
2. 卡片 mood 主标签 chip：**显示**（分析后显示权重第一的 mood）
3. `.mp4` 双容器：**按流判定**——导入时 ffprobe 检流，仅音频流的 mp4（如「_音频.mp4」）归音乐，有视频流归视频
4. 产品形态（更早确认）：并入素材库（第三媒体类型）、波形缩略图、P1 全链路

## 八、实施计划（已细化，2026-08-18）

依赖：`Step1(DB) → Step2(导入)∥Step3(serve)`；`Step4(引擎层,无依赖)`；`Step5(分析入口)←1+4`；`Step6/7/8(前端)←5，三者可并行`；`Step9 收尾`

| Step | 文件 | 改动要点 |
|---|---|---|
| 1 数据层 | db.py / config.py | media 表重建迁移（CHECK 加 'audio' + music_title/artist/album/summary 四列，sqlite_master 检测幂等 + FK OFF 包裹 + 显式列名 INSERT…SELECT + 索引重建 + 迁移前整库备份）；`CREATE TABLE IF NOT EXISTS music_segment`（mood/genre/instrument/theme_json + arousal/valence REAL + vocals/vocals_language/watermark/watermark_text/seq）；_DEFAULTS 加 music_engine=local/music_model=qwen3-omni/music_segment_sec=30；AUDIO_EXTS + ENCRYPTED_AUDIO_EXTS(ncm 跳过提示) + AUDIO_LIKE_VIDEO_EXTS(.mp4/.m4v 流判定) |
| 2 导入 | importer.py / library.py | `_probe_audio`（ffprobe format.tags ID3 + 音频流，exiftool 兜底）；.mp4/.m4v 按 `_probe` 的 _has_video/_has_audio 布尔判定（零新增子进程）；波形缩略图 `showwavespic`（-ac 1 -ar 8000 降采样，失败回落占位图）；删除链路补 music_segment；list_media 解析 music_summary；scan 返回 rejected 加密文件 |
| 3 serve | serve.py | MIME_MAP 补 9 个音频 MIME；`GET /media/audio/<id>`——原生集(mp3/m4a/wav/ogg/oga/aac/**flac**,Electron Chromium 可播) send_file(conditional=True) 支持 Range；仅 wma/aiff 走 AAC ADTS 流式转码 |
| 4 引擎层 | music_prompt.txt(新) / analyzer.py / local_vlm.py | prompt 草案见下；`load_music_prompt()` 注入 {music_taxonomy}（渲染器读 JSON，单一事实源）；`extract_audio_segment`（复用 :216-228 PCM→wave→base64 六行核心）；`analyze_music`（逐段惰性抽取→请求→净化，照 analyze_video_frames 模式）；`_sanitize_music_segment`（词表白名单+权重归一 100+数值 clamp+时间后端强制）；**local_vlm 加 `acquire_engine/release_engine` 占用协议**（Condition+计数，防视频 8B/音乐 Omni 互相杀进程，等待时上报 engine_waiting） |
| 5 分析入口 | analysis.py | 单条/批量加 audio 分支 → `_process_music`（acquire→ffprobe 时长→N=ceil(dur/seg)→逐段 analyzing(window i/N)→merging→done，finally release）；`_refine_watermark` 两步复核（任一段 Present→曲级标水印；水印段 vocals=念白→按多数表决复核为纯音乐/吟唱+语言清空）；`_aggregate_music`（权重=段时长：标签加权 top5 归一 100、arousal/valence 加权均值 clamp、vocals 多数）；`save_music_segments`（DELETE+INSERT+media.music_summary+_refresh_fts(extra_tags)）；get_analysis audio 分支；delete_analysis 补删；`GET /music-taxonomy` |
| 6 gallery | gallery.js / api.js / index.html | 筛选第四档(music_note)；8 处卡片 type-badge 三态 + mood chip(`music_summary.mood[0]` zh 映射) + 水印角标；批量弹窗三计数三模型行；audioUrl/getMusicTaxonomy |
| 7 detail | detail.js | 第三分支：元信息栏(曲目/音频/文件) + 隐藏原生 `<audio>` + 主区（arousal/valence 双线曲线 canvas 点击 seek → 大波形 arousal 着色复用 loadWaveform/drawWaveform:1401-1485 → 精简控制条照 wb-controls 裁剪含分段色块 tooltip）+ 侧栏（汇总权重 chips + vocals/双轴数值 + 水印警示 + 分段列表只读可点击 seek）；music 阶段表 3 步 + stepMap |
| 8 设置/i18n | index.html / i18n.js | 「音乐分析」tab（蓝本=图片 tab）：引擎药丸(local 默认/cloud 占位 disable) + 模型下拉(仅 audio:true，复用内嵌下载/删除) + 分段时长 15/30/60；settingsForm/load/save 三 key；后台任务栏 music percent 映射；zh/en 约 45 key |
| 9 收尾 | docs | PRD_MUSIC.md 定稿 + USAGE.md + todo.md + 按 §验证方案跑全链路 |

**music_prompt.txt 草案**（完整版见 Plan 产出）：角色「专业音乐分析师」+ 10 字段（mood/genre/instrument/video_theme 受控标签+weight 0-100 维度内合计 100；arousal 0-1；valence -1~+1 附「史诗感≠积极」提示；vocals 6 值；vocals_language 无歌词留空；watermark None/Present；watermark_text 逐字转写）+ `{music_taxonomy}` 渲染块（en(en 中文) 竖线列表）+ 严格约束（英文规范值/权重合计/词表外禁用/背景和声不计 vocals）+ JSON 示例。

**对 PRD 的两处方案级修订**（实施时按此执行）：
1. 全曲汇总从「查询时聚合」改为**冗余存 `media.music_summary` 列**（分析完成时聚合写入；list_media SELECT * 零成本返回，卡片 chip/水印角标免二次查询；重分析覆写，music_segment 明细为事实源）
2. flac 放浏览器原生集（Electron/Chromium 原生可播），仅 wma/aiff 走转码——比 PRD 原文「flac 转码」体验更优（可 seek）

**风险 Top3**：① media 表重建（FK OFF 包裹+显式列名+备份+副本先验，dup_exclusions 重建先例）② llama-server 单实例引擎切换冲突（acquire/release 占用协议，视频音乐混批自然串行化不同模型）③ 模型输出不合规（sanitize 白名单/归一/clamp，时间由后端强制）

## 九、验证方案（阶段门）
1. DB：生产库副本上迁移 → integrity_check + 行数/评分抽样一致 + 二次启动幂等 + 空库 schema 一致
2. 导入：mp3(ID3)/wav/flac/纯音频.mp4/正常.mp4/.ncm → 类型与 ID3 正确、波形 jpg 生成、ncm 进 rejected；sync-folder 往返
3. serve：mp3 Range 206 可 seek；wma AAC 流
4. 引擎：_sanitize 单测（权重 97 归一/词表外丢弃/valence 1.4 clamp）；真实曲 analyze_music；Artlist 试听曲水印两步复核（Present+逐字转写+念白复核）
5. 入口：SSE 事件序完整；DB music_segment/music_summary/FTS MATCH 命中；**并发专项**：视频 8B 分析中启动音乐 → 视频正常完成、音乐等待后接续、llama-server 只重启一次
6. 前端：筛选/卡片/批量/设置/详情（波形着色+双线曲线+三处 seek 联动）/zh-en；最终 E2E：导入→分析→搜索 Epic 命中→批量混选→删除无残留
