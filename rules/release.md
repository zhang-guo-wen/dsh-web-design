覆盖：发版（Release）的判定与五个步骤。何时读我：要改版本号、打 tag、验证按 tag 安装时。

# 发版（Release）

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，`master` 上的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`（当前 `1.0.1`，已有 tag `v1.0.0`）。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 是最新的。
3. 提交源码与 `lib/`。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-web-design <version>"
   git push dsh-web-design master --follow-tags
   ```

5. 验证安装（仓库根即包）：

   ```sh
   npx @deepseek-ai/dsh plugin --profile web add \
     "git+ssh://git@github.com/zhang-guo-wen/dsh-web-design.git#v<version>"
   ```
