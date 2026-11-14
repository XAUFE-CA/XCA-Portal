# 站点框架

Status: adopted

本文描述站点框架的组成、页面来源与源码职责，并索引各专题。导航与偏好控件见 [站点导航与偏好控件](navigation.md)，页脚见 [页脚](footer.md)，上下文菜单见 [上下文菜单](context-menu.md)，页面过渡与层级见 [页面过渡与层级](transitions.md)，关于学社页面见 [关于学社页面](about.md)。开发准备见 [工程质量规则](../engineering-quality.md#本地开发与共享依赖)，语言资源与内容维护见 [翻译规则](../../terminology/translation.md)，首页场景见 [入场场景](../intro-scene.md)。

## 页面与内容来源

| 路由 | 内容来源 |
| --- | --- |
| `/` | 首页组合；轮播语句来自 `app/data/hero-sentences.json` |
| `/about` | [中文 Markdown](../../../content/pages/about/zh-CN.md) 与 [英文 Markdown](../../../content/pages/about/en.md)，含正文、SEO 与横幅元信息 |

导航和终端跳转使用同一份路由配置。路由和数据调整时同步更新此表。

## 源码职责

| 位置 | 职责 |
| --- | --- |
| [default.vue](../../../app/layouts/default.vue) | 页顶、页面容器与页脚组合 |
| [about.vue](../../../app/pages/about.vue)、[AboutSection.vue](../../../app/components/about/AboutSection.vue) | 按语言查询 Markdown、设置 SEO，组合玻璃卡片与主题横幅；查询失败时在站点外壳内呈现降级状态，保留导航 |
| [SiteHeader.vue](../../../app/components/site/SiteHeader.vue) | 响应式导航、菜单与滚动定位 |
| [SiteHeaderNavigation.vue](../../../app/components/site/SiteHeaderNavigation.vue) | 导航项展示与跳转事件 |
| [SiteHeaderPreferences.vue](../../../app/components/site/SiteHeaderPreferences.vue) | 语言、主题分段控件 |
| [SiteIcon.vue](../../../app/components/site/SiteIcon.vue) | 门户图标数据与 morphicons Vue 适配，统一线宽、连续变形和减少动态效果偏好 |
| [site.ts](../../../app/config/site.ts) | 标识、路由、导航与主题选项 |
| [useSiteTheme.ts](../../../app/composables/useSiteTheme.ts)、[useSiteLocale.ts](../../../app/composables/useSiteLocale.ts) | 主题与语言的公共状态 |
| [glass.client.ts](../../../app/plugins/glass.client.ts) | 唯一共享 Glass Renderer 的挂载、刷新与销毁 |
| [view-transition.client.ts](../../../app/plugins/view-transition.client.ts) | 路由视图过渡的共享节奏标记 |
| [content.config.ts](../../../content.config.ts) | `about` 内容集合与 frontmatter Schema |
| [SiteFooter.vue](../../../app/components/site/SiteFooter.vue) | 全站页脚：联合标识与标语、版权与作者署名、源码与文章许可、共享库署名与构建提交链接 |
| [build-info.ts](../../../scripts/build/build-info.ts) | 构建期读取 Git 提交并生成 commit 链接，无 Git 时按 CI 环境变量降级 |
| [copyright.ts](../../../app/utils/copyright.ts) | 版权年份区间规则 |
| [context-menu/](../../../app/features/context-menu/index.ts) | 上下文菜单负责区域监听、菜单项内容与复制反馈。面板由共享 `UiContextMenu` 绘制 |

## 验证

浏览器回归入口为 `tests/e2e/site/` 下的 `site-footer.spec.ts`、`site-footer-links.spec.ts`、`mobile-header.spec.ts`、`locale.spec.ts`、`scrollbar.spec.ts`、`neoverse-integration.spec.ts`、`preferences-refresh.spec.ts`、`header-edge-rim.spec.ts`、`about-skeleton.spec.ts`、`site-transitions.spec.ts` 与 `route-interruptions.spec.ts`。覆盖导航及设置可达性、宽度变化、语言刷新、焦点恢复、主题与玻璃降级，以及顶栏底部圆角与描边归属、内容加载骨架的状态与几何。

偏好刷新回归延迟水合脚本，逐帧检查 SSR 至水合完成期间的选中项及选中背景几何，不只核对最终状态。过渡回归记录共享时长，确认路由切换保留正文交叉淡化且页头不混合旧快照，主题切换以整个文档为快照，语言切换不启动快照、保持全部玻璃表面采样实时页面并断言卡片高度过渡。三组选中背景和偏好外壳仍经过中间几何状态。

路由中断回归检查反向导航的实际画面、未完成的正文查询和被取消的快照。路由过渡回归检查来源页滚动后的快照几何与淡出终点帧，确认两侧画面停在各自页顶且旧快照不会在结束帧恢复不透明。它同时断言语言宽度动画期间只在进入快照的截取窗口暂停页头背景采样并保持底面不透明，快照就绪后恢复，退出快照与导航加载保持实时采样，普通路由不暂停。

整组导航回归使用真实鼠标切换中英文，按同一进度推进全部宽度动画，检查标识外壳起点、单向伸缩、终点及恢复自动宽度后的几何，防止越界回弹，并确认主导航在每个进度都停在顶栏中线上。减少动态效果时不启动视图过渡。层级回归在短视口滚动到底，检查终端卡片与页头重叠处命中页头。检查方式见 [工程质量规则](../engineering-quality.md#分级与执行责任)，检查结果与图片验收分别记录。
