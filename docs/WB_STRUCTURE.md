# 工作台页面结构命名（WB_STRUCTURE）

本文档定义工作台（Workbench）页面各区域的统一命名，供沟通和文档引用。

## 整体布局

```
┌──────────────────────────────────────────────────────────────────┐
│ 顶栏 ToolBar                                                      │
│ [时间线/脑图切换] [撤销/重做/分割/删除] [缩放滑杆] [生成方案]       │
├──────────────┬────────────────────────────┬─────────────────────┤
│ 素材面板      │ 预览区 Preview             │ 分片列表 SegList    │
│ MatPanel     │                            │                     │
│              │ ┌────────────────────────┐ │ ┌─────────────────┐ │
│ ┌──────────┐ │ │ 视频播放器 Player       │ │ │ 分片卡片 SegCard │ │
│ │素材卡片   │ │ │                        │ │ ├─────────────────┤ │
│ │MatCard   │ │ └────────────────────────┘ │ │ 分片卡片         │ │
│ ├──────────┤ │ 播放控件 PlayerCtrl         │ ├─────────────────┤ │
│ │...       │ │ 进度条 SeekBar             │ │ ...              │ │
│ └──────────┘ │ 分片详情 MetaDetail        │ └─────────────────┘ │
├──────────────┴────────────────────────────┴─────────────────────┤
│ 底栏 Bottom（高度可拖拽调整）                                      │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 时间线 Timeline / 脑图视图 MindMapView（二选一）              │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## 区域命名表

### 顶层区域

| 中文名 | 英文名 | 说明 |
|---|---|---|
| **顶栏** | **ToolBar** | 工具按钮区：视图切换、编辑操作、缩放控件、生成方案 |
| **素材面板** | **MatPanel** | 左列；素材/分片网格，可拖入时间线 |
| **预览区** | **Preview** | 中列；视频播放 + 元信息 |
| **分片列表** | **SegList** | 右列；分镜分片卡片，可拖入时间线 |
| **底栏** | **Bottom** | 时间线/脑图切换区，高度可拖拽调整 |

### 素材面板 MatPanel

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 素材卡片 | MatCard | 单个素材缩略图 + 时长 |

### 预览区 Preview

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 视频播放器 | Player | `<video>` 元素 |
| 播放控件 | PlayerCtrl | 播放/全屏按钮 + 时间显示 |
| 进度条 | SeekBar | 分片标记 + 拖拽 seek |
| 分片详情 | MetaDetail | 编码/相机/音频参数 |

### 分片列表 SegList

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 分片卡片 | SegCard | 单个分片：缩略图 + 时间 + 可编辑 |

### 时间线 Timeline

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 标尺行 | RulerRow | 时间刻度行 |
| 标尺内容 | RulerContent | 刻度线 + 刻度标签 |
| 情绪行 | EmotionRow | 情绪轨道行（独立于内容组） |
| 情绪曲线 | EmotionCurve | SVG 平滑曲线 |
| 内容组 | ContentGroup | 旁白+字幕+分镜 3 条轨道的容器 |
| 行头列 | LabelCol | 冻结的左侧标签列（60px，sticky） |
| 内容区 | ContentArea | 可滚动的时间轴内容区 |
| 标题区 | TitleZone | 内容组顶部空白区（40px，放叙事框标题） |

#### 轨道（Lane）

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 旁白道 | NarrationLane | 旁白轨道 |
| 字幕道 | SubtitleLane | 字幕轨道 |
| 分镜道 | VideoLane | 分镜视频轨道 |
| 情绪道 | EmotionLane | 情绪轨道（在 EmotionRow 内） |

#### 轨道块（Track Item）

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 分镜块 | VideoItem | 分镜视频块（缩略图 + 标签） |
| 旁白块 | NarrationItem | 旁白块 |
| 字幕块 | SubtitleItem | 字幕块 |
| 情绪块 | EmotionItem | 情绪点块 |

#### Overlay 框（主旨/叙事覆盖层）

| 中文名 | 英文名 | 说明 |
|---|---|---|
| **主旨框** | **ThemeFrame** | 跨整个 act 的覆盖框（实线边框） |
| **叙事框** | **NarrativeFrame** | 单个 narrative 的覆盖框（虚线边框） |
| 框背景层 | FrameFill | 半透明背景填充（z-index 3，在分镜块之下） |
| 框边框层 | FrameBorder | 虚线/实线边框（z-index 11，在分镜块之上） |
| 框标题 | FrameLabel | 框内标题文字（可双击改名） |

#### 其他

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 播放头 | Playhead | 红色竖线（z-index 12） |
| 拖拽预览 | DragGhost | 拖动时跟随鼠标的缩略图浮层 |

### 脑图视图 MindMapView

| 中文名 | 英文名 | 说明 |
|---|---|---|
| 主旨节点 | ActNode | 脑图中的 act 卡片 |
| 叙事节点 | NarrativeNode | 脑图中的 narrative 卡片 |
| 镜头节点 | ShotCard | 脑图中的 shot 卡片 |

## z-index 层级

| z-index | 元素 | 说明 |
|---|---|---|
| 3 | FrameFill | 框背景填充 |
| 5 | RulerRow | 标尺行 |
| 10 | VideoItem / AuxItem | 分镜块/旁白块/字幕块 |
| 11 | FrameBorder | 框边框（虚线/实线） |
| 12 | Playhead | 红色竖线 |
| 14 | LabelCol / 行头 | 冻结的左侧标签列（最高层） |

## 数据模型层级

```
plan (ai_plan JSON)
└── act（主旨）
    ├── act_id, title, purpose
    └── narrative（叙事）
        ├── narrative_id, text
        └── shot（分镜）
            ├── segment_id → media_segment 表
            ├── src_start / src_end → 源素材截取区间
            ├── narration → 旁白文字
            ├── emotion → 情绪值 0~1
            └── use_asr → 是否用原声做字幕

tracks (project_tracks 表，时间线展开)
├── video track item ← shot 的 src 区间累加展开
├── emotion track item ← shot.emotion
├── narration track item ← shot.narration
├── subtitle track item ← segment.asr (当 use_asr)
├── text track item ← narrative.text (覆盖框)
└── theme track item ← act.title (覆盖框)
```

- **时间点不持久化**：只有顺序 + src 区间持久化，所有时间点（time_start/time_end）都是「顺序累加」的派生值
- **脑图编辑** → 直接改 plan → apply 重建 tracks
- **时间线编辑** → 改 tracks → syncTracksToPlan 反写 plan
