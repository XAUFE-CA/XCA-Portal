import { expect, test } from "bun:test";
import {
  arrivalOpacity,
  JOURNEY,
  JOURNEY_STATIONS,
  roadBend,
  roadGrowth,
  sceneryOpacity,
  skylineOpacity,
} from "./intro-geometry";

test("destination cues precede terminal visibility and dissolve before the camera arrives", () => {
  expect(arrivalOpacity(-6500)).toBe(0);
  expect(arrivalOpacity(-8500)).toBe(1);
  expect(arrivalOpacity(-9820)).toBe(1);
  expect(arrivalOpacity(-11000)).toBeCloseTo(0.5, 6);
  expect(arrivalOpacity(-12100)).toBe(0);
});

test("the skyline appears after the portal and fades continuously before terminal arrival", () => {
  expect(skylineOpacity(600)).toBe(0);
  expect(skylineOpacity(-1000)).toBe(1);
  expect(skylineOpacity(-8200)).toBe(1);
  expect(skylineOpacity(-11700)).toBe(0);
  let previous = 1;
  for (let z = -8200; z >= -14000; z -= 10) {
    const alpha = skylineOpacity(z);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(previous);
    expect(previous - alpha).toBeLessThan(0.006);
    previous = alpha;
  }
});

test("the broad level arc joins both straight sections without a position or slope jump", () => {
  for (const z of [-1400, -9800]) {
    const before = roadBend(z - 1),
      at = roadBend(z),
      after = roadBend(z + 1);
    for (const key of ["x", "y", "roll"] as const) {
      expect(Math.abs(at[key])).toBeLessThan(1e-8);
      expect(Math.abs(after[key] - before[key])).toBeLessThan(1e-8);
      expect(Math.abs(after[key] - 2 * at[key] + before[key])).toBeLessThan(1e-8);
    }
  }
  expect(roadBend(-5600).x).toBe(340);
  for (let z = -1400; z >= -9800; z -= 50) {
    const bend = roadBend(z);
    expect(bend.x).toBeGreaterThanOrEqual(0);
    expect(bend.y).toBe(0);
    expect(bend.roll).toBe(0);
    expect(Math.abs(roadBend(z + 1).x - bend.x)).toBeLessThan(0.17);
  }
});

test("the road starts forming while approaching A's opening, before crossing the mark", () => {
  for (const z of [4000, 1600, 900]) expect(roadGrowth(z)).toBe(0);
  expect(roadGrowth(300)).toBeGreaterThan(0.02);
  expect(roadGrowth(0)).toBeGreaterThan(roadGrowth(300));
  expect(JOURNEY.roadStart).toBeLessThan(-JOURNEY.bodyDepth);
});

test("the road front keeps its lead while matching camera speed", () => {
  const end = (eyeZ: number) =>
    JOURNEY.roadStart - roadGrowth(eyeZ) * (JOURNEY.depth + JOURNEY.roadStart);
  for (const z of [-1100, -2500, -4000, -6000]) {
    expect(z - end(z)).toBeCloseTo(JOURNEY.roadLookAhead, 6);
    expect(end(z - 100) - end(z)).toBeCloseTo(-100, 6);
  }
  expect(roadGrowth(-JOURNEY.depth)).toBe(1);
});

test("initial road unfolding takes a full entrance section instead of appearing in one step", () => {
  expect(roadGrowth(500)).toBeLessThan(0.02);
  expect(roadGrowth(0)).toBeLessThan(0.15);
  expect(roadGrowth(-1100)).toBeGreaterThan(0.3);
});

test("signs share the support reveal and reach full opacity before the camera passes", () => {
  expect(JOURNEY_STATIONS.filter((station) => station.hasPanel)).toHaveLength(6);
  for (const station of JOURNEY_STATIONS) {
    expect(sceneryOpacity(0, station.depth)).toBe(0);
    expect(sceneryOpacity(roadGrowth(station.depth + 1500), station.depth)).toBe(1);
  }
});

test("road growth is continuous and monotone through the initial sweep", () => {
  let previous = 0;
  for (let z = JOURNEY.roadRevealStart; z >= -JOURNEY.depth; z -= 4) {
    const growth = roadGrowth(z);
    expect(growth).toBeGreaterThanOrEqual(previous);
    expect(growth - previous).toBeLessThan(0.005);
    previous = growth;
  }
});
