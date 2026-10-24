# 回归测试

测试使用临时目录、合成 SQLite/媒体数据。不要把 MEDIA_MANAGER_HOME 改成真实用户数据目录。测试不调用真实 AI 或加载模型权重；应用工厂的错误处理测试显式隔离数据库、日志和预加载。

使用 Python 3.12+，先在虚拟环境安装项目 `requirements.txt`，再从项目根目录运行：

```bash
python -m unittest discover -s tests -v
node tests/frontend-regressions.cjs
node tests/desktop-runtime.cjs
```

包含真实媒体/XMP 对照，需安装 ffmpeg、ffprobe、exiftool。全新安装依赖的验收环境版本和结果记录在 `docs/code-fixes-validation-2026-10-18.json`。

本地打包增加资料库复制、外部模型链接独立化、失败不发布、校验恢复、升级前快照及新格式拒绝写入的回归测试。安装和迁移说明见 `docs/UPGRADE-AND-DATA.md`。

macOS 界面重构增加检查器并发、失败重试及键盘焦点回归。浏览器 fixture 可用 `VIDEO_ANALYZER_UI_FIXTURE=1` 增加合成音频；可选的 `VIDEO_ANALYZER_UI_POSTERS` 指向 JPG 演示图目录，不设置也可离线运行。覆盖清单和验证边界见 `docs/UI-NATIVE-2026-10-18.md`。每次完整重跑浏览器脚本须新建 fixture，最后一个脚本会删除/重建合成片段。

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
