覆盖：sidecar（`<file>.design.json`）的字段与契约、Host 路径解析与校验限幅，以及插件对模型请求的影响。何时读我：改 `src/store.ts`、`src/remote.ts` 的路径解析 / `validateWrite`，或排查「评审存不下去 / 保存不可用 / 预览会不会进模型上下文」时。

# Sidecar

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

# Model experience

插件只注册一个 Host Remote（`webDesignReview`）与一个 Sidebar body（`.html` / `.htm` 的文档预览 + `sidebar.right.tab.document` 座位），**不加 prompt 段、不加工具、不加技能**：会话的技能目录就是技能目录里的东西。预览是纯展示，评审状态只存在产物旁边的 sidecar 里；除非 agent 自己去读 sidecar，预览里做的事不会进入模型请求。
