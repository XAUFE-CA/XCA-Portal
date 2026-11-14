import { type Ref, ref } from "vue";
import type {
  BootLine,
  TerminalPresentationStage,
} from "~/features/terminal/components/presentation-contract";
import type TerminalHost from "~/features/terminal/components/TerminalHost.vue";
import { useTerminalExpansion } from "~/features/terminal/presentation/useTerminalExpansion";
import { refreshGlassDuring as trackGlassMotion } from "~/utils/glass-motion";
import type CaIntroMark from "../components/CaIntroMark.vue";
import { createIntroShortcut } from "../core/intro-entry";
import { createIntroJourney } from "../core/intro-journey";
import { createIntroPlayback } from "../core/intro-playback";

export const IDENTITY_TRANSFORM = "translateZ(0)";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function viewportDimensions() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}
export function frame(anchor: Ref<HTMLElement | null>): HTMLElement | null {
  return anchor.value?.querySelector<HTMLElement>(".xca-terminal-window") ?? null;
}
export function shade(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".xca-terminal-focus-shade");
}
export function releaseIntroGate(): void {
  delete document.documentElement.dataset.xcaIntro;
}

export function waitForVisible(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function cleanup() {
      document.removeEventListener("visibilitychange", check);
      signal.removeEventListener("abort", stop);
    }
    function check() {
      if (document.hidden) return;
      cleanup();
      resolve();
    }
    function stop() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }
    document.addEventListener("visibilitychange", check);
    signal.addEventListener("abort", stop, { once: true });
  });
}

export async function waitForPaint(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  await promise;
  signal.throwIfAborted();
}

// The context owns every mutable intro state; sequence functions stay module-level.
// 上下文持有全部可变入场状态，序列函数保持在模块级。
export function createIntroContext(getCommandCount: () => number) {
  const { $glassRenderer } = useNuxtApp();
  const phase = ref<TerminalPresentationStage>("ready");
  const bootLines = ref<BootLine[]>([]);
  const bootProgress = ref(0);
  const bannerRowsVisible = ref(0);
  const bannerCaptionLines = ref(0);
  const revealing = ref(false);
  const spatialIntro = ref(false);
  const anchor = ref<HTMLElement | null>(null);
  const terminalRef = ref<InstanceType<typeof TerminalHost> | null>(null);
  const markRef = ref<InstanceType<typeof CaIntroMark> | null>(null);
  const motionPreference = ref<MediaQueryList | null>(null);
  const state = {
    settling: false,
    retreatPromise: null as Promise<unknown> | null,
    introAbort: null as AbortController | null,
    introShortcut: createIntroShortcut(() => undefined),
    viewportSize: { width: 0, height: 0 },
  };
  const playback = createIntroPlayback(
    (animation) => trackGlassMotion(animation, $glassRenderer),
    () => frame(anchor),
  );
  const expansion = useTerminalExpansion({
    getFrame: () => frame(anchor),
    getShade: shade,
    isReady: () => phase.value === "ready",
    reducedMotion,
    refreshGlassDuring: (animation) => trackGlassMotion(animation, $glassRenderer, frame(anchor)),
  });
  const journey = createIntroJourney(playback.animate);
  return {
    phase,
    bootLines,
    bootProgress,
    bannerRowsVisible,
    bannerCaptionLines,
    revealing,
    spatialIntro,
    anchor,
    terminalRef,
    markRef,
    motionPreference,
    state,
    glassRenderer: $glassRenderer,
    playback,
    animateIntro: playback.animate,
    expansion,
    journey,
    getCommandCount,
  };
}
export type IntroContext = ReturnType<typeof createIntroContext>;
