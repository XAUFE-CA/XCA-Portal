# 语言切换页头玻璃闪白的修复记录（2026-11-04）

Status: historical

本文记录 2026-11-04 对“切换语言时左侧标识区域的玻璃背景闪白”的排查与修复。现行行为以 [站点框架](../../../docs/architecture/site-shell/README.md)、`app/composables/useSiteLocale.ts` 和 `app/assets/css/main.css` 为准；本文保留失败模式、取舍依据与验证结果。

## 结论

语言切换启动 View Transition 时，页头保留实时 `backdrop-filter`。Chrome 在截取进入快照期间重新采样这层玻璃背景，可能绘制一帧白色；文字位于独立绘制层，因此只有背景闪白，文字保持可见。浅色背景下白色与画布底色对比最强，深色模式不出现同样的观感。

修复只在快照捕获期间暂停页头背景采样：

- `useSiteLocale` 在切换开始时给根节点写入 `data-xca-locale-transitioning`，并轮询 `document.getAnimations()` 中伪元素以 `::view-transition` 开头的动画。进入快照绘制完成后立即移除属性，恢复实时玻璃，不等 420ms 的宽度动画结束。
- `main.css` 在属性存在时只关闭 `.site-header` 的 `-webkit-backdrop-filter` 与 `backdrop-filter`，保留材质半透明底面、边缘和内容布局。
- 连续切换用计数保留属性；每次切换的释放路径幂等，`startViewTransition` 的结束回调作为回退，避免属性残留。

## 失败模式

| 条件 | 浏览器行为 | 用户看到的画面 |
| --- | --- | --- |
| 实时玻璃 + 语言切换的进入快照 | Chrome 重新采样页头背景，绘制一帧白色 | 左侧标识区域的背景闪白，文字仍在 |
| 暂停整个过渡与宽度动画 | 页头失去背景模糊与饱和度，浅色下底面变白 | 切换期间持续可见的背景变白，约 470ms |

第二种是首版修复的副作用。用户报告浅色下可见，因此没有保留。

## 证据

在 Chrome 中按 1497 CSS px 宽、150% 缩放、浅色主题采样页面属性与计算样式。时间线以点击为起点：

| 时间 | `data-xca-locale-transitioning` | `data-neoverse-view-transitioning` | `.site-header` 的 `backdrop-filter` |
| --- | --- | --- | --- |
| `0–50ms` | 存在 | 存在 | `none` |
| `50–485ms` | 移除 | 存在 | `blur(18px) saturate(1.45) contrast(1) brightness(1)` |
| `485ms` 后 | 移除 | 移除 | 同上 |

暂停窗口由 `::view-transition` 伪元素动画出现的时间决定，没有固定计时常量。页头宽度动画在恢复采样后继续运行，过渡结束前的约 435ms 保持实时玻璃。重叠切换的计数与幂等释放分别验证过。

原始闪白无法在 CDP `Page.screencastFrame` 与 60fps 桌面录制中稳定复现，因此“是否仍闪白”以用户 Chrome 的实际观感为准；软件截取只能证明暂停窗口和恢复时间点。

## 尝试与取舍

- 命名页头快照可以冻结玻璃外观，但会把中英文标签一起截进旧、新快照，交叉淡化期间出现重叠文字（如“计算机学社”与“Computer Association”），没有采用。
- 暂停整个过渡与宽度动画能消除闪白，但浅色下的底面变白持续约 470ms，用户可见，没有采用。
- 暂停到宽度动画结束依赖页头内部动画的键帧形状，扩大了 `useSiteLocale` 与页头的耦合；改为只等待快照伪动画，减少暂停窗口和跨组件依赖。
- CSS 选择器使用 `:where(:root[data-xca-locale-transitioning]) .site-header`，特异性保持与 `.site-header` 相同，避免 Biome 的降序特异性告警；未分层规则仍优先于共享样式层中的材质 `backdrop-filter`。
- 若 Chrome 在宽度动画期间仍有闪白，本次暂停窗口不会覆盖；后续备选是语言切换不使用 View Transition，玻璃完全保持，代价是页面内容改为直接替换。该方案未实施。

## 验证

- `bun run typecheck`：通过。
- `bun test app scripts`：98 通过，0 失败。
- `bun run build`：通过。
- `bunx playwright test tests/e2e/site-transitions.spec.ts tests/e2e/locale.spec.ts`：12 通过。
- `bun run check:docs`、`bunx prettier --check docs/architecture/site-shell.md`、Biome 格式与 Lint：通过。
- `bun run check` 的 `check:budgets` 仍被工作区未提交改动触发的两条硬上限阻断（`useTerminalPresentation.ts:useTerminalPresentation#1` 与 `terminal-journey-camera.spec.ts:callback#1`），与本次修改无关；其余门禁通过。
- 未新增固定计时的单元测试：暂停窗口约 1–3 帧，依赖浏览器伪元素动画的出现时间；`site-transitions.spec.ts` 继续覆盖交叉淡化、页头实时与过渡标记清理。

## 文件

- `app/composables/useSiteLocale.ts`：切换期间的属性生命周期、快照伪动画轮询、重叠计数与幂等释放。
- `app/assets/css/main.css`：语言切换暂停页头背景采样的样式。
- `docs/architecture/site-shell.md`：同步暂停窗口与恢复时机。

## 事实依据

| 事项 | 依据 |
| --- | --- |
| 语言切换入口与快照回调 | `app/composables/useSiteLocale.ts` |
| 共享过渡标记与时长 | `@neoverse-ui/motion` 的 `startViewTransition` 与 `motion.css` |
| 页头材质与边缘 | `app/assets/css/main.css`、共享 `material-glass-elevated` |
| 现行过渡行为 | [站点框架](../../../docs/architecture/site-shell/README.md) |
| 回归 | `tests/e2e/site-transitions.spec.ts`、`tests/e2e/locale.spec.ts` |
