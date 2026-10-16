---
paths:
  - "tests/**"
  - "vitest.config.ts"
  - "src/**"
  - "src/client/**"
  - "lib/**"
---

> 覆盖：七个测试套件各自守什么、`vitest.config.ts` 的打桩范围，以及「先构建再测」的原因。何时读我：改 `tests/`、补回归测试，或判断一条改动该由哪个套件守住时。

# 测试

```sh
npm test   # 三个 node 断言脚本 + vitest run
```

- `tests/smoke.mjs` —— 用真实 Cordis `Context` apply **构建后的** `lib/index.mjs`：导出、注册、卸载是否干净。
- `tests/annotations.mjs` —— sidecar 往返与拒绝路径：`validateWrite`、`readAnnotations` / `writeAnnotations`、`sidecarPath`，以及错 `file`、错 `version`、超限载荷。
- `tests/source-edit.mjs` —— 源编辑不碰无关字节、也不谎报成功：样式增改、文本替换、删除 span、selector 定位失败与重叠。
- `tests/client-apply.spec.ts`（jsdom）—— 浏览器半边的注册：文档预览声明、`sidebar.right.tab.document` 座位、字典、卸载。
- `tests/client-preview.spec.ts`（jsdom + Testing Library）—— 预览与编辑弹窗的交互，含加载失败重试、部分写入的结果带与滚动回放。
- `tests/client-render-cost.spec.ts`（jsdom + React Profiler）—— 预览的渲染成本：指针跨元素不得提交预览子树。
- `tests/frame-runtime.spec.ts`（JSDOM）—— 注入运行时的消息协议与选择/移动行为，含滚动上报与回放。

`vitest.config.ts` 把 UI 套件与 CSS Modules 打桩，所以这些是**注册与行为测试**，不是 UI kit 的渲染测试。`lib/` 提交进仓库的代价是：改了 `src/` 却忘了 `npm run build` 时，`tests/smoke.mjs` / `annotations.mjs` / `source-edit.mjs` 断言的是**旧产物**——先构建再测。
