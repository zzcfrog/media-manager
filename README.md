# Media Manager

**AI 驱动的素材管理助手 — 让你专注于创作，而不是整理素材。**

你在剪辑时是不是也遇到过这些问题？

- 几百条素材散落在各个文件夹，想找一个镜头却无从下手
- 在 Lightroom 里给每段素材手动标注运镜、内容、人物、对话……工作量巨大
- 拍了一整天，真正开始剪辑前要花大量时间整理和筛选

Media Manager 用 AI 帮你自动完成这些。导入素材 → 一键分析 → 每一段视频都被打上结构化标签，写入 XMP 侧车文件，直接在 Lightroom、达芬奇、剪映里搜索和筛选。

<p align="center"><img src="docs/screenshots/整体素材库.webp" width="100%" /></p>

---

## 截图

<table>
  <tr>
    <td align="center"><b>AI 分析结果</b></td>
    <td align="center"><b>图片详情页</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/视频详情页.webp" width="100%" /></td>
    <td><img src="docs/screenshots/图片详情页.webp" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>批量分析</b></td>
    <td align="center"><b>全文搜索</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/批量分析.webp" width="100%" /></td>
    <td><img src="docs/screenshots/搜索.webp" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>多维筛选</b></td>
    <td align="center"><b>批量选择</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/筛选.webp" width="100%" /></td>
    <td><img src="docs/screenshots/批量选择.webp" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>查找相似</b></td>
    <td align="center"><b>HDBSCAN 聚类</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/相似.webp" width="100%" /></td>
    <td><img src="docs/screenshots/聚类.webp" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>时间线分组</b></td>
    <td align="center"><b>导入进度</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/时间线.webp" width="100%" /></td>
    <td><img src="docs/screenshots/导入中.webp" width="100%" /></td>
  </tr>
</table>

<p align="center"><b>多种视图模式</b></p>
<table>
  <tr>
    <td align="center">瀑布流</td>
    <td align="center">等高行</td>
    <td align="center">列表</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/瀑布流.webp" width="100%" /></td>
    <td><img src="docs/screenshots/等高行.webp" width="100%" /></td>
    <td><img src="docs/screenshots/列表.webp" width="100%" /></td>
  </tr>
</table>

<p align="center"><b>主题与语言</b></p>
<table>
  <tr>
    <td align="center">浅色主题</td>
    <td align="center">设置页</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/白色主题.webp" width="100%" /></td>
    <td><img src="docs/screenshots/语言主题设置.webp" width="100%" /></td>
  </tr>
</table>

---

## 它能做什么

### AI 自动分析

一段视频丢进去，AI 会自动完成：

- **画面描述** — 这段拍了什么（人物、场景、动作）
- **语音转文字** — 谁说了什么，精确到秒
- **字幕识别** — 画面中的文字内容
- **镜头语言** — 景别（全景/中景/特写）、运镜（推拉摇移）、视角、焦段、景深
- **场景氛围** — 情绪、光线、天气、场景类型
- **色彩与主体** — 主色调、色调、影调、画面核心元素
- **风格与构图** — 拍摄风格识别（电影感、日系、纪实等）、构图分析

视频产出 13 个维度、图片产出 16 个维度的结构化标签，所有字段支持点击编辑。

### 批量分析

画廊中选中多个素材，右键一键提交批量 AI 分析。确认弹窗显示：
- 素材数量（视频/图片分别统计）
- 使用的 AI 模型
- 已有分析结果的素材处理策略（重新分析 / 跳过）

分析过程中顶部进度条实时跟踪所有任务状态。

### 无缝衔接编辑软件

分析完成后，一键将评分、标签、描述写入 **XMP 侧车文件**。这些数据可以直接被 Lightroom、Bridge、达芬奇等软件读取——你的素材在剪辑软件里就是带标签的，搜索、筛选、分类一步到位。

### 本地运行，隐私安全

所有数据都在你的电脑上处理，不需要上传到云端。AI 分析通过 API 调用大模型，文件本身不会离开你的磁盘。

---

## 功能一览

### 智能分析

- **多模态大模型** — 智谱 GLM-4V 系列（GLM-4V-Plus / 4.6V / 4.6V-Flash / 4.6V-FlashX / 4.5V）
- **批量分析** — 选中多个素材一键排队，进度条实时跟踪
- **硬件加速压缩** — 自动检测 GPU 编码器（macOS VideoToolbox / NVIDIA NVENC / Intel QSV），4K HEVC 压缩提速 6 倍
- **图片独立配置** — 图片和视频可分别选择 AI 模型和压缩参数
- **音频分析** — 多模态统一处理或独立 ASR 引擎（本地 Whisper），支持中英文语音识别

### 浏览与管理

- **双视图** — 网格视图（可调卡片大小）和列表视图，按 `G` 键快速切换
- **文件夹目录树** — 侧边栏 Lightroom 风格目录树，按文件夹快速筛选
- **多维筛选** — 类型（全部/图片/视频）、评分（1-5 星）、颜色标签（5 色）、喜欢（三态：全部/已喜欢/未喜欢）、分析状态（三态：全部/已分析/未分析）
- **全文搜索** — 中文分词搜索文件名、画面描述、对话内容、标签
- **排序与分组** — 按导入时间/拍摄时间/名称/分辨率/时长/大小/评分排序，支持按时间段（日/周/月/季/年）或时长分组
- **筛选标签** — Footer 居中显示当前所有活跃筛选条件，一目了然
- **状态持久化** — 所有筛选条件、排序、视图、文件夹选择刷新页面后自动恢复

### 收藏与评分

- **评分** — 1-5 星评分，画廊中选中多个文件后按数字键批量评分
- **喜欢** — 红心喜欢标记，按 `F` 键批量切换
- **颜色标签** — 红、黄、绿、蓝、紫五色标记，按 `6` `7` `8` `9` `0` 快速标记

### 组织与检索

- **合集** — 手动创建合集，右键添加素材
- **标签** — AI 分析完成后自动关联主体、颜色、场景等标签
- **查找相似** — 基于 ResNet50 深度特征 + HDBSCAN 聚类，弹窗展示酷似/相似/聚类三级结果

### 专业工具

- **XMP 写入** — 评分、颜色标签、AI 标签和描述写入标准 XMP，兼容 Adobe 全家桶
- **视频示波器** — 波形图（Waveform）、RGB Parade、Vectorscope 实时渲染（~15fps）
- **音频波形** — 可视化音频波形，点击跳转到对应时间点
- **图片全屏看图** — 缩放（25%-500%）+ 拖拽平移 + 导航缩略图 + 全屏模式
- **RGB 直方图** — 三通道色彩分布

### 其他

- **国际化** — 中文 / English 双语支持
- **桌面端** — Electron 封装，独立窗口，原生文件选择器
- **后台任务恢复** — 刷新页面后自动从后端恢复分析进度

---

## 快速开始

### 环境要求

- Python 3.12+
- [ffmpeg](https://ffmpeg.org/)（视频压缩、缩略图生成、实时转码）
- [exiftool](https://exiftool.org/)（相机元数据、XMP 写入）

### 安装

```bash
git clone https://github.com/zzcfrog/media-manager.git
cd media-manager
pip install -r requirements.txt
```

### 启动

```bash
python run.py
```

浏览器自动打开 `http://127.0.0.1:6622`。

也可以通过 Electron 启动桌面端：

```bash
cd electron && npm start
```

### 配置 AI 模型

首次使用前，在右上角 **设置** 中：

1. 选择 AI 模型（推荐 GLM-4.6V，性价比最高；GLM-4.6V-Flash 免费）
2. 填入 [智谱 AI](https://open.bigmodel.cn/) API Key
3. 根据需要调整压缩参数和音频模式

---

## 快捷键

### 画廊

| 快捷键 | 功能 |
|--------|------|
| `↑↓←→` | 移动选中 |
| `Enter` | 打开详情 |
| `Delete` | 从库中移除 |
| `1`-`5` | 评分 |
| `6`/`7`/`8`/`9`/`0` | 颜色标签（红/黄/绿/蓝/紫） |
| `F` | 切换喜欢 |
| `G` | 切换网格/列表视图 |
| `/` | 聚焦搜索框 |

### 详情页

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 上一个 / 下一个 |
| `1`-`5` | 评分 |
| `F` | 全屏看图 |
| `Space` | 播放/暂停视频 |
| `Backspace` | 返回画廊 |

---

## 典型工作流

```
导入素材文件夹 → AI 一键分析 → 浏览 & 搜索标签 → 写入 XMP → 在 Lightroom / 达芬奇 / 剪映中使用
```

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3 + Quasar Framework |
| 后端 | Flask + SQLite (FTS5) |
| AI | 智谱 GLM-4V (OpenAI 兼容) + faster-whisper |
| 相似检测 | ResNet50 (ONNX) + HDBSCAN |
| 桌面端 | Electron |

## 支持的格式

**视频**：MP4 · MOV · AVI · MKV · WebM · M4V · FLV · WMV · 3GP · MTS · M2TS

> 非 H.264 格式（AVI、MKV、MTS 等）播放时自动转码。

**图片**：

- **常见格式**：JPEG · PNG · WebP · BMP · TIFF
- **Apple/HEIF**：HEIC · HEIF · HIF · AVIF
- **RAW 格式**（40+ 种）：Adobe DNG · Canon CR2/CR3/CRW · Nikon NEF/NRW · Sony ARW/SRF/SR2 · Fujifilm RAF · Olympus ORF · Panasonic/Leica RAW/RW2/RWL · Hasselblad 3FR/FFF · Phase One IIQ · Pentax PEF · Sigma X3F · Samsung SRW · Mamiya/Leaf MEF/MOS · Kodak KDC/DCR · Minolta MRW · Apple ProRAW

---

## 文档

- [使用指南](docs/USAGE.md)
- [产品需求文档](docs/PRD.md)
- [交互设计](docs/UE_DESIGN.md)
- [技术架构](docs/TECH_DESIGN.md)
- [开发进度](docs/todo.md)

## License

MIT
