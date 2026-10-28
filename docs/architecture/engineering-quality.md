# 工程质量规则

Status: adopted

变更作者负责随改动更新本文的事实和相关测试。审查者重点核对三项：改动是否越过架构边界、预算例外是否说明原因、规则条文是否变动。

## 决策背景与取舍

检查使用 Biome、Prettier、TypeScript、Bun Test、Playwright 和 TypeScript AST，分别执行格式、Lint、类型、单元测试、浏览器回归及源码分析，不引入第二套 Linter 或依赖图框架。

CI 联合检出共享库时固定到具体提交，实际 SHA 只维护在 `.github/workflows/quality.yml` 一处。浮动分支无法保证检出一致，门禁结果也就不可复现。本地允许修改共享库工作区，所以本地通过不等于固定版本的 CI 通过。更新固定 SHA 时必须复验包接口、冻结安装、构建和浏览器回归。这是早期开发阶段的依赖准备。正式发布改用 npm 精确版本后，联合检出、`ui:sync`、本地 `file:` 依赖与别名一并移除，锁文件成为唯一依赖依据。接入方式见 [本地开发与共享依赖](#本地开发与共享依赖)。

运行时依赖必须显式声明并进入锁文件，不依赖工作区残留副本（Nuxt Content 依赖的 `better-sqlite3` 已显式声明）。早期开发阶段 Neoverse-UI 可使用 `file:` 依赖。正式发布必须改为 npm 精确版本并重新生成锁文件。CI 固定 Node 24，满足该连接器的 Node 22+ 要求。

CI 只缓存 Bun 的下载目录，不缓存 node_modules 和构建输出。早期开发阶段每个平台同步一次共享 UI，再构建一次门户并复用该产物运行测试。发布版本改用 npm 精确版本后只安装一次依赖。图片基线只保留 Windows 一份。Linux 运行全部测试中的功能断言，用 Playwright `--ignore-snapshots` 避免把 Windows 图片当作 Linux 基线。Linux 的图片验收要单独建立并人工审核基线，不能自动生成后宣称通过。

## 本地开发与共享依赖

早期开发需要同级 `../Neoverse-UI` 工作区，先在共享库执行 `bun install --frozen-lockfile --linker hoisted`，再在门户安装依赖并启动。依赖来源以 [package.json](../../package.json) 为准，本地 `file:` 依赖与根级 overrides 不能混用本地与发布来源。

```sh
bun install
bun run dev
```

`dev` 先执行 `ui:sync` 再启动 Nuxt。`build`、`generate`、`typecheck`、`check` 和 `test:e2e` 使用已安装依赖，不隐式同步。修改共享库后先单独运行 `bun run ui:sync`。包依赖声明变化时先执行 `bun install` 更新锁文件。

早期开发使用本地 `file:` 依赖与根级 overrides。同步脚本委托共享库的 `scripts/sync-consumer.ts`，按依赖顺序构建 Tokens、Motion、Overlay Runtime、Glass Runtime、Tailwind 与 Vue，再刷新安装目录中的产物并逐文件核对。包含嵌套副本，跳过内容相同的硬链接文件，使用冻结锁文件安装。

[依赖来源检查](../../scripts/ui-dependencies.ts) 同时读取 dependencies 与 overrides，同名 override 不能隐藏另一来源。只区分本地、发布和混合来源，不验证发布版本兼容性。实际本地路径由共享同步器核对。[来源回归测试](../../scripts/ui-dependencies.test.ts) 和 [同步入口回归](../../scripts/ui-sync.test.ts) 使用隔离夹具验证来源冲突、发布包跳过与缺失同步器，不执行安装或写入共享库。

存在 `file:` 依赖时，`nuxt.config.ts` 将共享模块解析到本地构建目录并排除相应依赖预打包，Vue 由门户统一解析。共享组件 JS 与生成 CSS 一起同步，不混用不同来源的产物。CI 固定版本与本地工作区的验证区别见 [CI 决策](#决策背景与取舍)。

### 切换到发布包

1. 确认所选发布包包含门户使用的公开组件与接口，包括 `UiTerminalEcho`。
2. 将 `package.json` 与 overrides 中的 `file:` 依赖改为兼容的 npm 精确版本，更新并核对锁文件。
3. 移除本地别名、同步入口及 CI 联合检出与同步步骤，确认开发、构建和检查均不再调用 `ui:sync`。
4. 运行类型、生产构建和完整浏览器回归，分别记录本地检查、远端 CI 与图片验收。

`nuxt.config.ts` 在没有 `file:` 依赖时停用本地别名。同步脚本也会直接返回，但脚本和 CI 的退出仍须显式完成，不能把不再执行同步当作相关配置已经删除。

## 命令与端口

命令定义维护在 [package.json](../../package.json)，应用与预览配置分别见 [nuxt.config.ts](../../nuxt.config.ts) 和 [playwright.config.ts](../../playwright.config.ts)。

| 命令 | 用途 |
| --- | --- |
| `bun run ui:sync` | 早期开发同步共享库产物 |
| `bun run check:fast` | 快速门禁，不含构建 |
| `bun run format:check` / `bun run lint` | 分别检查格式与 Lint |
| `bun run check:docs` / `bun run check:budgets` | 文档链接与预算检查 |
| `bun run check:architecture` / `bun run check:terminal` | 导入依赖与终端 UI 约束 |
| `bun run typecheck` / `bun run test` | 应用类型与单元测试 |
| `bun run check` | 全部快速门禁与生产构建 |
| `bun run build` / `bun run generate` | 生产构建与静态生成 |
| `bun run test:e2e` | 生产构建与浏览器回归 |
| `bun run format` | 按需格式化并整理 import |

开发与预览使用 `3100` 端口和 `strictPort`，端口被占用时失败，不自动更换。E2E 预览默认使用 `3102`，可通过 `XCA_TEST_PORT` 指定。启动前确认占用，不终止无关进程。

## 工具链与依赖维护

版本以 manifest 与锁文件为准，不在文档维护另一份“最新版本”列表。预编译的 Neoverse-UI 样式关闭 Nuxt 重复 Autoprefixer 处理，该配置及原因维护在 `nuxt.config.ts`。升级 TypeScript、vue-tsc 或使用编译器 API 的检查脚本时，复验应用类型、检查脚本类型、单元测试与构建。

检查更新与安全审计使用公开 registry，避免未提供审计接口的镜像影响结果：

```sh
bun outdated --no-cache --registry https://registry.npmjs.org
bun audit --registry https://registry.npmjs.org
```

漏洞版本范围与修复状态以当次审计和上游公告为准，带日期的结果归 `.agents/notes/audits/`。旧记录不构成当前安全结论，不以忽略审计或不兼容的 overrides 隐藏问题。字体资源与子集生成单独维护在 [字体与资产维护](fonts.md)。

## 分级与执行责任

| 级别 | 规则 | 执行 |
| --- | --- | --- |
| MUST | 格式和 import assist | `format:check`，CI 阻断 |
| MUST | Lint 无 error，保留历史 warning/info 可见 | `lint`，CI 阻断 error |
| MUST | 类型、单测、终端 UI 与架构边界 | `check:fast`，CI 阻断 |
| MUST | 新增超硬预算或存量超限增长须说明 | `check:budgets`，未登记精确上限及原因则阻断 |
| MUST | 生产构建、现有功能 E2E | CI 在 Windows/Linux 执行；Windows 另含图片断言 |
| SHOULD | 软预算、认知复杂度 >25、深层嵌套、模块职责变化、重复实现与状态竞争 | Biome/预算输出 + 人工审查 |
| MUST | 例外、提高预算、抑制误报、跨仓库公共接口 | 审查者核实依据，不以消除诊断为理由 |
| MAY | 有证据的重构、额外平台或性能验证 | 按收益与风险选择，不为了指标制造工作 |

`check:fast` 与 `check` 都使用已安装的依赖，不隐式同步共享 UI。早期开发修改共享库后，先按 [依赖准备](#本地开发与共享依赖) 执行同步。两者由 `scripts/run-gates.ts` 聚合执行。检查脚本、Playwright 配置与 E2E 源码均由 [tsconfig.quality.json](../../tsconfig.quality.json) 严格检查。Lint 诊断与软预算提示实时输出，不以成功摘要代替审查信息。快速门禁单项失败不中断其余项，结束时汇总全部失败。`check` 只在快速门禁全部通过后继续生产构建。`test:e2e` 先构建，再运行浏览器回归。CI 分别执行快速门禁、生产构建和浏览器回归，复用同一构建产物。命令定义见 [package.json](../../package.json)，CI 步骤见 [工作流](../../.github/workflows/quality.yml)。

## 浏览器回归

相关测试与对应实现同笔提交，保留已有检查及共享 UI 回归，不删除正反例或缩小检查范围来隐藏失败。`bun run test:e2e` 先构建再执行 Playwright，已有构建产物可直接用 `bunx playwright test` 复验。Windows 使用已安装的 Edge，其他平台先执行 `bunx playwright install chromium`。CI 的浏览器准备见 [工作流](../../.github/workflows/quality.yml)。

预览使用 [测试配置](../../playwright.config.ts) 中的独立端口，启动前确认空闲，不复用未知服务。测试结束由 Playwright 清理自己启动的服务。[共享 UI 用例](../../tests/e2e/shared-ui.spec.ts) 检查公开 CSS 变量、运行错误与 Hydration 警告。其余用例覆盖终端、主题、双语、菜单、入场和滚动。

本地功能检查、图片回归、人工视觉验收、远端 CI 与发布包验收分别记录，不能相互代替。

## 格式工具

Biome 负责代码、CSS、JSON、SVG 及 Vue 的实验性 HTML 格式化，Prettier 负责 Markdown 与 YAML。工具配置分别维护在 `biome.json`、`.prettierrc.json` 和 `.prettierignore`，编辑器配置位于 `.vscode/`，编码与行尾由 `.editorconfig` 和 `.gitattributes` 约束。

`format` 和 `format:check` 使用 `biome check` 的格式化与 import assist 能力，并关闭 Lint 修复。`biome format` 不执行 import assist。`lint` 单独运行，格式通过不能作为 Lint 通过的证据。Markdown 保留正文换行，表格格式和行文规则见 [文档写作规范](../AGENTS.md)。

## 代码和文档预算

阈值与例外维护在 [预算配置](../../scripts/quality-budgets.json)，实现见 [预算检查](../../scripts/check-budgets.ts)。

| 类型 | SHOULD 审查 | MUST 超限说明 |
| --- | --: | --: |
| TS/JS/Vue 文件 | 300 行 | 500 行 |
| CSS | 400 行 | 600 行 |
| 测试文件 | 400 行 | 700 行 |
| 单函数/方法/箭头函数 | 60 行 | 100 行 |
| 根 AGENTS | 200 行 | 250 行 |
| 子目录 AGENTS | 100 行 | 120 行 |
| 其他 Markdown（含架构） | 500 行 | 不设行数硬限 |
| 所有 Markdown 内容量 | 6000 单位 | 12000 单位 |

算法：CRLF 归一为 LF，末尾换行不额外计空行，其余空行和注释均计入。函数由现有 TypeScript AST 识别，Vue 只解析 script 部分。工厂函数的行数包含其内部嵌套的函数，不自动扣减。函数标识由名称加同名遍历序号组成，重命名或顺序变化后需重新审核基线。

中文没有英文式的空格分词，因此按字符计数：每个 Unicode Han 字符计一单位，连续的 Unicode 字母、数字、下划线整体计一单位，标点和空白不计。Markdown 中的代码、链接、表格都按原始文本统计，算法有意保守，不等同阅读时长。设置内容量预算是为了堵住超长单行绕过行数限制的漏洞。

范围由 `git ls-files` 的已跟踪和未忽略未跟踪文件决定，检查 ts/js/vue/css/md。生成文件、构建输出和依赖由 Git ignore 排除，`.agents/` 下的过程材料是带日期的归档，不计入预算。新增生成资产应核实来源并配置精确排除，不得为手写业务文件添加忽略。字体覆盖 JSON 与二进制不属于代码长度预算。

存量超限登记在 `scripts/quality-budgets.json`，每项写明原因、登记日期和保留职责，上限值取当前精确大小。后续任何增长都必须再次说明。基线不是提限许可，阈值或例外的变化由审查者核对实际差异。软超限只输出 REVIEW，不强迫拆分。禁止为清除提示或刷指标而拆分文件，禁止无理由调高阈值。预算工具不判断代码设计质量。

## 架构边界及局限

站点框架、终端和首页入场分别见 [站点框架](site-shell.md)、[终端扩展接口](terminal-extending.md) 和 [首页入场](home-intro.md)。`check:terminal` 检查终端控件复用、公开 token、固定颜色与时长及共享组件内部选择器覆盖。

`check:architecture` 构建 app 生产模块的导入图，检查静态 import、export-from、字面量 import()/require()，支持相对路径与 `~/`、`@/`，检查循环和无法解析的本地导入（包括类型导入）。Vue 仅提取 script，资源查询参数被移除后验证文件。

Core 仅允许 Core、branding、终端 config、i18n 与站点 config 的本地依赖，禁止 Vue、Nuxt 自动导入入口、共享视图、Node/Bun 和反向命令/展示依赖。命令不得依赖页面、站点组件、composables、终端视图/动画和宿主运行时，需要能力时通过注入的上下文获取。Core/commands 中直接引用 window/document/eval/Function/Bun/process 会让检查失败。Session 组装位于终端根 `client-session.ts`。

它不是安全沙箱，也不是完整的类型解析器：Nuxt 自动导入、运行时拼接的路径、间接全局访问都不在导入图里，检查不到。动态能力、共享 UI 私有接口、DOM 生命周期与重复状态仍须审查和运行时测试。浏览器终端的安全性继续依赖显式 Registry、Parser 和 Session 的能力边界。

[文档链接检查](../../scripts/check-docs.ts) 跳过围栏、行内代码、外部协议和片段，只核对文件目标存在，不检查片段有效性或外链连通性。片段和正文事实仍由人工核对。

## 修改与验证

按范围格式化，保护无关未提交内容。检查使用不写入的命令。不通过关闭规则、扩大忽略、抑制诊断或删除测试掩盖缺陷，规则调整由审查者核实对象、依据和影响。源码注释使用双语，英文在上、中文在下，每条一句话。

锁文件由 Bun 生成，不手工拼接。依赖更新须复验冻结安装，并实际执行项目 postinstall，不能把同步时的 `--ignore-scripts` 安装当作完整环境准备。核对 Nuxt、Vue 和 Router 的声明及锁定结果兼容性。类型、构建和相关浏览器检查按影响范围执行，构建后启动预览并请求实际页面。构建成功或进程启动不能替代页面可用性。

## 文档生命周期

文档职责见 [内容分工](../AGENTS.md#内容分工)。CI 的 SHA 和脚本命令定义各只维护一处，不多处复制。专题文档与对应能力一起提交，独立文档提交只描述该提交所包含的事实。

部分暂存的独立验证以隔离目录为对象：用基准提交和候选索引内容建出该目录，再在目录内运行检查。当前预算和文档链接检查会包含未跟踪文件，架构检查直接扫描工作区。因此在完整工作区运行门禁，不能证明这个切片独立成立。验证记录写明隔离目录的基准提交、候选文件、检查方式和未覆盖项，不通过暂存后续功能补足当前切片。

修改公共接口时必须同步对应依据。新的架构决策用简明 ADR 记录，包含背景、决策、取舍和后果。本文件建立之前的质量决策统一记录在本文件里，之后的独立决策才新增 ADR，不预先补空模板。失效的资料先标记历史、更新或确认价值，再归档，不机械删除有设计依据的历史文档。

仅为未解决事项、必要决策依据或无法从 Git 和现有测试还原的证据保留过程记录。审计与待办放在 `.agents/notes/audits/`，确需跨轮跟进的计划放在 `.agents/notes/plans/`，文件名以 `YYYY-MM-DD` 开头。同一问题维护一份记录并注明更新日期，不为每轮检查自动创建审查报告、补丁快照、清单或提交信息文件。删除失效、重复及可由 Git 还原的阶段流水记录。有保留依据的历史设计才归档。过程材料不替代实时门禁或现行规范，`.agents/` 的其余子目录预留给 skills、commands 等资源。

工作流实际运行结果与 GitHub required checks 配置分别核验，不能互相代替。
