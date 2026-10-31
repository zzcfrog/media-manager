# liquid-glass-js 与 liquid-dom 对比

评估日期：2026-10-18。范围：源码审阅、同一合成场景的 Chromium / Electron 隔离验证。只做选型评估，未接入业务 UI。

## 结论

`liquid-dom` 的工程结构和资源管理更完整，适合作为后续研究方向；当前版本依赖实验性的 DOM 绘制接口，不能直接承担本项目的 Vue / Quasar 界面。`liquid-glass-js` 可以在现有 Electron 中呈现折射，但页面快照更新、组件生命周期和键盘操作仍需要补齐，不建议原样引入整个应用。

两者都不是添加一个 CSS 类即可应用的样式库。无需为这两者把项目改成 React；Liquid DOM 的 core 是独立的命令式 API，React 19 绑定只是可选集成层。

## 固定版本与比较

| 项目 | dashersw/liquid-glass-js | AndrewPrifer/liquid-dom |
| --- | --- | --- |
| 源码 SHA | `78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a` | `dd342ab663d718e8b4edf4cd39983b9a873360a7` |
| GitHub 热度 | 约 1.5k stars / 115 forks | 约 2.5–2.6k stars / 122 forks，页面两处数字存在缓存差异 |
| 默认分支历史 | 页面显示 1 次提交；当前提交 2025-06-12 | 页面显示 201 次提交；当前提交 2026-09-07 |
| 许可证 | MIT | MIT；core 0.1.1 |
| 实现 | html2canvas 页面快照 → WebGL 纹理 → 折射 / 模糊 shader | WebGPU 场景、玻璃几何、DOM 纹理同步、布局及多种适配层 |
| Vue 接入 | 包装命令式 Container / Button，管理手动尺寸及快照刷新 | 包装 core，并协调 Vue DOM 与场景 / Html host 的所有权和布局 |
| DOM 更新 | 核心默认复用首次快照；演示额外实现窗口 resize 后重新采样 | 通过实验性 HTML-in-Canvas paint 事件和 DOM-to-texture API 同步 |
| 生命周期 | 无 destroy；静态实例、scroll 监听及嵌套 RAF 需要调用方补齐管理 | 有 destroy、ResizeObserver / 监听解除和 GPU 资源清理代码 |
| 工程结构 | 散装 JS / CSS；npm、TS、框架包装和无障碍改进仍列于 roadmap | TS monorepo、包、changelog、发布工具及单元测试源码；本次未运行上游测试 |

热度和提交数量取自当日 GitHub 页面，仅作为维护信号，不能等同于稳定性证明。最新提交时间使用本地 clone 的 `git log -1` 验证。

来源：[liquid-glass-js 仓库](https://github.com/dashersw/liquid-glass-js)、[Liquid DOM 仓库](https://github.com/AndrewPrifer/liquid-dom)、[Liquid DOM 固定版本 README](https://github.com/AndrewPrifer/liquid-dom/blob/dd342ab663d718e8b4edf4cd39983b9a873360a7/README.md)。

## 实际运行结果

使用本项目现有 Electron **35.7.5 / Chromium 134.0.6998.205**，另测 Playwright Chromium **153.0.8010.12**。都没有开启实验性功能。Electron 使用独立 profile、合成 HTML 和与项目相同的 macOS 窗口材质配置；没有启动业务后端，也没有读取真实资料库。

### liquid-glass-js

1. **折射可以显示，动态背景不会自动更新。** 将玻璃下方的背景从红色 `#dc3434` 改为蓝色 `#205cde`，主动调用 `glass.render()` 后，整个玻璃 canvas 图像仍完全相同，中心像素仍为 `[220,52,52,255]`。主动重新采样并重新初始化纹理后，中心像素才变成 `[32,92,222,255]`。两个运行时结果一致。
2. **重新截图有成本。** 最后一轮简单合成页面中，Electron 首次截图约 93.2 ms、重采样约 58.9 ms；Chromium 分别约 76.4 / 61.7 ms。此数值只包含 html2canvas Promise 的时间，不含随后图片解码及 shader 初始化，是单次观察，不能推算实际资料库性能，也不能当作双方 FPS 对比。
3. **嵌套按钮移除后 RAF 继续调度。** 先等待父容器和子按钮初始化，再添加为嵌套按钮；`removeChild` 并移除父元素后，子按钮已脱离 DOM，但 450 ms 观察窗内嵌套回调次数在 Electron 从 18 增至 73，Chromium 从 13 增至 46。静态实例列表仍有 4 项，且没有 destroy。回调持续调度已确认，未测长期内存增长。
4. **库内 Button 缺少原生键盘语义。** 实际元素为 DIV、无 role、tabIndex=-1；鼠标单击会触发，发送 Enter 后点击计数仍停留在 1。玻璃容器内另放的原生 button 能正常点击。保留 Quasar 原控件是可行方向，但还需要专门的适配和回归验证。
5. **需要留意样式及文档差异。** 原始 canvas 为 `z-index:-1`，本次在包装元素上加 `z-index:0` 才让它保持在局部层叠上下文中；没有改上游源码。README 写 WebGL 2.0，实际 `getContext('webgl')` 及运行结果均为 WebGL 1.0。

对项目的影响：切换素材、缩略图异步加载、主题和内容变化可能继续折射旧快照；视频逐帧同步没有实现和验证。大范围接入前需要解决内容更新和卸载清理，不能把 demo 的参数实时调整误认为页面内容也在实时更新。

源码：[页面采样 container.js:193](https://github.com/dashersw/liquid-glass-js/blob/78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a/container.js#L193)、[嵌套 RAF button.js:589](https://github.com/dashersw/liquid-glass-js/blob/78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a/button.js#L589)、[演示的 resize 处理 demo.js:76](https://github.com/dashersw/liquid-glass-js/blob/78cb6ccb0b9987bb60a88b14ccbd13a9e6e8ab2a/demo.js#L76)。

### liquid-dom

1. **WebGPU 本身可用。** 两个运行时的 `navigator.gpu` 和 requestAdapter 均可用，Renderer 完成 GPU 初始化，能够看到玻璃几何。因此阻碍不是 Vue，也不能笼统表述为 Electron 不支持 WebGPU。
2. **DOM 内容渲染受实验 API 阻碍。** 两个默认运行时均没有 `GPUQueue.copyElementImageToTexture`；`layoutSubtree` 属性探测为 false，paint 事件数为 0。背景和玻璃内原生按钮均没有显示，按钮布局尺寸为 0×0。控制台反复记录 `TypeError: queue.copyElementImageToTexture is not a function`。
3. **render 未抛异常不代表成功。** Renderer 会捕获并记录 DOM 复制错误，所以调用者记录的 renderError 为 null，但页面实际内容缺失。实际截图及可见性检查才确认了失败。
4. **清理路径有实质实现。** 调用 renderer.destroy 后，测试中托管 Html hosts 从 2 变为 0，destroyed=true。源码另外处理事件解绑、ResizeObserver 和 GPU 资源清理；没有声称完整资源泄漏测试已通过。

官方 README 明确要求：玻璃 renderer 需要 WebGPU，DOM-backed Html 还需要 Chrome `#canvas-draw-element` 实验开关。仅绘制自定义 GPU 几何不等于可以渲染现有 Vue 页面。升级 Electron 也不能直接当作解决方案，必须重新确认目标内核是否具备这些接口及其稳定性。

源码：[运行要求](https://github.com/AndrewPrifer/liquid-dom/blob/dd342ab663d718e8b4edf4cd39983b9a873360a7/README.md#browser-and-runtime-requirements)、[DOM-to-texture 调用](https://github.com/AndrewPrifer/liquid-dom/blob/dd342ab663d718e8b4edf4cd39983b9a873360a7/packages/core/src/renderer/dom-content-sync.ts#L138)、[Renderer 清理](https://github.com/AndrewPrifer/liquid-dom/blob/dd342ab663d718e8b4edf4cd39983b9a873360a7/packages/core/src/renderer/index.ts#L156)。

## 对当前项目的建议

- 如比较长期研究价值，优先研究 Liquid DOM：它的场景、布局、DOM 同步和生命周期设计更完整。这是源码结构判断，尚未证明它在我们的生产页面中视觉或性能更好。
- 如要求现有 Electron 立即落地，liquid-glass-js 有运行基础，但原样接入的收益不足以覆盖内容过期及清理工作。最多先做范围很小的静态控件原型。
- 当前整体 UI 继续使用既有 Vue / Quasar，保持已经验证的布局、控件语义和功能；折射层应单独验证。当前预览中的另一个 SVG / CSS 候选也仍是候选，本次不构成其最终选用依据。

## 证据与未验证范围

隔离证据保留于 `build/glass-two-projects/`（Git 忽略）：`results.json`、`metadata.json`、两套运行时截图、测试脚本、合成 HTML、打包后的 Liquid DOM core、选定上游源码和许可证。测试脚本记录了原始临时绝对路径；它是本次诊断记录，不是对用户开放的长期预览服务。

未验证：开启实验开关后的 Liquid DOM DOM 渲染；完整 Vue / Quasar 集成；真实视频、跨域媒体与大型资料库；Windows / Linux / Safari；双方同等画面条件下的 FPS、GPU 占用和耗电；上游完整单元测试。由于 Liquid DOM 默认环境无法显示 DOM，本次不提供误导性的性能排名。

验证完成时核对 历史 UI 验证附件（已清理） 中 13 个现有源文件散列全部一致。本次没有修改业务代码、项目依赖、真实资料库、本地模型或已安装应用，没有提交或推送。
