import { createIntroJourney, terminalFrames } from "./intro-journey";
import { INTRO_HANDOFF, INTRO_PACING } from "./timing";

type Animate = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  signal: AbortSignal,
) => Promise<void>;

interface MarkContext {
  root: HTMLElement;
  terminal: HTMLElement;
  unit: number;
  signal: AbortSignal;
  animate: Animate;
  onHandoff: (arrival: Promise<void>) => Promise<void>;
}

/**
 * Fill, extrude and start the camera together after drawing the CA mark.
 * 绘制 CA 标识后，同时填充、挤出并启动相机。
 */
export async function playIntroMark(context: MarkContext) {
  const { root, terminal, unit, signal, animate, onHandoff } = context;
  const paths = root.querySelectorAll<SVGPathElement>(".xca-ca-intro__front path");
  if (!paths.length || typeof terminal.animate !== "function") return;
  const journey = createIntroJourney(animate);
  journey.prepare(root, terminal);
  await Promise.all(
    [...paths].map((path, index) =>
      animate(
        path,
        [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        {
          duration: unit * INTRO_PACING.markDraw,
          delay: index * unit * INTRO_PACING.markStagger,
          easing: "ease-in-out",
          fill: "both",
        },
        signal,
      ),
    ),
  );
  const duration = unit * INTRO_PACING.journey;
  const markSize = Math.min(352, root.clientWidth * 0.64, root.clientHeight * 0.52);
  const frames = terminalFrames(
    markSize,
    terminal.getBoundingClientRect().height,
    terminal.style.transform || "translateZ(0)",
  );
  const arrival = animate(terminal, [], { duration: duration * INTRO_HANDOFF.arrival }, signal);
  await Promise.all([
    journey.approach(root, terminal, unit, signal),
    arrival,
    animate(
      terminal,
      frames,
      {
        delay: duration * INTRO_HANDOFF.start,
        duration: duration * (1 - INTRO_HANDOFF.start),
        easing: "linear",
        fill: "both",
      },
      signal,
    ),
    (async () => {
      await animate(terminal, [], { duration: duration * INTRO_HANDOFF.boot }, signal);
      signal.throwIfAborted();
      await onHandoff(arrival);
    })(),
    ...[...paths].flatMap((path) => [
      animate(
        path,
        [{ fillOpacity: 0 }, { fillOpacity: 1 }],
        {
          duration: unit * INTRO_PACING.markFill,
          easing: "ease-out",
          fill: "both",
        },
        signal,
      ),
      animate(
        path,
        [{ strokeOpacity: 1 }, { strokeOpacity: 0 }],
        {
          duration: unit * INTRO_PACING.markFill,
          delay: unit * INTRO_PACING.markFill * 0.5,
          fill: "both",
        },
        signal,
      ),
    ]),
  ]);
}
