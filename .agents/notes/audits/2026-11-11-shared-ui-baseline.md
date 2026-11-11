# 本地共享库工作区与 CI 固定 SHA 不一致

Status: open
Updated: 2026-11-11

## 事实

`tests/e2e/context-menu.spec.ts` 的「theme and language open a submenu column inside the panel」在本地确定性失败，断言为二级菜单列与面板边缘的 `gap`/`align`。用 `git stash` 暂存全部本次改动后，以 HEAD 重新构建并单独运行该用例，结果同样失败；随后 `git stash pop` 完整恢复并重建当前代码。因此该失败与本次改动无关。

本地 `../Neoverse-UI` 位于 `e0d2005`，`packages/vue/src/UiContextMenu.vue` 与 `overlay-runtime` 等有未提交修改；CI 联合检出固定在 `62efaaa2dc7228c0f6505fcd47bb2553b6b90e0c`。工程质量规则已记载：共享库工作区领先固定 SHA 时，菜单变体、视图过渡与终端外观等跨模块断言会确定性失败。

`home-entry.spec.ts` 的「three separate spaces smoothly skip the scene and retain the real terminal」在完整回归中偶发失败于「The skip fade must animate the scene」；单独重复三次均通过，属帧采样时序，CI 配置允许一次重试。

## 待办

更新固定 SHA 前按工程质量规则核对锁文件、冻结安装、构建与浏览器回归；不要为本地通过而修改或放宽上述用例。远端 CI 与 required checks 结果须另行核验。
