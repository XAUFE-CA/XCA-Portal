# 站点框架

Status: adopted

本文描述导航布局、主题与语言控件、共享材质接入。开发准备见 [工程质量契约](engineering-quality.md#本地开发与共享依赖)，语言资源与内容维护见 [翻译规则](../terminology/translation.md)，首页场景见 [首页入场](home-intro.md)。

## 页面与内容来源

| 路由 | 内容来源 |
| --- | --- |
| `/` | 首页组合；轮播语句来自 `app/data/hero-sentences.json` |

当前仅注册首页，导航和终端跳转使用同一份路由配置。路由和数据调整时同步更新此表。

## 源码职责

| 位置 | 职责 |
| --- | --- |
| [default.vue](../../app/layouts/default.vue) | 页顶、页面容器与页脚组合 |
| [SiteHeader.vue](../../app/components/site/SiteHeader.vue) | 响应式导航、菜单与滚动定位 |
| [SiteHeaderNavigation.vue](../../app/components/site/SiteHeaderNavigation.vue) | 导航项展示与跳转事件 |
| [SiteHeaderPreferences.vue](../../app/components/site/SiteHeaderPreferences.vue) | 语言、主题分段控件 |
| [site.ts](../../app/config/site.ts) | 品牌、路由、导航与主题选项 |
| [useSiteTheme.ts](../../app/composables/useSiteTheme.ts)、[useSiteLocale.ts](../../app/composables/useSiteLocale.ts) | 主题与语言的公共状态 |
| [glass.client.ts](../../app/plugins/glass.client.ts) | 唯一共享 Glass Renderer 的挂载、刷新与销毁 |

## 导航与响应式布局

顶栏按可用 CSS 视口宽度分三级布局：大于 `70rem` 时品牌、主导航与设置同排，主导航在中间栏居中；大于 `38rem` 且不大于 `70rem` 时保留同排主导航，将语言和主题放进菜单；不大于 `38rem` 时主导航也放入菜单。断点事实来源为 `SiteHeader.vue` 与 `app/assets/css/main.css`，修改时同步核对脚本和样式。

菜单使用共享 `UiPopover`，从四宫格按钮下方靠右弹出，不撑高顶栏。浮层定位、极光玻璃材质、进出动效、外部点击关闭及 Escape 焦点恢复由共享 UI 提供。菜单内语言与主题分组纵向排列，页面跳转或跨响应式断点后收起。宽屏与菜单复用同一组导航和设置组件。

顶栏在页顶铺开，滚动超过共享 `space-4` 对应距离后收成悬浮形态。包裹区域随实际内容计算高度，文档滚动条按实际顶栏高度避让。品牌与菜单容器使用 Flex 居中，避免内联基线影响垂直位置。

## 主题、语言与共享 UI

导航复用 `UiNavigationItem`，主题与语言复用 `UiSegmentedControl`。控件采用共享默认尺寸和 `glass-subtle` 外观，门户不覆盖字号、点击区域、材质、滑块或焦点样式。主题控件与 `xca theme` 共用 `useSiteTheme`，语言控件与终端服务共用 `useSiteLocale`；切换不重建会话。

根节点通过 `data-theme` 支持 light、dark 和 system，主题选择保存在浏览器本地。语言存储、服务端首屏与命令输出规则只维护在 [翻译规则](../terminology/translation.md)。

页面底色使用共享 `surface-canvas` token，不叠加装饰性发光背景。终端和顶栏的极光玻璃材质继续由共享 UI 提供。

顶栏与终端复用共享极光玻璃材质，浏览器支持时由唯一共享 Glass Runtime 增强边缘折射；WebGL 不可用时由共享 CSS 回退。动画调用共享刷新能力，门户不建立第二套材质运行时。应用卸载和热更新时销毁 Renderer，清理画布与监听。

## 验证

浏览器回归入口为 `tests/e2e/mobile-header.spec.ts`、`locale.spec.ts`、`scrollbar.spec.ts` 与 `neoverse-integration.spec.ts`。覆盖导航及设置可达性、宽度变化、语言刷新、焦点恢复、主题与材质降级。检查方式见 [工程质量契约](engineering-quality.md#分级与执行责任)，检查结果与图片验收分别记录。
