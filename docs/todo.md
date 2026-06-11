# TODO

## 已完成：脑图分镜拖拽交互打磨 — FLIP 重排 + 无缝释放（2026-06-11）

打磨脑图视图分镜（shot）的拖拽体验：拖动时兄弟卡片丝滑让出空隙、被拖卡片缩小变虚影并跟随重排、释放时无多余回弹动画。

**改动文件：**
- `frontend/js/mindmap.js` — 拖拽逻辑全面重构：
  - **稳定 key**：watch plan 时给每个 shot 分配 `_mmid`，v-for key 从数组索引 `si` 改为 `shot._mmid`，让 Vue 真正移动 DOM 元素（而非交换内容），这是 FLIP 动画的前提
  - **非响应式拖拽状态**：`dropHint` 从 `data()` 移除，改用非响应式 `_dropHint` + 直接 DOM 操作 hint 元素（显示/隐藏/定位/缩略图），整个拖拽过程不触发 Vue 重新渲染
  - **FLIP 重排模型**：`onFlowDragOver` 中每个卡片（含被拖卡片）都移动到"假设松手后"的目标位置 —— 被拖卡片移到插入点，被跨越的卡片移到被拖卡片原位，其余不动。这样虚影会和其他卡片一起连贯重排
  - **no-op 检测**：同一叙事内、插入位置等于原 shot 位置时不显示空隙（用 `dragState` 索引识别被拖卡片，不依赖可能被 Vue 擦掉的 `.dragging` class）
  - **被拖卡片视觉**：`.dragging` class 改用 Vue `:class` 绑定（`isShotDragging`）+ CSS `opacity:0.3; scale(0.9)`，响应式驱动，跨重渲染保持
  - **hover 详情隐藏**：`onDragStart` 中 `hoverShot=null` 清空悬停详情弹窗（避免遮挡目标位置；因 `.dragging` 改用 `:class` 绑定，设 `hoverShot` 不再擦掉拖拽状态）；`showShotDetail`/`scheduleHideDetail` 拖拽期间跳过
  - **无缝释放**：`onFlowDrop` + `_flipSettle` 用 FLIP 技术 —— 释放前记录视觉位置 → 更新数据（Vue 移动元素）→ 因拖拽时 FLIP 已让卡片就位，delta≈0，无多余回弹动画；`_dropHandled` 标志防止 `onDragEnd` 重复清理
- `frontend/css/main.css` — 分镜卡片改用 CSS 变量分离位移与缩放：
  - `.mm-shot-card` 基础规则加 `transform: translateX(var(--tx,0px))` 和 `transition: transform 0.15s`
  - `.mm-shot-card.dragging` 改为 `opacity:0.3; transform: translateX(var(--tx,0px)) scale(0.9)`（translate 和 scale 通过 `--tx` 分离，JS 只设 `--tx`，不互相覆盖）

**技术要点：**
- **为什么用非响应式**：拖拽时直接操作 DOM（transform/class），若触发 Vue 重渲染，Vue 的虚拟 DOM patch 会覆盖这些直接修改 → 拖拽视觉效果瞬间消失
- **为什么用稳定 key**：数组索引作 key 时 Vue 不移动 DOM 元素只交换内容，无法实现"元素直接就位"的 FLIP 动画
- **为什么用 `--tx` 变量**：translate（JS 控制）和 scale（被拖卡片样式）都作用于 transform，用 CSS 变量分离避免互相覆盖

## 已完成：脑图视图 — 时间线/脑图双视图切换（2026-06-10）

工作台底部面板新增"脑图"视图，以三级层次结构（主旨线→叙事线→分镜）展示创意方案，支持内联编辑、拖拽排序、删除，修改后自动同步到时间线。

**改动文件：**
- `frontend/js/mindmap.js` — **新建**：MindMap 组件（三级层级展示、缩略图、情绪渐变、旁白/音乐/转场标签、内联编辑、HTML5 拖拽排序、删除）
- `frontend/js/workbench.js` — 新增 `bottomViewMode` data（timeline/mindmap 切换）；新增 `mindMapData` computed（解析 `project.ai_plan`）；新增 `onMindMapShotClick`（点击 shot 定位播放器）；新增 `onPlanChanged`（保存 ai_plan → apply → 重新加载）；模板增加 `q-btn-toggle` 切换按钮和条件渲染
- `frontend/css/main.css` — 新增 `.mm-*` 脑图样式（act/narrative/shot 层级、情绪条、sparkline、拖拽反馈、内联编辑、删除按钮 hover 显示）
- `frontend/js/i18n.js` — 新增 20 个 `wb.mm_*` / `wb.view_*` 中英文翻译 key
- `frontend/index.html` — 新增 `<script src="mindmap.js">` 和 `app.component("mind-map", MindMap)`
- `backend/blueprints/creative.py` — 新增 `PUT /<int:pid>/plan` 端点（保存脑图编辑后的 ai_plan）

## 已完成：素材面板 AI 分析按钮（2026-06-09）

工作台素材面板预览区：未分析的视频显示"AI 分析"按钮，已分析的视频分片列表上方显示"重新分析"按钮。分析进度通过全局 bgTasks 进度条展示。

**改动文件：**
- `backend/blueprints/workbench.py` — `GET /api/workbench/<pid>` SQL 增加 `m.analysis_status` 字段
- `frontend/js/workbench.js` — 预览区 sidebar：未分析显示 AI 分析按钮（auto_awesome 图标），已分析显示重新分析按钮（refresh 图标）；新增 `wbAnalyzing` data 和 `analyzeMedia(media)` 方法（SSE 流式分析 + bgTasks 进度跟踪 + 完成后自动 load 刷新数据）
- `frontend/js/i18n.js` — 新增 `wb.analyze/reanalyze/analyzing/analyze_done` 中英文翻译

## 已完成：素材利用率优化 — 多用素材 + 长分片关键时刻（2026-06-09）

两个方向优化素材利用率：Prompt 鼓励多用素材 + 长分片增加关键时刻描述。

**改动文件：**
- `backend/creative_prompt.txt` — 选片原则增强：每叙事 3-8 个镜头（原 2-5）；鼓励多用不同 segment（如 704 片段至少用 100+）；长片段参考 highlights 截取精华
- `backend/blueprints/creative.py` — 取消 visual 描述 100 字截断（发送完整描述）；segment 数据增加 highlights 字段
- `backend/video_prompt.txt` — 新增第 17 维度 `highlights`：超过 20 秒的分片标注 2-4 个关键时刻（time + desc），附带示例
- `backend/db.py` — media_segment 表新增 `highlights` 列 + 迁移
- `backend/blueprints/analysis.py` — INSERT 增加 highlights 字段；`_segment_to_dict` 解析 highlights JSON

**注意：** 已有分片的 highlights 为空，需重新分析才能生成。新分析的素材会自动包含 highlights。

## 已完成：AI 子片段截取 — 提升素材利用率（2026-06-09）

AI 可以指定 segment 的子区间（src_start/src_end），不用整个 segment 从头用到尾。这样同一个长 segment 的不同部分可以分别用于多个镜头，大幅提升素材利用率。

**改动文件：**
- `backend/creative_prompt.txt` — shot schema 新增 `src_start`/`src_end` 可选字段；选片原则增加"充分利用素材"指引（截取 3-15 秒精华片段，同一 segment 不同子区间可复用）
- `backend/blueprints/creative.py` — 组装逻辑读取 shot 的 `src_start`/`src_end`（有则用，无则用完整 segment）；时长从截取区间计算而非完整 segment

## 已完成：轨道顺序调整 — 叙事线移至主旨线下方（2026-06-09）

轨道自上而下顺序调整为：主旨线 → 叙事线 → 情绪线 → 旁白线 → 字幕线 → 视频线（叙事线从第5位移至第2位，紧跟主旨线）。

**改动文件：**
- `frontend/js/workbench.js` — `trackTypes` 数组顺序调整：text 移到 emotion 之前
- `docs/inspiration.md` — 轨道顺序文字 + ASCII 图示更新
- `docs/PRD_CREATIVE_WORKBENCH.md` — 两处 ASCII 图示轨道顺序更新

## 已完成：文字线 → 叙事线 — 概念升级 + 四层创作流程（2026-06-09）

将"文字线"重定义为"叙事线"，建立三层结构：主旨（章节）→ 叙事（段落）→ 分镜（句子）。Prompt 增加四层创作流程（立意→叙事→选片→串联）。JSON Schema 从 `acts → shots` 改为 `acts → narratives → shots`。

**改动文件：**
- `backend/creative_prompt.txt` — 创作原则重写为四层流程（立意→叙事→选片→串联）；JSON Schema 改为三层嵌套（`acts[].narratives[].shots[]`）；每个 narrative 有 `text` 字段（叙事段落文字）；`narration` 字段定位调整为"烘托情绪的旁白文案"
- `backend/blueprints/creative.py` — 组装逻辑改为三层遍历（acts → narratives → shots）；叙事线条目改为 per-narrative（跨多个 shot，时长覆盖整组镜头）；video metadata 增加 `narrative_id`
- `frontend/js/i18n.js` — `"文字线"` → `"叙事线"`，`"Text"` → `"Narrative"`
- `docs/PRD_AI_CREATIVE.md` — 更新组装规则映射表（三层结构）+ 伪代码重写
- `docs/PRD_CREATIVE_WORKBENCH.md` — 轨道描述改为叙事线 + ASCII 图示更新
- `docs/TECH_DESIGN.md` — 技术映射更新为三层结构
- `docs/inspiration.md` — 轨道名称和描述全部更新

**DB key `track_type='text'` 保持不变**，仅 UI 标签改名，避免数据迁移。

**三层结构：**
- 主旨（act）= 章节：每幕一个条目，跨多个叙事段落
- 叙事（narrative）= 段落：一组连贯的镜头（2-5个），有独立的叙事文字
- 分镜（shot）= 句子：单个视频片段，有旁白、情绪、转场

**四层创作流程：**
1. 立意：创意描述 + 素材分析 → 确定主旨（幕结构）
2. 叙事：主旨细化 → 每幕拆分为叙事段落（连贯表述）
3. 选片：叙事 + 时间线 + 用户偏好 → 选择匹配的 segment
4. 串联：情绪弧线 + 编排设计 → 撰写旁白 + 设计转场

## 已完成：分片拖放限制 + 拖拽预览图（2026-06-08）

素材分片只能拖放到视频轨道，拖拽时显示缩略图预览。

**改动文件：**
- `frontend/js/workbench.js` — `onSegDragStart` 新增 `_extDragType = 'segment'` 标记和自定义拖拽预览图（`setDragImage` 80×50px 缩略图）；`onMatDragStart` 新增 `_extDragType = 'media'`；`onTrackDragOver` 非视频轨道对 segment 直接 return（不调 `e.preventDefault()`，浏览器显示禁止光标）；`onTrackDrop` 非视频轨道对 segment 直接 return；`onTrackDrop` 结束时清理 `_extDragType`

## 已完成：时间线拖放闪动修复（2026-06-08）

素材片段拖放到时间线时，主视频时间线闪动、片段间空隙跳动。

**根因：**
1. **HTML5 `dragleave` 子元素穿透**：`@dragleave="clearDragShift()"` 在鼠标移入子元素（.wb-track-item）时也触发父元素的 dragleave，导致每次经过一个片段就清除所有 transform，再由 dragover 重新设置 → 持续清除/重设循环 = 频繁抖动
2. `onTrackDragOver` 每次都调用 `clearDragShift()` 清除**所有轨道**的所有项，远超必要范围
3. 拖拽过程中使用 CSS transition `0.15s ease`，配合高频 dragover 事件（~60次/秒）形成不完整动画 → 视觉抖动
4. `_normalizeVideoTrack()` 无条件重写所有项触发响应式级联；空 deep watcher 增加开销；`timelineDuration` 不稳定

**改动文件：**
- `frontend/js/workbench.js` — 新增 `onTrackDragLeave(e)` 替代 `@dragleave="clearDragShift()"`，用 `relatedTarget` 判断是否真正离开轨道；`onTrackDragOver` 重写为定向更新（只改 transform 变化的项，不用 transition）；`onTrackDrop` 视频轨道修复：计算 dropSec 和 insertIdx，在正确位置 splice 插入新片段而非 push 到末尾，`_normalizeVideoTrack()` 自动重排位置并联动其他轨道；移除空 deep watcher；`_normalizeVideoTrack()` 加 guard；`timelineDuration` 取整稳定；`clearDragShift()` 重置 `_lastDragLane`

## 已完成：时间线拖拽动画 + 右键菜单 + 快捷键（2026-06-07）

时间线编辑交互增强：拖拽/缩放实时动画、右键删除菜单、Delete/Backspace 快捷键、片段拖放到时间线的插入动画。

**改动文件：**
- `frontend/js/workbench.js` — `_handleDragMove()` 增加 reorder 动画（拖拽时兄弟元素移位显示插入空隙）和 resize push 动画（右边缘拖拽时后续所有轨道块平移）；`onTrackDragOver()` 新增外部拖放插入动画（片段从素材面板拖入时后续块让出空隙）；`clearDragShift()` 清除所有动画 transform；`onTrackItemContext()` 右键菜单（Quasar q-menu context-menu）；`_onWbKey` 增加 Delete/Backspace 删除快捷键；`onSegDragStart/onMatDragStart` 存储 `_extDragDur` 供拖放动画使用
- `frontend/js/i18n.js` — 新增 `wb.ctx_delete` 中英文翻译
- `frontend/css/main.css` — 无额外 CSS（动画通过 JS inline style + transition 实现）

**功能说明：**
- Reorder 动画：向后拖时，中间的块前移让出空隙；向前拖时同理
- Resize push 动画：右边缘拖长时，后续所有轨道块实时平移
- 拖放插入动画：从素材面板拖片段到时间线时，后续块让出空隙
- 右键菜单：轨道项右键弹出「删除」选项
- Delete/Backspace：选中轨道项后按键盘删除

## 已完成：视频轨道编排重构 — 左对齐 + Resize + Reorder（2026-06-07）

视频轨道时间线位置改为派生数据（数组顺序 + srcEnd-srcStart），resize 更新源视频截取范围，reorder 使用数组顺序而非 time_start 排序。

**改动文件：**
- `frontend/js/workbench.js` — 新增 `_getVideoDur()` 辅助函数（从 metadata.srcEnd-srcStart 取时长，fallback 到 time_end-time_start）；`_normalizeVideoTrack()` 重写（用数组顺序而非 time_start 排序、用 srcEnd-srcStart 算时长）；`_handleDragEnd()` resize 模式重写（视频轨道更新 metadata.srcStart/srcEnd，受源视频边界约束；其他轨道更新 time_start/time_end）；`trackSplit()` 更新（视频轨道分割 srcStart/srcEnd）；`onTrackDrop()` 简化（视频轨道只设 metadata，归一化自动处理位置）；`addTrackItem()` 更新（视频轨道设默认 srcStart/srcEnd）

**设计原则：**
- 视频轨道 `time_start/time_end` 是派生数据——由数组顺序 + `metadata.srcEnd - srcStart` 计算
- Resize 更新 `srcStart/srcEnd`，受源视频边界约束（≥0, ≤duration）
- Reorder 改变数组顺序，归一化用数组顺序
- 其他轨道独立存储 `time_start/time_end`，可与视频项联动
- `segment_id` 保留为原始分析数据引用（重新分析后可能断，不影响播放）
- 所有文本内容独立存储在 `content` 列

## 已完成：LLM 分片时间重叠修正（2026-06-06）

LLM 返回的分析分片（media_segment）在时间上可能重叠，保存前自动修正：按 start_time 排序后，若后一分片的 start < 前一分片的 end，则将后一分片的 start 设为前一分片的 end，逐级顺延，确保无间隙无重叠。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `_ts_to_seconds()` 辅助函数（HH:MM:SS.ss → 秒数）；新增 `_fix_segment_overlaps()` 函数（按时间排序 + 级联修正重叠 start_time）；`save_segments()` 在插入前调用 `_fix_segment_overlaps(segments)`

**功能说明：**
- 所有轨道（视频/情绪/旁白/字幕/主题/文字）共用同一份 `media_segment` 时间戳，修正在源头，下游无需改动
- 创意向导 `apply_plan()` 读取的 segment 时间已无重叠，`srcStart`/`srcEnd` 直接可用
- 修正后分片严格连续：`segments[i].time_start == segments[i-1].time_end`

## 规划中：AI 创意引导器 Phase 2

### Phase 2：智能交互增强
- [ ] 单段落 AI 重新生成
- [ ] AI 推荐替换镜头
- [ ] 大纲面板段落拖拽重排
- [ ] 情绪弧线可视化编辑
- [ ] AI 补充/精简段落

### Phase 3：高级功能
- [ ] 参考视频解构
- [ ] 自定义模板保存
- [ ] 多方案对比
- [ ] 版本分支
- [ ] 导出创意简报

## 已完成：合并构思与编排 + Ctrl+A 全选 + 项目创建推迟（2026-06-03）

合并侧边栏「构思」和「编排」为一个统一项目列表，新增 Ctrl+A 全选素材，项目创建推迟到引导器最后一步。

**改动文件：**
- `backend/blueprints/workbench.py` — `GET /api/workbench/` 去掉 `creative_brief IS NULL` 过滤，返回所有项目
- `backend/blueprints/library.py` — 新增 `POST /api/library/segment-stats`（接受 media_ids 数组，无需项目即可查询片段统计）；新增 `_parse_seg_time` helper
- `backend/blueprints/creative.py` — `get_stats` 新增 `video_count` / `image_count` 字段
- `frontend/index.html` — 侧边栏合并为一个「构思」板块（`projectList`），删除「编排」板块及其新建工程弹窗；`openNewCreativePlan()` 不再预创建项目；`wizardEditProjectId` data 支持工作台编辑模式
- `frontend/js/creative-wizard.js` — 移除 `projectId` prop，新增 `editProjectId` prop；`loadStats()` 改用 `API.getSegmentStats()`；`startGenerate()` 区分新建和编辑模式，新建时才创建项目；新增 `skipAndCreate()` + 每步 footer「跳过并创建」按钮；新增 `loadEditProject()` 预加载已有项目；名称输入移入第6步确认区；选完素材自动跳第2步；引导器改为 90% 尺寸；stats 显示视频数/图片数
- `frontend/js/workbench.js` — 工具栏新增「AI 构思」按钮 + `openWizard()` 方法唤起引导器编辑模式
- `frontend/js/gallery.js` — 新增 Ctrl+A 全选：`_buildParams()` 提取共享筛选逻辑，`selectAll()` 调 `getLibraryIds` 一次拿所有匹配 ID，`deselectAll()` 清空，再次 Ctrl+A 反选
- `frontend/js/api.js` — 新增 `getSegmentStats(mediaIds)` 和 `getLibraryIds(params)`
- `frontend/js/i18n.js` — 新增 wb 工具栏/错误/搜索、g 后台任务状态、cg 音乐风格/生成失败/跳过/统计等 i18n key（中英文各约 30 个）
- `frontend/css/main.css` — `.cg-wizard-card` 高度改为 100%；新增 `.cg-stats-inline` 样式
- `frontend/js/duplicates.js` — `onLassoMove` 中 `const t` 改名 `top`

**功能说明：**
- 侧边栏只有一个项目列表，图标根据是否有 AI 方案区分（auto_awesome / dashboard）
- 「新建构思」直接弹出素材选择器，不再预创建项目，中途关闭无垃圾数据
- 引导器每步可「跳过并创建」快速创建空项目进入工作台
- 工作台工具栏「AI 构思」按钮可重新唤起引导器，预填已有素材，重新 AI 生成
- Ctrl+A 全选匹配当前筛选条件的所有素材（不限已加载数量）
- stats 统计不依赖项目，直接查 media_segment

## 已完成：i18n 硬编码修复 + 基本错误修复（2026-06-02）
- `frontend/js/i18n.js` — 新增 30+ 个 i18n key（wb 搜索/列/工具栏/错误、g 后台任务状态、cg 音乐风格/生成失败）；清理重复 `wb.media_selected` key
- `frontend/js/creative-wizard.js` — `genSteps` 改用 `labelKey` + `t()`；`moodOptions`/`musicStyleOptions`/`tempoOptions` 改用 `labelKey`；错误消息改用 `t('cg.gen_fail')`；`loadSelectedInfo` 改为按 ID 逐个拉取（修复仅拉前 200 条的问题）；`<cg-stats-panel>` 替换为内联渲染
- `frontend/js/workbench.js` — 搜索 placeholder、列标签、全屏/示波器 tooltip、工具栏按钮 tooltip（撤销/重做/分割/删除/缩放）、错误通知全部改用 `t()` 调用
- `frontend/js/api.js` — 默认错误消息改用 `t('g.request_fail')`；`importBatch`/`syncFolder` 增加 HTTP 错误检查
- `frontend/js/duplicates.js` — `onLassoMove` 中 `const t` 改名 `top`，避免遮蔽 i18n `t()`
- `frontend/index.html` — 后台任务轮询状态标签改用 `t()` 调用；修复 `for (const t of tasks)` 遮蔽 i18n `t()` 导致恢复任务时报错
- `frontend/css/main.css` — 新增 `.cg-stats-inline` 样式

**修复的错误：**
1. **[高] index.html `t` 变量遮蔽**：`for (const t of tasks)` 遮蔽了全局 `t()` 函数，导致恢复后台任务时 `stageLabel` 为 undefined 并抛出运行时错误
2. **[高] cg-stats-panel 组件未定义**：引导器第3-5步使用 `<cg-stats-panel>` 但组件从未注册，统计信息不显示。替换为内联渲染
3. **[中] api.js SSE 端点无错误处理**：`importBatch`/`syncFolder` 用原始 `fetch()` 跳过 `_fetch` 错误检查，服务端返回 4xx/5xx 时静默失败
4. **[中] loadSelectedInfo 仅拉前200条**：选中的素材如果不在前 200 条结果中，引导器第1步不显示已选素材。改为按 ID 逐个拉取
5. **[低] duplicates.js `t` 变量遮蔽**：套索选择 `onLassoMove` 中 `const t` 遮蔽 i18n 函数（当前无报错，潜在风险）

## 已完成：引导器第1步复用全局素材选择器（2026-06-02）

引导器第1步改为自动弹出全局素材选择器（90%弹窗），选中后返回引导器显示已选素材摘要。

**改动文件：**
- `frontend/js/creative-wizard.js` — `<q-dialog v-if="!pickerOpen">` 在 picker 打开时销毁引导器避免遮挡；watch `show` 时 `$nextTick(() => this.openPicker())` 自动弹出；`openPicker()` 设置 `pickerOpen=true`，callback 重置；取消选择也通过 callback 正常返回
- `frontend/index.html` — `cancelPicker()` 增加 `_pickerCallback` 调用，确保用户取消 picker 后引导器正常恢复

## 已完成：AI 创意引导器 Phase 1 — 侧边栏 + 数据模型 + 引导器骨架（2026-06-01）

侧边栏新增「构思」板块，后端 creative 蓝图 API，前端 5 步引导器组件骨架。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `creative_brief`、`ai_plan` 两列；`_migrate()` 新增 `projects` 表列检查
- `backend/blueprints/creative.py` — **新建**：创意引导器 API 蓝图（7 个端点：CRUD + brief 更新 + 素材统计 + AI 生成 SSE + 方案应用）
- `backend/__init__.py` — 注册 creative 蓝图（`/api/creative`）
- `backend/creative_prompt.txt` — **新建**：AI 导演 Prompt 模板（角色定义 + 创作原则 + 输入输出 Schema）
- `frontend/js/api.js` — 新增 7 个 creative API 方法
- `frontend/js/creative-wizard.js` — **新建**：5 步引导器组件（选模板→叙事结构→情绪弧线→声音设计→确认生成），含 SSE 流式进度展示
- `frontend/js/i18n.js` — 新增 `cg.*` 翻译键（中英文各约 80 个）
- `frontend/index.html` — 侧边栏插入「构思」板块（between 浏览 and 编排）；新增 creative-wizard 对话框；`openNewCreativePlan()` 弹窗输入名称→创建项目→打开引导器；`loadCreativePlans()`/`onCreativeDone()` 方法；`creativePlans`/`showCreativeWizard`/`wizardProjectId` 数据
- `frontend/css/main.css` — 新增 `.cg-*` 引导器样式（模板卡片、选项芯片、弧线选择、确认摘要、生成进度等）

**功能说明：**
- 侧边栏三个板块：浏览 → 构思 → 编排
- 「新建构思」按钮 → 弹窗输入名称 → 创建项目 → 打开 5 步引导器
- 引导器收集创作意图（模板/结构/弧线/声音/确认），每步可查看素材统计
- 确认后 SSE 流式调用大模型生成方案，自动组装时间线
- 生成完成后跳转到工作台页面
- 构思项目同时出现在「构思」和「编排」列表中

## 已完成：工作台时间线工具栏（2026-05-31）

时间线上方新增工具栏，包含播放控制、编辑操作、缩放和添加轨道功能。

**改动文件：**
- `frontend/js/workbench.js` — 新增 track toolbar 模板（播放控制：跳到开头/播放暂停/跳到结尾/倍速选择；编辑：撤销/重做/分割/删除；缩放：缩小/滑块/放大/适配宽度；添加轨道菜单）；`trackPlaying`/`trackSpeed`/`trackZoom`/`trackCanUndo`/`trackCanRedo`/`trackSelectedItem` 数据；`trackTogglePlay`/`trackSkipStart`/`trackSkipEnd` 联动视频播放器；`trackSpeed` watch 同步 `playbackRate`；`trackZoom` 缩放轨道内容（scaleX + minWidth）；`_trackSnapshot`/`trackUndo`/`trackRedo` 撤销重做栈；`trackSplit` 分割轨道项（中点切分）；`trackDelete` 删除选中项；`addTrack(type)` 添加空轨道；轨道项点击选中高亮
- `frontend/css/main.css` — `.wb-track-toolbar` 工具栏样式（flex + gap 8px + border-bottom）；`.wb-track-item.selected` 选中态（accent outline）

**功能说明：**
- 播放控制联动预览区视频播放器（跳到开头/结尾、播放/暂停、倍速 0.5x-2x）
- 缩放滑块 1-10x，通过 scaleX 放大轨道内容并可横向滚动
- 撤销/重做栈（JSON 快照），编辑操作自动入栈
- 分割：将选中轨道项从中点一分为二
- 删除：移除选中轨道项
- 添加轨道：下拉菜单选择轨道类型（主题/情绪/旁白/字幕/文字/视频）
- 所有修改通过 `API.updateProjectTracks` 持久化

## 已完成：UI 主题统一 + 列表视图优化 + 目录树样式（2026-05-29）

全局 UI 控件统一跟随主题色，列表视图列名和颜色标签修复，目录树改为 VS Code 风格竖线缩进。

**改动文件：**
- `frontend/css/main.css` — 移除所有硬编码颜色值，改为 CSS 变量（`--accent`、`--accent-dim`）；新增 `.sidebar-active-item`（accent-dim 背景 + accent 文字）；`.media-row .color-dot` 改为 `position: static; display: inline-block`；`.grid-compact .media-card .info { display: none }`（50% 缩放隐藏卡片文字）；`.q-tree__children { padding-left: 9px; border-left: 1px solid var(--border); margin-left: 13px }` VS Code 风格竖线；叶节点 `padding-left: 22px` 箭头占位；统一 hover/selected 高亮到 `q-tree__node-header`；`.media-card { content-visibility: auto }` 渲染优化
- `frontend/js/gallery.js` — 视图模式按钮 active 色改为 `var(--accent)`；footer 滑块 `style="--q-primary:var(--accent)"` 跟随主题；列表视图标记列宽 110px；50% 缩放添加 `grid-compact` class；文件夹筛选标签显示完整路径；`_checkFill()` + `requestAnimationFrame` 自动加载更多（小缩放时内容不填满容器时触发）
- `frontend/js/i18n.js` — `g.col_rating` 改为"标记"
- `frontend/js/folder-tree.js` — 移除内联 padding/margin/background，统一到 CSS；移除自动展开 watch，默认折叠
- `frontend/index.html` — 侧边栏三个子项使用 `active-class="sidebar-active-item"`；目录树 padding-left 从 28px 改为 16px（与浏览标题对齐）；文件夹根目录与素材库菜单对齐
- `backend/config.py` — 新增 `ANALYSIS_API_CONCURRENCY = 2` 和 `ANALYSIS_THREAD_POOL_SIZE = 5`
- `backend/blueprints/analysis.py` — 从 config 导入并发参数替代硬编码

**功能说明：**
- 所有 UI 控件（筛选栏选中态、侧边栏、footer 滑块、工作台按钮）统一跟随用户选择的主题色
- 列表视图"评分"列改名为"标记"，列宽加至 110px，颜色标签位置修复
- 目录树：VS Code 风格淡色竖线缩进，叶节点箭头位置占位，选中与悬浮高亮区域统一，默认折叠不展开
- 侧边栏浏览子项与"浏览"标题左对齐，文件夹根目录与"素材库"对齐
- 50% 缩放隐藏卡片文字（紧凑模式），文件夹筛选标签显示完整路径
- 分析并发参数（VLM API 信号量 2、线程池 5）移至 config.py 集中配置

## 已完成：工作台素材面板改版（2026-05-29）

工作台素材面板从 segment 列表改为以完整视频（media）为单位展示，新增搜索、类型筛选、排序功能。

**改动文件：**
- `frontend/js/workbench.js` — data 改为 `selectedMedia`/`activeSeg`/`matSearch`/`matType`/`matSort`；computed `filteredMedia()` 应用类型筛选和排序；`searchMedia()` 调用后端 FTS 搜索；`mediaSegments(mediaId)` 筛选指定 media 的 segments；`fmtDur(sec)` 时长格式化（M:SS 或 H:MM:SS）；素材面板模板改为双列网格卡片（封面 + 渐变叠加信息层）；预览区显示视频播放器 + segment 列表
- `backend/blueprints/workbench.py` — `get_project` 新增 `q` 参数，通过 FTS5 搜索 media（复用 `_segment_query`），SELECT 新增 `m.date_taken` 支持排序
- `frontend/js/api.js` — `getProject(id, q)` 支持 search 参数
- `frontend/js/i18n.js` — 新增 `wb.*` 翻译键（搜索/类型/排序/无匹配等）
- `frontend/css/main.css` — `.wb-mat-toolbar` 一行紧凑布局；`.wb-mat-search`/`.wb-mat-sort` 高度 26px；`.wb-mat-grid` 双列网格；`.wb-mat-card`/`.wb-mat-thumb`/`.wb-mat-overlay` 封面卡片样式

**功能说明：**
- 素材面板以完整视频为单位（缩略图 + 文件名 + 时长 + 片段数），双列网格布局
- 工具栏一行紧凑排列：搜索框 + 类型筛选 + 排序下拉（高度 26px）
- 搜索走后端 FTS5（支持文件名 + 分析内容模糊搜索，jieba 中文分词）
- 支持按类型筛选（全部/视频/图片）、按名称/时长/拍摄时间排序
- 点击视频卡片预览播放，下方显示该视频的所有 segments
- 时长显示 HH:MM:SS 格式

## 已完成：工作台媒体选择器 — 90% 对话框方案（2026-05-27）

工作台"添加素材"改为 90% 屏幕对话框（90vw x 90vh），内嵌完整 Gallery 页面，独立文件夹处理器避免 hash 变更和无限请求。

**改动文件：**
- `frontend/index.html` — 新增 `q-dialog` 媒体选择器（persistent，fade 过渡），内含 picker-bar（关闭/标题/已选计数/确认按钮）+ picker-body（左侧文件夹树 + 右侧 gallery-page 组件）；新增 `pickerFolderSelect()` 方法独立处理文件夹选择（仅更新 selectedFolder + 触发 pickerGallery.load()，不触发 hash 变更）；新增 `cancelPicker()`/`confirmPicker()` 方法；新增 `pickerMode`/`pickerProjectId`/`pickerSelected` 数据
- `frontend/js/workbench.js` — `openMediaPicker()` 设置 root 数据并打开对话框
- `frontend/css/main.css` — 新增 `.picker-dialog-card`（90vw x 90vh，flex column）、`.picker-bar`（42px 顶部栏）、`.picker-body`（flex row）、`.picker-sidebar`（220px）、`.picker-gallery`、`.picker-check`（卡片复选框覆盖层）样式

**设计要点：**
- 文件夹树使用 `pickerFolderSelect` 而非共享的 `onFolderSelect`，避免触发路由 hash 变更和无限请求
- 嵌入完整 `gallery-page` 组件复用所有筛选/排序/视图功能，每张卡片叠加选择复选框
- 对话框 persistent（点击背景不关闭），fade 过渡动画

## 已完成：创作工作台 Phase A — 工程管理 + 工作台骨架（2026-05-27）

创作工作台基础架构：后端工程 CRUD API、侧边栏"编排"导航、新建工程弹窗、工作台页面骨架（6 轨时间线 + 素材面板）。

**改动文件：**
- `backend/db.py` — `_SCHEMA` 新增 `projects`、`project_media`、`project_tracks` 三张表及索引
- `backend/blueprints/workbench.py` — **新建**：工程 CRUD（GET/POST/PATCH/DELETE）、获取工程 segments（join project_media → media_segment）、获取/批量替换 tracks、替换 media 集合
- `backend/__init__.py` — 注册 workbench blueprint（`/api/workbench`）
- `frontend/js/api.js` — 新增 9 个 workbench API 方法
- `frontend/js/i18n.js` — 新增 `wb.*` 翻译键（中英文各 ~25 个）
- `frontend/js/workbench.js` — **新建**：`WorkbenchPage` 组件，props `projectId`，加载工程/segments/tracks，渲染素材面板 + 6 轨时间线
- `frontend/index.html` — 侧边栏新增"编排"区域（工程列表 + 新建按钮）、路由 `#/workbench/:id`、新建工程弹窗（名称/描述/素材选择）、重命名/删除弹窗、右键菜单
- `frontend/css/main.css` — 新增 `.wb-*` 工作台样式（容器/工具栏/素材面板/轨道/状态栏）

**功能说明：**
- 侧边栏"浏览"区域下方新增"编排"区域，列出所有工程，按最近更新排序
- 点击"+ 新建工程"打开弹窗：输入名称、描述、从素材库勾选已分析的素材
- 创建后自动跳转工作台页面，显示左侧素材面板（所有 segment）+ 右侧 6 条空轨道
- 工程支持右键菜单重命名/删除
- API 支持：工程 CRUD + 获取 segment + 获取/批量替换轨道 + 替换 media 集合

**待开发（Phase B-E）：**
- [ ] Phase B：拖拽 segment 到视频线 + 轨道内重排 + 删除
- [ ] Phase C：情绪线手动标注 + SVG 曲线渲染
- [ ] Phase D：其他轨道编辑（主题/旁白/文字/字幕）
- [ ] Phase E：EDL 导出

## 已完成：批量AI分析 + 三态筛选 + 筛选/任务持久化 + HIF支持 + UI优化（2026-05-22）

批量 AI 分析从画廊发起，三态筛选支持未喜欢/未分析，筛选条件和后台任务刷新后持久化，HIF 图片格式支持。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `POST /api/analysis/batch` 端点（接收 ID 数组 + skip_done 策略，复用 `_analysis_pool` 线程池提交）；`_analysis_lock` 替换为 `Semaphore(1)` 信号量（VLM API 调用串行，压缩/ASR 并行）；processing 状态防重复提交；`/api/analysis/progress` 返回 `file_name` 字段
- `backend/blueprints/library.py` — `list_media` 新增 `favorite=false` 和 `analysis_status=not_analyzed` SQL 筛选
- `backend/config.py` — 新增 `HEIF_EXTS`（.heic/.heif/.hif/.avif），从 `RAW_EXTS` 排除
- `backend/compressor.py` — 新增 HEIF 解码路径（`pillow-heif`）
- `backend/analyzer.py` — 图片分析流式 chunk 日志从 debug 降为 trace
- `backend/asr/engines/whisper.py` — 新增 `preload()` 方法含完成日志
- `frontend/js/gallery.js` — 右键菜单新增"AI 分析"；`openBatchAnalysisDialog()` 获取设置显示模型/数量/已分析策略；`confirmBatchAnalysis()` FLIP 动画；`batchAnalyze()` 调用批量接口 + 注册 bgTasks；三态筛选 `cycleFavFilter()`（null→fav→unfav）和 `cycleAnalysisFilter()`（null→analyzed→not）；`activeFilterTags` 计算属性返回标签数组；footer 显示筛选标签；localStorage 持久化所有筛选/排序/视图状态；`created()` 恢复筛选 + 同步 `$root.searchQuery`
- `frontend/js/api.js` — 新增 `startBatchAnalysis(ids, skipDone)` 和 `getProgress()` 方法
- `frontend/js/detail.js` — SSE done/error 回调用 `root.bgTasks = [...root.bgTasks]` 触发 Vue 响应式
- `frontend/js/i18n.js` — 新增翻译：ctx_analyze/n、batch_analysis 系列标题、fav_filter/unfav_only/analysis_filter/not_analyzed_only/filter_unfav/filter_not_analyzed 等
- `frontend/index.html` — bgTasks 进度条改为自定义 div（var(--accent) 色）+ "done/total" 标签 + 24px Lottie；`created()` 恢复 bgTasks（调 `getProgress()`）；`created()` 恢复 `selectedFolder`（localStorage）；`watch: selectedFolder` 自动持久化；`resolveRoute()` 默认分支不清除已恢复的 folder；`loadSidebar()` 展开恢复 folder 的祖先路径；bgTasks 过滤 placeholder 的 computed 属性
- `frontend/css/main.css` — `.bg-task-bar/lottie/progress` 进度条样式；`.header-tag` footer 筛选标签样式；`.filter-icon-off` CSS 伪元素斜杠（45° 旋转，box-shadow 穿透效果，暗色 #555/亮色 #bbb）
- `electron/main.js` — 初始宽度从 1400 改为 1600

**功能说明：**
- 画廊右键菜单支持单个/多个素材批量 AI 分析，确认弹窗显示模型、数量、已分析策略
- 确认后 FLIP 动画从弹窗缩放到 header 进度条位置
- 后端信号量控制并发（API 调用串行，压缩/ASR 可并行），processing 状态防止重复提交
- 喜欢/分析筛选扩展为三态（全部/已喜欢/未喜欢、全部/已分析/未分析），CSS 伪元素斜杠标识"排除"语义
- Footer 居中显示当前所有筛选条件标签（文件夹/类型/评分/颜色/喜欢/分析/搜索）
- 所有筛选条件、排序、视图、文件夹选择 localStorage 持久化，刷新页面完整恢复
- 后台分析任务刷新页面后从后端 `/api/analysis/progress` 恢复进度
- HIF/HEIF 图片通过 `pillow-heif` 解码分析，日志降噪
- ASR 模型预加载完成时打印耗时日志

## 已完成：loguru 统一日志 + 图片分析维度扩展 + UI 修复（2026-05-20）

全后端迁移至 loguru 日志系统，图片分析新增 3 个专属维度，前端分析结果 UI 优化。

**改动文件：**
- `backend/logger.py` — **新建**：loguru 日志配置，文件输出至 `{DATA_DIR}/logs/app.log`，按天轮转保留 7 天，同时输出到终端；Werkzeug HTTP 日志静默（WARNING 级别）
- `backend/__init__.py` — 启动时调用 `setup_logging()` 初始化日志；新增 ASR 预加载逻辑（仅本地引擎）
- `backend/analyzer.py` — `print`/`logging` 全部替换为 `loguru.logger`；流式 chunk 调试日志用 `repr()` 包裹；图片分析结果完整 JSON 输出；修复 `ensure_ascii=False` 缺失
- `backend/analyzer.py` — 全部 `print`/`logging` 替换为 loguru
- `backend/asr/__init__.py` — `logging` 替换为 loguru
- `backend/asr/engines/whisper.py` — `logging` 替换为 loguru；`preload()` 直接加载不再额外开线程，加载完成打日志含耗时
- `backend/blueprints/analysis.py` — `logging` 替换为 loguru；`_SEGMENT_COLS` 新增 `color_tone, tone, dof, style, composition`；INSERT 扩展至 23 列；`_EDITABLE_COLS` 新增 5 个字段；修复 `ensure_ascii=False` 缺失；分析弹窗模型显示区分图片/视频
- `backend/blueprints/library.py` — `logging` 替换为 loguru
- `backend/blueprints/serve.py` — `logging` 替换为 loguru
- `backend/blueprints/tags.py` — `logging` 替换为 loguru
- `backend/compressor.py` — `print` 替换为 loguru
- `backend/config.py` — 新增 `LOG_DIR`
- `backend/db.py` — `media_segment` 表 schema 新增 `color_tone, tone, dof, style, composition` 列；`_MIGRATIONS` 新增对应迁移项；`_migrate()` 改为检查 `media` 和 `media_segment` 两张表
- `backend/services/embedding.py` — `logging` 替换为 loguru
- `backend/services/importer.py` — `logging` 替换为 loguru
- `backend/services/xmp_writer.py` — `logging` 替换为 loguru
- `backend/img_prompt.txt` — 枚举格式与 video_prompt.txt 对齐；`shot_type` 扩展；`mood` 新增壮丽/孤独/怀旧/梦幻；`weather` 新增多云；`scene_type` 新增晨昏/星空；`style` 扩展至 15 项；新增 `color_tone`（色调）、`tone`（影调）、`dof`（景深）3 个图片专属维度
- `backend/video_prompt.txt` — `mood`/`weather` 枚举与 img_prompt 对齐；`scene_type` 新增晨昏；`weather` 移除晨昏
- `frontend/js/detail.js` — 新增 `styleFields` 数组和 🎨 风格化 dim-row 分组；`dimRowStyle(seg)` 辅助方法；分析弹窗模型根据 media_type 区分 image_model/model；auto-scroll 修复（Quasar `setScrollPosition` 三参数）；颜色/主体标签图标拆分为独立 span（🌈/🏷️）
- `frontend/js/i18n.js` — 新增翻译：`d.dim.color_tone`、`d.dim.tone`、`d.dim.dof`、`d.dim.style`、`d.dim.composition`；颜色/主体标签移除内嵌 emoji
- `frontend/css/main.css` — 风格化维度颜色（`.dim-value.color/.tone/.dof/.style/.comp`）；`.array-label.icon-label` + `.label-icon` 图标间距控制
- `frontend/index.html` — `onLanguageChange` 方法实现语言切换即时生效

**功能说明：**
- loguru 统一全后端日志，文件按天轮转保留 7 天，终端同步输出，Werkzeug HTTP 日志静默
- 图片分析新增色调、影调、景深 3 个专属维度（共 16 维）
- 风格(style)和构图(composition)字段完整链路存储（DB→后端→前端）
- 前端分析结果新增 🎨 风格化独立分组，与 🌍 场景分组并列
- 修复：auto-scroll、语言切换即时生效、分析弹框模型显示、ensure_ascii 缺失、composition 字段丢失

## 已完成：i18n 国际化 + 设置页重构（2026-05-19）

新增中英文国际化支持，设置页面重构为标签页布局。

**改动文件：**
- `frontend/js/i18n.js` — **新建**：轻量 i18n 模块，`t(key, params)` 翻译函数 + `Vue.reactive` 响应式 locale 状态；翻译键按前缀分组（`g.*` 通用、`d.*` 详情、`dup.*` 重复、`s.*` 设置、`side.*` 侧边栏、`imp.*` 导入、`kb.*` 快捷键等）；回退链：当前 locale → zh → key 本身
- `frontend/index.html` — 设置弹窗从手风琴分区改为标签页（通用/图片/视频/音频 4 个标签）；通用标签新增语言选择器（中文/English）；所有 UI 文案改为 `t()` 调用；`<script>` 引入 `i18n.js`
- `frontend/js/gallery.js` — 所有硬编码中文文案替换为 `t()` 调用（筛选标签、通知、右键菜单等）
- `frontend/js/detail.js` — 所有 UI 文案替换为 `t()` 调用（元数据标签、分析维度、按钮、通知等）
- `frontend/js/duplicates.js` — 所有 UI 文案替换为 `t()` 调用（标签页标题、按钮、通知等）
- `frontend/css/main.css` — minimap 视口矩形背景色改为 `var(--accent)` 主题色（原硬编码蓝色）
- `backend/db.py` — `_DEFAULTS` 新增 `language` 设置（默认 `zh`）
- `backend/blueprints/settings.py` — GET/POST 接口同步 `language` 字段

**功能说明：**
- 支持中文（默认）和英文两种语言
- 语言设置持久化到后端 settings 表，页面刷新后保持
- 设置页重新组织为 4 个标签页：通用（语言/主题/强调色）、图片、视频、音频
- 所有 UI 标签、工具提示、通知、对话框标题跟随语言设置
- Minimap 视口矩形背景色使用 accent 主题色，跟随用户选择的主题色变化

## 已完成：全屏看图 + 导航缩略图（2026-05-19）

图片详情页新增全屏看图功能和缩放导航缩略图。

**改动文件：**
- `frontend/js/detail.js` — 新增 `isFullscreen`/`imgNatW`/`imgNatH` 数据；`onImageLoaded` 记录图片自然尺寸；新增 `minimapRectStyle` 计算属性（根据 imgZoom/imgPanX/imgPanY 和容器尺寸计算视口矩形位置）；新增 `toggleFullscreen()` 方法（浏览器 Fullscreen API）；新增 `onMinimapClick()` 方法（点击 minimap 跳转到对应区域）；F 键从切换喜欢改为切换全屏；`created` 中注册 `fullscreenchange` 监听，`beforeUnmount` 中清理；imgContainer ref 添加 `.img-view-area` class
- `frontend/css/main.css` — 新增 `.img-view-area` 样式（flex 容器 + `:fullscreen` 背景色）；`.img-minimap` 导航缩略图样式（160px 宽、半透明、悬停增强）；`.img-minimap-rect` 视口矩形样式

**功能说明：**
- 放大图片 > 100% 时，右下角出现半透明导航缩略图，蓝色矩形显示当前视口位置
- 拖拽图片时矩形实时跟随，点击缩略图可跳转到对应区域
- 缩放条新增全屏按钮（`fullscreen` 图标），按 F 键切换全屏
- 全屏时 imgContainer 填充整个屏幕，只显示图片区域
- F 键原功能（切换喜欢）已移除快捷键

## 已完成：查找相似弹窗 + 画廊排除/删除（2026-05-19）

画廊右键"查找相似"不再跳转到重复页，改为在弹窗中直接展示与当前照片相似的结果（酷似/相似/聚类三个标签页），支持排除和删除操作。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `GET /<int:media_id>/similar` 端点：获取源图片 embedding，与所有图片计算余弦相似度，按阈值（酷似 0.96/相似 0.90）筛选并排除已排除的 pair，HDBSCAN 聚类取源图片所在聚类；返回 `{ source, near, similar, cluster }`
- `frontend/js/api.js` — 新增 `getSimilar(mediaId)` 方法
- `frontend/js/gallery.js` — `findSimilar()` 改为弹窗展示：头部显示源图片 + 三个标签按钮（与重复页样式一致），结果使用 `.dup-card` 网格；右键菜单支持查看详情、在文件夹中显示、排除、删除；排除弹窗复用排除模式（选择不相似的照片）；排除 pair 使用源图片 ID（`similarDlg.source.id`）；弹窗尺寸 `93vw × 92vh`
- `frontend/js/gallery.js` — 画廊右键菜单移除"写入 XMP"选项（仅保留在详情页）

**排除机制：**
- 弹窗中排除的照片对会写入 `dup_exclusions` 表（与重复页共享）
- 排除后该照片在对应类型（酷似/相似/聚类）中不再出现
- 可在重复页通过"恢复排除"功能取消排除

## 已完成：恢复排除功能（2026-05-19）

重复页每个分组新增"恢复排除"功能，用户可查看被排除的照片并选择性恢复。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `DELETE /dup-exclusions/pairs` 端点（按具体 pair 删除排除记录）；`find_duplicates` 返回数据中每个 group 附带 `excluded` 字段（被排除的照片 ID + file_name + excluded_with ID 列表），通过 `_attach_excluded()` 辅助函数实现
- `frontend/js/api.js` — 新增 `removeDupExclusionPairs(pairs, dupType)` 方法
- `frontend/js/duplicates.js` — 分组头右侧新增"恢复排除 (N)"按钮（仅在有排除记录时显示）；恢复排除弹窗按被排除照片分行，每行左侧显示被排除照片缩略图，中间显示其排除对象的小图标（可勾选），右侧"恢复排重"按钮；每行独立操作，恢复后该行消失
- `frontend/css/main.css` — `.restore-pair-thumb` 样式（40px 小图标，悬停放大 3.5 倍）

## 已完成：排除弹窗 UI 优化（2026-05-19）

重复页排除弹窗多项交互改进。

**改动文件：**
- `frontend/js/duplicates.js` — 排除弹窗新增"全选/取消全选"切换按钮；底部显示"共 X 张"计数；滚动提示"↓ 向下滚动查看更多"（候选 > 6 张时显示）
- `frontend/css/main.css` — `.exclude-scroll-wrap` 固定最大高度 300px + 滚动；`.exclude-scroll-hint` sticky 底部提示（暗色 `#1d1d1d` / 亮色 `#fff` 背景）

## 已完成：重复页卡片流式布局（2026-05-19）

重复页分组卡片从横向滚动改为 CSS Grid 自适应折行，撑满容器宽度。

**改动文件：**
- `frontend/js/duplicates.js` — 分组容器从 `display:flex;overflow-x:auto` 改为 CSS Grid class `.dup-grid`
- `frontend/css/main.css` — `.dup-grid` 使用 `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` 自动折行；`.dup-card` 在 grid 内 `width: auto`

## 已完成：文件夹移除和重新扫描（2026-05-19）

支持整个目录从库中移除，以及重新扫描目录（应对文件变化、移位、更名、子目录变更）。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `DELETE /api/library/folder` 端点（按路径前缀删除所有媒体记录及其缩略图）；新增 `POST /api/library/sync-folder` 端点（SSE 流：扫描目录 → 导入新文件 → 删除已移走文件 → 报告结果）
- `frontend/js/api.js` — 新增 `deleteFolder(path)` 和 `syncFolder(path)` 方法
- `frontend/js/gallery.js` / `frontend/index.html` — 文件夹树右键菜单新增"移除文件夹"和"重新扫描"

## 已完成：批量导入修复（2026-05-19）

修复批量导入多个问题：ThreadPoolExecutor 与 Flask 上下文冲突、SSE 流数据库连接关闭、embedding JSON 序列化失败。

**改动文件：**
- `backend/blueprints/library.py` — `import_batch` 改为顺序导入（同一线程），使用 `stream_with_context` 包装 SSE 响应；结果中 pop embedding 字段避免 JSON 序列化失败
- `backend/blueprints/library.py` — `sync_folder` 同样使用 `stream_with_context`，db 操作移入 generator 内部避免连接关闭
- `backend/services/importer.py` — 修复 INSERT 语句 26 列 / 25 占位符不匹配；`import_single_file` 异常时 `raise` 而非 `return None`

## 已完成：移除"重复"检测标签（2026-05-19）

移除 SHA256 级别的精确重复检测，仅保留视觉相似检测（酷似/相似/聚类），突出软件自身优势。

**改动文件：**
- `frontend/js/duplicates.js` — 删除"重复"按钮及帮助文案；默认标签从 `similar` 改为 `near`（酷似）；`typeLabel` 移除 `exact` 映射
- `backend/blueprints/library.py` — 删除 `exact` 分支（余弦相似度 ≥ 0.999 的 union-find）

## 已完成：缩略图 Bug 修复 + UUID 随机命名（2026-05-19）

修复缩略图丢失 Bug，缩略图文件名改为随机 UUID，新增缩略图自动补齐机制。

**改动文件：**
- `backend/services/importer.py` — 修复 re-import Bug：重复导入时不再删除已有缩略图（之前删了旧缩略图但不生成新的，导致 DB 有路径但文件不存在）；缩略图命名从 `{stem}_{timestamp}.jpg` 改为 `{uuid4.hex}.jpg`，避免与源文件名关联
- `backend/blueprints/serve.py` — `serve_thumbnail` 增加自动修复：缩略图文件不存在时自动重新生成，避免 404
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-thumbnails` 端点：补齐 `thumbnail_path` 为空的记录 + 文件不存在的记录
- `frontend/js/api.js` — 新增 `backfillThumbnails()` 方法

**修复的缩略图丢失场景：**
- 重复导入同一文件时旧缩略图被删但未重新生成
- `data/thumbnails/` 目录被手动清理后 DB 记录仍指向旧路径
- 访问缺失缩略图时自动触发重新生成（serve.py 自动修复）

## 已完成：导入性能优化 — 移除 SHA256/pHash + 后端批量导入（2026-05-19）

移除导入时的 SHA256 文件哈希和 pHash 感知哈希计算（每文件省 1 次 ffmpeg 子进程 + 1 次全文 I/O），精确查重改用 ResNet50 embedding 余弦相似度 ≥ 0.999，新增后端 SSE 批量导入端点。

**改动文件：**
- `backend/services/importer.py` — 删除 `_compute_file_hash()`（SHA256）和 `_compute_phash()`（pHash，约 60 行），导入不再计算 file_hash/phash，移除 `hashlib` 导入
- `backend/blueprints/library.py` — 新增 `POST /api/library/import-batch` SSE 端点（ThreadPoolExecutor 5 并发，实时推送进度）；`backfill-hashes` 改为 `backfill-embeddings`（仅补算 embedding）；精确查重（exact）改用 embedding 余弦相似度 ≥ 0.999；新增 `from flask import Response`、`import json`
- `frontend/js/api.js` — 新增 `importBatch(paths)`（SSE 流）；`backfillHashes()` → `backfillEmbeddings()`
- `frontend/js/duplicates.js` — `API.backfillHashes()` → `API.backfillEmbeddings()`
- `frontend/index.html` — `startImport()` 改用 SSE 批量导入（单次请求 + ReadableStream，替代前端 5 路并发请求）

**优化效果：**
- 每文件从 4-5 个子进程降到 2-3 个（ffprobe/exiftool + ffmpeg 缩略图）
- 不再读取整个文件计算 SHA256（大视频文件省数秒）
- 后端线程池统一调度并发，避免前端多请求同时 spawn 大量子进程

## 已完成：代码清理（2026-05-18）

系统性清理冗余代码、提取共享逻辑、删除死代码。

**改动文件：**
- `frontend/js/format.js` — **新建**：提取 `fmtSize()`/`fmtDur()` 共享格式化函数
- `frontend/js/gallery.js` — 修复 `watch`/`computed` 错位 bug（groupBy 不随 sortBy 重置）；用 format.js 替代内联函数；删除空方法 `onRatingChange`
- `frontend/js/detail.js` — 用 format.js 替代内联 `fmtSize`/`fmtDur`
- `frontend/index.html` — 删除死代码（`galleryKey`/`searchText`/`doSearch`/`importProgress`/`importPercent`/`setTheme`）；添加 `format.js` script 标签；侧边栏 mini 模式隐藏文件夹树和展开箭头；导入按钮贴底布局
- `frontend/css/main.css` — 删除未用 CSS 规则（`.stars`/`.pagination`/`.color-*`）
- `backend/config.py` — 新增 `RAW_EXTS`（从 `IMAGE_EXTS` 派生）；删除未用 `OUTPUT_DIR`；添加概述注释
- `backend/compressor.py` — 用 `RAW_EXTS` 替代本地 `RAW_EXTENSIONS`（修正 `.meF` typo）
- `backend/services/importer.py` — 用 `RAW_EXTS`/`VIDEO_EXTS`/`IMAGE_EXTS` 替代本地别名
- `backend/services/embedding.py` — 用 `RAW_EXTS` 替代本地 `_RAW_EXTS`
- `backend/services/thumbnails.py` — **删除**（2 行空占位文件）
- `backend/blueprints/library.py` — 重复检测逻辑提取为 `_fetch_embedding_rows`/`_rows_to_groups`/`_union_find_groups` 三个辅助函数；numpy 移至顶层 import；添加概述注释
- `backend/blueprints/analysis.py` — 移除未用 `import os`；合并两处 `_cleanup_temp` 为模块级函数；删除 4 处冗余 inline `import json`
- `backend/analyzer.py` — `import time` 移至顶层
- `backend/db.py` — 添加概述注释
- `frontend/js/api.js` — 添加概述注释
- 净减约 130 行代码

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
| `F` | 切换喜欢 | 全屏看图 |
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

## 已完成：侧边栏与交互优化（2026-05-18）

多项侧边栏和交互体验改进。

**改动文件：**
- `frontend/index.html` — 素材库菜单从 `q-expansion-item` 改为 `q-item` + 独立展开箭头，分离导航和展开两个热区；文件夹树改用 `:expanded` + `expandedFolders` 替代 `default-expand-all`（解决异步数据不展开的问题）；进入详情页时只展开目标文件夹的祖先路径；去掉 q-space 修复文件夹名过早截断；移除标签列表 UI；收藏夹图标改为 `folder_special`；红心"收藏"全部改为"喜欢"
- `frontend/js/api.js` — 移除 `getTags`/`createTag`/`deleteTag`/`assignTags` 方法
- `frontend/js/gallery.js` — 筛选提示"只看收藏"→"只看喜欢"，通知文案"已收藏"→"已喜欢"
- `frontend/js/detail.js` — 按钮提示"收藏"→"喜欢"，通知文案"已收藏"→"已取消收藏"→"已喜欢"→"已取消喜欢"
- `frontend/index.html` — 快捷键提示"切换收藏"→"切换喜欢"
- `.gitignore` — 新增 `*.db` 排除数据库文件

**改动点：**
1. 素材库热区分离：点击文字/图标导航到画廊，点击右侧箭头展开/折叠文件树
2. 文件夹树展开修复：`default-expand-all` 只在首次渲染生效（此时数据为空），改用响应式 `expanded` 属性控制
3. 详情页展开策略：只展开目标文件夹的祖先路径，不展开所有节点
4. 文件夹名截断修复：去掉 q-space，计数数字用 `flex-shrink:0` 不压缩，文件夹名占据剩余空间
5. "收藏"→"喜欢"：红心功能统一称为"喜欢"，与侧边栏"收藏夹"区分
6. 标签功能移除：前端移除标签列表和 API，后端保留
7. 收藏夹图标：`folder` → `folder_special`

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
- 完全重复：embedding 余弦相似度 ≥ 0.999（2026-05-19 已改为 embedding，不再用 SHA256）
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

- **#1** 孤儿缩略图从未清理 — 已修复：清理了现有 10 个孤儿文件；重复导入不再删除旧缩略图；缩略图命名改为 UUID 随机文件名
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
