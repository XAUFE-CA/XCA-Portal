# 术语与缩写对照

适用范围：全仓库 Markdown 与产品文案。项目名、产品名和技术专名保留官方英文写法，普通概念用中文。代码组件名（Parser、Registry、Session、VirtualWorkspace 等）保留英文大小写，叙述概念时用对应中文词。全称与解释只在本表维护，首次出现也不展开。

## 术语表

| 术语 | 全称/解释 | 使用约束 |
| --- | --- | --- |
| XCA | XAUFE Computer Association（计算机学社） | 正文只写 XCA |
| XAUFE | Xi'an University of Finance and Economics | 仅作为 XCA 全称的一部分 |
| XAUFE-CA | GitHub 组织名 | 保留连字符与大写 |
| Neoverse-UI | 共享 UI 库 | 正文统一写 Neoverse-UI，不写无连字符的 Neoverse UI 或小写 neoverse-ui，包名 `@neoverse-ui/*` 除外 |
| morphicons | SVG 图标变形库 | 保留官方小写写法；图形数据与变形由不同职责维护 |
| Nuxt Content | Nuxt 的内容模块 | 版本写 Nuxt Content 3 |
| Three.js | 浏览器三维渲染库 | 使用官方大小写；不指页面共享 UI 或动画时钟 |
| 门户 | 本仓库交付的 XCA Portal | 不用“站点”指代本项目 |
| 终端 | 浏览器内模拟终端 | 不写“终端机” |
| 报告厅 | Auditorium，完整入场末段的室内场景 | 包含中央过道、阶梯座椅与舞台，屏幕直接使用真实终端，不指独立页面或真实场馆 |
| 传送门 | Portal，道路与报告厅之间可穿过的开口 | 进入前只在开口内显示室内，穿过后显示完整报告厅，不指黑屏或交叉淡化 |
| 会话 | Session | 正文写“会话”，`Session` 只指代码类 |
| 虚拟工作区 | VirtualWorkspace | 正文写“虚拟工作区” |
| 命令上下文 | CommandContext | 正文写“命令上下文” |
| 共享 UI | Neoverse-UI 的组件、样式变量与运行时 | 指层，不指具体组件 |
| 共享库 | Neoverse-UI 源码仓库 | 指仓库写“共享库”，指组件层写“共享 UI” |
| 极光玻璃 | Aurora Glass（共享 UI 的唯一玻璃材质，轻薄/标准/厚实三档） | 中文写极光玻璃，英文写 Aurora Glass；`glass-*` 标识符与 Glass Runtime 包名不变 |
| 门禁 | 可执行的自动检查 | 不写“质量门禁” |
| 基线 | 已确认并纳入版本控制的对照结果 | 不写“基准线” |
| Passkey | 通行密钥 | 正文写 Passkey |
| 权威 | authoritative 的直译 | 写原始文件、具体对象或 CA 标识；不写权威标志、权威资源 |
| 品牌 | 商业品牌用语 | 社团门户不称自身为品牌，写学社标识、站点标识或 CA 标识 |
| 契约 | 前置条件、兼容承诺或不变量 | 其他情况写接口、规则或约定；不写工程质量契约、架构契约、公共契约 |
| 编排 | 动画或执行流程 | 写动画、流程或具体动作；不写空间编排 |
| 装配 | 创建并注入依赖 | 写创建、组装或注入；不写装配服务 |
| 令牌 | design token | 写样式变量或颜色变量 |
| 事实来源 | 依据或唯一维护处 | 写事实依据或唯一维护处 |
| 共享材质 | 共享 UI 的玻璃样式 | 写共享玻璃样式；具体玻璃对象可写玻璃材质 |
| 消费方 | consumer 的直译 | 写“门户”“调用方”或具体项目名 |
| 合成层 | 浏览器为元素单独创建的绘制层 | 正文写“合成层”，必要时写“独立绘制层” |
| 栅格化 | 把矢量或布局内容转成像素 | 写“重新栅格化”，不写“重栅格化” |
| 文档流 | 元素按页面顺序自动排列的默认布局 | 写“正常文档流”，不写“常规流” |
| 深度缓冲 | 绘制时记录每个像素前后关系的缓冲区 | 技术描述可保留；面向使用说明时写“前后遮挡关系” |
| 宿主运行时 | 提供渲染、路由与交互能力的外部环境 | 先点名具体环境（Nuxt、Vue 或 Glass Runtime），不泛写“宿主” |

## 缩写对照

| 缩写 | 全称/解释 | 使用约束 |
| --- | --- | --- |
| CI | Continuous Integration（持续集成） | 正文只写 CI |
| E2E | End-to-End（端到端） | 目录 `tests/e2e` 保持小写 |
| TUI | Terminal User Interface（终端用户界面） | 正文只写 TUI |
| RFC | Request for Comments（征求意见稿） | 历史标题保留，正文写 RFC |
| ADR | Architecture Decision Record（架构决策记录） | 正文只写 ADR |
| API | Application Programming Interface（应用程序接口） | 终端扩展能力写“接口” |
| WAAPI | Web Animations API（Web 动画接口） | 正文只写 WAAPI |
| FLIP | First, Last, Invert, Play（布局动画技术） | 正文只写 FLIP |
| WOFF2 | Web Open Font Format 2（字体格式） | 正文只写 WOFF2 |
| SIL OFL 1.1 | SIL Open Font License 1.1（字体许可证） | 许可证名保留英文 |
| hook | 插件生命周期回调 | 正文写 hook，不写“钩子” |
| IME | Input Method Editor（输入法） | 正文只写 IME |
| OTP | One-Time Password（一次性密码） | 正文只写 OTP |
| OAuth | Open Authorization（开放授权协议） | 保留大小写 |
| DOM | Document Object Model（文档对象模型） | 正文只写 DOM |
| SSR | Server-Side Rendering（服务端渲染） | 正文只写 SSR |
| UTF-8 / LF / CRLF | Unicode Transformation Format 8 / Line Feed / Carriage Return + Line Feed（编码与行尾符） | 保留标准写法 |
| CSS | Cascading Style Sheets（层叠样式表） | 保留官方大写，不翻译、不展开 |
| HTML | HyperText Markup Language（超文本标记语言） | 保留官方大写，不翻译、不展开 |
| JSON | JavaScript Object Notation（JavaScript 对象表示法） | 保留官方大写，不翻译、不展开 |
| YAML | YAML Ain't Markup Language（人类可读的数据序列化语言，递归缩写，初义 Yet Another Markup Language） | 保留官方大写，不翻译、不展开 |
| SVG | Scalable Vector Graphics（可缩放矢量图形） | 保留官方大写，不翻译、不展开 |
| WebGL | Web Graphics Library（Web 图形库） | 保留官方大写，不翻译、不展开 |
| WebGL2 | WebGL 2.0 | 首页 Three.js 场景所需图形接口；不可用时保留 SVG 与终端 |
| PBR | Physically Based Rendering（基于物理的渲染） | 指场景材质与光照，不指共享 UI 的极光玻璃 |
| PMREM | Prefiltered Mipmapped Radiance Environment Map（预过滤多级辐射环境贴图） | 用于场景材质随粗糙度变化的环境反射 |
| HDR | High Dynamic Range（高动态范围） | 描述场景离屏颜色与灯光范围，不表示显示设备能力 |
| CLI | Command-Line Interface（命令行界面） | 保留官方大写，不翻译、不展开 |
| UI | User Interface（用户界面） | 保留官方大写，不翻译、不展开 |
| SHA | Secure Hash Algorithm（安全哈希算法） | 保留官方大写，不翻译、不展开 |
| ASCII | American Standard Code for Information Interchange（美国信息交换标准代码） | 保留官方大写，不翻译、不展开 |
