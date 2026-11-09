import { tokenLength } from "../../../utils/cssTokens";
import { AUDITORIUM } from "./intro-auditorium";
import {
  ARRIVAL_ENTRY,
  entryGrowth,
  JOURNEY,
  journeyPerspective,
  roadBend,
} from "./intro-geometry";
import { INTRO_HANDOFF, INTRO_PACING } from "./timing";

export type IntroAnimate = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  signal: AbortSignal,
) => Promise<void>;

type Point = [number, number, number];

interface CameraPose {
  eye: Point;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface TerminalPlacement {
  x: number;
  y: number;
  scale: number;
}

export function centerTerminal(
  element: HTMLElement,
  anchor: HTMLElement | null,
): TerminalPlacement {
  // The final anchor stays in normal flow while its glass surface travels through the scene.
  // 玻璃表面穿过场景时，最终锚点始终保留在正常文档流中。
  const rect = anchor?.getBoundingClientRect() ?? element.getBoundingClientRect();
  const viewport = window.visualViewport;
  const centerX = (viewport?.width ?? window.innerWidth) / 2;
  const centerY = (viewport?.height ?? window.innerHeight) / 2;
  const gutter = tokenLength(element, "--neoverse-layout-gutter-inline");
  const scale = Math.min(
    1,
    ((viewport?.width ?? window.innerWidth) - 2 * gutter) / rect.width,
    ((viewport?.height ?? window.innerHeight) - 2 * gutter) / rect.height,
  );
  const x = centerX - (rect.x + rect.width / 2);
  const y = centerY - (rect.y + rect.height / 2);
  element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  return { x, y, scale };
}

const CAMERA_OFFSETS = [
  ...new Set([
    ...Array.from({ length: 181 }, (_, index) => index / 180),
    INTRO_HANDOFF.rise,
    INTRO_HANDOFF.start,
    INTRO_HANDOFF.boot,
  ]),
].sort((a, b) => a - b);

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

function cameraPose(eye: Point, target: Point, roll: number): CameraPose {
  const dx = eye[0] - target[0],
    dy = eye[1] - target[1],
    dz = eye[2] - target[2];
  return {
    eye,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    roll,
  };
}

function cameraTransform(pose: CameraPose, perspective: number): string {
  const [x, y, z] = pose.eye;
  return `translateZ(${perspective}px) rotateZ(${pose.roll}rad) rotateX(${pose.pitch}rad) rotateY(${-pose.yaw}rad) translate3d(${-x}px, ${-y}px, ${-z}px)`;
}

function cameraSamples(markSize: number, terminalHeight: number, perspective: number) {
  const distance = (perspective * 1254) / markSize;
  const y = JOURNEY.floorY - terminalHeight / 2 - 80;
  const clearance = Math.max(0, JOURNEY.floorY - ARRIVAL_ENTRY.height + JOURNEY.near * 2 - y);
  const { roadX: x, depth } = JOURNEY;
  // Original SVG opening: (775, 632), above the crossbars at y=685.
  // 原始 SVG 开口位于 (775, 632)，在 y=685 的横杠之上。
  const portalX = 775 - 627,
    portalY = 632 - 627;
  const orbit = Math.min(1, markSize / 352);
  const start: Point = [0, 0, distance];
  const end: Point = [x, y, -depth + JOURNEY.perspective];
  const target: Point = [x, y, -depth];
  // Rise around C to reveal the extrusion, then level out before crossing A's opening.
  // 绕 C 抬升以揭示挤出厚度，然后在穿过 A 的开口前回正。
  const eyes: Point[] = [
    start,
    start,
    start,
    [-distance * 0.42 * orbit, -distance * 0.12 * orbit, distance * 0.96],
    [-distance * 0.5 * orbit, -distance * 0.16 * orbit, distance * 0.72],
    [portalX - 260, portalY - 100, 1200],
    [portalX, portalY, 650],
    [portalX, portalY, 160],
    [portalX, portalY, -480],
    [x, 60, -2300],
    [x, y, -4200],
    [x, y, -6100],
    [x, y, -8000],
    [x, y, -9900],
    [x, y, JOURNEY.roadEnd + 600],
    [x, y, ARRIVAL_ENTRY.front],
    [x, y, AUDITORIUM.entrance - 450],
    [x, y, AUDITORIUM.entrance - 1250],
    [x, y, AUDITORIUM.stageFront + 1900],
    end,
    end,
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
    target,
    target,
    target,
    target,
    target,
  ];
  return CAMERA_OFFSETS.map((at) => {
    const eye = spline(eyes, at);
    const bend = roadBend(eye[2]);
    const aim = spline(targets, at);
    // Elevate the camera to the screen centre while keeping the viewing direction level.
    // 将机位升到屏幕中心高度，同时保持水平视线。
    const ahead = roadBend(eye[2] - 1100);
    const follow = ramp(-eye[2], 600, 1800);
    const rise = ramp(at, INTRO_HANDOFF.rise, INTRO_HANDOFF.boot);
    const heightOffset =
      clearance * entryGrowth(eye[2]) + (AUDITORIUM.screen.y - y - clearance) * rise;
    aim[0] += ahead.x * follow;
    aim[1] += ahead.y * follow + heightOffset;
    aim[2] += (eye[2] - 1100 - aim[2]) * follow;
    eye[0] += bend.x;
    eye[1] += bend.y + heightOffset;
    const focus = ramp(
      -eye[2],
      -ARRIVAL_ENTRY.back + JOURNEY.near * 2,
      JOURNEY.depth - JOURNEY.perspective,
    );
    aim[0] += (AUDITORIUM.screen.x - aim[0]) * focus;
    aim[1] += (eye[1] - aim[1]) * focus;
    aim[2] += (AUDITORIUM.screen.z - aim[2]) * focus;
    return { offset: at, ...cameraPose(eye, aim, bend.roll) };
  });
}

export function cameraFrames(
  markSize: number,
  terminalHeight: number,
  perspective: number,
): Keyframe[] {
  return cameraSamples(markSize, terminalHeight, perspective).map((pose) => ({
    offset: pose.offset,
    transform: cameraTransform(pose, perspective),
  }));
}

function screenProjection(
  pose: CameraPose,
  width: number,
  height: number,
  centred: TerminalPlacement,
  perspective: number,
): number[] {
  const screen = AUDITORIUM.screen;
  const cy = Math.cos(pose.yaw),
    sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch),
    sp = Math.sin(pose.pitch);
  const cr = Math.cos(pose.roll),
    sr = Math.sin(pose.roll);
  const xx = cr * cy + sr * sp * sy,
    xy = -sr * cp,
    xz = -cr * sy + sr * sp * cy;
  const yx = sr * cy - cr * sp * sy,
    yy = cr * cp,
    yz = -sr * sy - cr * sp * cy;
  const zx = cp * sy,
    zy = sp,
    zz = cp * cy;
  const dx = screen.x - pose.eye[0],
    dy = screen.y - pose.eye[1],
    dz = screen.z - pose.eye[2];
  const depth = -(zx * dx + zy * dy + zz * dz);
  const sx = screen.width / width,
    vertical = screen.height / height;
  const wx = (-zx * sx) / depth,
    wy = (-zy * vertical) / depth;
  const p = perspective;
  // The perspective row keeps the glass on the same camera plane, including pitch and yaw.
  // 透视行使玻璃与场景沿用同一相机投影，同时包含俯仰和偏航。
  return [
    (p * xx * sx) / depth + centred.x * wx,
    (p * yx * sx) / depth + centred.y * wx,
    0,
    wx,
    (p * xy * vertical) / depth + centred.x * wy,
    (p * yy * vertical) / depth + centred.y * wy,
    0,
    wy,
    0,
    0,
    1,
    0,
    centred.x + (p * (xx * dx + xy * dy + xz * dz)) / depth,
    centred.y + (p * (yx * dx + yy * dy + yz * dz)) / depth,
    0,
    1,
  ];
}

/**
 * One glass surface leaves its stage projection and becomes the readable terminal.
 * 同一玻璃表面从舞台投影连续过渡为可读终端。
 */
export function terminalFrames(
  markSize: number,
  terminalWidth: number,
  terminalHeight: number,
  centered: TerminalPlacement,
  perspective: number,
): Keyframe[] {
  const screen = AUDITORIUM.screen;
  const renderedHeight = terminalHeight * centered.scale;
  const samples = cameraSamples(markSize, renderedHeight, perspective);
  const passageY = Math.max(
    JOURNEY.floorY - renderedHeight / 2 - 80,
    JOURNEY.floorY - ARRIVAL_ENTRY.height + JOURNEY.near * 2,
  );
  const above = passageY - screen.y + screen.height / 2;
  const below = screen.y + screen.height / 2 - passageY;
  const aperture = Math.min(
    (ARRIVAL_ENTRY.width / 2 - JOURNEY.near) /
      (Math.abs(screen.x - JOURNEY.roadX) + screen.width / 2),
    (passageY - JOURNEY.floorY + ARRIVAL_ENTRY.height - JOURNEY.near) / above,
    below > 0 ? (JOURNEY.floorY - JOURNEY.near - passageY) / below : Infinity,
  );
  const revealDepth = Math.max(
    -ARRIVAL_ENTRY.assemblyEnd,
    (-ARRIVAL_ENTRY.back + aperture * screen.z) / (1 - aperture),
  );
  const litDepth = revealDepth + ARRIVAL_ENTRY.height / 2;
  const cues: number[] = [];
  for (const z of [-revealDepth, -litDepth]) {
    const index = samples.findIndex((sample) => sample.eye[2] <= z);
    const before = samples[index - 1],
      after = samples[index];
    if (!before || !after) throw new Error("Screen reveal must lie on the camera path");
    const blend = (z - before.eye[2]) / (after.eye[2] - before.eye[2]);
    cues.push(before.offset + (after.offset - before.offset) * blend);
  }
  // Include reveal and boot boundaries exactly, so WAAPI cannot light the screen early.
  // 显现和开机边界直接加入关键帧，避免 WAAPI 插值提前点亮屏幕。
  for (const offset of cues) {
    const index = samples.findIndex((sample) => sample.offset >= offset);
    const before = samples[index - 1],
      after = samples[index];
    if (!before || !after) throw new Error("Screen handoff must lie on the camera path");
    const blend = (offset - before.offset) / (after.offset - before.offset);
    const eye: Point = [
      before.eye[0] + (after.eye[0] - before.eye[0]) * blend,
      before.eye[1] + (after.eye[1] - before.eye[1]) * blend,
      before.eye[2] + (after.eye[2] - before.eye[2]) * blend,
    ];
    samples.push({
      offset,
      eye,
      yaw: before.yaw + (after.yaw - before.yaw) * blend,
      pitch: before.pitch + (after.pitch - before.pitch) * blend,
      roll: before.roll + (after.roll - before.roll) * blend,
    });
  }
  samples.sort((a, b) => a.offset - b.offset);
  return samples.map((pose) => {
    const offset = pose.offset;
    const matrix = screenProjection(pose, terminalWidth, terminalHeight, centered, perspective);
    const handoff = ramp(offset, INTRO_HANDOFF.start, INTRO_HANDOFF.boot);
    matrix.forEach((source, index) => {
      let target = index % 5 === 0 ? 1 : 0;
      if (index === 0 || index === 5) target = centered.scale;
      if (index === 12) target = centered.x;
      if (index === 13) target = centered.y;
      matrix[index] = source + (target - source) * handoff;
    });
    // Light the glass only once the complete screen fits through both portal planes.
    // 完整屏幕能透过入口前后开口时，再点亮玻璃。
    const opacity = ramp(-pose.eye[2], revealDepth, litDepth);
    return {
      offset,
      transform: `matrix3d(${matrix.join(",")})`,
      opacity,
      visibility: opacity > 0 ? "visible" : "hidden",
    };
  });
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

function prepareJourney(root: HTMLElement, terminalHeight: number) {
  const markSize = Math.min(352, root.clientWidth * 0.64, root.clientHeight * 0.52);
  const camera = root.querySelector<HTMLElement>(".xca-ca-intro__camera");
  const perspective = journeyPerspective(root.clientWidth);
  root.style.setProperty("--xca-scene-perspective", `${perspective}px`);
  if (camera)
    camera.style.transform = String(
      cameraFrames(markSize, terminalHeight, perspective)[0]?.transform,
    );
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
function approachTracks(root: HTMLElement, terminalHeight: number) {
  const markSize = Math.min(352, root.clientWidth * 0.64, root.clientHeight * 0.52);
  return [
    {
      selector: ".xca-ca-intro__camera",
      frames: cameraFrames(markSize, terminalHeight, journeyPerspective(root.clientWidth)),
    },
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
 * 仅负责视觉效果。暂停、中止与清理由 presentation 层管理。
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
  function approach(root: HTMLElement, terminalHeight: number, unit: number, signal: AbortSignal) {
    root.dataset.journey = "approach";
    return Promise.all(
      approachTracks(root, terminalHeight).map(({ selector, frames }) =>
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
