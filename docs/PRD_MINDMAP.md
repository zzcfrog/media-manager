# PRD: 脑图视图（Mind Map View）

## 一、背景与目标

### 问题
当前工作台（Workbench）的时间线视图是横向 filmstrip，适合**剪辑阶段**的精细操作，但在**构思阶段**无法直观查看创意方案的整体结构。用户需要快速了解：
- 视频的主旨线如何划分
- 每个叙事段落讲了什么
- 每个分镜选了哪个素材、配了什么旁白、情绪如何

### 目标
提供一个**脑图视图**，以三级层次结构（主旨线 → 叙事线 → 分镜）直观展示创意方案，支持**编辑、排序、删除**，与时间线视图双向同步。

---

## 二、用户故事

1. 作为创作者，我想用脑图视图查看整个创意方案的结构，快速了解每一幕、每一段叙事、每一个镜头的内容
2. 作为创作者，我想在脑图中拖拽调整幕、叙事段落、镜头的顺序，调整后自动同步到时间线
3. 作为创作者，我想在脑图中直接编辑标题、旁白、情绪值等文本字段
4. 作为创作者，我想删除不需要的镜头、叙事段落或整幕
5. 作为创作者，我想点击某个镜头，视频播放器跳转到对应位置预览
6. 作为创作者，我想在脑图和时间线之间自由切换，数据保持一致

---

## 三、功能规格

### 3.1 视图切换

- 在工作台底部面板的工具栏左侧添加切换按钮：**[时间线] [脑图]**
- 切换时保持数据不变，仅切换展示方式
- 脑图模式下，工具栏显示：切换按钮 | 撤销 | 重做 | 删除
- 时间线模式下，工具栏保持现有功能不变
- 视图模式状态不持久化（刷新后默认回到时间线视图）

### 3.2 脑图层级结构

#### 一级：Act（幕/主旨线）
- **展示**：标题、创作意图（purpose）、情绪范围条（emotion_start → emotion_end 渐变色）
- **视觉**：每个 Act 用不同的彩色左边框区分（循环 5-6 种颜色）
- **操作**：折叠/展开、拖拽排序、编辑标题和 purpose、删除（连带删除所有子叙事和镜头）

#### 二级：Narrative（叙事段落）
- **展示**：叙事文字（text）
- **视觉**：缩进在 Act 下，带细微的分隔线
- **操作**：折叠/展开、拖拽排序（同一 Act 内）、编辑叙事文字、删除（连带删除所有子镜头）、跨 Act 拖拽（移动到其他 Act 下）

#### 三级：Shot（镜头/分镜）
- **展示**：竖向列表，每行包含：
  - 缩略图（来自 `/media/thumbnail/<media_id>`）
  - purpose（创作意图）
  - 情绪值（彩色圆点，蓝 0.0 → 红 1.0）
  - 旁白文字（narration，截断显示，hover 显示全文）
  - 音乐 mood（如 "轻柔钢琴"）
  - 转场类型（如 "fade_in"、"cut"、"dissolve"）
- **操作**：拖拽排序（同一 Narrative 内）、删除、点击定位播放器、跨 Narrative 拖拽（移动到其他 Narrative 下）

#### 情绪线
- 每个 Act 底部显示一条 SVG 情绪曲线（sparkline），连接该 Act 内所有 shot 的情绪值
- 情绪曲线颜色与 Act 左边框颜色一致

#### 旁白线
- 每个 Shot 行内直接显示旁白文字，作为叙事线的可视化

### 3.3 编辑功能

#### 内联编辑
- 可编辑字段：Act 标题、Act purpose、Narrative 叙事文字、Shot purpose、Shot 旁白、Shot 情绪值（滑块）
- 交互方式：双击文本进入编辑模式（显示 `q-input`），失焦或回车保存
- 保存时机：编辑完成后 debounce 500ms 触发保存

#### 拖拽排序
- 同层级内可拖拽调整顺序
- 跨层级拖拽：Shot 可拖到其他 Narrative 下，Narrative 可拖到其他 Act 下
- 拖拽视觉反馈：拖起时原位半透明，目标位置显示蓝色插入线
- 使用 HTML5 Drag & Drop API

#### 删除
- 每个层级每行右侧有删除图标按钮
- 删除 Act：弹出确认"删除整幕及其所有内容？"，确认后删除
- 删除 Narrative：弹出确认"删除此叙事段落及其所有镜头？"，确认后删除
- 删除 Shot：直接删除，无确认（可撤销）

### 3.4 保存与同步

#### 保存流程
1. 脑图中任何修改（编辑、排序、删除）→ 标记为 dirty
2. debounce 1 秒后自动保存（或用户手动点击保存按钮）
3. 保存时：将修改后的 ai_plan JSON 写入 `projects.ai_plan`
4. 然后调用 `/api/creative/<pid>/apply` 重新生成 `project_tracks`
5. 重新加载 tracks 数据

#### 时间线 → 脑图同步
- 从时间线切换到脑图时，始终使用 `projects.ai_plan` 作为数据源
- 如果用户在时间线中做了编辑（如删除了某个 track），脑图不会自动反映（因为 ai_plan 未同步）
- **后续优化**：可在切换时检测 tracks 与 ai_plan 的差异并提示

#### 脑图 → 时间线同步
- 脑图修改保存后，自动 apply 到 tracks，时间线立即反映变更

### 3.5 空状态

- 当项目没有 ai_plan 时，脑图区域显示：
  - 提示文案："还没有生成创意方案"
  - 按钮："去构思" → 打开 Creative Wizard

---

## 四、数据模型

### 数据源：`projects.ai_plan`（JSON 列）

脑图直接操作 ai_plan 对象，结构如下：

```json
{
  "title": "方案标题",
  "summary": "一句话描述",
  "total_duration": 1800,
  "acts": [
    {
      "act_id": "act_1",
      "title": "幕标题",
      "purpose": "创作意图",
      "emotion_start": 0.2,
      "emotion_end": 0.6,
      "narratives": [
        {
          "narrative_id": "nar_1_1",
          "text": "叙事文字段落",
          "shots": [
            {
              "segment_id": 4549,
              "src_start": "00:00:14.00",
              "src_end": "00:00:20.00",
              "purpose": "镜头意图",
              "narration": "旁白文案",
              "use_asr": false,
              "emotion": 0.3,
              "music": {
                "mood": "轻柔",
                "tempo": "slow",
                "instruments": ["钢琴"],
                "note": "备注"
              },
              "transition": "fade_in"
            }
          ]
        }
      ]
    }
  ]
}
```

### 缩略图映射
- 每个 shot 的 `segment_id` → 在 `segments` 数组中查找 `media_id` → 拼接 `/media/thumbnail/<media_id>`

### 无需新增 API
- `GET /api/workbench/<pid>` 已返回 `ai_plan` 字段
- `PUT /api/creative/<pid>/brief` 可保存 ai_plan（需确认或新增保存 ai_plan 的接口）
- `POST /api/creative/<pid>/apply` 已有将 ai_plan 转为 tracks 的逻辑

---

## 五、UI 交互规格

### 布局
- 脑图占据工作台底部面板（与时间线同一区域）
- 垂直滚动（而非时间线的水平滚动）
- 每个 Act 是一个卡片，Narrative 缩进在 Act 卡片内，Shot 列表缩进在 Narrative 内

### Shot 行布局（竖向列表）
```
┌──────────────────────────────────────────────────────────────┐
│ [⋮拖拽] [缩略图 80x45] purpose文字  ●0.3  旁白文字...  🎵轻柔  →fade  [🗑] │
├──────────────────────────────────────────────────────────────┤
│ [⋮拖拽] [缩略图 80x45] purpose文字  ●0.6  旁白文字...  🎵激昂  →cut   [🗑] │
└──────────────────────────────────────────────────────────────┘
```

### 颜色规范
- Act 左边框颜色：循环使用 5-6 种颜色（#4FC3F7 蓝色、#81C784 绿色、#FFB74D 橙色、#E57373 红色、#BA68C8 紫色、#4DD0E1 青色）
- 情绪圆点：线性渐变 蓝(#2196F3) → 黄(#FFC107) → 红(#F44336)
- 拖拽插入线：`var(--accent)` 蓝色
- 删除按钮：hover 时变红

### 响应式
- 底部面板最小高度 300px，可拖拽调整（复用现有逻辑）
- Shot 缩略图固定 80x45px
- 旁白文字截断为单行，hover 显示全文 tooltip

---

## 六、技术方案

### 6.1 新建文件

| 文件 | 说明 |
|------|------|
| `frontend/js/mindmap.js` | MindMap 组件，约 400-500 行 |

### 6.2 修改文件

| 文件 | 修改点 |
|------|--------|
| `frontend/js/workbench.js` | 加 bottomViewMode 状态、mindMapData computed、条件渲染、保存同步方法 |
| `frontend/css/main.css` | 加 `.mm-*` 系列 CSS 类 |
| `frontend/js/i18n.js` | 加约 15 个 i18n key |
| `frontend/index.html` | 加 script 标签、注册 app.component |

### 6.3 组件接口

```
MindMap 组件
├── Props
│   ├── plan: Object (v-model, ai_plan 解析后的对象)
│   └── segments: Array (所有 segment 数据，用于缩略图映射)
├── Emits
│   ├── update:plan (双向绑定，修改后触发)
│   ├── shot-click (点击 shot，传递 shot 对象)
│   └── plan-changed (任何修改后触发，通知 workbench 保存)
├── Data
│   ├── expandedActs: string[] (展开的 act_id 列表)
│   ├── expandedNarratives: string[] (展开的 narrative_id 列表)
│   └── editingField: { type, id, field } | null (当前编辑中的字段)
├── Computed
│   ├── enrichedPlan (为每个 shot 附加 thumbnailUrl、segment 信息)
│   └── actColors (为每个 act 分配颜色)
└── Methods
    ├── toggleAct / toggleNarrative
    ├── startEdit / saveEdit
    ├── onDragStart / onDragOver / onDrop
    ├── deleteAct / deleteNarrative / deleteShot
    └── getEmotionColor(value) → hex color
```

### 6.4 保存同步流程

```
脑图编辑 → debounce 1s → emit('plan-changed')
  → workbench.onPlanChanged()
    → API.saveAiPlan(pid, planJson)   // 保存到 projects.ai_plan
    → API.applyCreativePlan(pid)       // 重新生成 project_tracks
    → reload tracks                    // 刷新 tracks 数据
```

---

## 七、实现步骤（建议顺序）

1. **i18n** — 加脑图相关的中英文 key
2. **mindmap.js 组件** — 先做纯展示版本（只读、无编辑），确认层级结构和缩略图正确渲染
3. **workbench.js 集成** — 加视图切换、mindMapData computed、条件渲染
4. **CSS** — 脑图样式
5. **index.html** — 注册组件
6. **编辑功能** — 内联编辑（双击编辑文本字段）
7. **拖拽排序** — HTML5 Drag & Drop 实现同层级和跨层级排序
8. **删除功能** — 三个层级的删除 + 确认
9. **保存同步** — 脑图修改 → 保存 ai_plan → apply → 重新加载
10. **点击定位** — shot 点击 → 播放器跳转

---

## 八、验证清单

- [ ] 三级层次正确展示（acts → narratives → shots）
- [ ] 缩略图正常加载，无缩略图时显示占位图
- [ ] 折叠/展开正常工作
- [ ] 情绪范围条和情绪曲线正确显示
- [ ] 双击编辑文本字段，保存后持久化
- [ ] 拖拽排序：同层级排序、跨层级移动
- [ ] 删除：act/narrative/shot 三级删除
- [ ] 删除/排序后保存，切换到时间线确认同步
- [ ] 点击 shot，播放器跳转到对应位置
- [ ] 无 ai_plan 时显示空状态提示
- [ ] 时间线视图功能不受影响

---

## 九、后续优化（不在本期范围）

- 从时间线 edits 反向同步到脑图（目前只支持脑图 → 时间线单向同步）
- 在脑图中新增 shot（从素材面板拖入）
- 在脑图中新增 narrative / act
- 脑图导出为图片 / PDF
- 脑图视图的快捷键操作
