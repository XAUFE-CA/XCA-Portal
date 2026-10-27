import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type CaIntroMark from "~/components/home/CaIntroMark.vue";
import { tokenLength } from "~/utils/cssTokens";
import type TerminalHost from "../components/TerminalHost.vue";
import { BOOT_SEQUENCE, type BootLine } from "./boot-script";
import { createIntroJourney, terminalDockFrames } from "./intro-journey";
import { playIntroMark } from "./intro-mark";
import { expressiveDuration, INTRO_PACING, INTRO_READING_UNIT_MS } from "./timing";
import { useTerminalExpansion } from "./useTerminalExpansion";

// Document-local: client routing keeps the session, a new load replays entry; never use it in SSR.
// 仅限文档内：客户端路由保留会话，新加载重播入场；绝不在 SSR 中读写。
let introPlayedInDocument = false;
const IDENTITY_TRANSFORM = "translateZ(0)";
function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function viewportDimensions() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function waitForVisible(signal: AbortSignal): Promise<void> {
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
export function useTerminalPresentation(getCommandCount: () => number) {
  const { $glassRenderer } = useNuxtApp();
  type IntroPhase = "ready" | "logo" | "handoff" | "boot" | "brand" | "dock" | "reveal";
  const phase = ref<IntroPhase>("ready");
  const bootLines = ref<BootLine[]>([]);
  const bootProgress = ref(0);
  const bannerRowsVisible = ref(0);
  const bannerCaptionVisible = ref(false);
  const anchor = ref<HTMLElement | null>(null);
  const terminalRef = ref<InstanceType<typeof TerminalHost> | null>(null);
  const markRef = ref<InstanceType<typeof CaIntroMark> | null>(null);
  const introAnimations = new Set<Animation>();
  const revealing = ref(false);
  const spatialIntro = ref(false);
  let retreatPromise: Promise<unknown> | null = null;
  let introAbort: AbortController | null = null;
  let viewportSize = { width: 0, height: 0 };
  function refreshGlassDuring(animation: Animation) {
    let frame = 0;
    let stopped = false;
    const delay = Number(animation.effect?.getTiming().delay ?? 0);
    // WAAPI transforms emit no motion events; invalidate the shared renderer during choreography.
    // WAAPI 变换不会触发 CSS 运动事件；空间编排移动表面时需刷新共享渲染器。
    function paint() {
      if (stopped) return;
      if (
        Number(animation.currentTime ?? 0) >= delay &&
        (animation.playState === "running" || animation.pending)
      )
        $glassRenderer?.refresh();
      frame = requestAnimationFrame(paint);
    }
    function stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      $glassRenderer?.refresh();
    }
    frame = requestAnimationFrame(paint);
    void animation.finished.then(stop, stop);
  }

  function frame(): HTMLElement | null {
    return anchor.value?.querySelector<HTMLElement>(".xca-terminal-window") ?? null;
  }
  function shade(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".xca-terminal-focus-shade");
  }
  const expansion = useTerminalExpansion({
    getFrame: frame,
    getShade: shade,
    isReady: () => phase.value === "ready",
    reducedMotion,
    refreshGlassDuring,
  });
  function releaseIntroGate(): void {
    delete document.documentElement.dataset.xcaIntro;
  }
  function finishIntro() {
    const wasPlaying = phase.value !== "ready";
    introAbort?.abort();
    introAbort = null;
    for (const animation of introAnimations) animation.cancel();
    introAnimations.clear();
    retreatPromise = null;
    revealing.value = false;
    spatialIntro.value = false;
    const element = frame();
    // Keep the terminal's compositor layer after docking; dropping it snaps the Aurora Glass edge.
    // 停靠后保留终端所在的合成层；移除变换会使极光玻璃边缘在重栅格化时跳动。
    if (element) element.style.transform = IDENTITY_TRANSFORM;
    phase.value = "ready";
    bootLines.value = [];
    bootProgress.value = 0;
    bannerRowsVisible.value = 0;
    bannerCaptionVisible.value = false;
    expansion.reset();
    releaseIntroGate();
    if (wasPlaying)
      void nextTick(() => {
        if (phase.value === "ready" && window.matchMedia("(pointer: fine)").matches)
          terminalRef.value?.focusInput();
      });
  }
  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    const element = frame();
    // Cues use the same pausable timeline as the drawing and docking.
    // 提示使用与绘制和停靠相同的可暂停时间线。
    if (element && typeof element.animate === "function")
      return animateIntro(element, [], { duration: ms }, signal);
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      function stop() {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }
      signal.addEventListener("abort", stop, { once: true });
    });
  }
  async function animateIntro(
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const animation = element.animate(keyframes, options);
    introAnimations.add(animation);
    if (element === frame() && keyframes.some((keyframe) => keyframe.transform))
      refreshGlassDuring(animation);
    if (document.hidden) animation.pause();
    const stop = () => animation.cancel();
    signal.addEventListener("abort", stop, { once: true });
    try {
      await animation.finished;
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", stop);
      // Retain filled effects until handoff/finish; removing them would flash the outline.
      // 填充效果保留至交接/结束；提前移除会闪现轮廓。
      if (options.fill !== "both" && options.fill !== "forwards") {
        introAnimations.delete(animation);
        animation.cancel();
      }
    }
  }
  const journey = createIntroJourney(animateIntro);
  function onVisibilityChange() {
    const animations = [...introAnimations];
    for (const animation of animations) {
      if (document.hidden && animation.playState === "running") animation.pause();
      else if (!document.hidden && animation.playState === "paused") animation.play();
    }
  }
  async function playMark(element: HTMLElement, unit: number, signal: AbortSignal) {
    const root = (markRef.value?.$el as HTMLElement | undefined) ?? null;
    if (!root) return;
    await playIntroMark({
      root,
      terminal: element,
      unit,
      signal,
      animate: animateIntro,
      onHandoff: async (arrival) => {
        await waitForVisible(signal);
        signal.throwIfAborted();
        phase.value = "handoff";
        await nextTick();
        signal.throwIfAborted();
        await playBoot(unit, signal, true, arrival);
        await playBrand(unit, signal);
      },
    });
  }
  function initialTransform(element: HTMLElement): string {
    // The final anchor never leaves normal flow, preventing layout shifts while docking.
    // 最终锚点始终留在常规流中，避免停靠期间产生布局偏移。
    const rect = anchor.value?.getBoundingClientRect() ?? element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const centerX = (viewport?.width ?? window.innerWidth) / 2;
    const centerY = (viewport?.height ?? window.innerHeight) / 2;
    const gutter = tokenLength(element, "--neoverse-layout-gutter-inline");
    const scale = Math.min(
      1,
      ((viewport?.width ?? window.innerWidth) - 2 * gutter) / rect.width,
      ((viewport?.height ?? window.innerHeight) - 2 * gutter) / rect.height,
    );
    const dx = centerX - (rect.x + rect.width / 2);
    const dy = centerY - (rect.y + rect.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  function trackMotion(task: Promise<unknown>, signal: AbortSignal): Promise<void> {
    return task.then(
      () => undefined,
      (error: unknown) => {
        if (signal.aborted || introAbort?.signal !== signal) return;
        console.error("Terminal intro motion failed", error);
        finishIntro();
      },
    );
  }
  function beginRetreat(element: HTMLElement, unit: number, signal: AbortSignal) {
    if (retreatPromise) return;
    revealing.value = true;
    const root = markRef.value?.$el as HTMLElement | undefined;
    retreatPromise = trackMotion(
      Promise.all([
        root ? journey.retreat(root, unit, signal) : Promise.resolve(),
        dockTerminal(element, unit, signal),
      ]),
      signal,
    );
  }
  async function playBoot(
    unit: number,
    signal: AbortSignal,
    spatial: boolean,
    arrival: Promise<unknown> = Promise.resolve(),
  ) {
    phase.value = "boot";
    await nextTick();
    // Emitted lines drive scene cues; the progress bar only measures elapsed reading time.
    // 实际输出的文本行驱动场景提示；进度条仅衡量已用的阅读时间。
    await Promise.all([
      (async () => {
        for (const step of BOOT_SEQUENCE) {
          await sleep(unit * step.delayUnits, signal);
          signal.throwIfAborted();
          const line = step.line(getCommandCount());
          if (spatial && line.message.key === "boot.content") await arrival;
          if (line.message.key === "boot.ready") await retreatPromise;
          signal.throwIfAborted();
          bootLines.value = [...bootLines.value, line];
          const root = markRef.value?.$el as HTMLElement | undefined;
          if (spatial && root && line.message.key === "boot.start") {
            const remaining = BOOT_SEQUENCE.slice(1).reduce(
              (total, cue) => total + cue.delayUnits,
              0,
            );
            void trackMotion(journey.cruise(root, unit * remaining, signal), signal);
          }
          if (line.message.key !== "boot.content") continue;
          const element = frame();
          if (spatial && element) {
            beginRetreat(element, unit, signal);
          } else revealing.value = true;
        }
      })(),
      (async () => {
        const ticks = 32;
        const duration = unit * BOOT_SEQUENCE.reduce((total, step) => total + step.delayUnits, 0);
        for (let tick = 1; tick <= ticks; tick++) {
          await sleep(duration / ticks, signal);
          signal.throwIfAborted();
          bootProgress.value = Math.round((tick / ticks) * 100);
        }
      })(),
    ]);
    await sleep(unit * INTRO_PACING.bootComplete, signal);
    signal.throwIfAborted();
    spatialIntro.value = false;
  }
  async function playBrand(unit: number, signal: AbortSignal) {
    phase.value = "brand";
    await nextTick();
    await sleep(unit * INTRO_PACING.brandCrossfade, signal);
    // Use the same responsive banner resource as the real terminal renderer.
    // 使用与真实终端渲染器相同的响应式横幅资源。
    const rows = terminalRef.value?.getBannerRowCount() ?? 7;
    for (let row = 1; row <= rows; row++) {
      await sleep(unit * INTRO_PACING.bannerRow, signal);
      signal.throwIfAborted();
      bannerRowsVisible.value = row;
    }
    await sleep(unit * INTRO_PACING.bannerCaption, signal);
    bannerCaptionVisible.value = true;
    await sleep(unit * INTRO_PACING.brandHold, signal);
    signal.throwIfAborted();
  }
  async function dockTerminal(element: HTMLElement, unit: number, signal: AbortSignal) {
    const from = new DOMMatrixReadOnly(getComputedStyle(element).transform).toFloat64Array();
    await animateIntro(
      element,
      terminalDockFrames(from),
      {
        duration: unit * INTRO_PACING.arrival,
        easing: "linear",
        fill: "forwards",
      },
      signal,
    );
    signal.throwIfAborted();
    element.style.transform = IDENTITY_TRANSFORM;
  }
  function prepareIntro(element: HTMLElement, reduce: boolean): number {
    const unit = reduce ? INTRO_READING_UNIT_MS : expressiveDuration(element);
    phase.value = reduce ? "boot" : "logo";
    spatialIntro.value = !reduce;
    revealing.value = false;
    bootLines.value = [];
    bootProgress.value = 0;
    bannerRowsVisible.value = 0;
    bannerCaptionVisible.value = false;
    return unit;
  }
  async function startIntro(options: { explicit?: boolean } = {}): Promise<void> {
    if (!import.meta.client || !anchor.value) return;
    if (introAbort) finishIntro();
    expansion.reset();
    // A reload can restore scroll first; dock against the top anchor so the header never shifts.
    // 重载可能在入场前恢复滚动位置；以页面顶部锚点停靠，避免页头与主视觉位移。
    if (!options.explicit) window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    const reduce = reducedMotion() || typeof frame()?.animate !== "function";
    if (reduce && !options.explicit) {
      finishIntro();
      return;
    }
    const element = frame();
    if (!element) {
      releaseIntroGate();
      return;
    }
    const controller = new AbortController();
    introAbort = controller;
    const signal = controller.signal;
    // Reduced motion drops spatial effects, but explicit replay still needs readable boot text.
    // 减少动效会移除空间效果，但显式重播仍需可读的开机文本，而非共用的 1ms 动效令牌。
    const unit = prepareIntro(element, reduce);
    viewportSize = viewportDimensions();
    await nextTick();
    if (signal.aborted) return;
    element.style.transform = reduce ? "none" : initialTransform(element);
    document.documentElement.dataset.xcaIntro = "running";

    try {
      await waitForVisible(signal);
      // Give the empty SVG contours a painted frame, including warm-cache loads.
      // 为空的 SVG 轮廓留出一帧绘制时间，包括热缓存加载。
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      signal.throwIfAborted();
      if (!reduce) await playMark(element, unit, signal);
      else {
        await playBoot(unit, signal, false);
        await playBrand(unit, signal);
        phase.value = "reveal";
        await sleep(unit * INTRO_PACING.revealSettle, signal);
      }
      signal.throwIfAborted();
      finishIntro();
    } catch {
      if (!signal.aborted && introAbort === controller) finishIntro();
    }
  }
  function onViewportChange() {
    expansion.onViewportChange();
    const size = viewportDimensions();
    if (size.width === viewportSize.width && size.height === viewportSize.height) return;
    viewportSize = size;
    // A changed projection cannot reuse its old DOM handoff; settle once instead of jumping.
    // 投影改变后无法沿用旧的 DOM 交接；直接一次性收束，避免几何跳变或重播输出。
    if (phase.value !== "ready") finishIntro();
  }
  function onGlobalKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (phase.value !== "ready") finishIntro();
    else if (expansion.expanded.value) void expansion.toggle();
  }
  const motionPreference = ref<MediaQueryList | null>(null);
  function onMotionChange() {
    if (!motionPreference.value?.matches) return;
    if (phase.value !== "ready") finishIntro();
    expansion.onMotionPreferenceChange();
  }
  onMounted(() => {
    motionPreference.value = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionPreference.value.addEventListener("change", onMotionChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.addEventListener("keydown", onGlobalKeydown);
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!introPlayedInDocument) {
      introPlayedInDocument = true;
      void startIntro();
    } else releaseIntroGate();
  });
  onBeforeUnmount(() => {
    motionPreference.value?.removeEventListener("change", onMotionChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.removeEventListener("keydown", onGlobalKeydown);
    window.removeEventListener("resize", onViewportChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    introAbort?.abort();
    for (const animation of introAnimations) animation.cancel();
    introAnimations.clear();
    expansion.cancel();
    releaseIntroGate();
  });

  return {
    phase,
    revealing,
    spatialIntro,
    bootLines,
    bootProgress,
    bannerRowsVisible,
    bannerCaptionVisible,
    expanded: expansion.expanded,
    shadeActive: expansion.shadeActive,
    anchor,
    terminalRef,
    markRef,
    startIntro,
    finishIntro,
    toggleExpanded: expansion.toggle,
  };
}
