# 工程质量契约

Status: adopted

格式与 Lint 分别执行并报告。变更作者负责完成适用检查，审查者核对改动范围、工具配置和实际验证结果。源码与命令定义优先于文档描述。

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
