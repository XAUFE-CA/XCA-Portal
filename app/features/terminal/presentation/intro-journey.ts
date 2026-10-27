import { JOURNEY } from "./intro-geometry";
import { INTRO_HANDOFF, INTRO_PACING } from "./timing";

export type IntroAnimate = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  signal: AbortSignal,
) => Promise<void>;

type Point = [number, number, number];

/**
 * Clamped cubic B-spline: C2 continuity, with monotone depth to prevent overshoot.
 * 钳制三次 B 样条：位置、速度与加速度连续，深度单调以避免过冲。
 */
function spline(points: Point[], progress: number): Point {
  const segments = points.length - 3;
  const time = Math.min(1, Math.max(0, progress)) * segments;
  const span = Math.min(points.length - 1, Math.floor(time) + 3);
  const knots = Array.from({ length: points.length + 4 }, (_, index) =>
    Math.min(segments, Math.max(0, index - 3)),
  );
  const work = points.slice(span - 3, span + 1).map((point) => [...point] as Point);
  for (let level = 1; level <= 3; level++) {
    for (let index = 3; index >= level; index--) {
      const knotIndex = span - 3 + index;
      const left = knots[knotIndex] ?? 0;
      const right = knots[knotIndex + 4 - level] ?? segments;
      const mix = right === left ? 0 : (time - left) / (right - left);
      const a = work[index - 1],
        b = work[index];
      if (!a || !b) throw new Error("Incomplete camera spline");
      work[index] = [
        a[0] + (b[0] - a[0]) * mix,
        a[1] + (b[1] - a[1]) * mix,
        a[2] + (b[2] - a[2]) * mix,
      ];
    }
  }
  const result = work[3];
  if (!result) throw new Error("Missing camera position");
  return result;
}
function ramp(at: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (at - from) / (to - from)));
  return t * t * t * (10 + t * (-15 + 6 * t));
}
function sampledFrames(sample: (at: number) => Keyframe, count = 181): Keyframe[] {
  return Array.from({ length: count }, (_, frame) => ({
    offset: frame / (count - 1),
    ...sample(frame / (count - 1)),
  }));
}

export function cameraTransform(eye: Point, target: Point): string {
  const [x, y, z] = eye;
  const dx = x - target[0],
    dy = y - target[1],
    dz = z - target[2];
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return `translateZ(${JOURNEY.perspective}px) rotateX(${pitch}rad) rotateY(${-yaw}rad) translate3d(${-x}px, ${-y}px, ${-z}px)`;
}

function cameraSamples(markSize: number, terminalHeight: number) {
  const distance = (JOURNEY.perspective * 1254) / markSize;
  const y = JOURNEY.floorY - terminalHeight / 2 - 80;
  const { roadX: x, depth, perspective } = JOURNEY;
  // Original SVG opening: (775, 632), above the crossbars at y=685.
  // 原始 SVG 开口位于 (775, 632)，在 y=685 的横杠之上。
  const portalX = 775 - 627,
    portalY = 632 - 627;
  const orbit = Math.min(1, markSize / 352);
  const start: Point = [0, 0, distance];
  const end: Point = [x, y, -depth + perspective];
  const target: Point = [x, y, -depth];
  // Negative X is CA's left; approach there, cross above the middle bar, then fly straight.
  // 负 X 为 CA 左侧；从该侧接近，越过中间横杠后沿直线向前飞行。
  const eyes: Point[] = [
    start,
    start,
    start,
    [-distance * 0.34 * orbit, 0, distance * 0.96],
    [-distance * 0.4 * orbit, -60, distance * 0.72],
    [portalX - 260, portalY - 50, 1200],
    [portalX, portalY, 650],
    [portalX, portalY, 160],
    [portalX, portalY, -480],
    [x, 60, -2300],
    [x, y, -4200],
    [x, y, -6100],
    [x, y, -8000],
    [x, y, -9900],
    [x, y, -depth + perspective * 3.2],
    [x, y, -depth + perspective * 1.7],
    end,
    end,
    end,
  ];
  const targets: Point[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    // Observe from C's side, then straighten before crossing A without overshooting right.
    // 先从 C 侧观察，穿过 A 前回正，横向不越过道路轴线。
    [portalX * 0.5, portalY, -40],
    [portalX, portalY, -300],
    [portalX, portalY, -900],
    [portalX, portalY, -1600],
    [x, 30, -3500],
    [x, y, -6000],
    target,
    target,
    target,
    target,
    target,
    target,
    target,
    target,
    target,
  ];
  return Array.from({ length: 181 }, (_, index) => {
    const at = index / 180;
    const eye = spline(eyes, at);
    return { offset: at, eye, transform: cameraTransform(eye, spline(targets, at)) };
  });
}

export function cameraFrames(markSize: number, terminalHeight: number): Keyframe[] {
  return cameraSamples(markSize, terminalHeight).map(({ offset, transform }) => ({
    offset,
    transform,
  }));
}

/**
 * The real terminal follows the same projected camera distance during arrival.
 * 真实终端在到达阶段沿用相同的投影相机距离。
 */
export function terminalFrames(
  markSize: number,
  terminalHeight: number,
  centered: string,
): Keyframe[] {
  return cameraSamples(markSize, terminalHeight)
    .filter(({ offset }) => offset >= INTRO_HANDOFF.start)
    .map(({ offset, eye }) => ({
      offset: (offset - INTRO_HANDOFF.start) / (1 - INTRO_HANDOFF.start),
      transform: `${centered} scale(${JOURNEY.perspective / (eye[2] + JOURNEY.depth)})`,
      opacity: ramp(offset, INTRO_HANDOFF.start, 0.94),
    }));
}

/** Settle the FLIP translation and scale with the same smooth ramp as the scene. */
export function terminalDockFrames(from: ArrayLike<number>): Keyframe[] {
  return sampledFrames((at) => {
    const progress = ramp(at, 0, 1);
    const matrix = Array.from({ length: 16 }, (_, index) => {
      const target = index % 5 === 0 ? 1 : 0;
      const source = from[index] ?? target;
      return source + (target - source) * progress;
    });
    return { transform: `matrix3d(${matrix.join(",")})` };
  }, 61);
}

function prepareJourney(root: HTMLElement, terminal: HTMLElement) {
  const box = terminal.getBoundingClientRect();
  const markSize = Math.min(352, root.clientWidth * 0.64, root.clientHeight * 0.52);
  const camera = root.querySelector<HTMLElement>(".xca-ca-intro__camera");
  if (camera) camera.style.transform = String(cameraFrames(markSize, box.height)[0]?.transform);
  root.dataset.journey = "draw";
}
function geometryTracks(root: HTMLElement) {
  const depth = [...root.querySelectorAll<HTMLElement>(".xca-ca-intro__depth")].map((layer) => ({
    selector: `.xca-ca-intro__depth[data-depth="${layer.dataset.depth}"]`,
    frames: sampledFrames(
      (at) => ({
        opacity: ramp(at, 0.03, 0.24),
        transform: `translateZ(${-Number(layer.dataset.depth) * ramp(at, 0.03, 0.24)}px)`,
      }),
      61,
    ),
  }));
  return depth;
}
function approachTracks(root: HTMLElement, terminal: HTMLElement) {
  const box = terminal.getBoundingClientRect();
  const markSize = Math.min(352, root.clientWidth * 0.64, root.clientHeight * 0.52);
  return [
    { selector: ".xca-ca-intro__camera", frames: cameraFrames(markSize, box.height) },
    ...(root.dataset.markRenderer === "mesh"
      ? []
      : [
          {
            selector: ".xca-ca-intro__rib",
            frames: sampledFrames((at) => ({ opacity: ramp(at, 0.38, 0.5) }), 25),
          },
        ]),
    {
      selector: ".xca-ca-intro__aura",
      frames: sampledFrames((at) => ({ opacity: ramp(at, 0.1, 0.58) }), 25),
    },
    ...geometryTracks(root),
  ];
}

/**
 * Visual effects only; the presentation owns their pause, abort and cleanup.
 * 仅负责视觉效果；暂停、中止与清理由呈现层管理。
 */
export function createIntroJourney(animate: IntroAnimate) {
  function part(
    root: HTMLElement,
    selector: string,
    frames: Keyframe[],
    duration: number,
    signal: AbortSignal,
  ) {
    return Promise.all(
      [...root.querySelectorAll(selector)].map((element) =>
        animate(element, frames, { duration, easing: "linear", fill: "both" }, signal),
      ),
    );
  }
  function approach(root: HTMLElement, terminal: HTMLElement, unit: number, signal: AbortSignal) {
    root.dataset.journey = "approach";
    return Promise.all(
      approachTracks(root, terminal).map(({ selector, frames }) =>
        part(root, selector, frames, unit * INTRO_PACING.journey, signal),
      ),
    );
  }
  function cruise(root: HTMLElement, duration: number, signal: AbortSignal) {
    root.dataset.journey = "cruise";
    return part(
      root,
      ".xca-ca-intro__travel",
      sampledFrames((at) => ({
        transform: `translateZ(${220 * (1 - (1 - at) ** 3)}px)`,
      })),
      duration,
      signal,
    );
  }
  function retreat(root: HTMLElement, unit: number, signal: AbortSignal) {
    root.dataset.journey = "retreat";
    const duration = unit * INTRO_PACING.arrival;
    return Promise.all([
      part(root, ".xca-ca-intro__mesh", [{ opacity: 1 }, { opacity: 0 }], duration, signal),
      part(root, ".xca-ca-intro__aura", [{ opacity: 1 }, { opacity: 0 }], duration, signal),
      ...[...root.querySelectorAll<HTMLElement>(".xca-ca-intro__rib")].map((rib, index) =>
        animate(
          rib,
          sampledFrames((at) => {
            const progress = ramp(at, 0, 1);
            return {
              opacity: 1 - progress,
              translate: `${(index % 2 ? 1 : -1) * progress * 700}px ${progress * 80}px`,
            };
          }),
          { duration, easing: "linear", fill: "both" },
          signal,
        ),
      ),
    ]);
  }
  return { prepare: prepareJourney, approach, cruise, retreat };
}
