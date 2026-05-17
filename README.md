# Media Manager

AI 驱动的本地媒体素材管理工具，支持视频智能分析、目录浏览、收藏标记、全文搜索等功能。

## 功能

- **素材库管理** — 网格/列表双视图，按时间、评分、大小排序，支持日期/时长分组
- **AI 视频分析** — 基于 VLM 多模态大模型，自动识别画面内容、语音、字幕，生成分段时间轴描述
- **音频分析** — 支持本地 Whisper 模型或云端 ASR，可由视频模型多模态统一处理或独立运行
- **文件夹浏览** — Lightroom 风格的目录树，按文件夹筛选素材
- **收藏夹 & 标签** — 手动收藏夹 + 自动标签，灵活组织素材
- **评分 & 颜色标记** — 1-5 星评分 + 7 色标记，快速分类
- **全文搜索** — FTS5 + jieba 中文分词，搜索文件名、分析内容、标签
- **筛选系统** — 媒体类型、评分、颜色、收藏、已分析状态多维度筛选
- **暗色/亮色主题** — 支持 8 种主题色自定义
- **桌面端** — Electron 打包，独立应用体验

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3 + Quasar Framework (UMD) |
| 后端 | Flask + SQLite (FTS5) |
| AI | 智谱 GLM-4V / OpenAI / faster-whisper |
| 桌面端 | Electron |

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 启动

```bash
python run.py
```

浏览器自动打开 `http://127.0.0.1:6622`。

### 配置

首次使用前，在右上角 **设置** 中配置：

1. 选择 AI 模型（智谱 GLM-4V-Plus / GLM-4.6V / GLM-4.6V-Flash 等）
2. 填入对应平台的 API Key
3. 选择音频分析方式（多模态统一处理 / 独立 ASR）

## 项目结构

```
├── backend/
│   ├── blueprints/       # Flask 路由（素材库、分析、收藏夹、标签、设置）
│   ├── asr/              # ASR 引擎插件架构（Whisper 本地模型）
│   ├── services/         # 导入、缩略图生成
│   ├── analyzer.py       # VLM 分析核心
│   ├── compressor.py     # 视频压缩转码
│   └── db.py             # SQLite 数据库初始化
├── frontend/
│   ├── index.html        # 主页面 + 设置弹窗
│   ├── js/               # Vue 组件（gallery、detail、api）
│   └── css/              # 样式
├── electron/             # Electron 桌面端打包
├── docs/                 # 产品设计文档
└── run.py                # 启动入口
```

## 文档

- [产品需求文档](docs/PRD.md)
- [交互设计](docs/UE_DESIGN.md)
- [技术架构](docs/TECH_DESIGN.md)
- [开发进度](docs/todo.md)

## License

MIT
