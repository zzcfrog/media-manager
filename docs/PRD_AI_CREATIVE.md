# PRD — AI 创意引导器（Creative Guide）

## 1. 产品定位

AI 创意引导器是创作工作台的核心升级，将产品定位从「AI 辅助粗剪工具」提升为**「AI 驱动的创意构思工具」**。

**解决的核心问题**：创作者拍摄完大量素材后，在剪辑之前需要一个工具来帮助构思——用什么钩子开场、怎么组织叙事结构、情绪如何起伏、收尾如何设计。目前没有任何工具支撑这个「构思阶段」。

**核心转变**：

| 维度 | 现状 | 目标 |
|------|------|------|
| 工作方式 | 手动拖 segment 到轨道 | AI 理解素材后生成完整创作方案 |
| 编排对象 | 单个 segment（片段级） | 叙事段落（故事级） |
| AI 角色 | 提供分析数据 | 像导演一样构思和推荐 |
| 用户操作 | 从零开始排列 | 在 AI 方案基础上精修 |

## 2. 目标用户与场景

| 用户类型 | 典型场景 | 核心诉求 |
|----------|----------|----------|
| 旅行 Vlogger | 一次旅行 200-500 条素材，无剧本 | 从海量素材中发现叙事线索，快速出片 |
| 纪录片/访谈创作者 | 大量采访 + B-roll，复杂叙事 | 按主题组织对话，匹配 B-roll，控制节奏 |
| 中长视频创作者 | 30 分钟旅行/生活纪录片 | 构建完整的情绪弧线和叙事结构 |

**对标创作者**：小鹿Lawrence、Links photograph 等中长视频头部博主。

## 3. 核心流程

```
素材库（已 AI 分析）
    │
    │  所有 video × segment × 16维元数据
    ▼
┌──────────────────────────────┐
│  创意引导器（6步分步表单）      │
│  1. 选素材                    │
│  2. 选模板                    │
│  3. 叙事结构                  │
│  4. 情绪弧线                  │
│  5. 声音设计                  │
│  6. 确认生成                  │
│  每步展示素材统计摘要          │
└──────────────────────────────┘
    │
    │  用户选择 → 结构化 JSON 创作指令
    │  + 素材分析数据 JSON
    ▼
┌──────────────────────────────┐
│  大模型（导演角色）            │
│  理解素材 → 构思叙事 → 输出方案│
└──────────────────────────────┘
    │
    │  结构化返回（acts → shots → segment_id）
    ▼
┌──────────────────────────────┐
│  自动组装时间线                │
│  shot → 轨道项目              │
│  act → 成片大纲段落            │
│  总时长 ≈ 目标时长             │
└──────────────────────────────┘
    │
    ▼
  创作者在时间线上精修：
  - 改文字（旁白/描述/主旨）
  - 换分片（替换不满意的镜头）
  - 调顺序（拖拽调整叙事）
  - 改时长（缩短/延长段落）
```

## 4. 创意引导器 — 分步设计

引导器是一个**全屏分步对话框**，在工作台页面内触发。用户通过 6 个步骤表达创作意图：选素材 → 选模板 → 叙事结构 → 情绪弧线 → 声音设计 → 确认生成。第 1 步自动弹出全局素材选择器，选中后回到引导器显示已选素材摘要。

### 4.1 选素材

进入引导器后自动弹出全局素材选择器（90vw × 90vh 弹窗，复用工作台素材选择器组件）。用户勾选素材后点确认，回到引导器下一步。

### 4.2 选模板

选择创作模板，确定视频类型和整体风格。

**可选模板**：

| 模板 | 说明 | 典型时长 |
|------|------|----------|
| 🎬 长视频叙事 | 纪录片/旅行日志风格，完整叙事弧线 | 15-45 分钟 |
| ⚡ 快剪气氛 | 节奏感强的蒙太奇，情绪渲染 | 30s-3min |
| 📝 自由创作 | 无预设结构，全自定义 | 不限 |

选择模板后展开**子模板选项**：

**长视频叙事的子模板**：

| 维度 | 选项 |
|------|------|
| 开场方式 | 悬念钩子（先抛结果/冲突）、氛围建立（空镜+音乐起）、人物出场（直接引入主角）、金句开场（一句点题的话） |
| 叙事结构 | 按时间线（从早到晚）、按主题（几个独立章节）、对比式（前后对比）、三幕式（建立→冲突→解决） |
| 情绪弧线 | 渐入高潮型、过山车型、深沉叙事型、自定义 |
| 收尾方式 | 回扣开头（首尾呼应）、升华总结（提炼主旨）、开放式（留白）、行动号召（呼吁/展望） |

**快剪气氛的子模板**：

| 维度 | 选项 |
|------|------|
| 风格 | 卡点式（踩节拍）、蒙太奇（意象堆叠）、转场炫技 |

**素材匹配提示**（每步都显示）：

```
你的素材库中有：
  12 段户外空镜 · 3 段人物特写 · 8 段日出日落 · 15 段自然声
→ 推荐使用「氛围建立」开场
```

### 4.3 叙事结构

确定视频的叙事骨架。

**选项**（根据模板动态展示）：

| 选项 | 说明 |
|------|------|
| 按时间线 | 素材按拍摄时间顺序排列，呈现事件发展 |
| 按主题 | 按内容主题分章节，每个主题独立成段 |
| 三幕式 | 建立（铺垫背景）→ 冲突（制造张力）→ 解决（高潮收尾） |
| 对比式 | 前后对比 / 理想 vs 现实 / 静 vs 动 |

**关键输入**：

- **目标时长**：数字输入（分钟），默认 30 分钟
- **主题描述**（可选）：一句话描述视频主题，如「京都三日，从游客到旅人」
- **素材统计**：自动展示当前工程中的素材总量和总时长

```
目标时长：[30] 分钟
你有 47 个片段，总时长 52 分钟
```

### 4.4 情绪弧线

确定情绪走势。

**预设弧线**（可视化选择）：

| 弧线 | 走势图 | 适合场景 |
|------|--------|----------|
| A. 渐入高潮 | 平稳起步 → 持续攀升 → 高潮收尾 | 旅行日志、成长故事 |
| B. 过山车 | 多次起伏，波峰波谷交替 | 纪录片、冒险题材 |
| C. 深沉叙事 | 低沉铺垫 → 缓慢上升 → 沉稳收尾 | 人物访谈、文艺片 |
| D. 自定义 | 用户手绘曲线 | 高级用户 |

**素材情绪分析**（自动展示）：

```
你的素材情绪分布：
  平静 23 段 · 紧张 8 段 · 欢快 12 段 · 忧郁 4 段
```

### 4.5 声音设计

确定声音方案。

**旁白风格**：

| 选项 | 说明 |
|------|------|
| 同期声为主 | 保留现场声音，沉浸感强 |
| 后期旁白 | 录制解说，信息量大 |
| 混合 | 关键段同期声 + 过渡段旁白 |
| 纯音乐+画面 | 无对白，靠画面和音乐叙事 |

**音乐方向**：

| 维度 | 选项 |
|------|------|
| 情绪 | 沉稳 / 激昂 / 温暖 / 神秘 |
| 节奏 | 慢 / 中 / 快 |
| 乐器风格 | 钢琴 / 弦乐 / 电子 / 民谣 / 氛围 |
| 自由描述 | 文本输入，如「类似 Links 那种旅行感」 |

### 4.6 确认与生成

展示用户所有选择的摘要，确认后调用大模型。

```
┌──────────────────────────────────────┐
│  创作方案确认                          │
│                                      │
│  模板    长视频叙事 · 氛围建立         │
│  结构    三幕式 · 目标 30 分钟         │
│  弧线    渐入高潮型                    │
│  声音    混合（同期声+旁白）            │
│  音乐    温暖 · 中速 · 钢琴+弦乐       │
│  收尾    回扣开头                      │
│                                      │
│  素材：47 个片段 / 52 分钟             │
│                                      │
│  ℹ AI 将基于你的选择和素材分析生成方案   │
│                                      │
│         [上一步]  [开始生成]            │
└──────────────────────────────────────┘
```

## 5. AI 生成方案

### 5.1 输入组装

将用户的创作指令 + 工程中所有素材的分析结果组装为 JSON 发送给大模型。

**创作指令 JSON**：

```json
{
  "template": "long_documentary",
  "duration_target": 1800,
  "opening": {
    "type": "atmosphere",
    "note": "空镜+音乐起，建立氛围"
  },
  "structure": "three_act",
  "emotion_arc": "gradual_build",
  "voice": {
    "style": "mixed",
    "narration_tone": "温暖沉稳"
  },
  "music": {
    "mood": "warm",
    "tempo": "medium",
    "instruments": ["piano", "strings"],
    "reference": ""
  },
  "ending": {
    "type": "bookend"
  }
}
```

**素材数据 JSON**（按拍摄时间排序的所有 segment）：

```json
[
  {
    "media_id": 5,
    "media_file": "DJI_20240601_001.MP4",
    "segments": [
      {
        "segment_id": 23,
        "time_start": "00:00.00",
        "time_end": "00:15.30",
        "duration": 15.3,
        "visual": "日出时分，天空从深蓝渐变为橙红...",
        "asr": "",
        "shot_type": "全",
        "scene_type": "自然",
        "mood": "平静",
        "lighting": "自然光",
        "weather": "晨昏",
        "camera_movement": "固定",
        "dominant_colors": ["橙色", "蓝色"],
        "main_subjects": ["日出", "云层"]
      }
    ]
  }
]
```

### 5.2 大模型 Prompt 设计

```
你是一位资深视频导演，擅长将素材组织成有叙事结构的中长视频。

## 任务
根据以下素材数据和创作指令，生成一份完整的视频创作方案。

## 创作指令
{creative_brief_json}

## 可用素材
{segments_json}

## 输出要求
严格按照以下 JSON Schema 输出，不要输出任何其他内容。

## 创作原则
1. 开头必须有吸引力（钩子），在前 30 秒抓住观众
2. 情绪弧线要有起伏，避免全程平淡或全程高潮
3. 相邻镜头的视觉连贯性（场景类型、色调、光线）
4. 节奏有张有弛，快慢交替
5. 总时长尽量接近目标时长（可 ±10%）
6. 每个 shot 必须指向一个真实存在的 segment_id
7. 如果素材不够支撑目标时长，优先保证质量而非凑时长
8. 如果有 ASR 内容，合理利用同期声增强叙事
```

### 5.3 输出 Schema（大模型返回结构）

```json
{
  "title": "方案标题",
  "summary": "一句话描述这个方案的核心创意",
  "total_duration": 1780,
  "acts": [
    {
      "act_id": "act_1",
      "title": "开场·悬念",
      "purpose": "用日出空镜建立氛围，吸引观众",
      "emotion_start": 0.2,
      "emotion_end": 0.4,
      "shots": [
        {
          "segment_id": 23,
          "purpose": "钩子：日出延时，视觉冲击",
          "narration": "凌晨四点半，天边开始泛起微光...",
          "use_asr": false,
          "emotion": 0.3,
          "music": {
            "mood": "安静期待",
            "tempo": "slow",
            "instruments": ["piano"],
            "note": "轻柔钢琴起，渐入"
          },
          "transition": "fade_in"
        }
      ]
    }
  ]
}
```

**Schema 字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 方案标题 |
| `summary` | string | 核心创意一句话 |
| `total_duration` | number | 预计总时长（秒） |
| `acts[].act_id` | string | 幕 ID（唯一标识） |
| `acts[].title` | string | 幕标题（如「开场·悬念」） |
| `acts[].purpose` | string | 这幕的创作意图 |
| `acts[].emotion_start/end` | float | 这幕的情绪起止值 (0-1) |
| `acts[].shots[].segment_id` | int | 指向 media_segment 表的 ID |
| `acts[].shots[].purpose` | string | 这个镜头的创作意图 |
| `acts[].shots[].narration` | string | 建议的旁白文案 |
| `acts[].shots[].use_asr` | bool | 是否使用同期声 |
| `acts[].shots[].emotion` | float | 情绪强度 (0-1) |
| `acts[].shots[].music` | object | 音乐指导 |
| `acts[].shots[].transition` | string | 转场建议（fade_in/cut/dissolve/wipe） |

### 5.4 生成过程 UI

大模型生成过程中展示实时进度：

```
┌────────────────────────────────────────┐
│  🎬 AI 正在构思...                      │
│                                        │
│  ● 分析素材内容...                      │
│  ● 构建叙事结构...                      │
│  ● 匹配镜头与情绪...                    │
│  ● 撰写旁白文案...                      │
│  ● 优化节奏与转场...                    │
│                                        │
│  ████████████░░░░░░░░  60%             │
│                                        │
│  已生成 3 幕 / 7 个镜头 / 预计 18:30     │
└────────────────────────────────────────┘
```

## 6. 自动组装时间线

大模型返回方案后，产品自动将结果组装到工作台的时间线上。

### 6.1 组装规则

| AI 输出 | 时间线映射 |
|---------|-----------|
| `acts[i]` | → 主旨线的一个条目（标题+描述） |
| `acts[i].shots[j]` | → 视频线的一个条目（引用 segment） |
| `acts[i].shots[j].narration` | → 旁白线的一个条目 |
| `acts[i].shots[j].emotion` | → 情绪线的锚点值 |
| `acts[i].shots[j].use_asr && segment.asr` | → 字幕线的一个条目（填充 ASR 内容） |
| `acts[i].title` | → 文字线的一个条目（幕标题） |

### 6.2 时间轴计算

1. 从第一个 shot 开始，按顺序排列在视频线上
2. 每个 shot 的时长 = 该 segment 的 `time_end - time_start`
3. 相邻 shot 紧密排列（无间隔）
4. 主旨线条目的时间范围 = 该幕内所有 shot 的时间范围之和
5. 情绪线在每个 shot 的中点位置设置锚点，值为 `emotion`

### 6.3 数据写入

使用现有的 `project_tracks` 表存储，通过 `PUT /api/workbench/:id/tracks` 接口批量写入：

```python
# 每个 act 的 shots 按顺序生成 track items
tracks = []
position = 0
for act in result["acts"]:
    act_start = position
    for shot in act["shots"]:
        seg = get_segment(shot["segment_id"])
        duration = parse_time(seg["time_end"]) - parse_time(seg["time_start"])

        # 视频线
        tracks.append({
            "track_type": "video",
            "segment_id": shot["segment_id"],
            "position": position,
            "time_start": fmt_time(position),
            "time_end": fmt_time(position + duration),
            "metadata": json.dumps({"purpose": shot["purpose"]})
        })
        # 旁白线
        if shot.get("narration"):
            tracks.append({
                "track_type": "narration",
                "content": shot["narration"],
                "position": position,
                "time_start": fmt_time(position),
                "time_end": fmt_time(position + duration),
            })
        # 情绪线
        tracks.append({
            "track_type": "emotion",
            "emotion_value": shot.get("emotion", 0.5),
            "position": position,
            "time_start": fmt_time(position),
            "time_end": fmt_time(position + duration),
        })
        # 字幕线（同期声）
        if shot.get("use_asr") and seg.get("asr"):
            tracks.append({
                "track_type": "subtitle",
                "segment_id": shot["segment_id"],
                "content": seg["asr"],
                "position": position,
                "time_start": fmt_time(position),
                "time_end": fmt_time(position + duration),
            })
        position += duration

    # 主旨线（每个 act 一个条目）
    tracks.append({
        "track_type": "theme",
        "content": act["title"],
        "position": act_start,
        "time_start": fmt_time(act_start),
        "time_end": fmt_time(position),
        "metadata": json.dumps({"purpose": act.get("purpose", "")})
    })
    # 文字线（幕标题）
    tracks.append({
        "track_type": "text",
        "content": act["title"],
        "position": act_start,
        "time_start": fmt_time(act_start),
        "time_end": fmt_time(act_start + 2),  # 标题卡显示 2 秒
    })
```

## 7. 成片大纲面板

AI 方案生成后，在工作台右侧新增「成片大纲」面板，与时间线双向联动。

### 7.1 面板位置

在右侧分析结果面板上方，通过 Tab 切换：

```
┌─────────────────┐
│ [成片大纲] [分析] │  ← Tab 切换
├─────────────────┤
│ 🎬 开场·日出      │
│   空镜 + 钢琴     │
│   3 个片段 · 2:30 │
│                  │
│ 🌅 铺垫·建立环境  │
│   采访 + 空镜     │
│   5 个片段 · 5:00 │
│                  │
│ ⚡ 转折·暴风雨    │
│   2 个片段 · 3:00 │
│                  │
│ [+ 添加段落]      │
├─────────────────┤
│ (分析结果面板)    │
└─────────────────┘
```

### 7.2 大纲段落交互

| 操作 | 行为 |
|------|------|
| 点击段落 | 时间线滚动到对应位置，播放器跳到该段落起始时间 |
| 拖拽段落排序 | 时间线上对应 shot 同步重排 |
| 展开/折叠 | 显示/隐藏段落内的 shot 列表 |
| 点击 shot | 选中时间线上对应的视频线条目 |
| 拖拽 shot 到其他段落 | 从一个 act 移到另一个 act |
| 右键段落 | 编辑标题/描述、删除段落、AI 重新生成此段落 |
| [+ 添加段落] | 手动添加新的叙事段落 |

### 7.3 双向同步

大纲和时间线是同一份数据（`project_tracks` 表）的两个视图：

- **大纲 → 时间线**：拖拽大纲中的段落顺序 → 自动更新 `position` → 时间线重排
- **时间线 → 大纲**：拖拽时间线上的 shot → 自动更新所属 act 的范围 → 大纲段落更新
- **点击大纲段落** → 播放器跳转到对应时间点
- **点击时间线 shot** → 大纲自动滚动到对应段落并高亮

## 8. 入口与导航

### 8.1 触发方式

在工作台页面，以下位置可以触发「AI 创意引导」：

| 入口 | 位置 | 条件 |
|------|------|------|
| 工具栏按钮 | 工作台顶部工具栏「AI 构思」按钮 | 工程中至少有 1 个已分析的视频素材 |
| 空状态引导 | 时间线为空时，时间线区域显示引导卡片 | 同上 |
| 右键菜单 | 工程侧边栏右键「AI 生成方案」 | 同上 |

### 8.2 前置条件

- 工程中至少有 1 个已分析的视频素材
- 用户已配置视频 AI API Key
- 若无 API Key，弹窗提示前往设置页配置

## 9. 用户工作流

### 完整流程

```
1. 创建工程 → 添加已分析的视频素材
2. 点击「AI 构思」→ 打开创意引导器
3. 6 步分步选择创作意图
4. 确认 → AI 生成方案（实时进度展示）
5. 方案自动组装到时间线
6. 切换到「成片大纲」面板查看叙事结构
7. 在时间线/大纲上精修：
   - 改旁白文字
   - 替换不满意的镜头
   - 调整段落顺序
   - 修改情绪值
   - 添加/删除段落
8. 满意后导出
```

### 与手动编排的关系

AI 生成方案和手动编排**不是互斥的**：

- 可以先用 AI 生成初始方案，再手动调整
- 可以手动编排一段，再用 AI 生成另一段
- 可以先手动创建大纲段落，再让 AI 为每个段落推荐 shot
- AI 生成的方案可以随时「重新生成」（保留/覆盖选项）

## 10. 模板体系

### 10.1 模板定义

每个模板定义为一组预设选项和默认值：

```json
{
  "id": "long_documentary",
  "name": "长视频叙事",
  "icon": "🎬",
  "description": "纪录片/旅行日志风格，完整叙事弧线",
  "default_duration": 1800,
  "steps": {
    "opening": {
      "options": ["suspense", "atmosphere", "character", "quote"],
      "default": "atmosphere"
    },
    "structure": {
      "options": ["timeline", "thematic", "contrast", "three_act"],
      "default": "three_act"
    },
    "emotion_arc": {
      "options": ["gradual_build", "rollercoaster", "deep_narrative", "custom"],
      "default": "gradual_build"
    },
    "ending": {
      "options": ["bookend", "elevation", "open_ended", "call_to_action"],
      "default": "bookend"
    }
  },
  "prompt_addon": "请以纪录片导演的视角，构建一个有深度的叙事结构。"
}
```

### 10.2 内置模板列表

| 模板 ID | 名称 | 子模板维度 | 适用场景 |
|---------|------|-----------|----------|
| `long_documentary` | 长视频叙事 | 开场+结构+弧线+收尾 | 旅行/纪录片 |
| `quick_montage` | 快剪气氛 | 风格 | 短视频/社交媒体 |
| `free_creation` | 自由创作 | 无（全自定义） | 高级用户 |

### 10.3 模板可扩展性

模板定义为 JSON 文件（`backend/templates/` 目录），后续支持：
- 用户自定义模板（保存常用设置）
- 社区分享模板
- 从参考视频逆向生成模板

## 11. 后端 API

### 11.1 新增端点

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/workbench/<pid>/creative-brief` | POST | 组装素材数据 + 创作指令，调用大模型，返回生成方案 |
| `/api/workbench/<pid>/creative-brief/preview` | POST | 仅组装输入 JSON 预览，不调用大模型（用于调试） |
| `/api/workbench/<pid>/creative-brief/apply` | POST | 接收 AI 方案 JSON，组装为 tracks 并写入数据库 |

### 11.2 creative-brief 端点流程

```
POST /api/workbench/<pid>/creative-brief
Body: {
  "template": "long_documentary",
  "duration_target": 1800,
  "opening": {...},
  "structure": "three_act",
  "emotion_arc": "gradual_build",
  "voice": {...},
  "music": {...},
  "ending": {...}
}

1. 读取工程的 media + segments（按拍摄时间排序）
2. 组装 segments JSON
3. 读取 prompt 模板（backend/creative_prompt.txt）
4. 填充创作指令 + 素材数据
5. 调用大模型 API（SSE 流式返回）
6. 返回结构化方案
```

### 11.3 配置

- 创意引导使用的模型独立于分析模型，在设置页新增「创意模型」选项
- 默认使用智谱 GLM-4V-Plus（需要较强理解能力）
- API Key 复用视频分析的 API Key（同一供应商）

## 12. 演进路径

```
Phase 1（MVP）                    Phase 2                        Phase 3
创意引导器基础版             →    智能交互增强               →    高级功能

· 5 步引导表单                    · 单段落 AI 重新生成            · 参考视频解构
· 3 个内置模板                    · AI 替换不满意的镜头            · 自定义模板保存
· AI 生成完整方案                 · 大纲面板拖拽重排               · 社区模板分享
· 自动组装时间线                  · AI 补充/精简段落               · 多方案对比
· 成片大纲面板                    · 素材缺口检测                   · 版本分支
· 手动精修（改文字/调顺序）         · 情绪弧线可视化编辑             · 导出创意简报
                                  · AI 推荐备选镜头
```

## 13. 限制与风险

| 风险 | 影响 | 应对 |
|------|------|------|
| AI 生成质量不稳定 | 方案不合理，用户需要大量调整 | MVP 先跑通流程，用户可在 AI 方案基础上修改 |
| 大模型上下文限制 | 200+ segment 可能超出 token 限制 | 筛选关键维度压缩 token；超限时分批处理 |
| segment_id 引用错误 | AI 可能引用不存在的 segment | 后端校验所有 segment_id，无效的标记为缺口 |
| 生成耗时较长 | 用户体验差 | SSE 流式返回 + 实时进度展示 |
| 模板不够灵活 | 无法覆盖所有创作风格 | 提供自由创作模式；后续支持自定义模板 |
| API 费用 | 长视频素材多，token 消耗大 | 压缩素材描述；预估 token 数并提示费用 |

## 14. 成功指标

| 指标 | 目标 |
|------|------|
| AI 生成方案的可用性 | ≥ 60% 的 shot 直接可用（无需替换） |
| 用户精修时间 | 比从零手动编排减少 ≥ 50% |
| 生成到满意的时间 | ≤ 30 分钟（含 2-3 轮调整） |
