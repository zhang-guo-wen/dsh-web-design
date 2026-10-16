---
paths:
  - "src/**"
  - "src/client/**"
  - "lib/**"
  - "tests/**"
  - "demo/**"
  - "docs/**"
  - "package.json"
  - "cordis.patch.yml"
  - "tsconfig.json"
  - "tsdown.config.ts"
  - "build-client.mjs"
  - "vitest.config.ts"
  - "README.md"
  - "README.zh.md"
---

> 覆盖：包定位与目录结构（每个源码 / 产物 / 测试文件的职责）。何时读我：新增或移动文件、判断某模块该放哪、确认「仓库根就是包」或运行时依赖边界时。

# 目录

本仓 `dsh-web-design` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：在侧栏里预览 `.html` 文件，选中元素改样式、改文字、移动、删除，最后经 **Save to file** 把改动写回 HTML 源文件本身。
它不打包 `@deepseek-ai/*`：harness 服务运行时从宿主解析；`@deepseek-ai/dsh-atomic-write` 与 `parse5` 是声明在 `dependencies` 里的运行时依赖。它也不注册任何技能。

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-web-design`（版本 `1.1.1`）。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

- `src/index.ts` —— host 入口：`name` / `inject: []` / `apply`，只注册下面这一个 Remote。
- `src/remote.ts` —— host 半边唯一的能力面：`webDesignReview` Remote 的 `read` / `write` / `apply`（三个 `@Remote` 方法），以及把浏览器给的 Session 地址解析成绝对宿主路径。
- `src/store.ts` —— sidecar 的读写、校验与限幅（`version` / `file` / `comments` / `edits` / `updatedAt`）。
- `src/source-edit.ts` —— 源文本 span 改写：selector 文法的解析与定位、`style` 属性就地增改、文字节点替换、删除整段源 span、删除指纹校验。
- `src/typert.ts` —— 浏览器半边 `ctx.remote.$mount` 挂载的 `TYPERT_REMOTE` 贡献（`read` / `write` / `apply` 三个 descriptor）。
- `src/types.ts` —— 两侧共享的类型，含两个 `RemoteError` detail kind（`web-design/invalid` / `web-design/io`）。
- `src/client/` —— 浏览器半边：`index.ts`（挂 Remote、注册字典、文档预览与 `sidebar.right.tab.document` 座位）、`HtmlDesignBody.tsx`（工具栏、iframe、编辑弹窗）、`frame-runtime.ts`（注入被预览页面的运行时）、`document.ts`（组预览文档）、`store.ts`、`locales.ts`、`HtmlDesignBody.module.css`。
- `lib/index.mjs` + `lib/client.js` —— 构建产物：**已提交进仓库**，这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `tests/` —— 三个 `node` 断言脚本（`smoke.mjs` / `annotations.mjs` / `source-edit.mjs`）与四个 vitest 套件（`client-apply.spec.ts` / `client-preview.spec.ts` / `client-render-cost.spec.ts` / `frame-runtime.spec.ts`）。
- `demo/` —— 两份可打开的示例页面（`landing.html`、`modal-layout.html`）与一份示例 sidecar `landing.html.design.json`；截图只在 `docs/images/` 里存一份。
