import { tokenLength } from "../../../utils/cssTokens";
import { AUDITORIUM } from "./intro-auditorium";
import {
  cameraFrames,
  cameraSamples,
  type Point,
  ramp,
  sampledFrames,
  screenProjection,
  type TerminalPlacement,
} from "./intro-camera";
import { ARRIVAL_ENTRY, JOURNEY, journeyPerspective } from "./intro-geometry";
import { INTRO_HANDOFF, INTRO_PACING } from "./timing";

export type IntroAnimate = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  signal: AbortSignal,
) => Promise<void>;

export type { TerminalPlacement } from "./intro-camera";
export { cameraFrames } from "./intro-camera";

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
  // Include reveal boundaries exactly so WAAPI cannot light the screen early.
  // 显现边界直接加入关键帧，避免 WAAPI 插值提前点亮屏幕。
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
  let handoffProjection: number[] | undefined;
  return samples.map((pose) => {
    const offset = pose.offset;
    // Detach the screen at handoff so forward camera travel cannot enlarge it during shrink.
    // 交接时让屏幕脱离场景投影，避免镜头继续推进时终端反而变大。
    const matrix =
      handoffProjection?.slice() ??
      screenProjection(pose, terminalWidth, terminalHeight, centered, perspective);
    if (offset === INTRO_HANDOFF.start) handoffProjection = matrix.slice();
    const handoff = ramp(offset, INTRO_HANDOFF.start, INTRO_HANDOFF.settled);
    const position = ramp(offset, INTRO_HANDOFF.rise, INTRO_HANDOFF.start);
    matrix.forEach((source, index) => {
      let target = index % 5 === 0 ? 1 : 0;
      if (index === 0 || index === 5) target = centered.scale;
      if (index === 12) target = centered.x;
      if (index === 13) target = centered.y;
      const progress = index === 12 || index === 13 ? position : handoff;
      matrix[index] = source + (target - source) * progress;
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
        transform: `translateZ(${220 * ramp(at, 0, 1)}px)`,
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
