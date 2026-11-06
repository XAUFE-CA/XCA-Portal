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
