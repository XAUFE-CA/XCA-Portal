# 语言切换的宽度动效下沉到共享库（2026-11-06）

Status: historical

本文记录把页头「语言/主题切换时整组占宽区域平滑扩张与缩小」的实现从门户移入 Neoverse-UI，并改为复用共享能力的过程。现行行为以 [站点框架](../../../docs/architecture/site-shell/README.md) 与共享库文档为准。

## 结论

门户此前在 [SiteHeader.vue](../../../app/components/site/SiteHeader.vue) 内自带一套测量与动画状态：两段 watch 分别采样与播放，自建 `Map<HTMLElement, Animation>`、`cancelResizing()`，并在 `resize`、`prefers-reduced-motion` 变化与卸载时自行终止。该实现与「关于学社」卡片高度过渡重复了同一套 token 解析与打断续接规则，且只能被门户使用。

现在拆成两层：

| 位置 | 职责 |
| --- | --- |
| `@neoverse-ui/motion` | `captureLayoutWidths` 采样可见宽度；`animateLayoutWidths` 先解析全部自然终点，再按 `spatial` 角色同时播放，结束时释放 `fill` 恢复自动宽度 |
| `@neoverse-ui/vue` | `useLayoutWidthMotion({ root, targets, trigger })` 负责 pre 阶段采样并取消上一轮、post 阶段播放，以及 `resize`、减少动效变化与卸载时终止 |
| `SiteHeader.vue` | 只声明容器、目标选择器与触发值（语言、主题） |

## 关键约束（不得回退）

- **先采样再取消**：采样必须读取正在运行的动画值，否则被打断的切换会弹回端点。取消必须发生在 DOM 更新之前，否则 post 阶段读到的是旧动画 `fill` 钉住的值，而非自然终点。
- **终点全部解析后才启动动画**：动画一开始就会改变网格，逐个解析会让后面的盒子读到被前面改动过的宽度。
- **不缩放文字、不交叉淡化**：语言切换就地替换文案，只让盒子跟随尺寸。
- **首次渲染与水合不补播**：只有触发值变化才播放。
- **降级**：减少动效、缺失时长 token、无 Web Animations API 时直接使用自然宽度。

## 验证

隔离副本（`node_modules` 目录联接，不占用使用者的 4100 开发服务器）中生产构建后运行：

- `site-transitions.spec.ts`：10 通过（含「language changes move the whole navigation shell without overshooting or rebounding」与玻璃采样暂停回归）。
- `mobile-header.spec.ts`、`locale.spec.ts`、`preferences-refresh.spec.ts`：20 通过（含「rapid language reversals continue from the visible width and resize restores auto sizing」与减少动效下的偏好外壳伸缩）。
- 库内：motion 19 项、vue 90 项单元测试通过；`typecheck:only`、`check:contracts`、`check:changesets`、`lint:text`、`biome check` 通过。
- 门户：`check:fast` 9 项门禁通过（阈值、文档、架构、终端边界、typecheck、tsc quality、单元测试）。

未验证：Safari/Firefox 的实际打断续接表现（仅在 Chromium 无头下回归）。

## 文件

- `packages/motion/src/layout-width.ts`、`layout-width.test.ts`：采样与动画原语。
- `packages/motion/src/motion-tokens.ts`：token 常量从入口拆出，避免原语与入口循环引用；公开导出不变。
- `packages/vue/src/layout-width-motion.ts`、`layout-width-motion.test.ts`：Vue 适配。
- `.changeset/layout-width-motion.md`：两个包的 minor。
- 门户 `app/components/site/SiteHeader.vue`、`docs/architecture/site-shell.md`。

## 后续：Design Lab 接入（同日）

共享库内新增 `foundation-motion-width` 示例：Motion 模块以实验室语言控件为触发值，用 `useLayoutWidthMotion` 让标识、导航与偏好三个盒子同时伸缩，并登记进 specimen 目录（深链、材质检查覆盖）。新增 Playwright 用例验证一次切换产生 3 条同 `spatial` 时长的宽度动画、起点为采样宽度、终点为自然宽度。

注意点：Biome 在有 react 依赖的 playground 目录会把 Vue composable 误判为 React hook，需行内 `biome-ignore`；示例文案必须让每个盒子在中英文下都有明显宽度差，否则该盒不会进入动画（首次实测只有 2/3 触发）。验证记录见 Neoverse-UI 仓库 `.workbuddy/memory/2026-11-06.md`。

## 追加：扩张方向的折行缺陷与标题栏接入

用户指出两处遗漏后补齐：

- **共享原语缺陷**：zh→en（扩张）时，`width` 动画从旧窄值起步，新长文案在窄盒内折行，盒子高度 53.6→73.8px，整块示例区高度跳变。修复：`animateLayoutWidths` 在解析完全部终点后、启动动画前，对扩张盒子临时内联 `white-space: nowrap` + `overflow: clip`，结束或取消时恢复原内联样式；收缩方向不受影响。收缩方向此前已验证，扩张方向新增 1440/390 两个视口的浏览器断言。
- **示例区窄屏换行**：`flex-wrap` 在 390px 下会从 2 行切到 3 行，改为 `flex-col md:flex-row`。
- **标题栏接入**：playground 的 `App.vue` 以工具栏 actions 为 root、语言为 trigger，复用 `useLayoutWidthMotion`，覆盖主题/语言分段控件、紧凑图标按钮与返回总览控件（隐藏控件由原语跳过，固定尺寸控件由容差跳过）。
- **测量前提**：字体未就绪时测得的自然宽度会偏大约 6px，动画结束回弹；浏览器测试统一等待 `document.fonts.ready`，motion README 已注明该前提。

门户侧复核：`ui:sync` 后在隔离副本 4103 端口重跑 `site-transitions`、`locale`、`mobile-header`、`preferences-refresh` 共 30 项全部通过（含「整组导航无越界回弹」「急速反向切换从可见宽度接续」）。`check:fast` 的 `format:check` 失败来自并行改动 `tests/e2e/footer-preview.spec.ts`，与本次无关。
