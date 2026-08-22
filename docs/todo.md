# TODO

## 已完成：高级筛选面板十二轮打磨——有值仅显居中值、组名回段底、面板与栏区同底连成一体（2026-08-22）

用户三点定调（Office「开始」页签意象）：① 下拉有选项时不显示维度名，值垂直+水平居中；② 组名放回区块下边；③ 面板不用主题色也不用灰底，与 ribbon 栏区同底色、展开时融合连通。落地（[main.css](../frontend/css/main.css) + [gallery.js](../frontend/js/gallery.js) 模板换序）：

1. **有值 = 仅显居中值**：`.adv-dim.active` 下 float 小标签 `display:none`（不再显示维度名），`.q-field__native` 34px 单行 `align-items:center + justify-content:center` 垂直水平居中；`padding-left:2px` 对冲左右图标区宽度差（prepend 22px / append 30px），实测值中心偏移 +2px == 空态标题中心偏移 +2px（两态同一视觉中心）。日期控件顺带统一：placeholder 与已选范围文本均 `text-align:center`。
2. **组名回段底**：`.adv-group-name` 从段顶（八轮上移）移回 `.adv-group-dims` 之后——先看维度、小字组名收尾。实测首段名「镜头语言」top 173 > 维度区 bottom 171。
3. **面板与栏区同底融合（Office 页签式）**：面板底 `--surface2` → `var(--bg)`（页面底色）；`.adv-btn-open` 底色 accent-dim → **透明**（文字仍 accent）——选中态像 Office 选中「开始」页签：按钮与菜单同底连成一块，仅以 accent 文字示选中；`.filter-bar` 本就无背景（透明衬页面底），栏底边随 `adv-open` 透明，面板底边 1px `--border` 即整个 ribbon 区外缘。顺带删除已死的 active float-label accent 色规则（标签已整体隐藏）。
- **实测**：暗面板 rgb(10,10,10) = 页面底、亮 rgb(245,245,245) = 页面底；栏底边展开 rgba(0,0,0,0) / 收起恢复 --border；栏底 y 87.008 == 面板顶 y 87.008 零缝；接缝带 20 行逐行扫描 100% 纯页面底色（像素级无缝）；active 标签 display:none、值文本仅「暖调」、垂直偏移 0；亮色视觉四项全过（同底融合/组名在底/值居中/分隔线可辨），暗色按 DOM 实测 + 像素扫描 + 视觉复核认定（暗色低对比小字视觉模型误读率高，以像素证据为准）。

## 已完成：高级筛选面板十一轮打磨——面板浅灰底（--surface2）+ 按钮下侧无分隔线（2026-08-22）

用户定调：面板**不用主题色**，改用亮/暗两主题平衡的**浅灰**，且「高级筛选」按钮下侧不出现分隔线。落地（[main.css](../frontend/css/main.css) 两处）：

1. **面板底色 `var(--accent-dim)` → `var(--surface2)`**（暗 #1c1c1c / 亮 #eee 中性灰）：整块灰底保留整体感，accent 主题色只留给按钮与选中态；Quasar filled 字段为半透明叠层（暗白 7% / 亮黑 5%），在灰底上仍清晰分层，组段 1px 竖分隔线（`--border`）在灰底可辨。
2. **删除 `.adv-btn-open::after` 16px accent-dim 卡舌延伸条**——延伸条在灰底上会读成一条蓝线；按钮下侧的连接只靠「筛选栏底边随 `adv-open` 透明」实现（实测按钮与面板之间 elementFromPoint 命中裸 filter-bar，零绘制像素 = 无分隔线）。
- **实测**：暗色面板 rgb(28,28,28)（页面 #0a0a0a 上块感清晰）、延伸条 `content:none`、栏底边 rgba(0,0,0,0)、分隔线 rgb(37,37,37) 完好；亮色面板 rgb(238,238,238)（页面 #f5f5f5 上略深一级）、字段半透明 rgba(8,8,8,0.05)；两主题视觉确认（灰底整体感 / 按钮下侧无分隔线平滑相连 / 字段与组间分隔线可辨 / 选中「色调」accent 强调仍可区分）。

## 已完成：高级筛选面板十轮打磨——面板底色与按钮一致（accent-dim 同色一体）（2026-08-22）

用户定调：Ribbon 面板底色应与「高级筛选」按钮（`adv-btn-open`）背景**一致**。落地（[main.css](../frontend/css/main.css) 一处）：

1. **面板 `background: var(--surface)` → `var(--accent-dim)`**——与按钮同色（实测 computed 均 `rgba(108,140,255,0.15)` 完全相等），按钮-卡舌-面板同色连成一体；两处均在页面底上合成同色，无色差。
- **实测**：panelBg === btnBg（rgba(108,140,255,0.15)）、5 段；视觉确认——按钮与面板同色无缝连成一块、未选中下拉（深灰底）在淡蓝面板上对比清晰、选中「色调」（同淡蓝底 + accent 2px 底条 + accent 文字 + ×）仍可辨、整体协调无违和。

## 已完成：高级筛选面板九轮打磨——面板块底色给足整体感（2026-08-22）

用户反馈：八轮的「背景透明融入栏区」方案面板自身没有底色，选中下拉的淡蓝底没有承载，**整体感反而丢失**。修正（[main.css](../frontend/css/main.css) 一处）：

1. **面板加回 `--surface` 整块底色**（透明 → `var(--surface)`）：深色实测面板 `#141414` vs 页面 `#0a0a0a`，块感清晰；面板内字段 `#1c1c1c` 略浅一级形成层级、选中态 accent-dim 淡蓝底在块上协调可辨。无顶边线保持（按钮 `::after` 卡舌延伸条 16px 仍焊在块顶边上，栏底边随 `adv-open` 透明）——按钮与整块区域的连接不变。
- **实测**：面板 bg rgb(20,20,20)、顶边 0px、卡舌 16px@-16px 覆盖 12px 缝、5 段；视觉确认（整块底色块感强/卡舌衔接自然无断缝/选中下拉在块底色上协调可辨）。

## 已完成：高级筛选面板八轮打磨——组名上移 + 展开态按钮与面板连成一块（2026-08-22）

用户两点反馈落地（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **组段名移到段顶**：`.adv-group-name` 从段底移到段顶（模板换序），组名先读、维度下拉随下。
2. **展开态「高级筛选」按钮与整个 ribbon 区域连成一块**：面板 `background: transparent`（原 --surface，与栏区有色差）+ `border-top` 去掉（原 2px accent-dim 分隔线）——栏底边已随 `adv-open` 透明，栏与面板之间零线零色差连成一体；按钮 `.adv-btn-open::after` **卡舌延伸条**（16px accent-dim，穿过栏 padding-bottom 8px + 按钮居中差 + 透明底边，实测缝 ~12px，伸入面板 4px）把按钮底边「焊」到面板顶边上。
3. **顺带**：按钮加 `adv-toggle-btn` 基类 + `flex-shrink: 0`——修复窄视口栏溢出时按钮被挤成 30px 宽文字竖排（实测 88×24 正常内联）。
- **实测**：组名全在段顶（nameOnTop×5 段）、面板顶边 0px/背景透明、按钮→面板无缝（视觉确认「无分隔线或断层，视觉上连贯」）；收起→面板消失 + 栏底边恢复 + 延伸条消失，展开→面板回来（5 段、底边 1px 块下边缘保留）。

## 已完成：高级筛选面板七轮打磨——选中态 × 替换下拉三角（2026-08-22）

用户更正：选中态不应「三角 + 左侧 ×」并存，而是**去掉三角只显示 ×、靠右对齐**（[main.css](../frontend/css/main.css) 一处，模板不动）：

1. **`.adv-dim.active .q-select__dropdown-icon { display: none }`**——`active` 类即「有值」，有值时隐藏下拉三角，append slot 的 14px `cancel` × 独占右侧；空值时三角恢复（下拉语义提示仍在）。`margin-right: -2px` 精确对齐（× 右缘距控件右缘 12px = 空态三角右缘 12px）。
- **实测**：有值维度三角 `display:none`、× 14px 且右缘 12px 与空态三角右缘 12px 完全对齐、无三角仍可点控件开菜单；空值维度三角显示无 ×；视觉确认（选中仅 × 靠右/空态三角/块内两行/无重叠）。

## 已完成：高级筛选面板六轮打磨——组段单行横向滚动 + 清除小 × 左置（2026-08-22）

用户两点反馈落地（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **组段恒单行，不折行**：面板 `flex-wrap: nowrap + overflow-x: auto`——组段放不下时不换行而是横向滚动。滚动三通道：① macOS 触控板原生横扫；② **滚轮竖转横**（`onAdvPanelWheel`，`|deltaY|>|deltaX|` 时 `scrollLeft += deltaY`，无溢出不拦截）；③ **按住拖拽滑动**（`startAdvDrag`，lasso 同款 document 监听闭包，4px 阈值后 `scrollLeft = start - dx`）。拖拽后的 click 由 `@click.capture`（`onAdvPanelClickCapture`）吞掉防误开下拉，`setTimeout(0)` 复位标志（无 click 时也复位）。6px 细滚动条（text3 40% 不透明度，hover 80%）。面板高度 199→115px。
2. **清除小 × 左置**：弃 Quasar `clearable`（它会把下拉三角**替换**成偏大的 ×）——改 append slot 自定义 14px `cancel` 图标（`adv-clear-icon`），有值才显示、位于**下拉三角左侧**（Quasar 的用户 append slot 渲染在三角前），hover 变 accent；点击 `setAdvDropdown(dim, '')` 清空。日期控件 × 同步统一 14px/同款样式。
- **实测**：图片 5 段全 singleRow（scrollW 1594 > clientW 940 溢出）、视频同、音乐 2 段刚好放下无溢出；滚轮 scrollLeft 0→120、拖拽 240→340→440（按住左移右滚）；拖拽后同任务 click 不开菜单、复位后正常开；× 实测 14px 且 `xLeftOfArrow=true`、三角仍在；× 点击清空（值/active/× 全消）；空值维度无 ×；视觉确认单行 + 右侧组段裁切 + 块内两行。

## 已完成：高级筛选面板五轮打磨——组段内维度固定两行（2026-08-22）

用户明确要求：**每一个区块（组段）内是两行**下拉，否则单行排布会把段拉成长条「串行」。落地（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **组内两行网格**：`.adv-group-dims` 从 flex-wrap 改 `display: grid`，列数由模板内联 `gridTemplateColumns: repeat(ceil(n/2), auto)`（新增 `groupColCount(grp)` 方法）——按行填充天然形成恰好上下两行（6 维 = 3×2，3 维 = 2+1，2 维 = 1×2 竖排）；音乐「显示」单维段仍一行。各段等高（实测 90px），Ribbon 块感整齐。
2. **段改固定形状块**：`.adv-group` `flex: 0 1 auto` 收缩行为移除（改 `0 0 auto`，删 `min-width:0`）——段不再靠收缩挤一行，保持两行块形，行宽不够时**整段换行**（外层 panel flex-wrap 即 flow 布局）。
- **实测**：图片 5 段全部 rows=2（镜头语言 394px · 场景光线 279 · 风格色调 279 · 画面内容 149（1×2 竖排）· 相机与文件 465，段高全 90px），外层两行 flow（394+279 / 279+149+465），面板 199px 高；视频 5 段全 rows=2（…技术参数 409px）；音乐 无组段 1 行 + 音乐特征 rows=2，面板 109px。交互回归：景别=全景 → 1 卡 + active + Footer 标签、日期 prepend 图标弹层正常；视觉确认两行/flow/无重叠（段间分隔线程序化验证存在，深色下配色较淡为既有配色）。

## 已完成：高级筛选面板四轮打磨——下拉四字定宽 + 维度小图标（2026-08-22）

组段布局落地后用户实测反馈：下拉太宽、块内不够紧凑。本轮把字段收窄到四字宽并补维度语义小图标（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **下拉定宽四字**：`.adv-filter-panel .adv-dim .q-select { width:120px }`（prepend 图标 22px + 四个中文字 48px + 内距/下拉箭头，实测刚好容纳）；日期范围文本较长单独 176px；超宽值 `.q-field__native` ellipsis 截断。字段收窄后组段显著紧凑——图片 5 段实测全部单行（镜头语言 784px · 场景光线 409px · 风格色调 409px · 画面内容 279px · 相机与文件 725px），面板 219px 高 × 940px 宽。
2. **维度小图标（prepend）**：每个维度下拉左侧加 14px 语义图标——直接复用 spec 既有 `icon` 字段（原用于标签页），零新增配置；色 var(--text3)，`.adv-dim.active` 时变 accent。日期合一控件的日历入口从 append 移到 prepend（`date_range` 维度图标即日历按钮），append 只留条件清除 ×。
3. **空态居中补偿改双向外扩**：label `left:-22px; right:-30px`（左抵消 prepend 图标、右抵消下拉箭头 append），实测居中偏移 0。
4. **菜单宽度保底**：`.adv-select-menu { min-width:168px !important }`——Quasar 会给 portal 菜单设内联 `min-width` = 锚点宽度（收窄后仅 120px），普通 CSS 规则打不赢内联样式，必须 `!important` 对冲；菜单宽度不随字段收窄。
- **验证**：Playwright 实测——字段宽 120px/高 34px、prepend 图标（center_focus_strong/mood/date_range 等）、居中偏移 0、菜单 168px 含计数徽标（全景 1/远景 0…）、active 图标变 accent、图片 5 段全单行、音乐无组段 + 音乐特征段；日期链路（prepend 图标弹层 → 范围 → 自动关 → × 清空）与 localStorage 持久化回归全过；视觉确认（四字宽、小图标、组段分隔清晰、无截断重叠）；后端未动无回归。

## 已完成：高级筛选面板三轮打磨——Office Ribbon 同屏组段布局（2026-08-22）

用户更正：筛选面板 UI 架构应为 **Office Ribbon 式**（上轮「单行流式 + 组色点」方案作废），选定**同屏组段**形态——像 Office「开始」页签内部样式，每个分组占一块，组内维度下拉一到两行排布，选项全留在下拉里，既区分分组又紧凑（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **组段结构**：恢复 `groupedSpec` computed（按连续 `group` 段聚合），面板 = flex-wrap 容器，每分组一段 `.adv-group`（段内 `.adv-group-dims` 流式区 + 段底 `.adv-group-name` 10px 居中小字组名）；**段间 1px 竖分隔线**（首段与无组段无边线），组名底对齐（段等高于行高）。
2. **段内折行不散开**：`.adv-group` 用 `flex: 0 1 auto + max-width:100% + min-width:0`——段过宽时先收缩、组内维度折成两行（整段不拆散换行）；一行放得下多个段时同屏并列。图片类型实测：镜头语言 6 维一段（912px 折两行）· 场景光线/风格色调各 3 维 · 画面内容 2 维 · 相机与文件 5 维，共 5 段。
3. **删色点系统**：`.adv-g-*` 组色类、`group-start`、`::before` 色点、title 悬停提示全部移除（组归属改由段结构 + 组名表达）；两区字段/active 强调/菜单紧凑/日期合一控件/持久化等上轮成果全部保留。
- **验证**：Playwright 实测——图片 5 段（组名/竖线/段内折行断言）、视频 5 段、音乐无组段（toggle）+ 音乐特征段；下拉筛选（全景→1 卡 + active + Footer 标签 + × 清除）、菜单 28px/12px + 计数徽标、日期合一（范围选择→自动关→标签→× 清空）、resetFilters、localStorage 刷新恢复（面板开/组段/active/标签全恢复）、亮暗双主题（组名/分隔线/accent 底条）；后端 [test_adv_filter_v2.py](../scripts/test_adv_filter_v2.py) 13 项全 PASS。

## 已完成：高级筛选面板二轮打磨——单行流式布局 + 日期合一控件 + 菜单紧凑化（2026-08-22）

上轮分组落地后用户实测 4 项反馈，全部落地（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css)，后端零改动）：

1. **分组行改单行流式 + 组色点**（用户选型）：上轮「每组一行 + 组标签」仍显分散支离——改为所有维度汇入一个流式换行区域，维度前 5px 组色圆点标记所属分组（镜头=蓝/场景光线=绿/风格=紫/画面内容=橙/相机文件=青/相机=金/技术=灰/音乐=粉），组间 1px 细分隔线，维度悬停 title 提示组名（组的归属信息不丢失）。面板高度 ~210px→~181px。删 `groupedSpec` computed 与组行 CSS（spec 的 `group` 键与 8 个组 i18n 键保留复用）。
2. **拍摄日期起止合一控件**：两个 from/to 输入 + `~` 分隔 → 单个只读输入（placeholder「拍摄日期」居中，同其他维度空态），点日历图标弹 **QDate range 范围选择**（第一击起点不提交、第二击终点才提交并自动关弹层，`advDatePopup` v-model 控制关闭）；显示 `from ~ to` 文本。
3. **日期可取消（确认真 bug 并修复）**：根因——Quasar `clearable` 的 × 只对 editable（非 readonly）字段渲染，readonly 日期输入永远没有清除图标（上轮两输入版同样如此）。修复：自定义 `cancel` 图标（有值才显示）点击清空两端。
4. **下拉菜单紧凑化**：选项行高 32→28px、字号 12.5→12px、内距收紧，计数徽标 11→10px/6px 圆角，菜单内边距 4→3px。
- **顺带**：Footer 日期标签补「拍摄日期:」前缀（对齐其他维度 `维度: 值` 格式与 UE_DESIGN 既有承诺）；删孤儿 i18n 键 `g.adv_date_from`/`g.adv_date_to`。
- **验证**：Playwright 实测——图片 19 维流式（6/3/3/2/5 组类、4 分隔线、5 色点）、视频 18 维 5 组、音乐 6 维（toggle 无点 + 粉点）；日期链路（选范围→提交→弹层自动关→过滤命中变化→footer 标签→× 清空两端→localStorage 同步→刷新持久恢复）；菜单 28px/12px/3px 断言；亮暗双主题色点可辨；后端 [test_adv_filter_v2.py](../scripts/test_adv_filter_v2.py) 49 断言全绿。

## 已完成：高级筛选 UI 打磨——分组 + 5 项样式修复（2026-08-22）

高级筛选 v2 用户实测 5 项 UI 问题 + 新增筛选条件分组，全部落地（[gallery.js](../frontend/js/gallery.js) + [main.css](../frontend/css/main.css) + [i18n.js](../frontend/js/i18n.js)，后端零改动）：

1. **筛选条件按摄影领域分组**：spec 每 dim 加 `group` 键（同组连续），`groupedSpec` computed 按连续段聚合，面板每组一行（组标签 + 组内 flex-wrap 下拉）。图片 5 组 19 维（镜头语言 6·场景光线 3·风格色调 3·画面内容 2·相机与文件 5，景深/构图上移入镜头语言）；视频 5 组 18 维（镜头语言 5·场景光线 3·画面内容 3·相机 2·技术参数 5）；音乐 1 组（音乐特征 5）+ 无组显示切换（组标签隐形占位对齐）。8 个组标签 i18n 键（zh/en）。
2. **空值占位维度名水平居中**：字段 28→34px 两区布局——空态 label 全宽 `text-align:center` + `line-height:34px`，居中基准为整个控件（`right:-30px` 外扩抵消右侧下拉箭头 append，因 label 定位父级 `.q-field__control-container` 被箭头挤窄 30px）。
3. **选中后维度名与值不再重叠**：float 态 label 压缩至 [2,14] 小标签区（10px/12px，`transform:none` 精确坐标替代 Quasar 的 translateY+scale），值文字落 [14,34] 区（`.q-select .q-field__native` padding-top 14px + 显式 `align-items:flex-start`）；`q-select`/`q-input` native 规则拆分写，日期 input 不受影响。
4. **有选中值的下拉突出显示**：`.adv-dim.active` 强调 = accent-dim 底 + accent 2px 底条（filled `::after` scaleX(1)）+ accent 值文字（500 字重）+ accent 上浮标签。
5. **按钮展开/收起区分 + 与面板融合**：展开态 `adv-btn-open`（accent 色 + accent-dim 底 + 底部方角呈面板「卡舌」）+ 尾部箭头 expand_less/expand_more；filter-bar 根 `adv-open` 类把底边置透明去缝，面板顶边 2px accent-dim 衔接；收起全部恢复（有筛选时按钮回 `adv-btn-active` 态）。
6. **下拉菜单精致化**：`popup-content-class="adv-select-menu"`（菜单 portal 到 body，CSS 全局写）——8px 圆角 + 4px 内边距 + 32px 行高选项；**计数从 label 拼接 "(N)" 改为独立徽标**（`adv-opt-count` 胶囊）+ 选中项对勾图标 + accent-dim 底；0 计数项 `opacity:.45 !important` 灰化不可点（Quasar 自带 .6 带 !important，需对冲）。
- **顺带修复 2 个真 bug**（`dimOptions` 重构）：(a) 音乐「显示」切换两按钮全被禁用——thumbMode 无 facetKey 时 countMap 空，旧 `disable:isZero(undefined)=true`；改 `off(v)=counts ? cnt(v)===0 : false` 守卫。(b) facets 未加载/拉取失败时全部枚举选项误禁——同一守卫修复，加载完计数响应式补上。
- **验证**：Playwright 实测——图片 5 组(6/3/3/2/5)/视频 5 组(5/3/3/2/5)/音乐 1 组+隐形 toggle 组、空态居中(labelCX=controlCX)、float 几何 label[2,14]/值[14,34] 相接不重叠、active 四项 accent 断言、展开/收起按钮三态与 bar 去缝/恢复、菜单徽标/对勾/禁用 0.45、重置清空+持久化、音乐 toggle 可点(bug 修复)+词表 zh、亮暗双主题；后端 [test_adv_filter_v2.py](../scripts/test_adv_filter_v2.py) 49 断言全绿（后端未动）。

## 已完成：修复高级筛选下拉空值占位符不可见（2026-08-19）

下拉未选中时应在框内显示维度名称（如「景别」），但实际不渲染——根因：Quasar 2 的 `q-select` 把 `placeholder` prop 铺到 `.q-field__native` **div** 上（`splitAttrs` 展开），浏览器只对 `<input>`/`<textarea>` 渲染 placeholder，对 div 无效（对比 `q-input` 的 placeholder 落在真实 input 上所以正常）。修复：改 `q-select` 用 `:label="t(dim.label)"`（[gallery.js](../frontend/js/gallery.js) 高级面板模板唯一一处 q-select）——空值未聚焦时 label 居中显示为占位样式（维度标题），选中或聚焦后 label 上浮缩小、选中值正常显示，`q-field--float` 状态干净不重叠。验证：图片 18 下拉 + 2 日期输入（日期仍走 q-input placeholder 正常）、视频 18 下拉、音乐 5 下拉 + 1 切换，全部显示维度名；选中 景别=全景 后框内显示「全景 (1)」、标签上浮。设计不变，文档所述「空值占位符=维度标题」此前是未生效的预期，现真正落地。

## 已完成：高级筛选 v2——按钮展开独占一行 + 全维度下拉 + 视频片段语义（2026-08-19）

v1（切换类型自动展开 + 药丸分段 + 仅元数据维度）整体重构：筛选栏一个「高级筛选」按钮，收起即栏内待展开按钮、展开独占一行全维度下拉面板；**全部筛选项用下拉菜单**，空值占位符 = 维度标题，选项带计数（0 置灰）。维度来自 AI 分析字段，图片 19 / 视频 18 / 音乐 6。

- **维度清单（全）**：
  - 图片 19：景别·焦段·视角·透视·场景·光线·天气·风格·色调·影调·景深·构图·颜色·主体·编码(JPG/RAW/HIF)·相机品牌·相机型号·方向(横/竖/方)·拍摄日期(from~to)
  - 视频 18：景别·焦段·视角·运镜·透视·场景·光线·天气·情绪·颜色·主体·相机品牌·相机型号·方向·分辨率·帧率·时长·色彩空间；**任一片段命中即视频命中**
  - 音乐 5+显示：封面/波形切换(displayOnly)·情绪·曲风·乐器·使用画面·人声（词表 en 值 + zh 显示）
  - 选项 = **标准枚举 + 并入数据新值**（带计数）；动态维度（颜色/主体/相机/色彩空间）走 facets；音乐固定词表
- **后端（[library.py](../backend/blueprints/library.py)）**：`_seg_pred`（EXISTS 片段子查询，图片 1 片段/视频 N 片段天然满足「任一片段命中=视频命中」）、`_arr_pred`（数组维度 instr 匹配 json.dumps 元素，规避 json_each 空串/非法 JSON 整查询报错）、`_music_pred`/`_music_vocals_pred`（music_summary instr 匹配，`json.dumps({"label": value})` 去花括号）、`_orient_pred`（w/h 比较替代 v1 aspect）、`_ENC_EXTS`+`_ENCODING_CASE`（扩展名派生编码）；`list_media` 每类型分支按 spec 拼 where；`library_facets` 扩展（片段 dim facets `_seg_facet`/`_arr_facet` + 编码/方向/色彩空间 GROUP BY + 音乐标签扫 music_summary + res/fps/dur 桶为 dict）
- **前端（[gallery.js](../frontend/js/gallery.js)）**：`ADVANCED_FILTER_SPEC` 重写三类型全维度 spec + `dimOptions(dim)` 统一选项（枚举+计数/disable+并入 facets 新值；音乐 `root.musicTax` 建项 zh 显示）；模板按钮（`v-if="currentSpec.length"`，活跃高亮 `adv-btn-active`）+ 面板删头部改全下拉；`_buildParams` load/loadMore/selectAll 共享发射；切换类型 watcher 去自动展开只 `_loadFacets`；`advPanelOpen` 持久化；i18n 22 个维度标题键；CSS `.adv-filter-panel` 全宽维度行 + 按钮高亮
- **顺带修复 4 个前端 bug**（verification 暴露的潜在缺陷）：
  1. 视频面板崩溃：res/fps/dur 桶 facets 是 **dict** 不是数组，`for...of` 遍历报「object is not iterable」→ `Array.isArray` 守卫
  2. 音乐下拉只剩 2 项：动态数据分支 `if (!dim.options)` 短路了 taxKey 分支 → 改 `if (!dim.options && !dim.taxKey)`
  3. loadMore 重试风暴：过滤请求失败后 `allLoaded` 仍 false → `_checkFill` 无限重试 page=2 拖垮服务 → 两个 catch 都置 `allLoaded=true`
  4. facets 拉取失败后下拉全禁用且无重试 → `load()` 成功后补拉 `_loadFacets`（已加载则 no-op，曾失败自动重试）
- **验证**：后端 [test_adv_filter_v2.py](../scripts/test_adv_filter_v2.py) 49 断言全过（片段等值/数组元素/编码/方向/色彩空间/视频片段语义/音乐 5 维/facets 计数与并入/非法 400/date_to 含整天）；前端 Playwright 全过（按钮收起/展开独占一行、19/18/6 维度与清单一致、placeholder=标题、枚举并入数据新值可见且可筛、0 计数禁用、音乐词表 zh、日期范围、刷新持久化、重置、picker 模式、selectAll 继承维度参数）

## 已完成：框架级高级筛选——按媒体类型自动展开的维度面板（2026-08-19）

封面/波形切换升级为「高级筛选」框架：切换媒体类型自动展开面板，每类型一组维度，后端维度参数 + facets 端点支撑（[library.py](../backend/blueprints/library.py) + [gallery.js](../frontend/js/gallery.js)）。

- **后端**：
  - 桶阈值单点常量：`RES_BUCKETS_IMAGE`（S/M/L/XL，MP 半开区间）、`RES_BUCKETS_VIDEO`（480/720/1080/2160，height px）、`FPS_BUCKETS`（24/30/60/120，float，PAL 25/50 近似入 24/60）、`DUR_BUCKETS`（short/mid/long，秒）；`FPS_AS_FLOAT` SQL 表达式把 `"N/D"` 文本 fps 转 float，helpers `_parse_fps`/`_bucket_key`/`_bucket_pred`。
  - `list_media` 新参数：图片 `res`/`aspect`/`camera_make`/`camera_model`/`date_from`/`date_to`；视频 `res`/`fps`/`dur`。`date_to` 用 `substr(date_taken,1,10) <= ?` 含整天，兼容 EXIF（空格分隔）与 mtime 回退（T 分隔）两种存储格式。复用共享 `where_clauses`/`params` → total/分页/`fields=id`（selectAll）自动继承。
  - 新端点 `GET /api/library/facets?media_type=`：image → `camera_make`/`camera_model` DISTINCT（count DESC，cap 200）+ `date_min`/`date_max` + `res`/`aspect` 桶计数；video → `res`/`fps`/`dur` 桶计数；audio → 占位；非法 media_type → 400。
- **前端**：gallery.js 声明式 spec（`ADVANCED_FILTER_SPEC` per media_type）+ `currentSpec` 驱动面板渲染；`_buildParams` 统一发射。audio = 封面/波形 toggle（displayOnly）+ 未来标签下拉扩展位（mood/genre/instrument，数据源 `music_summary` + `music_taxonomy.json`）；image = 分辨率档/相机品牌/相机型号/拍摄日期范围/宽高比；video = 分辨率档/帧率档/时长档。切换类型自动展开（`advPanelOpen`）；每维度带计数徽标（0 置灰）+ 激活后清除 ×（q-btn-toggle 无法点选取消）；facet 按类型缓存、下拉 >200 截断；`thumbMode` localStorage 持久化。
- **验证**：后端 test_client 全过（桶边界/NULL 维度活跃筛选下被排除/`media_type=all` 忽略 res/date_to 含整天/两格式日期/facets 计数与下拉/非法 400）；前端 Playwright 全过（面板自动展开/各类型 dims/过滤/Footer 标签/清除 ×/重置/折叠保持到下次切换/selectAll 继承 dims/日期弹窗自动关+整日/刷新持久化）。真实库 9104 行不受影响。

## 已完成：修复 import-one 对图片 500——embedding BLOB 序列化（2026-08-19）

`POST /api/library/import-one` 导入**图片**时返回 500：`_import_one` 返回 `dict(row)` 含 `embedding` BLOB（bytes），`jsonify` 无法序列化（音频行 embedding 为 NULL 所以正常）。修复：路由内 `result.pop("embedding", None)` 后再 `jsonify`，与 `import-batch`/`sync-folder` 既有模式一致（[library.py](../backend/blueprints/library.py)）。验证：图片 import-one 200 且 embedding 已剥离；音频 import-one 回归通过（cover_art_path 正常返回）。

## 已完成：音频封面提取 + 封面/波形切换（2026-08-19）

音乐卡片从「只显示波形图」升级为「封面优先，无封面回落波形」。

- **实测价值**：用户 BGM 库（`/Volumes/zack's disk/素材/BGM/`）364 个音频中 **86 个（24%）带真实嵌入封面**（ffmpeg `attached_pic` disposition 判定）。
- **后端**：
  - [db.py](../backend/db.py)：media 表新增 `cover_art_path TEXT` 列（_SCHEMA + _MIGRATIONS 双定义，新库/旧库/重建路径一致）。
  - [services/importer.py](../backend/services/importer.py)：新增 `_extract_cover_art()`（ffmpeg 主路径 `-an -map 0:v:0 -frames:v 1 -vf scale=320:-1`，`returncode==0 AND 存在 AND size>100` 守卫防损坏图；exiftool `-Picture/-CoverArt/-PreviewImage` + PIL 兜底；失败清理半成品）。`_import_one` 音频导入接线；`_delete_media_records` 删除时清理封面文件防孤儿。
  - [blueprints/serve.py](../backend/blueprints/serve.py)：新路由 `GET /media/cover/<id>`，镜像 `serve_thumbnail` 懒生成模式——历史音频首次访问自动回填落库。
- **前端**：[js/gallery.js](../frontend/js/gallery.js) 筛选「音乐」时出现封面/波形切换按钮（复用 `.engine-toggle` 药丸样式），**默认封面**、`localStorage` 持久化；混排视图（全部/图片/视频）音频卡恒**封面优先**且切换隐藏；8 处卡片 `<img>` 接 `thumbSrc`/`onImgLoad`/`onThumbError` 有界回落链（封面→波形→no-thumb，Map 防死循环 + 防 Vue 还原 404 src）；封面不挂 `.portrait`（防 16:9 卡对正方形封面 contain 留黑边）。
- **验证**：后端临时库 7 项全过（迁移/提取/无封面 None/兜底/路由 200·404/懒回填/删除清理）；前端 Playwright 7 场景全过（切换出现+默认封面 / 带封面卡 src=cover 无 portrait / 无封面卡回落波形 / 切换往返 / 刷新持久化 / 混排封面优先+切换隐藏 / 无错误循环）。真实库迁移 43 列 9104 行无损。

## 已完成：修复 ASR 一句话被拆进两个分镜——两级句子缝合（2026-08-16）

**问题**：一句话没说完经常被拆成两个分片。根因不在 `_merge_asr`（它本就整句分配、不切文本），在上游：①whisper 在句中停顿处（换气/VAD）把一句话切成多段，两半各自按「重叠最大」落到不同分镜；②多模态模式下 GLM 按镜头转写，句子跨镜头时各写各的。

**修复（[blueprints/analysis.py](../backend/blueprints/analysis.py)，两级缝合，双模式受益）**：
- **分镜分配前** `_stitch_asr_sentences()`：whisper 相邻段「前段无终止标点（。！？!?…）+ 间隔 <1.2s」→ 拼回整句（CJK 无缝/拉丁加空格）再进 `_merge_asr`。真停顿（句间隔大）不拼。
- **存库前** `_stitch_cross_segments(segments)`（双模式通用）：相邻分镜 A 的 asr 未说完 → B 的 asr 拼回 A，B 清空删键。best-effort：B 若含自己的完整句会被一并带走（多模态模式无句级时间戳，无法再细分；whisper 路径已被前一级保护）。

验证：真实代码跑 6 个合成用例全过——句中拼回整句 / 真停顿不拼 / 整句归一个分镜 / 跨分镜拼回 / 完整句不误拼 / 英文空格。

## 进行中：本地视觉分析引擎（云端/本地双引擎）——Step1/2 完成，下一步视频抽帧（2026-08-16）

产品双路线定案：分析引擎可配**云端（智谱，质量档）**或**本地（Qwen3-VL via llama-server，免费·隐私·离线·够用）**。

- **新建 [PRD_LOCAL_VLM.md](PRD_LOCAL_VLM.md)**：九节完整 PRD——双引擎设置、本地模型管理（应用内下载/断点续传/hf-mirror 镜像默认/目录可选）、llama-server 生命周期（按需启动/端口顺延/空闲退出）、视频抽帧适配（本地栈不收 video_url → ffmpeg 抽帧多图 + 时间戳）、数据模型（settings 新增 `video_engine`/`image_engine`/`local_model` 等 7 个 key）、实现步骤与验证清单。
- **模型下载中**（~24GB，走 7897 代理——HF 直连实测不通）：Qwen3-VL-8B Q4_K_M (4.68GB) + 30B-A3B Q4_K_M (17.28GB) + 各自 mmproj-F16（视觉投影器，必带）。
- **llama-server 已就位**：[electron/resources/bin/darwin-arm64/llama-b10451/](electron/resources/bin/)（26MB，验证 `--version` 可跑；MIT 协议可随产品分发；目录已加 .gitignore）。
- 关键技术事实（选型依据）：①本地栈（llama.cpp/Ollama）不接受 base64 视频，视频必须抽帧多图；②mmproj 与主模型必须成对加载，选 F16 不量化（小文件、视觉敏感、非速度瓶颈）；③本地模式音频强制 faster-whisper；④`llama-cpp-python` 进程内方案对 Qwen3-VL 视觉支持滞后（issue #2080），不可用；⑤analyzer.py 的 `base_url` 参数化使本地模式近零改动。
- **下载完成 + 核对**：四文件体积与 HF API 精确一致（4.68/1.08/17.28/1.01 GB）。注意 huggingface_hub 0.22 的 `--local-dir` 落的是指向 `~/.cache/huggingface` 的**软链接**——产品实现下载管理时需 `local_dir_use_symlinks=False`（否则删目录不释放缓存空间）。
- **冒烟测试通过**（llama-server b10451，OpenAI 兼容接口，真实素材缩略图）：

| | 8B Q4_K_M | 30B-A3B Q4_K_M |
|---|---|---|
| 模型加载（热缓存） | 3.8s | ~3s（冷启动 17GB 磁盘读会更久） |
| 单图中文打标签 | 2.6s · 49 tok/s | 2.0s · **68 tok/s** |
| 多图（3帧，视频抽帧机制） | ✅ 0.7s | ✅ 0.8s，描述更具体 |

  - 意外发现：**30B 生成比 8B 快**（MoE 仅 3B 激活 vs 8B dense 全激活），代价是 17GB 常驻内存——「速度档 8B / 质量档 30B」的定位要改为「内存档 8B / 质量且更快档 30B」。
  - 质量对比（同一图）：30B 描述明显更细腻（服装/背包/帽子细节、主体更全），多帧场景切换描述具体（「峡谷徒步→草原经幡塔」vs 8B 只答「场景切换」）。
  - 30B 输出用 ```json 围栏包裹——现有 `_parse_response`（[analyzer.py](../backend/analyzer.py)）已处理，无碍。
  - llama-server 启动告警 `--image-min-tokens 1024`（grounding 任务精度相关）——打标签场景暂不处理，若实测精度差再加。
- **✅ Step1 完成：引擎管理**（[backend/local_vlm.py](../backend/local_vlm.py) + [blueprints/local_vlm.py](../backend/blueprints/local_vlm.py)）：模块级单例 spawn llama-server（主模型+mmproj、绝对路径、独立进程组 killpg 回收、atexit 清理、端口 8080 顺延至 8099、健康检查绕代理），路由 `/api/local-vlm/{status,models,start,stop}`。test_client 六项验证全过：初始态 / 占 8080 顺延 8081 / 真启动 4.1s / 幂等 / 停止 / 无残留进程。
- **✅ Step2 完成：图片本地链路全通**（PRD §7.2）：
  - 后端 [blueprints/analysis.py](../backend/blueprints/analysis.py)：`_start_image_analysis` 读 `image_engine`/`local_model`（本地时免 API Key）；`_process_image` 本地分支 `local_vlm.ensure()`（SSE 新增 `engine_starting` 档）后以 `base_url=127.0.0.1:<port>/v1` 调 `analyze_image`；记录的 analysis_model = 本地模型 id。
  - 前端：设置页图片 tab 顶部「分析引擎」单选（云端智谱/本地 Qwen3-VL），本地时 API Key/云端模型折叠、显示本地模型下拉（仅列已下载，来自 `/api/local-vlm/models`）；api.js `getLocalVlmModels()`；i18n 中英 9 键；detail.js 与画廊批量进度条均处理 `engine_starting`。
  - **E2E 实测**（真实照片 _DSC9547.JPG，8256×5504 → 800px）：本地 8B 全链 **11.3s**（压缩 0.7s + 引擎启动 1.5s + 分析 8.6s），22/28 字段非空（visual/色彩/主体/景别/情绪带权重/arousal-valence 全有），与云端产物同构，落库可查。
- **⚠ 重大坑（已修）：httpx 读 macOS 系统代理劫持本地回环**——环境变量为空也会从 **scutil 系统代理**（用户常开 Clash「系统代理」）拿到 7897，把 `127.0.0.1:8080` 的请求发给代理 → 本地分析挂死 5 分钟+；且系统代理的本地例外列表 httpx 不识别。修复：[analyzer.py](../backend/analyzer.py) 新增 `_openai_client()`，本地 base_url 用 `httpx.Client(trust_env=False, timeout=600)`（自定义 http_client 时须显式给 timeout，httpx 默认仅 5s 会掐死长生成）。死代理环境变量复验通过（11.0s 完成）。与「GUI PATH 问题」同类产品教训：**一切本地回环调用必须显式绕代理**（local_vlm.py 健康检查的 `ProxyHandler({})` 先前已做，本次补齐 SDK 调用侧；faster-whisper 走 HF 下载不受影响）。
- **✅ Step3 完成：视频本地链路全通**（PRD §7.3）：
  - 后端 [analyzer.py](../backend/analyzer.py) 新增 `extract_video_frames()`（ffmpeg 按窗抽帧，窗时长 = 帧数上限÷fps，内存恒定不随视频时长增长）+ `analyze_video_frames()`（每帧标注**绝对时间戳**、分窗请求、跨窗拼接；保留「模型输出窗内相对时间 → 平移回绝对」兜底）。[blueprints/analysis.py](../backend/blueprints/analysis.py) 两个入口（单条 SSE + 批量）均支持 `video_engine=local`，本地**强制 use_multimodal=False**（帧无音频，ASR 走 whisper 分支照常合并）；SSE/`/progress` 新增 `window`（如 `2/10`）进度。
  - 前端：视频 tab 引擎单选 + 本地模式（模型/抽帧帧率 0.5–10 预设/单窗帧数上限 16–128）；本地模式下音频 tab 保持可见（whisper 型号可配）；detail/画廊进度显示窗口进度。
  - **E2E 实测**（DSC_9506.MOV 31s，fps=2 → 2 窗 × 29-32 帧）：压缩 7.3s + 引擎 1.5s + 抽帧 0.2s + VLM 48.5s（约 24s/窗）+ whisper 冷加载 78s + 转写 → 共 170.6s；**4 分镜时间戳跨窗连续且绝对**（0-15/16-21/21-25/25-30），whisper 语音正确合入对应分镜（「景山上拍的故宫全景」→ 全景分镜），usage 跨窗累计。
  - **实测 token 校准**：240p 源每帧约 190 token、480p 约 400 → `local_frames_max` 默认 **32**（PRD 已更新；480p 下 64 帧 ≈ 2.6 万 token 逼近 32K 上下文不安全）。
- **✅ 启动模型加载进度并入顶部进度条**：[asr/\_\_init\_.py](../backend/asr/__init__.py) 新增 `preload_state`（loading/done/error）+ 引擎 `is_ready()` 校验（whisper 实现见 [engines/whisper.py](../backend/asr/engines/whisper.py)）；`/api/analysis/progress` 加载中时附带 `__preload__` 系统任务（file_name = "whisper large-v3"）；前端顶部进度条把它渲染成任务条目（graphic_eq 图标替代缩略图、耗时爬升百分比、完成后自动消除、刷新页面可恢复）。设置里切换 ASR 模型触发的重载暂不入条（仅启动时），如需再加。
- **✅ 启动 ASR 预加载改按需**（此前无论云端/本地一律启动加载 whisper ~3GB）：[\_\_init\_.py](../backend/__init__.py) 仅当 `video_engine=local`（帧无音频强制 whisper）或 `use_multimodal=false`（独立 ASR 模式）才启动预加载；云端+多模态跳过（语音由 GLM 顺手转写，whisper 用不上），首次需要时懒加载。视觉本地模型（llama-server）本就不在启动加载（按需 `ensure()`，PRD 设计）。已验证三分支：cloud+mm=跳过 / local=加载 / cloud+独立 ASR=加载（用户当前配置）。
- **✅ 本地视频去掉压缩中间步骤**（用户提出：抽帧时可同步降分辨率，压缩是为云端上传设计的）：
  - 后端 [analysis.py](../backend/blueprints/analysis.py) `_process_video` 本地分支跳过 `compress_video`（无 temp 产物），帧与 whisper 都直接吃**原片**（ASR 音质更好）；[analyzer.py](../backend/analyzer.py) `extract_video_frames` 新增 `frame_res`——ffprobe 探宽高后 `fps=N,scale=W:H` 一步降采样+降分辨率（短边对齐 p 值，16:9 横片 852×480 与压缩语义一致）；macOS 附 `-hwaccel videotoolbox`（4K60 10bit HEVC 软解极重且与 llama-server 抢核，实测 16s 窗墙钟 7.3→4.4s、CPU 55s→1.8s ≈ 30×）。新设置 `local_frames_res`（240/480/720，默认 480，720 ≈ 900 token/帧 线性推算）。
  - 前端：视频 tab 选本地时压缩区块（压缩分辨率/帧率/预估码率/硬件加速）整体隐藏，本地区块新增「帧分辨率」三档（带 token 提示）；进度事件（`/progress` + SSE queued）新增 `engine` 字段，detail 页本地视频阶段列表去掉「压缩/编码」两步（= AI 分析 + 语音转写）；i18n 中英 6 键。
  - **E2E 实测**（DSC_9506.MOV 4K60 10bit HEVC，fps=2/res=480）：无压缩步骤 ✓，抽帧 9.1s（软解 17.9s），VLM 102.6s，3 分镜时间戳连续（0-15/16-22/22-30），whisper 原片音轨正确合入第 1/3 分镜。注：whisper 对个别词的转写与压缩音源略有差异（景山→九山、镜头→枕头，样本 1 次待观察）。
  - 顺手确认：退出时 faster_whisper 的 tqdm 监视线程 atexit 报 "cannot join thread" 为第三方无害告警，非本仓代码。
- **✅ 设置页 tab 更名 + 构思独立成页**（用户提议）：tab「图片/视频/音频」→「图片分析/视频分析/语音分析」；「构思生成模型」从视频分析页抽出，新 tab「剪辑构思」（含提示：创作构思始终用云端模型，API Key 在视频分析页配置）。纯前端改动（[index.html](../frontend/index.html) + i18n 中英各 3 改 2 增），无逻辑变化。
- **✅ 设置弹窗三处 UI 修复**（用户反馈，已在运行实例验证）：① tab 面板改**固定高度 440px + 滚动**（原来 min-height 随内容变化，切 tab 弹窗尺寸跳变——实测五个 tab 均稳定 605px）；② 云端模式字段顺序统一为 **AI 模型 → API Key**（视频页多模态/压缩参数沉底，图片页压缩尺寸沉底，API Key 在本地模式尾部保留供剪辑构思用）；③ 剪辑构思页补 **API Key 输入框**（与视频分析共用同一 Key，v-model 相同）+ 提示文案更新。
- **✅ 设置弹窗第二轮修复**（用户反馈，已在运行实例验证）：
  - **弹窗宽度钉死 440px**（原 min-width 会随内容撑宽——视频页本地模式的下拉选中项文案长，切引擎时弹窗突然变宽；实测本地/云端切换宽度恒 440）。
  - **视频本地模式移除 API Key**（上一轮为剪辑构思保留在尾部，用户明确不要；Key 只在云端块和剪辑构思 tab 出现）。
  - **语音分析 tab 引擎 radio 化**：本地（默认，Whisper 型号下拉）/ 云端（占位提示「即将支持」，无字段）。新设置键 `asr_engine_mode`（local/cloud）；原 `asr_engine` 恒为 whisper 不动（云端 ASR 引擎后端本就不存在——UI 里那个 zhipu-asr 选项是死选项，本次连 asrEngine 下拉/ASR Key 输入一起移除，未来云端引擎实现时接线）。清理孤儿：computedAsrOptions、showAsrKey、i18n 5 键。
- **✅ 设置弹窗第三轮修复**（用户反馈，已在运行实例验证）：
  - **弹窗加宽 440→480px**。
  - **tab 左右移动根治**：语音分析 tab 原为条件渲染（云端多模态时隐藏），切引擎/多模态开关时 tab 增删 + justify 重排导致整排横移；改为 5 个 tab 常驻渲染，实测本地↔云端↔关多模态三种状态下 5 个 tab 的 x 坐标完全不变。
  - **代价处理**：云端+多模态时语音设置不生效（Whisper 不参与），语音 tab 顶部补提示「当前为云端多模态模式，音频由视频模型直接分析，此处设置不会生效」（实测开启多模态后提示出现）。
- **✅ 修复：重新分析走本地引擎但 UI 显示云端流程**（用户反馈：本地设置下点「重新分析」，右侧仍是压缩/编码/上传流程 + token 消耗，以为没触发本地模型）：
  - **核实**：后端实际走了本地——DB 里该次分析 `analysis_model=qwen3-vl-8b`、状态 done（后端 `_start_video_analysis` 一直按 `video_engine` 设置分流，本地跳过压缩）。问题纯在 detail 页 UI 两处只看多模态开关、从不读引擎设置（批量入口改过，detail 漏了）。
  - **确认弹窗**（detail.js `openAnalysisConfirm`）：本地引擎显示本地模型名 + 抽帧参数行（`{fps}fps · {res}p · ≤{max} 帧/窗`）+ 音频恒「独立 ASR (Whisper)」+ 提示改「本地引擎离线运行，不消耗云端 API 费用」；云端保持原样。已 Playwright 实测。
  - **阶段列表**（detail.js `doAnalysis`）：按引擎构建，本地视频 = 分析 + 转写 两步（与 `created()` 恢复逻辑一致）；bgTask 预置 `engine` 字段。
  - **完成弹窗 token**：为 llama-server 返回的真实本地消耗（非云端计费），流程标识正确后保留展示。
  - **附带**：gallery 批量确认弹窗模型名按引擎显示（本地 → local_model）；后端本地模式 SSE `substep` 初始值 `uploading→receiving`（不再闪「上传中」）。
- **✅ 本地分析进度明细化（SSE 事件链重构，用户反馈：进度不准、不够细、缺引擎加载进度）**：
  - **真相**：whisper 的 `transcribe(on_progress)` 从未接线——转写的 10~30s 里 UI 一直显示「分析中」；抽帧/合并无任何事件；engine_starting 只发一条无耗时。
  - **后端**：`extract_video_frames(on_extract)` 逐窗回调（percent=i/N）；`analyze_video_frames` 新增 `on_extract_done(窗数,总帧数)`；`_process_video` 记录 `engine_t0/engine_time`、ASR 步骤（asr_start/asr_progress + loading/transcribing 子步骤）、合并步骤（merging）；SSE 生成器新增 engine_starting 带已耗时秒数、engine_ready(elapsed)、extracting(percent/window)、extract_done(windows/frames)、asr_*/merging 事件；一次性事件由 worker 标志驱动（不依赖 step 转迁检测，快速阶段不漏）。`/progress` 端点补 extracting/asr 字段。
  - **前端**：detail 页本地时间线 2 步 → **5 步（本地引擎启动→抽帧→视觉分析→语音转写→合并保存）**，各档独立进度条/子步骤/耗时；done 收尾兜底标记漏事件的快速阶段；全局任务栏（index.html 轮询）与 workbench SSE 标签同步新步骤。
  - **验证**：假引擎协议级 E2E（monkeypatch ensure/analyze_frames/ASR），事件序 = queued→engine_starting(带耗时)→engine_ready(0.8s)→extracting(0→50% 1/2)→extract_done→analyzing(1/2,2/2+receiving)→asr_progress(loading→transcribing)→merging→done ✓；i18n 键/handler/stepMap 与后端步骤交叉核查 ✓（补漏 d.local_engine_stage）。云端独立 ASR 同步获得转写阶段显示。
- **✅ 新增两个本地模型 + Omni 音视频同析模式**（用户需求：加 Qwen3.6-35B-A3B 与 Qwen3-Omni-30B-A3B；Omni 支持 ASR，可选音视频一起或独立 whisper）：
  - **模型注册**（local_vlm.py MODELS，文件名/体积为 hf-mirror API 实测）：`qwen3.6-35b-a3b`（unsloth/Qwen3.6-35B-A3B-GGUF，UD-Q4_K_M 22.13GB + mmproj-F16 0.90GB，纯视觉）、`qwen3-omni-30b-a3b`（ggml-org/Qwen3-Omni-30B-A3B-Instruct-GGUF，Q4_K_M 18.56GB + mmproj-Q8_0 1.33GB，**audio+vision**，`audio:true` 标记随 /api/local-vlm/models 输出）。运行时前提已核：llama.cpp libmtmd 官方支持 Qwen3-Omni audio 输入（`input_audio`，语音输出 talker 未集成但我们只需输入）；本项目 llama-server 为 2026-08-16 master 构建（b10451），支持齐全。
  - **同析管线**：`extract_video_frames(with_audio=True)` 每窗抽 16k 单声道 PCM（`-f s16le pipe:1`；**不能用 `-f wav pipe:1`——管道不可 seek，头部时长是占位值**，实测解析出 13 万秒；改由 wave 模块自建头）→ `analyze_video_frames` 帧前插 `input_audio`（base64 wav）→ `_process_video` 检测 `local_asr_mode=merged` 时跳过 whisper。真实 9126 抽取实测：8/8 窗对齐、4.0s/窗、166KB b64/窗。
  - **设置**：新键 `local_asr_mode`（separate 默认/merged）；视频本地模板选 Omni 时显示「语音分析：音视频一起 / 独立 Whisper」radio + hint；语音分析 tab 在本地同析下显示「不生效」提示；模型下拉改列全部 4 个模型、未下载禁选标注「未下载」（下载管理 Step4 前需手动放置 `backend/models/vlm/<id>/`）。
  - **进度/确认**：queued SSE 与 /progress 带 `asr_mode`；同析时间线 4 步（引擎→抽帧→**视听分析**→合并，无转写档），独立模式 5 步不变；确认弹窗音频行显示「音视频一起（Omni）」。
  - **验证**：fake 协议 E2E——merged：queued(merged)→done、with_audio=True、whisper 未跑、无 asr 事件 ✓；separate 回归：queued(separate)、with_audio=False、whisper 跑 ✓；settings 测试前后保存/恢复。
- **✅ 应用内模型下载管理（Step4，用户需求：为什么新模型未下载 → 支持应用内下载）**：
  - **后端**（local_vlm.py + blueprints/local_vlm.py）：`POST /api/local-vlm/download`（单任务，未知/已下载 400）后台线程 `hf_hub_download` 两个文件（main+mmproj）→ 完成后软链 `backend/models/vlm/<id>/`；`GET /download` 轮询状态（done_bytes = 已完成文件字节 + `blobs/*.incomplete` 实时字节；速度按相邻轮询差值；精确总量从 hf-mirror API 拉取失败回退估算）；`POST /delete` 删模型目录 + HF 缓存仓库目录（引擎运行该模型/下载中拒删）。`HF_ENDPOINT=hf-mirror.com` 在 config.py 顶部 setdefault（须在 huggingface_hub 首次导入前）。下载前磁盘空间检查（<1.05× 拒下）。断点续传由 hf_hub_download 原生支持。
  - **前端**：设置「视频分析→本地」底部模型管理列表（4 行：已装=删除按钮，未装=下载按钮+内存需求标注，下载中=进度条+%+速度）；1.5s 轮询（弹窗关闭/刷新不中断后台下载，完成时刷新清单+通知）；图片 tab 指引文案。下载/删除均二次确认。
  - **验证**：fake hf_hub_download 全流程（downloading→done、双软链有效、delete 清两处目录、运行中/下载中拒删、unknown/installed 400）✓；live UI 实测管理列表渲染 4 行 2 删 2 下（发现用户 Flask 带自动重载，后端新码已生效）。
  - **说明**：进度用轮询 GET 而非 PRD 原计划的 SSE——20GB 级下载 30min+，弹窗必然关闭、页面可能刷新，轮询天然可恢复；PRD 已更新。
- **✅ 模型下载/删除按钮移入下拉菜单**（用户反馈：不要放在下方独立管理列表）：q-select 自定义 `v-slot:option`——每选项右侧按钮（已装=删除、未装=下载），未装选项副标题「需内存 N GB+ · 未下载」；点击按钮 `@click.stop` 防选中 + `hide()` 收起菜单后弹二次确认；下载中选项行内进度条+%+速度（其它未装按钮置灰），下拉收起时选框下方保留一条汇总进度条（仅下载中可见）；视频/图片两 tab 下拉行为一致；删除原独立管理列表与「见视频分析页」指引，清理孤儿 i18n（s.model_manage/model_manage_in_video/not_installed）。已 Playwright 实测：4 选项渲染（2 删 2 下）、点下载→菜单收起→确认框（22.13GB 提示）→取消后状态 idle。
- **✅ 语音分析引擎 radio 顺序对齐**（用户反馈）：原实现「本地在前、云端在后」与图片/视频 tab 的「云端在前」不一致（UE_DESIGN 文档本来就写的「云端 / 本地」，代码没跟上）；已对调为云端在前。默认值仍为本地（云端引擎尚未实现，默认云端会落到死占位提示）。
- **✅ 设置页视觉重构**（用户反馈：tab 内容文字多显乱、审美差）：
  - **引擎选择改通栏分段控件**（q-btn-toggle 两段 50/50，选中段主色底 + 圆角描边容器），图片/视频/语音三 tab 同构，语音用「云端 | 本地（Whisper）」短标签（原来误用视觉引擎名）。
  - **小节标题**（12px 加粗 + 左 3px 强调色竖条，与快捷键弹窗同款 idiom）：视频本地的「抽帧参数」、Omni 的「语音分析」（该组同时从 radio 改为分段控件）。
  - **提示统一收进灰底圆角提示框**（surface2 + 11px text3 + 图标 info/hourglass/downloading/error_outline，与分析确认弹窗同款 idiom）：API Key 说明、预估码率、本地引擎说明、Omni 模式说明、云端占位、下载进度/错误——每模式至多一条置于块底，替代原先散落的多行 11px 小字。
  - 间距 12→14px；清理孤儿键（s.engine）；输入框内嵌 hint 移除并入提示框。Playwright 截图视觉核验（本地/云端两态）：分段选中态、色条小节、提示框、无错位重叠 ✓。
  - **提示框去灰底**（用户反馈：灰底与 filled 下拉/输入控件同色，误像可点击）：改为无底色旁注——左侧 2px 灰细竖线 + 11px muted 字 + 图标（实测 computed style：提示 transparent vs 输入控件 rgba(255,255,255,0.07)，视觉核验确认不再混淆）。
- **✅ 修复：模型下载进度永远 0%**（用户反馈）：
  - **根因**：hf_hub_download（0.22.2）的数据流**无读超时**——hf-mirror CDN/代理链路会静默掐断长连接，`read()` 永久阻塞（faulthandler 栈坐实：卡在 `http_get` SSL read）；进度分子又取自 `blobs/*.incomplete`，连接死了文件不再增长 → 永远 0% 且不报错。实测同一 URL 直连 14MB/s、走代理 23MB/s——是**间歇性**掐连接，不是全断。
  - **修复**：弃用 hf_hub_download，自研 `_download_file`：`requests` 流式 + `timeout=(10,60)`（连接/读）+ **失败自动重试 ≤10 次（指数退避）** + **Range 断点续传**（`<file>.part` 直落模型目录，206 续传/200 重写/416 视为完成）+ 完成校验文件大小后 rename；进度改为直接量 `.part` 文件（不再扫 HF cache）。新下载不再经 HF cache/软链，直接写 `backend/models/vlm/<id>/`（删除逻辑向后兼容老的 cache+软链结构）。
  - **验证**：假 session 四场景（全新/600B 断点续传/连掉重试×2/大小不符清 part 报错）✓；真网络拉 ggml-org README 330B ✓。**需重启后端生效**（run.py 无 auto-reload；旧进程里卡死的下载线程只有重启能清）。
- **✅ 下载提速：8 连接分片下载**（用户反馈：速度只有几百 KB）：
  - **测速定位**：源就是 `hf-mirror.com`（HF 官方直连与走用户代理均 ConnectTimeout，镜像唯一可用）；主 GGUF 单连接实测直连 0.87MB/s / 走代理 3.45MB/s（mmproj 昨日可达 14~23MB/s）——镜像 CDN 按文件/时段限速，单连接无解。
  - **实现**：`_download_segmented`——≥128MB 且已知大小的文件分 8 段并发（各线程独立 Session + 闭合区间 Range + pwrite 预分配的 `.part`），64MB 块级断点（`<part>.json` sidecar 记每段连续前缀，块内中断重下该块）；兼容旧单线程 `.part`（无 sidecar 时把顺序前缀映射为各段进度，已下字节不浪费）；块字节数不符即重试（防服务器忽略 Range 写脏数据）；小文件仍走单连接。进度显示不变（仍量 `.part`）。
  - **验证**：fake 源三场景（分片布局内容一致 / 段级断点 / 旧前缀迁移）✓；真网络——主 GGUF 闭合区间返回精确 206+Content-Range（1000000-1000099 恰 100B）、闭合与开区间同位置 4096B 字节级一致 ✓；非 LFS 文件（README）忽略闭合区间返回全量——分片仅用于 ≥128MB 的 LFS 文件，天然规避。
- **✅ 音乐分析全链路（第三媒体类型 media_type='audio'，P1 已实施完成，2026-08-18）**：PRD 定稿见 [PRD_MUSIC.md](PRD_MUSIC.md)；设置页新增「音乐分析」tab（引擎药丸本地默认/云端占位、Omni 系模型下拉含下载删除、分段时长 15/30/60s）。
  - **数据层**：media 表重建迁移（CHECK 加 'audio' + music_title/artist/album/summary 四列；sqlite_master 检测幂等 + FK OFF 包裹 + 显式列名 INSERT…SELECT + 索引重建 + 迁移前整库备份）；新表 music_segment（mood/genre/instrument/theme_json + arousal/valence REAL + vocals/vocals_language/watermark/watermark_text/seq）；_DEFAULTS 加 music_engine/music_model/music_segment_sec；AUDIO_EXTS + ENCRYPTED_AUDIO_EXTS（ncm 跳过提示）+ AUDIO_LIKE_VIDEO_EXTS。
  - **导入**：_probe_audio（ffprobe ID3 title/artist/album + exiftool 兜底）；.mp4/.m4v 按 ffprobe 流判定（_probe 塞 _has_video/_has_audio 布尔，零新增子进程）；波形缩略图 showwavespic（-ac 1 -ar 8000 降采样、超长曲 -t 1800 截断）；删除链路补 music_segment；list_media 解析 music_summary。
  - **serve**：/media/audio/<id>——原生集(mp3/m4a/wav/flac/ogg/oga/aac/**.mp4纯音轨**) send_file(conditional=True) 支持 Range 拖动；仅 wma/aiff 走 AAC ADTS 流式转码（_stream_ffmpeg 与视频转码共用）；MIME_MAP 补 9 个音频。
  - **引擎层**：music_prompt.txt（10 字段 + {music_taxonomy} 词表注入 + 权重/枚举/水印严格约束）；analyzer 新增 load_music_prompt/_render_music_taxonomy/music_taxonomy_labels/extract_audio_segment（复用视频同析 PCM→wave→base64 通路）/analyze_music（逐段惰性抽取+流式）/sanitize（词表白名单+权重归一100+数值clamp+时间后端强制）；**local_vlm 新增 acquire_engine/release_engine 占用协议**（Condition+计数，防视频 8B/音乐 Omni 互相杀 llama-server，视频/图片/音乐三链路已全部接入 try/finally）。
  - **分析入口**：单条/批量 audio 分支；_process_music（acquire→ffprobe→N=ceil(dur/seg)→逐段 analyzing(window i/N)→merging→done）；_refine_watermark 两步复核（任一段 Present→曲级标；水印段 vocals=念白→多数表决复核）；_aggregate_music（权重=段时长：标签加权 top5 归一、双轴加权均值、vocals 多数）；save_music_segments（DELETE+INSERT+media.music_summary+_refresh_fts(extra_tags)）；get_analysis audio 分支；/music-taxonomy 路由（前端 en→zh 映射单一事实源）。
  - **前端**：gallery 筛选第四档 music_note + 8 处卡片 typeIcon 三态 + mood chip（music_summary.mood[0] zh 映射 + 权重%）+ 水印角标（branding_watermark 琥珀色）+ 批量弹窗三计数三模型行；detail 第三分支（曲目/音频/文件元信息栏 + 隐藏 audio 元素 + arousal/valence 双线曲线 canvas 点击 seek + 大波形按所属段 arousal 着色蓝→红 + 精简控制条含分段色块 tooltip + 侧栏全曲汇总权重 chips/水印警示/分段列表可点击 seek）；音乐 3 步进度时间线 + stepMap；波形函数改 waveformPlayer() 抽象（视频/音乐共用）；设置 tab + i18n zh/en 约 40 键。
  - **E2E（真模型）**：ANBR- Land（169s/6 段/44s/15K token）→ Epic60/Cinematic81/Strings47/Trailer60 + **水印 6/6 段命中逐字转写** + vocals 正确排除水印=Instrumental；Beyond 海阔天空（241s/8 段/67s）→ **Male/Cantonese 精确命中** + 悲壮/中国风扩展值真实启用 + 钢琴主导。
  - **水印幻觉修复**：Beyond 首跑尾段误报 Present 且"转写"逐字复述了 prompt 示例里的 Artlist 例句——**prompt 示例即幻觉种子**；修复=字段说明收紧（仅清晰听到的广告语音才算，欢呼/念白/和声不是）+ 示例值改中性占位。重跑：Beyond 9/9 段 None（0 误报）+ ANBR 仍 100% 检出（且转写含 "Artlist IO" 大小写变体=真实转写证据）。
  - **UI 验证（独立 6699 测试实例 + Playwright）**：筛选音乐档 3 卡音符角标/水印角标 1/mood chip 中文/波形缩略图全载；详情页播放 0→1.77s、AV 曲线点击 seek 31.3s、ANBR 水印警示、侧栏 9 段中文 chips；设置 5 tab、Omni 模型选中、段长药丸。
  - **待用户操作**：重启应用后生效（media 表自动迁移，已自动备份 .db.bak-music）。
- **✅ 修复：media 表重建迁移丢列事故**（用户实测导入报 `no such column: file_mtime`）：
  - **根因**：重建用 `_SCHEMA` 的 media 定义建 media_new，但 **`_MIGRATIONS` 的 18 个历史 ALTER 列（file_mtime/file_hash/phash/embedding/has_xmp/picture_control/camera_make/lens_model/video_profile/bit_rate/audio_*/color_*/pix_fmt）不在 `_SCHEMA` 里**；交集拷贝 `old ∩ new` 把这些列全部静默丢弃——行数不变（8876=8876）但列没了，首个触碰 file_mtime 的 SELECT 即报错。首次迁移验证只断言了行数/CHECK/新表，**没断言历史列完整性**——测试盲区。
  - **修复**（db.py）：建 media_new 后，遍历 `PRAGMA table_info(media)`，把老表有而新表没有的列**逐个 ALTER 补进 media_new（带类型与 DEFAULT）再全量拷贝**——对任意历史列通用，不再依赖枚举。
  - **数据恢复**：迁移前的自动备份 `data/media.db.bak-music` 完好（行数一致、迁移后导入全失败无新增行）；已停机恢复备份 → 重启后由修复版迁移重跑。
  - **修复版验证**（备份副本）：42 列 = 旧 38 + music 4 无缺失；file_mtime(8438)/file_hash(439)/embedding(7568)/segments(4322)/FTS(8875) **逐项数据一致**；integrity ok；二次启动幂等。
- **✅ 音乐分析改为整曲模式**（用户决定：音乐是整首歌的基调，不需要分段——分段/逐段进度/分段时长设置全部移除）：
  - analyze_music 整曲单次请求（头文字「这是一首完整的音乐作品」），返回单段 dict（time 0~时长）；**超长截断保护 MUSIC_MAX_ANALYSIS_SEC=1500**（音频 token≈15/s，25min+prompt 守住 32k 上下文，日志提示截断）；_process_music 去逐段循环；设置键 music_segment_sec、设置 tab 分段时长药丸、确认弹窗分段行、i18n 分段键全部移除。
  - **详情页单段降级**：AV 双线曲线仅 segments.length>1 显示；整曲模式改显「唤醒/效价双轴数值大字」；侧栏汇总/分段列表照常（music_segment 仍写 1 行整曲记录）。
  - **E2E（真模型）**：ANBR 169s 整曲 16s 完成（分段模式 44s）→ Epic70/Orchestra40 + 水印检出逐字转写；Beyond 241s 整曲 15s（原 67s）→ **Male/Cantonese 保持精确命中** + 悲壮 30% + 钢琴30/鼓25/电吉他25——**整曲模式更快（~4 倍）、质量不降**（一次听全曲，基调判断更 holistic）。
- **✅ 「音视频一起分析」改为能力驱动 + 开关移入模型下拉**（用户反馈三点：①文案不应绑定 Omni——未来自定义模型支持音频输入也适用；②开关放下拉里图标左侧 + 问号提示；③语音 tab 联动禁用 + 指引）：
  - **能力驱动**：前端统一按 `localModels[].audio` 判定（选中模型能力 computed `localModelAudio`；下拉选项带 audio 标志）；detail.js 的确认弹窗/阶段表改为查 `/api/local-vlm/models` 的 audio 而非硬编码模型 id。文案全部通用化（去「Omni」字样；d.merged_asr → 「音视频一起」）。
  - **开关进下拉**：支持音频的模型选项行内、图标按钮左侧——小号 q-toggle「音视频一起分析」+ help_outline 问号（tooltip = 原 hint 说明）；`@click.stop` 防误选模型；移除面板里的「语音分析」小节与分段控件，清孤儿键（s.local_asr_separate/local_asr_mode_label）。
  - **语音 tab 联动**：开启时（本地引擎 + 所选模型支持音频 + merged）Whisper 模型下拉 `disable`，底部提示「当前已开启音视频一起分析，语音由视频模型直接处理；如需在此独立配置语音分析，请先在视频分析的模型下拉中关闭该选项」。
  - **验证**（Playwright）：下拉 4 行中仅 Omni 行有开关+问号（左于 delete 图标）；开关点击菜单不关、开启后语音 tab 下拉 q-field--disabled + aria-disabled + input disabled 三重坐实、指引出现；测试全程未点保存（DB 仍 local_model=qwen3-vl-8b/separate）。
- **✅ 语音分析并回视频分析 tab（子模块）**（用户反馈：语音本就是分析视频里的音频内容，不该独立成 tab）：删除语音 tab（设置页变 4 tab：通用/图片分析/视频分析/剪辑构思，仍全部常驻不移动）；语音配置整体移入视频面板底部小节「语音分析」（小节标题 + 云端|本地（Whisper）分段控件 + Whisper 型号下拉 + 条件提示/占位/禁用联动原样保留，云端本地两种视频引擎通用）；清孤儿键 s.tab_audio。已实测：tab 列表 = 4 个，视频面板小节 [抽帧参数, 语音分析]、分段控件 ×2（引擎+ASR）、下拉含 ASR 模型。
- **✅ 修复：开「音视频一起分析」后设置弹窗组件被遮挡**（用户反馈）：根因不是高度——面板是 flex 列布局，内容超高时**子项被 flex-shrink 压缩变形**（scrollHeight 恒 440 根本不触发滚动），select 被压扁看起来像被遮挡。修复：面板改 `.settings-panel` 类 + **子项 `flex-shrink:0`**（恢复滚动语义）；同时面板高度 440→560（视频页并入语音模块后内容确实变长；弹窗总高 725px < 屏高 897px）。实测：视频本地+同析完整内容 560 一屏装下无需滚动、select 高度健康（40/48px 无压缩）、四个 tab 高度恒定 560 无跳变。
- **✅ 引擎切换改轻量药丸**（用户反馈：通栏分段控件太突兀太大不好看）：`engine-toggle` 从通栏 spread（448×48、选中实心 primary 大色块）改为**内容自适应胶囊**（实测 245×31、999px 圆角、描边容器）；选中态改**半透明强调色底（accent-dim）+ 强调色字**（Quasar 默认 toggle-color 会给实心 primary，需 `!important` 覆盖），未选中灰字、hover 提亮；图片/视频/语音三处引擎切换同构。AI 视觉核验：比例协调不突兀、层级清晰、无布局问题。
- **✅ 模型下拉选项改两行结构**（用户反馈：标题和选项挤在一行不美观）：主行只放**模型名 + 右侧开关/问号/图标**（腾出横向空间），量化·体积·内存标注降为副标题行；行内边距放宽（上下 8px，行高 49px）；已下载行副标题 `Q4_K_M · 18.56GB`、未下载行附加「需内存 N GB+ · 未下载」，下载中行显示进度条；选中态在选框里的展示仍是紧凑单行（label 不变）。options 补漏 quant 字段；开关与图标间距按 AI 核验建议 2→6px。视频/图片两处下拉同构。
- **✅ 设置字段标签外置**（用户反馈：所有下拉的标题缩在控件内显得紧凑、值没有水平对齐感）：全部 q-select/q-input 去掉 Quasar filled 的**盒内浮动标签**（`:label`），改为 `.settings-label`（11px 灰字）置于控件上方、控件内只显示值——覆盖通用/图片/视频（云端+本地+抽帧两列）/语音/剪辑构思全部字段；两列行（压缩分辨率+帧率、抽帧帧率+帧数上限）改为每列独立包裹（标签+控件）；API Key 输入框同步处理。实测：面板内浮动内嵌标签数 = 0，全部 filled 控件高度统一 40px（值基线水平对齐），AI 视觉核验「层级分明、对齐良好」。
- **✅ 播放错误细分：文件不存在 vs 格式不支持**（用户反馈：素材都在外置盘，盘未挂载时仍提示「格式不支持」）：
  - **根因**：浏览器对加载失败（含 404/磁盘缺失）统一抛 MediaError code=4「不支持」，前端按 code 映射无法区分。
  - **修复**：新轻量端点 `GET /api/media/<id>/exists`（DB 行 + `Path.exists()`，不动转码管线——HEAD 播放 URL 会拉起 ffmpeg 所以不能直接探）；`onVideoError` 先查存在性——不存在 → 「文件不存在（可能已被移动、删除，或所在磁盘未挂载）」；存在 → 按错误码细分（格式不支持/解码失败/网络错误等）；接口异常回退原行为。
  - **验证**：端点三态（真实文件 true / 缺失 false——恰逢用户外置盘未挂载，9126 即真实案例 / 无记录 404）✓。需重启后端生效。
- **预留（用户提议，未实现）**：音乐分析 tab——识别乐器、表达的情绪、描绘的画面，作为设置页独立 tab 后续加入。
- **下一步 Step4**：模型下载管理（hf-mirror 镜像、断点续传、SSE 进度、删除、`local_dir_use_symlinks=False`）+ 设置页模型卡片 UI。**注（2026-08-17 实测）**：whisper large-v3 加载 78~82s 的根因是 CTranslate2 在本机 CPU 后端不支持 fp16 计算 → `compute_type=auto` 落到 int8 → 每次启动现场把 fp16 权重逐矩阵量化成 int8（纯 CPU、不随 cpu_threads 扩展；磁盘读 2.9GB 仅 0.24s 非瓶颈；llama-server 5.76GB 仅 3.5~11s 是因为 GGUF mmap 免转换）。**解法**：下载后一次性本地转换为 int8 格式缓存（CT2 转换器），之后加载秒级——并入 Step4 实现。

## 待办：产品化打包——后端自包含（Python/ffmpeg/exiftool 不再依赖用户环境）（2026-08-16）

当前 Electron「产品」实际依赖开发机环境，拿给普通用户跑不起来。逐项：

- **Python 后端**：[electron/main.js](electron/main.js) `startPython()` 直接 spawn 系统 `python3`，要求用户自装 Python 3.12 + pip 依赖。需用 PyInstaller（或同类）把 Flask 后端打包成自包含二进制随安装包分发，main.js 改 spawn 该二进制。
- **ffmpeg**：后端全部裸命令 `ffmpeg` 走 PATH（[compressor.py](backend/compressor.py)、[blueprints/serve.py](backend/blueprints/serve.py) 多处）。需打包静态 ffmpeg（macOS evermeet 构建 ~80MB / Windows gyan.dev），改按资源目录绝对路径调用。
- **exiftool**：同上（[blueprints/serve.py](backend/blueprints/serve.py)、[blueprints/library.py](backend/blueprints/library.py) 多处）。exiftool 是 Perl 程序，macOS 有官方独立打包版（单文件可执行），Windows 用 exiftool.exe。
- **⚠ 实锤：GUI 启动 PATH 问题（影响 ffmpeg/exiftool 所有裸命令调用）**：macOS 应用从 Finder/桌面启动时 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`，不含 `/opt/homebrew/bin`——现在从终端启动能用只是继承了 shell 的 PATH；打包成产品后 `shutil.which("ffmpeg"/"exiftool")` 全部找不到，压缩/缩略图/元数据/XMP 功能全挂。修复方向：开发模式启动时补 PATH；产品模式改用资源目录内二进制的绝对路径（配合上两条）。
- **requirements.txt 缺 loguru（✅ 已修 2026-08-16）**：backend 15 处 `from loguru import logger` 但依赖未声明——新机器装完依赖启动即 ImportError（本机 conda 环境碰巧有才没炸）。已补 `loguru>=0.7`。
- **端口写死 6622**（[main.js](electron/main.js) `const PORT = 6622`；[run.py](run.py) 本身支持 `PORT` env）：占用/多开即启动失败，产品需动态端口 + 冲突处理。
- **模型文件管理**：whisper 模型运行时自动下载到 `~/.cache/huggingface`（faster-whisper 默认）；将来本地 VLM 模型（Qwen3-VL GGUF，约 24GB）更大。产品应统一「模型目录可配置」（视频用户常有大外置盘），默认放应用数据目录。
- **分发合规**：macOS 需 Developer ID 签名 + 公证（否则用户打开报「已损坏」）；考虑 electron-updater 自动更新。llama.cpp（MIT）与 Qwen 权重（Apache 2.0）均允许随产品分发。
- **国内下载源**：HF 直连不通，模型下载默认走 hf-mirror.com 镜像或允许配置（whisper 与未来 VLM 模型同）。
- **PyInstaller 已知坑**：faster-whisper/ctranslate2、rawpy、onnxruntime 都有 hidden imports / 数据文件问题，需逐个验证。

关联：计划中的「本地 VLM 引擎」（llama-server sidecar，spawn 模式与 Python 后端相同）与此同属产品化课题——Electron 伴生进程（Flask、llama-server）+ 资源内自带二进制，打包时一并解决。

## 已完成：批量改文件时间 改 SSE 流式 + 50/批（治慢/超时）（2026-06-30）

「用拍摄时间覆盖文件时间」「拍摄时间时区调整」批量时很慢甚至超时。根因：①每个文件起一个 exiftool 子进程（N 次启动开销）；②shift 改 QuickTime 元数据需重写整个 MP4，大文件 + 慢 exFAT 盘单文件就慢；③串行单请求，总时间叠加超时。

改为 **措施1（50/批合并 exiftool）+ 措施2（SSE 流式进度）**：

- **后端 [backend/blueprints/library.py](backend/blueprints/library.py)**：两个端点都改成 `text/event-stream`。
  - `_EXIFTOOL_CHUNK=50`、`_run_exiftool_chunk()`（一次 exiftool 跑一批，按 stderr `Error: ... - <path>` 找失败文件）、`_sse()`。
  - **set-file-date**：每批 50 文件用 exiftool `-execute` 链（各文件不同 date_taken → `-FileCreateDate=dt -FileModifyDate=dt file -execute …`），一个进程跑完一批。
  - **shift**：同一偏移量 → `exiftool <tag 偏移> file1…file50`，一个进程跑一批。
  - 每批后 yield `progress` 事件（done/total/updated/errors/skipped）+ 末尾 `done`。失败文件不入 DB 更新。
- **前端 [frontend/js/gallery.js](frontend/js/gallery.js)**：`_streamFileOp(url,body,label)` 通用 SSE 消费（`getReader`+`TextDecoder`，按 `\n\n` 切，解析 `data:` 事件）→ 驱动 `<q-dialog>` 进度框（`q-linear-progress` + 「done/total，已更新 N，失败 M」）。`doAdjustTime` / `confirmSetFileDate` 改用它。[api.js](frontend/js/api.js) 两个方法改返回 raw `fetch` Response（不再 `_fetch` 的 json）。i18n 加 `g.*_progress` / `g.file_op_fail`。

效果：覆盖文件时间（只改文件系统时间戳、不重写文件）合并批后**快很多**（治本）；时区调整省启动 + SSE 不再整体超时、有进度可见（大文件重写 I/O 仍固有，但不再"卡死"）。

验证：临时拷贝 3 文件实测两端点 SSE 流正常，shift CreateDate 正确 +5h、set-file-date `-execute` 链成功，已清理。

## 已完成：素材库右键「拍摄时间时区调整」（批量）（2026-06-27）

素材库右键菜单新增「拍摄时间时区调整」，把选中文件（多选批量）的拍摄时间元数据整体偏移 ±24 小时内的整数小时，用于校正相机时间/时区偏差。弹窗有滑杆 + 不可逆提示。

- **后端 [backend/blueprints/library.py](backend/blueprints/library.py)**：`POST /api/library/shift-shooting-time {ids,hours}` —— 每文件 exiftool 对 `DateTimeOriginal/CreateDate/TrackCreateDate/MediaCreateDate` 统一 `+=N:00:00`（或 `-=`），`hours` 限 `-24..+24`、0 直接返回。同步 DB `date_taken`（`_shift_date_taken` 按相同小时数偏移，保留 ISO-Z/纯文本两种原格式）。返回 `{updated, skipped, errors, hours}`。
- **前端 [frontend/js/gallery.js](frontend/js/gallery.js)**：右键菜单项（「覆盖文件时间」下面）+ `<q-dialog>` 滑杆（-24..+24，步进 1，实时显示「向后 N h 变晚 / 向前 N h 变早」）+ ⚠ 不可逆提示。`openAdjustTime/doAdjustTime` → `API.shiftShootingTime(selArr,hours)` → notify + `this.load()` 刷新。
- [frontend/js/api.js](frontend/js/api.js) 加 `shiftShootingTime`；i18n 加 `g.ctx_adjust_time*` / `g.adjust_time_*` 中英。

验证：exiftool shift 语法实测（视频 QuickTime 三标签 + 照片 EXIF 都正确偏移）；端点端到端测试（临时拷贝）——文件 CreateDate + DB date_taken 均正确 +8h，格式保留，已清理，未碰真实素材。

## 已完成：素材库右键「用拍摄时间覆盖文件时间」（批量）（2026-06-21）

素材库右键菜单新增「用拍摄时间覆盖文件时间」，把选中文件（支持多选批量）的**创建时间 + 修改时间**改为各自的 EXIF 拍摄时间，弹框确认**不可逆**。

- **后端 [backend/blueprints/library.py](backend/blueprints/library.py)**：`POST /api/library/set-file-date-from-exif {ids}` —— 逐文件用 exiftool `-FileCreateDate=<dt> -FileModifyDate=<dt>` 写入，`<dt>` 取自 DB `date_taken`（导入时已带 CreateDate 回退）。**时区**：date_taken 是相机本地时间，exiftool 按本机时区写入文件时间戳，Finder 即显示拍摄本地日期（不做 UTC 换算，避免错位）。无 date_taken / 文件缺失的跳过；同步更新 DB `file_mtime`（mtime 已变，避免下次扫描误判）。返回 `{updated, skipped, errors}`。
- **前端 [frontend/js/gallery.js](frontend/js/gallery.js)**：右键菜单加项（AI 分析之后，独立分组），单选/多选标签；`confirmSetFileDate()` 用 `Quasar.Dialog.create` 弹确认框（红色按钮，文案写明改创建+修改时间、不可逆、无拍摄时间的跳过）→ `API.setFileDateFromExif(selArr)` → notify 结果。
- [frontend/js/api.js](frontend/js/api.js) 加 `setFileDateFromExif`；i18n 加 `g.ctx_set_file_date*` / `g.confirm_set_file_date*` / `g.set_file_date_done/fail` 中英。

验证：exiftool 在 macOS 实测能写 birth time（FileCreateDate）；端点端到端测试（临时拷贝+临时 DB 行）——birth time 从拷贝时间正确改为拍摄时间，已清理，未碰真实素材。

## 已完成：导出改为 FCPXML + SRT 开放格式（剪映加密不可行）（2026-06-21）

原「导出到剪映」生成剪映原生草稿，实测在剪映 6.0+/10.x（用户 10.8.7）上**打开报「草稿已损坏」**：剪映从 6.0 起对 `draft_info.json`/`draft_content.json` 加密（`crypto_key_store.dat`，scheme `jianying_draft_encrypt_v2`），cipher 只在剪映二进制内，pyJianYingDraft 只能生成明文、且仅兼容 ≤5.9。[jy-draftc](https://github.com/wenshui330/jy-draftc) 能回加密但 Windows 专属 + 调 `videoeditor.dll`，Mac 无对应方案。逆向 cipher 成功率低且随版本失效，放弃。

**改走开放格式**（剪映/达芬奇/Final Cut 都认）：把按钮「导出到剪映」改为「**导出工程**」，产出两个文件——
- **`.fcpxml`**（FCPXML 1.10）：分镜视频片段展开为一条 sequence/spine 上的 `<asset-clip>`，`offset=时间线位置`、`start=metadata.srcStart`（绝对媒体入点）、`duration=src 区间长`；resources 里 `<format>`（画布跟随首个分镜 ffprobe 尺寸，如 3840×2160）+ 去重后的 `<asset>`（file:// 源素材）。剪映「导入工程」、Resolve、FCP 直接导入。
- **`.srt`**：字幕 + 旁白文字（旁白前缀「旁白」），HH:mm:ss,ms 时间码。剪映/Resolve/FCP「导入字幕」。

改动：
- **新建 [backend/fcpxml_export.py](backend/fcpxml_export.py)**：`build_fcpxml(pid,name)`（asset-clip 时间线）+ `build_srt(pid)`（字幕/旁白）。时间用微秒有理数 `N/1000000s`。
- [backend/blueprints/workbench.py](backend/blueprints/workbench.py)：`POST /api/workbench/<pid>/export-fcpxml` 返回 `{ok,name,xml(fcpxml),srt,warnings}`。
- [frontend/js/workbench.js](frontend/js/workbench.js)：按钮「导出工程」+ `exportProject()`（Quasar.Dialog 填名 → POST → Blob 下载 `<name>.fcpxml` + `<name>.srt`，via `_downloadBlob`）。
- **删除** [backend/jianying_export.py](backend/jianying_export.py) + `pyjianyingdraft` 依赖（requirements.txt）+ `wb.export_jianying*` i18n，换 `wb.export_fcpxml*`。

验证：Flask test client 工程62 → fcpxml well-formed（1.10）、画布 3840×2160、112 asset/170 clip、首 clip `start=3.5s duration=6.5s offset=0` 正确；srt 180 条。**待用户在剪映 10.8.7「导入工程」实测**（clips 是核心，先确认导入；字幕/旁白文字随后视导入效果再决定是否也做成 FCPXML title）。

**实测后修一版（时间帧对齐）**：剪映导入后素材进了素材箱但**时间线为空**（asset-clip 被丢）。根因疑为时间用了非帧对齐的微秒有理数 `N/1000000s`，剪映导入器不认。改为 **30fps 帧对齐 `N/3000s`**（`_r` 按 `round(s*30)*100/3000`），并给 `<sequence>` 补 `duration`（=末 clip offset+dur），与 FCP 导出风格一致。再测中。

**再修（主轨 + 连续性）**：剪映导入后片段上时间线了但**不在主轨**。FCPXML `<spine>`（主 storyline）要求片段**严格连续无重叠**，逐个独立帧对齐 offset/duration 会有 1 帧漂移产生微缝隙，剪映把缝隙后的片段降到副轨。改为**按帧累进位置**（cursor）保证连续，遇到真实空隙用 `<gap duration>` 占位（FCPXML 主轨留白的标准写法），asset-clip 显式 `lane="0"`。验证 spine 严格连续（工程62 有 1 处真实 gap 已用 `<gap>` 填，170 clip 全 lane0）。

**再修（内嵌字幕）**：主轨仍不在——判断为剪映导入 FCPXML 的固有行为（落到普通轨而非磁性主轨），FCPXML 层面难控，变通=剪映内全选拖到主轨。改为把**字幕/旁白内嵌进 FCPXML**：作为 `<caption>` 元素放在 `<sequence>` 内（spine 之外、`lane="1"`），按 DTD caption 无需 effect 引用（不像 `<title>` 要 Motion 模板 ref，避免 dangling 弄挂视频导入）；每条带 `<text><text-style ref>` + 唯一 `<text-style-def>`。视频 spine 完全不动（170 clip 不变），叠加 180 caption。剪映若支持 FCPXML caption 则字幕直接进；否则仍有 `.srt` 兜底。

## 已完成：导出工程到剪映草稿（2026-06-20）

工作台顶栏工程名右侧新增「导出到剪映」按钮：点击弹窗填草稿名 → 后端用 [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)（`pip install pyjianyingdraft`，已加 `requirements.txt`）生成剪映草稿，写入剪映草稿目录，打开剪映即可见。

- **新建 [backend/jianying_export.py](backend/jianying_export.py)**：`build_draft(pid,name,drafts_dir)` —— 查 `project_tracks`（version=1，video/subtitle/narration）+ segment→media→file_path 映射；`DraftFolder.create_draft → add_track(video) + add_track(text:subtitle) + add_track(text:narration)`；每分镜 `VideoSegment(VideoMaterial(path), target, source_timerange=...)`，字幕/旁白 `TextSegment(content, timerange)`；`script.save()`。素材由 VideoMaterial 自动登记进 `materials`（剪映素材库可见）。缺 file_path 的分镜跳过 + 计 warnings 返回。`resolve_drafts_dir`：settings 表 `jianying_drafts_dir` > 环境变量 `JIANYING_DRAFTS_DIR` > macOS 默认 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`。
- **源点映射（已核实）**：`metadata.srcStart/srcEnd` 是**绝对媒体时间戳**（与 segment.time_start 同坐标系，见 creative.py apply_plan），`track.time_start` 是时间线累加位置；秒→微秒给 pyJianYingDraft。时间格式 `MM:SS.ss`/`HH:MM:SS.ss` 两种混存，`_parse_time`（与 creative.py 一致）都处理。source 时长钳到 material.duration 防越界。
- **端点 [backend/blueprints/workbench.py](backend/blueprints/workbench.py)**：`POST /api/workbench/<pid>/export-jianying` body `{name?}`（缺省工程名，做文件名安全化），返回 `{ok,name,path,warnings}` 或 `{error}`。
- **前端 [frontend/js/workbench.js](frontend/js/workbench.js)**：`.wb-toolbar` 工程名右侧加 `q-btn「导出到剪映」`；`exportJianying()` 用 `Quasar.Dialog` prompt 填草稿名（默认工程名）→ POST → 成功 positive notify，失败 negative。
- i18n 加 `wb.export_jianying*` 中英 key。

依赖：pyJianYingDraft 经 pymediainfo 读素材时长/尺寸，运行环境需 MediaInfo 库（macOS `brew install mediainfo`）。已通过 Flask test client 在工程 62 实测：3 轨（170 视频 / 10 字幕 / 170 旁白）、170 素材登记、首段 source `{3.5s,6.5s}` target `{0,6.5s}` 正确。

**画布比例跟随首个分镜**：`build_draft` 预扫首个可读 `VideoMaterial` 取 width/height 作 `create_draft` 画布尺寸（缺则回退 1920×1080），避免竖屏/4K 素材出黑边。工程 62 实测画布 3840×2160（4K 无人机素材，ratio=original）。

## 已完成：脑图删叙事/段落可撤销 + 删除确认改 Quasar 模态框（2026-06-20）

两个问题：①脑图模式下删除叙事（narrative）/段落（act）后无法撤销；②脑图删除确认用的是浏览器原生 `confirm()`，与项目其它弹框（`Quasar.Dialog`）不一致。

**问题①根因**：上一版把 undo 栈改成「快照 tracks」，撤销时 `trackUndo`→`_trackSave`→`_syncTracksToPlan` 从 tracks 反推 plan。但 `_syncTracksToPlan` 是**保结构**的——它以当前 `mindMapData` 为基准遍历 `acts/narratives` 重排 shot。删叙事/段落后该结构已从 plan 消失，反推时被删叙事的 video 无处归属被丢弃，叙事回不来。tracks 单独无法重建已删结构。

**修复（[frontend/js/workbench.js](frontend/js/workbench.js)）**：undo 栈元素从「tracks 数组」改为 `{tracks, plan}` 成对快照——`_trackSnapshot()` 经新增 `_snapshotCurr()` 同时存 `this.tracks` 深拷贝和 `this.project.ai_plan`。`trackUndo`/`trackRedo` 用新增 `_restoreSnapshot(entry)` 同时还原 tracks 与 `ai_plan`（脑图 `mindMapData` 随之重算回到撤销前），再用新增 `_persistSnapshot()` 直接 PUT tracks+plan（**不走 `_trackSave`**，避免其 `_syncTracksToPlan` 反推再把还原的结构抹掉）。时间线编辑撤销同样适用（快照里 plan 与 tracks 本就是一致对）。

**问题②修复（[frontend/js/mindmap.js](frontend/js/mindmap.js)）**：`deleteAct`/`deleteNarrative` 去掉原生 `confirm()`，改用 `Quasar.Dialog.create({title, message, cancel, ok:negative})`，与 workbench `trackDelete` 的级联删除弹框同款。确认后 `.onOk` 才执行 splice + `_changed()`。

验证：`node --check` 通过；脑图删叙事/段落后 undo 能恢复（含其下所有 shot）、redo 能重删；时间线编辑撤销/重做回归正常；删除确认弹框统一为 Quasar 模态框（项目内已无原生 `confirm()`）。

## 已完成：工具栏去分割/删除 + 脑图视图接 undo/redo（2026-06-20）

工作台标尺上方操作栏（ToolBar）调整 + 脑图编辑可撤销（[frontend/js/workbench.js](frontend/js/workbench.js)）：

- **时间线视图去掉「分割」「删除」按钮**：ToolBar 左侧只留「撤销/重做」。`分割` 原本只在工具栏存在（无右键/快捷键入口），按钮移除后 `trackSplit()` 方法成为孤立代码，一并删除（非视频块禁分割的约束随分割功能一并退役；视频中点切分不再提供）。`删除` 按钮移除，但删除仍可通过轨道项右键菜单 + Delete/Backspace 快捷键（`trackDelete`/`_cascadeDelete` 保留）。
- **撤销/重做改为两视图通用**：把 undo/redo 按钮从 `v-if="bottomViewMode==='timeline'"` 模板里拿出来，时间线/脑图视图都显示。
- **脑图编辑可 undo/redo**：原先脑图编辑走 `onPlanChanged`→`loadTracks`→`_resetUndoStacks()`，每次编辑都清空 undo 栈，脑图视图下撤销/重做形同虚设。改为：①`onPlanChanged` 开头先 `_trackSnapshot()`（保存编辑前 tracks）；②`loadTracks` 不再 `_resetUndoStacks()`（该方法仅被 `onPlanChanged` 调用，初始 `load()` 仍单独 reset）。撤销时 `trackUndo` 弹栈还原 tracks → `_trackSave`→`_syncTracksToPlan` 反推 plan → 写 `ai_plan` → `mindMapData` 重算 → 脑图重渲染到撤销前状态。`_cascadeDelete` 内原有的 `_trackSnapshot()` 删除（否则与 `onPlanChanged` 内的快照重复，导致一个无效的 undo 卡步）。

验证：`node --check` 通过；时间线视图操作栏只剩 undo/redo + 缩放；脑图视图拖动/改名/删除分镜后 undo 能回退到编辑前、redo 能重做。

## 已完成：行头补主旨/叙事 + 标题区对齐 + 叙事虚线调细（2026-06-14）

overlay 框上线后用户反馈：①左侧行头只显示情绪/旁白/字幕/分镜，缺主旨/叙事；②叙事虚线 2px 偏粗。修复（[workbench.js](frontend/js/workbench.js) + [main.css](frontend/css/main.css)）：
- content-group labels 列顶部加主旨线/叙事线行头（各 20px），area 顶部加 `.wb-frame-title-zone`（40px）与之对齐；content-group 去掉 margin-top（标题区纳入 area），框 `top:0` 覆盖标题区+area。
- 叙事框虚线 2px → 1px。
验证：行头显示主旨线/叙事线/旁白线/字幕线/视频线（20/20/32/32/56），标题区 40px 对齐，叙事虚线 1px。

## 已完成：时间线主旨/叙事 overlay 框重构——对齐脑图层级（2026-06-14）

把主旨/叙事从「独立平行轨道」改成「覆盖框」——主旨框横跨整个主旨时长、纵向包住分镜/旁白/字幕；叙事框在主旨框内、横跨单个叙事；情绪线独立在最上（不被框包）。这样时间线和脑图的 act→narrative→shot 层级一致。

改动（[frontend/js/workbench.js](frontend/js/workbench.js) + [frontend/css/main.css](frontend/css/main.css)）：
- `trackTypes` 移除 theme/text，拆为 emotion 独立行 + `contentTrackTypes`(narration/subtitle/video)。
- 模板：emotion 保留独立 `.wb-track-row`（svg 曲线不动）+ 新 `.wb-content-group`（共享 labels 列 + area）容纳 3 条贯穿 `.wb-content-lane` + 主旨/叙事 `.wb-overlay-frame`（absolute 覆盖 area，`trackItemPos` 定位，area 是统一定位基准零换算）。
- **pointer-events**（关键）：框主体 `none`（不挡块拖拽/点击/drop）+ 框标题 `auto`（点选/双击改名/右键）+ 块 `z-index:5`（高于框）。
- 框编辑：点标题选中、Delete/右键删（复用 `_cascadeDelete` 级联）、双击标题内联改名（`startFrameRename`→`_trackSave`→`_syncTracksToPlan` 回写 plan 的 act.title/narrative.text）。`addTrackItem` 对 theme/text return（Part B 留作后续）。
- 复用零改动：`trackItemPos`、`_cascadeDelete`、`_syncTracksToPlan`、`_normalizeVideoTrack`、emotion 曲线、undo/redo、双向同步、规则1/2/4。

验证：项目 62 实测——emotion 独立行 + content-group(3 lane) + 主旨框(3)/叙事框(21) 覆盖 area 全高(120px=3 lane)；点框标题选中框、点块选中块（pointer-events 穿透正确：框 none/标题 auto/块 z5）、块框互斥。

## 已完成：主旨/叙事 overlay 框高度+z-index+配色完善（2026-06-14）

overlay 框上线后发现三个显示问题：①框标题挤在 narration lane 顶部，与旁白块重叠 15.5px；②框 z-index(3/4) 低于块(5)，边框/标题被块遮挡；③主旨/叙事配色未区分深浅。修复（[frontend/css/main.css](frontend/css/main.css)）：
- `.wb-content-group` 加 `margin-top: 20px`（标题区），`.wb-overlay-frame` 改 `top: -20px`（覆盖标题区+area），`.wb-frame-label` 改 `top: 2px`——标题上移到专属标题区，不再挤 lane。
- `.wb-frame-theme` z-index 6、`.wb-frame-text` 7（高于块 5），边框/标题在最上层。
- 主旨 `var(--accent)`（深主题色），叙事 `color-mix(in srgb, var(--accent) 50%, transparent)`（浅），标题文字同色系。

验证：标题(654-670) 与旁白块(672+) 不再重叠；框 z6 > 块 z5，边框在最上层。

## 已完成：修复 video 块被 padding 撑大致视频轨道比主旨/叙述长（2026-06-14）

缩小比例尺后主旨/叙述轨道视觉短于视频轨道（放大正常，数据正常）。根因：`.wb-track-item` 有 `padding: 2px 8px`，`box-sizing: border-box` 下当块宽 < padding(16px) 时元素最小宽被提升到 padding——小 zoom 下大量短 video 块（inline 3px）被撑到 16px，视频轨道总长偏大；主旨/叙述块大不受影响。实测视频线 maxRight 2891.4 vs 主旨/叙述 2878.4（差 13px）。

改动（[frontend/css/main.css](frontend/css/main.css)）：水平 padding 从块本体移到文字元素——`.wb-track-item` 改 `padding: 2px 0`，`.wb-track-item-label` / `.wb-track-text` 加 `padding: 0 8px`（flex item + `min-width:0` + overflow hidden，不会撑大块）。

验证：注入新 CSS 后 video 块 computed width=3px（=inline，不再撑大），主旨/叙事/情绪/旁白/视频轨道 maxRight 全部 2878.4 等长。

## 已完成：修复小 zoom 时间线块视觉重叠（2026-06-14）

小比例尺下时间线块视觉重叠（实际不重叠）。根因：`trackItemPos` 的 width 用 `Math.max(30, Math.round(dur*pps))`——最小 30px 且取整；连续块（`time_end[i]==time_start[i+1]`）因 `round(s)+round(dur)` 偶尔 > `round(s+dur)` 差 1px，小 zoom 时 30px 最小宽度远大于块间距导致大面积重叠（项目 62 实测 video 重叠 137/170）。

改动：
- `trackItemPos`（[frontend/js/workbench.js](frontend/js/workbench.js)）改为浮点定位（不 round），连续块右边界 `e*pps` 精确等于下一块左边界；width 最小 0.5px（亚像素可见）。
- `.wb-track-item`（[frontend/css/main.css](frontend/css/main.css)）加 `box-sizing: border-box`（padding 不额外撑宽，width 即视觉宽度）；`.wb-track-item-label` 加 `min-width: 0`（防 flex 文字撑大块）。

验证：video 重叠 137→0（pps=3/1.2/0.5），emotion/narration/theme 同样 0。text 剩 1 处是 narrative 数据本身区间重叠 0.1s（非布局问题）。

## 已完成：删除叙事/主旨时区间由 apply 重算（修复规则4）（2026-06-14）

规则4 的 `_cascadeDelete` 原走 `_trackSave`（normalize + sync），但删叙事后 `_syncTracksToPlan` 从残缺 tracks 反推 narrative 边界会误算（被删叙事的 video 已不在，fallback `_shotDur`），导致所属主旨块区间不缩反长。改为：结构性删除（act/narrative 消失）直接从 plan 移除对应项（theme 用 `metadata.act_id`，text 按新增 `_narrativeDuration` 累加边界匹配起点，算法与 apply 一致），再 `onPlanChanged`（PUT plan + apply + loadTracks），让所有 theme/text/video 区间由 plan 正确重算。

**验证**：项目 62 实测，删 act_1 的一个叙事（19.5s）→ act_1 主旨块精确缩短 19.5s（294.49→274.99），总时长同步减少。

## 已完成：创作 prompt 目标时长同时给分钟+秒（2026-06-14）

`render_brief_text` 注入的目标总时长原只给分钟（"X 分钟"），但 shot 时长约束（3-10 秒）与输出 `total_duration` 都是秒级，模型需心算分钟→秒。改为"X 分钟（约 Y 秒）"（`backend/blueprints/creative.py:856`，`float(dur)*60:g` 去尾零），减少单位换算误差。

## 已完成：脑图↔时间线双向同步端到端验证 + 非视频块编辑约束（2026-06-13）

继"四项修复"之后，对脑图↔时间线双向同步做端到端验证，并落实非视频块编辑约束（消除"plan 一个 shot 只存一个情绪/旁白值"与时间线多块编辑的冲突）。改动集中于 `frontend/js/workbench.js` 与 `frontend/js/i18n.js`。

**双向同步验证**（项目 62 青海实测）：
1. 脑图→时间线（`apply_plan` 全量重建）：跨叙事/跨主旨拖 shot 后，所在/跨过叙事区间与 video 起始时间全部重算，video 严格连续不重叠（gap=0），总时长守恒 → 需求"挪入挪出→所在/跨过/视频时间变动、不重叠、都在叙事内"满足。
2. 时间线→脑图（`_syncTracksToPlan` 位置驱动）：reorder video 后按新位置重新分配 narrative 归属，video 连续不重叠，plan 结构保留（安全阀未误删）。
3. 两方向都从 0 绝对重算，来回编辑不累积漂移。此前担心的"缩放误触发归属重算""来回漂移"经数据流追踪均不成立。

**非视频块编辑约束**（消除 `_syncTracksToPlan` 的 `findAuxTrack` 只回写第一个块导致的多块丢失）：
1. 禁止分割非视频块：`trackSplit()` 对非 video（情绪/旁白/字幕/文字/主旨）提示 `wb.track_split_disabled` 并返回，仅 video 可中点切分。
2. 禁止手动调整非视频块时长：`onTrackItemDown` 的 mode 判定加 `isVideo` 条件——非视频块边缘不进入 resize（只走 reorder），时长由 `_normalizeVideoTrack` 跟随 video；`onTrackItemHover` 同步只在 video 边缘显示 col-resize 光标。
3. 删除主旨/叙述级联+弹窗：`trackDelete()` 检测 theme（主旨）/text（叙述）弹 `Quasar.Dialog` 确认，确认后 `_cascadeDelete(anchor)` 按区间 `[time_start, time_end)` 删除其内所有块（相邻主旨/叙述从 `time_end` 起保留），`_syncTracksToPlan` 随后清理 plan 中空 act/narrative。
- i18n：新增 `wb.track_split_disabled` / `wb.track_resize_disabled` / `wb.track_delete_act_confirm` / `wb.track_delete_narrative_confirm`（中英）。

**验证**：node --check 通过；浏览器构造 method 上下文调真实代码实测——emotion 块 trackSplit 被拦（tracks 不变）、video 块仍正常 +1；删第一个主旨（0–185s）区间内 130 块全删、区间外全保留。DB 已用备份还原。

**未做（Part B，后续）**：规则3"手动添加主旨/叙述"——当前 `addTrackItem` 对 theme/text 是孤立 push（`_syncTracksToPlan` 匹配不到 act 被丢弃），让它有效需在 plan 插入结构层 + apply 重建，属新增功能，拆为独立任务。

## 已完成：工作台四项修复——撤销/重做、缩放联动、脑图同步、冻结行头（2026-06-13）

工作台时间线/脑图视图存在四个缺陷，集中修复于 `frontend/js/workbench.js` 与 `frontend/css/main.css`：

1. **撤销/重做失效**：`trackUndo/Redo` 本身逻辑正确，但回滚后 video 轨道的运行时 `_segment` 引用未回水（缩略图/标签显示 `?`）；且脑图改动经 `loadTracks()` 整体替换 `this.tracks` 后未清空快照栈，撤销会还原到"脑图应用前"的脏状态。
   - 新增 `_hydrateSegments()`（按 `segment_id` 重挂 `_segment`）/ `_resetUndoStacks()`（清栈 + 重置按钮态），抽离复用三处；`load`/`loadTracks` 替换 tracks 后调 `_hydrateSegments` + `_resetUndoStacks`；`trackUndo`/`trackRedo` 在 `_trackSave()` 前调 `_hydrateSegments`。

2. **缩放不联动**：`_normalizeVideoTrack` 同步非 video 轨道时只做平移（`oldEnd = oldStart + dur`，dur 取自已变更 metadata，缩放比恒 1），调整 video 片段长度时 emotion/narration/subtitle/text 块不跟着变。
   - mapping 的 `oldEnd` 改用归一化前的 `time_end`（原始区间）；同步逻辑从平移改为**按比例缩放**（`scale = newRange/oldRange`，start/end 都映射）；`oldRange≈0` 退化回平移。

3. **时间线↔脑图不同步**：脑图→时间线已有（`onPlanChanged` → apply → `loadTracks`）；时间线→脑图缺失。新增 `_syncTracksToPlan()`，在 `_trackSave()` 存 tracks 后调用：按当前 plan 的叙事时长累加算边界，用每个 video 的 `time_start` 落入区间决定 shot 归属（**位置驱动移动**），按 narrative 重建 shots（同步 src_start/src_end、按时间区间匹配 emotion/narration/text、按 act_id 匹配 theme），移除空 shot/narrative/act（删除同步），最后 `PUT /api/creative/<id>/plan` 持久化（不调 apply，tracks 已是权威源）。

4. **横向滚动行头不冻结**：`.wb-track-label` 加 `position: sticky; left: 0; z-index: 6`（已有 `background` 遮挡滚动内容），playhead z-index 10 仍在上。

**验证**：node --check 通过；启动 Flask 进工作台 62（青海）实测——横滚 200px 行头 left 不变（内容 320→120）、split 后 undo/redo 全循环 237↔238 且首个 video 标签保持"壮丽"非 `?`、DB 末态 517 tracks/3 acts/237 shots 与初始一致（同步未污染数据）。

## 已完成：prompt 文件归集到 backend/prompts/ 目录（2026-06-13）

把原本散在 backend/ 根目录的三个 prompt 文件归到一个目录，便于统一管理：
- `backend/prompts/video_prompt.txt`（视频分析）
- `backend/prompts/img_prompt.txt`（图片分析）
- `backend/prompts/creative_prompt.txt`（创作构思）

**改动：** `git mv` 移动三文件（保留 git 历史）；`analyzer.py`（`PROMPT_FILE`/`IMG_PROMPT_FILE` 路径）、`creative.py`（`prompt_path`）改为读 `prompts/` 子目录。`{emotion_labels}` / `{brief_text}` / `{segments_json}` 占位符注入机制不变。

## 已完成：修复工作台单视频重分析崩溃——pool.shutdown NameError（2026-06-12）

工作台对单个视频点"重新分析"，分析完成后 SSE `generate` 收尾时报 `NameError: name 'pool' is not defined`（analysis.py 原 354/412 两处，图片+视频 generate 各一）。`pool` 从未定义（应为模块级共享的 `_analysis_pool`），且对共享池做 per-task `shutdown` 本就错误（会拖垮后续所有分析）。直接删除这两行。

**改动 `backend/blueprints/analysis.py`：** 删除 `pool.shutdown(wait=False)` ×2（图片/视频 SSE generate 收尾处）。

## 已完成：修复创作生成"AI 返回格式无效"——prompt 超模型上下文（2026-06-12）

青海(776 分片)生成时报"AI 返回格式无效"。根因**不是 JSON 结构错误**，而是 LLM 返回**空响应(Response length=0)**：重分析后全分片带 emotions，先前给创作 seg_item 加了完整 emotions 数组 + camera_movement/color_tone/lighting + valence，叠加 `json.dumps(indent=2)`，prompt 撑到 598K 字符(~15 万 token)，超出 glm-5-turbo 上下文。历史成功约 280–327K。

**改动 `backend/blueprints/creative.py`：**
- seg_item 去掉**完整 emotions 数组**、camera_movement、color_tone、lighting、dominant_colors、main_subjects、asr（保留派生的 arousal+valence+mood 供按情绪曲线选片；完整分布仍存 DB，前端由 seg-emotions 组件展示）
- segments_json 改 **compact 输出**（去 `indent=2`，省 ~150K 缩进白空）
- 效果：青海 prompt 598K → 299K → **225K**。第一轮砍到 299K 仍失败（实测 glm-5-turbo 上限 ~285–300K，历史成功 284K），再砍 dominant_colors/main_subjects/asr 到 225K 才稳稳低于历史成功线

**注意**：creative.py 改动需**重启应用**（或 debug 自动重载）后生效。

## 已完成：移除构思期情绪懒回填，改为重分析覆盖（2026-06-12）

实践发现 A″ 懒回填（依赖 LLM 逐 shot 吐 segment_emotions）覆盖率不稳：青海项目时间线 98 个分片仅 41 个拿到情绪——LLM 对这个可选字段吐得不全（漏 57 个）。改为不回填，直接重跑 AI 视频分析让 B 路径给全部分片产 emotions，覆盖更彻底。

**改动：**
- `backend/blueprints/creative.py` — 删除方案解析后的 write-if-empty 懒回填循环
- `backend/creative_prompt.txt` — 删除已无用的 `segment_emotions` 输出字段定义与示例（保留"读取 seg.emotions 按 arousal 选片"的选片逻辑，那不是回填）
- 数据：重跑青海项目 166 个视频的 AI 分析（B 路径，全分片产 emotions）

## 已完成：片段列表情绪分布展示 — seg-emotions 组件（2026-06-12）

素材库预览右侧分析片段列表、工作台预览区右侧片段列表，把「氛围(mood)」从通用维度 chip 里拿出来，改成独立的情绪分布展示：每个成分一颗药丸(标签+占比) + 唤醒条(arousal) + 效价(valence 正/负着色)。紧凑版（时间轴列表 / 素材 hover 提示气泡）省略占比与标签文字。

**改动文件：**
- `backend/blueprints/analysis.py` / `backend/blueprints/workbench.py` — 两处 `_segment_to_dict` 解析 `emotions` JSON 为数组，并用 `aggregate_emotions` 派生 `arousal`/`valence` 注入每个 seg；workbench `_SEG_COLS` 补 `ms.emotions` 列。空情绪时优雅降级（emotions=[]、不输出 arousal/valence、mood 保留）
- `frontend/js/seg-emotions.js` — **新建**全局组件 `<seg-emotions :seg="seg" [compact]>`，渲染药丸+唤醒条+效价；`t()` 经 `this.$root.t` 复用（同 mind-map 组件范式）
- `frontend/index.html` — 引入脚本 + `app.component("seg-emotions", SegEmotions)`
- `frontend/js/detail.js` / `frontend/js/workbench.js` — sceneFields 移除 mood（不再作通用 chip）；主列表与提示接入 `<seg-emotions>`（workbench 三处：右侧可编辑列表、时间线只读列表、hover 提示）
- `frontend/js/i18n.js` — 新增 `d.dim.emotions/arousal/valence`（中英）
- `frontend/css/main.css` — `.seg-emotions` 药丸/唤醒条/效价着色样式（紫色药丸承接原 mood 配色，效价正绿负红）

**验证**：JS 语法（node --check）全过；后端两处 `_segment_to_dict` 对样例分布正确产出 arousal 0.81/valence 0.49，空情绪优雅降级、mood 保留；模板插入点/sceneFields/组件注册/i18n 键 grep 核对无误。

**注意**：情绪块仅在分片有 `emotions` 数据时渲染（`v-if="seg.emotions.length"`）。现有老分片 emotions 为空，需经新素材分析或构思期懒回填（见上一条变更）填充后才会显示。

## 已完成：情绪分布模型 — 单标签 mood → 效价×唤醒二维情绪分布（2026-06-12）

把素材分片的情绪从单标签 `mood`（12 选 1；库内 4177 片 65% 平静、22% 壮丽，近乎双峰、无梯度）升级为**多成分情绪分布 `emotions`**，基于学界维度模型（Russell 效价×唤醒为骨架 + Plutchik/Parrott 式分类标签），让情绪曲线能真正驱动选片。

**根因**：单标签把"效价(正/负)"和"唤醒(强/弱)"两根独立维度搅进一个词，且情绪本应多成分交织（如 30% 平静 + 70% 壮丽）；分片侧又缺与曲线（0–1 arousal）同轴的量化值，导致 mood 这根轴带不动选片。

**模型设计**：
- 每分片存分布 `emotions: [{mood, weight, intensity}, ...]`（2-3 成分，weight 求和≈1）
- 派生（读取时算）：综合唤醒度 `arousal=Σ(weight×intensity)`（与时间线情绪曲线同轴）、综合效价 `valence=Σ(weight×锚点valence)`、主导情绪（回填老 mood 列）
- **32 标签词表**单一事实源，按效价×唤醒四象限铺开（正高 8 / 正低 8 / 中性 4 / 负高 5 / 负低 7），覆盖全品类；停在 32 是为避免坐标平面上标签拥挤导致的标注噪声（64 会塌方）
- 两个"情绪"严格分离：分片**内在** arousal（项目无关、稳定）vs **时间线** arousal（`project_tracks.emotion_value`，自上而下设计）；回填只写内在、绝不写时间线

**改动文件：**
- `backend/emotion_labels.py` — **新建**：32 标签锚点表 + `render_label_table()`（prompt 注入）+ `aggregate_emotions()`（分布→arousal/valence/dominant）+ `dominant_mood()`
- `backend/db.py` — media_segment 加 `emotions` 列 + `_MIGRATIONS` 迁移项（老库启动自动 ALTER；旧 mood 列与 `idx_segment_mood` 索引保留）
- `backend/blueprints/analysis.py` — `_SEGMENT_COLS`/INSERT 写 emotions；mood 改为 `dominant_mood(emotions) or mood`（回填主导）；`_EDITABLE_COLS` + PATCH JSON 序列化加 emotions
- `backend/analyzer.py` — `load_prompt`/`load_img_prompt` 注入 `{emotion_labels}` 占位符（顺手消除 video/img 两处 12 标签重复硬编码）
- `backend/video_prompt.txt` / `backend/img_prompt.txt` — mood 枚举换 `{emotion_labels}` 占位 + 新增 `emotions` 字段说明 + JSON 示例
- `backend/blueprints/creative.py` — seg_item 加 emotions + 派生 arousal/valence + 补回 camera_movement/color_tone/lighting；注入 `{emotion_labels}`；方案解析后 write-if-empty 懒回填（A″）
- `backend/creative_prompt.txt` — 第三步选片改为按 arousal 对齐曲线 + mood 类型匹配；新增 `segment_emotions` 输出字段（仅无 emotions 的老素材填，供回填），与时间线 `emotion` 严格区分

**老数据迁移（零批处理脚本）**：老分片 mood 原样保留、emotions 为空。填充途径：① 新素材分析期产真值（B）② 老素材首次被构思用到时懒回填（A″，write-if-empty）③ 画廊手动重分析覆盖（`save_segments` 先 DELETE 再 INSERT）。回填 write-if-empty：值一旦写入不覆盖（综合 arousal 近似项目无关；偶发首判偏差靠手动重分析纠正）。

**验证**：`py_compile` 全过；`aggregate_emotions` 样例 `{壮丽0.7@0.9, 平静0.3@0.6}`→arousal 0.81 / valence 0.49 / dominant 壮丽（精确命中），边界（空/未知 mood/缺省 intensity 回落锚点）均正确；副本迁移加列成功、老行 emotions 空、mood 完好、二次迁移幂等；三处 prompt 占位符全替换、32 标签就位；回填 write-if-empty 首次写入/二次不覆盖。（真实 LLM 跑分析/构思需 API Key，未在此端到端触发，但其代码路径均已单测。）

**不在本次范围**：前端 emotions 展示/编辑面板（现有 mood 展示照旧，故 UE_DESIGN 无改动）；批量回填老库。

## 已完成：脑图分镜拖拽交互打磨 — FLIP 重排 + 无缝释放（2026-06-11）

打磨脑图视图分镜（shot）的拖拽体验：拖动时兄弟卡片丝滑让出空隙、被拖卡片缩小变虚影并跟随重排、释放时无多余回弹动画。

**改动文件：**
- `frontend/js/mindmap.js` — 拖拽逻辑全面重构：
  - **稳定 key**：watch plan 时给每个 shot 分配 `_mmid`，v-for key 从数组索引 `si` 改为 `shot._mmid`，让 Vue 真正移动 DOM 元素（而非交换内容），这是 FLIP 动画的前提
  - **非响应式拖拽状态**：`dropHint` 从 `data()` 移除，改用非响应式 `_dropHint` + 直接 DOM 操作 hint 元素（显示/隐藏/定位/缩略图），整个拖拽过程不触发 Vue 重新渲染
  - **FLIP 重排模型**：`onFlowDragOver` 中每个卡片（含被拖卡片）都移动到"假设松手后"的目标位置 —— 被拖卡片移到插入点，被跨越的卡片移到被拖卡片原位，其余不动。这样虚影会和其他卡片一起连贯重排
  - **no-op 检测**：同一叙事内、插入位置等于原 shot 位置时不显示空隙（用 `dragState` 索引识别被拖卡片，不依赖可能被 Vue 擦掉的 `.dragging` class）
  - **被拖卡片视觉**：`.dragging` class 改用 Vue `:class` 绑定（`isShotDragging`）+ CSS `opacity:0.3; scale(0.9)`，响应式驱动，跨重渲染保持
  - **hover 详情隐藏**：`onDragStart` 中 `hoverShot=null` 清空悬停详情弹窗（避免遮挡目标位置；因 `.dragging` 改用 `:class` 绑定，设 `hoverShot` 不再擦掉拖拽状态）；`showShotDetail`/`scheduleHideDetail` 拖拽期间跳过
  - **无缝释放**：`onFlowDrop` + `_flipSettle` 用 FLIP 技术 —— 释放前记录视觉位置 → 更新数据（Vue 移动元素）→ 因拖拽时 FLIP 已让卡片就位，delta≈0，无多余回弹动画；`_dropHandled` 标志防止 `onDragEnd` 重复清理
- `frontend/css/main.css` — 分镜卡片改用 CSS 变量分离位移与缩放：
  - `.mm-shot-card` 基础规则加 `transform: translateX(var(--tx,0px))` 和 `transition: transform 0.15s`
  - `.mm-shot-card.dragging` 改为 `opacity:0.3; transform: translateX(var(--tx,0px)) scale(0.9)`（translate 和 scale 通过 `--tx` 分离，JS 只设 `--tx`，不互相覆盖）

**技术要点：**
- **为什么用非响应式**：拖拽时直接操作 DOM（transform/class），若触发 Vue 重渲染，Vue 的虚拟 DOM patch 会覆盖这些直接修改 → 拖拽视觉效果瞬间消失
- **为什么用稳定 key**：数组索引作 key 时 Vue 不移动 DOM 元素只交换内容，无法实现"元素直接就位"的 FLIP 动画
- **为什么用 `--tx` 变量**：translate（JS 控制）和 scale（被拖卡片样式）都作用于 transform，用 CSS 变量分离避免互相覆盖

## 已完成：脑图视图 — 时间线/脑图双视图切换（2026-06-10）

工作台底部面板新增"脑图"视图，以三级层次结构（主旨线→叙事线→分镜）展示创意方案，支持内联编辑、拖拽排序、删除，修改后自动同步到时间线。

**改动文件：**
- `frontend/js/mindmap.js` — **新建**：MindMap 组件（三级层级展示、缩略图、情绪渐变、旁白/音乐/转场标签、内联编辑、HTML5 拖拽排序、删除）
- `frontend/js/workbench.js` — 新增 `bottomViewMode` data（timeline/mindmap 切换）；新增 `mindMapData` computed（解析 `project.ai_plan`）；新增 `onMindMapShotClick`（点击 shot 定位播放器）；新增 `onPlanChanged`（保存 ai_plan → apply → 重新加载）；模板增加 `q-btn-toggle` 切换按钮和条件渲染
- `frontend/css/main.css` — 新增 `.mm-*` 脑图样式（act/narrative/shot 层级、情绪条、sparkline、拖拽反馈、内联编辑、删除按钮 hover 显示）
- `frontend/js/i18n.js` — 新增 20 个 `wb.mm_*` / `wb.view_*` 中英文翻译 key
- `frontend/index.html` — 新增 `<script src="mindmap.js">` 和 `app.component("mind-map", MindMap)`
- `backend/blueprints/creative.py` — 新增 `PUT /<int:pid>/plan` 端点（保存脑图编辑后的 ai_plan）

## 已完成：素材面板 AI 分析按钮（2026-06-09）

工作台素材面板预览区：未分析的视频显示"AI 分析"按钮，已分析的视频分片列表上方显示"重新分析"按钮。分析进度通过全局 bgTasks 进度条展示。

**改动文件：**
- `backend/blueprints/workbench.py` — `GET /api/workbench/<pid>` SQL 增加 `m.analysis_status` 字段
- `frontend/js/workbench.js` — 预览区 sidebar：未分析显示 AI 分析按钮（auto_awesome 图标），已分析显示重新分析按钮（refresh 图标）；新增 `wbAnalyzing` data 和 `analyzeMedia(media)` 方法（SSE 流式分析 + bgTasks 进度跟踪 + 完成后自动 load 刷新数据）
- `frontend/js/i18n.js` — 新增 `wb.analyze/reanalyze/analyzing/analyze_done` 中英文翻译

## 已完成：素材利用率优化 — 多用素材 + 长分片关键时刻（2026-06-09）

两个方向优化素材利用率：Prompt 鼓励多用素材 + 长分片增加关键时刻描述。

**改动文件：**
- `backend/creative_prompt.txt` — 选片原则增强：每叙事 3-8 个镜头（原 2-5）；鼓励多用不同 segment（如 704 片段至少用 100+）；长片段参考 highlights 截取精华
- `backend/blueprints/creative.py` — 取消 visual 描述 100 字截断（发送完整描述）；segment 数据增加 highlights 字段
- `backend/video_prompt.txt` — 新增第 17 维度 `highlights`：超过 20 秒的分片标注 2-4 个关键时刻（time + desc），附带示例
- `backend/db.py` — media_segment 表新增 `highlights` 列 + 迁移
- `backend/blueprints/analysis.py` — INSERT 增加 highlights 字段；`_segment_to_dict` 解析 highlights JSON

**注意：** 已有分片的 highlights 为空，需重新分析才能生成。新分析的素材会自动包含 highlights。

## 已完成：AI 子片段截取 — 提升素材利用率（2026-06-09）

AI 可以指定 segment 的子区间（src_start/src_end），不用整个 segment 从头用到尾。这样同一个长 segment 的不同部分可以分别用于多个镜头，大幅提升素材利用率。

**改动文件：**
- `backend/creative_prompt.txt` — shot schema 新增 `src_start`/`src_end` 可选字段；选片原则增加"充分利用素材"指引（截取 3-15 秒精华片段，同一 segment 不同子区间可复用）
- `backend/blueprints/creative.py` — 组装逻辑读取 shot 的 `src_start`/`src_end`（有则用，无则用完整 segment）；时长从截取区间计算而非完整 segment

## 已完成：轨道顺序调整 — 叙事线移至主旨线下方（2026-06-09）

轨道自上而下顺序调整为：主旨线 → 叙事线 → 情绪线 → 旁白线 → 字幕线 → 视频线（叙事线从第5位移至第2位，紧跟主旨线）。

**改动文件：**
- `frontend/js/workbench.js` — `trackTypes` 数组顺序调整：text 移到 emotion 之前
- `docs/inspiration.md` — 轨道顺序文字 + ASCII 图示更新
- `docs/PRD_CREATIVE_WORKBENCH.md` — 两处 ASCII 图示轨道顺序更新

## 已完成：文字线 → 叙事线 — 概念升级 + 四层创作流程（2026-06-09）

将"文字线"重定义为"叙事线"，建立三层结构：主旨（章节）→ 叙事（段落）→ 分镜（句子）。Prompt 增加四层创作流程（立意→叙事→选片→串联）。JSON Schema 从 `acts → shots` 改为 `acts → narratives → shots`。

**改动文件：**
- `backend/creative_prompt.txt` — 创作原则重写为四层流程（立意→叙事→选片→串联）；JSON Schema 改为三层嵌套（`acts[].narratives[].shots[]`）；每个 narrative 有 `text` 字段（叙事段落文字）；`narration` 字段定位调整为"烘托情绪的旁白文案"
- `backend/blueprints/creative.py` — 组装逻辑改为三层遍历（acts → narratives → shots）；叙事线条目改为 per-narrative（跨多个 shot，时长覆盖整组镜头）；video metadata 增加 `narrative_id`
- `frontend/js/i18n.js` — `"文字线"` → `"叙事线"`，`"Text"` → `"Narrative"`
- `docs/PRD_AI_CREATIVE.md` — 更新组装规则映射表（三层结构）+ 伪代码重写
- `docs/PRD_CREATIVE_WORKBENCH.md` — 轨道描述改为叙事线 + ASCII 图示更新
- `docs/TECH_DESIGN.md` — 技术映射更新为三层结构
- `docs/inspiration.md` — 轨道名称和描述全部更新

**DB key `track_type='text'` 保持不变**，仅 UI 标签改名，避免数据迁移。

**三层结构：**
- 主旨（act）= 章节：每幕一个条目，跨多个叙事段落
- 叙事（narrative）= 段落：一组连贯的镜头（2-5个），有独立的叙事文字
- 分镜（shot）= 句子：单个视频片段，有旁白、情绪、转场

**四层创作流程：**
1. 立意：创意描述 + 素材分析 → 确定主旨（幕结构）
2. 叙事：主旨细化 → 每幕拆分为叙事段落（连贯表述）
3. 选片：叙事 + 时间线 + 用户偏好 → 选择匹配的 segment
4. 串联：情绪弧线 + 编排设计 → 撰写旁白 + 设计转场

## 已完成：分片拖放限制 + 拖拽预览图（2026-06-08）

素材分片只能拖放到视频轨道，拖拽时显示缩略图预览。

**改动文件：**
- `frontend/js/workbench.js` — `onSegDragStart` 新增 `_extDragType = 'segment'` 标记和自定义拖拽预览图（`setDragImage` 80×50px 缩略图）；`onMatDragStart` 新增 `_extDragType = 'media'`；`onTrackDragOver` 非视频轨道对 segment 直接 return（不调 `e.preventDefault()`，浏览器显示禁止光标）；`onTrackDrop` 非视频轨道对 segment 直接 return；`onTrackDrop` 结束时清理 `_extDragType`

## 已完成：时间线拖放闪动修复（2026-06-08）

素材片段拖放到时间线时，主视频时间线闪动、片段间空隙跳动。

**根因：**
1. **HTML5 `dragleave` 子元素穿透**：`@dragleave="clearDragShift()"` 在鼠标移入子元素（.wb-track-item）时也触发父元素的 dragleave，导致每次经过一个片段就清除所有 transform，再由 dragover 重新设置 → 持续清除/重设循环 = 频繁抖动
2. `onTrackDragOver` 每次都调用 `clearDragShift()` 清除**所有轨道**的所有项，远超必要范围
3. 拖拽过程中使用 CSS transition `0.15s ease`，配合高频 dragover 事件（~60次/秒）形成不完整动画 → 视觉抖动
4. `_normalizeVideoTrack()` 无条件重写所有项触发响应式级联；空 deep watcher 增加开销；`timelineDuration` 不稳定

**改动文件：**
- `frontend/js/workbench.js` — 新增 `onTrackDragLeave(e)` 替代 `@dragleave="clearDragShift()"`，用 `relatedTarget` 判断是否真正离开轨道；`onTrackDragOver` 重写为定向更新（只改 transform 变化的项，不用 transition）；`onTrackDrop` 视频轨道修复：计算 dropSec 和 insertIdx，在正确位置 splice 插入新片段而非 push 到末尾，`_normalizeVideoTrack()` 自动重排位置并联动其他轨道；移除空 deep watcher；`_normalizeVideoTrack()` 加 guard；`timelineDuration` 取整稳定；`clearDragShift()` 重置 `_lastDragLane`

## 已完成：时间线拖拽动画 + 右键菜单 + 快捷键（2026-06-07）

时间线编辑交互增强：拖拽/缩放实时动画、右键删除菜单、Delete/Backspace 快捷键、片段拖放到时间线的插入动画。

**改动文件：**
- `frontend/js/workbench.js` — `_handleDragMove()` 增加 reorder 动画（拖拽时兄弟元素移位显示插入空隙）和 resize push 动画（右边缘拖拽时后续所有轨道块平移）；`onTrackDragOver()` 新增外部拖放插入动画（片段从素材面板拖入时后续块让出空隙）；`clearDragShift()` 清除所有动画 transform；`onTrackItemContext()` 右键菜单（Quasar q-menu context-menu）；`_onWbKey` 增加 Delete/Backspace 删除快捷键；`onSegDragStart/onMatDragStart` 存储 `_extDragDur` 供拖放动画使用
- `frontend/js/i18n.js` — 新增 `wb.ctx_delete` 中英文翻译
- `frontend/css/main.css` — 无额外 CSS（动画通过 JS inline style + transition 实现）

**功能说明：**
- Reorder 动画：向后拖时，中间的块前移让出空隙；向前拖时同理
- Resize push 动画：右边缘拖长时，后续所有轨道块实时平移
- 拖放插入动画：从素材面板拖片段到时间线时，后续块让出空隙
- 右键菜单：轨道项右键弹出「删除」选项
- Delete/Backspace：选中轨道项后按键盘删除

## 已完成：视频轨道编排重构 — 左对齐 + Resize + Reorder（2026-06-07）

视频轨道时间线位置改为派生数据（数组顺序 + srcEnd-srcStart），resize 更新源视频截取范围，reorder 使用数组顺序而非 time_start 排序。

**改动文件：**
- `frontend/js/workbench.js` — 新增 `_getVideoDur()` 辅助函数（从 metadata.srcEnd-srcStart 取时长，fallback 到 time_end-time_start）；`_normalizeVideoTrack()` 重写（用数组顺序而非 time_start 排序、用 srcEnd-srcStart 算时长）；`_handleDragEnd()` resize 模式重写（视频轨道更新 metadata.srcStart/srcEnd，受源视频边界约束；其他轨道更新 time_start/time_end）；`trackSplit()` 更新（视频轨道分割 srcStart/srcEnd）；`onTrackDrop()` 简化（视频轨道只设 metadata，归一化自动处理位置）；`addTrackItem()` 更新（视频轨道设默认 srcStart/srcEnd）

**设计原则：**
- 视频轨道 `time_start/time_end` 是派生数据——由数组顺序 + `metadata.srcEnd - srcStart` 计算
- Resize 更新 `srcStart/srcEnd`，受源视频边界约束（≥0, ≤duration）
- Reorder 改变数组顺序，归一化用数组顺序
- 其他轨道独立存储 `time_start/time_end`，可与视频项联动
- `segment_id` 保留为原始分析数据引用（重新分析后可能断，不影响播放）
- 所有文本内容独立存储在 `content` 列

## 已完成：LLM 分片时间重叠修正（2026-06-06）

LLM 返回的分析分片（media_segment）在时间上可能重叠，保存前自动修正：按 start_time 排序后，若后一分片的 start < 前一分片的 end，则将后一分片的 start 设为前一分片的 end，逐级顺延，确保无间隙无重叠。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `_ts_to_seconds()` 辅助函数（HH:MM:SS.ss → 秒数）；新增 `_fix_segment_overlaps()` 函数（按时间排序 + 级联修正重叠 start_time）；`save_segments()` 在插入前调用 `_fix_segment_overlaps(segments)`

**功能说明：**
- 所有轨道（视频/情绪/旁白/字幕/主题/文字）共用同一份 `media_segment` 时间戳，修正在源头，下游无需改动
- 创意向导 `apply_plan()` 读取的 segment 时间已无重叠，`srcStart`/`srcEnd` 直接可用
- 修正后分片严格连续：`segments[i].time_start == segments[i-1].time_end`

## 规划中：AI 创意引导器 Phase 2

### Phase 2：智能交互增强
- [ ] 单段落 AI 重新生成
- [ ] AI 推荐替换镜头
- [ ] 大纲面板段落拖拽重排
- [ ] 情绪弧线可视化编辑
- [ ] AI 补充/精简段落

### Phase 3：高级功能
- [ ] 参考视频解构
- [ ] 自定义模板保存
- [ ] 多方案对比
- [ ] 版本分支
- [ ] 导出创意简报

## 已完成：合并构思与编排 + Ctrl+A 全选 + 项目创建推迟（2026-06-03）

合并侧边栏「构思」和「编排」为一个统一项目列表，新增 Ctrl+A 全选素材，项目创建推迟到引导器最后一步。

**改动文件：**
- `backend/blueprints/workbench.py` — `GET /api/workbench/` 去掉 `creative_brief IS NULL` 过滤，返回所有项目
- `backend/blueprints/library.py` — 新增 `POST /api/library/segment-stats`（接受 media_ids 数组，无需项目即可查询片段统计）；新增 `_parse_seg_time` helper
- `backend/blueprints/creative.py` — `get_stats` 新增 `video_count` / `image_count` 字段
- `frontend/index.html` — 侧边栏合并为一个「构思」板块（`projectList`），删除「编排」板块及其新建工程弹窗；`openNewCreativePlan()` 不再预创建项目；`wizardEditProjectId` data 支持工作台编辑模式
- `frontend/js/creative-wizard.js` — 移除 `projectId` prop，新增 `editProjectId` prop；`loadStats()` 改用 `API.getSegmentStats()`；`startGenerate()` 区分新建和编辑模式，新建时才创建项目；新增 `skipAndCreate()` + 每步 footer「跳过并创建」按钮；新增 `loadEditProject()` 预加载已有项目；名称输入移入第6步确认区；选完素材自动跳第2步；引导器改为 90% 尺寸；stats 显示视频数/图片数
- `frontend/js/workbench.js` — 工具栏新增「AI 构思」按钮 + `openWizard()` 方法唤起引导器编辑模式
- `frontend/js/gallery.js` — 新增 Ctrl+A 全选：`_buildParams()` 提取共享筛选逻辑，`selectAll()` 调 `getLibraryIds` 一次拿所有匹配 ID，`deselectAll()` 清空，再次 Ctrl+A 反选
- `frontend/js/api.js` — 新增 `getSegmentStats(mediaIds)` 和 `getLibraryIds(params)`
- `frontend/js/i18n.js` — 新增 wb 工具栏/错误/搜索、g 后台任务状态、cg 音乐风格/生成失败/跳过/统计等 i18n key（中英文各约 30 个）
- `frontend/css/main.css` — `.cg-wizard-card` 高度改为 100%；新增 `.cg-stats-inline` 样式
- `frontend/js/duplicates.js` — `onLassoMove` 中 `const t` 改名 `top`

**功能说明：**
- 侧边栏只有一个项目列表，图标根据是否有 AI 方案区分（auto_awesome / dashboard）
- 「新建构思」直接弹出素材选择器，不再预创建项目，中途关闭无垃圾数据
- 引导器每步可「跳过并创建」快速创建空项目进入工作台
- 工作台工具栏「AI 构思」按钮可重新唤起引导器，预填已有素材，重新 AI 生成
- Ctrl+A 全选匹配当前筛选条件的所有素材（不限已加载数量）
- stats 统计不依赖项目，直接查 media_segment

## 已完成：i18n 硬编码修复 + 基本错误修复（2026-06-02）
- `frontend/js/i18n.js` — 新增 30+ 个 i18n key（wb 搜索/列/工具栏/错误、g 后台任务状态、cg 音乐风格/生成失败）；清理重复 `wb.media_selected` key
- `frontend/js/creative-wizard.js` — `genSteps` 改用 `labelKey` + `t()`；`moodOptions`/`musicStyleOptions`/`tempoOptions` 改用 `labelKey`；错误消息改用 `t('cg.gen_fail')`；`loadSelectedInfo` 改为按 ID 逐个拉取（修复仅拉前 200 条的问题）；`<cg-stats-panel>` 替换为内联渲染
- `frontend/js/workbench.js` — 搜索 placeholder、列标签、全屏/示波器 tooltip、工具栏按钮 tooltip（撤销/重做/分割/删除/缩放）、错误通知全部改用 `t()` 调用
- `frontend/js/api.js` — 默认错误消息改用 `t('g.request_fail')`；`importBatch`/`syncFolder` 增加 HTTP 错误检查
- `frontend/js/duplicates.js` — `onLassoMove` 中 `const t` 改名 `top`，避免遮蔽 i18n `t()`
- `frontend/index.html` — 后台任务轮询状态标签改用 `t()` 调用；修复 `for (const t of tasks)` 遮蔽 i18n `t()` 导致恢复任务时报错
- `frontend/css/main.css` — 新增 `.cg-stats-inline` 样式

**修复的错误：**
1. **[高] index.html `t` 变量遮蔽**：`for (const t of tasks)` 遮蔽了全局 `t()` 函数，导致恢复后台任务时 `stageLabel` 为 undefined 并抛出运行时错误
2. **[高] cg-stats-panel 组件未定义**：引导器第3-5步使用 `<cg-stats-panel>` 但组件从未注册，统计信息不显示。替换为内联渲染
3. **[中] api.js SSE 端点无错误处理**：`importBatch`/`syncFolder` 用原始 `fetch()` 跳过 `_fetch` 错误检查，服务端返回 4xx/5xx 时静默失败
4. **[中] loadSelectedInfo 仅拉前200条**：选中的素材如果不在前 200 条结果中，引导器第1步不显示已选素材。改为按 ID 逐个拉取
5. **[低] duplicates.js `t` 变量遮蔽**：套索选择 `onLassoMove` 中 `const t` 遮蔽 i18n 函数（当前无报错，潜在风险）

## 已完成：引导器第1步复用全局素材选择器（2026-06-02）

引导器第1步改为自动弹出全局素材选择器（90%弹窗），选中后返回引导器显示已选素材摘要。

**改动文件：**
- `frontend/js/creative-wizard.js` — `<q-dialog v-if="!pickerOpen">` 在 picker 打开时销毁引导器避免遮挡；watch `show` 时 `$nextTick(() => this.openPicker())` 自动弹出；`openPicker()` 设置 `pickerOpen=true`，callback 重置；取消选择也通过 callback 正常返回
- `frontend/index.html` — `cancelPicker()` 增加 `_pickerCallback` 调用，确保用户取消 picker 后引导器正常恢复

## 已完成：AI 创意引导器 Phase 1 — 侧边栏 + 数据模型 + 引导器骨架（2026-06-01）

侧边栏新增「构思」板块，后端 creative 蓝图 API，前端 5 步引导器组件骨架。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `creative_brief`、`ai_plan` 两列；`_migrate()` 新增 `projects` 表列检查
- `backend/blueprints/creative.py` — **新建**：创意引导器 API 蓝图（7 个端点：CRUD + brief 更新 + 素材统计 + AI 生成 SSE + 方案应用）
- `backend/__init__.py` — 注册 creative 蓝图（`/api/creative`）
- `backend/creative_prompt.txt` — **新建**：AI 导演 Prompt 模板（角色定义 + 创作原则 + 输入输出 Schema）
- `frontend/js/api.js` — 新增 7 个 creative API 方法
- `frontend/js/creative-wizard.js` — **新建**：5 步引导器组件（选模板→叙事结构→情绪弧线→声音设计→确认生成），含 SSE 流式进度展示
- `frontend/js/i18n.js` — 新增 `cg.*` 翻译键（中英文各约 80 个）
- `frontend/index.html` — 侧边栏插入「构思」板块（between 浏览 and 编排）；新增 creative-wizard 对话框；`openNewCreativePlan()` 弹窗输入名称→创建项目→打开引导器；`loadCreativePlans()`/`onCreativeDone()` 方法；`creativePlans`/`showCreativeWizard`/`wizardProjectId` 数据
- `frontend/css/main.css` — 新增 `.cg-*` 引导器样式（模板卡片、选项芯片、弧线选择、确认摘要、生成进度等）

**功能说明：**
- 侧边栏三个板块：浏览 → 构思 → 编排
- 「新建构思」按钮 → 弹窗输入名称 → 创建项目 → 打开 5 步引导器
- 引导器收集创作意图（模板/结构/弧线/声音/确认），每步可查看素材统计
- 确认后 SSE 流式调用大模型生成方案，自动组装时间线
- 生成完成后跳转到工作台页面
- 构思项目同时出现在「构思」和「编排」列表中

## 已完成：工作台时间线工具栏（2026-05-31）

时间线上方新增工具栏，包含播放控制、编辑操作、缩放和添加轨道功能。

**改动文件：**
- `frontend/js/workbench.js` — 新增 track toolbar 模板（播放控制：跳到开头/播放暂停/跳到结尾/倍速选择；编辑：撤销/重做/分割/删除；缩放：缩小/滑块/放大/适配宽度；添加轨道菜单）；`trackPlaying`/`trackSpeed`/`trackZoom`/`trackCanUndo`/`trackCanRedo`/`trackSelectedItem` 数据；`trackTogglePlay`/`trackSkipStart`/`trackSkipEnd` 联动视频播放器；`trackSpeed` watch 同步 `playbackRate`；`trackZoom` 缩放轨道内容（scaleX + minWidth）；`_trackSnapshot`/`trackUndo`/`trackRedo` 撤销重做栈；`trackSplit` 分割轨道项（中点切分）；`trackDelete` 删除选中项；`addTrack(type)` 添加空轨道；轨道项点击选中高亮
- `frontend/css/main.css` — `.wb-track-toolbar` 工具栏样式（flex + gap 8px + border-bottom）；`.wb-track-item.selected` 选中态（accent outline）

**功能说明：**
- 播放控制联动预览区视频播放器（跳到开头/结尾、播放/暂停、倍速 0.5x-2x）
- 缩放滑块 1-10x，通过 scaleX 放大轨道内容并可横向滚动
- 撤销/重做栈（JSON 快照），编辑操作自动入栈
- 分割：将选中轨道项从中点一分为二
- 删除：移除选中轨道项
- 添加轨道：下拉菜单选择轨道类型（主题/情绪/旁白/字幕/文字/视频）
- 所有修改通过 `API.updateProjectTracks` 持久化

## 已完成：UI 主题统一 + 列表视图优化 + 目录树样式（2026-05-29）

全局 UI 控件统一跟随主题色，列表视图列名和颜色标签修复，目录树改为 VS Code 风格竖线缩进。

**改动文件：**
- `frontend/css/main.css` — 移除所有硬编码颜色值，改为 CSS 变量（`--accent`、`--accent-dim`）；新增 `.sidebar-active-item`（accent-dim 背景 + accent 文字）；`.media-row .color-dot` 改为 `position: static; display: inline-block`；`.grid-compact .media-card .info { display: none }`（50% 缩放隐藏卡片文字）；`.q-tree__children { padding-left: 9px; border-left: 1px solid var(--border); margin-left: 13px }` VS Code 风格竖线；叶节点 `padding-left: 22px` 箭头占位；统一 hover/selected 高亮到 `q-tree__node-header`；`.media-card { content-visibility: auto }` 渲染优化
- `frontend/js/gallery.js` — 视图模式按钮 active 色改为 `var(--accent)`；footer 滑块 `style="--q-primary:var(--accent)"` 跟随主题；列表视图标记列宽 110px；50% 缩放添加 `grid-compact` class；文件夹筛选标签显示完整路径；`_checkFill()` + `requestAnimationFrame` 自动加载更多（小缩放时内容不填满容器时触发）
- `frontend/js/i18n.js` — `g.col_rating` 改为"标记"
- `frontend/js/folder-tree.js` — 移除内联 padding/margin/background，统一到 CSS；移除自动展开 watch，默认折叠
- `frontend/index.html` — 侧边栏三个子项使用 `active-class="sidebar-active-item"`；目录树 padding-left 从 28px 改为 16px（与浏览标题对齐）；文件夹根目录与素材库菜单对齐
- `backend/config.py` — 新增 `ANALYSIS_API_CONCURRENCY = 2` 和 `ANALYSIS_THREAD_POOL_SIZE = 5`
- `backend/blueprints/analysis.py` — 从 config 导入并发参数替代硬编码

**功能说明：**
- 所有 UI 控件（筛选栏选中态、侧边栏、footer 滑块、工作台按钮）统一跟随用户选择的主题色
- 列表视图"评分"列改名为"标记"，列宽加至 110px，颜色标签位置修复
- 目录树：VS Code 风格淡色竖线缩进，叶节点箭头位置占位，选中与悬浮高亮区域统一，默认折叠不展开
- 侧边栏浏览子项与"浏览"标题左对齐，文件夹根目录与"素材库"对齐
- 50% 缩放隐藏卡片文字（紧凑模式），文件夹筛选标签显示完整路径
- 分析并发参数（VLM API 信号量 2、线程池 5）移至 config.py 集中配置

## 已完成：工作台素材面板改版（2026-05-29）

工作台素材面板从 segment 列表改为以完整视频（media）为单位展示，新增搜索、类型筛选、排序功能。

**改动文件：**
- `frontend/js/workbench.js` — data 改为 `selectedMedia`/`activeSeg`/`matSearch`/`matType`/`matSort`；computed `filteredMedia()` 应用类型筛选和排序；`searchMedia()` 调用后端 FTS 搜索；`mediaSegments(mediaId)` 筛选指定 media 的 segments；`fmtDur(sec)` 时长格式化（M:SS 或 H:MM:SS）；素材面板模板改为双列网格卡片（封面 + 渐变叠加信息层）；预览区显示视频播放器 + segment 列表
- `backend/blueprints/workbench.py` — `get_project` 新增 `q` 参数，通过 FTS5 搜索 media（复用 `_segment_query`），SELECT 新增 `m.date_taken` 支持排序
- `frontend/js/api.js` — `getProject(id, q)` 支持 search 参数
- `frontend/js/i18n.js` — 新增 `wb.*` 翻译键（搜索/类型/排序/无匹配等）
- `frontend/css/main.css` — `.wb-mat-toolbar` 一行紧凑布局；`.wb-mat-search`/`.wb-mat-sort` 高度 26px；`.wb-mat-grid` 双列网格；`.wb-mat-card`/`.wb-mat-thumb`/`.wb-mat-overlay` 封面卡片样式

**功能说明：**
- 素材面板以完整视频为单位（缩略图 + 文件名 + 时长 + 片段数），双列网格布局
- 工具栏一行紧凑排列：搜索框 + 类型筛选 + 排序下拉（高度 26px）
- 搜索走后端 FTS5（支持文件名 + 分析内容模糊搜索，jieba 中文分词）
- 支持按类型筛选（全部/视频/图片）、按名称/时长/拍摄时间排序
- 点击视频卡片预览播放，下方显示该视频的所有 segments
- 时长显示 HH:MM:SS 格式

## 已完成：工作台媒体选择器 — 90% 对话框方案（2026-05-27）

工作台"添加素材"改为 90% 屏幕对话框（90vw x 90vh），内嵌完整 Gallery 页面，独立文件夹处理器避免 hash 变更和无限请求。

**改动文件：**
- `frontend/index.html` — 新增 `q-dialog` 媒体选择器（persistent，fade 过渡），内含 picker-bar（关闭/标题/已选计数/确认按钮）+ picker-body（左侧文件夹树 + 右侧 gallery-page 组件）；新增 `pickerFolderSelect()` 方法独立处理文件夹选择（仅更新 selectedFolder + 触发 pickerGallery.load()，不触发 hash 变更）；新增 `cancelPicker()`/`confirmPicker()` 方法；新增 `pickerMode`/`pickerProjectId`/`pickerSelected` 数据
- `frontend/js/workbench.js` — `openMediaPicker()` 设置 root 数据并打开对话框
- `frontend/css/main.css` — 新增 `.picker-dialog-card`（90vw x 90vh，flex column）、`.picker-bar`（42px 顶部栏）、`.picker-body`（flex row）、`.picker-sidebar`（220px）、`.picker-gallery`、`.picker-check`（卡片复选框覆盖层）样式

**设计要点：**
- 文件夹树使用 `pickerFolderSelect` 而非共享的 `onFolderSelect`，避免触发路由 hash 变更和无限请求
- 嵌入完整 `gallery-page` 组件复用所有筛选/排序/视图功能，每张卡片叠加选择复选框
- 对话框 persistent（点击背景不关闭），fade 过渡动画

## 已完成：创作工作台 Phase A — 工程管理 + 工作台骨架（2026-05-27）

创作工作台基础架构：后端工程 CRUD API、侧边栏"编排"导航、新建工程弹窗、工作台页面骨架（6 轨时间线 + 素材面板）。

**改动文件：**
- `backend/db.py` — `_SCHEMA` 新增 `projects`、`project_media`、`project_tracks` 三张表及索引
- `backend/blueprints/workbench.py` — **新建**：工程 CRUD（GET/POST/PATCH/DELETE）、获取工程 segments（join project_media → media_segment）、获取/批量替换 tracks、替换 media 集合
- `backend/__init__.py` — 注册 workbench blueprint（`/api/workbench`）
- `frontend/js/api.js` — 新增 9 个 workbench API 方法
- `frontend/js/i18n.js` — 新增 `wb.*` 翻译键（中英文各 ~25 个）
- `frontend/js/workbench.js` — **新建**：`WorkbenchPage` 组件，props `projectId`，加载工程/segments/tracks，渲染素材面板 + 6 轨时间线
- `frontend/index.html` — 侧边栏新增"编排"区域（工程列表 + 新建按钮）、路由 `#/workbench/:id`、新建工程弹窗（名称/描述/素材选择）、重命名/删除弹窗、右键菜单
- `frontend/css/main.css` — 新增 `.wb-*` 工作台样式（容器/工具栏/素材面板/轨道/状态栏）

**功能说明：**
- 侧边栏"浏览"区域下方新增"编排"区域，列出所有工程，按最近更新排序
- 点击"+ 新建工程"打开弹窗：输入名称、描述、从素材库勾选已分析的素材
- 创建后自动跳转工作台页面，显示左侧素材面板（所有 segment）+ 右侧 6 条空轨道
- 工程支持右键菜单重命名/删除
- API 支持：工程 CRUD + 获取 segment + 获取/批量替换轨道 + 替换 media 集合

**待开发（Phase B-E）：**
- [ ] Phase B：拖拽 segment 到视频线 + 轨道内重排 + 删除
- [ ] Phase C：情绪线手动标注 + SVG 曲线渲染
- [ ] Phase D：其他轨道编辑（主题/旁白/文字/字幕）
- [ ] Phase E：EDL 导出

## 已完成：批量AI分析 + 三态筛选 + 筛选/任务持久化 + HIF支持 + UI优化（2026-05-22）

批量 AI 分析从画廊发起，三态筛选支持未喜欢/未分析，筛选条件和后台任务刷新后持久化，HIF 图片格式支持。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `POST /api/analysis/batch` 端点（接收 ID 数组 + skip_done 策略，复用 `_analysis_pool` 线程池提交）；`_analysis_lock` 替换为 `Semaphore(1)` 信号量（VLM API 调用串行，压缩/ASR 并行）；processing 状态防重复提交；`/api/analysis/progress` 返回 `file_name` 字段
- `backend/blueprints/library.py` — `list_media` 新增 `favorite=false` 和 `analysis_status=not_analyzed` SQL 筛选
- `backend/config.py` — 新增 `HEIF_EXTS`（.heic/.heif/.hif/.avif），从 `RAW_EXTS` 排除
- `backend/compressor.py` — 新增 HEIF 解码路径（`pillow-heif`）
- `backend/analyzer.py` — 图片分析流式 chunk 日志从 debug 降为 trace
- `backend/asr/engines/whisper.py` — 新增 `preload()` 方法含完成日志
- `frontend/js/gallery.js` — 右键菜单新增"AI 分析"；`openBatchAnalysisDialog()` 获取设置显示模型/数量/已分析策略；`confirmBatchAnalysis()` FLIP 动画；`batchAnalyze()` 调用批量接口 + 注册 bgTasks；三态筛选 `cycleFavFilter()`（null→fav→unfav）和 `cycleAnalysisFilter()`（null→analyzed→not）；`activeFilterTags` 计算属性返回标签数组；footer 显示筛选标签；localStorage 持久化所有筛选/排序/视图状态；`created()` 恢复筛选 + 同步 `$root.searchQuery`
- `frontend/js/api.js` — 新增 `startBatchAnalysis(ids, skipDone)` 和 `getProgress()` 方法
- `frontend/js/detail.js` — SSE done/error 回调用 `root.bgTasks = [...root.bgTasks]` 触发 Vue 响应式
- `frontend/js/i18n.js` — 新增翻译：ctx_analyze/n、batch_analysis 系列标题、fav_filter/unfav_only/analysis_filter/not_analyzed_only/filter_unfav/filter_not_analyzed 等
- `frontend/index.html` — bgTasks 进度条改为自定义 div（var(--accent) 色）+ "done/total" 标签 + 24px Lottie；`created()` 恢复 bgTasks（调 `getProgress()`）；`created()` 恢复 `selectedFolder`（localStorage）；`watch: selectedFolder` 自动持久化；`resolveRoute()` 默认分支不清除已恢复的 folder；`loadSidebar()` 展开恢复 folder 的祖先路径；bgTasks 过滤 placeholder 的 computed 属性
- `frontend/css/main.css` — `.bg-task-bar/lottie/progress` 进度条样式；`.header-tag` footer 筛选标签样式；`.filter-icon-off` CSS 伪元素斜杠（45° 旋转，box-shadow 穿透效果，暗色 #555/亮色 #bbb）
- `electron/main.js` — 初始宽度从 1400 改为 1600

**功能说明：**
- 画廊右键菜单支持单个/多个素材批量 AI 分析，确认弹窗显示模型、数量、已分析策略
- 确认后 FLIP 动画从弹窗缩放到 header 进度条位置
- 后端信号量控制并发（API 调用串行，压缩/ASR 可并行），processing 状态防止重复提交
- 喜欢/分析筛选扩展为三态（全部/已喜欢/未喜欢、全部/已分析/未分析），CSS 伪元素斜杠标识"排除"语义
- Footer 居中显示当前所有筛选条件标签（文件夹/类型/评分/颜色/喜欢/分析/搜索）
- 所有筛选条件、排序、视图、文件夹选择 localStorage 持久化，刷新页面完整恢复
- 后台分析任务刷新页面后从后端 `/api/analysis/progress` 恢复进度
- HIF/HEIF 图片通过 `pillow-heif` 解码分析，日志降噪
- ASR 模型预加载完成时打印耗时日志

## 已完成：loguru 统一日志 + 图片分析维度扩展 + UI 修复（2026-05-20）

全后端迁移至 loguru 日志系统，图片分析新增 3 个专属维度，前端分析结果 UI 优化。

**改动文件：**
- `backend/logger.py` — **新建**：loguru 日志配置，文件输出至 `{DATA_DIR}/logs/app.log`，按天轮转保留 7 天，同时输出到终端；Werkzeug HTTP 日志静默（WARNING 级别）
- `backend/__init__.py` — 启动时调用 `setup_logging()` 初始化日志；新增 ASR 预加载逻辑（仅本地引擎）
- `backend/analyzer.py` — `print`/`logging` 全部替换为 `loguru.logger`；流式 chunk 调试日志用 `repr()` 包裹；图片分析结果完整 JSON 输出；修复 `ensure_ascii=False` 缺失
- `backend/analyzer.py` — 全部 `print`/`logging` 替换为 loguru
- `backend/asr/__init__.py` — `logging` 替换为 loguru
- `backend/asr/engines/whisper.py` — `logging` 替换为 loguru；`preload()` 直接加载不再额外开线程，加载完成打日志含耗时
- `backend/blueprints/analysis.py` — `logging` 替换为 loguru；`_SEGMENT_COLS` 新增 `color_tone, tone, dof, style, composition`；INSERT 扩展至 23 列；`_EDITABLE_COLS` 新增 5 个字段；修复 `ensure_ascii=False` 缺失；分析弹窗模型显示区分图片/视频
- `backend/blueprints/library.py` — `logging` 替换为 loguru
- `backend/blueprints/serve.py` — `logging` 替换为 loguru
- `backend/blueprints/tags.py` — `logging` 替换为 loguru
- `backend/compressor.py` — `print` 替换为 loguru
- `backend/config.py` — 新增 `LOG_DIR`
- `backend/db.py` — `media_segment` 表 schema 新增 `color_tone, tone, dof, style, composition` 列；`_MIGRATIONS` 新增对应迁移项；`_migrate()` 改为检查 `media` 和 `media_segment` 两张表
- `backend/services/embedding.py` — `logging` 替换为 loguru
- `backend/services/importer.py` — `logging` 替换为 loguru
- `backend/services/xmp_writer.py` — `logging` 替换为 loguru
- `backend/img_prompt.txt` — 枚举格式与 video_prompt.txt 对齐；`shot_type` 扩展；`mood` 新增壮丽/孤独/怀旧/梦幻；`weather` 新增多云；`scene_type` 新增晨昏/星空；`style` 扩展至 15 项；新增 `color_tone`（色调）、`tone`（影调）、`dof`（景深）3 个图片专属维度
- `backend/video_prompt.txt` — `mood`/`weather` 枚举与 img_prompt 对齐；`scene_type` 新增晨昏；`weather` 移除晨昏
- `frontend/js/detail.js` — 新增 `styleFields` 数组和 🎨 风格化 dim-row 分组；`dimRowStyle(seg)` 辅助方法；分析弹窗模型根据 media_type 区分 image_model/model；auto-scroll 修复（Quasar `setScrollPosition` 三参数）；颜色/主体标签图标拆分为独立 span（🌈/🏷️）
- `frontend/js/i18n.js` — 新增翻译：`d.dim.color_tone`、`d.dim.tone`、`d.dim.dof`、`d.dim.style`、`d.dim.composition`；颜色/主体标签移除内嵌 emoji
- `frontend/css/main.css` — 风格化维度颜色（`.dim-value.color/.tone/.dof/.style/.comp`）；`.array-label.icon-label` + `.label-icon` 图标间距控制
- `frontend/index.html` — `onLanguageChange` 方法实现语言切换即时生效

**功能说明：**
- loguru 统一全后端日志，文件按天轮转保留 7 天，终端同步输出，Werkzeug HTTP 日志静默
- 图片分析新增色调、影调、景深 3 个专属维度（共 16 维）
- 风格(style)和构图(composition)字段完整链路存储（DB→后端→前端）
- 前端分析结果新增 🎨 风格化独立分组，与 🌍 场景分组并列
- 修复：auto-scroll、语言切换即时生效、分析弹框模型显示、ensure_ascii 缺失、composition 字段丢失

## 已完成：i18n 国际化 + 设置页重构（2026-05-19）

新增中英文国际化支持，设置页面重构为标签页布局。

**改动文件：**
- `frontend/js/i18n.js` — **新建**：轻量 i18n 模块，`t(key, params)` 翻译函数 + `Vue.reactive` 响应式 locale 状态；翻译键按前缀分组（`g.*` 通用、`d.*` 详情、`dup.*` 重复、`s.*` 设置、`side.*` 侧边栏、`imp.*` 导入、`kb.*` 快捷键等）；回退链：当前 locale → zh → key 本身
- `frontend/index.html` — 设置弹窗从手风琴分区改为标签页（通用/图片/视频/音频 4 个标签）；通用标签新增语言选择器（中文/English）；所有 UI 文案改为 `t()` 调用；`<script>` 引入 `i18n.js`
- `frontend/js/gallery.js` — 所有硬编码中文文案替换为 `t()` 调用（筛选标签、通知、右键菜单等）
- `frontend/js/detail.js` — 所有 UI 文案替换为 `t()` 调用（元数据标签、分析维度、按钮、通知等）
- `frontend/js/duplicates.js` — 所有 UI 文案替换为 `t()` 调用（标签页标题、按钮、通知等）
- `frontend/css/main.css` — minimap 视口矩形背景色改为 `var(--accent)` 主题色（原硬编码蓝色）
- `backend/db.py` — `_DEFAULTS` 新增 `language` 设置（默认 `zh`）
- `backend/blueprints/settings.py` — GET/POST 接口同步 `language` 字段

**功能说明：**
- 支持中文（默认）和英文两种语言
- 语言设置持久化到后端 settings 表，页面刷新后保持
- 设置页重新组织为 4 个标签页：通用（语言/主题/强调色）、图片、视频、音频
- 所有 UI 标签、工具提示、通知、对话框标题跟随语言设置
- Minimap 视口矩形背景色使用 accent 主题色，跟随用户选择的主题色变化

## 已完成：全屏看图 + 导航缩略图（2026-05-19）

图片详情页新增全屏看图功能和缩放导航缩略图。

**改动文件：**
- `frontend/js/detail.js` — 新增 `isFullscreen`/`imgNatW`/`imgNatH` 数据；`onImageLoaded` 记录图片自然尺寸；新增 `minimapRectStyle` 计算属性（根据 imgZoom/imgPanX/imgPanY 和容器尺寸计算视口矩形位置）；新增 `toggleFullscreen()` 方法（浏览器 Fullscreen API）；新增 `onMinimapClick()` 方法（点击 minimap 跳转到对应区域）；F 键从切换喜欢改为切换全屏；`created` 中注册 `fullscreenchange` 监听，`beforeUnmount` 中清理；imgContainer ref 添加 `.img-view-area` class
- `frontend/css/main.css` — 新增 `.img-view-area` 样式（flex 容器 + `:fullscreen` 背景色）；`.img-minimap` 导航缩略图样式（160px 宽、半透明、悬停增强）；`.img-minimap-rect` 视口矩形样式

**功能说明：**
- 放大图片 > 100% 时，右下角出现半透明导航缩略图，蓝色矩形显示当前视口位置
- 拖拽图片时矩形实时跟随，点击缩略图可跳转到对应区域
- 缩放条新增全屏按钮（`fullscreen` 图标），按 F 键切换全屏
- 全屏时 imgContainer 填充整个屏幕，只显示图片区域
- F 键原功能（切换喜欢）已移除快捷键

## 已完成：查找相似弹窗 + 画廊排除/删除（2026-05-19）

画廊右键"查找相似"不再跳转到重复页，改为在弹窗中直接展示与当前照片相似的结果（酷似/相似/聚类三个标签页），支持排除和删除操作。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `GET /<int:media_id>/similar` 端点：获取源图片 embedding，与所有图片计算余弦相似度，按阈值（酷似 0.96/相似 0.90）筛选并排除已排除的 pair，HDBSCAN 聚类取源图片所在聚类；返回 `{ source, near, similar, cluster }`
- `frontend/js/api.js` — 新增 `getSimilar(mediaId)` 方法
- `frontend/js/gallery.js` — `findSimilar()` 改为弹窗展示：头部显示源图片 + 三个标签按钮（与重复页样式一致），结果使用 `.dup-card` 网格；右键菜单支持查看详情、在文件夹中显示、排除、删除；排除弹窗复用排除模式（选择不相似的照片）；排除 pair 使用源图片 ID（`similarDlg.source.id`）；弹窗尺寸 `93vw × 92vh`
- `frontend/js/gallery.js` — 画廊右键菜单移除"写入 XMP"选项（仅保留在详情页）

**排除机制：**
- 弹窗中排除的照片对会写入 `dup_exclusions` 表（与重复页共享）
- 排除后该照片在对应类型（酷似/相似/聚类）中不再出现
- 可在重复页通过"恢复排除"功能取消排除

## 已完成：恢复排除功能（2026-05-19）

重复页每个分组新增"恢复排除"功能，用户可查看被排除的照片并选择性恢复。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `DELETE /dup-exclusions/pairs` 端点（按具体 pair 删除排除记录）；`find_duplicates` 返回数据中每个 group 附带 `excluded` 字段（被排除的照片 ID + file_name + excluded_with ID 列表），通过 `_attach_excluded()` 辅助函数实现
- `frontend/js/api.js` — 新增 `removeDupExclusionPairs(pairs, dupType)` 方法
- `frontend/js/duplicates.js` — 分组头右侧新增"恢复排除 (N)"按钮（仅在有排除记录时显示）；恢复排除弹窗按被排除照片分行，每行左侧显示被排除照片缩略图，中间显示其排除对象的小图标（可勾选），右侧"恢复排重"按钮；每行独立操作，恢复后该行消失
- `frontend/css/main.css` — `.restore-pair-thumb` 样式（40px 小图标，悬停放大 3.5 倍）

## 已完成：排除弹窗 UI 优化（2026-05-19）

重复页排除弹窗多项交互改进。

**改动文件：**
- `frontend/js/duplicates.js` — 排除弹窗新增"全选/取消全选"切换按钮；底部显示"共 X 张"计数；滚动提示"↓ 向下滚动查看更多"（候选 > 6 张时显示）
- `frontend/css/main.css` — `.exclude-scroll-wrap` 固定最大高度 300px + 滚动；`.exclude-scroll-hint` sticky 底部提示（暗色 `#1d1d1d` / 亮色 `#fff` 背景）

## 已完成：重复页卡片流式布局（2026-05-19）

重复页分组卡片从横向滚动改为 CSS Grid 自适应折行，撑满容器宽度。

**改动文件：**
- `frontend/js/duplicates.js` — 分组容器从 `display:flex;overflow-x:auto` 改为 CSS Grid class `.dup-grid`
- `frontend/css/main.css` — `.dup-grid` 使用 `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` 自动折行；`.dup-card` 在 grid 内 `width: auto`

## 已完成：文件夹移除和重新扫描（2026-05-19）

支持整个目录从库中移除，以及重新扫描目录（应对文件变化、移位、更名、子目录变更）。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `DELETE /api/library/folder` 端点（按路径前缀删除所有媒体记录及其缩略图）；新增 `POST /api/library/sync-folder` 端点（SSE 流：扫描目录 → 导入新文件 → 删除已移走文件 → 报告结果）
- `frontend/js/api.js` — 新增 `deleteFolder(path)` 和 `syncFolder(path)` 方法
- `frontend/js/gallery.js` / `frontend/index.html` — 文件夹树右键菜单新增"移除文件夹"和"重新扫描"

## 已完成：批量导入修复（2026-05-19）

修复批量导入多个问题：ThreadPoolExecutor 与 Flask 上下文冲突、SSE 流数据库连接关闭、embedding JSON 序列化失败。

**改动文件：**
- `backend/blueprints/library.py` — `import_batch` 改为顺序导入（同一线程），使用 `stream_with_context` 包装 SSE 响应；结果中 pop embedding 字段避免 JSON 序列化失败
- `backend/blueprints/library.py` — `sync_folder` 同样使用 `stream_with_context`，db 操作移入 generator 内部避免连接关闭
- `backend/services/importer.py` — 修复 INSERT 语句 26 列 / 25 占位符不匹配；`import_single_file` 异常时 `raise` 而非 `return None`

## 已完成：移除"重复"检测标签（2026-05-19）

移除 SHA256 级别的精确重复检测，仅保留视觉相似检测（酷似/相似/聚类），突出软件自身优势。

**改动文件：**
- `frontend/js/duplicates.js` — 删除"重复"按钮及帮助文案；默认标签从 `similar` 改为 `near`（酷似）；`typeLabel` 移除 `exact` 映射
- `backend/blueprints/library.py` — 删除 `exact` 分支（余弦相似度 ≥ 0.999 的 union-find）

## 已完成：缩略图 Bug 修复 + UUID 随机命名（2026-05-19）

修复缩略图丢失 Bug，缩略图文件名改为随机 UUID，新增缩略图自动补齐机制。

**改动文件：**
- `backend/services/importer.py` — 修复 re-import Bug：重复导入时不再删除已有缩略图（之前删了旧缩略图但不生成新的，导致 DB 有路径但文件不存在）；缩略图命名从 `{stem}_{timestamp}.jpg` 改为 `{uuid4.hex}.jpg`，避免与源文件名关联
- `backend/blueprints/serve.py` — `serve_thumbnail` 增加自动修复：缩略图文件不存在时自动重新生成，避免 404
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-thumbnails` 端点：补齐 `thumbnail_path` 为空的记录 + 文件不存在的记录
- `frontend/js/api.js` — 新增 `backfillThumbnails()` 方法

**修复的缩略图丢失场景：**
- 重复导入同一文件时旧缩略图被删但未重新生成
- `data/thumbnails/` 目录被手动清理后 DB 记录仍指向旧路径
- 访问缺失缩略图时自动触发重新生成（serve.py 自动修复）

## 已完成：导入性能优化 — 移除 SHA256/pHash + 后端批量导入（2026-05-19）

移除导入时的 SHA256 文件哈希和 pHash 感知哈希计算（每文件省 1 次 ffmpeg 子进程 + 1 次全文 I/O），精确查重改用 ResNet50 embedding 余弦相似度 ≥ 0.999，新增后端 SSE 批量导入端点。

**改动文件：**
- `backend/services/importer.py` — 删除 `_compute_file_hash()`（SHA256）和 `_compute_phash()`（pHash，约 60 行），导入不再计算 file_hash/phash，移除 `hashlib` 导入
- `backend/blueprints/library.py` — 新增 `POST /api/library/import-batch` SSE 端点（ThreadPoolExecutor 5 并发，实时推送进度）；`backfill-hashes` 改为 `backfill-embeddings`（仅补算 embedding）；精确查重（exact）改用 embedding 余弦相似度 ≥ 0.999；新增 `from flask import Response`、`import json`
- `frontend/js/api.js` — 新增 `importBatch(paths)`（SSE 流）；`backfillHashes()` → `backfillEmbeddings()`
- `frontend/js/duplicates.js` — `API.backfillHashes()` → `API.backfillEmbeddings()`
- `frontend/index.html` — `startImport()` 改用 SSE 批量导入（单次请求 + ReadableStream，替代前端 5 路并发请求）

**优化效果：**
- 每文件从 4-5 个子进程降到 2-3 个（ffprobe/exiftool + ffmpeg 缩略图）
- 不再读取整个文件计算 SHA256（大视频文件省数秒）
- 后端线程池统一调度并发，避免前端多请求同时 spawn 大量子进程

## 已完成：代码清理（2026-05-18）

系统性清理冗余代码、提取共享逻辑、删除死代码。

**改动文件：**
- `frontend/js/format.js` — **新建**：提取 `fmtSize()`/`fmtDur()` 共享格式化函数
- `frontend/js/gallery.js` — 修复 `watch`/`computed` 错位 bug（groupBy 不随 sortBy 重置）；用 format.js 替代内联函数；删除空方法 `onRatingChange`
- `frontend/js/detail.js` — 用 format.js 替代内联 `fmtSize`/`fmtDur`
- `frontend/index.html` — 删除死代码（`galleryKey`/`searchText`/`doSearch`/`importProgress`/`importPercent`/`setTheme`）；添加 `format.js` script 标签；侧边栏 mini 模式隐藏文件夹树和展开箭头；导入按钮贴底布局
- `frontend/css/main.css` — 删除未用 CSS 规则（`.stars`/`.pagination`/`.color-*`）
- `backend/config.py` — 新增 `RAW_EXTS`（从 `IMAGE_EXTS` 派生）；删除未用 `OUTPUT_DIR`；添加概述注释
- `backend/compressor.py` — 用 `RAW_EXTS` 替代本地 `RAW_EXTENSIONS`（修正 `.meF` typo）
- `backend/services/importer.py` — 用 `RAW_EXTS`/`VIDEO_EXTS`/`IMAGE_EXTS` 替代本地别名
- `backend/services/embedding.py` — 用 `RAW_EXTS` 替代本地 `_RAW_EXTS`
- `backend/services/thumbnails.py` — **删除**（2 行空占位文件）
- `backend/blueprints/library.py` — 重复检测逻辑提取为 `_fetch_embedding_rows`/`_rows_to_groups`/`_union_find_groups` 三个辅助函数；numpy 移至顶层 import；添加概述注释
- `backend/blueprints/analysis.py` — 移除未用 `import os`；合并两处 `_cleanup_temp` 为模块级函数；删除 4 处冗余 inline `import json`
- `backend/analyzer.py` — `import time` 移至顶层
- `backend/db.py` — 添加概述注释
- `frontend/js/api.js` — 添加概述注释
- 净减约 130 行代码

## 已完成：设置迁移 + 多模态开关（2026-05-16）

将分析配置从每次分析弹窗迁移到全局设置弹窗，新增多模态音频分析开关。

**改动文件：**
- `backend/db.py` — 新增 `settings` 表 + `get_setting()` 辅助函数 + 6 个默认设置
- `backend/blueprints/settings.py` — 新增 GET/POST `/api/settings` 路由
- `backend/__init__.py` — 注册 settings 蓝图
- `backend/blueprints/analysis.py` — 从 settings 表读取配置，按 `use_multimodal` 走 3 阶段（多模态）或 4 阶段（独立 ASR）路径
- `backend/analyzer.py` — 新增 `multimodal` 参数，动态替换 prompt 中 ASR 指令
- `frontend/js/api.js` — 新增 `getSettings()`/`saveSettings()`，`startAnalysis()` 不再发送配置
- `frontend/index.html` — 重写设置弹窗（视频分析/模型/音频分析三个区域），设置变更自动保存
- `frontend/js/detail.js` — 分析弹窗改为确认弹窗（显示当前设置摘要+费用提示），分析阶段根据 multimodal 动态生成

**设置项：**
- `resolution`: 压缩分辨率（480/320/240）
- `fps`: 帧率（30/20/10）
- `vendor`: AI 厂商（预留）
- `model`: AI 模型
- `use_multimodal`: 使用视频模型做多模态解析（true=3阶段，false=4阶段+独立ASR）
- `asr_engine`: ASR 引擎选择
- `video_api_key`: 视频分析 API Key（必须设置，不回退环境变量）
- `asr_api_key`: 音频分析 API Key（云端 ASR 时使用，本地可留空）

**设置弹窗改进（2026-05-16）：**
- 重构为"视频分析"和"音频分析"两个分区，带分割线标题
- 视频/音频分析各自提供 API Key 输入框（密码模式+眼睛切换）
- 移除自动保存，改为"确定"按钮手动保存
- API Key 留空时自动回退到系统环境变量

## ASR：本地模型改为云端 API

当前使用 faster-whisper large-v3 本地模型做语音识别，模型常驻内存约 3-6GB。
产品发布后用户设备（尤其是小内存设备）无法承受，需要改为云端 ASR 方案。

待选方案：
- 智谱 GLM-ASR-2512（同一 API key，但限制 30 秒/25MB，需切片）
- 其他云端 ASR 服务

插件架构已就绪（`backend/asr/`），新增云端引擎实现即可切换。

## 已完成：文件夹目录浏览（2026-05-17）

侧边栏新增 Lightroom 风格的文件夹目录树，展示导入媒体的目录结构，支持按文件夹筛选画廊。

**改动文件：**
- `backend/blueprints/library.py` — 新增 `GET /api/library/folders` 端点（从 `file_path` 构建目录树 + 媒体计数）；`list_media` 新增 `folder` 查询参数（`LIKE` 前缀匹配筛选）
- `frontend/js/api.js` — 新增 `getFolders()` 方法
- `frontend/index.html` — 侧边栏"素材库"改为 `q-expansion-item`，内部嵌套 `q-tree` 展示目录树；新增 `folderTree`/`selectedFolder`/`libraryExpanded` 数据和 `onFolderSelect`/`onLibraryToggle` 方法；抽屉宽度从 220px 增至 260px
- `frontend/js/gallery.js` — `load()` 和 `loadMore()` 读取 `$root.selectedFolder` 并作为 `folder` 参数传入 API 请求；`count()` 同步传递 `folder` 参数
- `frontend/css/main.css` — 新增 `q-tree` 相关样式（节点间距、选中高亮 `var(--accent-dim)`、暗色主题适配、文件夹名 ellipsis 截断、树箭头大小、children 缩进）

**无数据库变更** — 文件夹树从现有 `file_path` 列动态生成。

## 已完成：UI 交互优化（2026-05-17）

多项 UI 细节改进，提升交互体验和视觉一致性。

**改动文件：**
- `frontend/js/gallery.js` — 媒体类型筛选从 `q-btn-toggle` 改为 `q-btn-group` 包含独立 `q-btn` 元素（ALL/图片/视频），每个按钮带 `q-tooltip`（1s 延迟）；"ALL" 按钮使用 `label="ALL"` 文本替代图标；收藏/已分析筛选按钮包裹在 `gap:2px` 容器中
- `frontend/index.html` — 设置弹窗分区标题从 `border-bottom` 横线改为左侧强调条（`border-left: 3px solid var(--accent)`）；侧边栏文件夹树集成到素材库 `q-expansion-item` 内（非独立分区）
- `frontend/css/main.css` — 新增 `.q-menu--square { border-radius: 8px !important }` 覆盖 Quasar 方角下拉菜单；`q-btn-group` 样式调整；文件夹标签 ellipsis 截断 + tooltip

## 已完成：键盘快捷键（2026-05-17）

顶部工具栏新增快捷键按钮（键盘图标），点击弹出快捷键参考弹窗。Gallery 和 Detail 页均已实现快捷键。

**改动文件：**
- `frontend/index.html` — 新增快捷键按钮（设置图标左侧）、快捷键弹窗（通用/Gallery/Detail 三组）、全局键盘监听（`created()` 注册、`beforeUnmount()` 清理）、`showShortcuts` 数据、`getAdjacentId()`/`handleShortcut()` 方法
- `frontend/js/gallery.js` — 统一 `handleKey()` 方法替代旧 `onKeyDelete`/`onKeyEnter`，支持方向键（网格感知上下左右）、Delete 删除、Enter 详情、1-5 评分、F 收藏、G 视图切换、`/` 搜索聚焦；新增 `clearSelection()` 方法
- `frontend/js/detail.js` — `handleKey(e)` 方法：跳过 `isContentEditable` 元素避免与编辑冲突、←→ 上一个/下一个、1-5 评分、F 收藏、Space 播放/暂停、Backspace 返回画廊

**快捷键列表：**

| 快捷键 | Gallery | Detail |
|--------|---------|--------|
| `←` `→` `↑` `↓` | 网格内移动选中 | 上一个/下一个素材 |
| `Enter` | 打开详情 | - |
| `Delete` | 删除选中 | - |
| `1`-`5` | 评分 | 评分 |
| `F` | 切换喜欢 | 全屏看图 |
| `G` | 切换网格/列表 | - |
| `/` | 搜索聚焦 | - |
| `Space` | - | 播放/暂停 |
| `Backspace` | - | 返回画廊 |

## 已完成：分析结果可编辑（2026-05-17）

详情页分析分段的全部字段支持点击即编辑，失焦自动保存。

**改动文件：**
- `backend/blueprints/analysis.py` — 新增 `PATCH /api/analysis/<media_id>/segments/<seg_id>` 路由；`_EDITABLE_COLS` 白名单控制可更新字段；`dominant_colors`/`main_subjects` 数组字段 JSON 序列化；更新后调用 `_refresh_fts()` 刷新搜索索引
- `frontend/js/api.js` — 新增 `updateSegment(mediaId, segId, data)` 方法
- `frontend/js/detail.js` — 分段模板全部可编辑：文本字段（visual/asr/subtitle/镜头维度/场景维度）使用 `contenteditable` + `@blur` → `saveSegField()`；标签字段（colors/subjects）`×` 按钮移除 → `removeTag()`；`handleKey()` 跳过 `isContentEditable` 元素
- `frontend/css/main.css` — `.seg-editable` hover/focus 样式；`.seg-editable-tag` 可移除标签样式

**编辑逻辑：**
- `saveSegField(seg, field, value)` — 比较新旧值，无变化跳过；调 API 保存，失败时回滚并 Notify 提示
- `removeTag(seg, field, tag)` — 从数组中移除目标标签，调 API 保存，失败时回滚

## 已完成：重复素材检测 & 查找相似（2026-05-17）

基于文件哈希和感知哈希的两层重复/相似检测，侧边栏"查找重复"入口，全屏对话框展示结果。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `file_hash`（SHA256）和 `phash`（pHash）两列
- `backend/services/importer.py` — 导入时计算文件哈希（`_compute_file_hash`，分块 SHA256）和感知哈希（`_compute_phash`，imagehash 库 phash，视频取中间帧）；INSERT 语句扩展两列
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-hashes`（回填已有素材的哈希）和 `GET /api/library/duplicates?type=exact|similar&threshold=10`（查找重复/相似，exact 按 file_hash 分组，similar 按 phash 汉明距离 ≤ threshold 分组）
- `frontend/js/api.js` — 新增 `getDuplicates()` 和 `backfillHashes()` 方法
- `frontend/index.html` — 侧边栏新增"查找重复"菜单项（`content_copy` 图标）；全屏对话框包含完全重复/视觉相似切换、缩略图组展示、回填哈希按钮；新增 `showDupDialog`/`dupType`/`dupGroups`/`dupLoading` 数据和 `openDupDialog`/`loadDupGroups`/`backfillAndReload` 方法
- `frontend/css/main.css` — `.dup-group`/`.dup-thumb` 样式
- `requirements.txt` — 新增 `imagehash` 依赖

**重复检测逻辑：**
- 完全重复：SHA256 文件哈希完全一致（不同路径同一文件）
- 视觉相似：pHash 汉明距离 ≤ 10（同一照片不同分辨率/压缩版本）
- 相似模式不提供删除按钮，用户在画廊手动选中删除

## 已完成：侧边栏与交互优化（2026-05-18）

多项侧边栏和交互体验改进。

**改动文件：**
- `frontend/index.html` — 素材库菜单从 `q-expansion-item` 改为 `q-item` + 独立展开箭头，分离导航和展开两个热区；文件夹树改用 `:expanded` + `expandedFolders` 替代 `default-expand-all`（解决异步数据不展开的问题）；进入详情页时只展开目标文件夹的祖先路径；去掉 q-space 修复文件夹名过早截断；移除标签列表 UI；收藏夹图标改为 `folder_special`；红心"收藏"全部改为"喜欢"
- `frontend/js/api.js` — 移除 `getTags`/`createTag`/`deleteTag`/`assignTags` 方法
- `frontend/js/gallery.js` — 筛选提示"只看收藏"→"只看喜欢"，通知文案"已收藏"→"已喜欢"
- `frontend/js/detail.js` — 按钮提示"收藏"→"喜欢"，通知文案"已收藏"→"已取消收藏"→"已喜欢"→"已取消喜欢"
- `frontend/index.html` — 快捷键提示"切换收藏"→"切换喜欢"
- `.gitignore` — 新增 `*.db` 排除数据库文件

**改动点：**
1. 素材库热区分离：点击文字/图标导航到画廊，点击右侧箭头展开/折叠文件树
2. 文件夹树展开修复：`default-expand-all` 只在首次渲染生效（此时数据为空），改用响应式 `expanded` 属性控制
3. 详情页展开策略：只展开目标文件夹的祖先路径，不展开所有节点
4. 文件夹名截断修复：去掉 q-space，计数数字用 `flex-shrink:0` 不压缩，文件夹名占据剩余空间
5. "收藏"→"喜欢"：红心功能统一称为"喜欢"，与侧边栏"收藏夹"区分
6. 标签功能移除：前端移除标签列表和 API，后端保留
7. 收藏夹图标：`folder` → `folder_special`

## 已完成：ResNet50 + HDBSCAN 替代 pHash 相似检测（2026-05-18）

pHash 方案无法准确识别视觉相似照片（不同内容因亮度分布接近被错误匹配），改用 ResNet50 深度学习特征 + HDBSCAN 聚类。仅对图片做向量化，视频不参与相似检测。

**改动文件：**
- `backend/services/embedding.py` — **新建**：ResNet50 ONNX 特征提取模块
  - 加载 ResNet50 ONNX 模型（去掉最后 FC 层，输出 2048 维向量）
  - 支持 RAW（rawpy）、HEIF（pillow-heif）、标准图片格式
  - Singleton ONNX Session（CoreML + CPU 提供者）
  - L2 归一化后存为 SQLite BLOB（8KB/张）
- `backend/db.py` — `_MIGRATIONS` 新增 `embedding BLOB` 列
- `backend/services/importer.py` — 图片导入时调用 `compute_embedding()` 计算 embedding；视频不计算（存 NULL）；INSERT 扩展 `embedding` 列
- `backend/blueprints/library.py` — 相似检测改用 HDBSCAN（`metric="euclidean"`，对 L2 归一化向量等价余弦距离）；backfill 端点补算 embedding；移除 threshold 参数
- `frontend/js/gallery.js` — 视频右键菜单"查找相似"禁用（`:disable` 检测 `media_type === 'video'`）
- `frontend/js/api.js` — `getDuplicates(type)` 去掉 threshold 参数
- `frontend/js/duplicates.js` — 适配新接口（similarity 字段由后端计算）；backfill 按钮文案改为"计算特征向量"；默认展示"相似"
- `requirements.txt` — 新增 `onnxruntime>=1.17.0`、`scikit-learn>=1.3.0`、`hdbscan>=0.8.0`
- `.gitignore` — 新增 `backend/models/`（ONNX 模型文件 ~89.6MB）

**相似检测逻辑：**
- 完全重复：embedding 余弦相似度 ≥ 0.999（2026-05-19 已改为 embedding，不再用 SHA256）
- 视觉相似：ResNet50 提取 2048 维特征 → L2 归一化 → HDBSCAN 自动聚类（无需手动阈值）
- 仅图片参与相似检测，视频排除
- 每组显示平均余弦相似度百分比

**性能数据：**
- 428 张图片 → 55 个聚类 + 91 个噪声点，耗时 0.4 秒
- 同场景 JPG+NEF 配对正确分组
- 模型文件 `backend/models/resnet50.onnx`（89.6MB，首次用 `backend/export_model.py` 从 PyTorch 导出，运行时仅需 onnxruntime）

## 已完成：分析进度优化 + 硬件加速压缩 + ASR 修复（2026-05-18）

分析进度条从 0→100 瞬间跳变改为真实进度反馈，新增硬件加速压缩，修复 ASR 时间戳匹配问题。

**改动文件：**
- `backend/compressor.py` — `compress_video()` 改为 Popen 解析 ffmpeg stderr 的 `time=` 输出推送真实百分比；preset 改为 `ultrafast`；新增 `detect_hw_encoder()` 自动检测硬件编码器（videotoolbox/nvenc/qsv）；硬件加速模式用 `-hwaccel videotoolbox` GPU 解码 + libx264 CPU 编码（4K HEVC 提速 6 倍）；动态码率 `_calc_bitrate()` 按分辨率/帧率等比缩放
- `backend/analyzer.py` — `analyze_video()`/`analyze_image()` 新增 `on_progress` 回调，报告子步骤（`uploading` → `first_token` → `receiving` + 字符数）
- `backend/asr/__init__.py` — `AsrEngine.transcribe()` 接口新增 `on_progress` 参数
- `backend/asr/engines/whisper.py` — 启用 `vad_filter=True` + `word_timestamps=True`，用词级起止时间替代段级时间戳；`on_progress` 回调报告 `loading`/`transcribing` 两阶段
- `backend/blueprints/analysis.py` — 压缩和分析均在线程中运行，generator 轮询推 SSE；SSE 新事件：`compressing` 带真实百分比、`analyzing` 带子步骤（`uploading`/`receiving`）、`analyze_done`（VLM 完成立刻标记）、`asr_start`/`asr_progress`（ASR 独立推进）；`_merge_asr()` 从重叠匹配改为最佳匹配（每段 ASR 只匹配重叠最多的 VLM 分段）
- `backend/blueprints/settings.py` — GET 接口返回 `hw_encoder` 字段
- `backend/db.py` — `_DEFAULTS` 新增 `hw_accel`
- `frontend/index.html` — 设置弹窗视频区域新增"硬件加速压缩"开关（仅检测到硬件编码器时显示）；帧率下方实时显示预估码率；`loadSettings()`/`saveSettings()` 同步新字段
- `frontend/js/detail.js` — SSE 事件处理新增 `percent`（压缩真实进度）和 `substep`（AI 分析子步骤）；`_setStageProgress()`/`_setAnalyzeSubstep()`/`_setAsrSubstep()` 方法；编码阶段完成显示文件大小；分析确认弹窗显示码率；ASR 阶段独立显示加载模型/语音识别子步骤
- `frontend/css/main.css` — `.img-meta-bar` 加 `flex-wrap: wrap` 支持折行；区块标题字号调至 12px，标题与内容间距增加

**分析进度子步骤：**
- 压缩：ffmpeg 真实百分比进度条
- AI 分析：上传至 AI 服务 → 接收结果 (N 字)
- 独立 ASR 模式：VLM 完成立刻标记 → ASR 独立显示"加载语音模型"→"语音识别中"

## 下一阶段优化计划

### 体验提升
- [ ] **批量分析** — 支持选中多个素材一键排队分析

### 功能完善
- [ ] **智能相册** — 按拍摄日期、相机型号、分辨率等自动分组
- [x] ~~**视频播放器集成**~~ — 已实现
- [x] ~~**重复素材检测**~~ — 已实现：文件哈希去重 + ResNet50 + HDBSCAN 相似检测

### 导出与分享
- [ ] **分析报告导出** — 导出 AI 分析结果为 PDF/文本

## 已完成：图片压缩分析 + 详情页布局重构 + 色彩曲线检测（2026-05-17）

在 XMP 写入基础上，新增图片压缩分析流程、详情页布局全面重构、色彩曲线检测。

**改动文件：**
- `backend/compressor.py` — 新增 `compress_image()` 函数，Pillow 缩放 + rawpy 解码 RAW 格式（NEF/DNG/CR2/ARW 等），保存为 JPEG quality=85
- `backend/db.py` — `_DEFAULTS` 新增 `image_resolution`、`image_api_key`、`image_model`；`_MIGRATIONS` 新增 `picture_control` 列
- `backend/blueprints/analysis.py` — `_start_image_analysis()` 从设置读取图片独立配置（API Key 不回退视频 Key），压缩后再分析，SSE 推送压缩进度
- `backend/services/importer.py` — 导入时读取 `PictureControlName`（尼康 N-Log），DJI 文件名 `_D` 后缀推断 D-Log M；INSERT 扩展 `picture_control` 列；exiftool 命令增加 `-PictureControlName`
- `backend/blueprints/library.py` — 新增 `POST /api/library/backfill-picture-control` 回填历史数据；XMP 写入端点增加分析字段（dominant_colors/main_subjects/scene_type/mood/weather/lighting）作为 dc:Subject 关键字
- `frontend/index.html` — 设置弹窗新增"图片分析"区块（压缩尺寸/模型/API Key），排在视频分析之前
- `frontend/js/detail.js` — 详情页布局重构：元数据从右侧边栏移至媒体上方横排显示；视频信息分两列；图片缩放（滚轮/触控板双指张合）+ 拖拽平移（触控板双指滑动/鼠标拖拽）；缩放条贴在图片底边内侧；XMP 写入按钮使用自定义 SVG 图标；图片分析结果隐藏时间范围/片段数/删除按钮
- `frontend/js/gallery.js` — 卡片新增 XMP 徽章（右下角，自定义 SVG 图标，ungrouped 和 grouped 两种模板均已添加）
- `frontend/css/main.css` — `.img-meta-bar`/`.img-meta-block`/`.img-meta-title` 横排元数据样式；`.img-zoom-bar` 缩放条贴图底；`.xmp-badge` 移至右下角 right:28px（与类型图标并排）
- `frontend/img/` — 新增 3 个自定义 SVG 图标：`xmp-badge.svg`（文件+XMP文字）、`xmp-write.svg`（文件+XMP+左箭头）、`xmp-refresh.svg`（文件+XMP+循环箭头）
- `requirements.txt` — 新增 `rawpy>=0.20.0`

**色彩曲线检测逻辑：**
- 尼康：从 exiftool 的 `PictureControlName` 读取（如 N-Log），准确
- 大疆：从文件名后缀 `_D` 推断 D-Log M，可能不准确
- 前端显示时带叹号图标，悬停提示两种来源的准确性差异

**图片压缩流程：**
```
图片分析请求 → 读取 image_resolution 设置 → compress_image()
  ├── RAW 格式 → rawpy 解码 → Pillow 缩放 → 临时 JPEG
  └── 普通格式 → Pillow 直接缩放 → 临时 JPEG
→ analyze_image() → 清理临时文件
```

## 已完成：XMP 侧车文件写入（2026-05-17）

将评分、标签、AI 分析摘要写入 XMP 侧车文件（仅照片），供 Lightroom、Bridge 等专业软件识别。

**改动文件：**
- `backend/db.py` — `_MIGRATIONS` 新增 `has_xmp` 列（INTEGER DEFAULT 0）
- `backend/services/xmp_writer.py` — **新文件** — XMP 侧车文件写入模块，使用 exiftool CLI
  - `write_xmp()` — 写入评分（`xmp:Rating`）、标签（`dc:Subject`）、描述（`dc:Description`）、颜色标签（`xmp:Label`）
  - 已有 XMP 文件：exiftool 直接修改，保留其他字段
  - 无 XMP 文件：先从源图提取创建，再写入字段
- `backend/blueprints/library.py` — 新增 `POST /api/library/<id>/write-xmp`（单张写入）和 `POST /api/library/batch-write-xmp`（批量写入，仅处理照片）
- `frontend/js/api.js` — 新增 `writeXmp()` 和 `batchWriteXmp()` 方法
- `frontend/js/detail.js` — 工具栏新增"写入 XMP"按钮（仅图片显示，图标 `description`），写入后按钮变蓝；元数据侧边栏显示 XMP 标记
- `frontend/js/gallery.js` — 卡片新增 XMP 徽章（缩略图左下角）；右键菜单新增"写入 XMP"选项；批量选中后可批量写入
- `frontend/css/main.css` — `.xmp-badge` 样式（半透明黑色背景，位于 AI 徽章右侧）

**XMP 字段映射：**
| 数据库字段 | XMP 字段 | 说明 |
|-----------|---------|------|
| `rating` | `xmp:Rating` | 1-5 评分 |
| tags (media_tags) | `dc:Subject` | 标签列表 |
| segment.visual | `dc:Description` | AI 分析摘要（第一段） |
| `color_label` | `xmp:Label` | 颜色标签 |

## 第一轮审计：内存 & 硬盘

### 已解决

- **#1** 孤儿缩略图从未清理 — 已修复：清理了现有 10 个孤儿文件；重复导入不再删除旧缩略图；缩略图命名改为 UUID 随机文件名
- **#2** 批量删除媒体时跳过缩略图文件删除 — 已修复：`batch_update` 删除前查询并删除缩略图文件
- **#3** SSE 客户端断连时压缩临时视频残留 — 已修复：`Response.call_on_close()` 注册回调确保断连时清理
- **#4** `temp_video/` 启动时从不清理 — 已修复：`compressor.py` 新增 `cleanup_temp()`，启动时调用
- **#5** WAL 文件从不 checkpoint — 已修复：`init_db` 末尾执行 `PRAGMA wal_checkpoint(TRUNCATE)`
- **#6** 无 VACUUM，数据库只增不减 — 已修复：`init_db` 末尾执行 `VACUUM`
- **#7** `data/uploads/` 空目录无清理机制 — 已删除该目录，当前无代码使用
- **#10** SSE 闭包持有 app 和 compressed_path 引用 — ✓ 已评估，捕获的都是小对象，无需处理
- **#11** SSE 错误处理中 db2 连接可能泄漏 — ✓ 已评估，`get_db()` 返回同一连接，无泄漏，已统一变量名
- **#12** ASR engine 每次调用创建新实例 — ✓ 已修复，改为单例缓存
- **#13** 每个连接重复执行 WAL PRAGMA — ✓ 已修复，WAL 改为 init_db 执行一次

### 遗留项

- **#8** Whisper 模型常驻内存 3-6GB — 等云端 ASR 切换后自然解决
- **#9** 视频分析时整个视频 base64 编码在内存（约为文件 1.33 倍）— 大文件场景需关注

## 第二轮审计：安全 / 并发 / 数据一致性 / 前端

### 高优先级

- **A1** 路径遍历：`serve_thumbnail` 从 DB 读取 `thumbnail_path` 拼接路径，无验证是否在 `THUMB_DIR` 内 — `serve.py:162-168`
- **A2** 任意文件读取：`import-one` 接受任意文件系统路径，可将服务器任意文件导入并暴露 — `library.py:95-105`
- **A3** 并发分析竞态：两个请求同时分析同一视频，会互相覆盖 segments — `analysis.py:45-61`
- **A4** WhisperModel 线程安全：`faster_whisper` 的 CTranslate2 后端在并发调用时可能有隐患 — `asr/engines/whisper.py:9-17`
- **A5** `compress_video` 返回值与类型注解不匹配（注解写 2 元组，实际返回 5 元组）— `compressor.py:27,63`
- **A6** `loadWaveform` 下载整个视频到浏览器内存做波形可视化，大文件会 OOM — `detail.js:625-652`
- **A7** Gallery `load()` 竞态：快速切换筛选时并发请求，最后 resolve 的覆盖结果 — `gallery.js:380-409`
- **A8** 详情页 URL 无 ID 校验：`#/detail/` 或 `#/detail/abc` 导致请求 `/api/library/NaN` — `detail.js:252-254`
- **A9** `startAnalysis` 绕过统一 API 错误处理，直接用原始 `fetch()` — `api.js:66-71`

### 中优先级

- **A10** SSE 断连后 `analysis_status` 卡在 `processing`，无超时恢复机制 — `analysis.py:71-93`
- **A11** `save_segments` DELETE + INSERT 无事务保护，崩溃会丢数据 — `analysis.py:196-233`
- **A12** `resolution`/`fps` 参数无校验，恶意值可导致资源消耗 — `analysis.py:97-100`
- **A13** JSON 解析失败时将原始文本存为 segment，`analysis_status` 仍设为 `done` — `analyzer.py:92-109`
- **A14** `media_segment` 表缺少 `REFERENCES media(id) ON DELETE CASCADE`，依赖手动删除 — `db.py:67-87`
- **A15** FTS5 搜索含特殊字符（`*`、`"`、`OR`）会导致 500 错误 — `library.py:51-56`
- **A16** 转码流式响应无大小/时间限制，超大视频消耗资源 — `serve.py:60-84`
- **A17** `analyze_image` 缺少 try/except，API 调用失败时无上下文信息 — `analyzer.py:124-145`
- **A18** `add_items`/`assign_tags` 不验证关联记录是否存在，外键违反导致 500 — `collections.py:38-47`、`tags.py:41-62`
- **A19** `cleanup_temp` 使用相对路径 `Path("temp_video")`，工作目录变化会失效 — `compressor.py:12-21`
- **A20** Gallery 加载失败时显示空状态，无错误提示 — `gallery.js:406-408`
- **A21** Collection 视图忽略排序/筛选控件 — `gallery.js:388-403`
- **A22** SSE 流未检查 `resp.body` 是否存在，可能 TypeError — `detail.js:513-516`
- **A23** Scope 渲染累积不清除，逐渐全白 — `detail.js:828-838`
- **A24** 选中检测用 `Array.includes` O(n)，应改 `Set` — `gallery.js:64-65`

### 低优先级

- **A25** `update_media`/`delete_media`/`batch_update` 不检查记录是否存在，返回假成功
- **A26** `_merge_asr` 静默吞掉时间戳解析错误，无日志
- **A27** `_parse_time` 不处理 `HH:MM:SS` 三段格式
- **A28** `_refresh_fts` 每次调用执行 `from .library import _segment`，存在循环依赖风险
- **A29** `import_single_file` 不区分"已存在"和"导入失败"，统一返回 null
- **A30** `import_one` 失败时返回 HTTP 200 + `{"data": null}`，应为 4xx
- **A31** VACUUM 每次启动执行，大库会拖慢启动
- **A32** Schema 和 migration 对 `camera_make`/`lens_model` 列定义不一致
- **A33** FTS5 搜索含特殊字符需转义，`_segment_query` 未处理
- **A34** 多处 API 调用无 try/catch，失败时无用户反馈（`setRating`、`setColor`、`toggleFav` 等）
- **A35** 批量删除中途失败，部分已删部分未删，无回滚
- **A36** 右键菜单位置不检查视口边界，可能溢出屏幕 — `gallery.js:217-229`
- **A37** 缩略图 fallback `@error` 无限循环风险 — `gallery.js:73,105`
