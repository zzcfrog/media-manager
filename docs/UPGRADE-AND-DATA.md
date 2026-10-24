# 映屿 · luminisle 本地安装、升级与数据迁移

2026-10-22：1.0.10 优化照片/视频导入（小批次元数据读取、有界并发、RAW 内嵌预览与导入结果虚拟滚动），新增右键「调整创建时间」的 ±24 小时滑块及批量处理。创建时间调整仅写文件系统时间戳，不重写媒体内容；升级沿用现有资料库、标注、工程和外部模型路径。

2026-10-22：1.0.9 修正音频波形缩略图的主题色同步，复用现有缩略图，不重新导入、解码或迁移素材；音频封面保持原色。

2026-10-22：1.0.8 新增温润墨玉、宣纸水墨、暖木书房、月光瓷釉四套外观，每套支持亮色、暗色及跟随系统。仅改变色彩与材质，现有布局、资料库和外部模型路径保持兼容。

2026-10-21：1.0.7 起，项目展示名称与图标更新为“映屿 · luminisle”，并修复深色界面与 macOS 窗口外观的同步。由旧名称的 1.0.6 升级时，继续读取现有资料；包标识 `com.zack.media-manager`、用户配置目录 `Media Manager`、资料库和外部模型路径保持兼容。

本包适用于 macOS 26 或更新系统的 Apple Silicon Mac。程序自带 Python、依赖、ffmpeg/ffprobe、ExifTool 和 llama-server；本地模型和私人资料库独立保存。

## 本机现有数据

资料库固定位置：

```text
~/Library/Application Support/Media Manager/library
```

其中包含数据库、工程、标注、评分/备注、缩略图及既有数据库备份。界面配置仍使用同一父目录下的 Chromium 配置，因此筛选、布局等配置随本机版本更新保留。

此次迁入 9,104 条媒体记录、4,322 条视频/图片分析片段、2 个工程、607 条轨道，以及所有已有表、设置与标签数据。旧项目的 `data`、模型和 Hugging Face 缓存均保留，没有移动或删除。

**原视频/照片约 1 TB，目前所有记录指向的源文件都离线。** 按本次确认，原素材保留原位置；库记录保留原绝对路径，连接原磁盘并恢复相同路径后可继续使用。迁移副本不包含外部模型或离线的原视频/照片。迁到另一台电脑时，须同时携带素材磁盘，或恢复相同目录路径；本包不会把离线素材误当作删除内容去清空资料库。

## 外部模型

本机模型现集中保存在 `/Users/zack/models`，与 `/Users/zack/program` 平级。VLM 在 `/Users/zack/models/vlm`，ResNet 在 `/Users/zack/models/resnet50.onnx`，Whisper 与对应 Qwen 缓存在 `/Users/zack/models/huggingface/hub`。

旧的 `backend/models` 和对应的 Hugging Face 缓存仓库目录保留兼容软链接，实际权重均已移动到新目录，没有重复存放。迁移前后已校验全部文件的 SHA-256，迁移记录见 `docs/model-relocation-2026-10-18.json`。

“资料库 → 选择外部模型目录…”可指定包含 `vlm` 子目录、`resnet50.onnx` 的模型根目录，保存后重启生效。配置保存在用户配置目录的 `model-paths.json`，升级应用时保留。本机配置的 `modelsDir` 为 `/Users/zack/models`、`hfHome` 为 `/Users/zack/models/huggingface`。所选目录应位于用户配置目录之外；新安装且未选择目录时，模型默认放在 `~/Library/Application Support/Media Manager Models`，Whisper 默认使用本机 Hugging Face 缓存。

导出迁移副本只记录这些外部路径，不复制外部模型。换电脑后从自己的模型磁盘重新选择目录，或单独下载模型；不要删除仍在使用的外部模型目录。应用升级不会改动该目录。

## 安装和之后升级

1. 打开新版 DMG，将 `映屿 · luminisle.app` 放到“应用程序”或用户的 Applications 文件夹。
2. 升级前退出旧版。首次从 `Media Manager.app` 改名升级时，Finder 不会按同名自动替换；先确认新版能读取原资料库，再移除旧应用文件或其 Dock 快捷方式。
3. 展示名称可以更新，包标识和用户数据目录必须保持不变。不要删除用户数据目录；新版继续使用下文的 `Media Manager` 路径。
4. 版本变更后的首次启动，在数据库初始化之前自动生成 `library/upgrade-backups` 快照。备份失败时停止启动，不继续迁移；现有备份不会被自动覆盖。
5. 资料库格式比应用支持的版本更新时，应用拒绝打开，防止旧版本写坏新数据。

当前支持手动替换应用升级；没有配置互联网自动更新服务器。升级只替换程序文件，不把数据库或模型写入 `.app`。[Electron 用户数据目录说明](https://www.electronjs.org/docs/latest/api/app)。

这是本地 ad-hoc 签名包，未使用 Apple Developer ID 公证。跨电脑首次启动若 macOS 要求确认，请通过 Finder 的“打开”或系统设置中的批准入口确认自己信任的本地构建；不需要关闭系统安全机制。[PyInstaller macOS 签名说明](https://pyinstaller.org/en/stable/feature-notes.html)。

## 完整迁移副本

应用菜单“资料库 → 导出完整迁移副本…”会在没有分析或下载任务时暂停后端，生成独立目录，并验证 SHA-256。导出成功后恢复服务；失败时保留原资料库及诊断现场，不自动覆盖、恢复或切换数据。

此前生成的 `dist/Media-Manager-Data-2026-10-18` 已按用户要求清理。以后可从上述菜单重新导出，生成的目录包含：

```text
library/     数据库、工程、标注、缩略图、既有备份
profile/     界面配置、外部模型路径（不重复包含 library）
export.json  全部文件与链接的校验清单
```

此目录含私人设置和 API 凭据，应仅存于自己的磁盘，不要公开分享。复制到另一块磁盘时要复制整个目录，勿只复制数据库。APFS 上可能使用写时复制克隆来节省空间；这些不是依赖旧路径的软链接，但同盘副本不能抵御整块硬盘故障。

## 恢复验证与命令行工具

先退出应用。运行应用内自带的工具，无需安装 Python：

```bash
TOOL="/Applications/映屿 · luminisle.app/Contents/Resources/backend/media-manager-backend"
"$TOOL" export --library "$HOME/Library/Application Support/Media Manager/library" \
  --profile "$HOME/Library/Application Support/Media Manager" \
  --destination "/你的备份盘/一个尚不存在的迁移目录"
"$TOOL" restore --snapshot "/你的备份盘/迁移目录" \
  --destination "/一个尚不存在的资料库目录"
```

恢复前校验整个迁移副本和逐表内容，损坏副本拒绝恢复；目的目录已存在时拒绝覆盖。恢复到新电脑时，把验证通过的资料库放在上述固定 `library` 位置。界面偏好可在应用关闭时从 `profile` 恢复到用户配置目录，先保留新电脑已有配置的副本，不盲目覆盖已有资料库。

如果启动或升级失败，退出应用，保留数据库、`upgrade-backups` 和 `logs`；不要自行删除现有数据再重装，也不要把旧数据库直接覆盖到新库上。先校验备份，再明确选择恢复点。

## 构建复现

构建机需要 Python 3.12、Node.js、ffmpeg/ffprobe 和 ExifTool，并保留 `electron/resources/bin/darwin-arm64` 中的 llama-server 分发目录。项目根目录创建构建虚拟环境并安装 `packaging/requirements-build.lock` 中锁定的依赖，在 `electron` 执行 `npm ci`，再运行：

```bash
.build-venv/bin/python packaging/build_macos.py
```

构建配置在 `packaging/backend.spec`、`packaging/backend-entitlements.plist`、`electron/package.json`。升级发布时递增 package.json 的 version，保持 appId `com.zack.media-manager` 和用户数据目录不变。应用包中不会包含私人数据库或模型权重。
