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
}

/**
 * Stroke and fill the CA mark, then hold it before the terminal handoff.
 * 描绘并填充 CA 标识，短暂停留后交给终端。
 */
export async function playFlatMark(context: FlatContext) {
  const { root, unit, signal, animate, onStage } = context;
  const paths = root.querySelectorAll<SVGPathElement>(".xca-intro-flat__mark path");
  if (!paths.length) return;
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
  await Promise.all(
    [...paths].map((path) =>
      animate(
        path,
        [{ fillOpacity: 0 }, { fillOpacity: 1 }],
        { duration: unit * INTRO_PACING.flatFill, easing: "ease-out", fill: "both" },
        signal,
      ),
    ),
  );
  signal.throwIfAborted();
  await animate(root, [], { duration: unit * INTRO_PACING.flatHold }, signal);
}
