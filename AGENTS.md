# AGENTS.md

本仓 `dsh-web-design` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：在侧栏里预览 `.html` 文件，选中元素改样式、改文字、移动、删除，最后经 **Save to file** 把改动写回 HTML 源文件本身。
它不打包 `@deepseek-ai/*`：harness 服务运行时从宿主解析；`@deepseek-ai/dsh-atomic-write` 与 `parse5` 是声明在 `dependencies` 里的运行时依赖。它也不注册任何技能。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-web-design`（版本 `0.1.0`）。
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
- `tests/` —— 三个 `node` 断言脚本（`smoke.mjs` / `annotations.mjs` / `source-edit.mjs`）与三个 vitest 套件（`client-apply.spec.ts` / `client-preview.spec.ts` / `frame-runtime.spec.ts`）。
- `demo/` —— 两份可打开的示例页面（`landing.html`、`modal-layout.html`）与一份示例 sidecar `landing.html.design.json`；截图只在 `docs/images/` 里存一份。

## 构建

```sh
npm install
npm run typecheck   # tsc --noEmit -p tsconfig.json
npm run build       # tsdown -c tsdown.config.ts && node build-client.mjs
npm test            # node tests/smoke.mjs && node tests/annotations.mjs && node tests/source-edit.mjs && vitest run
```

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`（ESM，`platform: node`，`dts: false`），所有 `@deepseek-ai/*` 保持 external。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react / `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译并内联成 `<style>` 标签。

**Node 不解析 TC39 装饰器。** tsdown 默认不降级装饰器，所以 `tsdown.config.ts` 里有一个 `lowerDecorators` transform（用 `typescript` 的 `transpileModule`）。少了它，`WebDesignRemote` 上的 `@Remote` 会以原始语法留在 `lib/index.mjs`，host 加载即崩。

**`lib/` 提交进仓库的理由只有一个**：`dsh plugin add <git-url>` 装的是仓库里的东西，不跑构建，所以源码与产物必须一起提交。

**改 client 必须重建 `lib/client.js`。** `build-client.mjs` 里的 `HANDOFF_ID` 是 `@guowenzhang/dsh-web-design`，它与 bundle 外层的 `window.__ModuleLoader__.load({ id, ... })` 配套；**不得随意改变**，否则页面继续跑旧 bundle。

## 组合接线（cordis.patch.yml）

`cordis.patch.yml` 把插件行插入组合的 bundle 层：

```yaml
- insert:
    - id: web-design
      name: '@guowenzhang/dsh-web-design'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这个补丁文件，`dsh.client.inject` 列出浏览器半边挂载时要用到的宿主 client 包：

```json
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-api-gateway",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-store",
      "@deepseek-ai/dsh-client-ui-primitives",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-theme"
    ],
    "platform": "web"
  },
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
}
```

host 半边 `inject: []`，一个服务都不 require；它用到的宿主服务是运行时 `ctx.get` 软取的（`sessions`、`sessionPersistence`、`sandboxPolicy`、`fs`），缺任何一个都表现为 Remote 调用报 `web-design/invalid`，而不是加载失败。

## 安装

四个变体，全部走官方命令；它把参数转发给 profile 目录里的 pnpm，**并自行维护 profile 清单**（依赖与 `dsh.profile.bundles` 一起加，不要手写）：

```sh
# npm 官方源
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-web-design

# HTTPS
npx @deepseek-ai/dsh plugin --profile web add git+https://github.com/zhang-guo-wen/dsh-web-design.git

# SSH
npx @deepseek-ai/dsh plugin --profile web add git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git

# 锁定发布 tag，默认分支上后续的临时提交不会被拉到
npx @deepseek-ai/dsh plugin --profile web add "git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git#v0.1.0"

# 本地目录开发安装，pnpm 建 symlink，重建 lib/ 后重启即生效，无需重装
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-web-design
```

本地目录安装时 pnpm 建的是 **symlink（记作 `link:`）**，所以重建 `lib/` 后重启即生效、无需重装；`file:` 依赖可能退化成物理拷贝，那时改源码不会影响正在跑的 dsh，要重装或手动同步 `lib/`。

`lib/` 已提交进仓库，所以装完即可运行，**使用者不需要构建**。卸载时依赖条目与 bundle 层一起移除：

```sh
npx @deepseek-ai/dsh plugin --profile web remove @guowenzhang/dsh-web-design
```

确认进了组合：

```sh
npx @deepseek-ai/dsh --profile web --dump-config | Select-String web-design
```

## 部署生效语义

- **host 半边是进程内模块。** 重建 `lib/index.mjs` 不会替换正在运行的那份代码；只有 `dsh plugin add/remove` 造成的重组才会把它 import 进进程，之后改源码必须**重启宿主**才生效。
- **client 半边按内容 revision 提供。** bundle 变了刷新页面就会取到新的；改了 `HANDOFF_ID` 或换了产物，浏览器硬刷新即可。
- sidecar（`<file>.design.json`）是产物旁边的普通文件，不受上面两条影响。

## 发版（Release）

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，`master` 上的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`（当前 `0.1.0`，已有 tag `v0.1.0`）。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 是最新的。
3. 提交源码与 `lib/`。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-web-design <version>"
   git push origin master --follow-tags
   ```

5. 验证安装（仓库根即包）：

   ```sh
   npx @deepseek-ai/dsh plugin --profile web add \
     "git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git#v<version>"
   ```

## 核心机制与设计决策

### 为什么 **Save to file** 是显式的

预览是**可交互**的：解析器已经把属性规范化（补引号、补隐含的 `html`/`head`/`body`），页面脚本也已经插入了自己的节点。此时把整个 DOM 序列化回文件，会重写全文件并丢掉注释、格式与作者写的结构。所以预览里的改动先累积在评审状态里，**只有 Save to file 改产物**。

### 每一次编辑按 source span rewrite 落地

`src/source-edit.ts` 用 parse5 带 `sourceCodeLocationInfo` 解析源码，把预览报上来的 selector 在**源元素树**上解析（`tag`、`tag#id`、`tag:nth-of-type(n)`，用 ` > ` 连接；其它文法一律报 skipped）：

- 样式与文本：只替换定位到的 `style` 属性值或那个文字节点；元素已有 `style` 时**就地增改**声明并保留其它属性与顺序，没有 `style` 时在最后一个属性之后追加。
- 删除：移除该元素**完整的源 span（含子节点）**。
- 其余字节**逐字保留**；起始位置重叠的请求报 `overlapping source edits`，而不是互相覆盖。

### 写入用同目录原子替换

`writeFileAtomic`（`@deepseek-ai/dsh-atomic-write`）在**同目录**建临时文件再 rename 覆盖，并对 Windows 临时共享错误做**有界重试**，读的人不会看到写了一半的文件。写 HTML 时沿用原文件权限位，写 sidecar 用 `0o600`。

### **Applied / Skipped** 的判定

`apply` 返回 `applied` / `skipped` / `bytes` / `changed`。selector 在源里**无法唯一定位**（元素不存在、id 重复、同级有歧义、同级数量与预览不符、文法不认识）时，该条进 `skipped` 并带原因；预览把它显示成「部分修改未能定位」，而不是谎报成功。

### 删除回放时的指纹校验

删除要在**页面刷新后**重放，所以每条删除都带着预览当时观察到的指纹：`text`（空白折叠后的全文）与 `classes`（class 名列表）。写文件前逐条比对，位置型 selector（含 `nth-of-type`）还要求整篇源码里指纹**唯一**；不符就报 **Skipped**，源元素原样不动。`html` / `head` / `body` 一律拒删。

写成功后，该元素及其后代在 review sidecar 里的样式编辑与文本替换会一并移除。

### 预览文档的隔离

预览把文件字节按 UTF-8 解出后注入运行时脚本（没有 `<body>` 就追加），再以 Blob URL 装进 iframe；sandbox 是 `allow-scripts allow-forms allow-popups allow-modals`，**没有 `allow-same-origin`**，被预览的页面因此拿到不透明源：读不到宿主文档、cookie 与存储，只能通过 `postMessage` 跟运行时说话。

## Sidecar

评审状态是预览文件旁边的 `<file>.design.json`（`SIDECAR_SUFFIX`），**随产物走**。字段：

```json
{
  "version": 1,
  "file": "/workspace/index.html",
  "comments": [],
  "edits": [{ "selector": "main > section.hero > h1", "declarations": { "font-size": "56px" }, "updatedAt": "2026-09-22T10:01:00.000Z" }]
}
```

`file` 是 Host 解析出来的**绝对路径**。浏览器给的是资源地址里的 Session id + 路径，Host 的解析顺序是：取该 Session 记录的 `cwd`（**没有 cwd 时用 `sandboxPolicy` 的配置工作区根**）→ 把路径解析到该根下 → 确认目标仍在 Session 工作区内 → `fs.stat` 必须是普通文件 → 返回绝对宿主路径。Session 不存在、没有工作区根、路径越界、或目标不是普通文件时，Remote 报 `web-design/invalid`；此时页面仍然可见，但评审保存与 **Save to file** 都不可用。

写入前 `validateWrite` 会拒绝 `document.file` 与请求路径不一致的载荷、非 `version: 1` 的载荷，并把注释限到 500 条、单条正文 8000 字符、样式编辑限到 500 条。旧 sidecar 里的 `comments` 会被保留并在写入时原样带回，但**当前预览没有注释/标注控件**。

## Model experience

插件只注册一个 Host Remote（`webDesignReview`）与一个 Sidebar body（`.html` / `.htm` 的文档预览 + `sidebar.right.tab.document` 座位），**不加 prompt 段、不加工具、不加技能**：会话的技能目录就是技能目录里的东西。预览是纯展示，评审状态只存在产物旁边的 sidecar 里；除非 agent 自己去读 sidecar，预览里做的事不会进入模型请求。

## 测试

```sh
npm test   # 三个 node 断言脚本 + vitest run
```

- `tests/smoke.mjs` —— 用真实 Cordis `Context` apply **构建后的** `lib/index.mjs`：导出、注册、卸载是否干净。
- `tests/annotations.mjs` —— sidecar 往返与拒绝路径：`validateWrite`、`readAnnotations` / `writeAnnotations`、`sidecarPath`，以及错 `file`、错 `version`、超限载荷。
- `tests/source-edit.mjs` —— 源编辑不碰无关字节、也不谎报成功：样式增改、文本替换、删除 span、selector 定位失败与重叠。
- `tests/client-apply.spec.ts`（jsdom）—— 浏览器半边的注册：文档预览声明、`sidebar.right.tab.document` 座位、字典、卸载。
- `tests/client-preview.spec.ts`（jsdom + Testing Library）—— 预览与编辑弹窗的交互。
- `tests/frame-runtime.spec.ts`（JSDOM）—— 注入运行时的消息协议与选择/移动行为。

`vitest.config.ts` 把 UI 套件与 CSS Modules 打桩，所以这些是**注册与行为测试**，不是 UI kit 的渲染测试。`lib/` 提交进仓库的代价是：改了 `src/` 却忘了 `npm run build` 时，`tests/smoke.mjs` / `annotations.mjs` / `source-edit.mjs` 断言的是**旧产物**——先构建再测。

## 易崩清单

1. 改 client 不重建 `lib/client.js`、不 bump `HANDOFF_ID`、也不硬刷新 → 浏览器跑旧 bundle（表现为「改动没生效」）。
2. 改 host 不重启宿主 → 进程内还是旧模块（重建 `lib/index.mjs` 本身不会替换运行中的代码）。
3. `@Remote` 装饰器没在构建期降级 → `lib/index.mjs` 带原始装饰器语法，host 加载即崩。
4. `lib/` 忘了提交 → 从 git 装的人拿到旧产物。
5. sidecar 的 `file` 与请求路径不一致，或 `version` 不是 `1` → `write` 报 `web-design/invalid`，评审存不下去。
6. Session 不存在、路径解析不出来、或目标越出 Session 工作区 → Remote 报 `web-design/invalid`；页面可见，但**保存不可用**。
7. selector 在源码里定位不唯一（元素由脚本生成、id 重复、同级有歧义）→ 报 **Skipped**，不是报错，文件不会被改坏。
8. 相对路径的 CSS / JS / 图片 / 字体不进预览 → 页面看起来缺样式，这不是崩溃。
9. 同级元素被脚本换位后，位置型 selector 可能指向别的兄弟 → 要写回文件的元素用稳定 id。
10. 在预览里改完却没点 **Save to file** → 产物一个字节都没变（改动只在 sidecar 与帧里）。
