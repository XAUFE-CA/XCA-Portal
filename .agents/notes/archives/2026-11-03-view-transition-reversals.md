# 路由过渡反向闪烁的修复记录（2026-11-03）

Status: historical

本文记录 2026-11-02 至 2026-11-03 两轮“首页与关于学社快速切换时旧页闪一下”的排查与修复。现行行为以 [站点框架](../../../docs/architecture/site-shell.md) 和 `app/plugins/view-transition.client.ts` 为准；本文只保留失败模式、验证方法与取舍依据。

## 结论

问题不在页面数据或 `<NuxtPage>` 的挂载顺序，而在路由 View Transition 的快照生命周期：

1. 旧快照继续播放到终点时，会以旧页作为“进入”画面越来越清晰，最后一帧才被移除。
2. 旧过渡已经结束、但用户在约 1 秒内返回时，会为返回导航重新截取一张旧页快照；正文交叉淡化期间，旧页在目的页上仍然可见。
3. 目标路由等于当前路由的快速回弹不会经过新的过渡，旧快照可能继续覆盖当前页。

对应处理：进行中的过渡先 `skipTransition()`；落定后 1 秒内返回来源页时不为返回导航截取快照；标记属性只由最新一次有效过渡移除。

## 失败模式

| 条件 | 浏览器行为 | 用户看到的画面 |
| --- | --- | --- |
| 正向过渡播放中立即反向 | 新的 `startViewTransition` 接管；旧快照若未终结，会继续播放到自身终点 | 旧页在目的页上越来越清晰，随后整帧消失 |
| 正向过渡刚结束就反向 | `active` 已清空，返回导航正常截取旧页快照 | 正文以旧页为起点交叉淡化约 420ms，页头已选中目的页 |
| 反向目标是当前路由 | Vue Router 判定重复导航，不启动新过渡 | 进行中的旧快照无人终结，继续绘制当前页 |

第二个条件是上一版仍然偶发的原因：`active` 只表示过渡正在播放，过渡结束后仍有一个用户会快速返回的时间窗口。延迟约 884ms 的逐帧采样在路径已经为 `/`、`.about-card` 已为 0 时仍记录到关于学社画面，证明旧快照来自返回导航本身，而不是残留 DOM。

## 现行处理

`app/plugins/view-transition.client.ts` 分三层协调：

1. `router.beforeEach` 标记本次导航是否需要抑制快照。来源为进行中的过渡，或本次目标等于最近一次落定导航的来源、且间隔不超过 `QUICK_REVERSAL_WINDOW_MS`（1000ms）。需要抑制时同时终结当前快照。
2. `router.afterEach` 只在导航成功、来源不是初始位置且路径实际变化时更新反向起点。被取消的导航不能成为反向来源。
3. `page:view-transition:start` 检查抑制标记。命中时直接 `skipTransition()`，不写入共享标记属性；未命中时才登记 `active`、写入 `data-neoverse-view-transitioning`，并在 `ready` 失败或 `finished` 后由同一过渡移除。

同一路径的重复导航单独处理：若存在进行中的快照，直接终结，避免继续绘制用户已经返回的页面。

## 可复用的验证方法

### 以动画数量判断是否截取

`document.getAnimations()` 中伪元素以 `::view-transition` 开头的动画只会在快照创建后出现。逐帧采样其峰值为 0，说明该次导航没有播放任何路由快照；峰值大于 0 说明旧页或新页至少有一侧在动画中。比检查 DOM 是否还有旧页更接近用户看到的画面。

### 基线截图必须等待稳定状态

第一轮视觉分类把首页基线截在入场动画中，首页基线与关于学社基线的距离关系被破坏，后续距离判断出现反向标签。首页基线必须等 `.xca-terminal-hero--intro` 数量为 0，关于学社基线必须等 `.about-card[aria-busy="false"]`。截图前还应把滚动位置归零。

### 逐帧画面与路径时间线对齐

CDP `Page.screencastFrame` 的 `metadata.timestamp` 以秒为单位，页面时间线记录 `performance.now()`。先记录 `pushState`、`popstate` 与每帧路径，再按时间片对齐截图，才能区分“路径已经切换但画面仍是旧页”与“路径尚未切换”。只看最终 URL 或最终 DOM 会漏掉闪烁。

### 分别验证窗口内外

- 窗口内：正向过渡结束后立即返回，断言路由快照峰值为 0，路径为 `/`，旧页 DOM 为 0。
- 窗口外：等待超过窗口后返回，断言仍存在交叉淡化动画，避免把“抑制全部路由过渡”误当成修复。
- 恢复：窗口过期后再次导航必须重新截取，证明抑制只作用于快速反向。

`tests/e2e/route-interruptions.spec.ts` 与 `tests/e2e/site-transitions.spec.ts` 采用上述结构。涉及窗口的恢复断言要先等窗口过期，否则测试会把正确的抑制当成缺少过渡。

## 取舍与边界

- 窗口内返回采用直接提交，不再播放旧页交叉淡化。这是有意取舍：与再次显示旧页相比，硬切避免错误内容出现在目的页。
- 窗口按“最近一次成功落定的客户端导航”计时，不按点击时间，也不覆盖初始文档加载。因此直接打开 `/about` 后点击首页仍走正常交叉淡化。
- 只抑制返回最近一次来源页的导航。前往其他路由、超过窗口的返回、减少动态效果与不支持 View Transitions 的环境保持原行为。
- 1000ms 是经验窗口，覆盖 420ms 共享空间时长与落定后的点击缓冲。调整该常量时，必须同步检查 `route-interruptions.spec.ts` 的恢复等待与 `site-transitions.spec.ts` 的导航选择等待。
- 本次未完成完整 E2E 套件，运行 40 分钟后超时中断；已通过 `bun run check`、`route-interruptions.spec.ts`、`site-transitions.spec.ts` 与 5 个相邻回归文件的验证。

## 事实依据

| 事项 | 依据 |
| --- | --- |
| 过渡入口与更新回调 | `node_modules/nuxt/dist/app/plugins/view-transitions.client.js` |
| 门户协调与窗口 | `app/plugins/view-transition.client.ts` |
| 共享时长与标记 | `node_modules/@neoverse-ui/motion/src/motion.css`、`src/index.ts` |
| 回归 | `tests/e2e/route-interruptions.spec.ts`、`tests/e2e/site-transitions.spec.ts` |
| 现行行为 | [站点框架](../../../docs/architecture/site-shell.md) |
