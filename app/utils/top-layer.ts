/**
 * Native top-layer surfaces (popovers, modal dialogs) paint above the snapshots of a document
 * View Transition. Backdrop sampling is unavailable there, so a glass surface loses its blur and
 * reads as transparent for the whole crossfade. Preference changes therefore commit without a
 * transition while one is open, which keeps the shared material intact.
 * 原生顶层表面（浮层、模态对话框）绘制在视图过渡快照之上。该层无法采样背景，玻璃表面会在整段
 * 交叉淡化中失去模糊而显得透明。因此有顶层表面打开时，偏好变更直接提交、不启动过渡，
 * 以保留玻璃材质。
 */
export function hasOpenTopLayerSurface(): boolean {
  if (typeof document === "undefined") return false;
  // Unsupported :popover-open makes the whole selector list invalid, so probe support first.
  // 不支持的 :popover-open 会使整条选择器列表失效，因此先探测支持情况。
  const popover =
    typeof CSS !== "undefined" && typeof CSS.supports === "function"
      ? CSS.supports("selector(:popover-open)")
      : false;
  return document.querySelector(popover ? ":popover-open, dialog[open]" : "dialog[open]") !== null;
}

// A surface that closes because of the current interaction leaves within a frame or two.
// 因当前交互而关闭的表面会在一两帧内离开。
const SETTLE_FRAMES = 3;

/**
 * Wait for the top layer to clear, then report whether it did. A menu row commits its preference
 * in the same tick as it closes its own panel, so that panel is still in the top layer at that
 * instant; a couple of frames later it is gone and a capture can sample the page again. A surface
 * that stays open resolves `false`, so callers keep their direct commit.
 * 等待顶层清空并报告结果。菜单行在关闭自身面板的同一时刻提交偏好，此时面板仍在顶层；一两帧后
 * 它已离开，截取又能采样页面。仍然打开的表面解析为 false，调用方因此保留直接提交。
 */
export function waitForTopLayerClose(): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = SETTLE_FRAMES;
    const step = () => {
      if (!hasOpenTopLayerSurface()) {
        resolve(true);
        return;
      }
      if (remaining-- <= 0) {
        resolve(false);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// A manual popover leaves the top layer as soon as hidePopover() runs, but the shared presence
// transition keeps its panel painted until the discrete display step finishes. Refreshing the
// edge canvas during that window draws an outline that outlives the panel itself.
// manual 浮层在 hidePopover() 执行时立即离开顶层，但共享 presence 过渡会让面板一直绘制到
// 离散 display 步骤结束。在这段窗口刷新边缘画布，会画出一段比面板本身残留更久的轮廓。
const EXIT_SETTLE_MS = 1000;

function hasDepartingPopover(): boolean {
  if (typeof document === "undefined" || typeof CSS === "undefined") return false;
  if (typeof CSS.supports !== "function" || !CSS.supports("selector(:popover-open)")) return false;
  return Array.from(document.querySelectorAll<HTMLElement>("[popover]")).some((panel) => {
    if (panel.matches(":popover-open")) return false;
    if (getComputedStyle(panel).display === "none") return false;
    return panel.getAnimations?.().some((animation) => animation.playState === "running") ?? false;
  });
}

/**
 * Wait until a closing top-layer panel finishes its exit transition. A CSS duration cannot be
 * expressed in frames, so the cap is wall-clock bounded; a caller with no departing panel
 * resolves immediately instead of spending a frame.
 * 等待关闭中的顶层面板完成退出过渡。CSS 时长无法用帧数表达，因此上限按墙钟计时；
 * 没有面板正在退出时立即返回，不额外占用一帧。
 */
export function waitForTopLayerDeparture(): Promise<void> {
  if (!hasDepartingPopover()) return Promise.resolve();
  const deadline = performance.now() + EXIT_SETTLE_MS;
  return new Promise((resolve) => {
    const step = () => {
      if (!hasDepartingPopover() || performance.now() >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
