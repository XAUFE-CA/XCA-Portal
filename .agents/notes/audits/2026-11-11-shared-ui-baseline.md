# 共享库基线与 CI 浏览器回归状态

Status: open
Updated: 2026-11-14

## 2026-11-11 观测

`tests/e2e/context-menu.spec.ts` 的「theme and language open a submenu column inside the panel」在本地确定性失败，断言为二级菜单列与面板边缘的 `gap`/`align`。用 `git stash` 暂存全部本次改动后，以 HEAD 重新构建并单独运行该用例，结果同样失败；随后 `git stash pop` 完整恢复并重建当前代码。因此该失败与本次改动无关。

本地 `../Neoverse-UI` 位于 `e0d2005`，`packages/vue/src/UiContextMenu.vue` 与 `overlay-runtime` 等有未提交修改；当时 CI 联合检出固定在 `62efaaa2dc7228c0f6505fcd47bb2553b6b90e0c`。工程质量规则已记载：共享库工作区领先固定 SHA 时，菜单变体、视图过渡与终端外观等跨模块断言会确定性失败。

`home-entry.spec.ts` 的「three separate spaces smoothly skip the scene and retain the real terminal」在完整回归中偶发失败于「The skip fade must animate the scene」；单独重复三次均通过，属帧采样时序，CI 配置允许一次重试。

## 2026-11-14 复核

三个工作流的共享库固定提交已推进到 `e0d2005`，与本地共享库提交一致，工作区领先固定 SHA 的前提不再成立。测试按域拆分后，上述菜单用例位于 `tests/e2e/site/context-menu.spec.ts`；[上下文菜单实施计划](../plans/2026-11-08-context-menu-plan.md)记录了二级菜单重叠断言随 `e0d2005` 修正。

远端 Quality 工作流最近一次运行 `43409422986`（2026-11-13）的 `gates` 作业成功，八个浏览器分片中五个失败。失败断言为 `home-entry` 显式重播后 `.xca-terminal-hero--intro` 未卸载、`intro-fade` 的玻璃对比度，属入场时序与软件渲染，不再是菜单几何。三个工作流的命令入口路径问题已在本次治理修正，由 `check:references` 覆盖。

`main` 分支未启用分支保护，required checks 未配置。新增作业不会自动成为必需检查，需在仓库设置中手动加入并分别核验配置与运行结果。

## 2026-11-14 治理验证

本次治理同步修正了三个工作流的命令入口，新增 `check:references` 校验入口路径，并为阈值检查增加 NEAR 预警与孤立例外检测。本地 `bun run check:fast` 11 项通过，`bun run check`（含生产构建）12 项通过；按修复后的 `quality.yml` 命令运行 shard 1/8 浏览器回归，36 个用例全部通过。其余分片、`cinematic` 与 `images` 工作流未在本机执行。

本机 WorkBuddy 注入的 node-safe-delete 守卫会拦截 Nuxt 清理超过 50 个构建缓存文件，单次命令内设 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 才能完成生产构建，该设置不写入仓库。本地仍领先 `origin/main` 11 个提交，远端工作流结果须在推送后核验。

## 待办

远端浏览器回归恢复绿灯后，按工程质量规则核对锁文件、冻结安装、构建与回归结果；不要为本地通过而修改或放宽上述用例。启用分支保护并把 `gates`、浏览器分片及后续 Go 作业加入 required checks，分别核验配置与工作流结果。
