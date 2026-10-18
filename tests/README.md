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

如果使用本机已配置的 Playwright skill，可用该 skill 的 `node run.js <脚本绝对路径>` 启动。运行前仍需依照 skill 检测开发服务；只能连接 fixture JSON 指定的随机端口，不要连接其他开发服务。

默认 fixture 连接信息写入 `/tmp/video-analyzer-fix-browser.json`，可以为 fixture 和浏览器进程共同设置 `VIDEO_ANALYZER_TEST_FIXTURE` 改用独立位置。用 Ctrl+C 停止 fixture 后，合成库、素材和预览缓存会清理。脚本在 `/tmp` 写入本次验证摘要及截图；确认后可删除这些测试产物。
