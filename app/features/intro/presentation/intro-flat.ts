import { INTRO_PACING } from "../core/timing";

type Animate = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  signal: AbortSignal,
) => Promise<void>;

interface FlatContext {
  root: HTMLElement;
  unit: number;
  signal: AbortSignal;
  animate: Animate;
  /** Report the stage so the skip hint can follow the flat scene. */
  onStage?: (stage: "drawing" | "journey") => void;
  /** Start the terminal handoff while the mark clears the stage. */
  onHandoff?: () => void;
}

/**
 * Stroke the CA mark, fill it, run one accent line, then clear the stage for the terminal.
 * 描绘并填充 CA 标识，展开一条主色线，随后让出画面给终端。
 */
export async function playFlatMark(context: FlatContext) {
  const { root, unit, signal, animate, onStage, onHandoff } = context;
  const paths = root.querySelectorAll<SVGPathElement>(".xca-intro-flat__mark path");
  const line = root.querySelector<HTMLElement>(".xca-intro-flat__line");
  if (!paths.length || !line) return;
  onStage?.("drawing");
  await Promise.all(
    [...paths].map((path, index) =>
      animate(
        path,
        [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        {
          duration: unit * INTRO_PACING.flatDraw,
          delay: index * unit * INTRO_PACING.flatStagger,
          easing: "ease-in-out",
          fill: "both",
        },
        signal,
      ),
    ),
  );
  signal.throwIfAborted();
  onStage?.("journey");
  await Promise.all([
    ...[...paths].map((path) =>
      animate(
        path,
        [{ fillOpacity: 0 }, { fillOpacity: 1 }],
        { duration: unit * INTRO_PACING.flatFill, easing: "ease-out", fill: "both" },
        signal,
      ),
    ),
    animate(
      line,
      [
        { opacity: 0, transform: "scaleX(0.08)" },
        { opacity: 1, transform: "scaleX(1)" },
      ],
      { duration: unit * INTRO_PACING.flatLine, easing: "ease-out", fill: "both" },
      signal,
    ),
  ]);
  signal.throwIfAborted();
  await animate(root, [], { duration: unit * INTRO_PACING.flatHold }, signal);
  signal.throwIfAborted();
  onHandoff?.();
  // The terminal is already home, so the mark only fades out of its way.
  // 终端已经在最终位置，标识只需淡出让出画面。
  await animate(
    root,
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: unit * INTRO_PACING.flatExit, easing: "ease-in", fill: "both" },
    signal,
  );
}
