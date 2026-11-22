import { nextTick, onBeforeUnmount, onMounted } from "vue";
import { expressiveDuration, INTRO_READING_UNIT_MS } from "~/utils/motion";
import {
  hasOpenTopLayerSurface,
  waitForTopLayerClose,
  waitForTopLayerDeparture,
} from "~/utils/top-layer";
import { claimHomeIntro, entryTerminalFrames, playEntryTransition } from "../core/intro-entry";
import { INTRO_PACING } from "../core/timing";
import {
  finishIntro,
  frame,
  type IntroContext,
  reducedMotion,
  releaseIntroGate,
  viewportDimensions,
  waitForVisible,
} from "./intro-runtime";
import { playBoot, playBrand, playMark, sleep } from "./intro-scene-entry";

export function prepareIntro(context: IntroContext, element: HTMLElement, reduce: boolean): number {
  const unit = reduce ? INTRO_READING_UNIT_MS : expressiveDuration(element);
  context.phase.value = reduce ? "boot" : "logo";
  // The scene mounts after the probe, so a GPU-less device never flashes the loading report.
  // 场景在探测后挂载，没有 GPU 的设备因此不会闪现载入状态。
  context.introScene.value = null;
  context.revealing.value = false;
  context.markStage.value = "preparing";
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
  document.documentElement.dataset.xcaIntro = "running";

  try {
    await waitForVisible(signal);
    signal.throwIfAborted();
    if (reduce) {
      await playBoot(context, unit, signal, false);
      await playBrand(context, unit, signal);
      context.phase.value = "reveal";
      await sleep(context, unit * INTRO_PACING.revealSettle, signal);
    } else await playMark(context, element, unit, signal);
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
    // Pending text docks on the handoff screen. Revealing would paint the finished banner and
    // prompt before the brand rows start, so the last screen flashes and disappears again.
    // 待打印文字在 handoff 屏停靠。提前进入 reveal 会在 brand 逐行打印前画出完成的字符画与
    // 命令行，最后一屏因此闪现后再次消失。
    context.phase.value = textPending ? "handoff" : "reveal";
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
    context.introScene.value = null;
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
  if (context.phase.value === "ready") void context.expansion.toggle();
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
