# 主题与语言切换的三处观感缺陷（2026-11-06）

Status: historical

本文记录 2026-11-06 对主题切换、语言切换与移动端菜单三处闪烁的排查与修复。现行行为以 [站点框架](../../../docs/architecture/site-shell/README.md)、`app/composables/useSiteTheme.ts`、`app/composables/useSiteLocale.ts`、`app/components/about/AboutSection.vue`、`app/utils/top-layer.ts` 与 `app/assets/css/main.css` 为准。

## 结论

三处缺陷共因是「快照范围」与「玻璃边缘归属」，但结论不同：

1. **主题切换丢失平滑过渡**：`a7dda78` 起主题与语言、路由共用同一条规则，只把 `.site-main` 命名为 `root` 并裁剪快照层。主题换色同时改写 `.site-shell` 画布、玻璃页头与页脚，三者都在快照之外，于是背景与页头立即跳到终值，只有正文在淡化。修复为主题过渡以整个文档为快照并取消裁剪；正文规则改为只在 `[data-neoverse-view-transitioning]` 且无主题属性时命中，两条规则不会同时产生 `root` 名称。主题切换里页头本来就要换色，整页快照把页头一并纳入淡化是正确结果，滚动位置也不会跳。
2. **切换语言时卡片玻璃消失、变白**：共享极光玻璃边缘由 `body` 下的固定画布绘制，位于任何正文快照之外，又被视图过渡快照层压在下面。语言切换期间每张卡片只剩 20% 底面与 1px 边框，折射边完全消失，浅色下读作扁平白板。
3. **切换语言时关于学社内容消失再出现**：`about.vue` 的 `useAsyncData` 以语言分键，切换即重新取数，`page` 变空，卡片退回骨架（横幅变占位块、正文变占位条）。

第 2、3 项的最终处置：语言切换**不使用整页快照，也不做任何文字动画**。曾试过内容层交叉淡化（退出文案绝对定位在进入文案之上、只淡化退出层），但两层文字在任何中途都会在字形层面被看成闪烁，最终改为就地替换：只有一个内容层，文字始终不透明。页头词条、卡片正文与终端都直接替换。只有盒子尺寸需要变化时才播放过渡：文案超出当前盒子时，盒子按共享 `spatial` 时长与缓动扩张或缩小，急速反向切换时从当前边沿接续而不是弹回任一端点。骨架退回问题由「一次查询取回两种语言」解决。

## 失败模式

| 条件 | 浏览器行为 | 用户看到的画面 |
| --- | --- | --- |
| 主题切换只截取 `.site-main` | 画布、页头、页脚不在快照内 | 背景与页头瞬间换色，正文单独淡化 |
| 语言切换截取 `.site-main` | 玻璃边缘画布在快照之外且被快照层覆盖 | 卡片失去折射边，浅色下变白，切换结束后复原 |
| 语言切换整页快照 | 页头词条在旧、新快照中叠加 | 页头出现中英文重叠双影 |
| 语言切换加整页字形淡化 | 文字先暗后亮 | 切换瞬间整页文字闪一下 |
| 卡片尺寸动画被取消后从端点重开 | 动画中断即回弹 | 快速切换时卡片突然卡回旧高度 |
| 语言切换重新取数 | `page` 变空，卡片进入 `aria-busy` | 横幅与正文变成占位块，加载完成后复原 |

## 证据

Chrome，1280×800，以点击为起点逐帧截取（CDP `Page.screencastFrame`），并按时间线读取计算样式：

| 场景 | 采样 | 截取正文（旧） | 现行 |
| --- | --- | --- | --- |
| 终端卡片左边缘（放大 40×200 裁片） | 120ms | 柔和折射高光消失，只剩细边框 | 与切换前逐像素一致 |
| 主题页头（120×40） | 90ms / 120ms | 已到终值 `19,29,41` | `197,203,209` / `56,64,76`，与正文同进度 |
| 主题、滚动 700px 后 | 170ms | — | 快照停留在原滚动位置，整屏同进度变色 |
| 关于学社卡片高度 | 切换后 0–420ms | 直接跳到新值 | `1232 → 1362` 连续过渡，`overflow: clip` 覆盖增长过程 |
| 语言切换文案 | 切换后首帧 | 交叉淡化 420ms | 就地替换，无任何文字动画 |

整页快照（`:root` 命名 `root`）可以让卡片边缘一并进入快照，但实测 200ms 帧出现「首页/Home」「关于学社/About」「浅色/Light」重叠，因此不作为语言切换方案。字形淡化（`-webkit-text-fill-color` 过渡）实测可用，但用户否定了这种“闪一下”的观感，已移除。

## 尝试与取舍

- 整页快照：保住卡片边缘，但页头词条重叠，且顶层浮层仍无法采样，没有采用。
- 只把页头采样暂停 1–3 帧（`2026-11-04` 的做法）：只覆盖页头，卡片边缘依旧丢失，没有采用。
- 字形淡化（过渡或注册自定义属性驱动）：技术可行，但整页文字先暗后亮会闪一下，按用户要求取消。
- 全局 `* { transition: -webkit-text-fill-color }`：会覆盖分段控件的 `transform` 过渡与终端自身的过渡，导致选中背景瞬移，已放弃。
- 最终取舍：语言切换完全不做整页动效，只保留各盒子自身的尺寸过渡。

## 验证

- 生产构建（独立工作树，避免占用使用者的开发服务器）下运行 `site-transitions`、`about-skeleton`、`theme-transition`、`mobile-header`、`locale`、`preferences-refresh`：**43 通过，0 失败**；加入内容层交叉淡化与可打断伸缩后复跑 `about-skeleton` 与 `site-transitions`：**19 通过，0 失败**。
- `vue-tsc --noEmit -p tsconfig.json`：通过；阈值、文档、架构、终端边界门禁：通过（0 个未批准硬上限、0 条禁用表述）。
- `bun test app scripts`：127 通过，0 失败。
- 语言切换的画面以 125% 缩放的逐像素裁片对比确认（切换前与切换后 120ms 完全一致）。
- 未验证：`prefers-reduced-transparency` 组合；路由过渡仍截取正文，导航淡化期间卡片边缘同样不参与快照，本次未改动。

## 文件

- `app/assets/css/main.css`：主题与路由的快照范围分离，删除语言过渡的页头采样暂停规则。
- `app/composables/useSiteTheme.ts`：主题整页快照；顶层表面打开时直接提交。抽出 `resetPendingWork()` 以符合函数行数上限。
- `app/composables/useSiteLocale.ts`：语言切换就地替换，不含快照与淡化逻辑。
- `app/components/about/AboutSection.vue`：语言切换就地替换文案、按共享 `spatial` 时长伸缩卡片高度（可从当前边沿接续），首次加载仍走骨架交叉淡化。
- `app/utils/top-layer.ts`：顶层表面探测（主题切换使用）。
- `app/utils/motion.ts`：新增 `motionDuration()`，页头与卡片共用同一套 token 解析。
- `app/pages/about.vue`：两种语言一次取回。
- `tests/e2e/theme-transition.spec.ts`、`site-transitions.spec.ts`、`mobile-header.spec.ts`、`about-skeleton.spec.ts`：快照范围、材质保持、卡片伸缩与语言切换不退回骨架的回归。
- `docs/architecture/site-shell.md`：同步快照范围与语言切换策略。

## 事实依据

| 事项 | 依据 |
| --- | --- |
| 主题切换入口与快照生命周期 | `app/composables/useSiteTheme.ts` |
| 语言切换入口 | `app/composables/useSiteLocale.ts` |
| 卡片尺寸过渡 | `app/components/about/AboutSection.vue`、`app/components/site/SiteHeader.vue` |
| 快照命名与裁剪 | `app/assets/css/main.css` |
| 玻璃边缘画布 | `@neoverse-ui/glass-runtime`（画布挂在 `body` 下，`position: fixed`） |
| 关于学社取数 | `app/pages/about.vue`、`content.config.ts` |
| 回归 | `tests/e2e/site-transitions.spec.ts`、`about-skeleton.spec.ts`、`theme-transition.spec.ts`、`mobile-header.spec.ts` |

## 后续：路由截取期间的页头采样暂停

同日晚间补记：语言切换不再启动快照后，用户报告“关于学社滚动到悬浮页头 → 反复切换语言 → 迅速点主页”时页头闪烁。页头宽度动画（标识、导航外壳、偏好外壳，共享 `spatial` 420ms）在路由截取开始时仍在运行；Chrome 在截取路由快照时可能重新采样实时页头玻璃并绘制一帧白色，与上文“语言切换页头玻璃闪白”属同一浏览器行为，只是触发点从语言快照变成了路由快照。

首版从 `router.beforeEach` 一直暂停到 `transition.ready`，覆盖了两次快照，但导航加载通常需要 150–200ms，页头在这段时间只剩 20% 底面，用户随即报告“下方文字透到标题栏上、标题栏边透明”。`requestAnimationFrame` 在截取与导航期间不执行，无法用帧回调缩短该窗口。

最终修复只在**页头确实有宽度动画在运行**时暂停进入快照：

- `router.beforeEach` 记录页头是否仍在伸缩；`page:finish`（路由更新完成、进入快照截取前）写入 `data-xca-route-glass-pause` 并立即安排恢复；`transition.ready` 后两个合成帧恢复，`finished`/失败路径兜底。退出快照、导航加载与淡出过程保持实时采样。
- `app/assets/css/main.css` 在属性存在时把 `.site-header` 的 `backdrop-filter` 置为 `none`，同时使用共享 `--neoverse-material-background-fallback` 保持底面不透明；绘制描边与布局不变，页面文字不会透出。
- `tests/e2e/site-transitions.spec.ts` 拉长页头宽度动画，断言进入快照时 `glassPaused` 为真、`backdropFilter` 为 `none`、底面不透明，过渡后属性清除并恢复模糊；暂停事件只在路由已切到目的页后发生，普通导航不暂停。
- `docs/architecture/site-shell.md` 同步进入快照窗口、回退底面与恢复时机。

证据边界：与 2026-11-04 的记录一致，软件截取（CDP `Page.screencastFrame`，Chrome/Edge 无头，含 DPR 1.5 与 CPU 节流）没有稳定复现白色单帧。首版的透明窗口由逐帧计算样式直接测得（`backdrop-filter: none`、20% 底面持续约 170ms），最终版本的暂停窗口约 20ms、位于路由切换之后且使用不透明回退底面；白色闪帧本身仍以用户 Chrome 的观感为准。相关浏览器行为沿用上文 2026-11-04 的结论。
