---
paths:
  - "src/client/**"
  - "tests/**"
---

> 覆盖：预览与编辑面板的运行时行为——iframe 隔离、悬停/滚动、加载与失败态、两级样式字段与停靠偏好。何时读我：改 `src/client/HtmlDesignBody.tsx`、`frame-runtime.ts`、`HtmlDesignBody.module.css`，或排查「滚动位置丢了 / 悬停卡顿 / 编辑面板位置」时。

# 核心机制与设计决策（预览与编辑面板）

## 预览文档的隔离与同目录资源

预览把文件字节按 UTF-8 解出后注入运行时脚本（没有 `<body>` 就追加），再以 Blob URL 装进 iframe。sandbox 是 `allow-scripts allow-forms allow-popups allow-modals`，**不含 `allow-same-origin`**，被预览页面因此拿到不透明源：读不到宿主文档、cookie 与存储，只能通过 `postMessage` 跟运行时说话。

Blob 文档没有目录，`href="assets/app.css"` 会解析成不存在的地址。修法是**经 Remote 读回来内联**：客户端用 `siblingReferences` 取出相对引用（跳过 HTML 注释区，注释里常引用着被替换的标签），Host 的 `webDesignReview.assets` 按 Session 工作区读同目录文件，CSS/JS 内联成 `<style>`/`<script>`、图片转 `data:` URL。这条路走 IPC，桌面端与 web 端都成立。

`/api/web-design/preview` 路由是 web 端专用增强，只在 `connection` 服务存在时注册。**`inject` 不得包含 `connection`**：桌面端没有这个服务，列进去会让整个插件不加载，连 Remote 都没有，预览与保存一起失效。

`Save to file` 只写被评审的 HTML，内联内容不入盘；注释区逐字保留。

注入的帧 chrome（悬停轮廓、选中框、拖动把手）写在被预览文档里，`body` 上的 `--dsw-*` 变量不会继承进去，所以那里的颜色是字面量。这是本仓 CSS 规范的一处已知例外，改动时不要把宿主 token 写进去（会解析成空值）。

## 悬停不进渲染路径，刷新保留页面滚动

帧运行时自己画悬停轮廓，预览组件**不订阅** `hover`：`HtmlDesignBody` 的 message 分支里显式忽略它。它曾经写进客户端 store，指针每跨过一个元素就提交整棵预览子树——而没有任何渲染读到那个值。`tests/client-render-cost.spec.ts` 用 React Profiler 把这条守住（修复前 jsdom 实测 120 个目标 = 120 次 commit，修复后 0 次）。

帧另外把**被预览页面自身**的滚动偏移按帧节流上报（`scroll`）；刷新（`reloadToken` 变化导致 iframe 重挂）后，父组件在新帧 `ready` 时用 `restoreScroll` 回放，读者不会被打回页首，换文件时偏移归零。编辑弹窗的滚动位置也存在组件里，重新打开时恢复。删掉任一侧的消息处理，滚动保留就静默失效。

## 预览的加载与失败态

首屏用与加载后同形的骨架（`--dsw-alias-bg-skeleton`，只动 `opacity`，`prefers-reduced-motion` 下关闭）；评审读取中工具栏显示局部 busy 并带 `aria-busy`；`Save to file` 的进行中/成功/失败由工具栏 Tag、按钮文案与结果带（`Notice`，唯一 `role="alert"`）共同表达。失败一律保留数据并给出唯一可用的恢复动作（重读评审 / 重写评审 / 重写文件），`resolveFile` 失败时保存与写入保持禁用。

## 编辑面板的两级字段与停靠偏好

样式字段分两级：字号/字重/文字颜色/背景色常显，行高/字距/内边距/外边距/圆角收在「更多样式」按钮（`aria-expanded` + `aria-controls`）后面；只要草稿或已存评审里第二级字段有值，该级就自动展开，已保存的修改不会被藏起来。

编辑面板的位置由 `placeEditor(stage, docked)` 算：默认 `auto`（有空间就贴在 Sidebar 旁，否则落成底部面板），`data-placement` 会让位给评审自己的选择。停靠偏好经 inject 面的 `readEditorDock`/`writeEditorDock` 读写，实现在 `src/client/index.ts` 里用 `localStorage`（键 `dsh-web-design.editor-dock`）——它是**评审的偏好**而不是文件状态，所以不进 per-document 的 review store，也不用 store 的 `persist`（那会连 `document`/`selected` 一起持久化）。「改为浮动」就是恢复自动的入口。
