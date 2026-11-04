# 滚动来源页的路由快照闪烁修复记录（2026-11-04）

Status: historical

本文记录 2026-11-04 对“关于学社向下滚动后切回首页时闪一下”的排查与修复。现行行为以 [站点框架](../../../docs/architecture/site-shell.md) 和 `app/plugins/view-transition.client.ts`、`app/assets/css/main.css` 为准；本文保留失败模式、证据与验证方法。

## 结论

用户看到的是来源页截图在交叉淡化期间重新定位，以及淡出结束后恢复到完全不透明的两个独立缺陷：

1. `.site-main` 带有 `view-transition-name: root`，其盒模型高于视口并携带滚动偏移。浏览器默认把 `::view-transition-group(root)` 从来源盒模型动画到目标盒模型；滚动 600px 时分组位移约 583px，两张快照随分组一起滑动，旧页在接近终点时以“未滚动页顶”的位置淡出，表现为闪出横幅或页顶。
2. UA 的 `-ua-view-transition-fade-out` 使用 `animation-fill-mode: none`。动画结束后、快照树移除前的一帧，旧快照透明度回到 1，整页再闪一次；屏幕录制在过渡结束后采到两帧完整的关于学社画面。

## 修复

`app/plugins/view-transition.client.ts`：

- 在 `page:view-transition:start` 读取来源 `.site-main` 的视口盒模型，写入快照分组位置、宽高与初始偏移。
- `transition.ready` 后按目标 `.site-main` 的实时页顶计算偏移；滚动期间用 `requestAnimationFrame` 合并的监听跟随页头展开高度，快照不再落后于实时页面。
- 过渡结束后延迟两个合成帧再移除固定几何、截取属性与共享标记，避免快照树仍被绘制时几何突然失效；用递增序号防止旧过渡清理新过渡的属性。

`app/assets/css/main.css`：

- 分组固定到来源盒模型（`animation: none` 加位置、宽高变量），进入快照 `translateY` 回自身页顶。
- 旧快照设置 `animation-fill-mode: forwards`，把淡出终点的 0 保留到快照树移除，不改变淡出插值。

## 证据

以 CDP `Page.screencastFrame` 逐帧采样，滚动 600px 后点击首页：

| 状态 | 分组位移 | 旧快照高度 | 结束帧旧不透明度 |
| --- | --- | --- | --- |
| 修复前 | 约 `-512px → 88px` 动画 | `1380.97px` | `1` |
| 修复后 | 固定 `-512px` | `1380.97px` | `0` |

修复前中段帧出现关于学社横幅（滚动位置归零后的画面）；修复后中段帧保持滚动位置的正文，结束时不再出现整页旧画面。修复前逐帧亮度在过渡结束后出现约 12 点的单帧到双帧跳变，修复后消失。

## 验证

- `bunx --bun playwright test --config=.agents/notes/playwright-dev.config.ts tests/e2e/site-transitions.spec.ts tests/e2e/route-interruptions.spec.ts`：16 例通过（开发服务器，非生产预览；首次失败后完成实现与用例重构，最终重跑通过）。
- 新增 `site-transitions.spec.ts`“a scrolled source page keeps both route snapshots at their own viewport tops”：滚动 600px 后在 `transition.ready` 暂停，断言分组位于来源页顶、进入快照偏移到目标页顶，并把动画推进到终点断言旧快照不透明度为 0。
- 手工逐帧录制覆盖滚动 200px 与 600px 两种来源位置，另验证首页到关于学社的反向导航，未再出现横幅或结束帧闪烁。
- `bun run check:docs`、`bun run check:architecture` 通过。`bun run check:budgets` 中本次修改不再产生硬上限，剩余两条硬上限位于未提交的 `tests/e2e/terminal-journey-camera.spec.ts`；新增一个 80 行的软预算回调（暂停路由快照的浏览器侧编排）。
- `bun run test`：93 通过、2 失败；失败均在未提交的 `intro-mark.test.ts`，Bun 环境缺少 `DOMMatrixReadOnly`，不在本次改动范围。
- 类型检查未通过：`vue-tsc` 在未提交的 `useTerminalPresentation.ts` 报 `CaIntroMark.vue` 与 `TerminalHost.vue` 无法解析；文件实际存在，判断为开发服务器占用 `.nuxt` 导致的陈旧声明，本次未接管或重建该目录。
- 未执行生产构建和完整 E2E 套件；`nuxt build` 会与正在运行的开发服务器共用 `.nuxt`，按仓库既有约束未接管该服务。完整检查套件与其余浏览器回归仍需在干净环境补跑。

## 取舍与边界

- 只让旧快照保持终点透明，不把它的基础不透明度设为 0：后者会改变 UA 淡出的隐式起点，使旧页从第一帧起不可见，交叉淡化退化为空白淡入。
- 分组固定后交叉淡化不再呈现页面几何位移；这是有意取舍，滚动来源页的内容必须在整个过渡中停在原视口位置。
- 偏移跟随目标页实时页顶，导航到带恢复滚动位置的历史记录时仍使用 `getBoundingClientRect()`，不假设目标一定在页顶。
- 未启用减少动态效果或浏览器不支持 View Transitions 时仍直接更新内容，新逻辑不介入。
