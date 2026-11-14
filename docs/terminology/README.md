# 术语体系

范围：全仓库 Markdown 与产品双语文案。术语、缩写、用词与译名只有一个来源：本目录。正文、注释与文案直接使用规范写法，首次出现不展开。

## 目录结构

```text
terminology/
  README.md        体系入口：范围、文件职责与维护流程
  terms.md         术语、缩写、用词与改写对照表
  translation.md   翻译规则：界面文案、内容文件与术语对应
```

## 维护流程

- 新概念、新译名或新的禁用词先补 [terms.md](terms.md)，再在正文或文案使用。一个概念只用一个词，不混用缩写、全称或中英文变体。
- 新增界面或终端文案按 [translation.md](translation.md) 的双语规则同步两份 locale，插值参数保持一致。
- 术语、用词或译名变化时同步更新 terms.md 与受影响文案，再运行 `bun run format:check`、`bun run check:budgets` 与 `bun test app` 验证。
