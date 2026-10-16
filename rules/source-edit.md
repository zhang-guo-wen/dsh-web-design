覆盖：写回文件的整条链路——为什么 Save to file 显式、source span rewrite、原子替换、Applied/Skipped 判定与删除指纹校验。何时读我：改 `src/source-edit.ts`、`src/remote.ts` 的 `apply`、或解释「为什么某一处改动没生效 / 报 Skipped」时。

# 核心机制与设计决策

## 为什么 **Save to file** 是显式的

预览是**可交互**的：解析器已经把属性规范化（补引号、补隐含的 `html`/`head`/`body`），页面脚本也已经插入了自己的节点。此时把整个 DOM 序列化回文件，会重写全文件并丢掉注释、格式与作者写的结构。所以预览里的改动先累积在评审状态里，**只有 Save to file 改产物**。

## 每一次编辑按 source span rewrite 落地

`src/source-edit.ts` 用 parse5 带 `sourceCodeLocationInfo` 解析源码，把预览报上来的 selector 在**源元素树**上解析（`tag`、`tag#id`、`tag:nth-of-type(n)`，用 ` > ` 连接；其它文法一律报 skipped）：

- 样式与文本：只替换定位到的 `style` 属性值或那个文字节点；元素已有 `style` 时**就地增改**声明并保留其它属性与顺序，没有 `style` 时在最后一个属性之后追加。
- 删除：移除该元素**完整的源 span（含子节点）**。
- 其余字节**逐字保留**；起始位置重叠的请求报 `overlapping source edits`，而不是互相覆盖。

## 写入用同目录原子替换

`writeFileAtomic`（`@deepseek-ai/dsh-atomic-write`）在**同目录**建临时文件再 rename 覆盖，并对 Windows 临时共享错误做**有界重试**，读的人不会看到写了一半的文件。写 HTML 时沿用原文件权限位，写 sidecar 用 `0o600`。

## **Applied / Skipped** 的判定

`apply` 返回 `applied` / `skipped` / `bytes` / `changed`。selector 在源里**无法唯一定位**（元素不存在、id 重复、同级有歧义、同级数量与预览不符、文法不认识）时，该条进 `skipped` 并带原因；预览把它显示成「部分修改未能定位」，而不是谎报成功。

## 删除回放时的指纹校验

删除要在**页面刷新后**重放，所以每条删除都带着预览当时观察到的指纹：`text`（空白折叠后的全文）与 `classes`（class 名列表）。写文件前逐条比对，位置型 selector（含 `nth-of-type`）还要求整篇源码里指纹**唯一**；不符就报 **Skipped**，源元素原样不动。`html` / `head` / `body` 一律拒删。

写成功后，该元素及其后代在 review sidecar 里的样式编辑与文本替换会一并移除。
