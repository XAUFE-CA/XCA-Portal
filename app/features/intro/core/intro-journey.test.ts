import { expect, test } from "bun:test";
import { INTRO_READING_UNIT_MS } from "../../../utils/motion";
import { AUDITORIUM, AUDITORIUM_OBJECTS } from "./intro-auditorium";
import { ARRIVAL_ENTRY, entryGrowth, JOURNEY, roadBend, roadGrowth } from "./intro-geometry";
import { cameraFrames, terminalDockFrames, terminalFrames } from "./intro-journey";
import { INTRO_HANDOFF, INTRO_PACING } from "./timing";

function eye(frame: Keyframe): number[] {
  const match = String(frame.transform).match(
    /translate3d\(([-\d.e+]+)px, ([-\d.e+]+)px, ([-\d.e+]+)px\)/,
  );
  if (!match) throw new Error("Camera translation missing");
  return match.slice(1).map((value) => -Number(value));
}

function matrix(frame: Keyframe): number[] {
  const match = String(frame.transform).match(/^matrix3d\(([^)]+)\)$/);
  if (!match?.[1]) throw new Error("Missing terminal projection matrix");
  return match[1].split(",").map(Number);
}

function angle(frame: Keyframe, axis: string): number {
  return Number(
    String(frame.transform).match(new RegExp(`rotate${axis}\\(([-\\d.e+]+)rad\\)`))?.[1],
  );
}

function project(frame: Keyframe, point: readonly [number, number, number]) {
  const [ex = 0, ey = 0, ez = 0] = eye(frame);
  const yaw = angle(frame, "Y"),
    pitch = angle(frame, "X"),
    roll = angle(frame, "Z");
  const x = point[0] - ex,
    y = point[1] - ey,
    z = point[2] - ez;
  const rx = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const rz = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  const ry = Math.cos(pitch) * y - Math.sin(pitch) * rz;
  const depth = -(Math.sin(pitch) * y + Math.cos(pitch) * rz);
  return {
    x: ((Math.cos(roll) * rx - Math.sin(roll) * ry) * JOURNEY.perspective) / depth,
    y: ((Math.sin(roll) * rx + Math.cos(roll) * ry) * JOURNEY.perspective) / depth,
    depth,
  };
}

function screenPoint(frame: Keyframe, x: number, y: number) {
  const values = matrix(frame);
  const w = (values[3] ?? 0) * x + (values[7] ?? 0) * y + (values[15] ?? 0);
  return {
    x: ((values[0] ?? 0) * x + (values[4] ?? 0) * y + (values[12] ?? 0)) / w,
    y: ((values[1] ?? 0) * x + (values[5] ?? 0) * y + (values[13] ?? 0)) / w,
  };
}

const centered = { x: 30, y: 60, scale: 0.8 };

test("road travel preserves the original terminal-height viewpoint and curve look-ahead", () => {
  for (const height of [448, 512, 1440]) {
    const y = JOURNEY.floorY - height / 2 - 80;
    for (const frame of cameraFrames(352, height)) {
      const [x = 0, ey = 0, z = 0] = eye(frame);
      if (z > -6100 || entryGrowth(z) > 0) continue;
      expect(x - roadBend(z).x).toBeCloseTo(JOURNEY.roadX, 5);
      expect(ey).toBeCloseTo(y, 5);
      const ahead = roadBend(z - 1100);
      const view = project(frame, [JOURNEY.roadX + ahead.x, y + ahead.y, z - 1100]);
      expect(view.x).toBeCloseTo(0, 6);
      expect(view.y).toBeCloseTo(0, 6);
    }
  }
});

test("the camera rises through the hall to screen-centre height without pitching", () => {
  for (const height of [448, 1440]) {
    const frames = cameraFrames(352, height);
    const entered = frames.find(
      (frame) => (eye(frame)[2] ?? 0) < ARRIVAL_ENTRY.back - JOURNEY.near * 2,
    );
    const launch = frames.find((frame) => frame.offset === INTRO_HANDOFF.start);
    const settled = frames.find((frame) => frame.offset === INTRO_HANDOFF.boot);
    if (!entered || !launch || !settled) throw new Error("Missing hall camera boundaries");
    expect(eye(settled)[1]).toBeCloseTo(AUDITORIUM.screen.y, 7);
    expect(eye(launch)[1]).toBeLessThan(eye(entered)[1] ?? 0);
    expect(eye(launch)[1]).toBeGreaterThan(AUDITORIUM.screen.y);
    const centre = project(settled, [
      AUDITORIUM.screen.x,
      AUDITORIUM.screen.y,
      AUDITORIUM.screen.z,
    ]);
    expect(centre.x).toBeCloseTo(0, 7);
    expect(centre.y).toBeCloseTo(0, 7);
    for (let index = 1; index < frames.length; index++) {
      const frame = frames[index],
        before = frames[index - 1];
      if (!frame || !before || Number(before.offset) < Number(entered.offset)) continue;
      const y = eye(frame)[1] ?? 0,
        previous = eye(before)[1] ?? 0;
      expect(y).toBeLessThanOrEqual(previous + 1e-7);
      expect(angle(frame, "X")).toBeCloseTo(0, 7);
      const seconds =
        ((Number(frame.offset) - Number(before.offset)) *
          INTRO_PACING.journey *
          INTRO_READING_UNIT_MS) /
        1000;
      expect((previous - y) / seconds).toBeLessThan(1000);
    }
  }
});

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

for (const [width, height] of [
  [1040, 448],
  [342, 512],
  [960, 1440],
] as const) {
  test(`the ${width}×${height} terminal is a stage-mounted glass screen before handoff`, () => {
    const frames = terminalFrames(352, width, height, centered);
    const camera = cameraFrames(352, height * centered.scale);
    const screen = AUDITORIUM.screen;
    for (const pose of camera) {
      const [x = 0, y = 0, z = 0] = eye(pose);
      const frame = frames.find((value) => value.offset === pose.offset);
      if (!frame) throw new Error("Missing synchronized screen frame");
      if (z >= ARRIVAL_ENTRY.assemblyEnd) expect(frame.opacity).toBe(0);
      if (Number(frame.opacity) === 0 || Number(frame.offset) >= INTRO_HANDOFF.start) continue;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const world = [
            screen.x + (sx * screen.width) / 2,
            screen.y + (sy * screen.height) / 2,
            screen.z,
          ] as const;
          const expected = project(pose, world);
          const actual = screenPoint(frame, (sx * width) / 2, (sy * height) / 2);
          expect(actual.x).toBeCloseTo(centered.x + expected.x, 7);
          expect(actual.y).toBeCloseTo(centered.y + expected.y, 7);
          for (const portalZ of [ARRIVAL_ENTRY.front, ARRIVAL_ENTRY.back]) {
            if (z <= portalZ) continue;
            const along = (portalZ - z) / (screen.z - z);
            const rayX = x + (world[0] - x) * along;
            const rayY = y + (world[1] - y) * along;
            expect(Math.abs(rayX - JOURNEY.roadX)).toBeLessThan(ARRIVAL_ENTRY.width / 2);
            expect(rayY).toBeGreaterThan(JOURNEY.floorY - ARRIVAL_ENTRY.height);
            expect(rayY).toBeLessThan(JOURNEY.floorY);
          }
        }
      }
    }
  });

  test(`the ${width}×${height} screen reaches native terminal geometry before boot`, () => {
    const frames = terminalFrames(352, width, height, centered);
    const boot = frames.filter((frame) => Number(frame.offset) >= INTRO_HANDOFF.boot);
    for (const frame of boot) {
      const values = matrix(frame);
      expect(frame.opacity).toBe(1);
      expect(values[0]).toBeCloseTo(0.8, 8);
      expect(values[5]).toBeCloseTo(0.8, 8);
      expect(values[12]).toBeCloseTo(30, 8);
      expect(values[13]).toBeCloseTo(60, 8);
      expect(values[3]).toBe(0);
      expect(values[7]).toBe(0);
    }
  });
}

test("interpolated glass visibility stays within the portal and completes before crossing it", () => {
  const camera = cameraFrames(352, 448 * centered.scale);
  const frames = terminalFrames(352, 1040, 448, centered);
  for (const [z, opacity] of [
    [ARRIVAL_ENTRY.assemblyEnd, 0],
    [ARRIVAL_ENTRY.front, 1],
  ] as const) {
    const index = camera.findIndex((pose) => (eye(pose)[2] ?? 0) <= z);
    const before = camera[index - 1];
    const after = camera[index];
    if (!before || !after) throw new Error("Missing portal crossing");
    const from = eye(before)[2] ?? 0;
    const to = eye(after)[2] ?? 0;
    const fraction = (z - from) / (to - from);
    const at = Number(before.offset) + (Number(after.offset) - Number(before.offset)) * fraction;
    const end = frames.findIndex((frame) => Number(frame.offset) >= at);
    const first = frames[end - 1];
    const last = frames[end];
    if (!first || !last) throw new Error("Missing glass crossing");
    const blend = (at - Number(first.offset)) / (Number(last.offset) - Number(first.offset));
    const actual = Number(first.opacity) + (Number(last.opacity) - Number(first.opacity)) * blend;
    expect(actual).toBeCloseTo(opacity, 8);
  }
});

test("screen shrink overlaps the continuing ascent after clearing the seats", () => {
  const camera = cameraFrames(352, 448 * centered.scale);
  const frames = terminalFrames(352, 1040, 448, centered);
  const launch = frames.find((frame) => frame.offset === INTRO_HANDOFF.start);
  const launchCamera = camera.find((frame) => frame.offset === INTRO_HANDOFF.start);
  if (!launch || !launchCamera) throw new Error("Missing handoff boundary");
  const launchWidth = screenPoint(launch, 520, 224).x - screenPoint(launch, -520, 224).x;
  const nearestSeat = Math.min(
    ...AUDITORIUM_OBJECTS.filter(
      (object) => object.id.startsWith("seat.") || object.id.startsWith("tier."),
    ).map((object) => object.origin[2] - object.size[2]),
  );
  expect(eye(launchCamera)[2]).toBeLessThan(nearestSeat - JOURNEY.near * 2);
  let previousWidth = launchWidth;
  for (const pose of camera) {
    const at = Number(pose.offset);
    if (at < INTRO_HANDOFF.start || at > INTRO_HANDOFF.boot) continue;
    const frame = frames.find((value) => value.offset === pose.offset);
    if (!frame) throw new Error("Missing synchronized screen sample");
    const width = screenPoint(frame, 520, 224).x - screenPoint(frame, -520, 224).x;
    expect(width).toBeLessThanOrEqual(previousWidth + 1e-7);
    expect(eye(pose)[2]).toBeCloseTo(eye(launchCamera)[2] ?? 0, 6);
    previousWidth = width;
    if (at > INTRO_HANDOFF.start && at < INTRO_HANDOFF.boot) {
      expect(eye(pose)[1]).toBeLessThan(eye(launchCamera)[1] ?? 0);
      expect(eye(pose)[1]).toBeGreaterThan(AUDITORIUM.screen.y);
    }
  }
  expect(previousWidth).toBeCloseTo(1040 * centered.scale, 8);
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
  const positions = cameraFrames(352, 448);
  const seconds = (INTRO_PACING.journey * INTRO_READING_UNIT_MS) / 1000;
  for (let index = 1; index < positions.length; index++) {
    const before = positions[index - 1],
      after = positions[index];
    if (!before || !after) throw new Error("Missing camera speed interval");
    const from = eye(before)[2] ?? 0,
      to = eye(after)[2] ?? 0;
    const frameSeconds = (Number(after.offset) - Number(before.offset)) * seconds;
    if (from > -3000 || to < JOURNEY.roadEnd) continue;
    const speed = (from - to) / frameSeconds;
    expect(speed).toBeGreaterThan(1000);
    expect(speed).toBeLessThan(3600);
  }
});

test("the entrance camera keeps near-plane clearance below the roof", () => {
  const roof = AUDITORIUM_OBJECTS.find((object) => object.id === "entry-ceiling");
  const left = AUDITORIUM_OBJECTS.find((object) => object.id === "entry-wall.-1");
  const right = AUDITORIUM_OBJECTS.find((object) => object.id === "entry-wall.1");
  if (!roof || !left || !right) throw new Error("Incomplete entrance geometry");
  const top = roof.origin[1] + roof.size[1] + JOURNEY.near;
  const back = roof.origin[2] - roof.size[2];
  for (const height of [448, 1440]) {
    for (const frame of cameraFrames(352, height)) {
      const [x = 0, y = 0, z = 0] = eye(frame);
      if (z > roof.origin[2] || z < back) continue;
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(JOURNEY.floorY - JOURNEY.near);
      expect(x).toBeGreaterThan(left.origin[0] + left.size[0] + JOURNEY.near);
      expect(x).toBeLessThan(right.origin[0] - JOURNEY.near);
    }
  }
});
