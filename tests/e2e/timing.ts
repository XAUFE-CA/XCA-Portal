import type { Page } from "@playwright/test";

/**
 * Wall-clock budget for intro stage arrivals.
 * The intro lasts about 24 s on a 60 fps machine but advances one cue per frame on
 * software renderers, so stage waits must not be derived from fast-machine timing.
 * 入场阶段到达的墙钟预算。60fps 机器上入场约 24 秒，软件渲染时每个提示都要等一帧，
 * 因此阶段等待不能按快机器的时长推导。
 */
export const SCENE_TIMEOUT = 180_000;

/**
 * Budget for a single CSS/WAAPI settle after a state change.
 * 单次状态变更后 CSS/WAAPI 收敛的预算。
 */
export const SETTLE_TIMEOUT = 60_000;

export interface TerminalRecord {
  /** Journey stage seen at the moment of the record. */
  stage: string | null;
  /** Terminal screen modifier classes, e.g. ["boot"]. */
  screen: string[];
  /** Rendered history lines (banner rows and lines). */
  lines: number;
  /** Rendered boot log lines. */
  bootLines: number;
  /** Boot progress value from aria-valuenow, null when absent. */
  progress: number | null;
  /** Rendered characters in the boot progress fill, null when absent. */
  fill: number | null;
  /** Rendered boot progress track text, null when absent. */
  track: string | null;
  /** Rendered characters of the first history entry, which is the banner. */
  banner: number;
}

export interface ContinuitySnapshot {
  index: number;
  text: string | null;
  color: string;
  ink: string;
  clip: string;
  fill: string;
  glow: string;
  font: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerminalRecords {
  sequence: TerminalRecord[];
  /** Snapshots of the printed welcome, taken while the entry still owns it. */
  printed: ContinuitySnapshot[] | null;
  /** Snapshots of the same lines once the ready screen shows them. */
  ready: ContinuitySnapshot[] | null;
  /** Whether the ready lines already existed before the ready screen appeared. */
  reused: boolean | null;
}

/** Capture the printed history geometry relative to the screen and the terminal scale. */
function installLineCapture() {
  Object.assign(window, {
    xcaCaptureTerminalLines: () => {
      const screen = document.querySelector<HTMLElement>(".xca-terminal-screen");
      const terminal = document.querySelector<HTMLElement>(".xca-terminal-window");
      if (!screen || !terminal) return [];
      const origin = screen.getBoundingClientRect();
      const transform = new DOMMatrixReadOnly(getComputedStyle(terminal).transform);
      const scale = Math.hypot(transform.a, transform.b);
      const lines = screen.querySelectorAll<HTMLElement>(
        ".xca-terminal-history .xca-terminal-banner, .xca-terminal-history .xca-terminal-line",
      );
      return [...lines].map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          index,
          text: element.textContent,
          color: style.color,
          ink: style.backgroundImage,
          clip: style.backgroundClip,
          fill: style.webkitTextFillColor,
          glow: style.filter,
          font: style.font,
          x: (rect.x - origin.x) / scale,
          y: (rect.y - origin.y) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        };
      });
    },
  });
}

/** Record every terminal state change per DOM batch. */
function installRecorder() {
  type Entry = {
    stage: string | null;
    screen: string[];
    lines: number;
    bootLines: number;
    progress: number | null;
    fill: number | null;
    track: string | null;
    banner: number;
  };
  interface Capture {
    xcaCaptureTerminalLines: () => unknown[];
  }
  const records: {
    sequence: Entry[];
    printed: unknown[] | null;
    ready: unknown[] | null;
    reused: boolean | null;
  } = { sequence: [], printed: null, ready: null, reused: null };
  // Lines observed before the ready screen prove the entry kept the same DOM nodes.
  // 就绪前观测到的行可以证明入场沿用了同一批 DOM 节点。
  const seenBeforeReady = new WeakSet<Element>();
  let previousSignature = "";
  Object.assign(window, { xcaTerminalRecords: records });
  const capture = (window as unknown as Capture).xcaCaptureTerminalLines;
  const historySelector =
    ".xca-terminal-history .xca-terminal-banner, .xca-terminal-history .xca-terminal-line";

  function read(): Entry {
    const screen = document.querySelector<HTMLElement>(".xca-terminal-screen");
    const progress = screen
      ?.querySelector(".xca-terminal-boot-progress")
      ?.getAttribute("aria-valuenow");
    const fill = screen?.querySelector(".xca-terminal-boot-progress__fill")?.textContent;
    return {
      stage: document.querySelector<HTMLElement>(".xca-ca-intro")?.dataset.journey ?? null,
      screen: [...(screen?.classList ?? [])]
        .filter((name) => name.startsWith("xca-terminal-screen--"))
        .map((name) => name.slice("xca-terminal-screen--".length)),
      lines: screen?.querySelectorAll(historySelector).length ?? 0,
      bootLines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
      progress: progress === undefined || progress === null ? null : Number(progress),
      fill: fill === undefined || fill === null ? null : fill.length,
      track: screen?.querySelector(".xca-terminal-boot-progress__track")?.textContent ?? null,
      banner: screen?.querySelector(historySelector)?.textContent?.length ?? 0,
    };
  }
  function sample() {
    const entry = read();
    const previous = records.sequence.at(-1);
    const unchanged =
      previous?.stage === entry.stage &&
      previous.screen.join(" ") === entry.screen.join(" ") &&
      previous.lines === entry.lines &&
      previous.bootLines === entry.bootLines &&
      previous.progress === entry.progress &&
      previous.fill === entry.fill &&
      previous.track === entry.track &&
      previous.banner === entry.banner;
    if (unchanged) return;
    records.sequence.push(entry);
    // Keep the last entry-side capture whose four lines already carry text: the geometry the
    // ready screen must inherit. A slow frame can merge the stage, so no class marker is used.
    // 保留入场侧最后一次四行都已有文本的快照：那是就绪屏幕必须承接的几何。
    // 慢帧可能合并阶段，因此不依赖类名标记。
    if (!entry.screen.includes("ready") && entry.lines >= 4) {
      const lines = capture().slice(0, 4);
      const text = (line: unknown) => (line as { text: string | null }).text ?? "";
      const signature = lines.map(text).join("\u0000");
      // Accept only a printed banner: the same text across two batches means printing finished.
      // 只采纳已打印完的字符画：连续两批文本相同即视为打印结束。
      if (lines.length === 4 && signature === previousSignature && signature.trim())
        records.printed = lines;
      previousSignature = signature;
    }
    if (entry.screen.includes("ready") && !records.ready) {
      const lines = capture().slice(0, 4);
      records.ready = lines;
      records.reused = lines.every((line) => seenBeforeReady.has(line as never));
    }
    const current = document.querySelectorAll(historySelector);
    for (const line of current) if (!entry.screen.includes("ready")) seenBeforeReady.add(line);
  }
  const start = () => {
    if (!document.body) {
      requestAnimationFrame(start);
      return;
    }
    new MutationObserver(sample).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    sample();
  };
  start();
}

/**
 * Record every terminal state change instead of polling animation frames.
 * Mutation records arrive for each DOM batch, so transient stages survive on slow renderers
 * where a frame-based sample would miss the window entirely.
 * 记录终端的每次状态变化，而不是轮询动画帧。变更记录按 DOM 批次到达，
 * 因此在帧采样必然漏窗的慢速渲染器上，瞬时阶段也能被保留。
 */
export async function recordTerminal(page: Page): Promise<void> {
  await page.addInitScript(installLineCapture);
  await page.addInitScript(installRecorder);
}

/** Read the records collected by {@link recordTerminal}. */
export function terminalRecords(page: Page): Promise<TerminalRecords> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          xcaTerminalRecords?: TerminalRecords;
        }
      ).xcaTerminalRecords ?? { sequence: [], printed: null, ready: null, reused: null },
  );
}

/**
 * Let frozen animations finish naturally so Vue transitions can complete.
 * 让被冻结的动画自然结束，使 Vue 过渡能够完成。
 */
export function resumeAnimations(page: Page, selector: string): Promise<number> {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return 0;
    let resumed = 0;
    for (const animation of element.getAnimations({ subtree: true }))
      if (animation.playState === "paused") {
        animation.play();
        resumed += 1;
      }
    return resumed;
  }, selector);
}

/**
 * Freeze every animation an element is running at a share of its duration.
 * Returns false when the element runs no animation, so callers can assert the intent
 * instead of racing the transition against the frame rate.
 * 将元素上运行的动画冻结在指定进度。元素没有动画时返回 false，
 * 让调用方断言意图，而不是与帧率赛跑。
 */
export function holdAnimations(
  page: Page,
  selector: string,
  share = 0.5,
): Promise<{ total: number; frozen: number }> {
  return page.evaluate(
    ({ selector, share }) => {
      const element = document.querySelector(selector);
      if (!element) return { total: 0, frozen: 0 };
      const animations = element.getAnimations({ subtree: true });
      let frozen = 0;
      for (const animation of animations) {
        const timing = animation.effect?.getComputedTiming();
        const duration = Number(timing?.duration ?? 0);
        if (!Number.isFinite(duration) || duration <= 0) continue;
        animation.pause();
        animation.currentTime = duration * share;
        frozen += 1;
      }
      return { total: animations.length, frozen };
    },
    { selector, share },
  );
}

/**
 * Step the intro timeline forward until the page satisfies a condition.
 * Each step costs one frame instead of waiting the scene out in real time, which keeps
 * choreography specs bounded on renderers that deliver only a few frames per second.
 * 按步推进入场时间线，直到页面满足条件。每步只花一帧，而不是按真实时间等完整个场景，
 * 使编排用例在每秒只有几帧的渲染器上仍有上界。
 */
export function advanceUntil(page: Page, condition: string, budget = 120_000): Promise<boolean> {
  return page.evaluate(
    async ({ condition, budget }) => {
      const satisfied = new Function(`return (${condition})`) as () => boolean;
      const deadline = performance.now() + budget;
      while (performance.now() < deadline) {
        if (satisfied()) return true;
        // Finish the cue that is currently running; the next one is only created after it ends,
        // so this advances one stage per frame instead of skipping ahead.
        // 结束当前正在跑的提示；下一个提示在它结束后才创建，因此每帧只推进一个阶段而不会跳过。
        for (const animation of document.getAnimations()) {
          if (animation.constructor.name !== "Animation") continue;
          const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
          if (!Number.isFinite(duration) || duration <= 0) continue;
          if (Number(animation.currentTime ?? 0) >= duration) continue;
          // finish() resolves the finished promise the presentation awaits, which a paused
          // seek does not guarantee. 结束当前提示以兑现展示层等待的 finished 承诺，
          // 单纯的暂停跳转并不保证这一点。
          try {
            animation.finish();
          } catch {
            animation.cancel();
          }
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
      return satisfied();
    },
    { condition, budget },
  );
}
