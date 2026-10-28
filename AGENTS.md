# XCA Portal — Agent 工作规范

XCA Portal 是 [XAUFE-CA](https://github.com/XAUFE-CA) 官方门户。改代码前读 [工程质量契约](docs/architecture/engineering-quality.md)（门禁、预算与分级），修改 `app/features/terminal/` 前读 [终端扩展接口](docs/architecture/terminal-extending.md)，首页动画与站点框架分别见 [首页入场](docs/architecture/home-intro.md) 和 [站点框架](docs/architecture/site-shell.md)，写文档遵循 [docs/AGENTS.md](docs/AGENTS.md)。除标注 SHOULD（需审查说明的建议）或 MAY（可选方案）的条目外，其余条文均为强制要求。

## 仓库布局

采用 Nuxt 4 应用目录（srcDir 为 `app/`）：页面只做组合，交互特性自成模块，正文与资产外置，门禁与治理独立于应用代码。

```text
app/                    门户应用（Nuxt 4 srcDir）
  app.vue               根组件，挂载全局样式与默认布局
  assets/               门户 CSS（含 intro-journey.css 场景几何）与自托管字体子集
  components/           跨页面展示组件，按场景分子目录
    site/               站点框架：顶栏、导航、菜单、语言与主题控件
    home/               首页 Hero 与终端入场编排
  composables/          跨组件状态与能力：主题、语言、内容适配
  config/               站点品牌、路由与导航配置（site.ts）
  data/                 结构化数据：首页轮播语句（hero-sentences.json）
  features/             自包含交互特性，一个特性一个目录
    terminal/           浏览器终端（当前唯一特性模块，作扩展范例）
      core/             纯逻辑：会话、解析、注册、虚拟工作区
      commands/         命令集合，经命令上下文访问服务
      presentation/     入场、空间几何与轨迹、CA 网格（intro-mark-mesh.ts）和绘制（intro-mark-renderer.ts）、归位及展开编排
      components/       终端 Vue 适配组件（Host、输入、Transcript）
      branding/         终端品牌 ASCII 与标识
      client-session.ts 命令与 Session 的装配入口
      config.ts         终端自身配置
  i18n/                 翻译入口与双语资源（locales/zh-CN、en）
  layouts/              默认布局：顶栏与页面容器
  pages/                路由：index 首页
  plugins/              客户端插件：极光玻璃运行时、主题引导
  utils/                共享工具函数（共享 token 读取）
docs/                   架构契约、现行接口与术语体系（写法见 docs/AGENTS.md）
scripts/                门禁与治理脚本、quality-budgets.json、字体工具
tests/e2e/              随功能提交的 Playwright 用例与 Windows 图片基线
public/                 静态资产：品牌标识、字体许可证、intro-gate.js
.agents/notes/          未解决事项与必要过程记录，其余子目录预留给 skills 等
.github/                CI 工作流（quality.yml）与 PR 模板
```

根目录配置：`package.json` 与 `bun.lock`（依赖与脚本事实来源）、`nuxt.config.ts`（别名、端口、共享库解析）、`playwright.config.ts`（E2E）、`biome.json` 与 `.prettierrc.json`（格式分工）、`tsconfig.quality.json`（治理脚本类型检查）、EditorConfig 与 Git attributes。

扩展去向：新路由进 `app/pages/`，只做组合。新展示组件按场景归入 `app/components/<场景>/`。新交互特性按 `app/features/<特性>/` 建模块，按实际职责选择逻辑、展示与适配分层；终端的 commands 层只用于命令集合，不为其他功能创建空目录。后续新增结构化正文时，在 `content/` 维护并同步定义内容集合 Schema。静态资产进 `public/`。治理脚本进 `scripts/` 并接入对应 check 门禁。Agent 过程材料进 `.agents/notes/`。

## 运行入口

运行、检查与构建命令以 `package.json` 为准，环境准备、本地共享库接入和完整检查说明见 [工程质量契约](docs/architecture/engineering-quality.md#本地开发与共享依赖)。

确认端口占用后启动，不终止无关进程或自动换端口。保持 PowerShell 和 Linux/WSL 兼容，通用脚本不硬编码盘符、分隔符或 Unix 命令。

## 修改流程

1. 阅读本文件及任务相关源码、配置、文档。检查分支与 `git status --short`，保护未提交修改和未跟踪文件。
2. 定位真实调用链，区分门户消费层和共享 UI 问题，明确根因、范围、依赖和验证方式。
3. 最小化修改并复用现有实现。禁止重复状态源、无意义抽象、为了行数拆文件、补丁式 CSS、强制重渲染及无依据的新依赖。
4. 执行适用检查、审查 Diff、同步必要测试与文档。如实说明失败、跳过和未验证风险，不得未经验证宣称修复。
5. 不得用 suppress、`any`、跳过测试或扩大忽略掩盖缺陷。预算例外与误报的审查流程见工程质量契约。
6. 不得自行清理工作区、重置、覆盖用户改动。未经明确要求，不执行 commit、push、rebase 或修改历史。

## 约定

- **组织对齐**：遵守 [XCA 项目开发与协作规范](https://github.com/XAUFE-CA/.github/blob/main/COLLABORATION.md)：AI Agent 开发与 AI 辅助协作（第 1–2 点）、Git 提交与代码审查合并（第 3–5 点）、Issue/PR 协作与证据真实性（第 6 点）。贡献指南、行为准则、安全说明直接引用 [组织默认社区健康文件](https://github.com/XAUFE-CA/.github)，不在本仓库重复维护或改写。提交信息遵循 Conventional Commits，格式与类型以组织规范第 4 点为准，实质性 AI 参与按第 2 点在 PR 披露。本文件只维护门户项目级补充约束，与组织规范冲突时以其强制性要求为准。
- **品牌与范围**：官方门户使用既有 XCA 品牌，不发明学社全称，不引入学校官方 Logo 或未经授权资产。当前只提供公开内容，不提前引入登录后端、数据库、管理后台或独立 API 服务，文案不伪造已开放能力。
- **工具链**：Nuxt 4、Vue 3、严格 TypeScript、Nuxt Content 3。使用 Bun 和现有锁文件，不混入其他包管理器。早期开发使用 Neoverse-UI 本地 `file:` 接入与 `ui:sync`，不直接修补 node_modules、dist 或锁文件复制产物；正式发布改用 npm 精确版本，移除本地别名、同步与 CI 联合检出。不擅改 Nuxt 别名、SSR、PostCSS、端口和共享依赖版本，CI 联合检出决策见工程质量契约。
- **分层职责**：页面负责组合，站点组件负责展示，composables/config 负责公共能力，首页轮播语句由独立数据文件维护。终端 Core 保持纯逻辑，不依赖 Vue、DOM、展示层或命令集合。命令通过上下文能力访问服务，不直接操作 DOM、路由或宿主 Shell。`client-session.ts` 是命令和 Session 的装配入口，presentation 负责 Boot/Dock/Reveal，components 负责终端适配，执行与展示生命周期分离。
- **共享 UI**：优先级为现有 Neoverse-UI 组件 → 公开 token/API → XCA 页面布局与品牌表达。不复制共享 CSS、依赖私有 class/DOM/变量，不在门户建立第二套基础 UI、token、极光玻璃或光标系统。导航、分段控件、输入框及滚动条使用共享默认尺寸和材质，不在消费端放大。颜色、文字、间距、圆角、边框、阴影和动画沿用现有 token，页面几何、图片比例、ASCII 字形可用有依据的局部常量。极光玻璃边缘和毛玻璃归共享运行时，先查接入、层级、生命周期和公开 API。通用缺口登记到共享库 `contracts/component-requests/`，不擅改兄弟仓库。
- **终端安全与会话**：浏览器白名单解释器，不执行用户系统命令、子进程、eval、动态脚本或读取主机文件，虚拟路径限制在虚拟工作区。单一 Host / Session，入场、展开、重播不得创建多个同步实例。刷新、路由返回、跳过、resize 都有确定终态，不重放副作用。认证必须来自未来真实服务端，前端可用性不是授权。敏感回答不进历史、草稿、输出或日志。
- **终端交互**：点击终端后完成当前打字输出单元再暂停并隐藏光标，点击终端外部恢复，不能仅 mouseleave 恢复。使用共享 UiTerminalPrompt、Surface、Transcript、Line，输入支持 IME、历史、Tab、取消、焦点与键盘路径。取消或超时后不得追加旧输出、执行旧副作用。卸载清理异步任务、订阅、监听和动画。输出可选择复制，阅读历史不抢滚，输入和提交恢复合理跟随，滚动能力沿用共享契约。首页逐行启动日志和字符画使用等宽度量适配，不堆空格、固定像素或产生意外滚动条，首页动画只在首页运行。
- **字体**：Maple Mono NF CN 自托管 WOFF2 子集及真实 Italic 不得换为整包字体或恢复字体选择器。字体生成与许可证见 [字体与资产维护](docs/architecture/fonts.md)，新增可渲染中文后更新子集和覆盖清单。
- **客户端与无障碍**：根节点 data-theme 支持 light/dark/system。切换主题和语言不重建 Session，不丢目录、历史、草稿和外观。浏览器 API 控制运行环境并有降级，协调 SSR/Hydration，共享 Glass Runtime 保持唯一并正确刷新/销毁。尊重 reduced-motion，跳过动画仍可读、可操作，不留遮罩，背景低对比，不抢内容层级。保持可见焦点、控件标签、文字对比和移动操作区。
- **双语与内容**：中文默认，英文完整支持。页面用 `useSiteLocale().t()`，命令用 `ctx.t()`，两份 locale key/插值一致，翻译与资源位置见 [docs/terminology/translation.md](docs/terminology/translation.md)。Hero 轮播语句不在组件重复维护。动态输出以文本渲染，验证导航和资源目标。
- **敏感数据与资产**：不提交凭据、Cookie、私人数据或环境文件。资产来源、授权及再分发条件明确。

## 事实来源

| 事项 | 来源 |
| --- | --- |
| 命令、端口、依赖 | `package.json`、`nuxt.config.ts`、[工程质量契约](docs/architecture/engineering-quality.md) |
| 品牌与导航 | `app/config/site.ts`、`public/brand/`、布局及双语资源 |
| 终端当前接口 | [终端扩展接口](docs/architecture/terminal-extending.md)、`app/features/terminal/` |
| 首页入场与站点框架 | [首页入场](docs/architecture/home-intro.md)、[站点框架](docs/architecture/site-shell.md) 及各文档列出的源码 |
| 质量规则与决策 | [工程质量契约](docs/architecture/engineering-quality.md)、`scripts/quality-budgets.json` |
| 验证 | `scripts/check-*.ts`、`app/**/*.test.ts`、`tests/e2e/` |

源码、配置和最新用户决策优先于过期文档，查实矛盾后修正文档，不按旧描述改写正常代码。

## 格式、预算与验证

- 遵守 EditorConfig、Git attributes、Biome、Prettier。UTF-8/LF、两空格、双引号、分号、末尾换行。
- 源码注释使用双语，英文在上、中文在下，每条一句话，不复述代码；注释随代码同步更新。
- Biome 负责代码、CSS、JSON、SVG 的格式与 import assist，Prettier 只管 Markdown/YAML。按修改范围格式化，不冲掉用户其他工作。
- `lint` 与 `format:check` 独立，不得把格式通过说成 Lint 通过。Lint 无 error、预算上限与例外、软预算审查和重构的分级执行以 [工程质量契约](docs/architecture/engineering-quality.md) 为单一规范。

| 改动 | 验证 |
| --- | --- |
| Markdown/YAML/翻译 | 格式、文档预算、链接检查、双语一致与内容加载 |
| TS/架构/治理脚本 | 类型、单测、架构及预算检查 |
| 终端命令/UI/样式 | check:terminal、核心单测、相关 E2E |
| 主题/极光玻璃/滚动/动画 | 浅/深/system、尺寸变化、减少动画、跳过/恢复、焦点与滚动回归 |
| 依赖/构建配置 | 本地开发用 ui:sync、类型、生产构建、开发/预览启动；发布版本确认无 file: 依赖 |

重要改动执行 `bun run check` 与 `bun run test:e2e`，或明确报告阻塞和未覆盖范围。桌面/窄屏、中英、鼠标/键盘 SHOULD 覆盖。截图问题依据实际渲染核实，自动化结果不等同用户最终视觉验收。

## 文档与交付

- 根 AGENTS 只放全局约束和入口，模块例外确有需要才下沉，不创建空模板或重复规范。
- 每个 AGENTS.md 都包含所在目录的结构介绍：注释目录树、根文件职责与扩展去向，便于 AI 定位。新增或移动文件时同步更新对应树。
- 修改本文件时保持条目自包含，细节链接到专题文档。内容增长先压缩或迁移，仍超预算才按工程质量契约登记带原因的精确上限。
- 公共契约和架构决策同步专题文档，历史文档标明状态。文档修改者负责核对事实与入口，审查者审核预算例外和职责。
- `docs/AGENTS.md` 的空格标点与用词规则、[docs/terminology/](docs/terminology/README.md) 的术语对照与翻译规则适用于全仓库 Markdown 与产品文案，含根 AGENTS、README 与过程材料。其结构规则仅约束 `docs/` 子树，术语与缩写的全称只在对照表维护。
- `docs/` 只放描述当前真实情况的文档（架构契约、现行接口）及其 `AGENTS.md` 写作规范。审计快照与实施计划归 `.agents/notes/`，命名、更新与归档规则见工程质量契约。`.agents/` 其余子目录预留给 skills、commands 等 Agent 资源，不放过程材料。
- 完成前核对 Diff/status，交付修改原因、文件、实际验证结果、失败和遗留风险。
- 只有明确请求才提交，提交信息按 [组织协作规范](https://github.com/XAUFE-CA/.github/blob/main/COLLABORATION.md#4-git-commit-message-规范) 使用 Conventional Commits。多 Agent 如被授权，先按模块协调文件所有权，不相互覆盖。

相关测试与实现同笔提交，不另拆测试提交。远端 CI 与 required checks 的配置和结果须分别核验。
