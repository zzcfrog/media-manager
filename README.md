# Media Manager

**AI 驱动的素材管理助手 — 让你专注于创作，而不是整理素材。**

你在剪辑时是不是也遇到过这些问题？

- 几百条素材散落在各个文件夹，想找一个镜头却无从下手
- 在 Lightroom 里给每段素材手动标注运镜、内容、人物、对话……工作量巨大
- 拍了一整天，真正开始剪辑前要花大量时间整理和筛选

Media Manager 用 AI 帮你自动完成这些。导入素材 → 一键分析 → 每一段视频都被打上结构化标签，写入 XMP 侧车文件，直接在 Lightroom、达芬奇、剪映里搜索和筛选。

---

## 它能做什么

### AI 自动分析

一段视频丢进去，AI 会自动完成：

- **画面描述** — 这段拍了什么（人物、场景、动作）
- **语音转文字** — 谁说了什么，精确到秒
- **镜头语言** — 景别（全景/中景/特写）、运镜（推拉摇移）、视角、焦段
- **场景氛围** — 情绪、光线、天气、场景类型
- **色彩与主体** — 主色调、画面核心元素

所有标签自动关联到对应的时间段，点击即跳转。图片同理，额外包含构图分析和风格识别。

### 无缝衔接编辑软件

分析完成后，一键将评分、标签、描述写入 **XMP 侧车文件**。这些数据可以直接被 Lightroom、Bridge、达芬奇等软件读取——你的素材在剪辑软件里就是带标签的，搜索、筛选、分类一步到位。

### 本地运行，隐私安全

所有数据都在你的电脑上处理，不需要上传到云端。AI 分析通过 API 调用大模型，文件本身不会离开你的磁盘。

---

## 功能一览

- **智能分析** — VLM 多模态大模型（智谱 GLM-4V 系列），自动识别画面内容、语音、字幕，生成 16 维度结构化标签
- **音频分析** — 本地 Whisper 模型或多模态统一处理，支持中英文语音识别
- **XMP 写入** — 分析结果写入标准 XMP 侧车文件，兼容 Adobe 全家桶
- **素材浏览** — 网格/列表双视图，文件夹树、时间线分组
- **全文搜索** — 中文分词搜索文件名、画面描述、对话内容、标签
- **多维筛选** — 类型、评分、颜色标签、收藏、分析状态
- **合集与标签** — 手动合集 + AI 自动标签，灵活组织
- **查找重复** — 精确哈希去重 + 感知哈希相似图片检测
- **视频示波器** — 波形图、RGB Parade、Vectorscope 实时渲染
- **桌面端** — Electron 封装，独立窗口，原生文件选择器

---

## 快速开始

### 环境要求

- Python 3.12+
- [ffmpeg](https://ffmpeg.org/)（视频压缩与缩略图）
- [exiftool](https://exiftool.org/)（元数据与 XMP 写入）

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
| 桌面端 | Electron |

## 支持的格式

**视频**：MP4 · MOV · AVI · MKV · WebM · M4V · FLV · WMV · 3GP · MTS · M2TS

**图片**：JPEG · PNG · WebP · BMP · TIFF · HEIC · HEIF · AVIF · DNG 及 20+ 种 RAW 格式（NEF · CR2 · CR3 · ARW · RAF · ORF · RW2 · IIQ · PEF · SRW 等）

---

## 文档

- [使用指南](docs/USAGE.md)
- [产品需求文档](docs/PRD.md)
- [交互设计](docs/UE_DESIGN.md)
- [技术架构](docs/TECH_DESIGN.md)
- [开发进度](docs/todo.md)

## License

MIT
