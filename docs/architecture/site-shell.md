# 站点框架

Status: adopted

本文描述导航布局、主题与语言控件、共享玻璃样式接入。开发准备见 [工程质量规则](engineering-quality.md#本地开发与共享依赖)，语言资源与内容维护见 [翻译规则](../terminology/translation.md)，首页场景见 [首页入场](home-intro.md)。

## 页面与内容来源

| 路由 | 内容来源 |
| --- | --- |
| `/` | 首页组合；轮播语句来自 `app/data/hero-sentences.json` |
| `/about` | [中文 Markdown](../../content/pages/about/zh-CN.md) 与 [英文 Markdown](../../content/pages/about/en.md)，含正文、SEO 与横幅元信息 |

导航和终端跳转使用同一份路由配置。路由和数据调整时同步更新此表。

## 源码职责

| 位置 | 职责 |
| --- | --- |
| [default.vue](../../app/layouts/default.vue) | 页顶、页面容器与页脚组合 |
| [about.vue](../../app/pages/about.vue)、[AboutSection.vue](../../app/components/about/AboutSection.vue) | 按语言查询 Markdown、设置 SEO，组合玻璃卡片与主题横幅；查询失败时在站点外壳内呈现降级状态，保留导航 |
| [SiteHeader.vue](../../app/components/site/SiteHeader.vue) | 响应式导航、菜单与滚动定位 |
| [SiteHeaderNavigation.vue](../../app/components/site/SiteHeaderNavigation.vue) | 导航项展示与跳转事件 |
| [SiteHeaderPreferences.vue](../../app/components/site/SiteHeaderPreferences.vue) | 语言、主题分段控件 |
| [site.ts](../../app/config/site.ts) | 标识、路由、导航与主题选项 |
| [useSiteTheme.ts](../../app/composables/useSiteTheme.ts)、[useSiteLocale.ts](../../app/composables/useSiteLocale.ts) | 主题与语言的公共状态 |
| [glass.client.ts](../../app/plugins/glass.client.ts) | 唯一共享 Glass Renderer 的挂载、刷新与销毁 |
| [view-transition.client.ts](../../app/plugins/view-transition.client.ts) | 路由视图过渡的共享节奏标记 |
| [content.config.ts](../../content.config.ts) | `about` 内容集合与 frontmatter Schema |
| [SiteFooter.vue](../../app/components/site/SiteFooter.vue) | 全站页脚：联合标识与标语、版权与作者署名、源码与文章许可、共享库署名与构建提交链接 |
| [build-info.ts](../../scripts/build-info.ts) | 构建期读取 Git 提交并生成 commit 链接，无 Git 时按 CI 环境变量降级 |
| [copyright.ts](../../app/utils/copyright.ts) | 版权年份区间规则 |

## 页脚

[default.vue](../../app/layouts/default.vue) 在站点外壳内为全部路由挂载同一个 [SiteFooter.vue](../../app/components/site/SiteFooter.vue)。首页的 `.site-main` 取 `100svh` 减去页头高度的 `min-height`，终端保持沉浸式，页脚落在首屏之外，需要滚动才能看到；移动端沿用同一规则与 `svh` 单位。其余路由共用同一份内容、样式与数据源。页脚内容不随路由变化：路由过渡只截取 `.site-main`，位于快照之外的页脚若按路由改写会在切换时硬切；主题过渡以整个文档为快照，页脚颜色全部取自共享样式变量；语言切换就地替换文案，不做文字动画。

上半区在 `70rem` 以上把左侧的联合标识区与标语放在同一行并垂直居中：标识区自上而下是 CA 标识与 Neoverse-UI 字标组成的联合标识，以及上下两行的共享库署名 `由 Neoverse-UI 强力驱动` 与构建行 `本项目代码 已开源 (短 SHA @ 提交时间)`；署名行只把库名做成链接，前后的说明留在链接外，“已开源”用主文本色加粗并链接到项目仓库，括号内的短 SHA 链接到提交页面，时间戳是同一链接的文案。标语在右，整体靠右而行内左对齐，在文案里按句换行并由 `white-space: pre-line` 保留；`70rem` 以下改为上下排列，标语独占整行宽度，避免自带断行被再次折行而缩成窄栏；`38rem` 以下改为整段自然排列，并按均衡断行避免末行只剩单字。分割线以下居中收尾两行：第一行是版权 `© yyyy XAUFE-CA | Shenshijun`，组织名链接到 GitHub 组织，作者名链接到个人主页；第二行是许可句，完整写明 `本站源码采用 MIT 许可，文章采用 CC BY-NC-SA 4.0 许可`，两项许可分别链接到仓库 `LICENSE` 与 CC BY-NC-SA 4.0 许可页。页脚不重复站内导航，入口由顶栏承担；脚注链接悬停或聚焦时浮出圆角底板并转为强调色，按下时变深。链接地址统一维护在 [site.ts](../../app/config/site.ts) 的 `links`，界面文案维护在双语资源，两份资源的键和插值一致。所有外部目标设置 `target="_blank"` 与 `rel="noopener noreferrer"`。

标语上叠加一层火焰余烬：[TaglineFlame.vue](../../app/features/tagline-flame/components/TaglineFlame.vue) 在与文案相同的 `<p>` 内渲染 `aria-hidden` 且不接收指针事件的画布，余烬从字形升起，配色取自共享 token 的琥珀与浅红。画布只在可见时绘制；主题过渡冻结画布，路由过渡不截取页脚；减少动态效果不渲染。

版权年份由 [copyright.ts](../../app/utils/copyright.ts) 按首次发布年份计算：当前年份不大于 `2026` 时写 `2026`，之后写 `2026 - yyyy`。年份在 SSR 通过 `useState` 解析一次并随水合数据传递，避免服务端与客户端在跨年边界得出不同结果；静态生成时年份固定在构建当次。

构建信息由 [build-info.ts](../../scripts/build-info.ts) 在配置加载时读取 `git log -1`，经 `nuxt.config.ts` 写入 `runtimeConfig.public.buildInfo`，链接指向 `XAUFE-CA/XCA-Portal` 的 commit 页面，显示短 SHA 与提交时间。Git 不可用时回退到 CI 的 `GITHUB_SHA`；两者都不可用时 `buildInfo` 为 `null`，页脚隐藏构建行，不显示未核实的提交。时间戳保留提交者自身时区，只把 Git 严格 ISO 字符串的 `T` 换成空格，不按浏览器时区重新格式化；缺少时间戳时只显示短 SHA。

联合标识的 CA 图稿沿用 [ca-mark.svg](../../public/brand/ca-mark.svg) 的紧凑方形 `viewBox`，入场场景仍还原为 1254 单位坐标系。Neoverse-UI 字标取自共享库 `apps/playground/src/assets/neoverse-wordmark.svg`，采用 MIT 许可，副本存于 [neoverse-wordmark.svg](../../public/brand/neoverse-wordmark.svg)，裁剪 `viewBox` 并把填充色统一为 CA 的 `#161616`，深色下两张标识用 `brightness(0) invert(1)` 呈纯白。深色与系统深色沿用顶栏标识的 `invert(1)` 规则，不新增颜色值。资产来源另见 [字体与资产维护](fonts.md#加载与许可)。

首页完整入场期间，[intro-gate.js](../../public/intro-gate.js) 与 [terminal-intro.css](../../app/assets/css/terminal-intro.css) 继续隐藏页脚，`revealing` 阶段显现；减少动态效果时不设置首帧门禁，页脚直接可读。浏览器回归入口为 [site-footer.spec.ts](../../tests/e2e/site-footer.spec.ts) 与 [mobile-header.spec.ts](../../tests/e2e/mobile-header.spec.ts)，覆盖版权行的组织与作者链接、源码与文章许可、共享库署名、构建行与括号时间戳、双语切换、窄屏溢出，以及桌面与移动端页脚位于首屏之外、滚动后可见。

## 导航与响应式布局

顶栏按可用 CSS 视口宽度分三级布局：大于 `70rem` 时标识、主导航与设置同排，标识与设置两侧轨道等宽，主导航以顶栏中线居中，两侧文案的宽度变化不会推偏导航；大于 `38rem` 且不大于 `70rem` 时保留同排主导航，将语言和主题放进菜单；不大于 `38rem` 时主导航也放入菜单。断点定义见 `SiteHeader.vue` 与 `app/assets/css/main.css`，修改时同步核对脚本和样式。

菜单使用共享 `UiPopover`，从四宫格按钮下方靠右弹出，不撑高顶栏。浮层定位、极光玻璃材质、进出动效、外部点击关闭及 Escape 焦点恢复由共享 UI 提供。菜单内语言与主题分组纵向排列，页面跳转或跨响应式断点后收起。宽屏与菜单复用同一组导航和设置组件。

主导航选中标记沿用共享 `spatial` 时长与减速缓动，不使用线性位移或弹性过冲。

顶栏在页顶铺开，滚动超过共享 `space-4` 对应距离后收成悬浮形态。顶栏轮廓在两种状态下都保留底部的共享卡片圆角，收拢只改变宽度、上移量与顶部圆角，形变按共享时长线性推进，避免轮廓在数帧内跳到位。顶栏贴着窗口，页顶背后没有可折射的内容，因此通过共享 UI 的 `data-neoverse-glass-edge-stroke` 启用材质自带的绘制描边，描边取自 `--neoverse-material-edge-stroke`，门户不写自己的边缘实现。包裹区域随实际内容计算高度，文档滚动条按实际顶栏高度避让。标识与菜单容器使用 Flex 居中，避免内联基线影响垂直位置。文档滚动条由布局直接服务端渲染并经 Teleport 移到 `body`，共享样式表据 `data-hide-native` 在首帧即隐藏原生条，刷新时不出现原生条与沉浸式轨道的替换和横向重排；`ClientOnly` 包裹会退回挂载后才隐藏的旧行为。

## 主题、语言与共享 UI

导航复用 `UiNavigationItem`，主题与语言复用 `UiSegmentedControl`。三组控件分别由共享 `UiControlSurface` 提供默认的 `glass-subtle` 外观，并通过 `edge-mode="local"` 使用相同的边缘绘制方式。内层导航项和分段控件使用 `surface="none"`，避免叠加独立背景与阴影，保留各自的选中样式与键盘操作。语言与主题外壳通过公开的 `--neoverse-control-surface-padding-inline` 复用纵向内边距，使四周留白一致。控件内部采用共享默认尺寸，门户不覆盖字号、点击区域、材质、滑块或焦点样式。主题控件与 `xca theme` 共用 `useSiteTheme`，语言控件与终端服务共用 `useSiteLocale`。切换不重建会话。顶栏的宽度过渡由共享 `useLayoutWidthMotion` 承担：门户只提供容器、目标选择器与触发值，采样、终点解析、`spatial` 时长与缓动、打断续接和终止条件都在共享库内；底层原语 `captureLayoutWidths` 与 `animateLayoutWidths` 位于 `@neoverse-ui/motion`，Vue 适配位于 `@neoverse-ui/vue`，门户不维护第二套测量与动画状态。

根节点通过 `data-theme` 支持 light、dark 和 system，主题选择保存在 `xca-theme` Cookie。`useSiteTheme` 与根组件用同一偏好生成 SSR 的选中项和根节点主题，不在水合后恢复默认选项。根组件只在服务端向 Head 注册初始主题，客户端主题写入由 `useSiteTheme` 在过渡回调中执行，避免 Head 更新覆盖交互选择。`intro-gate.js` 在控件绘制前把旧 localStorage 偏好一次性迁移到 Cookie，迁移成功后移除旧值并重新请求 SSR，后续刷新不再迁移。顶栏及语言、主题控件不参与首页入场位移、缩放或错峰动画。语言存储、服务端首屏与命令输出规则只维护在 [翻译规则](../terminology/translation.md)。

切换选项时，选中背景的滑动与伸缩由共享分段控件提供。语言变化时，`SiteHeader` 通过共享 `useLayoutWidthMotion` 统一测量标识、主导航与偏好外壳的可见宽度，并在更新后先读取全部自然终点，再同时启动共享 `spatial` 宽度过渡，不缩放文字。所有占宽区域按同一进度变化，避免标识宽度先改变、偏好随后伸缩，将整个导航控件推过终点后又拉回。连续切换从当前可见宽度接续，完成后恢复自动宽度。首次渲染与水合不补播放动画，减少动态效果、尺寸变化及组件卸载会结束宽度动画；浏览器不支持动画接口时直接使用内容宽度。文档根节点不参与路由快照，只在视图过渡期间为正文分配 `root` 过渡名称，并将快照层裁剪到实时页头下方；主题切换以整个文档为快照，细节见下节。页头不单独命名或截图，保留实时玻璃背后采样，避免独立快照破坏材质。语言、主题和路由切换期间，选中背景与外壳宽度继续使用自身的平滑移动和伸缩，不被正文的交叉淡化遮住。

## 页面过渡与层级

路由切换与主题切换通过 View Transitions 完成，一次切换只呈现一个连续过程，不再是硬切。语言切换同样不启动快照：共享极光玻璃边缘由文档层画布绘制，不在任何正文截图内，整页快照会让每张卡片在淡化期间失去折射边、变成扁平白板；而截取整个文档会把中英文页头词条叠进同一张快照。因此语言切换就地替换文案，不叠加第二层内容、也不做文字动画——任何两层文字的混合都会在字形层面被看成闪烁。页头词条、卡片正文与终端都直接替换。只有盒子尺寸需要变化时才播放过渡：文案超出当前盒子时，盒子按共享 `spatial` 时长与缓动扩张或缩小，急速反向切换时从当前边沿接续而不是弹回任一端点。路由切换由 Nuxt 的 `experimental.viewTransition` 承担，门户不重写路由流程；`view-transition.client.ts` 在过渡开始时给根节点写入共享 `data-neoverse-view-transitioning` 属性，使根快照沿用共享 `spatial` 时长与缓动。路由过渡只截取正文：根节点不参与快照，正文分配 `root` 过渡名称，快照层裁剪到实时页头下方，页头因此保持实时玻璃采样。若页头仍有语言宽度动画在运行，Chrome 可能在截取进入快照时把实时玻璃重新采样为一帧白色；`view-transition.client.ts` 因此在路由更新完成、进入快照截取前暂停页头的背景采样，以共享回退底面保持不透明，并在快照绘制完成后立即恢复。退出快照与导航加载期间保持实时采样，普通路由不暂停。主题切换改写的不只是正文，画布、页头与页脚同样换色，因此主题过渡以整个文档作为快照并取消该裁剪，否则只有正文在淡化，其余部分围绕淡化硬切；主题属性通过 `:not([data-neoverse-theme-view-transitioning])` 与正文规则互斥，两条规则同时命中时不会产生重复的 `root` 名称。原生顶层表面（共享 `UiPopover` 菜单）绘制在快照之上，无法透过快照采样页面，玻璃材质会在整段淡化中失去模糊而显得透明；因此有该类表面打开时，主题切换由 `app/utils/top-layer.ts` 判定后直接提交，不启动整页快照。来源页滚动后，根分组固定在截取时的正文盒模型，进入快照按目标页实时页顶偏移，交叉淡化期间两侧画面不再随分组几何滑动；页头落定引起的高度变化由同一偏移跟随。旧快照保留淡出终点，避免浏览器在移除快照树前的一帧恢复其不透明度。过渡结束前再次导航时，新导航先终结旧快照，并不再为这次被中断的导航截取新快照，直接提交目的页，避免旧页画面在目的页上继续淡入后突然消失；路由落定后 1 秒内返回上一页同样直接提交，窗口从快照结束起算而非路由提交时，之后完成的导航恢复过渡。只有最新的一次过渡负责移除标记，快照准备失败时也会移除。两者都遵循减少动态效果偏好与浏览器能力降级：不支持 View Transitions 或启用减少动态效果时直接更新内容，不播放动画。

停靠状态的终端卡片属于页面流，不单独占层。吸顶页头使用共享 `sticky` 层，短视口把终端卡片滚到页头下方时，页头仍绘制在上层。首页入场与终端聚焦态由首页场景自身占层：入场使用 `overlay` 层并隐藏页头，聚焦使用 `modal` 层覆盖整屏。紧凑布局的菜单按钮使用共享 `UiPopover` 的 `trigger-variant="ghost"`，与导航项和设置控件一致，不显示次要按钮的实底色。

`nuxt.config.ts` 在样式表之前声明 CSS 层顺序，使基础重置层始终低于组件层，不依赖开发服务器的 SSR 样式链接顺序。声明使用固定的 `xca-cascade-order` key，服务端输出与客户端 Head 更新按同一标识复用。正文样式与共享控件保持各自的公开样式层，不提高选择器优先级覆盖基础重置。

页面底色使用共享 `surface-canvas` token。首页局部背景变量 `--xca-home-canvas` 在深色使用 `#060b13`，渐变色阶混合共享次要文字色推导。浅色以 `#f5f9fc` 为底色，中下部混合 8% 共享辅助色形成淡薄荷色，左上方叠加透明度为 8% 的共享主色线性渐变形成淡蓝色过渡。深色下该叠层完全透明。背景采用大尺度低对比度渐变，其他路由保留共享画布底色。背景不创建额外节点或动画，随共享主题同步切换。终端和顶栏的极光玻璃材质继续由共享 UI 提供。

顶栏与终端复用共享极光玻璃材质，浏览器支持时由唯一共享 Glass Runtime 增强边缘折射。WebGL 不可用时由共享 CSS 回退。动画调用共享刷新能力，门户不建立第二套玻璃运行时。应用卸载和热更新时销毁 Renderer，清理画布与监听。

关于学社的标题与正文统一放在共享 `UiCard` 的 `glass-elevated` 卡片内，不直接铺在页面画布上。介绍依据 [学社公开资料](https://github.com/XAUFE-CA)。`ContentRenderer` 渲染 Markdown 的标题、段落、列表与链接，排版复用共享 `neoverse-prose`，不为章节编写专用 Vue 模板或重复 CSS。正文与页面元信息只在对应语言的 Markdown 中维护；缺失内容时返回 404。

Markdown 通过原生 MDC 容器标记页面布局：`about-intro` 使用共享展示标题与导语字号，`about-values` 强调理念，`about-topic` 在宽屏双栏、不大于 `48rem` 时单栏，`about-participate` 与 `about-actions` 承载参与说明和操作入口。正文容器带 `neoverse-prose`，操作入口放在正文排版范围之外，避免共享链接样式影响按钮。按钮通过 `ContentRenderer` 映射已有 `SiteActionLink`，保留共享默认尺寸、材质与焦点样式。

关于学社的“浏览公开项目”和“贡献指南”按钮在中英文页面均以 `target="_blank"` 打开，保留当前页面，并设置 `rel="noopener noreferrer"`。

新增双栏内容块时，在两份 Markdown 中使用相同的容器结构，不需要新增 Vue 模板：

```md
::section{.about-topic .neoverse-prose}

## 章节标题

章节正文。
::
```

卡片顶部展示学社横幅，路径、替代文本与原始尺寸来自 Markdown 的 `banner` 字段。两条路径直接引用组织总仓库 `XAUFE-CA/.github` 的 `profile/assets/xca-banner-light.webp` 与 `xca-banner-dark.webp`，门户不保存副本，也不做格式转换。浅色使用 light 版本，深色使用 dark 版本，系统模式跟随 `prefers-color-scheme`；展示保留 3:1 比例，不裁切图片。两张图片通过 CSS 按根节点 `data-theme` 显示对应版本，使用原生懒加载，隐藏版本不占布局或无障碍阅读位置。根节点主题随 SSR 输出，因此图片选择不等待 Vue 水合。横幅只在组织总仓库更新；源图尺寸变化时同步修改内容字段的 `width` 与 `height`。

正文查询使用不阻塞导航的懒加载：客户端跳转先渲染卡片骨架，服务端仍等待查询以直出正文。一次查询同时取回两种语言的正文，切换语言时按 `locale` 就地选取，卡片不会退回骨架，也不会在切换期间把横幅换成占位块。骨架样式取自共享 `UiSkeleton`，保留共享默认半透明填充与无障碍回退。横幅占位保持 3:1，正文保留通栏与双栏结构，每节使用 1–2 条正文占位行，行间距取共享 `space-6`，区块间距取 `space-12`，`aria-busy` 标记加载中。取数完成后，骨架与正文在同一网格区域交叉淡化，离开的内容退出键盘与无障碍访问。过渡沿用共享 `expressive` 时长与线性缓动，不增加取数等待时间，也不对服务端直出的正文补播放入场。首次查询错误直接抛出，后续查询错误交给错误页。缺失正文只在查询成功后按 404 处理，加载中不报错。

正文就绪后，横幅图片仍有独立的加载骨架。明暗骨架分别跟随对应图片的主题显示规则，只覆盖横幅固有比例区域，不参与正文布局；当前主题图片加载或失败结束后淡出对应骨架，切换主题不会复用另一张图片的完成状态。横幅容器挂载时同步已完成的缓存图片，覆盖首屏水合与懒加载正文就绪两种情况，避免遗漏加载事件后残留骨架。正文与横幅过渡均遵循减少动态效果偏好，启用时立即切换。

## 验证

浏览器回归入口为 `tests/e2e/site-footer.spec.ts`、`mobile-header.spec.ts`、`locale.spec.ts`、`scrollbar.spec.ts`、`neoverse-integration.spec.ts`、`preferences-refresh.spec.ts`、`header-edge-rim.spec.ts`、`about-skeleton.spec.ts`、`site-transitions.spec.ts` 与 `route-interruptions.spec.ts`。覆盖导航及设置可达性、宽度变化、语言刷新、焦点恢复、主题与玻璃降级，以及顶栏底部圆角与描边归属、内容加载骨架的状态与几何。偏好刷新回归延迟水合脚本，逐帧检查 SSR 至水合完成期间的选中项及选中背景几何，不只核对最终状态。过渡回归记录共享时长，确认路由切换保留正文交叉淡化且页头不混合旧快照、主题切换以整个文档为快照，语言切换不启动快照、保持全部玻璃表面采样实时页面并断言卡片高度过渡；三组选中背景和偏好外壳仍经过中间几何状态。路由中断回归检查反向导航的实际画面、未完成的正文查询和被取消的快照。路由过渡回归检查来源页滚动后的快照几何与淡出终点帧，确认两侧画面停在各自页顶且旧快照不会在结束帧恢复不透明。整组导航回归使用真实鼠标切换中英文，按同一进度推进全部宽度动画，检查标识外壳起点、单向伸缩、终点及恢复自动宽度后的几何，防止越界回弹，并确认主导航在每个进度都停在顶栏中线上。减少动态效果时不启动视图过渡。层级回归在短视口滚动到底，检查终端卡片与页头重叠处命中页头。检查方式见 [工程质量规则](engineering-quality.md#分级与执行责任)，检查结果与图片验收分别记录。
