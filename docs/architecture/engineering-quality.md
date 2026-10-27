# 工程质量契约

Status: adopted

格式与 Lint 分别执行并报告。变更作者负责完成适用检查，审查者核对改动范围、工具配置和实际验证结果。源码与命令定义优先于文档描述。

## 本地开发与共享依赖

早期开发需要同级 `../Neoverse-UI` 工作区，先在共享库执行 `bun install --frozen-lockfile --linker hoisted`，再在门户安装依赖。依赖声明以 [package.json](../../package.json) 为准，本地 `file:` 依赖与根级 overrides 共同约束共享包来源，不能混用本地与发布包。依赖来源检查同时读取两处声明，同名 override 不能隐藏另一来源。

```sh
bun install
bun run dev
```

`dev` 先执行 `ui:sync` 再启动 Nuxt。`build`、`generate`、`typecheck` 与 `check` 使用已安装依赖，不隐式同步。修改共享库后先执行 `bun run ui:sync`；包依赖声明变化时先运行 `bun install` 更新锁文件，不能将冻结同步当作锁文件更新。

[同步入口](../../scripts/sync-neoverse-ui.ts) 委托共享库的 `scripts/sync-consumer.ts --consumer <portal>`。先以冻结锁文件刷新本地包，再由共享同步器按依赖顺序构建、同步安装目录和嵌套副本并逐文件核对，内容相同的硬链接不重复复制。门户不维护第二套产物复制脚本。缺少同级同步器时明确失败；改用发布包后同步入口直接返回，不构建同级工作区。

[依赖来源检查](../../scripts/ui-dependencies.ts) 只区分本地、发布和混合来源，不验证发布版本兼容性，也不证明本地路径属于正确工作区；实际路径由共享同步器核对。[来源回归测试](../../scripts/ui-dependencies.test.ts) 覆盖同名 override 与两处声明的冲突。

存在 `file:` 依赖时，[Nuxt 配置](../../nuxt.config.ts) 将共享模块解析到同级构建产物并排除运行模块的依赖预打包，Vue 由门户统一解析。CSS 仅引入共享公开导出，不复制生成样式。共享 CSS 已预编译，因此关闭 Nuxt 对其重复执行的 Autoprefixer 处理，避免误解析其 `@supports` 子句。

开发与预览使用 `3100` 端口和 `strictPort`。启动前检查占用，端口冲突时失败，不终止无关进程或自动换端口。

正式发布前，将 `file:` 依赖及 overrides 改为经过验证的 npm 精确版本，移除本地同步入口和脚本，并删除本地解析配置。仅使同步脚本直接返回不等于完成迁移。复验冻结安装、类型、构建、开发和生产页面后再记录发布包验收；本地同步成功不等于 npm 包或远端 CI 验证通过。

## 格式工具

| 对象 | 工具与配置 |
| --- | --- |
| JavaScript、TypeScript、Vue、CSS、JSON、SVG | Biome，配置见 [biome.json](../../biome.json) |
| Markdown、YAML | Prettier，配置见 [.prettierrc.json](../../.prettierrc.json) 与 [.prettierignore](../../.prettierignore) |
| 编码、缩进与行尾 | [.editorconfig](../../.editorconfig) 与 [.gitattributes](../../.gitattributes) |
| 编辑器格式化与扩展建议 | [.vscode/settings.json](../../.vscode/settings.json) 与 [.vscode/extensions.json](../../.vscode/extensions.json) |

文件使用 UTF-8、LF、两空格缩进和末尾换行。代码使用双引号、分号与末尾逗号，具体换行由格式化器决定。Markdown 行文与表格规范见 [文档写作规范](../AGENTS.md)。

Biome 启用 Vue 的实验性 HTML 格式化，关闭 Markdown 与 YAML 格式化，避免与 Prettier 重复处理。Markdown 保留正文原有换行，紧凑表格格式由现有 Prettier 插件维护。

## 格式、Lint 与构建

命令定义以 [package.json](../../package.json) 为准。

| 命令 | 行为 |
| --- | --- |
| `bun run format` | 写入格式化结果并整理 import，不执行 Lint 修复 |
| `bun run format:check` | 检查格式与 import 顺序，不修改文件 |
| `bun run lint` | 单独执行 Biome Lint，不修改文件 |
| `bun run build` | 构建当前 Nuxt 应用 |

格式命令使用 `biome check` 的 formatter 与 assist 能力，并关闭 Lint；`biome format` 不执行 import assist。格式检查通过不能作为 Lint 通过的证据。

## 门禁与执行

命令定义维护在 [package.json](../../package.json)，门禁顺序维护在 [聚合器](../../scripts/run-gates.ts)。

| 命令 | 行为 |
| --- | --- |
| `bun run check:fast` | 格式、Lint、预算、文档链接、静态导入、应用类型、治理类型与单测 |
| `bun run check` | 快速门禁全部通过后执行生产构建 |
| `bun run check:budgets` | 检查文件、函数与文档内容量 |
| `bun run check:docs` | 检查 Markdown 仓库内链接的文件目标 |
| `bun run check:architecture` | 检查应用的静态导入解析与循环 |
| `bun run typecheck` | 应用类型检查 |
| `bun run test` | 治理单元测试与命令行回归 |

快速门禁单项失败后继续执行其余项，结束时汇总全部失败；有失败时不继续生产构建。治理脚本、浏览器配置和测试由 [tsconfig.quality.json](../../tsconfig.quality.json) 严格检查，不能只检查应用类型。Lint 无 error 为通过，Lint 诊断与预算审查提示实时输出，格式通过不能替代 Lint。

## 浏览器回归

相关测试与对应实现同笔提交，不在后续另拆测试提交。测试入口为 `bun run test:e2e`，先构建再执行 Playwright。配置见 [playwright.config.ts](../../playwright.config.ts)，当前 [共享 UI 用例](../../tests/e2e/shared-ui.spec.ts) 检查首页的共享公开 CSS 变量、页面运行错误和 Hydration 警告，覆盖桌面、窄屏、浅色、深色与减少动画；不依赖初始页面文案。

Windows 使用已安装的 Edge，其他平台先执行 `bunx playwright install chromium`。测试预览使用 3102，可显式设置 `XCA_TEST_PORT`。启动前确认端口空闲，不自动换端口，不复用未知服务；测试结束由 Playwright 清理自己启动的预览。构建已经完成时可以直接运行 `bunx playwright test` 复用该产物。

同步入口的分支回归见 [ui-sync.test.ts](../../scripts/ui-sync.test.ts)，使用独立临时目录验证发布包跳过、同名来源冲突和缺失同步器，不执行安装或写入共享库。

本地浏览器功能检查不等于截图、视觉、远端 CI 或发布包验收。新增业务后同步更新相应测试，不为通过当前测试提前引入后续页面和终端。

## 代码和文档预算

阈值与例外维护在 [预算配置](../../scripts/quality-budgets.json)，实现见 [预算检查](../../scripts/check-budgets.ts)。

| 对象 | SHOULD 审查 | MUST 超限说明 |
| --- | --: | --: |
| TS、JS、Vue | 300 行 | 500 行 |
| CSS | 400 行 | 600 行 |
| 测试文件 | 400 行 | 700 行 |
| 函数与方法 | 60 行 | 100 行 |
| 根 AGENTS | 200 行 | 250 行 |
| 子目录 AGENTS | 100 行 | 120 行 |
| 其他 Markdown | 500 行 | 不设行数硬限 |
| Markdown 内容量 | 6000 单位 | 12000 单位 |

CRLF 归一为 LF，末尾换行不额外计空行，空行和注释计入行数。每个 Han 字符或连续的非 Han 字母、数字、下划线计为一个内容单位，代码、链接与表格按原文计算。函数通过 TypeScript AST 识别，Vue 只提取 script；外层函数包含嵌套函数，名称与同名遍历序号共同标识预算项。

范围由 Git 已跟踪与未忽略的未跟踪文件决定。依赖和生成物通过既有忽略规则排除，`.agents/` 不参与预算。软超限输出 REVIEW，由审查者核对职责、复杂度与重复实现，不为了行数拆文件。硬超限必须登记原因与当前精确上限，后续增长重新审查；不得通过提高阈值或排除手写文件隐藏问题。当前配置没有功能预算例外。

## 静态检查及局限

[静态导入检查](../../scripts/check-architecture.ts) 扫描 app 中 TS、Vue 模块并排除 `.test.ts`，读取 import、export-from 及字面量 import()/require()，解析相对路径和 `~/`、`@/` 别名，验证资源查询路径，报告无法解析的本地导入与循环。实现复用 [源码分析](../../scripts/source-analysis.ts)，不引入依赖图框架。

此检查只分析显式静态路径，不解析 Nuxt 自动导入或运行时拼接的路径，不验证第三方包导出、运行时生命周期或功能分层。功能分层规则随对应能力引入，不能将当前通过写成终端或其他功能的边界验证。

[文档链接检查](../../scripts/check-docs.ts) 跳过围栏、行内代码、外部协议和片段，核对文件目标存在；不检查片段有效性、外链连通性或 Markdown 全部语法。内部片段和正文事实仍由人工核对。当前应用保持初始入口，治理测试使用自建临时文件，不依赖后续页面、翻译或字体。

## 修改与审查

- Lint 必须无 error，warning 与 info 保留可见，并在交付说明中解释与本次改动相关的诊断。
- 不通过关闭规则、扩大忽略、抑制诊断或删除检查掩盖缺陷。规则调整说明对象、依据和影响，由审查者核实。
- 按改动范围格式化，保护无关未提交内容；只需检查时使用不写入的命令。
- 新增源码注释使用双语，英文在上、中文在下，每条一句话；不为格式调整改写无关内容。
- 修改工具依赖时同步锁文件，复验冻结安装、格式、Lint 与生产构建。锁文件由 Bun 生成，不手工拼接。构建完成后启动预览并请求首页，确认返回 200 且包含实际页面内容；构建成功和进程启动不等同于页面可用。
- 工具版本与依赖来源由 `package.json` 和锁文件维护，不在文档复制版本列表。格式工具变化与应用依赖、功能变化分别审查。

Nuxt、Vue 与 Router 的声明及锁定结果保持兼容，核对根依赖与 Nuxt 实际使用的框架版本。Nuxt Content 使用的 SQLite 连接器通过 `better-sqlite3` 显式声明为运行时依赖。安装必须执行项目的 `postinstall`，不能把跳过安装脚本的结果作为完整安装通过。

## 验证对象

候选提交在基准文件与本阶段改动组成的隔离目录中验证。完整开发工作区可以包含尚未提交的功能，其检查结果不能替代候选提交的结果。

记录实际执行的命令、结果和未覆盖范围。不把静态检查写成构建或浏览器验收，不把本地结果写成远端 CI 结果。提交前核对差异、候选文件范围与检查后是否发生内容变化。
