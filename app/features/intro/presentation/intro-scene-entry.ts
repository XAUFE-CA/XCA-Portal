import { nextTick } from "vue";
import { entryTerminalFrames } from "../core/intro-entry";
import { probeIntroGraphics, releaseIntroGraphics } from "../core/intro-graphics";
import { centerTerminal } from "../core/intro-journey";
import { INTRO_PACING } from "../core/timing";
import { BOOT_CONTENT, BOOT_CUES, BOOT_READY } from "./boot-script";
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

const BOOT_PROGRESS_TICKS = 32;

function setBootProgress(context: IntroContext, fraction: number) {
  const tick = Math.floor(fraction * BOOT_PROGRESS_TICKS);
  context.bootProgress.value = Math.round((tick / BOOT_PROGRESS_TICKS) * 100);
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
  const terminal = frame(context.anchor);
  let prelude = 0;
  const cues = BOOT_CUES.map((step) => {
    prelude += unit * step.delayUnits;
    return { step, at: prelude };
  });
  prelude += unit * BOOT_CONTENT.delayUnits;
  const docking = unit * INTRO_PACING.arrival;
  const total = prelude + docking;
  let nextCue = 0;
  function printPrelude(elapsed: number) {
    for (let cue = cues[nextCue]; cue && elapsed >= cue.at; cue = cues[++nextCue]) {
      const line = cue.step.line(context.getCommandCount());
      context.bootLines.value.push(line);
      if (spatial && line.message.key === "boot.start") {
        const root = context.markRef.value?.$el as HTMLElement | undefined;
        if (root)
          void trackMotion(context, context.journey.cruise(root, total - cue.at, signal), signal);
      }
    }
    setBootProgress(context, elapsed / total);
  }
  if (terminal && typeof terminal.animate === "function") {
    await context.animateIntro(terminal, [], { duration: prelude }, signal, printPrelude);
  } else {
    for (const { step, at } of cues) {
      await sleep(context, unit * step.delayUnits, signal);
      signal.throwIfAborted();
      printPrelude(at);
    }
    await sleep(context, unit * BOOT_CONTENT.delayUnits, signal);
    signal.throwIfAborted();
  }
  printPrelude(prelude);
  await arrival;
  signal.throwIfAborted();
  context.bootLines.value.push(BOOT_CONTENT.line(context.getCommandCount()));
  if (spatial && terminal) beginRetreat(context, terminal, unit, signal);
  else context.revealing.value = true;

  // Use elapsed animation time, rather than waiting one frame for every character.
  // 按动画已用时间推进，不再为进度条的每个字符单独等一帧。
  const progress =
    terminal && typeof terminal.animate === "function"
      ? context.animateIntro(terminal, [], { duration: docking }, signal, (elapsed) => {
          setBootProgress(context, (prelude + elapsed) / total);
        })
      : sleep(context, docking, signal);
  await Promise.all([progress, context.state.retreatPromise]);
  signal.throwIfAborted();
  if (spatial) context.introScene.value = null;
  context.bootLines.value.push(BOOT_READY);
  context.bootProgress.value = 100;
  await sleep(context, unit * INTRO_PACING.bootComplete, signal);
  signal.throwIfAborted();
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
 * Run flat boot cues and progress from one pausable clock so dropped frames do not queue ticks.
 * 二维入场的启动日志和进度条共用一个可暂停时钟，掉帧时不累积进度刻度。
 */
async function runFlatHandoff(
  context: IntroContext,
  terminal: HTMLElement,
  unit: number,
  signal: AbortSignal,
) {
  await waitForVisible(signal);
  signal.throwIfAborted();
  context.phase.value = "handoff";
  await nextTick();
  signal.throwIfAborted();
  void trackMotion(
    context,
    context.animateIntro(
      terminal,
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: unit * INTRO_PACING.flatExit, easing: "ease-out", fill: "both" },
      signal,
    ),
    signal,
  );
  context.phase.value = "boot";
  await nextTick();
  let duration = 0;
  const cues = [...BOOT_CUES, BOOT_CONTENT].map(({ delayUnits, line }) => {
    duration += unit * delayUnits;
    return { at: duration, line };
  });
  duration += unit * INTRO_PACING.flatBootReady;
  let nextCue = 0;
  function render(elapsed: number) {
    for (let cue = cues[nextCue]; cue && elapsed >= cue.at; cue = cues[++nextCue]) {
      const line = cue.line(context.getCommandCount());
      context.bootLines.value.push(line);
      if (line.message.key === "boot.content") context.revealing.value = true;
    }
    setBootProgress(context, elapsed / duration);
  }
  await context.animateIntro(terminal, [], { duration }, signal, render);
  render(duration);
  context.bootLines.value.push(BOOT_READY);
  await sleep(context, unit * INTRO_PACING.bootComplete, signal);
  signal.throwIfAborted();
  await playBrand(context, unit, signal);
}

/**
 * A device without a usable GPU gets the flat CA mark and a crossfade at the terminal's final position.
 * 没有可用 GPU 的设备只播放二维 CA 标识，随后在终端的最终位置交叉淡化。
 */
async function playFlatEntry(
  context: IntroContext,
  terminal: HTMLElement,
  unit: number,
  signal: AbortSignal,
) {
  const root = (context.markRef.value?.$el as HTMLElement | undefined) ?? null;
  if (!root) return;
  await waitForPaint(signal);
  await playFlatMark({
    root,
    unit,
    signal,
    animate: context.animateIntro,
    onStage: (stage) => {
      context.markStage.value = stage;
    },
  });
  await Promise.all([
    context
      .animateIntro(
        root,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: unit * INTRO_PACING.flatExit, easing: "ease-in", fill: "both" },
        signal,
      )
      .then(() => {
        if (context.introScene.value === "flat") context.introScene.value = null;
      }),
    runFlatHandoff(context, terminal, unit, signal),
  ]);
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
  await playFlatEntry(context, element, unit, signal);
}
