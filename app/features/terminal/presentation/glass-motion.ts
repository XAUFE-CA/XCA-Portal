import type { GlassRenderer } from "@neoverse-ui/glass-runtime";

export function refreshGlassDuring(
  animation: Animation,
  renderer: Pick<GlassRenderer, "refresh"> | undefined,
  element?: HTMLElement | null,
): void {
  if (!renderer) return;
  let frame = 0;
  let stopped = false;
  let lastBounds = "";
  const delay = Number(animation.effect?.getTiming().delay ?? 0);
  const pixelRatio = window.devicePixelRatio || 1;
  function paint() {
    if (stopped) return;
    if (
      Number(animation.currentTime ?? 0) >= delay &&
      (animation.playState === "running" || animation.pending)
    ) {
      let bounds = "";
      if (element) {
        const rect = element.getBoundingClientRect();
        bounds = [rect.left, rect.top, rect.right, rect.bottom]
          .map((value) => Math.round(value * pixelRatio))
          .join(",");
      }
      // Expansion changes only geometry; reuse the edge until it crosses a device pixel.
      // 展开仅改变几何位置。边界跨过设备像素前复用已绘制的玻璃边缘。
      if (!element || bounds !== lastBounds) {
        renderer?.refresh();
        lastBounds = bounds;
      }
    }
    frame = requestAnimationFrame(paint);
  }
  function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    renderer?.refresh();
  }
  frame = requestAnimationFrame(paint);
  void animation.finished.then(stop, stop);
}
