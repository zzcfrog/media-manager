# 回归测试

测试使用临时目录、合成 SQLite/媒体数据。不要把 MEDIA_MANAGER_HOME 改成真实用户数据目录。测试不调用真实 AI 或加载模型权重；应用工厂的错误处理测试显式隔离数据库、日志和预加载。

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

UI 规范专项：分别启动 `browser_fixture.py` 和 `people-browser-fixture.py`，为两个服务及测试传入 `VIDEO_ANALYZER_TEST_FIXTURE`、`PEOPLE_BROWSER_FIXTURE` 的独立 JSON 路径，再运行 `node tests/ui-spec-browser.cjs`。9 组检查覆盖八种主题的主按钮与选中分段对比度、普通/错误描边、键盘评分/颜色筛选、单/多选右键菜单、统一尺寸/间距、人物工具栏及中英文导出取消；不提交导出、运行 AI 或写入真实资料库。结果位于 `build/ui-spec-validation/`。文件夹回归现限定带 `data-path` 条目的目录树，避免将同侧栏的标签树一起匹配。
