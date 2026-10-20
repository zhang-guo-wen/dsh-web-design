# AGENTS.md

本仓 `dsh-web-design` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：在侧栏里预览 `.html` 文件，选中元素改样式、改文字、移动、删除，最后经 **Save to file** 把改动写回 HTML 源文件本身。
它不打包 `@deepseek-ai/*`（harness 服务运行时从宿主解析），运行时依赖是 `dependencies` 里的 `@deepseek-ai/dsh-atomic-write` 与 `parse5`；不注册任何技能。

**仓库根就是包**：`package.json` 即 `@guowenzhang/dsh-web-design`。`dsh plugin add <git-url>` 取的是仓库根，包放到 `packages/*` 下会被装成错误的东西。`lib/index.mjs` + `lib/client.js` 是**已提交进仓库**的构建产物，这样别人可以直接从 git 安装——改完源码必须 `npm run build` 并把 `lib/` 一起提交。

## 目录结构（速览）

- `src/` —— host 半边：`index.ts`（入口，`name` / `inject: ['fs']` / `apply`）、`remote.ts`（`webDesignReview` 的 `read` / `write` / `apply` / `assets` 与 Session 路径解析）、`preview-server.ts`（web 端专用资源路由）、`store.ts`（sidecar 读写、校验与限幅）、`source-edit.ts`（源 span 改写）、`typert.ts`（`TYPERT_REMOTE` descriptor）、`types.ts`（共享类型与两个 `RemoteError` detail kind）。
- `src/client/` —— 浏览器半边：`index.ts`（挂 Remote、注册字典、`sidebar.right.tab.document` 座位）、`HtmlDesignBody.tsx`、`frame-runtime.ts`、`document.ts`、`store.ts`、`locales.ts`、`HtmlDesignBody.module.css`。
- `lib/` —— 构建产物，**已提交**；`cordis.patch.yml` —— 组合接线。
- `tests/` —— 三个 `node` 断言脚本（`smoke.mjs` / `annotations.mjs` / `source-edit.mjs`）与八个 vitest 套件（`assets-read` / `client-apply` / `client-inline` / `client-preview` / `client-preview-url` / `client-render-cost` / `frame-runtime` / `preview-route`）。
- `demo/` —— 示例页面与示例 sidecar；截图只在 `docs/images/` 里存一份。
- 逐文件职责与「为什么这样分包」见 [.claude/rules/project-structure.md](.claude/rules/project-structure.md)。

## 构建与测试

```sh
npm install
npm run typecheck   # tsc --noEmit -p tsconfig.json
npm run build       # tsdown -c tsdown.config.ts && node build-client.mjs
npm test            # node tests/smoke.mjs && node tests/annotations.mjs && node tests/source-edit.mjs && vitest run
```

host 用 `tsdown` 打 `lib/index.mjs`（`@deepseek-ai/*` external），client 用 `build-client.mjs`（rolldown）打 `lib/client.js`。**先构建再测**：三个 `node` 断言脚本断言的是**构建后的 `lib/`**，改了 `src/` 却忘了构建时它们测的是旧产物。套件逐项说明见 [.claude/rules/testing.md](.claude/rules/testing.md)。

## 关键硬约束

1. **改 client 必须重建 `lib/client.js`。** `build-client.mjs` 的 `HANDOFF_ID`（`@guowenzhang/dsh-web-design`）与 bundle 外层的 `window.__ModuleLoader__.load({ id, ... })` 配套，**不得随意改变**，否则页面继续跑旧 bundle。
2. **`@Remote` 必须在构建期降级。** `tsdown.config.ts` 的 `lowerDecorators` transform 不能删，否则 `lib/index.mjs` 带原始装饰器语法，host 加载即崩。
3. **改 host 必须重启宿主。** `lib/index.mjs` 是进程内模块，重建不会替换运行中的代码；client 半边按内容 revision 提供，产物变了刷新页面即可。
4. **`lib/` 与源码一起提交**：`dsh plugin add <git-url>` 装的是仓库里的东西，不跑构建。
5. **sidecar 契约**：`document.file` 必须与请求路径一致、`version` 必须是 `1`；`file` 是 Host 解析出的绝对路径，Session / 工作区 / 普通文件任一不成立就报 `web-design/invalid`——页面仍可见，但评审保存与 Save to file 都不可用。
6. **写文件只走 source span rewrite**：其余字节逐字保留，位置重叠报 `overlapping source edits`，定位不唯一进 **Skipped**（带原因，不是报错），`html` / `head` / `body` 一律拒删。
7. **同目录资源靠内联，这是两端唯一的可行路径**：预览文档是 Blob，没有目录，`href="assets/app.css"` 解析不到。客户端从 HTML 取相对引用（跳过注释区），经 `webDesignReview.assets` 读回同目录的 `.css`/`.js` 内联成 `<style>`/`<script>`，图片转 `data:` URL。`/api/web-design/preview` 路由只在 web 端注册，**桌面端走 IPC、没有 `connection` 服务**，所以路由不能作为主路径。**`inject` 不得包含 `connection`**——Cordis 会因服务缺失让整个插件不加载，连 Remote 都没有，预览与保存一起失效（已实测）。注释区原样保留，Save to file 会写回。注入的帧 chrome 颜色是字面量，是本仓 CSS 规范的已知例外，不要把 `--dsw-*` 写进去（会解析成空值）。
8. **悬停不进渲染路径**：`HtmlDesignBody` 显式忽略 `hover`，由 `tests/client-render-cost.spec.ts` 守住；滚动上报与回放的任一侧消息处理被删，滚动保留就静默失效。
9. **在预览里改完必须点 Save to file**，产物才会变；未保存时改动只在 sidecar 与帧里。
10. **发版 = 改版本号 + 构建 + 提交产物 + 打 tag**，别人按 tag 安装，`master` 上的临时提交不会被他们拿到。

## 详细规则

明细放在 `.claude/rules/`，每个文件开头写明覆盖范围与何时读它。这些规则带 `paths:` 路径作用域：agent 读到匹配 glob 的文件后，会在下一次请求自动注入（每会话至多一次），也可以按需主动读取；**没有 `paths:` 的规则会像 `CLAUDE.md` 一样每次会话都注入**，所以明细必须带作用域。改动前先读与本次改动相关的那一页，不要凭印象改。

- [.claude/rules/project-structure.md](.claude/rules/project-structure.md)：包定位与目录结构，每个源码 / 产物 / 测试文件的职责。
- [.claude/rules/build.md](.claude/rules/build.md)：构建命令与产物形态、装饰器降级、`lib/` 提交理由、`HANDOFF_ID`。
- [.claude/rules/install-and-wiring.md](.claude/rules/install-and-wiring.md)：`cordis.patch.yml` 接线、四种安装方式、部署生效语义。
- [.claude/rules/release.md](.claude/rules/release.md)：发版判定与五个步骤（版本号、构建、提交、tag、验证安装）。
- [.claude/rules/source-edit.md](.claude/rules/source-edit.md)：Save to file 为什么显式、source span rewrite、原子写入、Applied/Skipped、删除指纹校验。
- [.claude/rules/preview-and-editor.md](.claude/rules/preview-and-editor.md)：预览隔离、悬停与滚动、加载与失败态、编辑面板两级字段与停靠偏好。
- [.claude/rules/sidecar.md](.claude/rules/sidecar.md)：sidecar 字段、Host 路径解析、`validateWrite` 限幅，以及 Model experience。
- [.claude/rules/testing.md](.claude/rules/testing.md)：七个套件各守什么、`vitest.config.ts` 打桩范围、先构建再测。
- [.claude/rules/pitfalls.md](.claude/rules/pitfalls.md)：易崩清单十条，现象到原因的对照表。
