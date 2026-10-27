import { nextTick, type Ref, ref } from "vue";
import { expressiveDuration, TERMINAL_EXPAND_UNITS } from "./timing";

interface ExpansionState {
  expanded: Ref<boolean>;
  shadeActive: Ref<boolean>;
  animation: Animation | null;
  shadeAnimation: Animation | null;
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
  state.animation = null;
  state.shadeAnimation = null;
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
  const dx = before.x + before.width / 2 - (after.x + after.width / 2);
  const dy = before.y + before.height / 2 - (after.y + after.height / 2);
  const sx = before.width / after.width;
  const sy = before.height / after.height;
  const easing =
    getComputedStyle(element).getPropertyValue("--neoverse-motion-easing-emphasized").trim() ||
    "ease";
  const timing = {
    duration: expressiveDuration(element) * TERMINAL_EXPAND_UNITS,
    easing,
    fill: "both" as const,
  };
  const animation = element.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
    timing,
  );
  state.animation = animation;
  const shadeAnimation = shade?.animate(
    [{ opacity: String(shadeOpacity) }, { opacity: expanding ? "1" : "0" }],
    timing,
  );
  state.shadeAnimation = shadeAnimation ?? null;
  host.refreshGlassDuring(animation);
  try {
    await Promise.all([animation.finished, shadeAnimation?.finished]);
  } catch {
    /* Interrupted by another toggle or route.
       被另一次切换或路由中断。 */
  }
  if (state.animation !== animation) return;
  setShade(state, shade, expanding);
  shadeAnimation?.cancel();
  state.shadeAnimation = null;
  animation.cancel();
  state.animation = null;
}

export function useTerminalExpansion(host: ExpansionHost) {
  const state: ExpansionState = {
    expanded: ref(false),
    shadeActive: ref(false),
    animation: null,
    shadeAnimation: null,
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
