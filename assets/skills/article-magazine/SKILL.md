---
name: article-magazine
description: Huashu / huashu-md-html-inspired magazine article layout for
  turning Markdown or notes into a polished long-form HTML essay.
metadata:
  portedFrom: opendesign
  od:
    mode: prototype
    surface: web
    platform: desktop
    scenario: marketing
    upstream: https://github.com/nexu-io/html-anything
    preview:
      type: html
      entry: index.html
      reload: debounce-100
    design_system:
      requires: false
    example_prompt: Use the Magazine Article template to turn my content into a
      Huashu / huashu-md-html-inspired long-form HTML essay. Preserve the
      template's visual signature, use real content and data, and avoid lorem
      ipsum or placeholder images.
    example_prompt_i18n:
      zh-CN: 用「杂志文章」模板把我的内容做成一份「Huashu / huashu-md-html-inspired magazine article
        layout for turning Markdown or notes into a polished long-form HTML
        essay」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。
---

【模板: 杂志文章】
- 顶部 hero: 大标题 (text-5xl/6xl) + 可选副标题 + 作者 / 阅读时间 / 日期元数据。
- 正文: 单栏, 最大宽度约 700px, 居中。段落 `text-lg leading-relaxed text-neutral-700 dark:text-neutral-300`。
- H2 / H3 标题用 serif 字体, 让正文与标题有视觉对比。
- 引用块使用左侧粗 accent 色边线 + 斜体。
- 代码块: 圆角 + 深色背景 + 浅色文字, 显示语言标签。
- 列表项使用自定义 bullet（小方块 / accent 圆点）。
- 章节之间用 `<hr>` 分隔, 但样式做成中央居中的小 ornament。
- 文末加一个简单的 "如果觉得有用，欢迎转发" 行动卡片。
