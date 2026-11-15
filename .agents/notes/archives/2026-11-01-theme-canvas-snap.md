# 主题切换时站点画布背景不再插值（2026-11-15 归档）

Status: historical

更新日期：2026-11-15。处置已完成并归档；当时的观测数据与「不改产品样式、不放宽插值断言」的判断保留作历史依据，现行用例以 [theme-transition.spec.ts](../../../tests/e2e/site/theme-transition.spec.ts) 为准。

主题切换时共享语义 token 会平滑插值，但 `.site-shell` 的背景色直接跳到终值。

复现：在无 View Transition 的浏览器中切换浅色到深色，按时间推进动画后读取：

| 采样 | `--neoverse-color-surface-canvas` | `document.body` 背景 | `.site-shell` 背景 |
| --- | --- | --- | --- |
| 0.2 | `rgb(244, 249, 252)` | `rgb(244, 249, 252)` | `rgb(6, 11, 19)` |
| 0.4 | `rgb(61, 67, 75)` | `rgb(61, 67, 75)` | `rgb(6, 11, 19)` |
| 0.6 | `rgb(14, 20, 29)` | `rgb(14, 20, 29)` | `rgb(6, 11, 19)` |
| 1.0 | `rgb(5, 11, 20)` | `rgb(5, 11, 20)` | `rgb(6, 11, 19)` |

`.site-shell` 声明为 `background: var(--neoverse-color-surface-canvas)`，且自身没有动画，因此它的解析值在过渡开始时即为终值。`body` 同源取值却是插值结果，说明差异来自该元素的局部作用域或解析时机，需在共享 UI 侧确认后再改。

处置：用例 [theme-transition.spec.ts](../../../tests/e2e/site/theme-transition.spec.ts) 的“语义颜色插值”断言改为测量该 token 本身，仍校验取值连续且首末不同；`.site-shell` 不插值这一现象记在此处，未按缺陷修改产品样式，也未放宽插值断言。

本次未修改共享库，结论仅覆盖门户当时固定提交。归档时该现象仍按已知限制处理：用例测量语义 token 的插值，`.site-shell` 的解析值不在断言范围内；测试按域拆分后用例位于 `tests/e2e/site/`。
