import { nextTick, type Ref, ref } from "vue";
import { expressiveDuration, TERMINAL_EXPAND_UNITS } from "./timing";

interface ExpansionState {
  expanded: Ref<boolean>;
  shadeActive: Ref<boolean>;
  animation: Animation | null;
  shadeAnimation: Animation | null;
  shadeGeometryAnimation: Animation | null;
  version: number;
}

interface ExpansionHost {
  getFrame: () => HTMLElement | null;
  getShade: () => HTMLElement | null;
  isReady: () => boolean;
  reducedMotion: () => boolean;
  refreshGlassDuring: (animation: Animation) => void;
}

function cancelExpansion(state: ExpansionState): number {
  state.animation?.cancel();
  state.shadeAnimation?.cancel();
  state.shadeGeometryAnimation?.cancel();
  state.animation = null;
  state.shadeAnimation = null;
  state.shadeGeometryAnimation = null;
  return ++state.version;
}

function setShade(state: ExpansionState, element: HTMLElement | null, visible: boolean): void {
  if (element) element.style.opacity = visible ? "1" : "0";
  state.shadeActive.value = visible;
}

function resetExpansion(state: ExpansionState, host: ExpansionHost): void {
  cancelExpansion(state);
  state.expanded.value = false;
  setShade(state, host.getShade(), false);
}

function settleExpansionAfterResize(state: ExpansionState, host: ExpansionHost): void {
  if (!state.animation) return;
  cancelExpansion(state);
  setShade(state, host.getShade(), state.expanded.value);
}

function settleExpansionAfterMotionPreference(
  state: ExpansionState,
  host: ExpansionHost,
  reducedMotion: () => boolean,
): void {
  if (!reducedMotion()) return;
  cancelExpansion(state);
  setShade(state, host.getShade(), state.expanded.value);
}

function transformBetween(from: DOMRect, to: DOMRect): string {
  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  const dy = from.y + from.height / 2 - (to.y + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

async function toggleTerminalExpansion(state: ExpansionState, host: ExpansionHost): Promise<void> {
  if (!host.isReady()) return;
  const element = host.getFrame();
  if (!element) return;
  const before = element.getBoundingClientRect();
  const shade = host.getShade();
  const shadeOpacity = shade ? Number.parseFloat(getComputedStyle(shade).opacity) : 0;
  if (shade) shade.style.opacity = String(shadeOpacity);
  const version = cancelExpansion(state);
  const expanding = !state.expanded.value;
  state.expanded.value = expanding;
  if (expanding) state.shadeActive.value = true;
  await nextTick();
  if (version !== state.version || !element.isConnected) return;
  if (host.reducedMotion() || typeof element.animate !== "function") {
    setShade(state, shade, expanding);
    return;
  }
  const after = element.getBoundingClientRect();
  if (!after.width || !after.height) {
    setShade(state, shade, expanding);
    return;
  }
  const easing =
    getComputedStyle(element).getPropertyValue("--neoverse-motion-easing-emphasized").trim() ||
    "ease";
  const timing = {
    duration: expressiveDuration(element) * TERMINAL_EXPAND_UNITS,
    easing,
    fill: "both" as const,
  };
  // Finish geometry reads before starting effects to avoid another style flush.
  // 启动动画前完成几何读取，避免再次刷新样式。
  const shadeBounds = shade?.getBoundingClientRect();
  const animation = element.animate(
    [{ transform: transformBetween(before, after) }, { transform: "none" }],
    timing,
  );
  state.animation = animation;
  const shadeAnimation = shade?.animate(
    [{ opacity: String(shadeOpacity) }, { opacity: expanding ? "1" : "0" }],
    { ...timing, easing: "linear" },
  );
  // Keep the opening on the moving terminal instead of reserving its final rectangle.
  // 开口跟随运动中的终端，不提前预留最终位置的矩形区域。
  const shadeGeometryAnimation =
    shade && shadeBounds
      ? shade.animate(
          [
            { transform: transformBetween(before, shadeBounds) },
            { transform: transformBetween(after, shadeBounds) },
          ],
          timing,
        )
      : null;
  // Fade evenly over the same clock; spatial easing would darken most of the page too early.
  // 在同一时钟上匀速淡入淡出，避免空间动画的缓动让页面过早变暗。
  animation.startTime = document.timeline.currentTime;
  if (shadeAnimation) shadeAnimation.startTime = animation.startTime;
  if (shadeGeometryAnimation) shadeGeometryAnimation.startTime = animation.startTime;
  state.shadeAnimation = shadeAnimation ?? null;
  state.shadeGeometryAnimation = shadeGeometryAnimation;
  host.refreshGlassDuring(animation);
  try {
    await Promise.all([
      animation.finished,
      shadeAnimation?.finished,
      shadeGeometryAnimation?.finished,
    ]);
  } catch {
    /* Interrupted by another toggle or route.
       被另一次切换或路由中断。 */
  }
  if (state.animation !== animation) return;
  setShade(state, shade, expanding);
  shadeAnimation?.cancel();
  shadeGeometryAnimation?.cancel();
  state.shadeAnimation = null;
  state.shadeGeometryAnimation = null;
  animation.cancel();
  state.animation = null;
}

export function useTerminalExpansion(host: ExpansionHost) {
  const state: ExpansionState = {
    expanded: ref(false),
    shadeActive: ref(false),
    animation: null,
    shadeAnimation: null,
    shadeGeometryAnimation: null,
    version: 0,
  };
  return {
    expanded: state.expanded,
    shadeActive: state.shadeActive,
    cancel: () => cancelExpansion(state),
    reset: () => resetExpansion(state, host),
    onMotionPreferenceChange: () =>
      settleExpansionAfterMotionPreference(state, host, host.reducedMotion),
    onViewportChange: () => settleExpansionAfterResize(state, host),
    toggle: () => toggleTerminalExpansion(state, host),
  };
}
