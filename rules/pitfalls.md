覆盖：易崩清单——「看起来没生效 / 保存不了 / 报 Skipped」这类现象的第一手对照表。何时读我：收到「改动没生效」「存不下去」「页面缺样式」一类报告，先按这份清单定位，再去看对应 rules 明细。

# 易崩清单

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
