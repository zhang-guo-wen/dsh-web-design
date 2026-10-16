---
paths:
  - "src/**"
  - "src/client/**"
  - "lib/**"
  - "tests/**"
  - "tsdown.config.ts"
  - "build-client.mjs"
  - "tsconfig.json"
  - "package.json"
---

> 覆盖：构建命令、产物形态，以及「为什么必须这样构建」。何时读我：改 `src/`、`tsdown.config.ts`、`build-client.mjs`，或怀疑产物与源码不一致时。

# 构建

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
