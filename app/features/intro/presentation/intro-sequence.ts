import { nextTick, onBeforeUnmount, onMounted } from "vue";
import { expressiveDuration, INTRO_READING_UNIT_MS } from "~/utils/motion";
import {
  hasOpenTopLayerSurface,
  waitForTopLayerClose,
  waitForTopLayerDeparture,
} from "~/utils/top-layer";
import {
  claimHomeIntro,
  createIntroShortcut,
  entryTerminalFrames,
  playEntryTransition,
} from "../core/intro-entry";
import { centerTerminal, type TerminalPlacement } from "../core/intro-journey";
import { INTRO_PACING } from "../core/timing";
import { BOOT_SEQUENCE } from "./boot-script";
import { playIntroMark } from "./intro-mark";
import {
  frame,
  IDENTITY_TRANSFORM,
  type IntroContext,
  reducedMotion,
  releaseIntroGate,
  viewportDimensions,
  waitForPaint,
  waitForVisible,
} from "./intro-runtime";

export function bindShortcut(context: IntroContext): void {
  context.state.introShortcut = createIntroShortcut(() => void skipIntro(context));
}

export function finishIntro(context: IntroContext): void {
  const wasPlaying = context.phase.value !== "ready";
  context.state.introAbort?.abort();
  context.state.introAbort = null;
  context.playback.cancel();
  context.state.settling = false;
  context.state.retreatPromise = null;
  context.revealing.value = false;
  context.spatialIntro.value = false;
  const element = frame(context.anchor);
  // Keep the terminal's compositor layer after docking; dropping it snaps the Aurora Glass edge.
  // 停靠后让终端保持独立合成层。移除变换会让极光玻璃边缘在重新栅格化时抖动。
  if (element) element.style.transform = IDENTITY_TRANSFORM;
  context.phase.value = "ready";
  context.bootLines.value = [];
  context.bootProgress.value = 0;
  context.bannerRowsVisible.value = 0;
  context.bannerCaptionLines.value = 0;
  context.expansion.reset();
  bindShortcut(context);
  releaseIntroGate();
  if (wasPlaying)
    void nextTick().then(() => {
      if (context.phase.value === "ready" && window.matchMedia("(pointer: fine)").matches)
        context.terminalRef.value?.focusInput();
    });
}

export function sleep(context: IntroContext, ms: number, signal: AbortSignal): Promise<void> {
  const element = frame(context.anchor);
  // Cues use the same pausable timeline as the drawing and docking.
  // 提示使用与绘制和停靠相同的可暂停时间线。
  if (element && typeof element.animate === "function")
    return context.animateIntro(element, [], { duration: ms }, signal);
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

export function trackMotion(
  context: IntroContext,
  task: Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  return task.then(
    () => undefined,
    (error: unknown) => {
      if (signal.aborted || context.state.introAbort?.signal !== signal) return;
      console.error("Terminal intro motion failed", error);
      finishIntro(context);
    },
  );
}

export async function dockTerminal(
  context: IntroContext,
  element: HTMLElement,
  unit: number,
  signal: AbortSignal,
): Promise<void> {
  await context.animateIntro(
    element,
    entryTerminalFrames(element, false),
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

export function beginRetreat(
  context: IntroContext,
  element: HTMLElement,
  unit: number,
  signal: AbortSignal,
): void {
  if (context.state.retreatPromise) return;
  context.revealing.value = true;
  const root = context.markRef.value?.$el as HTMLElement | undefined;
  context.state.retreatPromise = trackMotion(
    context,
    Promise.all([
      root ? context.journey.retreat(root, unit, signal) : Promise.resolve(),
      dockTerminal(context, element, unit, signal),
    ]),
    signal,
  );
}

export async function playBoot(
  context: IntroContext,
  unit: number,
  signal: AbortSignal,
  spatial: boolean,
  arrival: Promise<unknown> = Promise.resolve(),
): Promise<void> {
  context.phase.value = "boot";
  await nextTick();
  // Emitted lines drive scene cues; the progress bar only measures elapsed reading time.
  // 实际输出的文本行驱动场景提示。进度条仅衡量已用的阅读时间。
  await Promise.all([
    (async () => {
      for (const step of BOOT_SEQUENCE) {
        await sleep(context, unit * step.delayUnits, signal);
        signal.throwIfAborted();
        const line = step.line(context.getCommandCount());
        if (spatial && line.message.key === "boot.content") await arrival;
        if (line.message.key === "boot.ready") await context.state.retreatPromise;
        signal.throwIfAborted();
        context.bootLines.value = [...context.bootLines.value, line];
        const root = context.markRef.value?.$el as HTMLElement | undefined;
        if (spatial && root && line.message.key === "boot.start") {
          const remaining = BOOT_SEQUENCE.slice(1).reduce(
            (total, cue) => total + cue.delayUnits,
            0,
          );
          void trackMotion(context, context.journey.cruise(root, unit * remaining, signal), signal);
        }
        if (line.message.key !== "boot.content") continue;
        const element = frame(context.anchor);
        if (spatial && element) {
          beginRetreat(context, element, unit, signal);
        } else context.revealing.value = true;
      }
    })(),
    (async () => {
      const ticks = 32;
      const duration = unit * BOOT_SEQUENCE.reduce((total, step) => total + step.delayUnits, 0);
      for (let tick = 1; tick <= ticks; tick++) {
        await sleep(context, duration / ticks, signal);
        signal.throwIfAborted();
        context.bootProgress.value = Math.round((tick / ticks) * 100);
      }
    })(),
  ]);
  await sleep(context, unit * INTRO_PACING.bootComplete, signal);
  signal.throwIfAborted();
  context.spatialIntro.value = false;
}

export async function playBrand(context: IntroContext, unit: number, signal: AbortSignal) {
  context.phase.value = "brand";
  await nextTick();
  await sleep(context, unit * INTRO_PACING.brandCrossfade, signal);
  // Use the same responsive banner resource as the real terminal renderer.
  // 使用与真实终端渲染器相同的响应式横幅资源。
  const rows = context.terminalRef.value?.getBannerRowCount() ?? 7;
  for (let row = 1; row <= rows; row++) {
    await sleep(context, unit * INTRO_PACING.bannerRow, signal);
    signal.throwIfAborted();
    context.bannerRowsVisible.value = row;
  }
  await sleep(context, unit * INTRO_PACING.bannerCaption, signal);
  // Welcome copy follows the artwork one line at a time, never as a single block.
  // 欢迎文案跟随字符画逐行出现，不会整块突然显现。
  const captions = context.terminalRef.value?.getWelcomeLineCount() ?? 0;
  for (let line = 1; line <= captions; line++) {
    await sleep(context, unit * INTRO_PACING.captionLine, signal);
    signal.throwIfAborted();
    context.bannerCaptionLines.value = line;
  }
  await sleep(context, unit * INTRO_PACING.brandHold, signal);
  signal.throwIfAborted();
}

export async function playMark(
  context: IntroContext,
  element: HTMLElement,
  unit: number,
  signal: AbortSignal,
  centered: TerminalPlacement,
): Promise<void> {
  const root = (context.markRef.value?.$el as HTMLElement | undefined) ?? null;
  if (!root) return;
  await context.markRef.value?.prepareRenderer(signal);
  // Leave a painted frame after GPU preparation before starting the SVG strokes.
  // GPU 准备结束后先完成一帧绘制，再启动 SVG 描边。
  await waitForPaint(signal);
  await playIntroMark({
    root,
    terminal: element,
    centered,
    unit,
    signal,
    animate: context.animateIntro,
    onHandoff: async (arrival) => {
      await waitForVisible(signal);
      signal.throwIfAborted();
      context.phase.value = "handoff";
      await nextTick();
      signal.throwIfAborted();
      await playBoot(context, unit, signal, true, arrival);
      await playBrand(context, unit, signal);
    },
  });
}

export function prepareIntro(context: IntroContext, element: HTMLElement, reduce: boolean): number {
  const unit = reduce ? INTRO_READING_UNIT_MS : expressiveDuration(element);
  context.phase.value = reduce ? "boot" : "logo";
  context.spatialIntro.value = !reduce;
  context.revealing.value = false;
  context.bootLines.value = [];
  context.bootProgress.value = 0;
  context.bannerRowsVisible.value = 0;
  context.bannerCaptionLines.value = 0;
  return unit;
}

export async function startIntro(
  context: IntroContext,
  options: { explicit?: boolean } = {},
): Promise<void> {
  if (!import.meta.client || !context.anchor.value) return;
  // A menu row starts the replay in the same tick it closes its popover. The panel leaves the
  // top layer at once but keeps painting through its discrete exit transition, so clear it
  // from the shared edge canvas only after that departure, before the CSS edge pass switches.
  // 菜单行在关闭浮层的同一 tick 启动重播。面板立即离开顶层，但在离散退出过渡期间仍参与绘制；
  // 必须等退出结束再让共享边缘画布移除该面板，随后才切换 CSS 边缘通道。
  if (hasOpenTopLayerSurface()) await waitForTopLayerClose();
  await waitForTopLayerDeparture();
  context.glassRenderer?.refresh();
  if (context.state.introAbort) finishIntro(context);
  context.expansion.reset();
  // Both a restored scroll and a replay dock from the top anchor, clear of the sticky header.
  // 重载恢复的滚动与重播都从顶部锚点归位，不与吸顶页头重叠。
  window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  const reduce = reducedMotion() || typeof frame(context.anchor)?.animate !== "function";
  if (reduce && !options.explicit) {
    finishIntro(context);
    return;
  }
  const element = frame(context.anchor);
  if (!element) {
    releaseIntroGate();
    return;
  }
  const controller = new AbortController();
  context.state.introAbort = controller;
  const signal = controller.signal;
  // Reduced motion drops spatial effects, but explicit replay still needs readable boot text.
  // 减少动效会移除空间效果，但显式重播仍需可读的开机文本，而非共用的 1ms 动效变量。
  const unit = prepareIntro(context, element, reduce);
  context.state.viewportSize = viewportDimensions();
  await nextTick();
  if (signal.aborted) return;
  element.style.transform = "none";
  const centered = reduce ? null : centerTerminal(element, context.anchor.value);
  document.documentElement.dataset.xcaIntro = "running";

  try {
    await waitForVisible(signal);
    signal.throwIfAborted();
    if (centered) await playMark(context, element, unit, signal, centered);
    else {
      await playBoot(context, unit, signal, false);
      await playBrand(context, unit, signal);
      context.phase.value = "reveal";
      await sleep(context, unit * INTRO_PACING.revealSettle, signal);
    }
    signal.throwIfAborted();
    finishIntro(context);
  } catch {
    if (!signal.aborted && context.state.introAbort === controller) finishIntro(context);
  }
}

export async function enterHome(context: IntroContext, brief = false): Promise<void> {
  if (context.state.settling) return;
  // A skip before the welcome text has printed must not jump straight to the finished screen.
  // 欢迎文字尚未打印时跳过，不能直接跳到完成态终端。
  const textPending =
    context.phase.value === "logo" ||
    context.phase.value === "handoff" ||
    context.phase.value === "boot";
  const element = frame(context.anchor);
  if (!element || reducedMotion() || typeof element.animate !== "function") {
    finishIntro(context);
    return;
  }
  context.state.settling = true;
  context.playback.freeze();
  const frames = entryTerminalFrames(element, brief);
  context.state.introAbort?.abort();
  const controller = new AbortController();
  context.state.introAbort = controller;
  // Brief entry decorates the ready page; only a full intro owns its interaction state.
  // 短入场只装饰可交互页面，只有完整入场才占用交互状态。
  if (!brief) {
    context.phase.value = "reveal";
    context.revealing.value = true;
  }
  context.state.viewportSize = viewportDimensions();
  await nextTick();
  if (controller.signal.aborted) return;
  try {
    const transition = playEntryTransition(
      element,
      (context.markRef.value?.$el as HTMLElement | undefined) ?? null,
      frames,
      context.animateIntro,
      controller.signal,
      brief,
    );
    if (brief) releaseIntroGate();
    else document.documentElement.dataset.xcaIntro = "running";
    await transition;
    // The scene fade is complete; unmount the renderer before the text stage so software
    // renderers do not keep drawing a hidden WebGL scene while the welcome prints.
    // 场景淡出已完成。在文字阶段前卸载渲染器，避免软件渲染器在欢迎文字打印时继续绘制已隐藏的场景。
    context.spatialIntro.value = false;
    // Skipping the spatial scene keeps the terminal's own second screen: play the same
    // brand stage so the artwork and welcome copy print row by row instead of appearing whole.
    // 跳过空间场景时保留终端自身的第二屏：播放同一个 brand 阶段，让字符画与欢迎文案逐行打印而非整块显现。
    if (!brief && textPending && !controller.signal.aborted) {
      await playBrand(context, expressiveDuration(element), controller.signal);
      context.phase.value = "reveal";
    }
    if (!controller.signal.aborted) finishIntro(context);
  } catch {
    if (!controller.signal.aborted) finishIntro(context);
  }
}

export function skipIntro(context: IntroContext): void {
  if (context.phase.value !== "ready") void enterHome(context);
}

export function toggleExpanded(context: IntroContext) {
  if (context.phase.value === "ready" && context.state.introAbort) finishIntro(context);
  return context.expansion.toggle();
}

export function onViewportChange(context: IntroContext): void {
  context.expansion.onViewportChange();
  const size = viewportDimensions();
  if (
    size.width === context.state.viewportSize.width &&
    size.height === context.state.viewportSize.height
  )
    return;
  context.state.viewportSize = size;
  // A changed projection cannot reuse its old DOM handoff; settle once instead of jumping.
  // 投影变化后旧 DOM 无法继续交接。直接一次归位，避免几何跳变或重复输出。
  if (context.state.introAbort) finishIntro(context);
}

export function onGlobalKeydown(context: IntroContext, event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    if (context.phase.value !== "ready" && !context.state.settling)
      context.state.introShortcut(event);
    return;
  }
  if (context.phase.value !== "ready") skipIntro(context);
  else if (context.expansion.expanded.value) void context.expansion.toggle();
}

export function onMotionChange(context: IntroContext): void {
  if (!context.motionPreference.value?.matches) return;
  if (context.state.introAbort) finishIntro(context);
  context.expansion.onMotionPreferenceChange();
}

export function registerLifecycle(context: IntroContext): void {
  const onMotion = () => onMotionChange(context);
  const onResize = () => onViewportChange(context);
  const onKeydown = (event: KeyboardEvent) => onGlobalKeydown(context, event);
  onMounted(() => {
    context.motionPreference.value = window.matchMedia("(prefers-reduced-motion: reduce)");
    context.motionPreference.value.addEventListener("change", onMotion);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", context.playback.onVisibilityChange);
    if (claimHomeIntro()) void startIntro(context);
    else void enterHome(context, true);
  });
  onBeforeUnmount(() => {
    context.motionPreference.value?.removeEventListener("change", onMotion);
    window.visualViewport?.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", context.playback.onVisibilityChange);
    context.state.introAbort?.abort();
    context.playback.cancel();
    context.state.settling = false;
    context.expansion.cancel();
    releaseIntroGate();
  });
}
