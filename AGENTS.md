# XCA Portal — Agent 工作规范

遵守 [组织协作规范](https://github.com/XAUFE-CA/.github/blob/main/COLLABORATION.md)。本文约束当前提交所包含的文件；文档写作见 [docs/AGENTS.md](docs/AGENTS.md)。源码、配置和用户最新决策优先于过期描述。

## 目录结构

```text
.vscode/                  编辑器格式化与扩展建议
app/
  app.vue                 初始应用入口
docs/
  AGENTS.md               文档职责、行文与验证
  architecture/
    engineering-quality.md  共享依赖、门禁、预算与验证责任
  terminology/
    README.md             术语入口与维护方式
    terms.md              品牌与缩写对照
public/                   初始静态资产
tests/e2e/                随功能提交的浏览器回归
scripts/                  门禁聚合、预算、文档链接、静态导入检查、共享库同步与治理测试
```

根文件职责：`package.json` 定义依赖和命令，`bun.lock` 固定安装结果，`nuxt.config.ts` 配置 Nuxt，`tsconfig.json` 配置应用类型入口，`tsconfig.quality.json` 配置治理脚本与测试类型检查，`playwright.config.ts` 配置浏览器回归，`.gitignore` 排除本地产物，README 提供项目和运行入口。格式工具配置位于 `biome.json`、`.prettierrc.json` 与 `.prettierignore`，编码及行尾约定由 `.editorconfig` 和 `.gitattributes` 维护。

扩展去向：功能代码遵循该阶段采用的应用结构，公共正文与静态资产分别按其事实来源维护；治理脚本进 `scripts/` 并接入适用门禁，浏览器测试随对应实现进入 `tests/e2e/`，现行接口文档进 `docs/`，术语解释进 `docs/terminology/`。增加目录时同步本节，不预设未采用的模块结构。

共享依赖、门禁、预算与验证责任见 [工程质量契约](docs/architecture/engineering-quality.md)。

## 修改与验证

1. 修改前检查分支、历史和 `git status --short`，阅读相关源码与配置，保护全部未提交和未跟踪工作。
2. 每次修改围绕一个目标，复用已有实现，不引入无依据的依赖、重复状态或空目录。
3. 使用 Bun 与既有锁文件，不混用包管理器。按当前提交实际提供的命令验证，报告执行结果、失败与未覆盖项。
4. 每个提交的文档、源码、依赖和验证相互对应。完整工作区的检查结果不能替代隔离后的候选提交检查。
5. 不伪造功能、演进时间、测试或人工审查。实质性 AI 参与按组织规范在 PR 中披露。
6. 不提交凭据、Cookie、私人数据或真实环境文件，不执行用户未授权的高风险操作。

## Git 操作

未经明确要求，不执行暂存、commit、push、rebase、重置或历史修改。提交与推送分别获得明确授权。提交前逐文件审查候选内容，提交信息遵守组织规范。

不清理、覆盖或回滚用户已有改动。隔离验证使用基准提交和本阶段候选文件，不借用后续未提交实现。

## 共享 UI 接入

使用现有 Neoverse-UI 公开组件与 token，消费方维护业务和布局，不复制基础控件或依赖共享私有选择器。本地依赖、同步和发布包切换见工程质量契约。共享库源码不属于本仓库修改范围，通用组件缺口按共享库公开的需求登记流程处理。

相关测试与实现同笔提交，不为测试另拆提交。浏览器回归先检查测试端口占用，不复用无关服务器，不把浏览器功能通过作为视觉验收。
