# 项目代码审查问题清单

> 后续状态：2026-10-18 已获用户授权并完成 R01–R46 的代码修复，见 [修复与验证记录](code-fixes-2026-10-18.md)。以下保留修复前的审查证据。

- 状态：已完成本轮审查与复核，仅审查，未修复。
- 用户要求：持续检查约 10 小时，最后提供问题列表；暂不修改业务代码。
- 检查窗口：北京时间 2026-10-17 21:57 至 2026-10-18 07:57。
- 审查基线：当前工作区，开始时 Git 工作区干净。
- 已确认：46 项，其中 P1 13 项、P2 32 项、P3 1 项。均有隔离复现；已归并相同根因并排除未证实/过时结论。
- 最终复核：北京时间 2026-10-18 05:37。已满足授权的提前交付条件；不为凑满检查窗口重复运行已确认场景。
- 源码基线：Git HEAD `6b3af3e`，业务源码无 diff；43 个核心源码文件的 SHA-256 清单保存在复现证据目录。
- P1：可能丢失整理/工程/侧车元数据、串用素材、违背本地分析配置，或阻断新环境启动；P2：特定交互、输入或接口失效；P3：低频维护路径的可恢复问题。

## 已确认问题

### R01 · P1 · 文件夹路径中的通配符可能扩大删除范围

- 位置：[library.py](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1471)，相同谓词也用于文件夹同步和列表过滤。
- 触发：从素材库移除包含 `_` 或 `%` 的目录。
- 原因：直接将路径拼成 `LIKE '<path>/%'`，没有把 SQL LIKE 通配符转义。
- 复现：合成库分别导入 `trip_1/one.mp4`、`tripX1/two.mp4`，请求删除 `trip_1`，响应删除数量为 2，另一目录记录也消失。
- 影响：误删其他目录的库记录、分析和评分等关联整理数据。这里没有证明源媒体文件被删除，不应描述为删除原片。
- 证据：`test_folder_underscore_deletes_other_directory`。

### R02 · P1 · 外置盘未挂载时重新扫描会清空对应库记录

- 位置：[library.py](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1495)、[删除分支](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1515)。
- 触发：对已经入库、当前不存在或不可访问的目录执行重新扫描。
- 原因：没有先验证目录存在且扫描成功，扫描得到空集合后直接把所有旧记录判断为已删除。
- 复现：合成素材具有 5 星评分、收藏和分析片段，目录本身不存在；调用 `sync-folder` 返回 200，素材和分析记录数量都变为 0。
- 影响：外置盘掉线也被当成真实文件删除，丢失用户整理数据。
- 证据：`test_sync_unavailable_directory_deletes_library_records`。

### R03 · P1 · 批量图片分析忽略本地引擎配置

- 位置：[analysis.py](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:192)，默认参数在 [图片处理函数](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:360)。
- 触发：设置图片分析为本地模型，再从画廊提交批量图片分析。
- 原因：批量入口没有读取或传入 `image_engine`、`local_model`，工作函数默认使用 `engine="cloud"`。
- 复现：设置 `image_engine=local`、`local_model=qwen3-omni-30b-a3b`，捕获实际提交参数后应用函数默认值，得到 `engine=cloud`。
- 影响：没有云端 Key 时批量图片分析失败；若配置了有效 Key，可能把本应本地分析的图片发送到云端。测试未调用真实云端接口。
- 证据：`test_batch_image_ignores_local_engine`。

### R04 · P1 · 同名视频并发压缩共用临时文件

- 位置：[compressor.py](/Users/zack/program/python/video_analyzer/backend/compressor.py:97)。
- 触发：同一秒内并发分析来自不同目录、文件主名相同的视频，如两天拍摄的 `DSC_0001.MOV`。
- 原因：输出文件名仅由 `input_path.stem` 和精确到秒的时间拼接，没有唯一任务标识；ffmpeg 又使用 `-y` 覆盖。
- 复现：冻结同一秒时间、给两个目录中的同名视频调用实际压缩函数，两个调用返回同一个临时输出路径。
- 影响：两个任务可能互相覆盖、分析错误素材，或其中一个任务清理文件导致另一个任务失败。
- 证据：`test_compression_same_stem_same_second_reuses_output`；外部 ffmpeg 进程用替身避免实际媒体写入。

### R05 · P1 · 重新分析素材会使已有工程中的片段引用失效

- 位置：[analysis.py](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:1018)，关联见 `project_tracks.segment_id` 的 `ON DELETE SET NULL`。
- 触发：工程已经使用某段素材，随后重新分析该素材，再编辑脑图触发 apply。
- 原因：保存分析结果时删除全部旧片段并重新插入，片段 ID 改变，但 `projects.ai_plan` 内的旧 ID 没有更新，已有 track 外键被置空。
- 复现：先分析并创建 1 个视频轨道的工程，再保存同一素材的新分析结果；track 的 segment_id 变成 NULL，重新 apply 后视频轨道数量变成 0。
- 影响：已有编排与脑图引用失联，后续应用方案时镜头消失。
- 证据：`test_reanalysis_breaks_existing_project`。续查确认 [工作台重新分析](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:2862) 完成后仅调用 load；[load](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1029) 只重新获取工程、片段和轨道，没有映射旧片段 ID 的补偿逻辑。

### R06 · P1 · 时间线新增片段没有同步到脑图方案

- 位置：[workbench.js](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1877)、[同步过滤](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1293)。
- 触发：已有 AI 方案时，从素材面板把新的分镜拖入视频轨。
- 原因：新增 track 的 metadata 只写 `srcStart/srcEnd/srcMediaId`，未写 act_id/narrative_id；同步函数直接忽略没有 narrative_id 的视频块。
- 复现：组件方法测试中 tracks 保留 2 条而 ai_plan 只有 1 条分镜；真实 Chromium 中从右侧分析片段拖入视频轨，服务端保存 2 条视频轨道但方案仍只有 1 个镜头。切换脑图、改写叙事文字后，apply 将持久化的视频轨道从 2 条变成 1 条。
- 影响：时间线与脑图不一致，随后正常编辑脑图即可丢失新增镜头。
- 证据：`review_frontend_repros.js` 的 timeline 场景；`browser_review.js` 的实际拖入、保存、脑图编辑链路；`browser-timeline-dropped.png`、`browser-after-mindmap-edit.png`。浏览器测试只使用合成工程与生成的 10 秒纯色视频。

### R07 · P2 · 搜索普通完整文件名会触发 FTS5 语法错误

- 位置：[library.py](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:21)、[MATCH 查询](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:327)。
- 触发：搜索 `clip.mov` 这样的完整文件名，或带某些 FTS 特殊字符的文本。
- 原因：jieba 分词后直接用 `AND` 拼接，标点没有作为 FTS 字面量引用或转义。
- 复现：入库并建立索引后 GET `/api/library/?q=clip.mov`，SQLite 抛出 `fts5: syntax error near "."`；正式应用的异常处理器会转为 500。
- 影响：正常文件名搜索失败，前端当前仅记录加载错误。
- 证据：`test_filename_search_throws_fts_error`。

### R08 · P2 · 快速切换筛选时旧响应会覆盖新结果

- 位置：[gallery.js](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1405)、[分页直接追加](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1428)。
- 触发：连续切换筛选/搜索，旧请求比新请求更晚返回。
- 原因：`load()` 没有请求序号、取消请求或返回结果的条件校验，任一返回都会覆盖 items/total。
- 复现：组件方法测试中先完成新请求再完成旧请求，最终条件仍为 new 而列表为 old。真实 Chromium 中依次点击视频、图片筛选，受控延后视频请求的响应；图片按钮保持选中，但画面只显示 `VideoOnly.mp4`。
- 影响：筛选条件与实际素材列表不一致，用户可能选错素材。续查确认同样影响分页：旧视频第 2 页可以追加到新的图片筛选结果中，并把 total 从新条件的 1 覆盖成旧条件的 100。
- 证据：`review_frontend_repros.js` 的 gallery 场景；`browser_review.js` 与 `browser-gallery-stale.png`；`review_round3_frontend.js` 的分页受控 Promise 场景。浏览器验证没有脚本异常或失败网络请求，仅控制两个正常响应的完成顺序；分页补充验证为实际组件方法测试。

### R09 · P2 · 按时间点获取缩略图总是回退，并残留临时文件

- 位置：[serve.py](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:226)、[后置局部导入](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:243)。
- 触发：请求 `/media/thumbnail/<id>?t=3`。
- 原因：函数后半段 `from pathlib import Path` 将 Path 声明为整个函数的局部变量，前面的帧生成分支和 finally 清理在赋值前使用它，异常又被吞掉。
- 复现：让 ffmpeg 替身成功生成时间点图片；接口返回的仍是默认缩略图，生成的临时 JPG 没被删除。
- 影响：该时间点缩略图接口失效且累积临时文件。本轮尚未找到前端实际使用该参数，不能扩大描述为所有缩略图都失效。
- 证据：`test_timestamp_thumbnail_falls_back_and_leaks_temp`。

### R10 · P2 · 创意方案校验仍按旧层级读取分镜

- 位置：[creative.py](/Users/zack/program/python/video_analyzer/backend/blueprints/creative.py:936)。
- 触发：模型按当前 acts → narratives → shots 层级返回了无效 segment_id。
- 原因：`_validate_plan` 仍遍历 `act.shots`，没有遍历 narrative.shots。
- 复现：传入 narrative 下引用不存在 ID 的分镜并调用实际校验函数，无效引用原样保留。
- 影响：无效分镜可被保存进 ai_plan，后续 apply 静默跳过，使实际镜头/时长与生成方案不符。
- 证据：`test_plan_validation_ignores_nested_shots`。空对象方案与 SSE 终态问题已经独立复现，见 R14。

### R11 · P1 · 重新扫描已变更文件先删旧记录，丢失整理数据和工程关联

- 位置：[importer.py](/Users/zack/program/python/video_analyzer/backend/services/importer.py:120)、[删除后才探测媒体](/Users/zack/program/python/video_analyzer/backend/services/importer.py:127)、[异常后的最终提交](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1542)。
- 触发：已导入文件的大小或 mtime 改变后，对目录执行重新扫描；不需要文件画面或声音内容真的改变。
- 原因：`force_update=True` 把原 media 及关联记录删除，再重新探测并以默认用户字段插入新 ID；未保留评分、收藏、备注、分析和 project_media 关系。探测失败时 sync-folder 也没有回滚该项删除，最终 commit 仍提交它。
- 复现一：只修改合成 MP4 的 mtime，保留相同内容与大小；重新扫描后 ID 改变，5 星/收藏/备注重置，分析和工程素材关联归零。
- 复现二：对已变更的合成文件让 probe 抛出异常；接口发出 fail、done 事件，但旧库记录已经被删除并提交。
- 影响：更新文件元数据就可能丢失用户整理数据；扫描某个文件失败也会让它从库及工程素材集合消失。源文件仍存在。该根因不同于 R02 的目录不可用判断，也不同于 R05 的仅替换分析片段。
- 证据：`test_sync_mtime_change_discards_annotations_and_project_link`、`test_failed_sync_commits_old_record_deletion`。代码另见 [调整拍摄时间](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1402) 只更新 date_taken，没有同步 file_mtime；内置“按 EXIF 设置文件日期”已同步 mtime，不能笼统描述所有日期功能都有问题。

### R12 · P2 · 分析任务去重不完整，单项与并发批量均可重复入队

- 位置：[analysis.py](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:130)、[图片任务提交](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:722)；批量入口在 165 行有 processing 过滤，单项入口没有。
- 触发：素材已有 processing 状态，再通过单项分析入口提交；例如多个窗口或从工作台再次分析。
- 原因：单项入口只查询 ID、路径、类型，无正在处理的去重检查；线程池与 API 信号量也不按 media_id 去重。[单项视频分支](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:798) 入队前又没有像图片/音乐分支一样写 processing，使后续批量入口的状态过滤也无法拦住重复任务。
- 复现一：合成图片初始即为 processing，连续两次单项 POST 均返回 200/queued，捕获到两次 worker 提交；关闭测试 SSE 不会撤销已经提交的任务。
- 复现二：合成视频由单项入口成功进入 queued 后，GET 分析状态仍为 none；再调用批量入口，其 submitted 仍包含该素材，总计提交两次任务。
- 复现三：两个实际 Flask 批量请求经同步屏障同时读到 none，之后都 UPDATE/commit 并成功返回同一 submitted ID，捕获到 2 次 worker 提交。原因是批量入口的 [读状态](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:159) 与 [认领任务](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:171) 没有做原子条件更新。
- 影响：重复占用本地推理资源，配置云端时可能重复收费；工作线程还会覆盖同一素材的结果和按 ID 存储的进度。测试只验证重复排队，没有实际调用模型或收费接口。
- 证据：`test_single_analysis_resubmits_processing_media`、`test_single_video_queue_leaves_status_unclaimed`、`test_concurrent_batch_requests_both_admit_same_media`。同一批量请求的重复 ID 已被现有 processing 检查跳过，不把该情形误报为漏洞；多个并发批量请求的竞态现已确认，合并于本项。

### R13 · P2 · 清除分析会连同文件名搜索索引一起清除

- 位置：[analysis.py](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:118)。
- 触发：在详情页清除某素材的分析结果，随后按它的文件名搜索。
- 原因：删除 media_fts 整行后没有恢复仅含文件名的基础索引；媒体仍在库中，重新导入通常又会跳过已存在文件。
- 复现：`holiday.mp4` 在清除前搜索 holiday 命中 1 条；DELETE 分析成功后相同搜索命中 0 条，直接查询 media 证实素材记录仍存在。
- 影响：清除分析后该素材的正常文件名检索失效，重新分析或重建索引前持续存在。与 R07 的 FTS 查询语法错误不同。
- 证据：`test_clear_analysis_removes_filename_search`。

### R14 · P1 · 空对象生成结果覆盖旧方案，同时 SSE 一直停留在 100%

- 位置：[creative.py](/Users/zack/program/python/video_analyzer/backend/blueprints/creative.py:345)、[覆盖持久化方案](/Users/zack/program/python/video_analyzer/backend/blueprints/creative.py:357)、[SSE 终态条件](/Users/zack/program/python/video_analyzer/backend/blueprints/creative.py:401)。
- 触发：重新生成已有工程的创意方案，模型输出合法 JSON 空对象 `{}`。
- 原因：解析只拒绝 None，校验不要求 acts/有效镜头；空对象因此覆盖旧 ai_plan。SSE 又要求 result 为真才发送 done，`{}` 为假，所以工作线程完成后仍持续发送进度。
- 复现：使用 OpenAI 客户端替身只返回 `{}`，真实生成函数把已有非空方案更新成 `{}`；连续读取 4 个 SSE 事件均为 step=done、percent=100 的 progress，没有 done/error。循环条件在该固定终态下始终不成立。
- 影响：旧方案被空对象覆盖，前端等待完成事件而持续卡住；此前已有 tracks 不会在该生成接口内立即删除，不能夸大为立刻清空所有轨道。
- 证据：`test_empty_generated_plan_overwrites_previous_plan_and_never_finishes_sse`。未调用任何真实 AI 接口。

### R15 · P1 · 工程自动保存请求乱序会用旧编辑覆盖新编辑

- 位置：[workbench.js](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1360)、[连续重命名的保存调用](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1591)、[后端全量替换](/Users/zack/program/python/video_analyzer/backend/blueprints/workbench.py:190)。
- 触发：连续两次修改时间线，前一次保存尚未完成，后一次保存先完成。
- 原因：`_trackSave` 每次独立执行全量 tracks PUT、随后 plan PUT，没有串行队列或版本/过期请求检查；后端的 version=1 是轨道版本分组，不是用于拒绝旧写入的递增修订号。
- 复现：真实 Chromium 中连续把主旨改为 A、B，仅在测试端延后 A 的轨道保存请求；B 先成功存入合成数据库，释放 A 后，数据库中的 theme 与 ai_plan 又回到 A，但当前 UI 仍显示 B。刷新后 UI 也恢复为旧 A。
- 影响：正常连续编辑可能持久丢失最后一次修改；界面当时显示的新值不能证明已经保存成功。
- 证据：`browser_save_review.js` 的 save race 场景、`browser-save-race.png`。使用实际组件事件、实际保存接口和合成工程，未改业务代码。

### R16 · P2 · 脑图方案保存失败仍执行 apply，并显示未保存的新方案

- 位置：[workbench.js](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:989)、[继续应用旧方案](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:996)；时间线 [plan 保存](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1375) 也未检查 HTTP 成功状态。
- 触发：脑图编辑后的 plan PUT 返回 4xx/5xx，但网络连接正常完成。
- 原因：fetch 遇到 HTTP 错误不会自动抛异常，代码没有检查该 PUT 的 `response.ok`，仍把新方案写入本地状态并调用 apply。后端实际应用的是没有更新成功的旧方案。
- 复现：真实浏览器改写叙事文字为 C，测试端让该次 plan PUT 返回 500；随后实际 apply POST 仍执行成功。脑图显示 C，而数据库 ai_plan 与重建后的 text track 都仍为旧文字，页面没有脚本异常。
- 影响：保存失败被当作成功继续处理，脑图、轨道和持久化工程不一致，刷新后编辑丢失。该问题与 R15 的成功请求乱序是不同根因。
- 证据：`browser_save_review.js` 的 failed plan 场景、`browser-save-failed-but-applied.png`。500 是人为注入的正常失败路径，不是本轮发现后端必然报错。

### R17 · P2 · 主模型成功、投影器失败后无法重试下载

- 位置：[local_vlm.py](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:433)、[安装状态判定](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:95)、[重试入口判定](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:450)。
- 触发：两个模型文件中的主 GGUF 已成功下载，后续 mmproj 下载失败，再次点击下载。
- 原因：安装状态要求主模型与 mmproj 同时存在，但 start_download 仅凭主模型存在就拒绝；下载线程本身也没有跳过已完成文件的恢复分支。
- 复现：在专用临时模型目录中让合成主文件下载成功、合成投影器抛出传输错误；状态为 error、installed=false，但重试立即抛出“模型已下载”。
- 影响：无法通过正常下载操作补齐投影器；用户可能需要删除已下载的大文件并重下，浪费带宽和时间。
- 证据：`test_missing_projector_prevents_download_retry`。所有文件都是几字节合成内容，真实模型目录、HF 缓存和网络均未触碰。

### R18 · P2 · 分片预分配被计为已下载，进度会提前达到 100%

- 位置：[local_vlm.py](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:271)、[预分配](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:355)。
- 触发：下载达到分片门槛的大模型文件。
- 原因：分片下载开始时就 truncate 为完整文件大小，download_status 却用 `.part` 的 stat().st_size 作为已下载字节；没有采用 sidecar 中记录的真实完成前缀。
- 复现：合成主文件已有 64 字节、投影器预计 16 字节；投影器 HTTP body 尚未收到任何字节时，接口已返回 done_bytes=80、total_bytes=80。释放传输阻塞后最终内容逐字节正确，排除了测试本身没真正下载的误判。
- 影响：下载尚在开始或阻塞时界面已经显示 100%，速度也会把预分配空间当成实际吞吐，无法判断真实进度。
- 证据：`test_segment_preallocation_reports_full_progress_before_receiving_data`。测试只把分片门槛缩小到 8 字节，执行实际下载算法；不下载真实模型。

### R19 · P2 · 分片收到 416 时可把全零文件标记为下载完成

- 位置：[local_vlm.py](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:372)、[仅核对文件长度](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:298)。
- 触发：分片请求返回 416，例如服务端范围或文件大小与先前元数据不一致。
- 原因：416 分支直接将该段 done 设为 seg_len，而不是确认本地对应范围已经有有效数据；预分配文件本来就满足最终长度检查。
- 复现：让两个分片均返回 416、没有任何 response body；实际 `_download_file` 不报错，最终把 64 字节全零的 `.part` 重命名为正式 `.gguf`。
- 影响：下载会显示完成，后续加载模型才失败；不完整内容会被当成已安装文件，且正常重试又可能受 R17 的主文件存在判断影响。
- 证据：`test_range_416_marks_zero_filled_segments_complete`，缩小分片门槛并使用 HTTP 替身，未访问外网或真实模型。

### R20 · P2 · 下载任务在查询元数据期间未占位，允许重复启动

- 位置：[local_vlm.py](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:447)、[先查询远端元数据](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:416)、[随后才写任务状态](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:424)。
- 触发：下载线程正在等待元数据查询响应时，第二次提交同一模型下载。
- 原因：入口检查 downloading 后直接启动后台线程；状态要等线程完成网络查询后才更新，且检查与认领之间没有互斥保护。
- 复现：两个真实后台线程的元数据查询都被受控阻塞，两个 start_download 均返回 downloading，而共享 download_status 仍为 idle；随后放行并等待两个测试线程退出。
- 影响：可对同一模型启动多个下载器，共用 `.part`、sidecar 和全局进度状态，存在重复流量与互相写入风险。本轮证明了重复启动，未把后续文件损坏概率当成实测结论。
- 证据：`test_download_admission_is_unclaimed_during_metadata_query`。使用合成目录和远端响应替身。

### R21 · P2 · 素材离线时导出静默跳过镜头，甚至返回空时间线

- 位置：[fcpxml_export.py](/Users/zack/program/python/video_analyzer/backend/fcpxml_export.py:161)、[导出接口丢弃 warnings](/Users/zack/program/python/video_analyzer/backend/blueprints/workbench.py:255)、[前端只检查响应与 ZIP 是否非空](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:2318)。
- 触发：工程使用的原片当前不存在，例如外置盘离线，然后导出工程。
- 原因：构建器为每个缺失素材生成 warning 并跳过镜头，但 ZIP 接口没有返回这些 warning，也没有对“全部镜头均被跳过”报错。
- 复现：合成工程有 2 条视频 track，素材路径不存在；build_fcpxml 产生 2 条 warning，实际导出接口却返回 HTTP 200、只有 FCPXML/SRT 的正常 ZIP，其中 asset-clip 数量为 0、sequence duration 为 0s，响应未带缺失说明。
- 影响：导出的镜头少于当前工程，全部素材离线时得到空时间线；用户没有收到缺失素材提示。不会反过来删除数据库中的工程轨道。
- 证据：`test_export_missing_media_silently_drops_all_clips`。编辑器实际导入兼容性未在本轮验证。

### R22 · P2 · 分析期间移除素材，任务仍会写回孤儿记录，批量进度可一直运行

- 位置：[删除入口](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1454)、[工作线程无存活检查即保存](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:413)、[片段表未约束 media 外键](/Users/zack/program/python/video_analyzer/backend/db.py:65)、[进度轮询忽略 404](/Users/zack/program/python/video_analyzer/frontend/index.html:934)。
- 触发：分析正在推理时，从素材库移除该素材。
- 原因：删除没有撤销或标记任务，保存阶段也不检查素材是否仍存在；media_segment.media_id 没有外键，FTS 同样可插入已删除素材 ID。批量任务的前端轮询遇到素材 404 后不进入终态。
- 复现：实际图片 worker 在受控推理替身中暂停，调用真实 DELETE 移除素材，再放行；worker 最终报告 done，media 数量为 0，但 media_segment 与 media_fts 各重新出现 1 条该 ID 的孤儿记录。分析接口返回 404，源合成图片仍存在。另执行实际前端轮询回调 3 次，进度为空且分析 404 时任务一直保持 running。
- 影响：删除后的清理被后台任务部分撤销，积累没有素材归属的分析/索引；批量任务栏可能一直显示运行中。这里没有重新创建 media，也没有删除源文件，不扩大描述为素材完整复活或原片丢失。
- 证据：`test_delete_during_analysis_recreates_orphan_segments_and_fts`、`review_round3_frontend.js` 的 deleted batch task 场景。没有调用真实模型。

### R23 · P2 · 新导入中文文件名没有分词建索引，分析前搜索漏检

- 位置：[importer.py](/Users/zack/program/python/video_analyzer/backend/services/importer.py:194)、[查询按 jieba 分词](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:21)、[分析后才分词重建文件名索引](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:1090)。
- 触发：导入中文文件名的素材，尚未分析时按名称搜索。
- 原因：导入时写入原始 file_name，而查询和分析后的索引采用 jieba 分词；FTS5 unicode61 对未分词的连续中文串与分词后的查询不匹配。
- 复现：实际导入合成 `青海风光.mp4`，搜索“青海”或“青海风光”均为 0；对相同素材保存一次合成分析后，两种查询均命中 1 条。
- 影响：文件已经成功入库，但仅为了按中文文件名查找也需要先分析，违背现有中文文件名检索行为。与 R07 的标点导致 500、R13 的清除索引不同。
- 证据：`test_imported_chinese_filename_not_searchable_until_analysis`。探测/缩略图生成使用替身，实际执行导入、FTS 和查询代码。

### R24 · P2 · 标签增删接口不刷新全文索引

- 位置：[标签分配](/Users/zack/program/python/video_analyzer/backend/blueprints/tags.py:63)、[标签删除](/Users/zack/program/python/video_analyzer/backend/blueprints/tags.py:38)。
- 触发：通过 `/api/tags/assign` 添加标签，或 DELETE 标签，再用全文搜索检索该标签。
- 原因：只更新 tags/media_tags，没有更新 media_fts 中已存的 tags 文本。
- 复现：添加 `DistinctManualLabel` 成功后全文检索仍为 0；重建分析索引后为 1；再删除该标签，全文检索仍然命中 1 条。
- 影响：新增标签查不到、已删标签仍能匹配，直到再次刷新分析索引。本轮未找到当前前端调用这些手工标签接口，因此确认范围限于仍注册的 API，不描述为现有 UI 必现操作。
- 证据：`test_manual_tag_changes_do_not_refresh_fts`。

### R25 · P1 · 按 README 全新安装依赖后，核心模块仍无法导入

- 位置：[requirements.txt](/Users/zack/program/python/video_analyzer/requirements.txt:1)、[library 直接依赖 jieba](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:8)、[analyzer 直接依赖 httpx](/Users/zack/program/python/video_analyzer/backend/analyzer.py:13)、[embedding 直接依赖 torchvision](/Users/zack/program/python/video_analyzer/backend/services/embedding.py:10)、[下载器直接依赖 requests](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:310)。
- 触发：新环境仅执行 README 中的 `pip install -r requirements.txt`，然后启动或使用相似检测/下载功能。
- 原因：运行时直接依赖没有完整声明；本次解析到的 OpenAI SDK 依赖 httpx2，已不能顺带提供项目直接 import 的 httpx。jieba、torchvision、requests 也不在本次完整依赖闭包中。
- 复现：在专用临时目录新建第二个干净 Python 3.12 虚拟环境，实际完整安装 requirements 成功（47 个分发包）；随后只导入模块，library 缺 jieba、analyzer 缺 httpx、embedding 缺 torchvision，requests 本身也不存在。没有执行 create_app、真实数据库迁移或模型推理。
- 影响：照安装说明搭建的新环境无法进入正常后端启动流程；已有环境可能因历史手动安装仍能工作，不能据此推断当前用户应用已经无法启动。
- 证据：`dependency_check.py`、`dependency-check-results.json`、`requirements-venv-freeze.txt`、`dependencies-resolve.json`。新环境实际安装 OpenAI 3.33.0/httpx2 2.13.1；在审查主环境补齐 httpx 后，其旧 httpx 客户端构造兼容性对照通过，没有把 SDK 类型不兼容误列为缺陷。

### R26 · P1 · XMP 分两次写入，后一次失败会丢失原有关键词

- 位置：[xmp_writer.py](/Users/zack/program/python/video_analyzer/backend/services/xmp_writer.py:74)、[后续最终写入](/Users/zack/program/python/video_analyzer/backend/services/xmp_writer.py:104)。
- 触发：更新已有 XMP，首次清空 Subject 成功，而随后的合并写入失败或中断。
- 原因：先用独立 exiftool 命令清空已有关键词，再发第二条命令写回合并数据；两次都使用 overwrite_original，没有原子替换或保留可恢复副本。
- 复现：在专用临时目录生成 JPEG 与含 OriginalKeyword 的真实格式 XMP，使用实际 exiftool 读取和执行第一次清空，只将最终写命令替换成失败返回。write_xmp 返回 False，但再次读取 XMP 时原关键词已经消失，且没有 `_original` 备份；原描述仍在。
- 影响：写入失败也可能破坏用户原有侧车元数据；界面报失败不能保证文件保持原状。测试未触碰任何真实照片或现有 XMP。
- 证据：`test_xmp_second_write_failure_loses_existing_keywords`。正常写入的实际 exiftool 对照也通过，旧/新关键词和原描述可以正确合并，因此问题限定于两阶段写入的失败窗口。

### R27 · P2 · 下载断点记录缺少一致性与结构校验，可生成全零模型

- 位置：[清除 part 未清 sidecar](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:299)、[直接复用断点记录](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:342)、[重新预分配文件](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:355)。
- 触发：分片服务短暂忽略 Range，造成文件超出预期长度；程序报告长度校验失败后再次重试。
- 原因：失败分支只删除 `.part`，却保留标记各段已完成的 `.part.json`；重试没有验证断点记录与实际数据文件是否成对存在，重新创建空文件后把旧完成进度直接当真。
- 复现：合成源预期 64 字节，一次 200 全量响应写入第 2 段使 part 长度变成 96，重试该块成功后最终长度检查报错并删 part，但 sidecar 留下 `[32,32]`。再次调用实际下载函数，没有发生任何新 HTTP 请求，就把重新预分配的 64 字节全零文件改成正式 GGUF。
- 影响：用户看到第一次失败后重试成功，实际得到无法加载的模型文件；和 R19 的 416 分支不同，这里没有使用 416，而是失败清理与恢复状态不一致。
- 证据：`test_size_failure_leaves_stale_resume_then_zero_file_passes`。缩小分片门槛并顺序执行线程以隔离断点恢复逻辑，网络和模型均为合成替身。有效 part+sidecar 的正常恢复对照通过。
- 03:38 续查补证：sidecar 为有效 JSON 但结构错误 `{"segs":[]}` 时，取进度在 [分片异常捕获之前](/Users/zack/program/python/video_analyzer/backend/local_vlm.py:365)，两个真实分片线程均因 IndexError 退出，错误没有传入 errors；主线程仍只按长度验收并把 64 字节预分配的全零文件改为正式 GGUF，完全没有 HTTP 请求。证据为 `test_wrong_sidecar_schema_thread_failures_still_promote_zero_file`，没有另增问题编号；同属直接信任断点记录、没有验证恢复数据的根因。

### R28 · P2 · 转码接口的 HEAD 请求会留下未回收的 ffmpeg

- 位置：[创建子进程](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:115)、[只在生成器 finally 回收](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:124)。
- 触发：对需要转码的 AVI/MKV 等视频或 AIFF 等音频发 HEAD 请求；响应体生成器不会被消费。
- 原因：Popen 在构造响应前已执行，清理却只放在生成器内部；生成器从未开始运行时，close 不会执行其内部 finally。
- 复现：Flask 的视频/音频 HEAD 均创建 Popen，响应 200、空 body，response.close 后 kill/wait 都未调用。另对合成 12 秒 AVI 发真实 HEAD，1 秒后仍有一个 ffmpeg 子进程处于运行状态，已在测试结束时显式终止并回收。
- 影响：头部探测或类似提前结束的请求会浪费转码 CPU/内存，并可能因 stdout 无人读取而持续阻塞。正常 GET 已经开始传输后关闭连接的清理对照通过，不能扩大为所有 GET 取消都会泄漏。
- 证据：`test_head_transcoding_never_starts_generator_and_leaks_process`、`real_head_check.py`、`real-head-results.json`；对照 `test_streamed_get_close_reaps_process_control`。

### R29 · P2 · 工作台切换素材后旧详情与波形响应可覆盖当前素材状态

- 位置：[selectedMedia watcher](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:903)、[波形异步加载](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:2649)。
- 触发：快速切换工作台左侧素材，旧详情或波形请求比新请求更晚完成。
- 原因：组件复用期间只清空显示状态，没有给请求绑定当前素材 ID 或检查返回时的选择；旧 then/await 完成后仍直接覆盖 mediaDetail、波形和时长。
- 复现一：真实 Chromium 中 A→B 切换并延后 A 的详情响应，选中和播放器均为红色视频 B，但元数据变成 A 的 Camera A/128×72。
- 复现二：执行实际 loadWbWaveform，先完成新素材的 20 秒/0.9 振幅数据，再完成旧素材的 10 秒/0.1 数据，选择仍为新素材但波形与时长被覆盖成旧值。
- 影响：拍摄设备、分辨率及波形与正在播放的内容不一致，波形定位也可能错误。和 R08 同属异步过期响应问题，但工作台有独立请求链路，故单列；详情独立页面有 key 重建，不能据此认定详情页同样串素材。
- 证据：`review_round4_frontend.js` 两个实际方法场景、`browser_round4_review.js`、`browser-workbench-stale-metadata.png`。浏览器链路没有 pageerror。

### R30 · P1 · 时间线结构删除后撤销，只恢复轨道而不恢复脑图方案

- 位置：[先覆盖方案](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1634)、[之后才保存撤销快照](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:986)、[撤销恢复并持久化](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:1536)。
- 触发：从时间线删除主旨或叙事块，再点击撤销。
- 原因：`_cascadeDelete` 先写入删除后的 ai_plan，再调用 onPlanChanged；后者快照包含删除前 tracks，却已经是删除后的 plan，无法恢复一致的旧工程。
- 复现：真实浏览器对合成工程删除唯一主旨并确认，轨道数变成 0；点击撤销后实际数据库恢复 1 条视频轨道，但 ai_plan 仍为 `acts=[]`。切换脑图显示“还没有生成创意方案”，状态栏仍有 1 个片段。
- 影响：撤销无法找回被删掉的方案结构，保存后脑图与时间线分裂；后续重新 apply 空方案仍可能清掉恢复的轨道。此项与 R15 请求乱序、R06 新拖入片段缺归属不同。
- 证据：`browser_round4_review.js` 的结构删除/撤销链路、`browser-undo-loses-plan.png`。本轮实际操作验证了主旨删除路径，叙事删除使用同一快照调用顺序。

### R31 · P2 · 流式转码视频无法正常跳转到片段入点

- 位置：[非原生格式进入流式转码](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:68)、[转码响应没有 Range/时间定位处理](/Users/zack/program/python/video_analyzer/backend/blueprints/serve.py:76)、[工作台直接设置 currentTime](/Users/zack/program/python/video_analyzer/frontend/js/workbench.js:2445)。
- 触发：在工作台使用 AVI 等需要后端转码的视频，点击进度条或定位源片段入点。
- 原因：后端对这类请求每次从头输出同一条 fMP4 流，未处理范围跳转，前端却按可 seek 的普通媒体操作。
- 复现：生成有效 12 秒 AVI，实际 ffmpeg 转码输出经 ffprobe 确认长约 12.023 秒。Chromium 通过转码接口播放时 seekable 为 `[0,0]`，点击进度条中点后仍停在 0；将同一次转码响应保存为 MP4，使用原生 send_file/Range 路径提供，同一浏览器、相同点击可跳到约 6.005 秒。转码接口下浏览器还只报告约 10.449 秒时长，原生路径报告完整 12.023 秒。
- 影响：支持导入的转码素材不能按工作台编排的源入出点可靠预览，进度和总时长也可能不准；本轮实际 UI 验证范围为工作台，没有对所有容器/编码器作兼容性结论。
- 证据：`browser_transcode_control.js`、`browser-transcode-control-results.json`、`browser-seek-4.png`/`browser-seek-5.png`。原生路径对照通过，排除了源片损坏或该编码本身无法播放的解释。

### R32 · P2 · 包含式重叠修正会生成起点晚于终点的片段

- 位置：[只推迟起点](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:1013)、[直接保存](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:1020)、[工程时长兜底](/Users/zack/program/python/video_analyzer/backend/blueprints/creative.py:479)。
- 触发：模型返回后一片段完全落在前一片段内部，例如 `[0,10]`、`[5,7]`；这个修正函数本来就在处理模型的重叠输出。
- 原因：把后一段起点设为前一段终点，没有检查其终点是否仍然更晚，也没有丢弃/调整完全被包含的片段。
- 复现：调用实际 save_segments 后第二段保存为 `[10,7]`；把它放进合成工程并 apply，源 metadata 仍为 `srcStart=10、srcEnd=7`，时间线却被兜底为 5 秒。
- 影响：分析结果含无效源入出点，片段预览和编排时长不再对应实际分析范围。这不是只凭函数注释推测，已验证数据库保存和工程应用结果。
- 证据：`test_contained_overlap_becomes_reverse_range_in_project`。ASR 跨小时解析、句子缝合、最大重叠分配和秒数溢出归一化的正常对照通过。

### R33 · P2 · 排除的照片对可通过第三张重新合组，恢复入口也不显示

- 位置：[并查集只跳过直接边](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:933)、[继续合并其他边](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:935)、[跳过组内排除对](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:901)。
- 触发：A/B/C 都达到酷似或相似阈值；在 A 的排除弹窗中只选择 B。
- 原因：排除 A-B 只阻止一条直接合并，A-C-B 仍把它们连回同一个组；组内的排除对不会出现在 excluded 列表。
- 复现：三条合成归一化向量经实际 API 分组；真实 Chromium 点击 A 的排除按钮、选 B 并提交，显示排除成功后仍有全部 3 张卡片，且没有“恢复排除”按钮。相同记录在单图查找 A 时正确排除 B；移除中间的 C 后，两图分组也正确为空。
- 影响：用户明确排除的关系在分组页面失效，并且不能从该组看到/撤销这条隐藏的排除记录。当前验证覆盖酷似模式；相似模式使用同一并查集函数。没有把“传递分组并非两两相似”本身作为缺陷。
- 证据：`test_excluded_pair_rejoins_through_third_image`、`browser_round5_review.js`、`browser-excluded-pair-reappears.png`；对照历史 TODO 所述“排除后不再出现、可恢复排除”的行为，确认不是已移除的旧功能。

### R34 · P3 · 缓存文件先于数据库状态删除，失败后留下损坏缩略图引用

- 位置：[提交前删除旧文件](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:783)、[全批次最后才提交](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:828)。
- 触发：调用仍注册的 `backfill-thumbnails?force=1`，前一个素材成功、后一个素材的缩略图生成超时或抛错。
- 原因：先删除旧缩略图再修改 DB，批次失败时数据库更新回滚，文件删除却无法回滚。
- 复现：两条合成视频记录各有旧缩略图，第二次生成注入 TimeoutExpired；请求异常后第一条 DB 仍指向 first.jpg，但该文件已被删除，新缩略图反而成为无引用文件。合成源媒体保留。
- 影响：维护失败留下损坏的缓存引用和孤立文件。普通缩略图请求可尝试自动重建，故按 P3 记录，不描述为永久媒体丢失。当前前端没有找到 force 重建的调用入口，确认范围是该维护 API。
- 证据：`test_later_thumbnail_failure_deletes_previous_committed_asset`。这与 R11 的用户整理信息丢失不同；正常导入使用 UUID 缩略图的历史修复不能覆盖这里的批次回滚窗口。
- 04:35 补证：普通批量移除素材时，第二张缩略图 unlink 报错，前一张已被删；两条媒体记录却仍在，源文件也都还在。此路径在 [batch 删除](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:1579) 同样先清文件再改库，归并此项缓存与 DB 不一致的根因，不按“部分素材记录已删除”重复报错。证据：`test_batch_thumbnail_unlink_failure_keeps_records_but_loses_first_cache`。

### R35 · P2 · 仅一张图片有特征向量时聚类接口报 500，页面伪装成无结果

- 位置：[无样本数边界直接聚类](/Users/zack/program/python/video_analyzer/backend/blueprints/library.py:973)、[前端异常清成空结果](/Users/zack/program/python/video_analyzer/frontend/js/duplicates.js:408)。
- 触发：新素材库只有一张图片，或其他图片尚无 embedding，在查找重复页面点击“聚类”。
- 原因：只判断向量集合是否为空，没有处理不足以聚类的单样本；HDBSCAN 的邻居查询拒绝该输入，前端又将错误当空组展示。
- 复现：使用 requirements 中实际安装的 HDBSCAN，单样本调用实际聚类 API 抛 `ValueError: k must be less than or equal to the number of training points`；真实 Chromium 点击聚类按钮收到 500，随后实际显示“没有发现聚类素材”。酷似模式同一单样本返回正常空组；两个样本的 HDBSCAN 调用也正常返回噪声标签。
- 影响：正常的小素材库无法使用聚类入口，用户看不到失败原因。这里只验证单样本边界，没有依靠伪造的聚类算法异常。
- 证据：`test_single_image_cluster_raises_in_actual_hdbscan`、`browser_round5_review.js`、`browser_single_cluster_error.js`、`browser-single-image-cluster-500.png`。

### R36 · P2 · Whisper 切换模型可在解锁与返回之间使另一个调用拿到 None

- 位置：[切换时清空共享模型](/Users/zack/program/python/video_analyzer/backend/asr/engines/whisper.py:31)、[在锁外返回共享变量](/Users/zack/program/python/video_analyzer/backend/asr/engines/whisper.py:40)。
- 触发：一个 ASR 调用刚完成冷加载、准备离开加载锁；另一个不同模型的加载/切换请求在它返回前取得锁，例如分析时修改 ASR 模型并触发预加载。
- 原因：锁只保护构造与赋值，函数退出锁后重新读取全局 _model；新请求可先把它置为 None 或换成别的模型。
- 复现：两个真实受控线程分别执行实际 WhisperEngine.transcribe(small/base)，仅以轻量替身替换模型构造和推理；A 成功加载后解锁，B 清空旧模型并开始加载，A 返回 None，随后抛 `AttributeError: 'NoneType' object has no attribute 'transcribe'`；B 正常完成，两个线程均已退出。
- 影响：并发切换时 ASR 失败；视频 worker 当前会记录 ASR 错误并继续保存视觉分析，可能出现分析显示完成但没有转写的结果。没有用这个证据宣称 CTranslate2 推理本身不支持并发。
- 证据：`test_whisper_model_switch_between_unlock_and_return_yields_none`。另已验证 VLM 启动健康检查失败会清理模拟进程并释放占用计数，不把所有启动失败都列为泄漏。

### R37 · P2 · 创作向导取消素材重选会清空原有选择

- 位置：[取消回调传空数组](/Users/zack/program/python/video_analyzer/frontend/index.html:1339)、[向导无条件替换选择](/Users/zack/program/python/video_analyzer/frontend/js/creative-wizard.js:457)。
- 触发：已有工程打开 AI 构思向导，从第 2 步点击“上一步”进入素材重选，再点击素材选择器的关闭按钮。
- 原因：取消与确认空选择共用同一个回调结果，向导把空数组写回原本有内容的 selectedMediaIds。
- 复现：真实 Chromium 中原工程选择 1 个素材，选择器顶部也是“已选 1 个素材”；点击关闭后向导卡片变成 0 个，“下一步”禁用。直接读取合成工程 API，数据库仍有原来 1 个素材。
- 影响：取消操作丢失当前向导的素材草稿选择，需要重新挑选才能继续。没有证明取消本身会删除持久化工程素材或源文件，因此不按数据丢失 P1 描述。
- 证据：`browser_round6_review.js`、`browser-wizard-cancel-clears-selection.png`。

### R38 · P2 · 创作向导生成后的 apply 失败被空 catch 吞掉

- 位置：[生成完成后应用](/Users/zack/program/python/video_analyzer/frontend/js/creative-wizard.js:539)、[覆盖整个处理块的空 catch](/Users/zack/program/python/video_analyzer/frontend/js/creative-wizard.js:547)。
- 触发：方案生成和保存成功，但接着调用 apply 接口失败，例如服务器 500 或连接错误。
- 原因：用于忽略 SSE JSON 解析错误的 try/catch 同时包住异步 apply；API 抛出的操作错误也被忽略，外层错误提示无法接收。
- 复现一：Node 执行实际 startGenerate，返回合法 SSE plan 后让 apply 拒绝，最终没有通知、没有 done 事件，generating 恢复 false；正常 apply 的对照可完成并导航。
- 复现二：真实 Chromium 通过实际生成蓝图和合成模型流保存新方案，再仅注入 apply 的 HTTP 500；向导静默回到最后一步，页面没有错误通知。DB 中 ai_plan 已是新标题，轨道仍是旧标题。
- 影响：用户无法知道失败原因，方案与轨道已经不一致。与 R16 的“忽略方案 PUT 失败仍 apply 旧方案”是不同入口、不同失败步骤。
- 证据：`review_round6_frontend.js`、`browser_round6_review.js`、`browser-wizard-silent-apply-failure.png`。未调用真实 AI 接口。

### R39 · P2 · 关闭生成向导后旧完成事件仍强制跳回工程

- 位置：[关闭仅隐藏向导](/Users/zack/program/python/video_analyzer/frontend/js/creative-wizard.js:15)、[异步完成后无条件导航](/Users/zack/program/python/video_analyzer/frontend/js/creative-wizard.js:544)。
- 触发：生成请求尚未返回时关闭向导，然后返回素材库或开始浏览其他页面，旧请求随后正常完成。
- 原因：关闭没有使当前操作失效，完成回调没有检查 show 或操作代号，仍执行 apply、done 事件与 location.hash 跳转。
- 复现：真实 Chromium 延后一个正常的合成生成响应；点击向导关闭按钮，再点击工作台返回按钮，确认页面已到 `#/gallery`。放行旧响应后，页面自动变成 `#/workbench/1`，显示刚生成的工程。
- 影响：用户离开的页面被旧异步操作重新打开，当前浏览流程被打断。这里确认的是过期 UI 完成回调，不把后台任务继续运行本身解释为取消协议违约，也没有声称关闭会取消付费调用。
- 证据：`browser_round6_review.js`、`browser-closed-wizard-forces-navigation.png`。后台生成在 SSE 断开后仍可安全保存有效方案的正常对照也通过。

### R40 · P2 · 仅点击再失焦就把字段标签重复写入语音和字幕正文

- 位置：[语音与字幕的 contenteditable 范围](/Users/zack/program/python/video_analyzer/frontend/js/detail.js:294)、[失焦值直接保存](/Users/zack/program/python/video_analyzer/frontend/js/detail.js:945)。
- 触发：详情页已有语音或字幕，点击文本后再点其他位置；无需输入任何字符。
- 原因：可编辑父元素包含“💬 对话”或“📝 字幕”的 prefix 标签，blur 取父元素 innerText，所以即使正文未改，也会把标签一并传给 PATCH。
- 复现：真实 Chromium 对合成语音仅聚焦/失焦两次，数据库中的原 `Plain transcript.` 前面依次出现 1 次、2 次“💬 对话”；字幕同样混入“📝 字幕”。刷新前已直接读 API 确认是持久化修改。
- 影响：选择/复制文本等普通操作就会污染分析正文，随后导出字幕、搜索或再次编排也会使用污染后的内容。正常 visual 字段未改时没有 PATCH；其保存失败会回滚并提示，排除了“所有内联编辑都失败”的泛化。
- 证据：`browser_round7_review.js`、`browser-detail-blur-pollutes-text.png`、`browser-round7-results.json`。

### R41 · P2 · 音乐迁移忽略 checkpoint 忙状态，备份遗漏已提交数据

- 位置：[未检查 checkpoint 结果](/Users/zack/program/python/video_analyzer/backend/db.py:263)、[只复制主 DB 文件](/Users/zack/program/python/video_analyzer/backend/db.py:267)。
- 触发：旧库首次增加 audio 支持，另一个读取事务仍持有旧快照，新提交数据留在 WAL，TRUNCATE checkpoint 返回 busy。
- 原因：PRAGMA 的忙状态是结果行而非异常，代码没有检查，继续把未包含全部 WAL 页的主文件当成整库备份。
- 复现：独立合成旧库先有 1 条素材；保持旧读取快照，再提交第 2 条并运行实际 _migrate。捕获 checkpoint 结果的 busy=1，迁移后的活动库有 2 条，生成的 `.db.bak-music` 只有 1 条，缺少已经提交的第 2 条。将 busy_timeout 缩成 50ms 只为减少等待，没有替换 checkpoint 或文件复制。
- 影响：这份迁移前备份不是完整恢复点，若以后靠它恢复，会遗漏已提交数据。测试中当前活动库数据完整，没有把它描述为迁移立即删掉第 2 条，也没有触碰现有真实备份。
- 证据：`test_busy_checkpoint_backup_misses_committed_wal_row`。无占用时的正常备份、历史扩展字段/BLOB/ID/标签/工程关系保留，以及 DROP 后失败的事务回滚对照均通过。

### R42 · P2 · 旧语音字段迁移按分镜重建索引，工作台搜索出现重复素材

- 位置：[逐分镜重建 FTS](/Users/zack/program/python/video_analyzer/backend/db.py:313)、[工作台直接 JOIN 且不去重](/Users/zack/program/python/video_analyzer/backend/blueprints/workbench.py:96)。
- 触发：从仍含 dialogue FTS 列的旧库迁移，一个素材有多个命中同一搜索词的分析片段，再在工作台搜索。
- 原因：迁移为每个片段插入一条相同 media_id 的 FTS 行，工作台查询按这些行直接展开素材，未按素材去重。
- 复现一：合成旧库只含一个视频、两个 forest 片段；实际迁移后 FTS 有两行。工作台搜索返回 `[1,1]`、media_count=2；画廊同词搜索使用 IN 子查询，正确返回一个素材，不能误报画廊也重复。
- 复现二：真实浏览器在相同迁移后索引状态的合成 fixture 中，工作台未搜索时显示 1 张素材卡，搜索 Synthetic 后显示两张相同的 Synthetic.mp4。
- 影响：工作台素材数量和卡片重复，影响素材浏览与选择；仅限定旧迁移产生的重复索引条件，不等同于原文件重复导入。
- 证据：`test_legacy_dialogue_fts_duplicates_workbench_materials_not_gallery`、`browser_legacy_fts_review.js`、`browser-legacy-fts-duplicate-materials.png`。

### R43 · P1 · 无效模型文本被当作成功结果，覆盖原有有效分析

- 位置：[视频解析失败返回 raw_response](/Users/zack/program/python/video_analyzer/backend/analyzer.py:559)、[图片同类分支](/Users/zack/program/python/video_analyzer/backend/analyzer.py:634)、[保存并标 done](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:415)、[替换旧片段](/Users/zack/program/python/video_analyzer/backend/blueprints/analysis.py:1018)。
- 触发：模型流正常结束，但内容是截断 JSON 或其他无法解析的文本；素材之前已有有效分析。
- 原因：解析失败被降级成含 raw_response 的普通结果，worker 继续调用 save_segments；保存函数忽略 raw_response，用空字段替换旧分析并标记 done。
- 复现：分别执行实际图片/视频 worker、实际编码与解析函数，仅替换模型客户端返回 `truncated response: {`。两类素材原本的有效时间、visual、asr 都变成空字符串，analysis_status 和 progress.step 都是 done；源文件字节保持不变。
- 影响：一次格式错误的模型响应就能无提示丢失已有有效分析，原响应也没有按 raw_response 保存供恢复。不同于 R05 的有效重分析导致片段 ID 关联失效，这里错误输入本应失败，却被提交成成功的空分析。
- 证据：`test_invalid_model_text_marks_done_and_overwrites_good_analysis`，覆盖图片、视频两个 subTest。没有调用真实云端或本地模型。

### R44 · P2 · 普通缩略图失败后反复请求相同失效地址

- 位置：[非封面模式固定返回 waveform 阶段](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1185)、[错误回落重写同一地址](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1202)。
- 触发：图片/视频的缩略图不存在，源文件也离线，接口持续 404；音乐选择波形缩略图时也使用相同分支。
- 原因：错误处理把状态写成 none，但非封面模式的 thumbStage/ thumbSrc 忽略该状态，仍返回 waveform 与原接口 URL，下一次 error 又走同一分支。
- 复现：真实 Chromium 显示一条合成离线图片记录，连续收到 5 次实际缩略图 404，随后仍发出第 6 次完全相同的请求，没有停到 no-thumb.svg。测试对第 6 次提供合成成功图以终止循环，未持续制造请求压力。
- 影响：离线或损坏素材反复占用网络、后端与界面资源，普通缩略图无法完成最终占位回落。本轮实际浏览器验证为图片，不扩大为所有封面回落都失效。
- 证据：`browser_thumbnail_loop_review.js`、`browser-thumbnail-loop-results.json`、`browser-thumbnail-fallback-loop.png`。历史 TODO A37 的风险在当前非封面分支仍然存在。

### R45 · P2 · 画廊右键菜单在窗口边缘超出视口，操作项被裁掉

- 位置：[直接使用鼠标坐标](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1600)、[固定定位且没有边界补偿](/Users/zack/program/python/video_analyzer/frontend/css/main.css:187)。
- 触发：在支持的桌面窗口大小下，靠右边的素材卡片上打开右键菜单。
- 原因：弹层直接从 clientX/clientY 向右下展开，没有根据菜单尺寸与视口计算位置，也没有可见范围内的替代锚点。
- 复现：真实 Chromium 视口 1000×650（不低于 Electron 最小窗口约束），菜单边界为 x=988、y=261、width=202、height=229，右侧超出窗口 190 像素，文字和操作区域被裁掉。
- 影响：边缘位置的正常右键操作无法完整看到/点击菜单项目，需要换位置重新打开。本轮验证了右边缘，不推断所有菜单/所有窗口均受影响。
- 证据：`browser_final_ui_review.js`、`browser-context-menu-clipped.png`、`browser-final-ui-results.json`。对应历史 TODO A36，已由待验证转为实测确认。

### R46 · P2 · 筛选加载失败后静默保留旧素材，条件与列表不一致

- 位置：[load 错误分支不更新显示状态](/Users/zack/program/python/video_analyzer/frontend/js/gallery.js:1415)。
- 触发：先成功筛选视频，再切换图片筛选；图片查询返回 500 或其他被 _fetch 拒绝的错误。
- 原因：筛选条件已经立即改变，但 catch 只打印 console 并停止分页，既不标注失败，也不恢复条件或明确区分旧结果。
- 复现：真实浏览器先显示唯一 Synthetic.mp4；只对下一次图片列表请求注入 500，并等待实际 console 错误分支执行。图片按钮保持选中，列表仍是这个视频，没有通知；移除注入并再次点击相同按钮，正常显示 3 张图片。
- 影响：用户会把旧条件的素材当作当前筛选结果，且不知道查询失败。这与 R08 的两个成功响应乱序是不同触发和不同错误处理缺口，故单列，避免误以为加请求序号就能解决失败状态。
- 证据：`browser_final_ui_review.js`、`browser-gallery-failed-filter-stale-video.png`、`browser-final-ui-results.json`。不是把瞬时旧 DOM 当错误：测试等待请求失败及前端 catch 完成后才断言。

## 验证与环境

- 本次执行 53 个自建 Python 隔离场景（36 个缺陷复现、17 个正常行为对照；同一方法中的 subTest 不另加计数）、8 个 Node 实际组件/轮询函数场景；项目现有 `scripts/test_adv_filter_v2.py` 的 54 项检查全部通过。另有完整 requirements 新环境安装/4 个模块导入检查、真实转码 HEAD 子进程验证与桌面缺失 Python 的隔离启动模拟。真实 Chromium 已验证 R06/R08/R15/R16/R29/R30/R31/R33/R35/R37/R38/R39/R40/R42/R44/R45/R46，并有原生媒体跳转、普通改名撤销/重做、详情编辑失败回滚和筛选恢复对照。这些结果不是宣称现有代码通过整体验收。
- 自建 Python 场景使用专用临时虚拟环境与合成 SQLite，手动注册业务蓝图。现有筛选脚本在独立工作目录和受控 tempfile.tempdir 下执行 create_app，所有初始化、VACUUM、日志与临时清理均位于审查目录，没有对真实数据库调用 create_app/init_db。
- 外部 AI 调用、真实模型启动、真实模型下载和压缩推理均未实际执行；需要的进程、模型 HTTP 调用使用替身。模型下载算法仅操作专用临时目录中的几字节合成文件。
- Node 加载项目实际的 gallery.js/workbench.js 方法，用受控 Promise 顺序和合成 track/plan 数据复现。
- 真实浏览器已覆盖画廊筛选、工作台拖入片段、脑图改写、连续重命名保存乱序、保存失败后的 apply、切换素材详情乱序、结构删除撤销、转码/原生视频跳转、排除照片对、单图片聚类、普通改名撤销/重做/刷新、向导取消重选/apply 失败/关闭后的旧回调、详情正文失焦、迁移后重复素材、缩略图失败回落、菜单边界和列表失败状态；通过的复现脚本均无 pageerror。R16/R38/R46 与详情编辑回滚对照人为注入 HTTP 500，R35 为实际代码与 HDBSCAN 产生 500，R44 使用真实合成离线记录的 404。未全面覆盖所有布局、加载/空态/错误态，也未测试真实模型推理质量、编辑器导入兼容性或大文件内存行为。
- 正常行为对照已通过：不同模型的 acquire_engine 等待全部现有占用释放；FCPXML 的 XML/URL 转义、素材去重、源入出点、时间线空隙与总时长，以及 SRT 跨分钟毫秒舍入；save_segments 保存途中异常，在连接/上下文关闭时回滚，原分析与片段 ID 保留。
- 本轮补充正常对照：音乐规范英文标签与音乐 mood 筛选可检索；补齐直接依赖后本地 OpenAI 客户端可正常构造并禁用代理环境；实际 exiftool 正常成功路径保留已有关键词与描述。XMP 失败窗口测试仅写入生成的合成侧车文件。
- 下载正常断点恢复、已开始传输的 GET 关闭清理、原生视频 Range/后缀 Range/416/HEAD，以及原生 MP4 浏览器进度跳转均有通过的对照。实际 ffmpeg、ffprobe 和浏览器测试只使用本轮生成的媒体。
- 音乐表旧库迁移的正常字段/BLOB/外键关联保留、正常备份，以及 DROP 后故障回滚已在合成数据库验证；未对真实库调用迁移。图片分析 SSE 中断后实际 worker 可继续保存并标 done，不能把连接断开直接等同于任务卡死。
- 真实 `data/media.db` 与 `data/media.db.bak-music` 的大小、mtime 在首轮前后保持不变；没有修改真实媒体、模型或备份。

## 最终覆盖矩阵

| 范围 | 已完成的验证 | 明确边界 |
| --- | --- | --- |
| 库、导入、删除、同步、搜索、筛选 | 源码复核、合成 SQLite/文件、SSE 断连、并发删除/写回、现有 54 项筛选回归、浏览器筛选/错误状态 | 未对真实素材目录执行导入/删除/同步 |
| 工程、方案、时间线、脑图 | 实际蓝图与组件、真实拖放/编辑/撤销/刷新、保存乱序与失败、方案应用 | 未遍历所有鼠标拖动组合与所有多窗口交互 |
| 分析与 ASR | 图片/视频实际 worker + 合成模型流、时间边界、ASR 合并、模型切换受控线程、失败/断连 | 未使用真实权重或付费 API 验证推理质量 |
| 本地 VLM 生命周期和下载 | 占用互斥、启动失败释放、实际下载算法的合成分片/断点/失败/并发 | 未启动真实 llama-server、下载真实权重或验证所有远端服务器行为 |
| 媒体与缓存 | 实际 ffmpeg/ffprobe、Chromium 原生/转码播放与跳转、Range/HEAD/取消清理、缩略图回落 | 未做所有容器/编码器矩阵或大文件资源压力测试 |
| 侧车与导出 | 实际 exiftool 的合成 XMP 成功/失败、FCPXML/SRT 结构和时间、缺失素材导出 | 未进入 Final Cut/剪映/Resolve 验收 |
| 初始化与迁移 | 合成旧库字段/关联/备份/回滚、WAL busy、旧 FTS；真实库仅只读列顺序登记 | 未迁移真实数据库，也未尝试恢复真实备份 |
| 桌面、依赖、部署路径 | 全新 requirements 安装、模块导入、Electron 源码及缺 Python 隔离模拟、数据目录静态检查 | 未生成安装包或启动正式 Electron/业务数据库入口 |
| 历史记录与范围控制 | A1–A37 逐项对照、重复根因归并、源码位置与优先级复核 | 规划/历史功能记录不视为当前实现的通过证明 |

## 待验证与明确未覆盖范围

- 大文件波形：详情页和工作台实际实现会 fetch 整个媒体为 ArrayBuffer，再 decodeAudioData 为全量 PCM；这是静态事实，PCM 大小约为 `4 × 采样率 × 声道数 × 时长` 字节，另有编码文件缓冲。未用真实大素材或危险内存压力测试证明 OOM，不计入已确认缺陷。
- 桌面启动：`electron/main.js:16` 的 spawn 没有 error 监听。隔离 Node 子进程执行实际 ready/startPython 代码，把执行文件替成临时目录中不存在的路径后，出现未处理 ENOENT、退出码 1，预设服务失败回调没有被调用。此测试没有启动实际 Electron 图形宿主，不能据此断言其默认异常弹窗/退出表现；暂不新增已确认问题。证据：`electron_missing_python_harness.js`、`review_electron_start.js`、`electron-start-results.json`。
- 向导预览：`creative-wizard.js:446` 指向当前未注册的 `/media/stream/<id>`；常规选完素材即跳到第 2 步，返回第 1 步又自动打开选择器，尚未验证可稳定到达该卡片预览的正常 UI 路径，不把死分支的 404 计入已确认缺陷。
- 打包与数据目录：仅静态核对 Electron 从系统 Python 启动 run.py、当前没有完整打包脚本，以及 frozen Python 会使用不同数据目录。没有生成安装包、运行正式入口或迁移已有数据，安装包路径、模型资源布局与用户数据衔接尚未端到端验证。
- 真实推理与模型文件：没有启动真实权重、调用付费 API、下载或改动真实模型。网络下载算法和 AI 响应测试均为合成替身，不能替代真实模型质量、资源占用和服务协议兼容性验收。
- 编辑器导入：FCPXML/SRT 的结构与时间对照已测；没有在 Final Cut、剪映或 Resolve 中实际导入，兼容性仍需应用内验收。

## 已登记的数据库列顺序漂移（不计入运行时缺陷数）

- 按本次 AGENTS.md 的列顺序规则，用 `mode=ro&immutable=1` 仅读取现有 SQLite 的 PRAGMA table_info，未初始化、迁移或写入真实库。
- `projects` 共 7 列：created_at 是第 4 列、updated_at 第 5 列，其后还有 creative_brief、ai_plan，未保持最后两列；来源见 [追加业务字段迁移](/Users/zack/program/python/video_analyzer/backend/db.py:211)。
- `media` 共 43 列，updated_at 是第 30 列，其后还有音乐、相机、索引、mtime、封面等 13 列；基础建表中音乐业务字段已位于 updated_at 后，随后 ALTER TABLE 继续追加。见 [建表字段](/Users/zack/program/python/video_analyzer/backend/db.py:41)、[后续迁移](/Users/zack/program/python/video_analyzer/backend/db.py:195)。
- 这是现有结构与工程规则的漂移登记，不代表发现了列顺序导致的运行时数据损坏；后续若处理，需单独受控迁移及授权，本审查不调整数据库。

## 历史 TODO 第二轮审计条目复核

以下仅对照 `docs/todo.md` 的 A1–A37，不把历史描述与旧行号当成当前缺陷证据。

| 历史条目 | 当前结论与证据 |
| --- | --- |
| A1–A2 路径/任意文件读取 | 本地媒体工具需要用户选择绝对路径；未证明可达的外部越权链路，不能单凭任意路径或 DB 路径字段报漏洞。 |
| A3 分析重复入队 | 真实并发与单项/批量路径已确认，合并 R12。 |
| A4 CTranslate2 并发 | 推理库本身线程安全未证实；已独立确认 Python 锁外读取共享模型的 R36，不混为一谈。 |
| A5 压缩返回注解 | 当前为 5 元组，已与调用匹配，旧结论过时。 |
| A6 波形 OOM | 全量读取/解码属实；未证明实际 OOM，单列资源边界。 |
| A7 画廊请求乱序 | R08，含分页及真实浏览器证据。 |
| A8 非法详情 ID | 当前加载失败会退回素材库；未将恶意/损坏 hash 的一次无效请求列成正常流程 bug。 |
| A9 原始 fetch 错误 | 当前详情分析调用者检查 resp.ok 并提示错误，不能仅因未走 _fetch 判断失效。 |
| A10 SSE 断连卡 processing | 图片真实 worker 断连对照可完成；独立后台处理结构已存在，旧因果推断不成立。没有因此承诺所有超时/崩溃均可自动恢复。 |
| A11 保存无事务 | 异常回滚对照通过，旧“DELETE 已永久提交”结论不成立。 |
| A12 配置/资源边界 | 非法配置与资源上限的静态线索，未做恶意参数或危险压力测试，不计已确认。 |
| A13 无效 JSON 当成功 | 当前仍存在，已用图片/视频完整 worker 复现为 R43；raw_response 实际未被 save_segments 保存。 |
| A14 缺 media 外键 | 删除与分析写回竞态已有具体影响，R22。 |
| A15、A33 FTS 特殊字符 | 合并 R07，不重复编号。 |
| A16 转码资源上限 | 按需转码大媒体是产品能力；未实测资源耗尽。具体 HEAD 泄漏/跳转问题分别为 R28/R31。 |
| A17 图片 API 无上下文 | worker 已捕获并记录 media_id/文件名，不能据旧函数局部缺 catch 复报。 |
| A18 关联 ID 校验 | 旧 collections 实现已移除；标签 API 非法 ID 的错误语义未在当前 UI 验证，未单列。标签索引失同步另有 R24。 |
| A19 临时目录相对路径 | 写入与清理都使用相对 temp_video；部署工作目录的风险归打包未验证项，未证明正常开发启动会误删源素材。 |
| A20 画廊加载错误提示 | 最后一轮验证了明确影响：图片筛选失败仍显示旧视频且无提示，R46；未描述为持久化数据丢失。 |
| A21 Collection 筛选 | 旧 Collection 代码路径不在当前源码中，不能用旧行号复报。 |
| A22 SSE body 判空 | 当前真实 SSE 成功路径有 body，非 2xx 已在调用处处理；未证明可达的空 body 成功响应，不计缺陷。 |
| A23 Scope 累积变白 | 当前逐帧创建新 ImageData 并 putImageData 覆盖，旧累积机制不在现实现中。 |
| A24 includes 性能 | 风格/潜在规模优化，没有性能故障证据，不计 bug。 |
| A25 不存在记录假成功 | 单条删除已有 404；update/batch 仍可能返回 ok，尚未证明新的正常 UI 用户影响，未新增编号。 |
| A26 ASR 解析错误无日志 | best-effort 跳过行为，日志不足本身不作为功能 bug；正常时间匹配有对照。 |
| A27 HH:MM:SS | 当前时间解析已支持，跨小时对照通过。 |
| A28 循环导入风险 | 运行时局部导入可正常完成，多个实际刷新索引测试通过；未复现循环导入异常。 |
| A29–A30 导入失败统一 null | 当前 import_single_file 异常会抛出，None 用于跳过/不支持项，旧描述过时。 |
| A31 启动 VACUUM | 事实存在，但未做大库耗时测试，不把潜在慢启动当已复现故障。 |
| A32 schema/迁移字段差异 | 兼容旧字段迁移正常对照通过；物理列顺序的现行规则漂移已另行登记，不等于迁移丢列。 |
| A34 评分/颜色/收藏错误处理 | 当前详情页三者均有 catch/提示，旧泛化结论过时；其他具体错误链路见 R16/R38。 |
| A35 批量删除部分记录丢失 | SQL 写在同一事务；注入缩略图删除失败后媒体记录保留，只有先删缓存的不一致，归 R34（P3）。 |
| A36 菜单越界 | 最后一轮在 1000×650 视口实测菜单超出右边界，R45。 |
| A37 缩略图无限回落 | 当前非封面分支实测重复失败请求，R44；没有仅凭 catch/return 猜测已修复。 |

## 审查记录与完成状态

1. 已初读：Flask 蓝图、数据库 schema/迁移、分析主链路、导入/删除、创意生成/apply、前端素材库和工作台核心保存流程、媒体服务、导出实现。
2. 历史 A1–A37 已逐项收口，启动/旧库迁移与详情编辑主路径已补证，菜单/列表失败边界已验证；覆盖矩阵、优先级、重复根因、行号与条件的最终复核已完成。大文件、打包、真实模型和编辑器兼容性的限制已单列。
3. 本轮无待继续自动检查的任务。后续修复需另行授权；不重跑已确认且代码未变化的全部场景，也不为凑时长扩展至真实数据、真实模型或外部系统。
4. 原“httpx 新安装缺失”线索已通过完整新环境安装确认，合并为 R25；OpenAI SDK 构造器兼容旧 httpx 客户端的对照通过，不另报 SDK 类型错误。音乐 canonical 英文标签检索与筛选已通过；中文标签翻译搜索是否应支持属于需求解释，未列为缺陷。
5. 应用为本地单用户工具，不将“没有多用户登录”等明确产品边界作为安全漏洞上报；安全项需要具体可达路径与复现证据。

### 23:01 心跳续查（北京时间 2026-10-17 23:01–23:10）

- 从上轮待验证区域继续，新增确认 R11–R14，合并了“成功更新丢整理信息”与“探测失败仍删旧记录”的同一 force_update 根因。
- 新增 6 个 Python 场景全部复现预期缺陷，其中视频单项入队状态未认领补充并入 R12；未重跑首轮已经确认的全部场景。
- 真实浏览器经过等待时序和脑图折叠状态修正后，完整复现 R06/R08。初始测试脚本断言失败来自过早读取旧 DOM、未展开叙事节点，不列为产品问题。
- 浏览器使用独立 Flask fixture、合成 DB 与生成视频；没有调用项目 create_app，没有模型预加载。fixture 拒绝分析、导入、设置、模型下载/删除等写入口，仅允许合成工程的轨道/方案/apply 操作和统计请求；浏览器与服务已在本轮结束前关闭。
- 对照旧 TODO：重复导入不再删缩略图的历史修复只覆盖普通导入跳过分支，不能排除当前 force_update 分支的 R11；“按 EXIF 设置文件日期”目前已有 mtime 同步，本轮不对该点重复报错。
- 工程自动保存请求乱序、失败响应被忽略、未分析中文文件名索引、SDK 新安装兼容性仍只是待验证线索，不计入 14 项确认问题。
- 本轮结束复核：Git 仅新增本审查报告；真实数据库与 `.bak-music` 的大小、mtime_ns 均与首轮基线完全一致，报告中的本地源码链接均存在。

### 00:02 心跳续查（北京时间 2026-10-18 00:02–00:10）

- 新增确认 R15–R21。真实 Chromium 验证 2 条工程保存链路；新增 8 个 Python 场景，其中 5 个复现下载/导出问题、3 个正常行为对照全部通过。
- 下载测试完全替换网络源、缩小分片门槛并使用合成模型目录；有两项使用真实受控线程验证传输等待/任务认领，没有启动推理服务或下载权重。
- 导出正常对照覆盖 XML/URL 转义、空隙、源时间段与 SRT 舍入。未进行 Final Cut/剪映/Resolve 实际导入；不将格式兼容性推测列为已确认问题。
- 排除旧 TODO 的过时结论：A11 所称“save_segments 没有事务保护”不成立，当前 SQLite 默认事务与连接关闭回滚已用异常场景验证；A3 的“processing 已防止重复提交”只对部分入口成立，实际缺陷继续合并在 R12；A7/A15/A33 与已确认 R08/R07 同根因，不重复编号。
- acquire_engine/release_engine 的正常跨模型互斥已验证，不能仅凭历史并发担忧断言视频和音乐一定会互相重启服务。引擎手动启停/失败路径、下载 sidecar 恢复仍待验证。
- 浏览器脚本首轮运行即完整复现两项保存问题；Python 导出测试曾因测试代码拼接 header 元组报错，已改为读取 header 名并仅复跑受影响场景，此错误不计为产品问题。
- 本轮结束时浏览器与隔离 Flask 服务已关闭。Git 仍仅有本审查报告；真实 DB/备份大小与 mtime_ns 保持基线，未改业务代码、媒体、模型或配置。

### 01:02 心跳续查（北京时间 2026-10-18 01:02–01:12）

- 新增确认 R22–R26；并发批量重复提交合并进 R12，旧分页响应污染筛选结果合并进 R08，避免相同根因重复编号。
- 本轮新增 8 个 Python 场景：5 个缺陷复现、3 个正常对照；另执行 2 个 Node 实际前端函数场景。两个并发场景使用真实受控线程和合成 SQLite，推理本身使用替身。
- 完整解析并实际安装 requirements 到新的独立虚拟环境，保存依赖闭包、安装清单和 4 个模块导入失败结果。全程没有调用 create_app，也未启动 Electron/后端正式实例，避免初始化真实数据或加载模型。
- 实际 exiftool 仅操作新生成的 JPEG/XMP；成功合并对照通过，最终写入失败场景确认会先丢关键词。没有把“所有 XMP 更新都会覆盖原元数据”作为结论。
- 排除一项测试误报：初次通过修改共享 httpx.Client 类捕获实例，影响了 SDK 的 isinstance 检查；改为只替换 analyzer 的模块引用后，构造器正常通过。因此没有新增“SDK 不兼容”问题。XMP 测试也修正了 exiftool 单个 Subject 可能返回字符串的断言；这些均属测试脚本问题。
- 历史 TODO 中 A14 的缺少 media 外键现在有真实删除/写回竞态证据，归入 R22；R24 仅确认仍注册的标签 API，当前前端未找到调用，不夸大用户交互覆盖范围。
- 另初读 Electron 主进程/预加载桥接、启动等待与系统 Python 派生流程，以及工程撤销快照实现；未仅凭代码风格或未打包 TODO 新增缺陷。仍需对未覆盖的实际边界验证。
- 结束复核：Git 只有本审查报告，真实 `media.db` 与 `.bak-music` 的大小、mtime_ns 均与初始基线一致；没有仍运行的测试线程、下载器或服务。

### 02:03 心跳续查（北京时间 2026-10-18 02:03–02:15）

- 新增确认 R27–R31。新增 5 个 Python 场景（2 个复现、3 个正常对照）、2 个 Node 实际组件场景；真实浏览器新增素材详情乱序、结构删除撤销、流式转码跳转 3 条复现链路及相同编码内容的原生 Range 播放对照。
- 下载测试用 64 字节合成数据；恢复失败不依赖并发，顺序执行分片线程以排除其他竞争。没有再运行已确认的 416 下载场景。
- 检查前端 key 后排除“详情页和工作台一样会串素材”的泛化结论：独立详情页按 detailId 重建，工作台则确有旧响应覆盖。大视频波形会整段取回/解码是代码事实，但本轮没有以危险大内存测试断言必然 OOM。
- 对照正常部分：原生媒体 bounded/suffix Range、无效 Range 的 416、HEAD 无 ffmpeg；已开始 GET 流后中断可清理子进程；有效 part+sidecar 可正确续传。没有把所有媒体播放/清理都描述为损坏。
- 浏览器初期脚本等待了不存在的脑图空态子组件，以及刷新后仍折叠的元数据栏，产生测试等待超时；改用实际空态/折叠状态后，两条复现脚本完整通过。转码跳转另拆独立脚本，避免重跑无关已确认场景。
- 真实 HEAD 确认遗留 ffmpeg 后，SIGTERM 未解除阻塞写；已只对该隔离 fixture 新建且验证父 PID/素材路径的进程强制结束，并通过下一次 Popen 清理回收，保存结果为 cleaned_up=true。未触碰真实应用或模型进程。浏览器与隔离 Flask 服务随后均关闭。
- 流式转码/原生对照使用同一次实际 ffmpeg 响应另存的合成 MP4；ffprobe 分别确认源 AVI 12.000 秒、转码文件 12.023 秒。原生跳转成功，所以 R31 不是仅凭缺少响应头推测。
- 结束复核：业务代码仍未变化，Git 仅本报告，真实 DB/备份大小与 mtime_ns 仍为初始基线。

### 02:59 心跳续查（北京时间 2026-10-18 02:59–03:08）

- 新增确认 R32–R36，其中维护 API 的缩略图失败窗口按 P3 记录，并明确缺少当前前端 force 调用入口及自动重建补偿，避免夸大影响。其余 4 项按 P2 记录，未新增 P1。
- 新增 7 个 Python 场景：5 个缺陷复现、2 个正常对照；Whisper 竞态使用两个真实受控线程，推理和模型构造为替身，未加载真实权重。聚类使用独立 requirements 环境已安装的真实 HDBSCAN；两环境 numpy 均为 2.5.4，未重新安装或修改依赖。
- 真实浏览器复现三图排除失效与单样本聚类 500；普通时间线改名 → 撤销 → 重做 → 刷新对照通过，不能把 R30 泛化为所有撤销都损坏。浏览器无 pageerror；聚类错误被组件吞为无结果，这次 500 没有注入。
- ASR 正常对照最初把两侧各重叠 1 秒的平局误写为应选择后段；实际实现约定取最先达到最大值的片段，没有违反合同。已把对照改成不等重叠后通过；没有把测试预期错误列为产品问题。
- 核对组件 key 后排除“切换工程使旧保存写入新工程”的直接推断：主页面为 workbenchId 设置 key，切换会重建组件，不能仅凭异步函数里读取 this.project.id 就报告跨工程覆盖。
- 复核旧 TODO：UUID 缩略图和普通重复导入的修复仍有效；本轮 R34 是另一条强制批次重建失败路径。排除/恢复功能当前仍存在，R33 是实现未兑现已完成行为；没有把已移除的 SHA256/pHash 检测要求当作缺陷。
- 本轮浏览器与隔离服务已关闭，临时 Playwright 脚本已移回审查根目录；Git 仍只新增本报告，真实 DB/备份大小、mtime_ns 保持初始基线。
- 已校正心跳触发分钟，使仍未提前完成时可在北京时间 07:35 安排最后一次复核，处于 07:30–07:57 的交付窗口；保留原审查提示、当前聊天、结束时间和静默偏好。原整小时间隔可能在 07:30 之前触发最后一轮而错过该窗口。最终交付后仍须停止自动化，不能仅依赖到期。

### 03:38 心跳续查（北京时间 2026-10-18 03:38–03:46）

- 新增确认 R37–R39，均为创作向导的 P2 交互/异步错误；损坏 sidecar 导致线程异常仍验收全零文件的证据合并进 R27，未重复编号。
- 本轮 4 个 Python 场景中 1 个扩展既有缺陷，3 个正常对照：导入/同步在首个成功事件后关闭 SSE，该条记录和缩略图仍保留；生成断连后后台线程可独立保存有效方案。每文件 _import_one 本来就会 commit，排除“断连回滚整批成功导入”的推断。
- 新增 2 个 Node 实际 startGenerate 场景：apply 失败无提示、正常应用可完成；浏览器另验证取消重选、应用失败、关闭后旧完成事件强制导航。模型调用全部替身，但生成蓝图、DB 保存及前端为实际代码；只有 R38 的 apply 500 人为注入。
- 生成断连对照曾因重复插入默认 settings key，以及把 R10 校验器额外加的空 act.shots 当成完全相等而失败，调整隔离测试的种子与断言后通过，不计为新产品问题。
- 桌面启动缺 Python 的模拟复现未处理 error 事件，但未在真实 Electron 图形宿主验证影响，单列待验证；向导未注册预览 URL 也因常规 UI 可达性未证实而未计数。未将缺打包流程的历史需求直接报成运行时 bug。
- 静态完成大文件波形与打包目录核对；按 AGENTS.md 登记真实库列顺序漂移，仅用 immutable 只读 PRAGMA，真实数据与备份未改。
- 本轮浏览器与隔离 Flask 服务均已关闭，临时 Playwright 脚本已移回专用审查目录；Git 仅本报告，真实 DB/备份大小和 mtime_ns 与初始基线一致。

### 04:35 心跳续查（北京时间 2026-10-18 04:35–04:46）

- 新增确认 R40–R44，其中 R43 为 P1：真实图片/视频解析与 worker 在无效模型内容后成功覆盖空分析。模型客户端和视频压缩为替身，未发真实 AI 请求，也未动源素材。
- 新增 7 个 Python 方法场景：4 个缺陷复现（含 R34 扩展）、3 个正常对照；视频/图片同一方法的两个 subTest 不重复计数。真实浏览器新增正文前缀污染、迁移后工作台重复卡片和离线缩略图失败循环三条链路，并验证普通 visual 未改不保存、失败回滚和提示。
- 音乐迁移通过了历史扩展字段/BLOB/评分/备注/ID/关联保留、无占用备份和 DROP 后失败回滚对照；不再泛称表重建必然丢数据。真实故障是 checkpoint busy 被忽略后备份缺少 WAL 提交，当前活动库在该复现中完整保留两条。
- 初始旧 FTS 测试按过时响应结构读取 total 并假定画廊 JOIN，检查实际源码后改为当前 pagination/data。画廊 IN 会去重，只有工作台 JOIN 实际返回重复，故 R42 明确限定工作台；浏览器复核也通过。
- 缩略图测试只允许前 5 次真实 404，第 6 次合成成功返回主动终止循环；没有持续施压后端。所有异常注入和离线素材均在本轮专用临时目录。
- 历史 TODO A1–A37 的处理已制表：区分已复现、历史已改、需求边界和未验证项，避免把所有旧审计点一并列入本次问题数量。
- 本轮浏览器、隔离服务及受控分析线程已退出；临时 Playwright 脚本已移回审查根目录；Git 仅本报告，真实 DB 与备份的大小/mtime_ns 仍与初始基线相同。

### 05:30 最终续查与交付（北京时间 2026-10-18 05:30–05:37）

- 新增确认 R45/R46；P1 仍为 13 项。两项分别是视口边界计算缺失、加载失败显示状态缺失，与成功请求乱序的 R08 区分。
- 项目现有筛选回归脚本实际执行并全部通过：54 项，0 失败。包装脚本将工作目录和 tempfile.tempdir 都固定在审查根目录，未用正式库、未预加载模型。
- 浏览器脚本初次在含 @mousedown.stop 的素材卡上尝试全局关闭菜单，随后又过早读取了筛选切换前的 DOM；改为独立用例之间刷新页面，并等待视频查询响应和 DOM 替换后，两项完整复现及正常筛选恢复对照通过。这些测试时序问题未计为产品缺陷。
- 最后只补未覆盖场景并核对证据，没有重跑全部已确认的 53 个自建 Python 场景；已有失败断言均已在对应修正后的隔离场景验证通过。
- 源码清单记录 43 个核心文件哈希，业务代码无 diff。报告保留每条优先级、条件、影响、行号与结果；明确未验证的推测没有混入 46 项计数。
- 审查提前结束，保留报告及轻量复现证据；测试服务、浏览器、受控线程和进程已停止，合成数据库/媒体/虚拟环境清理结果见文末。自动化在交付前停止，不再继续检查。

### 复现证据与临时环境（不是业务文件）

- 根目录：`/var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur`
- Python 脚本：`/var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/review_repros.py`
- Node 脚本：`/var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/review_frontend_repros.js`
- 本轮 Python 脚本：同目录 `review_followup_repros.py`，其入口只执行新增的 6 个场景。
- 浏览器：同目录 `browser_fixture.py`、`browser_review.js`、`browser-review-results.json` 与 `browser-*.png`。fixture 已停止；再次验证应重新启动 fixture 并读取新生成的 `browser_fixture.json`，不要复用已关闭的端口。执行期间使用的 `/tmp/playwright-test-video-analyzer-20261017.js` 已移入专用临时目录保存。
- 00:02 轮：同目录 `review_round2_repros.py`（仅运行本轮 8 个场景）、`browser_save_review.js`、`browser-save-results.json`、`browser-save-*.png`。执行期间的 `/tmp/playwright-test-video-analyzer-save-20261018.js` 已移回专用临时目录；`browser-fixture-round2.log` 仅含合成服务请求记录。
- 01:02 轮：同目录 `review_round3_repros.py`（仅运行本轮 8 个场景）、`review_round3_frontend.js`、`dependency_check.py`、`dependency-check-results.json`、`dependencies-resolve.json`、`requirements-venv-freeze.txt`；第二个依赖核查环境为 `requirements-venv/`。两个虚拟环境都仅属于本次临时审查，结束时与合成数据一并清理。
- 02:03 轮：同目录 `review_round4_repros.py`（本轮 5 个场景）、`review_round4_frontend.js`、`browser_fixture_round4.py`、`browser_round4_review.js`、`browser_transcode_control.js`、`real_head_check.py`、相应 `*-results.json` 与截图。临时 `/tmp/playwright-test-video-analyzer-*.js` 已移回此目录；`review-transcoded.mp4` 是生成 AVI 的合成转码结果，和真实素材无关。
- 02:59 轮：同目录 `review_round5_repros.py`（本轮 7 个场景）、`browser_fixture_round5.py`、`browser_round5_review.js`、`browser_single_cluster_error.js`、`browser-round5-results.json`、`browser-excluded-pair-reappears.png`、`browser-single-image-cluster-500.png`。临时 `/tmp/playwright-test-video-analyzer-round5-20261018.js` 与单项错误态补查脚本已移回此目录。
- 03:38 轮：同目录 `review_round6_repros.py`（本轮 4 个场景）、`review_round6_frontend.js`、`browser_fixture_round6.py`、`browser_round6_review.js`、`browser-round6-results.json` 与 3 张向导截图；桌面模拟为 `electron_missing_python_harness.js`、`review_electron_start.js`、`electron-start-results.json`。临时 `/tmp/playwright-test-video-analyzer-round6-20261018.js` 已移回此目录。
- 04:35 轮：同目录 `review_round7_repros.py`（7 个方法场景）、`browser_fixture_round7.py`、`browser_round7_review.js`、`browser_thumbnail_loop_review.js`、`browser_legacy_fts_review.js`、各自结果 JSON 与截图。3 个临时 `/tmp/playwright-test-video-analyzer-*.js` 已移回此目录；legacy.db 与 `.bak-music` 都是此轮新生成的合成数据，非已有备份。
- 05:30 轮：同目录 `browser_fixture_round8.py`、`browser_final_ui_review.js`、`browser-final-ui-results.json`、菜单/加载失败截图、`run_existing_filter_contract.py`、`existing-filter-contract-results.txt`、`source-manifest.json`、`audit-venv-freeze.txt`。本轮临时 Playwright 脚本已移回。
- 复现命令：

```sh
PYTHONDONTWRITEBYTECODE=1 /var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/venv/bin/python /var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/review_repros.py
node /var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/review_frontend_repros.js
```

- 后续只在出现新变化、需要复核或新增复现场景时再运行相关检查，不重复运行已确认且代码未变化的全部测试。
- 测试数据库、生成媒体和虚拟环境已在最终核验后清理；保留脚本、版本清单、合成结果 JSON、截图与日志，详见证据目录的 README。上面的命令为原运行环境记录，重新执行前须按保存的版本清单重建虚拟环境；旧 browser_fixture.json 的端口/DB 路径已失效。
- 有限期自动化 ID：10；本次完成交付后停止。最终状态与清理验证写入下方交付核验。

## 交付核验

- 46 项编号连续，优先级统计为 P1 13、P2 32、P3 1；117 个本地源码链接存在且行号有效。53 个自建 Python 方法的清单与统计一致，既有筛选脚本 54 项全部通过。
- 43 个核心源码哈希与最终清单一致，Git 业务代码无 diff，工作区唯一新增项为本报告；没有提交、推送或部署。
- 真实 media.db 仍为 73,740,288 字节、mtime_ns=1790473982121244624；现有 `.bak-music` 仍为 73,216,000 字节、mtime_ns=1787058832915674425，与初始基线相同。
- 已关闭审查 fixture 与浏览器；清理 70 个合成 case 目录、2 个虚拟环境及 3 个测试运行/缓存目录，删除生成的顶层转码媒体；没有删除真实模型、源素材或现有备份。
- 仅保留约 2.6 MB 的脚本、合成结果、截图、日志与版本/哈希清单：[复现证据索引](/var/folders/c8/vyx6__614hs4kb2xs86z1vsh0000gn/T/video-analyzer-review-eiyvkxur/README.md)。证据目录位于系统临时目录，最终问题与复现描述已完整写入本报告，临时目录被系统清理也不影响问题清单。
- 自动化 10 已设置为 PAUSED，周期检查已停止。状态、证据与清理结果分别记录在 `delivery-verification.json`、`cleanup-results.json`；本轮无修复动作。


## 2026-10-18 用户授权修复后的状态

用户已授权修复。原审查条目保留作为缺陷复现历史；R01–R46 的代码修复、验证和未验收范围见 [修复记录](code-fixes-2026-10-18.md)。本次没有对真实库执行数据恢复或重排字段。
