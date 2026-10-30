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
| [about.vue](../../app/pages/about.vue)、[AboutSection.vue](../../app/components/about/AboutSection.vue) | 按语言查询 Markdown、设置 SEO，组合玻璃卡片与主题横幅 |
| [SiteHeader.vue](../../app/components/site/SiteHeader.vue) | 响应式导航、菜单与滚动定位 |
| [SiteHeaderNavigation.vue](../../app/components/site/SiteHeaderNavigation.vue) | 导航项展示与跳转事件 |
| [SiteHeaderPreferences.vue](../../app/components/site/SiteHeaderPreferences.vue) | 语言、主题分段控件 |
| [site.ts](../../app/config/site.ts) | 标识、路由、导航与主题选项 |
| [useSiteTheme.ts](../../app/composables/useSiteTheme.ts)、[useSiteLocale.ts](../../app/composables/useSiteLocale.ts) | 主题与语言的公共状态 |
| [glass.client.ts](../../app/plugins/glass.client.ts) | 唯一共享 Glass Renderer 的挂载、刷新与销毁 |
| [content.config.ts](../../content.config.ts) | `about` 内容集合与 frontmatter Schema |

## 导航与响应式布局

顶栏按可用 CSS 视口宽度分三级布局：大于 `70rem` 时标识、主导航与设置同排，主导航在中间栏居中；大于 `38rem` 且不大于 `70rem` 时保留同排主导航，将语言和主题放进菜单；不大于 `38rem` 时主导航也放入菜单。断点定义见 `SiteHeader.vue` 与 `app/assets/css/main.css`，修改时同步核对脚本和样式。

菜单使用共享 `UiPopover`，从四宫格按钮下方靠右弹出，不撑高顶栏。浮层定位、极光玻璃材质、进出动效、外部点击关闭及 Escape 焦点恢复由共享 UI 提供。菜单内语言与主题分组纵向排列，页面跳转或跨响应式断点后收起。宽屏与菜单复用同一组导航和设置组件。

顶栏在页顶铺开，滚动超过共享 `space-4` 对应距离后收成悬浮形态。包裹区域随实际内容计算高度，文档滚动条按实际顶栏高度避让。标识与菜单容器使用 Flex 居中，避免内联基线影响垂直位置。

## 主题、语言与共享 UI

导航复用 `UiNavigationItem`，主题与语言复用 `UiSegmentedControl`。控件采用共享默认尺寸和 `glass-subtle` 外观，门户不覆盖字号、点击区域、材质、滑块或焦点样式。主题控件与 `xca theme` 共用 `useSiteTheme`，语言控件与终端服务共用 `useSiteLocale`。切换不重建会话。

根节点通过 `data-theme` 支持 light、dark 和 system，主题选择保存在 `xca-theme` Cookie。`useSiteTheme` 与根组件用同一偏好生成 SSR 的选中项和根节点主题，不在水合后恢复默认选项。`intro-gate.js` 在控件绘制前把旧 localStorage 偏好一次性迁移到 Cookie，迁移成功后移除旧值并重新请求 SSR，后续刷新不再迁移。顶栏及语言、主题控件不参与首页入场位移、缩放或错峰动画。语言存储、服务端首屏与命令输出规则只维护在 [翻译规则](../terminology/translation.md)。

`nuxt.config.ts` 在样式表之前声明 CSS 层顺序，使基础重置层始终低于组件层，不依赖开发服务器的 SSR 样式链接顺序。正文样式与共享控件保持各自的公开样式层，不提高选择器优先级覆盖基础重置。

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

卡片顶部展示学社横幅，路径、替代文本与原始尺寸来自 Markdown 的 `banner` 字段。浅色使用 [xca-banner-light.webp](../../public/brand/xca-banner-light.webp)，深色使用 [xca-banner-dark.webp](../../public/brand/xca-banner-dark.webp)，系统模式跟随 `prefers-color-scheme`。两张横幅由用户提供的同名 PNG 无损转为 WebP，原始图稿不变；展示保留 3:1 比例，不裁切图片。两张图片通过 CSS 按根节点 `data-theme` 显示对应版本，使用原生懒加载，隐藏版本不占布局或无障碍阅读位置。根节点主题随 SSR 输出，因此图片选择不等待 Vue 水合。

## 验证

浏览器回归入口为 `tests/e2e/mobile-header.spec.ts`、`locale.spec.ts`、`scrollbar.spec.ts`、`neoverse-integration.spec.ts` 与 `preferences-refresh.spec.ts`。覆盖导航及设置可达性、宽度变化、语言刷新、焦点恢复、主题与玻璃降级。偏好刷新回归延迟水合脚本，逐帧检查 SSR 至水合完成期间的选中项及选中背景几何，不只核对最终状态。检查方式见 [工程质量规则](engineering-quality.md#分级与执行责任)，检查结果与图片验收分别记录。
