# 页脚

Status: adopted

本文描述全站页脚的内容、标语火焰、构建信息、资产与浏览器回归入口。站点外壳组合见 [站点框架](README.md)，入场期间的页脚显现见 [首页入场](../home-intro.md)。

[default.vue](../../../app/layouts/default.vue) 在站点外壳内为全部路由挂载同一个 [SiteFooter.vue](../../../app/components/site/SiteFooter.vue)。首页的 `.site-main` 取 `100svh` 减去页头高度的 `min-height`，终端保持沉浸式，页脚落在首屏之外，需要滚动才能看到。移动端沿用同一规则与 `svh` 单位。

其余路由共用同一份内容、样式与数据源。

页脚内容不随路由变化。路由过渡只截取 `.site-main`，位于快照之外的页脚若按路由改写会在切换时硬切。主题过渡以整个文档为快照，页脚颜色全部取自共享样式变量。语言切换就地替换文案，不做文字动画。页脚引语不跟随站点语言，点击引语切换（见下）。

上半区在 `70rem` 以上把左侧的联合标识区与标语放在同一行并垂直居中。标识区自上而下是 CA 标识与 Neoverse-UI 字标组成的联合标识，以及上下两行的共享库署名 `由 Neoverse-UI 强力驱动` 与构建行 `本项目代码 已开源 (短 SHA @ 提交时间)`。署名行只把库名做成链接，前后的说明留在链接外，“已开源”用主文本色加粗并链接到项目仓库，括号内的短 SHA 链接到提交页面，时间戳是同一链接的文案。

标语在右，整体靠右而行内左对齐，在文案里按句换行并由 `white-space: pre-line` 保留。`70rem` 以下改为上下排列，标语独占整行宽度，避免自带断行被再次折行而缩成窄栏。`38rem` 以下改为整段自然排列，并按均衡断行避免末行只剩单字。

分割线以下居中收尾两行。第一行是版权 `© yyyy XAUFE-CA | Shenshijun`，组织名链接到 GitHub 组织，作者名链接到个人主页。第二行是许可句，完整写明 `本站源码采用 MIT 许可，文章采用 CC BY-NC-SA 4.0 许可`，两项许可分别链接到仓库 `LICENSE` 与 CC BY-NC-SA 4.0 许可页。

页脚不重复站内导航，入口由顶栏承担。脚注链接悬停或聚焦时浮出圆角底板并转为强调色，按下时变深。底板填满行盒并在下方下移 `0.11em`，使字形墨迹在底板上下留白一致。链接地址统一维护在 [site.ts](../../../app/config/site.ts) 的 `links`，界面文案维护在双语资源，两份资源的键和插值一致。所有外部目标设置 `target="_blank"` 与 `rel="noopener noreferrer"`。

标语上叠加一层火焰余烬：[TaglineFlame.vue](../../../app/features/tagline-flame/components/TaglineFlame.vue) 在与文案相同的 `<p>` 内渲染 `aria-hidden` 且不接收指针事件的画布，余烬从字形升起，配色取自共享 token 的琥珀与浅红。画布只在可见时绘制。主题过渡冻结画布，路由过渡不截取页脚。减少动态效果不渲染。

引语始终先以英文出现，与站点语言无关。引语本身是按钮，点击在英文与中文之间切换，`title` 说明该操作。[SiteFooter.vue](../../../app/components/site/SiteFooter.vue) 同时传入两份文案，`TaglineFlame.vue` 持有自己的语言状态，并用 `lang` 标注当前语言、用 `aria-live` 播报替换后的引语。

切换先失焦后回焦。旧文案用快速时长模糊淡出，新文案带着同一层模糊与部分亮度入场，再用标准时长回到清晰。减少动态效果时直接替换。

两份文案叠放在同一网格单元，框体始终保留更高的英文高度，较短的文案在框体内垂直居中并与左侧署名共用中线，页脚其余部分不随行数移动。不可见的英文副本只负责撑起尺寸，`aria-hidden` 且不进入余烬测量。画布在新文案落定后重新读取字形盒子，余烬从新文案的字形升起。

版权年份由 [copyright.ts](../../../app/utils/copyright.ts) 按首次发布年份计算。当前年份不大于 `2026` 时写 `2026`，之后写 `2026 - yyyy`。

年份在 SSR 通过 `useState` 解析一次并随水合数据传递，避免服务端与客户端在跨年边界得出不同结果。静态生成时年份固定在构建当次。

构建信息由 [build-info.ts](../../../scripts/build/build-info.ts) 在配置加载时读取 `git log -1`，经 `nuxt.config.ts` 写入 `runtimeConfig.public.buildInfo`，链接指向 `XAUFE-CA/XCA-Portal` 的 commit 页面，显示短 SHA 与提交时间。Git 不可用时回退到 CI 的 `GITHUB_SHA`。两者都不可用时 `buildInfo` 为 `null`，页脚隐藏构建行，不显示未核实的提交。

时间戳保留提交者自身时区，只把 Git 严格 ISO 字符串的 `T` 换成空格，不按浏览器时区重新格式化。缺少时间戳时只显示短 SHA。

联合标识的 CA 图稿沿用 [ca-mark.svg](../../../public/brand/ca-mark.svg) 的紧凑方形 `viewBox`，入场场景仍还原为 1254 单位坐标系。

Neoverse-UI 字标取自共享库 `apps/playground/src/assets/neoverse-wordmark.svg`，采用 MIT 许可，副本存于 [neoverse-wordmark.svg](../../../public/brand/neoverse-wordmark.svg)，裁剪 `viewBox` 并把填充色统一为 CA 的 `#161616`，深色下两张标识用 `brightness(0) invert(1)` 呈纯白。深色与系统深色沿用顶栏标识的 `invert(1)` 规则，不新增颜色值。资产来源另见 [字体与资产维护](../fonts.md#加载与许可)。

首页完整入场期间，[intro-gate.js](../../../public/intro-gate.js) 与 [terminal-intro.css](../../../app/assets/css/terminal-intro.css) 继续隐藏页脚，`revealing` 阶段显现。减少动态效果时不设置首帧门禁，页脚直接可读。

浏览器回归入口为 [site-footer.spec.ts](../../../tests/e2e/site/site-footer.spec.ts)、[site-footer-links.spec.ts](../../../tests/e2e/site/site-footer-links.spec.ts) 与 [mobile-header.spec.ts](../../../tests/e2e/site/mobile-header.spec.ts)，覆盖版权行的组织与作者链接、源码与文章许可、共享库署名、构建行与括号时间戳、链接悬停底板的上下留白与按下反馈、双语切换、窄屏溢出，以及桌面与移动端页脚位于首屏之外、滚动后可见。
