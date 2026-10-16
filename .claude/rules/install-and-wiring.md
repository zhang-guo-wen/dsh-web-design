---
paths:
  - "package.json"
  - "cordis.patch.yml"
  - "lib/**"
  - "README.md"
  - "README.zh.md"
---

> 覆盖：`cordis.patch.yml` 组合接线、四种安装方式，以及安装后什么改动才生效。何时读我：装 / 卸插件、确认插件是否进了组合，或解释「重建了产物但界面没变」时。

# 组合接线（cordis.patch.yml）

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

# 安装

四个变体，全部走官方命令；它把参数转发给 profile 目录里的 pnpm，**并自行维护 profile 清单**（依赖与 `dsh.profile.bundles` 一起加，不要手写）：

```sh
# npm 官方源
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-web-design

# HTTPS
npx @deepseek-ai/dsh plugin --profile web add git+https://github.com/zhang-guo-wen/dsh-web-design.git

# SSH
npx @deepseek-ai/dsh plugin --profile web add git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git

# 锁定发布 tag，默认分支上后续的临时提交不会被拉到
npx @deepseek-ai/dsh plugin --profile web add "git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git#v1.0.0"

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

# 部署生效语义

- **host 半边是进程内模块。** 重建 `lib/index.mjs` 不会替换正在运行的那份代码；只有 `dsh plugin add/remove` 造成的重组才会把它 import 进进程，之后改源码必须**重启宿主**才生效。
- **client 半边按内容 revision 提供。** bundle 变了刷新页面就会取到新的；改了 `HANDOFF_ID` 或换了产物，浏览器硬刷新即可。
- sidecar（`<file>.design.json`）是产物旁边的普通文件，不受上面两条影响。
