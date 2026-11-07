# 回归测试

2026-11-07 workflow closeout：本次重新执行frontend16、gallery17、inspector8、creation-time8、taxonomy30项状态回归及people序列化／过期响应／路由／编辑快照，全部通过；另核对当前63个Python／52个JS文件语法、既有400项Python／24组设置浏览器证据与相应源码摘要。已安装1.0.24的全部56个项目冻结模块、桌面入口及65项运行资源与源码匹配，复用现有包和本机验收，不再次部署。用户追加询问触发的隔离诊断确认：高质量重扫只消除画质类等审核，旧相似度型face／merge审核可能残留；这不是已修复回归或模型准确率结果。证据和未验范围见[收尾报告](../.kiro/specs/smart-classification/closeout-report.md)及`build/closeout-1.0.24-2026-11-07/`。

2026-11-07正式版1.0.24：独立人脸视频压缩1080p／原片选项已打包更新本机，并按用户要求以默认1080p继续原暂停队列。源代码400项Python、24组浏览器及人脸异步状态证据沿用下文开发记录；本次新跑桌面路径／迁移／即时切换、冻结环境自检、签名及DMG／ZIP完整性。冻结包七个相关后端模块与已测试源码规范化字节码一致，并直接执行冻结的video_settings验证缺省1080及原片null；首次常量检查把编译后的选项元组当作独立常量而报错，修正验证脚本后通过，未因此修改业务代码或重打包。47个前端文件一致，不含私人数据库或外部模型。冻结包在真实库副本完成四条路由、七个设置页、默认1080p两项菜单、图库伸缩及双列核对只读检查，零写请求／异常／失败请求，48表和自动升级快照一致。实际安装再核验48表与21565个既有文件；原生设置确认1080p后从Header继续2890项原暂停任务，594项视频任务逐一核对为当前1080p配置，原1101项等待任务、已完成任务和人工决定保留。见`docs/local-update-1.0.24-2026-11-07.json`及`build/release-1.0.24/`。

2026-11-07独立人脸视频压缩（UI规范1.43，源码阶段验证）：新增`test_video_face_resolution.py`8项，验证1080p默认与原片往返、非法值原子拒绝、视频AI分辨率隔离、照片历史配置键、已完成结果与暂停队列保留、旧排队视频领取前重排、在途视频取消旧租约并保留新任务、视频适配器传参，以及真实FFmpeg合成横屏4K输出1920×1080／3840×2160、竖屏1080×1920、小视频不放大、原文件SHA不变／无中间文件。小型合成ONNX通过实际独立worker验证null原片与1080p请求切换、进程和身份空间复用。先写的7项在修复前3项失败、4项报错；随后8项通过，完整Python400项通过。两项原来要求复用视频分析分辨率的回归改为独立语义，未删减验证。

Playwright使用两个全新合成设置fixture：新增6组验证两项菜单、默认不写入、说明／键盘、保存／重开／取消／跨页草稿、非法值、失败重试、仅缺新字段的旧后台阻止写入、读取失败，以及四主题明暗／1000与1440px／英文。原设置18组继续通过，共24组、48项主题尺寸几何记录，无页面异常或失败请求；人脸异步状态及JS语法检查通过。首次几何检查误从combobox内部节点找外层控件而失败，修正测试脚本祖先定位后全组通过，初次输出另存保留。源码行为与来源见`docs/PEOPLE-SCANNING.md`，日志、亮暗截图和结果位于`build/video-face-resolution-setting-2026-11-07/`；两个测试服务、临时资料库和临时浏览器脚本已清理。未修改真实设置、素材或模型，未打包、替换本机或恢复正式暂停队列。

2026-11-07正式版1.0.23：视频同轨迹归组修复已打包并更新本机，源码392项Python与13组浏览器证据沿用下文记录。本轮新跑桌面运行／模型路径／迁移及即时切换检查、冻结环境自检、签名、DMG／ZIP完整性；五个相关后端模块规范化字节码与源码匹配，47个前端文件一致，无私人数据库或外部模型。冻结包在资料库副本完成4条路由、7个设置页、图库伸缩与双列核对的只读浏览器检查，零写请求／页面异常／失败请求；48张表、物理列序及自动升级快照验证通过。安装后在暂停状态再次核验48张表及17659个既有文件，随后通过原生Header继续4168项原暂停任务，观察到运行和完成；原1100项等待任务、人工姓名和归属、用户0.50基准／0.45校准阈值与64条有效反馈保留。未额外重扫或自动合并历史人物；未重新评测真实视频准确率。交付见`docs/local-update-1.0.23-2026-11-07.json`，过程证据位于`build/release-1.0.23/`。

2026-11-07视频同轨迹归组修复（UI规范1.42，源码阶段验证）：此前合成探针已复现相同track_id两张代表脸仍创建两个人物。新增`test_video_identity_grouping.py`16项，覆盖不同姿态只建一个身份、综合特征匹配既有人物、特征冲突与候选歧义改为核对、不同轨迹／视频／缺编号隔离、较晚的人工代表引导新样本、人工冲突／排除／非人脸保护、保留历史归属及重扫纠正建议、质量提示转为出镜提示不消失、已忽略不重开、失活观察提示解决，以及跨1000条写入边界不断开轨迹。最初九项在修复前八项报错、一项失败，随后补齐约束回归；最终完整Python392项通过。没有新增数据库表／列、模型、设置或固定时间约束。

`video-track-review-browser.cjs`新增四组，真实浏览器用独立合成库和受控review响应检查「出镜待核对」「归属待核对」、当前／建议归属、aria-describedby、Chromium可访问描述、键盘及取消零写入、四主题明暗／1000与1440px／英文。归组产生的真实原因由Python专项验证；本浏览器脚本只验证渲染。原双列卡片／实际纠正／撤销／原图返回九组继续通过，共13组浏览器检查，无页面异常或失败请求；人物异步状态回归、前端语法及diff空白检查通过。日志、亮暗截图和结果在`build/video-track-identity-2026-11-07/`，测试服务和资料库清理；源码验证阶段未扫描真实素材、加载真实权重、改写生产数据、打包或替换本机1.0.22，随后正式交付见上文。真实视频识别准确率与历史错分人物自动修复不属于本轮验证；历史人物不自动合并。

2026-11-07正式版1.0.22：将取消人脸十分钟上限、待核对全量重扫及普通照片低清离线保护一并打包更新本机。源代码151项相关Python与14组浏览器证据沿用上文对应功能记录；本轮新跑桌面运行／路径、九组模型迁移及六组即时切换，冻结环境自检、签名、DMG／ZIP完整性通过。冻结包三个相关后端模块规范化字节码逐一匹配源码，并确认worker不含旧600秒轮次判断；47个前端文件一致，不含私人数据库或外部模型。

真实库副本中四个主要页面、七页设置、图库布局、双列核对及全量重扫只读预览通过。正常启动识别前，48张表、物理列序、11,835条素材、两个工程、16,535个原资料文件、模型配置及升级快照核验一致。验收GUI退出后曾有分离后台存活，重复启动触发资料库锁；保留日志／版本／快照，正常结束该占用进程后以系统LaunchServices启动同一1.0.22，未回退或恢复数据。新版原生窗口确认1259项重扫预览并取消；全部原表再验一致后，正常启动接续3366项旧预算暂停任务。继续期间额外核对已完成／无关任务、原有姓名、人工归属和其余44张表保持不变；自动识别自然可更新人物、观察、建议与队列四张表。证据及已解决的启动诊断在`build/release-1.0.22/`，完整本机交付记录为`docs/local-update-1.0.22-2026-11-07.json`。

2026-11-07待核对全量重扫（UI规范1.41，源码未打包）：新增`test_people_review_rescan.py`七项，覆盖两个核对类别跨页关联、同素材去重、超过1000项、活动租约与排队幂等、已解决／忽略排除、仍待核对的旧失活观察纳入、空范围、模型停用、人工姓名／归属与历史保留，以及低清离线先等待且不加载模型。最初六项在修复前两项失败、三项报错；新增空范围用例随后补齐。`test_face_engine.py`新增三项，验证普通照片320／799／800px缓存边界、在线原片优先于小缓存、原片损坏不能退回模糊缓存；RAW既有高清缓存和方向回归不变。人物93项、图像输入19项、RAW10项、模型停用8项及视频21项，共151项通过；不是完整Python套件重跑。

`people-review-rescan-browser.cjs`五组在`PEOPLE_REVIEW_FIXTURE=1 PEOPLE_RESCAN_FIXTURE=1`的全新独立库中通过真实队列API验证：全部分页去重、取消零写入、读取loading／失败重试／空范围／迟到结果、提交失败保留与防重复、四主题亮暗和1000／1440px、英文、32px动作按钮、Chromium可访问树和键盘焦点、Header暂停／继续／停止，以及原核对记录不删除。原`people-review-inline-browser.cjs`九组纠正／撤销／原图返回回归通过，无页面异常或失败请求。测试只写合成库且关闭推理worker，不读取真实素材或加载真实模型；未替换本机应用。日志及截图在`build/people-review-rescan-2026-11-07/`，测试资料库随后清理。

2026-11-07人脸后台自动续跑：新增`test_people_scheduler.py`九项，修复前五项失败，复现处理长素材、等待前台和共享推理锁超过600秒后停机，以及旧预算暂停不恢复和中断原因误报；修复后全部通过。人物相关86项、分类调度6项、Header后台汇总7项、模型停用8项、视频管线21项，共128项通过。覆盖旧预算项的定向恢复、手动暂停／取消／模型停用优先、迟到结果不提交、缺原片／推理失败不阻塞后续素材且不无限重试。未重跑与本次后台改动无关的完整套件。

真实浏览器另以四张合成图片、替身推理和可控时钟运行完整队列：推进到3600个模拟秒后Header仍显示活动任务，手动暂停保持、继续和停止均通过，已完成项不丢失，无页面异常或失败请求。3组检查及截图、Python日志在`build/people-auto-continue-2026-11-07/`。不是实际持续运行一小时或真实模型性能测试。正式库仅只读核对，确认3366项暂停的原因为旧时间预算；没有修改生产队列、模型、素材或本机应用，本次源码修复尚未打包。

2026-11-07 正式版1.0.21：桌面运行／路径、9组模型迁移与6组即时目录切换检查通过；冻结运行环境自检通过。系统iconutil在沙箱内拒绝有效iconset后，仅在正常系统权限下重跑图标与Electron打包步骤并成功，未重写业务实现；原日志保留。签名、DMG／ZIP、47个前端文件与ASAR载荷核验通过，未包含私人数据库或外部模型权重。

冻结包在实际资料库的隔离副本验证4个主要页面、7页设置固定高度、图库检查器宽度重排，以及40张实际待核对卡片的双列／窄窗单列、角色标注、头像点选与取消；无API写入、页面异常或意外失败请求。48张表及物理列序、自动升级快照、模型路径与既有队列均核验一致。实际安装后，原生窗口确认双列和头像点选，取消后未保存任何归属。来源9组浏览器与人物状态回归沿用已验证源码，本轮不重复运行真实模型或后端全套；正式库11,835条素材、2个工程和16,531个须保持不变的资料文件通过校验，原3,366个暂停任务及等待状态保留。完整证据见`build/release-1.0.21/`及`docs/local-update-1.0.21-2026-11-07.json`。

2026-11-07 双列人脸卡片：用户补发参考图后，最终布局改为常规桌面固定双列、1000px窄窗单列，左侧大预览与右侧当前／建议归属并排，底部动作。头像纠正改为480px锚定面板，三列头像并保留同一编辑器及所有原有纠正、撤销接口。`people-review-inline-browser.cjs`沿用脚本名，现验证双列位置、面板关闭重开／外部关闭、头像异步载入后的自动避让和1000/1440px四主题明暗视口边界，以及先前的九组业务／失败／键盘回归；没有新增数据库或模型修改。历史单列版本的证据继续保留，当前基准为UI规范1.40与`docs/components/PEOPLE-REVIEW.md`。本轮证据在`build/people-review-cards-2026-11-07/`，正式应用未替换，合成预览服务继续保留供用户查看。

2026-11-07 人脸核对C方案：`people-review-inline-browser.cjs`连接设置`PEOPLE_REVIEW_FIXTURE=1`的`people-browser-fixture.py`，新增9组验证带明确当前／建议归属的原位条目、同名编号、头像选择与搜索、选择／取消零写入、版本快照、单张／批量纠正、五种归属／人脸纠正及撤销、忽略、Footer更新、原图返回、合并预览、读取加载／空／错误／重试、提交中防重和409失败保留草稿，以及四主题明暗／1000与1440px中英文。自动检查头像按钮的名称、按下状态、Tab／Enter／Space／Escape、焦点及32px共享滑动分段控件；不是完整WCAG审计。

原`people-browser.cjs`17组和`people-layout-browser.cjs`7组通过，共33组浏览器检查、40项主题与尺寸几何记录，无页面异常或意外失败请求。旧回归的拆分操作改用头像编辑器中的新建按钮，历史设置输入断言对齐已有的只读套装卡片，没有删减实际业务断言。`people-state-regressions.cjs`通过并补验展开时ID／版本不被后台刷新覆盖、离开后成功回调只刷新共享资料，以及关闭前先解除busy；`test_people_integration.py`6项通过。本轮未重跑后端全套、真实模型准确率或打包；正式应用和真实库不写入。证据在`build/people-review-inline-2026-11-07/`，源码组件及设计契约见`docs/components/PEOPLE-REVIEW.md`；一个合成预览服务按需保留供用户查看，其他测试夹具验收后清理。

2026-11-07 图库对齐与检查器宽度：`gallery-layout-resize-browser.cjs` 使用 `VIDEO_ANALYZER_TEST_FIXTURE` 指定的独立 `browser_fixture.py`，需开启 `VIDEO_ANALYZER_STACK_FIXTURE=1` 提供足够完整行。5组覆盖排序／分组与视图到检查器8px、开关后的完整行铺满、1000/1280/1600/1920px、素材库/喜欢/分类的单选与未选中不位移、四种视图、侧栏伸缩、键盘/面板关闭、KeepAlive停用及卸载后释放观察器与重新激活恢复。复现时视图到检查器间隔224px、关闭后完整行右侧空304px；修复后分别为8px和0px（允许1px取整误差）。新增检查无业务写入或页面异常，原详情/图库/检查器41项状态回归通过，证据在 `build/gallery-layout-resize-2026-11-07/`。原控件回归须单独使用普通UI夹具，避免将堆叠的16维合成向量与原2维样本混入查重用例；标签操作使用其原people夹具。

原 `gallery-controls-browser.cjs` 12组和 `tag-actions-browser.cjs` 7组／24个主题与尺寸几何场景通过，共24组浏览器检查。控件夹具的合成音频没有内嵌封面，精确 `/media/cover/` 404单列为预期缺图，其余失败请求与异常仍须为零。1.0.20冻结包另在真实库的隔离副本验证4条页面路由、7个设置页、1000/1600px下检查器开关后的完整行与8px控件间隔；48张原表及物理列序不变。实际安装后在原生窗口再次展开、收起检查器，图库重新铺满；数据、模型与原暂停队列均保留，交付见 `docs/local-update-1.0.20-2026-11-07.json`。本次界面修复未重跑Python全套，357项及RAW/归组冻结功能结果沿用上一版本的记录。

2026-11-07 RAW清晰度与归组阈值：Python完整357项通过，新增 `test_raw_face_preview.py` 10项和 `test_people_grouping.py` 9项。覆盖大预览选择／损坏回退／LibRaw回退、方向与2560px上限、高清缓存离线复用和版本隔离、原片变化／失败不发布、384px展示与112px身份输入分离，以及阈值保存／边界／步长、模型隔离、样本门槛、关闭、撤销、低质排除、负反馈优先、队列保留和只读摘要。原导入单次优先提取与8种方向回归继续通过；原小图样本改用真实规格的大内嵌JPEG检验一次提取快路径，小图另验证继续寻找更大预览。

RAW测试使用合成相机JPEG及替身LibRaw调用，实际验证Pillow解码、尺寸、方向、缓存文件、原图读写保护与浏览器显示；未取得在线NEF复测真实解码或身份准确率。已有合并历史另做只读标量预览，近用模型19条同一人反馈可将0.55基准校准为0.50；该检查没有改写生产阈值。

`people-grouping-settings-browser.cjs` 新增6组，使用 `RECOGNITION_SETTINGS_FIXTURE` 指定的独立识别设置夹具，覆盖保存／取消／校验／失败草稿、键盘及可访问名称、四主题亮暗与1000/1440px。夹具设置 `FACE_MODEL_SETUP_FIXTURE=1 MODEL_SELECT_FIXTURE=1`，不会加载真实权重。原 `recognition-settings-browser.cjs` 18组使用其原夹具配置 `FACE_MODEL_SETUP_FIXTURE=1` 回归通过；不要给该旧脚本额外开启MODEL_SELECT_FIXTURE，它按原夹具的模型ID回退显示作断言。

`raw-preview-browser.cjs` 新增3组，夹具需 `RAW_PREVIEW_FIXTURE=1`，真实浏览器检查合成离线NEF的2400px缓存、无预览的提示／结束加载／键盘重试和亮暗窄窗口。HTTP404为预期合成缺图，不是脚本异常。两组新增浏览器脚本无页面异常，RAW检查无业务写入；归组检查只写合成设置。详情返回／异步前端原33项状态回归也通过。证据位于 `build/raw-and-grouping-2026-11-07/`；未打包更新生产、启动真实模型推理或修改真实设置。

2026-11-07 Toast主题对比度：`node tests/toast-theme-browser.cjs` 连接 `VIDEO_ANALYZER_TEST_FIXTURE` 指定的独立合成库，检查四套主题亮暗共72种提示组合的正文、说明和操作按钮对比度，以及系统跟随、已显示提示切换主题、键盘撤销、关闭与自动消失。4组通过，文字最低对比度5.27:1，无业务写入、脚本异常或失败请求；证据位于 `build/toast-contrast-2026-11-07/`。该轮合成库已停止并清理，不调用真实AI。

2026-11-06 人脸下载弹窗与主题预览精修：Python全量307项通过，新增两项验证套装实际文件清单、固定根目录下的可选子目录、目录已存在/越界/软链接拒绝及原文件保留。`face-download-refinement-browser.cjs` 新增7组，检查唯一下载入口、只读根目录、可访问的信息说明和焦点返回、实际两/三阶段清单、非法/重名子目录与更名后的真实下载位置、1000/1440px窗口滚到底部的20px留白、主题一行四套且亮上暗下，以及四主题亮暗的弹窗状态。

原识别设置18组、统一模型菜单9组、外部模型选择8组、通用设置15组均通过，共57组浏览器检查，无脚本异常或失败请求。原内嵌外部目录下载UI及其重复下载测试随入口移除，替换为新的路径/目录冲突与整套清单用例；原服务端 `directory` 兼容接口继续由单元测试覆盖。源码/明暗截图/结果位于 `build/face-download-refinement-2026-11-06/`，UI规范1.26。下载使用合成小模型，不下载完整真实权重或写入真实设置；用户明确授权丢弃未保存草稿后，已通过取消关闭草稿并重启原测试应用；真实窗口确认下载弹窗与四列主题均已生效，4张合成素材、各表数量和已保存模型设置保持一致。未启动真实下载。

2026-11-06 统一模型选择与下载：`test_managed_models.py` 使用微型真实ONNX/tokenizer和合成ZIP验证固定来源、大小/SHA-256及接口校验、损坏/缺失/异常记录、取消、空间不足、重复下载复用、独立阶段配置、外部路径覆盖、复制后修改时间变化及模型ID随根目录迁移；下载不保存业务设置。`test_desktop_runtime.py` 将快速分类模型下载纳入切换目录的忙碌阻止条件。完整Python结果见 `build/model-selectors-2026-11-06/python-tests.log`。

`model-select-browser.cjs` 九组验证组合与三个阶段的已安装/下载/外部来源、阶段混搭保存、只应用所选阶段、快速分类下载失败/取消/重试、编辑和重开保护、Omni共用原下载API、图片/视频/音乐同款菜单，以及键盘、可访问动作名称、复核停用、菜单直角衔接和四主题明暗/两种桌面宽度。运行fixture须同时设置 `MODEL_SELECT_FIXTURE=1 FACE_MODEL_SETUP_FIXTURE=1`，通过 `RECOGNITION_SETTINGS_FIXTURE` 连接；否则阻止模型下载。原 `recognition-settings-browser.cjs` 18组和 `face-model-setup-browser.cjs` 11组也通过，共38组，无脚本异常或失败请求。后者将路径输入定位到 `.face-path-field`，高度上限增加一个40px模型选择器所需空间，保留等宽横排及溢出约束。

真实Electron测试应用已同步前后端，实点模型组合与SigLIP2下载菜单，未触发真实下载或保存临时设置；四张合成素材、逐表数量及人脸/分类设置不变。证据位于 `build/model-selectors-2026-11-06/`，UI规范1.25。新增下载实际使用的是微型合成权重，另只读核对上游元数据和两个ONNX各128KB的接口信息，没有下载完整大模型或重新评估准确率；未替换正式应用、提交或推送代码。

测试使用临时目录、合成 SQLite/媒体数据。不要把 MEDIA_MANAGER_HOME 改成真实用户数据目录。测试不调用真实 AI 或加载模型权重；应用工厂的错误处理测试显式隔离数据库、日志和预加载。

2026-11-06 模型目录本次生效：`desktop-model-apply.cjs` 六组检查空闲准备、停止旧服务、提交路径、启动新服务的顺序，以及复制校验、忙碌拒绝、提交/启动失败保留现场且不自动回退、错误运行目录不能报成功；原九组迁移文件与目录持久化测试继续通过。`test_desktop_runtime.py` 七组使用临时数据库，验证实例校验、幂等准备、流式导入/时间调整从开始到连接关闭始终阻止切换、异常释放计数，以及分析、人脸、分类、关系队列、下载、断开连接后的创作构思与前台活动的忙碌检查。切换准备后阻止新写入；健康接口回报实际模型根目录，每次启动后端使用新实例标识。

通用设置浏览器检查现为15组，覆盖常驻入口、即时生效、仅改路径也显示loading、复制/校验百分比、应用阶段不显示假百分比、模型清单刷新、旧桥接与旧版待应用路径，以及原有取消/草稿/失败重试/四主题亮暗/两种窗口；原设置18组通过。真实测试Electron额外用256KB合成文件完成迁移及即时切换，再成功切回原测试目录：主进程与窗口不重开，两个新后端PID、实例变化和健康接口的实际根目录证明生效，副本校验与原文件保留通过，全部测试表数量不变，合成文件与目录已清理。成功测试后的切回只清理隔离测试状态，不是失败后自动回滚。证据位于 `build/live-model-directory-2026-11-06/`，UI规范1.24；未迁移真实模型、调用真实AI或替换正式应用。

使用 Python 3.12+，先在虚拟环境安装项目 `requirements.txt`，再从项目根目录运行：

```bash
python -m unittest discover -s tests -v
node tests/frontend-regressions.cjs
node tests/gallery-state-regressions.cjs
node tests/inspector-regressions.cjs
node tests/desktop-runtime.cjs
```

安装包瘦身回归 `test_embedding_preprocess.py` 检查 float32 NCHW、黑白边界、阻断 torch/torchvision 后的特征预处理及 faster-whisper 导入。开发环境装有 torchvision 时，还会对正方形、横竖图、奇数尺寸和极小图逐元素核对旧预处理流程；该依赖不再是运行时要求。默认测试不加载真实模型，另外可在隔离目录用合成图片和只读 ONNX 模型校验归一化特征字节兼容性。

`test_search_packaging.py` 在独立子进程中对照完整 jieba 与精简副本，验证普通分词、查询分词及合成资料库 FTS 检索结果一致；实际冻结包另检查中文搜索、保留的中英文资源、HMM、字典和 ONNX 动态库，不修改生产索引。

详情返回与喜欢照片堆叠：`gallery-state-regressions.cjs` 覆盖来源、文件夹、滚动、选区、详情分页查询、档位作用域、展开/收起、过期请求、详情变更刷新、刷新失败及删除封面保留其他组员；`test_favorite_stacks.py` 随完整 Python 测试运行，覆盖三档分组、跨页、筛选、排除关系、缺失/损坏向量、混合媒体、关闭堆叠、全选完整性和只读行为。浏览器 fixture 可启用 `VIDEO_ANALYZER_STACK_FIXTURE=1`，生成 90 张有缓存特征的合成照片、多级目录及混合喜欢素材；不读取真实素材或加载模型。CUA 交互验证与边界见 历史 UI 验证附件（已清理）。

包含真实媒体/XMP 对照，需安装 ffmpeg、ffprobe、exiftool。全新安装依赖的验收环境版本和结果记录在 `docs/code-fixes-validation-2026-10-18.json`。

本地打包增加资料库复制、外部模型链接独立化、失败不发布、校验恢复、升级前快照及新格式拒绝写入的回归测试。安装和迁移说明见 `docs/UPGRADE-AND-DATA.md`。

macOS 界面重构增加检查器并发、失败重试及键盘焦点回归。浏览器 fixture 可用 `VIDEO_ANALYZER_UI_FIXTURE=1` 增加合成音频；可选的 `VIDEO_ANALYZER_UI_POSTERS` 指向 JPG 演示图目录，不设置也可离线运行。覆盖清单和验证边界见 `docs/UI-NATIVE-2026-10-18.md`。每次完整重跑浏览器脚本须新建 fixture，最后一个脚本会删除/重建合成片段。

检查器直方图：`inspector-regressions.cjs` 的 6 项测试覆盖像素分桶、空分布、采样尺寸上限、过期预览、失败/重试、独立状态和已有参数展示。`test_inspector_preview.py` 随完整 Python 测试运行，覆盖缓存缺失不解码、不写库，原片离线仍返回缓存，以及 `cached=1` 不执行视频截帧。浏览器 fixture 可另加 `VIDEO_ANALYZER_INSPECTOR_FIXTURE=1`，生成风景、纯白和离线缺缓存照片，以及扩展视频参数；与音频 fixture 可同时启用。通过界面检查素材切换、缺图重试、两类图表、四套亮暗主题、中英文、1000×600、空选/多选及底部入口。该轮浏览器由 CUA 操作，结果见 历史 UI 验证附件（已清理），不是现有浏览器脚本的自动覆盖。

浏览器测试另需 Node Playwright 与 Chromium。运行以下独立合成 fixture，等待它打印随机 localhost 地址：

```bash
python tests/browser_fixture.py
```

在另一终端执行三个脚本（测试会修改该合成 fixture 的工程）：

```bash
node tests/browser-regressions.cjs
node tests/browser-wizard-regressions.cjs
node tests/browser-plan-regressions.cjs
```

文件夹树调整可独立运行 `node tests/folder-tree-regressions.cjs`（同样连接合成 fixture）。覆盖展开/选择独立性、悬停和键盘焦点、打开/关闭图标、主题色、中英文标签、右键菜单、选择器数量字段、层级缩进及窄窗口。该脚本不提交 API 写入；无封面合成音频的预期 404 单独记录。

品牌与窗口主题可在 macOS 运行 `node tests/branding-theme-regressions.cjs`。使用同一合成 fixture，并另起真实 Electron 源码应用，自动创建和清理独立资料库、用户配置、模型及缓存目录；需要 `.build-venv/bin/python` 和 `electron/node_modules`。覆盖中文名称与 ASCII 请求头、图标加载、1000×600 布局、网页和原生窗口深浅色同步、跟随系统、重载和非法主题输入。截图和结果写入 `build/luminisle-branding/`。

如果使用本机已配置的 Playwright skill，可用该 skill 的 `node run.js <脚本绝对路径>` 启动。运行前仍需依照 skill 检测开发服务；只能连接 fixture JSON 指定的随机端口，不要连接其他开发服务。

默认 fixture 连接信息写入 `/tmp/video-analyzer-fix-browser.json`，可以为 fixture 和浏览器进程共同设置 `VIDEO_ANALYZER_TEST_FIXTURE` 改用独立位置。用 Ctrl+C 停止 fixture 后，合成库、素材和预览缓存会清理。脚本在 `/tmp` 写入本次验证摘要及截图；确认后可删除这些测试产物。

完整外观主题运行 `node tests/theme-styles-regressions.cjs`（需独立合成 fixture，支持同一 `VIDEO_ANALYZER_TEST_FIXTURE`）。检查四套亮暗主题、旧布局坐标与尺寸、文字对比度、主题/明暗分别保存、键盘与焦点、1000×600 浮层、设置同步、中英文、详情及工程界面、错误/重试/空库和无效偏好。该脚本不写入后端，预期的合成 HTTP 500 单独记录；截图与结果写入 `build/theme-styles/`。

音频缩略图运行 `node tests/audio-thumbnail-theme-regressions.cjs`，fixture 需启用 `VIDEO_ANALYZER_UI_FIXTURE=1`。使用真实 FFmpeg 生成的旧格式蓝紫色波形，通过浏览器截图像素检查八种主题的波形与底色，覆盖素材库四种视图及分组、检查器、工程素材栏、封面保色和缺图回退。不写入后端，结果写入 `build/audio-thumbnail-theme/results.json`。

导入性能回归见 `tests/test_import_performance.py`（随完整 Python 测试运行）。覆盖有界并发、提交后通知、重复/失败继续、断开连接清理、源文件变化、单次目录扫描、批量元数据、RAW 内嵌预览/回退/8 种方向、JPEG 特征输入一致性和模型只初始化一次。测试不加载模型。

`node tests/import-browser-regressions.cjs` 连接上述独立 fixture，真实导入两段合成视频，检查重复跳过、详情打开、3,000 条结果虚拟滚动、窄窗口、持续导入滚动、分片 UTF-8 进度和中断/扫描失败提示。它仅修改该合成库；输出目录可通过 `VIDEO_ANALYZER_IMPORT_OUTPUT` 指定。fixture 与脚本均可使用 `VIDEO_ANALYZER_TEST_FIXTURE` 指定独立连接文件。

性能基准 `python tests/import_benchmark.py --assets /tmp/<独立样本目录> --output /tmp/<结果文件>.json` 自动生成 12 张 24MP JPEG 和 4 段 1080p 视频。默认替身推理；只有显式传 `--models <包含 resnet50.onnx 的目录>` 才只读加载本地模型，固定 CPU 进行可比测试。`--baseline-importer <修改前 importer.py 副本>` 可在同样的合成库上运行旧串行流程。基准不启动生产应用、不调用外部 AI；请在相同机器、同一组样本且无其他测试负载时前后各运行三轮。

创建时间调整：`test_creation_time.py` 随完整 Python 测试运行，macOS + ExifTool + FFmpeg 下会实际修改临时照片/视频的创建时间，验证前后偏移、±24 小时边界、51 文件分批、重复 ID、时区、离线、失败/超时与写入读回；同时校验文件哈希、修改时间和资料库记录不变。另运行 `node tests/creation-time-frontend.cjs` 验证选区快照、接口路由、零偏移/忙碌拦截、分片与中断进度。

`node tests/creation-time-browser.cjs` 只连接上述独立 fixture，真实使用右键菜单与滑块调整合成照片和视频，覆盖单选、多选、取消、失败、中断、中英文和深色窄窗口。可通过 `VIDEO_ANALYZER_CREATION_TIME_OUTPUT` 指定截图与结果目录；只能用于测试 fixture，禁止连接真实素材库。

智能分类开发测试：`python -m unittest discover -s tests -p test_taxonomy.py -v` 覆盖合成库的列序／旧 ID、四级与环、别名消歧、人工保护、组合过滤、合并拆分／撤销、事务任务意图故障、迟到／取消、例图失效及快照；不加载真实模型。`node tests/taxonomy-state-regressions.cjs` 验证迟到保存／例图读取、冻结例图写入目标、配置刷新和角标原位更新。

`node tests/taxonomy-browser-regressions.cjs` 只连接独立 fixture，默认读取 `/tmp/luminisle-taxonomy-fixture.json`；先运行 `VIDEO_ANALYZER_TEST_FIXTURE=/tmp/luminisle-taxonomy-fixture.json python tests/browser_fixture.py`。脚本会创建合成标签、修改合成分析并采纳候选；不要连接真实库，每次全量测试新起 fixture。Playwright 模块可用 `PLAYWRIGHT_MODULE` 指向已安装路径。验证新建／编辑、别名、分类角标与详情返回、已有分析整理和人工采纳、亮暗／窄窗口、空及完成状态，结果在 `build/taxonomy-validation/`。真实模型语义、十万素材性能与生产迁移未由这些测试覆盖。

完整分类回归随 `python -m unittest discover -s tests -v` 运行；专项为 `-p 'test_taxonomy*.py'` 与 `-p test_semantic_classifier.py`。`node tests/taxonomy-state-regressions.cjs` 覆盖分页／异步、完整条件编辑、候选目标摘要、关系控制和历史预览。

`test_taxonomy_presets.py` 包含9项默认词库回归：空库导入、明确移除无引用旧标签、不复用旧ID、FK与JSON引用保护、失败原子回滚、规范化别名去重、重复执行保留人工修改和完整预置校验。测试不操作真实库；本机导入证据见docs/default-taxonomy-installed-2026-10-30.json。

`node tests/taxonomy-appearance-browser.cjs` 连接独立 fixture，检查四主题亮暗、双入口、收起浮层、跨视图角标和加载／空／故障／离线；正常与预期故障分开计数。`node tests/taxonomy-mapping-browser.cjs` 必须设置 `VIDEO_ANALYZER_TEST_FIXTURE`，验证目标含义并发改变时409且不写关联，重新预览后才允许采纳。它仅修改合成字段，不调用视觉AI。

`python tests/taxonomy-performance-benchmark.py --help` 提供十万素材／五千节点的隔离查询及导入登记对照。分布、冷热范围和原始证据见 `build/taxonomy-performance-validation/README.md`。外部模型导出为 `tools/export_classification_model.py`，只使用已存在本地权重，不下载或覆盖目标；配对数值和动态中文运行证据见 `build/classification-model-validation/`。性能、数值等价和状态测试均不代表语义准确率。

人物专项随完整 Python 回归运行：`-p test_people.py`、`-p test_people_jobs.py`、`-p test_people_integration.py`、`-p test_face_engine.py`。覆盖人物与素材计数、重名、跨模型人工保护、几何匹配、长相似链、合并冲突、范围外负约束和原位撤销、持久任务与租约、取消/输入变化、前台让位、内容裁切复用、筛选和完整迁移。默认仅使用临时库、合成图像与视频，不加载真实模型。

分类布局专项：`node tests/taxonomy-picker-regressions.cjs` 验证分级选择器的层级、别名、同名标签、搜索下的独立多选与排除、一级父级及临时拆分目标。先用 `PEOPLE_BROWSER_FIXTURE=/tmp/luminisle-taxonomy-layout-fixture.json python tests/people-browser-fixture.py` 启动隔离服务，再运行 `node tests/taxonomy-layout-browser.cjs`；验证纯树侧栏、外层滚轮、层级筛选与实际结果、主区维护、选区传递、智能图集及四主题亮暗。结果写入 `build/taxonomy-layout-validation/`，禁止指向真实服务。原分类浏览器与外观测试已更新为维护入口直接进入主区，不再要求维护侧栏树或“维护标签”按钮。

`node tests/people-state-regressions.cjs` 检查前端迟到响应与 API 选项。`tests/people-browser-fixture.py` 和 `node tests/people-browser.cjs` 使用专用隔离库与随机端口，覆盖人物入口、命名/合并/拆分/撤销、手动关联、视频跳转、筛选、详情返回、主题及错误重试；只允许连接该 fixture，禁止连接生产端口。验证输出保存在 `build/people-ui-validation/`。

`python tests/people-model-smoke.py` 是显式运行的真实模型冒烟，不在常规测试中自动执行。它只读既有人脸基准的六张缓存预览和外部 ONNX，建立临时库，验证两套模型及照片/生成视频/离线缓存重扫；不查询原片和生产资料库，不调用网络。证据在 `docs/product-design/people/model-validation.json`；此小样本只证明运行链路，不证明全库精度或加速器算子覆盖率。

智能图集专项：`node tests/smart-collection-regressions.cjs` 验证筛选快照、未支持条件阻断、移除排除规则、图标、名称校验、失败重试和迟到写回。用 `VIDEO_ANALYZER_TEST_FIXTURE=/tmp/luminisle-classify-inline-fixture.json .build-venv/bin/python tests/browser_fixture.py` 启动独立合成库，然后运行 `node tests/smart-collections-browser.cjs`；覆盖常驻标签规则、footer同步、独立保存按钮、创建／错误重试、侧栏入口、刷新、动态匹配、详情返回、展开／迷你侧栏右键重命名和删除、键盘菜单、读取失败、四主题亮暗、焦点与Escape。结果保存到 `build/smart-collections-validation/`。原分类浏览器回归应使用全新fixture，避免主题测试已给视频打标签影响其空标注前置条件。

`test_taxonomy.py`中的3项重命名回归覆盖名称校验、规则字节保留、旧版／未来规则兼容和版本冲突；`gallery-state-regressions.cjs`增加footer规则摘要验证。图集不再提供主区条件编辑，相关旧浏览器约定已更新为侧栏右键维护。

图库控件：用 `VIDEO_ANALYZER_TEST_FIXTURE=/tmp/luminisle-gallery-controls-fixture.json .build-venv/bin/python tests/browser_fixture.py` 启动独立合成库，然后运行 `node tests/gallery-controls-browser.cjs`。覆盖恢复的直接筛选布局、分类／素材库／喜欢的四图标一致性、四视图切换和键盘、排序方向、时间／时长分组、无效分组重置、四主题亮暗和1000px宽度。结果位于 `build/gallery-controls-validation/`。先前单行布局方案已撤回，不再作为当前布局合同。

`gallery-controls-browser.cjs` 当前为12组：增加两列瀑布流图标、全部媒体图标、共享滑动底片的中间帧／终点与快速切换、窗口尺寸、减少动态效果、亮暗主题颜色覆盖，以及人物子菜单图标、人物视图、设置引擎、查重分档、相似素材弹窗和音频封面／波形。仍只使用browser_fixture.py的合成资料库，不保存设置或调用模型。

确认稿图标接入：`gallery-controls-browser.cjs`现校验“全部类型”的扇形C和无外框音符、子标签精修C的等大节点与1.2px分叉、镂空勾选／空心及Enter操作、四套亮暗主题中的SVG尺寸和选中色。`smart-collections-browser.cjs`继续验证该开关实际改变父子标签查询结果。

紧凑标签组合：`gallery-controls-browser.cjs`验证单一组合容器、空／多标签时宽度不超过200px、窄菜单（264px）、Any／All图文与键盘、真实合成标签任一3条／全部1条及footer回显。按钮28px、内部图文20px，Any后层空心、All两层实心；选择器与素材角标复用单标签轮廓。四套亮暗主题检查9.2px文字、45%背景图形及背景色笔画避让，中英文均显示Any／All。局部截图为`build/gallery-controls-validation/any-all-light.png`和`any-all-dark.png`。菜单的层级选择仍由`taxonomy-layout-browser.cjs`覆盖。

媒体筛选细节：文件类型与高级筛选位于同一`.gallery-media-filter-controls`分组，测试通过`.gallery-type-controls`定位类型切换，不依赖直接子级关系。创建按钮位于footer首位，以“＋智能图集”、主题底色和细边框表示添加动作；侧栏仍使用文件夹＋放大的四角星；标签选择器主要文字为12px。隔离布局和颜色测量记录见`build/media-filter-polish-validation/results.json`。

当前 UI 基准见 [UI 规范](../docs/UI-SPEC.md)。历史截图与一次性 UI JSON 已清理，验证脚本保留；后续运行产物存入已忽略的 `build/`，不重新堆入 `docs/`。

标签维护树布局：用 `VIDEO_ANALYZER_TEST_FIXTURE=/tmp/luminisle-taxonomy-maintenance-fixture.json .build-venv/bin/python tests/browser_fixture.py` 启动合成资料库，再运行 `node tests/taxonomy-maintenance-browser.cjs`。检查主区域常驻树、独立展开/选择、右侧保存、维护功能、键盘、加载/空态/错误重试，以及四主题明暗和三种桌面宽度。输出保存在 `build/taxonomy-maintenance-validation/`。原布局、外观与维护浏览器检查已同步采用主区域树，仍禁止连接生产服务。

识别设置：`.build-venv/bin/python tests/recognition-settings-fixture.py` 启动全新隔离设置服务，再运行 `node tests/recognition-settings-browser.cjs`。可用 `RECOGNITION_SETTINGS_FIXTURE` 指定连接文件。15组覆盖两标签页的读取/保存/取消、三卡横排/大幅五官图形/停用态/说明折叠/卡内复核开关/下载位置/标签顺序、三档视频人脸帧率的持久化与非法值、移除分辨率入口、草稿、部分失败重试、数值校验、迟到读取、原设置保存与失败、任务入口、四主题明暗、中英文和窄窗口，并直接对照原设置页的表单样式及实点模型选择/分类开关。服务不加载模型，且阻止识别、任务和生成端点；结果在 `build/recognition-settings-validation/`。测试会保存合成设置，重跑需重建fixture。原人物浏览器检查已同步为「处理范围 → 全局人脸设置」，不再在处理弹窗中寻找模型配置。

按次人脸扫描：`PEOPLE_SCAN_FIXTURE=1 RECOGNITION_SETTINGS_FIXTURE=/tmp/luminisle-people-scan-fixture.json .build-venv/bin/python tests/recognition-settings-fixture.py` 启动全新合成资料库；同样传入该连接文件运行 `node tests/people-scan-options-browser.cjs`。5 组覆盖六款套装/自定义阶段与可选复核、共用视频设置跳转、多选递归文件夹与跳过/重扫、导入复选框及真实任务意图、四主题明暗和桌面窗口。该模式允许合成资料库的任务登记与合成图片导入，TESTING 禁止后台推理，特征计算被隔离。重新执行写入测试需重新创建 fixture，避免复用已登记任务；结果在 `build/people-scan-options-validation/`。后端 `test_people_scan_options.py` 的14项还覆盖可选复核过滤、手工决定保留、视频完整时间轴、10001条观察分批与失败回滚。

独立人脸模型配置与下载：运行 `.build-venv/bin/python -m unittest discover -s tests -p test_face_model_setup.py -v`。6项使用 `face_model_fixtures.py` 生成的真实常量 ONNX 和 CPU Runtime，覆盖改名后核验、选错阶段、损坏文件、独立路径、下载摘要/ZIP/模型校验、取消和失败保留。网络传输使用合成响应，不下载实际模型。用 `FACE_MODEL_SETUP_FIXTURE=1 RECOGNITION_SETTINGS_FIXTURE=/tmp/luminisle-face-model-setup-fixture.json .build-venv/bin/python tests/recognition-settings-fixture.py` 启动新的隔离服务，再以同样连接文件运行 `node tests/face-model-setup-browser.cjs`。8组检查真实接口探测、模拟桌面文件/目录选择与合成下载发布、旧响应/中途编辑/关闭重开的保护、取消重试、紧凑布局、四主题亮暗、键盘及中英文；写入仅发生在 fixture 的临时目录和资料库。结果在 `build/face-model-setup-validation/`。原设置测试已改为操作独立检测文件路径，人脸页允许12px段间距，字段自身继续复用原设置样式。

连续视频人脸：`test_video_people.py` 随全量回归运行，21项使用合成图像、FFmpeg生成的视频和小型 ONNX，验证原生PTS/所有帧与1/2/3fps直接采样、低帧率源不重复补帧、旋转、光流分轨与候选上限、稀疏及不规则帧间隔不单独断轨、镜头切换、短暂人脸、多人、低质不挤掉合格帧、取消、截断、半次失败保留人工数据及裁切清理、私有工作进程复用/帧率切换/重启、主进程语音依赖隔离。需要构建锁中的 `opencv-python-headless`；主进程只导入 `video_runtime`，不加载OpenCV。私有worker按设置取帧，`iter_frames` 的 `fps=None` 只为全帧回归和实验保留。现行人脸视频任务不得调用导出JPEG的 `face_engine.read_frames`；其历史辅助测试保留，不代表当前生产入口。`people-scan-options-browser.cjs` 验证独立人脸帧率和代表人脸数量输入，界面不再提供分辨率摘要或跳转；修改视频分析FPS不会改变人脸帧率。

三档产品集成证据：`build/video-face-rate-validation/` 保存281项完整回归、设置13组/扫描5组浏览器结果、原始失败与通过日志、UI截图和本地Buffalo L端到端冒烟。`test_people_scan_options.py` 的17项包含帧率默认值/严格类型/原子保存、视频重扫配置键和照片任务不受帧率变化影响；配置复用settings键值表，不新增数据库列。真实模型冒烟只使用既有缓存预览与权重，12秒合成视频在三个档位分别处理12/24/36帧，均3条轨迹、9张可用观察，临时视频和worker自动清理；不评估真实视频精度或据此承诺吞吐。

显式真实模型冒烟：`.build-venv/bin/python tests/video-people-smoke.py --benchmark-cache build/face-benchmark-2026-10-29` 仅在明确需要时运行，不属于常规测试。只读此前缓存预览和既有 Buffalo/Raccoon 权重，生成会自动删除的短视频；不读取原素材/生产库或下载模型。比较同一RGB解码器下逐帧识别与轨迹代表帧的调用数及单轮耗时，不评估精度。结果保存在 `build/people-video-integration/model-smoke.json`，禁止泛化为完整资料库性能承诺。`people-model-smoke.py` 的视频断言已同步为至多3个实际代表时点，原片离线时等待，不再断言可重放旧JPEG缓存；新运行结果写入 `build/people-model-smoke/`，保留 `docs/product-design/people/model-validation.json` 的历史证据。

真实模型已移出项目测试目录。`video-people-smoke.py`、`people-model-smoke.py` 和 `video-people-compression-benchmark.py` 的模型根目录默认使用 `~/models`，读取其 `buffalo_l`、`raccoon_s` 子目录；可用 `--models-dir /absolute/models` 覆盖。`--benchmark-cache` 仍只指定预览/样本缓存。本机实际目录为 `/Users/zack/models`，不依赖旧目录或软链接；历史验证JSON和一次性build脚本保留执行时路径，不作为当前模型位置配置。

预压缩对照：`.build-venv/bin/python tests/video-people-compression-benchmark.py --benchmark-cache build/face-benchmark-2026-10-29 --repeats 3`。仅显式运行，只读此前缓存/权重，在临时目录生成4K HEVC及720p/480p/320p H.264副本，保持所有帧，计入转码成本；同帧人脸框和特征对照与计时分开。会使用本地两套模型和FFmpeg，不代表人工标注准确率或真实外置盘吞吐。输出在 `build/people-video-compression/`；全部测试视频自动清理，不修改业务识别流程或真实资料库。

一分钟聚焦对照：在同一命令中加入 `--seconds-per-scene 20 --repeats 1 --profiles buffalo_l --proxies proxy480 --output build/people-video-compression-60s`，用三段各20秒的场景比较直读与480p。保持1800帧，单轮结果只作方向检查，不覆盖6秒三轮证据；可通过 `--repeats` 增加重复轮次。

一分钟3fps对照：改为 `--seconds-per-scene 20 --repeats 1 --profiles buffalo_l --proxies proxy480_3fps --output build/people-video-compression-60s-3fps`，保持一分钟时间轴，使用 `fps=3,scale=852:480` 生成H.264副本。直读处理1800帧，低帧率方案处理180帧，并计入副本生成耗时；默认方案仍保留全部帧。持续出镜的合成照片场景不能验证短暂出镜、快速运动的人脸召回率；对应时点的质量对照也受降帧取样时差影响。

历史一分钟1fps与3fps配对：使用 `--seconds-per-scene 20 --repeats 3 --profiles buffalo_l --proxies proxy480_3fps proxy480_1fps --skip-direct-timing --output build/people-video-compression-60s-1fps`。同一源视频生成两种480p副本，各测三轮，分别处理60/180帧；直读仍参与解码和质量检查，但不重复计时，需将引用的历史30fps计时单独标注。该输出记录属于尚有0.5秒断轨条件的旧轮次；更多碎片轨迹不能解释为识别到更多人物。

历史一分钟2fps与3fps配对：使用 `--seconds-per-scene 20 --repeats 3 --profiles buffalo_l --proxies proxy480_3fps proxy480_2fps --skip-direct-timing --output build/people-video-compression-60s-2fps`。分别处理120/180帧，并记录实际时间戳间隔。旧边界记录中的0.500001/1秒重置行为已被移除，不能代表现行代码。时间戳边界证据不替代真实运动视频的召回率评测。

移除固定时间断轨后的三档重测：使用 `--seconds-per-scene 20 --repeats 3 --profiles buffalo_l --proxies proxy480_1fps proxy480_2fps proxy480_3fps --skip-direct-timing --output build/people-video-compression-no-time-cutoff`。1/2/3fps在同一份源视频、同一模型和画面匹配逻辑下各测三轮，不再仅因时间跨度结束轨迹。`test_video_people.py` 的两个新增稀疏输入回归覆盖半秒边界、更长及不规则间隔，并验证切镜头、人脸消失、尺寸变化仍正确分轨；该改动未调整应用默认帧率。

UI 规范专项：分别启动 `browser_fixture.py` 和 `people-browser-fixture.py`，为两个服务及测试传入 `VIDEO_ANALYZER_TEST_FIXTURE`、`PEOPLE_BROWSER_FIXTURE` 的独立 JSON 路径，再运行 `node tests/ui-spec-browser.cjs`。9 组检查覆盖八种主题的主按钮与选中分段对比度、普通/错误描边、键盘评分/颜色筛选、单/多选右键菜单、统一尺寸/间距、人物工具栏及中英文导出取消；不提交导出、运行 AI 或写入真实资料库。结果位于 `build/ui-spec-validation/`。文件夹回归现限定带 `data-path` 条目的目录树，避免将同侧栏的标签树一起匹配。

人脸设置精修：`build/face-settings-polish-validation/` 保存设置15组、模型8组、扫描5组共28组浏览器结果及亮暗截图。Electron选择器在浏览器中以同接口返回合成文件路径，确认文件选择自动核验、目录选择、停用复核恢复和原有编辑/下载保护；未调用真实系统文件对话框或下载真实权重。界面采用1.9规范，后端与原281项测试证据保持不变。

2026-11-02 人脸选项：`test_people_scan_options.py` 验证每轨迹1～48张（默认4）、严格输入校验、视频配置版本与照片隔离、保留旧结果，以及单文件/批量导入的仅图片/仅视频/两者/关闭范围；`test_video_people.py` 验证真实候选选择能达到8/48张、候选内存上限和工作请求传递。`recognition-settings-browser.cjs` 现含16组，覆盖数量保存/取消/非法值；`face-import-options-browser.cjs` 在 `PEOPLE_SCAN_FIXTURE=1` 的新隔离fixture上运行6组，用合成JPG、MP4、WAV实际导入并核对后台任务、重开重置、英文、亮暗主题和紧凑窗口。证据存于 `build/face-options-2026-11-02/`；没有识别真实素材、下载模型、调用付费AI或替换生产应用。

2026-11-02 配置指引：`recognition-settings-browser.cjs` 的取样检查改为点击问号阅读四段说明，覆盖关闭按钮与键盘Escape且保留设置弹窗；长描述不再常驻字段下方。`face-model-setup-browser.cjs` 新增所有六套组合与自定义组合的推荐文件/接口指引检查，确认不自动填入或保存路径，并移除开发选型测试文案。合成模型配置/下载现含9组；设置仍为16组。预览与八种窗口/语言/主题弹层边界检查见 `build/face-settings-guidance-2026-11-02/`，无真实权重下载或生产更新。

2026-11-02 卡片就地引导：`face-model-setup-browser.cjs` 现含10组，新增用户选择后的卡片可见性、一次依次高亮、待配置路径焦点、相同组合再次提示、路径保留、可选复核与减少动态效果；取消下拉不转移焦点，初始加载不播放提示。既有设置16组继续回归。证据和真实浏览器动效预览见 `build/face-stage-cues-2026-11-02/`，录制只修改未保存草稿，确认没有自动打开文件对话框或保存配置。

2026-11-03 设置版本不一致：`recognition-settings-browser.cjs` 现含17组。新增回归模拟旧后台缺少两项视频字段，选择Buffalo L并修改路径后，确认提交前给出重启说明、没有设置写请求且草稿保留；新用例先失败，修复后17组全部通过，无页面错误或失败请求。实际独立Electron测试窗口重启后，用原生文件选择器恢复用户Buffalo L的两个外部模型路径，点击确定出现「设置已保存」，只读接口确认配置持久化且模型就绪；四张合成素材和其他业务表数量不变。仅该测试资料库保存配置，未启动扫描或更新生产应用。证据在 `build/people-settings-save-fix-2026-11-03/`。

2026-11-04 模型名称与自动核验：模型配置浏览器11组、设置17组共28组通过，无页面异常或失败请求。检查六套组合及自定义卡片内的推荐模型名称与文件名，移除组合下方的重复摘要；路径输入完成后自动核验、同路径进行中不重复请求、失败可手动重试、清空与迟到响应保护，以及桌面选择器每次选文件仅发一次核验请求。桌面选择器仍用合成接口返回文件，不实际下载权重或执行人物识别；设置测试把只读的核验POST单独记入probes，不计为配置写入。主题/语言/窗口回归沿用既有矩阵，证据在 `build/face-stage-names-2026-11-04/`。本轮未更改后端、生产应用或真实资料库。下拉控件直角衔接仅为待用户确认的独立预览，位于 `build/dropdown-design-2026-11-04/`，未应用全局样式。

2026-11-04 下拉菜单统一：在用户确认后接入全系统 `QSelect` 衔接规则，UI规范更新至1.15。启动 `browser_fixture.py` 并设置独立的 `VIDEO_ANALYZER_TEST_FIXTURE`，运行 `node tests/native-select-browser.cjs`。新增9组检查覆盖聚焦/失焦、向上和向下展开的实际接缝、缩放/滚动/离开视口、搜索、多选、空/禁用/错误、卸载、图库排序分组、人物排序及四主题亮暗；菜单需完成入场且实际可点击，再采集尺寸与截图。设置17组、UI规范9组、模型配置11组亦通过，共46组，无页面异常或意外失败请求。上下文菜单和普通输入的回归通过。结果、几何记录及亮暗截图在 `build/native-selects-2026-11-04/`；新增公共模块为 `frontend/js/native-selects.js`，原组件引用、事件及模型保存行为保持原接口。仅使用隔离测试数据和合成ONNX，未调用付费AI、写真实资料库、打包或替换正式应用。

2026-11-05 人物布局统一：UI规范更新至1.16。用独立的 `PEOPLE_BROWSER_FIXTURE` 启动 `people-browser-fixture.py`，运行 `node tests/people-layout-browser.cjs`，新增7组通过；覆盖三种桌面宽度×八种外观、紧凑英文列表、四个侧栏视图、搜索排序、Footer分页和任务控制、长名/加载/错误恢复及人物相册管理入口。任务控制用浏览器路由模拟，不运行识别。另通过原人物交互17组、UI规范9组，共33组浏览器检查，及 `node tests/people-state-regressions.cjs` 的序列化/异步/路由回归；保存说明图标另验键盘可达。原人物交互脚本中的旧目录选择断言已按现行三阶段文件选择更新，命名、纠正、封面、合并、撤销等真实接口流程继续执行。结果、尺寸记录和亮暗截图位于 `build/people-layout-2026-11-05/`。所有素材/人物均为合成数据，后端、真实资料库与生产应用未改，未调用付费AI。

2026-11-05 人物控件与首次引导：运行 `PEOPLE_BROWSER_FIXTURE=<独立fixture.json> node tests/people-controls-browser.cjs`，6组通过；实际命中测试确认搜索圆角不再被20px父容器裁切，聚焦/输入/失焦圆角正确，排序文字从偏下4px恢复居中。空库数据仅通过浏览器路由模拟，核对主区域与工具栏识别入口打开相同范围弹窗，且没有人物写请求；Lottie实际产生画面变化，颜色适配八种主题，双语1000×600窗口主按钮可见，减少动态、搜索/隐藏视图、卸载及无Lottie时正确退化。另复跑人物布局7组与状态回归，共13组浏览器检查，无页面异常或失败请求。自制动效文件约3KB，使用已有Lottie，不下载外部素材或模型。UI规范1.17、截图和测量记录在 `build/people-controls-2026-11-05/`；正式应用、真实数据库和素材未修改。


2026-11-05 人物空库动效精修：people-controls-browser.cjs 扩展至9组，并复跑人物布局7组及状态回归，共16组浏览器检查通过。新增逐帧检查3×3九张照片、定位框、五个五官特征点及同人物三组堆叠；抽查整个300帧循环并收集Lottie渲染错误，避免只看动画引擎已加载而忽略实际画面。三个按钮的32px高度、6px/12px内边距、18px图标及6px图文间距均实测相同。覆盖四主题亮暗、中英文、1000×600窗口、两个识别入口的一致弹窗、设置跳转、无引擎及动效404时的静态回退；浏览器中模拟visibilitychange验证暂停与恢复，实际减少动态效果媒体查询验证静态堆叠与卸载清理。页面异常、意外失败请求、Lottie错误及人物写请求均为零。另目视检查亮暗及静态回退截图，修正SVG use复用时的主题着色。自制本地矢量动效约90KB，无新增运行依赖；步骤小字和重复说明已删，UI规范更新至1.18。证据和从实际浏览器帧导出的10秒动效预览保存在 build/people-onboarding-polish-2026-11-05/。两个浏览器脚本分别支持 PEOPLE_CONTROLS_OUTPUT 和 PEOPLE_LAYOUT_OUTPUT 自定义输出目录。只使用合成资料库，未运行真实识别，未写真实资料库或更新正式应用。


2026-11-05 人脸扫描弹窗与Header任务：新增people-scan-dialog-browser.cjs九组，在PEOPLE_SCAN_FIXTURE=1的recognition-settings-fixture.py隔离服务上运行，验证整库无需二次勾选、仅已导入素材入队、文件夹多选/递归去重、所选素材与重扫、排队中防重复/禁用关闭、排队失败保留表单、Header暂停/继续/重试/停止、控制失败恢复，以及AI任务共存时停止人脸任务不改变AI任务。弹窗与菜单覆盖四主题亮暗、中英文和1000×600/1440×900窗口。整库使用既有confirm_all:true接口契约；所有任务均为合成库，后台worker禁用，不执行真实模型推理。人物Footer保留分页与只读状态，扫描弹窗只用右上角关闭和开始按钮，不再含取消任务或取消表单按钮。更新旧回归的扫描关闭入口及Header控制断言，保留其他人物弹窗的取消动作。
本轮新九组、人物引导九组、人物布局七组、按次扫描/导入五组，共30组浏览器检查通过；页面异常和意外失败请求均为零。21项test_people_scan_options.py后端回归、人物异步/路由及新增队列计数/控制防重复/失败保留状态回归、前端语法及diff空白检查通过。过期stale和已结束任务不进入Header未完成计数，避免停止后遗留不可清空的历史任务提示。结果与亮暗截图在build/people-scan-dialog-2026-11-05/，UI规范1.19；未修改后端业务代码、真实资料库、模型或原素材，未打包、替换正式应用或执行Git写操作。


2026-11-05 父子目录勾选联动：people-scan-dialog-browser.cjs扩展至12组，另跑旧扫描/导入5组，共17组浏览器检查通过。新增默认父目录预选同步所有后代、收起/展开保留勾选、取消子目录父目录半选、保留父目录直属素材且实际不再登记未选子目录、只选子目录不带入父目录文件，以及旧后台不支持直属范围时保留选择且零排队请求。整棵选中子树在POST中压缩为递归根，已覆盖父子同时勾选的去重；没有只改显示却仍递归扫描已取消子目录。
test_people_scan_options.py增加3项，修复前分别因遗漏直属素材、空递归列表被拒和非法直属列表未拒绝而失败；修复后24项全部通过。前端状态回归新增多层联动、同名前缀隔离、目录尾斜杠、超过1000个后代压缩为一个根、迟到目录响应不覆盖手动排除和旧后台保护，均通过。UI规范1.20及使用/接口文档同步，结果、亮暗勾选截图与修复前后日志在build/people-folder-cascade-2026-11-05/。旧浏览器脚本新增PEOPLE_SCAN_OPTIONS_OUTPUT输出目录选项。所有测试使用隔离临时库、合成文件与禁用的推理worker；后端新增可选direct_folders范围及supports_direct_folders能力标志，不迁移数据库结构，不修改真实资料库、素材或模型，不打包替换正式应用。


2026-11-05 智能分类模型归组：快速分类开关与SigLIP2模型目录同组；二次补充与词库整理同组显示实际共用模型，保持两个开关和所有既有配置键不变。recognition-settings-browser.cjs新增一组归属与实际模型ID显示、跨页草稿保留、取消零写入检查，共18组通过；同时覆盖原人脸设置、保存/取消、部分失败重试、读取错误、标准控件样式、四主题明暗、中英文与紧凑窗口。运行时设置RECOGNITION_SETTINGS_FIXTURE为独立fixture，RECOGNITION_SETTINGS_OUTPUT可指定新证据目录。本轮结果位于build/classification-model-groups-2026-11-05/，UI规范1.21；资源时间/内存调度与保留策略仅按代码核对并同步说明，未修改后台行为。使用合成设置库并禁用推理任务，未启动真实模型、调用付费接口、保存生产设置、清理真实建议或更新正式应用。


2026-11-05 通用设置与模型根目录：`npm --prefix electron test` 运行稳定运行路径及新增 `desktop-model-paths.cjs`，使用专用临时目录验证只读加载、原子保存、重启后沿用、HF缓存及其他配置保留、非法/交叠/软链接路径与环境覆盖拒绝、失败保留原文件、模型不搬移和桌面桥接/打包文件清单。`general-settings-browser.cjs` 使用现有隔离设置fixture（`RECOGNITION_SETTINGS_FIXTURE`指定连接文件），共9组，验证四区块及相同标题字体、主题/外观无分隔线、目录选择/取消/跨页草稿、保存/部分失败重试、读取失败、关闭重开与迟到响应、环境覆盖、旧桥接和浏览器说明。以四主题×亮暗×两种窗口验证无横向溢出，1440×900窗口无需滚动即可看全四块；目录选择和IPC在浏览器中模拟，真实文件保存由Node临时目录测试验证，未操作系统原生文件夹对话框。证据位于 `build/general-model-directory-2026-11-05/`，`GENERAL_SETTINGS_OUTPUT`可覆盖输出位置。最终在全新fixture中复跑 `recognition-settings-browser.cjs`，18组全部通过，无页面异常与失败请求；重复使用上一轮保存过设置的fixture会破坏默认帧率前置条件，因此最终回归使用新进程、新临时库。UI规范升至1.22。所有测试未写真实用户配置、资料库或模型，也未打包替换本机应用。


2026-11-06 模型目录迁移选项：通用页选择不同目录后，可勾选「同时迁移现有模型」，默认关闭；实际语义为复制并校验，原文件保留，重启后使用新目录。`npm --prefix electron test` 新增 `desktop-model-migration.cjs` 九组临时文件测试，验证SHA-256副本、原件保留、内部软链接重映射、目录内HF缓存迁移和独立缓存保留，以及目标非空/交叠/软链接别名、空间不足、源/目标中途改变、副本损坏、复制IO失败和配置提交失败。失败不切换路径，保留迁移副本供检查，不自动删除或回滚。目录桥接测试补查进度订阅/退订与事件隔离，打包清单包含迁移模块。`general-settings-browser.cjs` 共13组，新增勾选/重选重置/取消、进度与保存保护、失败保留草稿及重试、已保存待重启目录补迁移、旧桥接禁用；前9组和四主题亮暗/两种窗口检查继续保留。原设置18组在本轮独立fixture中通过。浏览器使用模拟Electron桥接，复制与配置写入由Node临时目录实测；未使用真实模型、操作真实配置/资料库、调用模型接口或替换本机应用。输出目录为 `build/model-directory-migration-2026-11-06/`，UI规范1.23。未实测真实大文件的跨磁盘耗时或电源故障；中途IO失败与配置失败由可控故障注入验证。


2026-11-06 模型预设与按次导入分类：人脸只提供InsightFace Buffalo L/M/S/SC、Raccoon L/S；切换套装分别默认关闭/开启复核，阶段列表定位当前套装文件，不再新建自定义组合，历史配置保留。Google SigLIP 2清单扩展为17种，包含固定分辨率、NaFlex、外部ONNX数据及768/1024/1152/1536维；不新增torch依赖。分类导入开关移入导入弹窗，新增布尔classify_media，默认关闭且每次重置，与人脸范围独立。
本轮317项Python测试通过。新增test_model_presets.py五项覆盖默认值、历史custom读取、按次意图/事务回滚、严格布尔参数和单文件导入去重；test_siglip2_presets.py五项使用真实ONNX Runtime及小型合成模型，逐一下载/加载/推理17种契约，并验证NaFlex patch顺序/宽高比/掩码/补零、损坏或缺失外部数据、错误尺寸/维度/接口及1536维特征入库。同步将历史导入性能脚本改为显式classify_media；本轮未重跑完整性能基准。
浏览器共49组通过：模型选择9、设置18、人脸配置8、导入7、下载弹窗7。覆盖六套默认值、17个完整规格与厂商、取消/下载失败/草稿迟到保护、自动核验/重试、两个导入勾选实际队列及音频排除、四主题明暗、中英文、紧凑窗口、键盘/焦点及无横向溢出；无页面异常或意外失败请求。FACE_DOWNLOAD_OUTPUT新增可选证据目录，避免覆盖前次截图。原生Electron测试窗口另有4项实测：新目录接口、6/17菜单、按次勾选及8px间距、未配置提示；无设置/导入写请求，测试库4个素材、1,107个标签及已保存模型配置前后相同。证据在build/model-presets-2026-11-06/，UI规范1.27。
17种规格未全部下载真实权重，未追加真实素材准确率/速度评测；固定版本、文件体积与SHA-256按公开上游元数据核对，NaFlex另核对轻量ONNX图。下载中使用的均是合成权重。更新并保留原测试GUI，未替换正式应用、修改真实库/源素材/模型或执行Git提交推送。


2026-11-06 人脸三阶段只读修正：上方六套组合是唯一模型选择/下载入口；下方卡片移除模型下拉、手填路径、文件选择及单阶段下载，仅展示模型、文件名、配置状态和接口核验。整套下载绑定全部阶段；再次选择已安装套装清除未包含阶段的旧引用。Buffalo未提供复核且无历史文件时禁用复核开关，Raccoon默认开启且仍可关闭。历史配置读取和业务API兼容保留。删除本轮不再使用的文件选择函数及样式，更新UI规范1.28、使用与接口说明。
修改前浏览器断言检出6个阶段选择/路径控件，修改后模型列表9组、人脸卡片6组、主设置18组、下载弹窗7组，共40组通过，无页面异常或意外失败请求。人脸卡片回归改为只读契约，覆盖六套元数据/默认值、整套自动绑定与确认/取消、同套重选清理残留复核、迟到核验隔离、错误/去重/重试、原生文件选择桥接零调用、键盘焦点及四主题明暗/中英文/紧凑窗口；旧单文件编辑测试由后端接口测试继续覆盖，设置保存回归改用仍可编辑的每次出镜取样数。使用临时合成模型/数据库，后端业务代码及真实资料库未改，本轮未重跑后端全套。证据在build/face-readonly-cards-2026-11-06/。
原测试GUI最初检测到未保存设置，暂缓刷新并保留草稿。用户随后明确授权「丢弃草稿，立即刷新新版」，已刷新并打开人脸识别设置；原生窗口实测三张卡片均无模型下拉、路径输入或文件选择按钮，仅上方保留一个组合选择器。无页面异常、失败请求或设置写请求，刷新前后已保存的人脸设置相同；截图及核对结果见同目录native-cards.png和native.json。


2026-11-06 可选模型与导入卡片（UI规范1.29）：图片/视频/音乐切换统一短名云端、本地，音乐云端在前且保留未开放状态。五类设置的模型菜单（含云端、独立ASR和共用补充模型）提供不启用；图片/视频独立启停且继续共用权重配置，人脸三阶段只读不变。新增settings键值及model_preferences运行门控，不迁移表列；关闭时不提交新分析、不排对应导入任务，后台租约暂停并拒绝迟到回写。保持既有结果及模型文件，重新启用只恢复标记为因停用暂停的任务。
325项Python测试通过，新增test_optional_models.py八项覆盖单/批量分析零提交、音乐none不回退、ASRnone不重载、人脸与分类领取/执行拦截及重启用、词库共用模型停用、导入已勾选但模型关闭时不排队、开关类型校验/原子性，以及仅返回能力布尔值的import-options接口。test_model_presets.py同步验证新导入分类仅照片，视频/音频不排分类任务。默认缺少新键时保持旧行为。
浏览器53组通过：新增optional-models-import-browser.cjs十三组、主设置十八组、统一模型选择九组、人脸卡片六组、合成文件实际导入七组。覆盖No值持久化/取消/独立启停、分类与人脸下载期间明确选No后不被迟到完成激活、模型保存后同步已打开导入卡片、读取失败与重试/重开隔离、原生选择器桥接调用、整卡勾选与键盘/可访问描述、四主题明暗/双窗口/中英文布局。导入分类只排照片，人脸按照片/视频/两者独立运行；点击人脸卡片内范围按钮不会误取消勾选，后台说明实测在标题右侧对齐。无页面异常或意外失败请求。
原生测试GUI在确认空闲、无草稿/所选文件后更新前后端。七项设置/导入核查及追加范围布局核查通过，没有保存设置或导入写请求；4个原测试素材、1107个标签及模型偏好前后相同。范围预览截图后恢复原来的勾选状态。证据保存在build/optional-models-import-2026-11-06/，native-import-scope.png为范围展开示例。
全部下载/推理流程测试使用小型合成权重和临时资料库；没有调用真实付费AI或做新模型精度/性能测评，没有修改生产应用、真实资料库/原素材/模型，也没有Git提交推送。只清理本轮fixture进程与临时库，保留原生测试GUI和验证证据。

2026-11-06 自动续跑、导入switch和Header后台任务（UI规范1.30）：338项Python测试通过；新增调度六项和任务汇总七项，覆盖旧预算不再停机、前台反复让路不耗尽尝试、自动继续、显式暂停/取消及模型停用、缺模型等待、200项以上计数、流式请求关闭与失败释放。浏览器47组通过：设置18组、可选模型/导入13组、合成文件实际导入7组、新Header/说明弹层9组。验证说明右对齐、六个可访问帮助按钮、两项预算控件移除、switch键盘和范围交互、20类任务适配、分类分组控制、读取失败保留已知状态、新任务不被旧完成计时器清除、四主题明暗及中英文。证据在build/background-tasks-settings-2026-11-06/；仅使用合成任务和素材，没有调用付费AI或修改生产数据。原生测试GUI尚未重启加载本轮后端。


2026-11-06 B设置页统一（UI规范1.31）：95组浏览器检查通过——新增settings-b-browser.cjs 9组，原设置18、通用目录15、Header/说明9、模型选择9、人脸卡片6、下载弹窗7、通用下拉9、可选模型13。覆盖七页14/13px层次、34px字段、右侧对齐、云端/本地分支、密码显示键盘操作、下载进度及错误、帮助焦点返回、设置保存/取消和迁移复制/校验；112个七页×四主题×明暗×双窗口布局场景验证固定操作栏和末行可达，另有七页可访问命名与键盘核查，不宣称全面WCAG合规。新增NATIVE_SELECT_OUTPUT便于隔离保留本轮下拉证据。

原生测试GUI完成正常重启及七页只读核查，恢复原视频设置页和墨玉暗色；4个素材、1107个标签、模型偏好及示例文件SHA-256前后一致，无设置保存/导入写请求。首次启动观察器在后端就绪、窗口尚未载入时提前结束；等待窗口后继续只读验证通过，没有再次重启或切换版本，保留native-failure.txt及native-results.json说明。证据在build/settings-b-unification-2026-11-06/validation-summary.json及对应截图；生产应用未替换。

所有服务与模型下载回归使用临时资料库及小型合成模型，无真实付费AI调用或真实权重性能测试。node --check与git diff --check通过。原生GUI保持运行供查看；本轮fixture服务、合成临时库和一次性驱动脚本已清理，保留验证记录及源码对照。

2026-11-07 设置弹窗固定高度（UI规范1.32）：先加入切换页签时外框、页签栏和底部操作位置不变的断言，在原有自动高度布局上复现失败；改为常规740px、小窗口为视口高度减48px后，settings-b-browser.cjs全部10组通过。112个七页×四主题×明暗×双窗口场景确认固定高度、内容滚动及末行可达；另验1440×900与1000×600窗口的加载中、成功和读取失败状态，三态位置及底部按钮均一致。无页面异常或失败请求。

原生测试GUI仅重新加载设置样式表，外框从485px变为740px，图片分析页签和未保存草稿均保留，未发出配置写请求或重启应用。证据见build/settings-fixed-height-2026-11-07/，包括修复前失败、修复后浏览器结果、状态几何及native-result.json。此轮只调整样式及缓存版本，不涉及后端或真实数据，未重新执行后端全套测试、打包、替换正式应用或提交推送。

2026-11-07 智能分类操作范围（UI规范1.33）：使用people-browser-fixture.py的合成图片、人物和临时资料库，运行PEOPLE_BROWSER_FIXTURE=<独立JSON> node tests/classification-actions-browser.cjs。修复前单选即复现多余人物操作行；修复后7组浏览器检查通过，覆盖不选/单选/多选、标签图集及智能图集、筛选栏不被选择操作下推、右键AI确认与取消、素材库/喜欢/人物相册原有操作、详情返回、素材选择模式、四主题明暗和紧凑英文。选中与取消流程没有AI、扫描、关联或配置写请求，无页面异常或失败请求。

gallery-state-regressions.cjs原来没有载入新增的三个Root mixin而在启动时失败；补齐真实模块依赖后17项通过。原生测试GUI确认没有草稿、弹窗或活动任务后刷新，保留当前分类、筛选及所选图片，两个多余入口均消失且没有写请求；正式应用及真实资料库未更改。证据保存在build/classification-actions-2026-11-07/，本轮fixture和临时资料库已清理；未执行后端全套、打包或Git提交推送。

2026-11-07 人物操作集中到人物相册（UI规范1.34）：扩展classification-actions-browser.cjs，先复现素材库单选仍出现人物操作行，再将该行仅限人物相册。修复后7组浏览器回归通过，素材库/我的喜欢不选、单选、多选均不显示人物操作，顶部AI仍能按所选图片/视频数量打开确认并取消；人物相册的关联与识别弹窗仍接收所选ID，离开相册后不残留。智能分类、图集、右键AI、详情返回、选择模式和四主题明暗/英文继续通过，无页面异常、失败请求或业务写请求。素材库原有标签操作行保留，不把它的布局变化误判为人物行；多选AI统计按图片、视频、音频总数核对。

原生测试GUI空闲且无弹窗时刷新，当前页面、筛选和所选素材保留，无配置或任务写请求。证据位于build/person-actions-scope-2026-11-07/；临时fixture与合成资料库已清理，正式应用和真实数据未更改。此轮仅调整人物行显示条件与缓存版本，不重跑后端全套、不打包或提交推送。

2026-11-07 批量标签弹层（UI规范1.35）：新增tag-actions-browser.cjs，先在原布局复现选中素材推动图库，修复后7组通过。24个三种窗口宽度×四主题×明暗几何场景确认单选前后图库位置一致、弹层336px且无横向溢出。使用真实合成库API验证添加、移除直接标签、排除子树、明确解除冲突排除与影响预览取消；整理已有分析的空范围保护、预览确认及快速分类任务契约在浏览器拦截，不启动真实模型。可控422验证loading、重复提交禁用、保留弹层与重试；键盘验证内外层Escape、触发器仍有焦点时的Escape、方向键/全选不修改图库、关闭后焦点返回、命名完整性、同一选择刷新不打断操作和实际范围变化关闭。

classification-actions-browser.cjs 7组继续通过，空选择改验不可见状态，保留水平占位的隐藏按钮不参与交互；素材库、喜欢、人物相册和分类的既定操作范围均保持。gallery-state-regressions.cjs 17项、taxonomy-state-regressions.cjs 30项通过，共14组浏览器与47项状态回归，无页面异常或意外失败请求。预览截图等待实际动画结束后采集，亮色中文和暗色英文见build/tag-actions-popup-2026-11-07/after/；不以刚挂载的透明弹层截图作为验收。

测试GUI确认空闲且无弹层后刷新，当前页面、筛选和所选素材保留，没有业务写请求。验证证据见build/tag-actions-popup-2026-11-07/validation-summary.json。本轮fixture和合成临时库已清理；未修改检查器、分类状态筛选或多选摘要，未修改后端、运行真实AI、替换正式应用、打包或提交推送。

2026-11-07 正式版1.0.17已安装：338项后端回归、桌面路径与迁移/即时切换检查通过。冻结包在真实资料库副本上验证4个主要页面、7个设置页固定740px、标签弹层和按钮范围；首轮观察器在入场动画中测得高度，等待实际动画完成后全部通过，原日志与副本未改表的核查结果保留。包内独立视频工作进程使用微型合成ONNX和4秒测试视频，1/2/3fps分别处理4/8/12帧，缺模型错误按协议返回，没有识别真实素材或调用付费AI。

实际升级保留48张表全部内容和原物理列序，11,835条素材、2个工程、14,058个既有资料文件及模型目录配置通过校验，自动升级快照与原表指纹一致。已观察本机正式窗口正常显示素材库；签名、DMG/ZIP和已安装载荷检查通过。演练副本、旧程序临时副本和重复构建物已清理，保留正式DMG与全部真实升级备份。交付记录见docs/local-update-1.0.17-2026-11-07.json；没有Git提交、推送或互联网发布。
