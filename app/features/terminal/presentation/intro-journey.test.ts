import { expect, test } from "bun:test";
import { JOURNEY, roadGrowth } from "./intro-geometry";
import { cameraFrames, terminalDockFrames, terminalFrames } from "./intro-journey";
import { INTRO_HANDOFF, INTRO_PACING, INTRO_READING_UNIT_MS } from "./timing";

function eye(frame: Keyframe): number[] {
  const match = String(frame.transform).match(
    /translate3d\(([-\d.e+]+)px, ([-\d.e+]+)px, ([-\d.e+]+)px\)/,
  );
  if (!match) throw new Error("Camera translation missing");
  return match.slice(1).map((value) => -Number(value));
}

test("passes through A above the crossbar, between its inner strokes", () => {
  const frames = cameraFrames(352, 448);
  const crossing = frames.find((frame) => (eye(frame)[2] ?? 0) < 0);
  expect(crossing).toBeDefined();
  if (!crossing) return;
  const [x = 0, y = 0] = eye(crossing);
  expect(x).toBeGreaterThan(120);
  expect(x).toBeLessThan(200);
  expect(y).toBeGreaterThan(-30);
  expect(y).toBeLessThan(35);
});

test("the real terminal follows camera projection continuously to its docked scale", () => {
  const frames = terminalFrames(352, 448, "translate(30px, 60px) scale(0.8)");
  const camera = cameraFrames(352, 448);
  expect(frames[0]?.offset).toBe(0);
  expect(frames.at(-1)?.offset).toBe(1);
  expect(frames.at(-1)?.opacity).toBe(1);
  for (const frame of frames) {
    const progress = INTRO_HANDOFF.start + Number(frame.offset) * (1 - INTRO_HANDOFF.start);
    const pose = camera[Math.round(progress * (camera.length - 1))];
    if (!pose) throw new Error("Missing camera sample");
    const scale = Number(String(frame.transform).match(/scale\(([-\d.e+]+)\)$/)?.[1]);
    expect(scale).toBeCloseTo(JOURNEY.perspective / ((eye(pose)[2] ?? 0) + JOURNEY.depth), 8);
    expect(String(frame.transform).startsWith("translate(30px, 60px) scale(0.8)")).toBe(true);
  }
});

test("terminal descent settles gradually instead of spending most movement in the first frames", () => {
  const source = [0.98, 0, 0, 0, 0, 0.98, 0, 0, 0, 0, 1, 0, 0, -200, 0, 1];
  const frames = terminalDockFrames(source);
  const y = (index: number) => Number(String(frames[index]?.transform).slice(9, -1).split(",")[13]);
  expect(y(0)).toBe(-200);
  expect(y(60)).toBe(0);
  expect(y(15)).toBeLessThan(-170);
  expect(y(30)).toBeCloseTo(-100, 6);
  expect(y(1) - y(0)).toBeLessThan(0.02);
  expect(y(60) - y(59)).toBeLessThan(0.02);
  expect(INTRO_PACING.arrival * INTRO_READING_UNIT_MS).toBeGreaterThanOrEqual(1000);
});

test("observes from C's left side and straightens before entering A without a right-side pass", () => {
  const frames = cameraFrames(352, 448);
  const left = frames.filter((frame) => (eye(frame)[0] ?? 0) < -500);
  expect(left.length).toBeGreaterThan(3);
  expect(
    left.some(
      (frame) => Number(String(frame.transform).match(/rotateY\(([-\d.e+]+)rad\)/)?.[1]) > 0.25,
    ),
  ).toBe(true);
  const approach = frames.filter((frame) => {
    const z = eye(frame)[2] ?? 0;
    return z > -72 && z < 200;
  });
  expect(approach.length).toBeGreaterThan(3);
  for (const frame of approach) {
    const yaw = Number(String(frame.transform).match(/rotateY\(([-\d.e+]+)rad\)/)?.[1]);
    expect(Math.abs(yaw)).toBeLessThan(0.05);
    expect(eye(frame)[0]).toBeLessThanOrEqual(JOURNEY.roadX);
  }
});

test("the road starts during the close approach and then extends ahead of the moving eye", () => {
  for (const frame of cameraFrames(352, 448)) {
    const z = eye(frame)[2] ?? 0;
    const growth = roadGrowth(z);
    if (z >= JOURNEY.roadRevealStart) expect(growth).toBe(0);
    if (z > 0 && z < 300) expect(growth).toBeGreaterThan(0);
    if (z < -1100 && growth < 1) {
      const end = JOURNEY.roadStart - growth * (JOURNEY.depth + JOURNEY.roadStart);
      expect(z - end).toBeCloseTo(JOURNEY.roadLookAhead, 6);
    }
  }
});

test("road cruise stays below the sign-reading speed budget without stopping", () => {
  const positions = cameraFrames(352, 448).map(eye);
  const frameSeconds =
    (INTRO_PACING.journey * INTRO_READING_UNIT_MS) / 1000 / (positions.length - 1);
  for (let index = 1; index < positions.length; index++) {
    const from = positions[index - 1]?.[2] ?? 0,
      to = positions[index]?.[2] ?? 0;
    if (from > -3000 || to < -JOURNEY.depth + JOURNEY.perspective * 3.2) continue;
    const speed = (from - to) / frameSeconds;
    expect(speed).toBeGreaterThan(1000);
    expect(speed).toBeLessThan(3600);
  }
});
