# 翻译规则

适用范围：产品界面、终端文案与内容文件的中英文本。`docs/` 目前只维护中文，不提供英文对照。

## 界面与终端文案

- 通用界面文案、无障碍标签、首页 SEO 与终端提示存放于 `app/i18n/locales/zh-CN.json` 与 `en.json`，两个语言的键和插值参数必须一致。新增文案先写中文再补英文，两份同步修改。Markdown 页面的正文、SEO 与横幅替代文本维护在对应内容文件，不在 locale 重复存放。
- 页面使用 `useSiteLocale().t()`，终端命令使用 `ctx.t()` 并通过 `summaryKey`、`usageKey` 提供帮助文案，不在组件硬编码文字。
- 语言选择保存在 `xca-locale` Cookie。默认中文，无效值回退中文，服务端首屏按已选语言渲染。
- 切换语言保留终端目录、输入草稿和命令历史。已有命令结果保留执行时的语言，新命令按当前语言执行。

## 内容文件

- `app/data/hero-sentences.json` 按语言维护首页轮播语句。
- `app/data/terminal/manifest.ts` 维护虚拟工作区结构与文件清单，双语正文按语言分别存放于 `app/data/terminal/files/`，不区分语言的正文只有一份。成对正文按行对应：两种语言的行数、行类型、插值占位符与 `export` 指令逐行一致，段落不硬换行，折行由终端完成。译文基线记录在 `app/data/terminal/translation-baseline.json`，任一侧改字都会失配；完成翻译后运行 `bun run texts:stamp` 重新登记。
- 关于学社分别维护于 `content/pages/about/zh-CN.md` 与 `en.md`。正文使用 Markdown，frontmatter 的 `locale`、`title`、`description` 与 `banner` 由 `content.config.ts` 的 `about` 集合校验。
- 页面按 `useSiteLocale().locale` 查询 Markdown，服务端首屏与客户端切换使用同一语言状态。修改标题、章节、段落、链接和页面元信息只需修改对应 Markdown，不调整 Vue。

## 术语对应

- 译名以 [terms.md](terms.md) 为唯一来源。概念按中文规范词（如“会话”），代码类名保留英文（如 `Session`），材质名中英固定对应（极光玻璃 ↔ Aurora Glass）。
- 缩写在两种语言中都写缩写，不展开全称。
- 中文文案用全角标点并遵循汉字间距规则，英文文案用半角标点，数字一律半角。

## 验证

- `bun test app` 覆盖 locale 键与插值一致性，以及终端成对正文的结构与译文基线（`app/data/terminal/text-sync.test.ts`）。
- 双语 E2E 覆盖切换、刷新、服务端渲染与虚拟文件读取（见 `tests/e2e/`）。
- 文档侧运行 `bun run format:check` 与 `bun run check:budgets`。
