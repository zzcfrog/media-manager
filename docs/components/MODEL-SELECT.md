# 模型选择器

`frontend/js/model-select.js` 注册为全局 Vue 组件 `model-select`，基于 Quasar QSelect。各设置页共用名称、体积、下载和已安装状态，菜单衔接样式遵循 UI-SPEC 7.3；组件只发事件，服务端决定下载来源、路径和校验。

```html
<model-select v-model="selectedModel" :options="models"
  :download-state="download" aria-label="快速分类模型列表"
  @download="confirmDownload"></model-select>
```

| 属性 | 含义 |
| --- | --- |
| `modelValue` | 字符串或数字模型ID；下载中不擅自修改选择 |
| `options` | 选项数组；`value,label,name` 为标识及显示名，`detail` 为体积/用途短说明 |
| `downloadState` | `state`、`model_id`、`done_bytes`、`total_bytes`；可用 `group` 将套装进度映射到多个阶段 |
| `allowNone` | 在首行增加value=none的「不启用」项；无下载/删除动作，默认false，由调用者将事件映射到对应启用状态 |
| `allowRemove` | 已下载模型显示删除动作，由调用者确认并处理；默认只显示已下载标记 |
| `disable` | 禁用选择及所有动作；例如未启用的人脸复核阶段 |

选项支持 `installed`、`custom`（手动外部来源）、`unavailable`（整个选项禁用）、`selectable`（尚未下载也可选择推荐套装）。没有 `detail` 时，用 `quant,size_gb,min_ram_gb` 生成说明。其他属性如 `aria-label`、`loading` 传递到QSelect。

`update:modelValue` 只用于可选模型；点击未下载模型触发 `download(option)`，由调用者确认。`remove(option)` 请求删除；`show/hide` 转发菜单状态；`activate(value)` 表示用户鼠标或Enter激活，用于再次选择同一套装时的配置引导。公开 `hide()` 供调用方关闭菜单。

下载中显示行内进度，暂时禁用下载按钮，已安装模型和外部来源仍可选择。错误/取消与重试动作由所在设置分组展示。「不启用」在下载期间也可选择；人脸/快速分类会清除本次自动填入上下文，即使再次选择当前的不启用项，迟到完成也不能重新激活功能。后端下载完成后，调用者刷新目录；人脸/分类仅在同一弹窗会话且相关草稿没有变化时填入路径，设置确认后生效。关闭再打开不应用旧结果。取消设置不删除已下载模型。

人脸页面只有上方选择器列InsightFace六个套装，下面三张卡片仅展示模型与状态，没有独立选择、文件输入或下载入口。快速分类只列Google SigLIP 2的17个完整规格，不提供外部目录/JSON选择；原有兼容配置仍可读取。厂商列入模型显示名和菜单说明，转制作者记录在后台清单，避免将ONNX Community误标成原模型厂商。

人脸列表是套装下载的唯一入口；调用者的确认弹窗显示只读模型根目录、可编辑 `faces/套装文件夹` 子目录以及该套装实际的阶段和文件名。信息按钮说明根目录在通用设置修改；目录存在或校验失败时保留输入、展示原因，不能覆盖现有目录。组合下载填入整组，不暴露单阶段下载；取消弹窗返回原模型选择器。

名称和菜单项复用QSelect键盘语义；动作按钮与 `role=option` 分开，按钮具有模型专属名称，停用状态可读。颜色来自主题变量，减少动态效果沿用全系统规则。浏览器验证入口为 `tests/model-select-browser.cjs`；隔离服务必须同时开启 `MODEL_SELECT_FIXTURE=1 FACE_MODEL_SETUP_FIXTURE=1`，使用合成ONNX/ZIP与模拟VLM下载，禁止连接真实资料库。

五个模型设置页使用不启用入口，创造构思页不在本次范围。图片/视频/音乐以独立analysis_enabled设置控制，保留共享的本地模型标识；人脸用model_enabled布尔值，快速分类用classification_model_enabled字符串开关，二次补充与词库共用模型用none标识。后端在入队和实际执行处校验，不能仅靠界面不显示模型。云端和独立语音转写选择器使用同样的不启用文案。
