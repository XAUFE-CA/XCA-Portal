import { nextTick } from "vue";
import { entryTerminalFrames } from "../core/intro-entry";
import { probeIntroGraphics, releaseIntroGraphics } from "../core/intro-graphics";
import { centerTerminal } from "../core/intro-journey";
import { INTRO_PACING } from "../core/timing";
import { BOOT_SEQUENCE } from "./boot-script";
import { playFlatMark } from "./intro-flat";
import { playIntroMark } from "./intro-mark";
import {
  finishIntro,
  frame,
  IDENTITY_TRANSFORM,
  type IntroContext,
  waitForPaint,
  waitForVisible,
} from "./intro-runtime";

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

async function dockTerminal(
  context: IntroContext,
  element: HTMLElement,
  unit: number,
  signal: AbortSignal,
): Promise<void> {
  await context.animateIntro(
    element,
    entryTerminalFrames(element, false),
    { duration: unit * INTRO_PACING.arrival, easing: "linear", fill: "forwards" },
    signal,
  );
  signal.throwIfAborted();
  element.style.transform = IDENTITY_TRANSFORM;
}

function beginRetreat(
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
        if (spatial && element) beginRetreat(context, element, unit, signal);
        else context.revealing.value = true;
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
  if (spatial) context.introScene.value = null;
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

/**
 * Run the boot output and welcome print once the scene has handed over.
 * 场景交接后运行启动输出与欢迎打印。
 */
async function runHandoff(context: IntroContext, unit: number, signal: AbortSignal, flat = false) {
  await waitForVisible(signal);
  signal.throwIfAborted();
  context.phase.value = "handoff";
  await nextTick();
  signal.throwIfAborted();
  const element = frame(context.anchor);
  // The flat entry has no projected glass, so the terminal fades in where it will stay.
  // 二维入场没有投影玻璃，终端直接在最终位置淡入。
  if (flat && element)
    void trackMotion(
      context,
      context.animateIntro(
        element,
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: unit * INTRO_PACING.flatExit, easing: "ease-out", fill: "both" },
        signal,
      ),
      signal,
    );
  await playBoot(context, unit, signal, false);
  await playBrand(context, unit, signal);
}

/**
 * A device without a usable GPU gets the CA mark and one accent line, never a simulated journey.
 * 没有可用 GPU 的设备只看到 CA 标识与一条主色线，不模拟穿城镜头。
 */
async function playFlatEntry(context: IntroContext, unit: number, signal: AbortSignal) {
  const root = (context.markRef.value?.$el as HTMLElement | undefined) ?? null;
  if (!root) return;
  await waitForPaint(signal);
  let handoff: Promise<void> | undefined;
  await playFlatMark({
    root,
    unit,
    signal,
    animate: context.animateIntro,
    onStage: (stage) => {
      context.markStage.value = stage;
    },
    onHandoff: () => {
      handoff = runHandoff(context, unit, signal, true);
    },
  });
  // The mark has faded; release its DOM before the welcome print continues.
  // 标识已淡出，在欢迎文案继续打印前释放其 DOM。
  if (context.introScene.value === "flat") context.introScene.value = null;
  await handoff;
}

export async function playMark(
  context: IntroContext,
  element: HTMLElement,
  unit: number,
  signal: AbortSignal,
): Promise<void> {
  const gl = probeIntroGraphics();
  if (gl) {
    context.introScene.value = "spatial";
    context.markStage.value = "preparing";
    await nextTick();
    const root = (context.markRef.value?.$el as HTMLElement | undefined) ?? null;
    const mounted = root ? await context.markRef.value?.prepareRenderer(gl, signal) : false;
    if (mounted && root) {
      const centered = centerTerminal(element, context.anchor.value);
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
        onStage: (stage) => {
          context.markStage.value = stage;
        },
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
      return;
    }
    // A renderer that failed after the probe releases its context and uses the flat entry.
    // 探测后仍失败的渲染器会释放上下文并改用二维入场。
    releaseIntroGraphics(gl);
  }
  context.introScene.value = "flat";
  context.markStage.value = "drawing";
  await nextTick();
  if (signal.aborted) return;
  await playFlatEntry(context, unit, signal);
}
