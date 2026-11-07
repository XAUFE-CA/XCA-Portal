# 终端扩展接口

Status: adopted

终端是浏览器模拟环境，不执行系统 Shell，也不读取本地文件。虚拟工作区结构由 `app/data/terminal/manifest.ts` 定义：用户目录下的 `README.md`、隐藏文件 `.profile`、`/etc/os-release`、`/etc/motd` 与 `/community` 的两篇短文为只读文件。

## 架构边界

- `config.ts`：标识、默认身份、路由、会话上限及初始尺寸。
- `core/`：Parser、Registry、Session、VirtualWorkspace、AppearanceRegistry，不依赖 Vue 或 DOM。
- `commands/`：站点、Linux 模拟、外观及交互命令，通过 CommandContext 获取能力。
- `presentation/`：终端展开、系统识别与字宽测量，与命令状态分开。首页入场的展示编排位于 `app/features/intro/`，终端不反向依赖该模块。
- `components/`：Host、Transcript、CommandInput、Interaction。容器、输出滚动区、文本行和命令行分别复用 Neoverse-UI 的 `UiTerminalSurface`、`UiTerminalTranscript`、`UiTerminalLine`、`UiTerminalPrompt`。CommandInput 仅将会话身份映射为 host/path 分段，原生编辑、材质、光标和状态由共享组件负责。历史命令的身份作为共享命令行文本记录，不另建提示符组件。启动消息、说明和底部状态也使用共享文本行。

材质、正文内边距、排版、控件状态、圆角、动画时长和缓动来自 Neoverse-UI。门户保留页面几何、ASCII 字形适配和演出节奏倍率。`bun run check:terminal` 检查裸控件、固定颜色/时长、自造按钮和学社名称拼写，并禁止共享终端内部选择器覆盖、字体角色重定义及本地终端材质/文字样式。检查对象包含 `app/assets/css/terminal*.css` 与 `app/features/terminal/**/*.vue` 的样式块，终端组件内的样式不能绕过该门禁。认证等普通表单继续使用 UiInput。输出自动跟随由 `UiTerminalTranscript` 负责，向上滚动阅读时保持当前位置。

标题栏通过 `UiTerminalSurface` 的公开 `header` 插槽挂载 `TerminalWindowHeader`，保留共享容器、材质、内边距和输出区。浏览器可识别的 Apple 设备统一使用左侧三色圆点与居中会话标题，包括 Mac、iPhone、iPad、iPod 及其他 Apple 系统。Windows 与其他设备使用终端图标和普通文字标题，不添加标签底色或边框。三色圆点只作装饰，不可点击且不进入无障碍树；真实的展开与还原仍使用带标签、展开状态和圆角图标的 `UiIconButton`。窗口外框背景仅通过公开 `--neoverse-terminal-header-background` token 调整，默认取终端背景变量，与输出区共用同一表面；标题排版取自 caption 字号与文字色 token；共享 UI 回归用例以 token 期望值校验这两处偏差，不通过删减比较项回避。

`terminal-platform.ts` 优先读取浏览器平台提示，缺失时依次使用旧平台字段和 User-Agent。以桌面 Mac 身份运行的 iPadOS 同样使用 macOS 风格，Android 和无法识别的系统使用中性头部。系统识别只影响外观，不用于能力判断或授权。服务端渲染中性头部，挂载后更新系统样式，不重建会话。

`TerminalStatusBar` 只接收展示状态，使用共享文本行和普通文字分组显示模式、当前目录、列数和快捷键提示，不使用徽标或状态圆点。窄屏时底部状态分成两行，长目录截断但保留完整悬停文本。命令输出、欢迎字符画和输入提示行不参与窗口外层样式定制。

共享依赖与构建解析只维护在 [工程质量规则](engineering-quality.md#本地开发与共享依赖)。

输出、交互和当前命令行位于同一个滚动区，命令行紧随最后一条输出，不固定在窗口底部。滚动区上缘与标题栏相接，顶部留白由滚动区自身承担；滚动区两端各有 32px 渐隐遮罩，顶部贴近页头，底部提示下方仍有内容，到达底部时底部渐隐消失。滚动时不在页头与首行之间留下固定空带，也不硬切首尾行。Host 在提交命令、异步结果返回和补全候选插入后定位到终端末尾。阅读历史后再次输入会恢复跟随，定位只调整终端内部的 scrollTop。访客点击终端前，输出区不接管滚轮与触摸滚动，滚轮始终滚动页面；点击终端后由输出区滚动，点击终端外部后交还页面。判定依据是首页记录的“开始使用终端”状态，而不是输入框焦点，因为入场结束会自动聚焦输入框。

首页入场和场景交接见 [首页入场](home-intro.md)，站点导航与共享玻璃样式接入见 [站点框架](site-shell.md)。

## 新命令及虚拟文件

常用 Linux 风格命令注册于 `terminalCommands`。`man` 独立注册为查询命令用法的命令，不是 `help` 的别名；`help` 只列出命令，不接受参数。顶层命令不注册 Linux 中不存在的别名，如 `cls`。

命令按操作对象分文件：`commands/files.ts` 承载目录浏览、切换与读取（pwd、ls、cd、cat），`commands/text.ts` 承载行与字符变换（basename、dirname、head、tail、wc、sort），`commands/search.ts` 承载检索与遍历（grep、tree、find），`commands/system.ts` 承载模拟环境、身份与时间（echo、date、uname、hostname、env、printenv、id、seq、sleep），`commands/appearance.ts` 与 `commands/interactive.ts` 承载背景、阅读器与登录入口。新增命令按操作对象归入对应文件，不按行数另建模块。`commands/index.ts` 决定注册顺序，组内顺序即 `help` 的输出顺序。

站点专属操作注册于 `commands/site.ts` 的子命令集合，经单一 `xca` 入口执行。其子命令包括 open、theme、banner、intro、background、explore，原顶层名称不保留别名。`xca open` 接受站点配置中的路由名，页面清单见 [站点框架](site-shell.md#页面与内容来源)，`xca explore` 提供帮助与当前主题查询。`xca` 或 `xca help` 列出子命令。`xca help intro`、`man xca intro` 与 `xca intro --help` 查询用法。`subcommands` 元数据供帮助和参数补全复用，不引入另一套 Parser 或 Session。

站内命令的说明通过 `summaryKey` 引用双语资源，输出调用 `ctx.t(key, params)`。包含自然语言的用法可设置 `usageKey`。固定取值范围的占位符通过 `usageParams` 声明，用法行下方列出当前可接受值；函数形式用于读取运行时注册表。语言由 `TerminalServices.getLocale()` 提供，帮助与虚拟文件读取时使用当前语言。第三方扩展仍可传入已本地化的 `summary` 字符串。帮助和命令补全来自注册表，参数补全由 `complete(args, context)` 提供。`execute` 支持同步/异步结果，`ctx.write(...)` 支持渐进输出。异步能力须尊重 AbortSignal。取消和超时后 Session 拒绝旧命令的输出和受控副作用。顶层命令用 `group` 元数据标注 `session`、`files`、`system` 或 `site`，帮助按组输出，组间插入 `─` 分隔线；分隔线宽度取实际输出中最宽的一行（东亚宽字符按两列计算），最多为 `ctx.columns() - 2`。`xca` 子命令没有分组，列表保持扁平且不加分隔线。

顶层命令按组注册。文件组包括 `pwd`、`ls`、`cd`、`cat`、`less`、`basename`、`dirname`、`head`、`tail`、`wc`、`grep`、`sort`、`tree`、`find`，系统组包括 `echo`、`date`、`uname`、`hostname`、`env`、`printenv`、`id`、`seq`、`sleep`，会话组包括 `help`、`man`、`clear`、`history`、`whoami`、`login`、`logout`，站点组只包含 `xca`。`basename` 与 `dirname` 只处理字符串，不解析虚拟路径。`id` 用 `ctx.identity().user` 生成 `uid`、`gid` 与 `groups`，不读取主机账户。`sleep` 只接受 0 到 5 秒，等待期间由传入的 `AbortSignal` 中止并清理定时器，取消后不追加输出。

批量输出上限为 200 行。`seq` 的区间、`head` 与 `tail` 的 `-n`、`grep` 的匹配行和 `sort` 的输入行超过上限时返回 `error.outputLimit` 或 `error.lineCount` 错误行。`tree` 与 `find` 最多列出 120 个节点，`tree` 的最大深度为 8 层，超出时追加 `command.truncated` 提示。

`grep` 只做字面量子串匹配，`-i` 用 `toLowerCase()` 比较，不把用户输入编译为正则；无文件参数时返回用法错误，不读取标准输入。`find -name` 只识别 `*`，其余字符按字面量转义后再构造匹配，因此 `[`、`?` 与 `.` 没有通配含义。

命令行按 Tab 直接填入候选，连续 Tab 在同一组多候选之间循环。列表仅显示当前待补全的命令名或参数，不重复命令前缀。编辑、移动光标、Esc、历史切换或失焦后重新计算候选。唯一匹配追加空格，目录匹配保留末尾 `/` 以继续补全路径。路径候选按虚拟绝对路径排除已完成的参数，单路径命令不继续推荐第二个参数，cd 只补全目录。Shift+Tab 保留浏览器焦点导航。

输入时显示灰色斜体虚影：Session.suggest 优先返回最近一条具有相同前缀的历史命令，否则复用 complete 的命令、参数和路径候选。共享 UiTerminalPrompt 接收完整 suggestion，只绘制未输入的后缀，不修改原生输入值。聚焦且光标位于末尾时可见，选区、中文合成、只读和失焦时隐藏。按 → 接受整条建议但不执行、不追加空格。Esc 隐藏建议，继续编辑后恢复。Tab 仍使用原有候选循环。

通过 `session.workspace.register({ path, kind, read })` 注册虚拟文件。路径统一处理 `/`、`.`、`..`、`~`，不能穿越虚拟根目录。`read(signal)` 可接入远程内容，禁止把虚拟路径直接当作服务器磁盘路径。

`VirtualWorkspace.walk(root)` 返回 `root` 的全部后代节点并按路径排序，`list` 仍只返回直接子项，`tree` 与 `find` 复用 `walk` 遍历目录。

默认虚拟树来自 `app/data/terminal/manifest.ts`。`virtualDirectories` 与 `virtualFiles` 是虚拟路径的唯一结构定义，正文以纯文本维护在 `app/data/terminal/files/`，双语内容成对存放（`readme.zh-CN.txt` 与 `readme.en.txt`），不区分语言的 `os-release.txt` 保持固定内容。`client-session.ts` 遍历清单注册目录与文件，`read(signal)` 在每次调用时按当前语言替换 `{name}`、`{tagline}`、`{hint}`，语言切换后重新读取即得到新语言，Session 不重建。修改正文或增删虚拟文件只改动 `app/data/terminal/`。以点开头的文件默认不出现在 `ls` 与补全候选中，`ls -a` 与以点开头的路径可以访问。

`app/data/terminal/text-sync.test.ts` 校验两类事实。结构：两种语言的行数、逐行类型（标题、指令、正文）、插值占位符与 `export` 指令一致，读取后不残留占位符，磁盘上带 `.zh-CN` 或 `.en` 后缀的文件必须成对出现。译文：`app/data/terminal/translation-baseline.json` 记录每条原文行与登记时译文的哈希值，任一侧改字都会使哈希值失配，测试随即失败。修改正文后先完成两侧翻译，再运行 `bun run texts:stamp` 登记；未登记视为未审。段落保持单行，不做硬换行，折行由终端完成。机械校验只确认改动经过显式登记，译文语义仍由双语审查与 E2E 覆盖。

## 背景与字体适配

字体角色、子集生成、资产加载与许可证只维护在 [字体与资产维护](fonts.md)。字体不属于会话外观，未提供 `font` 命令或自定义字体注册接口。Host 根据实际字体和字宽计算列数，在字体加载与尺寸变化后重算。ASCII 字标以轻微负字距让方块字形重叠，消除单元格边界的亚像素接缝；列宽测量同步计入该字距，字标仍按面板宽度保持单行。

背景仍是会话状态，站内路由与主题切换不重置，可使用 `xca background` 命令列出、选择已注册项。默认选项不设置覆盖，直接使用共享主题的终端背景。其他选项通过公开的 `--neoverse-terminal-background` 定制，图片铺设在门户内容区域。该变量注册为可插值颜色，预设切换按共享标准时长与线性缓动过渡，避免缓出曲线在前几帧就完成变化；减少动态效果时直接切换。`xca background default` 同时清除颜色和图片覆盖。

```ts
session.appearanceRegistry.registerBackground({
  id: "custom-image",
  label: "自定义背景",
  color: "var(--neoverse-color-surface-canvas)",
  image: "/backgrounds/terminal.webp",
});
session.setAppearance({ background: "custom-image" });
```

背景支持站内绝对路径、HTTP(S) 和指定格式的图片 data URL。CSS 配置由受信任的宿主注册，终端用户只能选择已注册项。图片的配色及文字可读性由宿主负责。

## 多步交互与登录

`ctx.choose(title, items)` 返回菜单选择；`ctx.ask({ label, kind })` 返回单次输入，kind 为 `text`、`secret` 或 `otp`。回答直接交给等待中的命令，不进入历史、普通输入草稿或 Transcript。Esc、Ctrl+C 和取消按钮释放等待状态。

`TerminalServices.auth` 为可选 AuthGateway，当前未注入后端，`login` 只说明尚未开放。

```ts
interface AuthGateway {
  getSession(signal: AbortSignal): Promise<AuthIdentity | null>;
  login(context: Pick<CommandContext, "ask" | "write">, signal: AbortSignal): Promise<AuthIdentity>;
  logout(signal: AbortSignal): Promise<void>;
}
```

认证结果须来自后端，界面身份不代表授权。适配器负责服务端验证、HttpOnly 会话、OAuth/Passkey 和请求取消。login 标为 sensitive，不保存原命令。验证码和密码经独立表单提交。默认超时在 `TERMINAL.limits.commandTimeout` 配置。接入时优先 Passkey 等免输密码的方式。OAuth/Passkey 触发浏览器原生弹层或授权跳转时，不为了“全在终端内”而绕开。会话 Cookie 使用 Secure、HttpOnly、SameSite，并配套 CSRF 防护。原始凭据不进入命令历史、输出、截图或遥测。

## TUI

`ctx.openApplication(application)` 打开应用屏幕并保留 Transcript。`ctx.closeApplication()` 返回命令行。TerminalApplication 提供 `title`、`lines`、`onKey(key)`、`onResize({ columns, rows })` 和可选 `dispose()`。更新 lines 后调用 `ctx.refresh()`。

键盘事件仅来自应用焦点内，Tab 保持浏览器焦点导航。尺寸根据当前字体和可用区域计算。dispose 用于释放订阅、请求和计时器。当前 less 支持箭头、j/k、PageUp/PageDown、Home/End、q/Esc，并有触摸退出按钮。xca explore 验证菜单。以后可扩展应用视图模型和渲染器，无须修改解析器或会话历史。

组件卸载会取消执行中的命令和关闭 TUI，保留公开历史、目录、草稿及外观。

## 宿主展示与生命周期

当前终端嵌入首页，支持原位展开到视口。展开不等于跨页呼出。入场、展开和重播共用一组 Host 与会话，主题、语言和视口变化保留会话。跨页呼出与认证专注布局没有对应的独立模式接口，不作为当前扩展功能。

展开时锚点保留原布局空间，终端本体固定到视口。展开变换与外部压暗共用起止时间，终端沿用共享空间动画的缓动，遮罩开口跟随终端当前边界，透明度在完整时长内线性淡入淡出，收起与快速反向切换从当前进度连续执行。Esc、resize、visualViewport 和 reduced-motion 都会结束动画并回到稳定布局，取消后清理动画与遮罩。

展开与收起期间，玻璃边缘仅在终端边界跨过设备像素时刷新。结束或取消时精确刷新一次并清理逐帧任务。刷新调度位于 `app/utils/glass-motion.ts`，首页入场也复用该调度，但保留非几何效果的逐帧刷新。

## 验证

`bun run check` 包含格式、Lint、代码/文档预算、架构与终端边界、类型、单元测试和生产构建。早期开发修改共享库后先运行 `bun run ui:sync`，发布版本无需同步。`bun run test:e2e` 覆盖命令、内容、TUI、外观、导航、动画边缘所属、中断及响应式布局。自动化验证不等同用户的最终视觉验收。
