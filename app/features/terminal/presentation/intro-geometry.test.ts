import { expect, test } from "bun:test";
import {
  ARRIVAL_ENTRY,
  ARRIVAL_FRAMES,
  arrivalOpacity,
  entryGrowth,
  JOURNEY,
  JOURNEY_STATIONS,
  roadBend,
  roadGrowth,
  sceneryOpacity,
  skylineOpacity,
} from "./intro-geometry";

test("both entrance frames stay lit while passing them and switch off after entry", () => {
  expect(arrivalOpacity(ARRIVAL_FRAMES[0] + 1800)).toBe(0);
  for (const z of ARRIVAL_FRAMES) expect(arrivalOpacity(z)).toBeGreaterThan(0.95);
  expect(arrivalOpacity(ARRIVAL_ENTRY.back)).toBeGreaterThan(0.95);
  expect(arrivalOpacity(ARRIVAL_ENTRY.back - ARRIVAL_ENTRY.height * 3)).toBe(0);
});

test("CA and the early road cannot expose the future auditorium", () => {
  for (const z of [4800, 900, 0, -2300, -6100, -6500]) {
    expect(entryGrowth(z)).toBe(0);
  }
});

test("arrival geometry unfolds smoothly while approaching the frames", () => {
  let previous = 0;
  for (let z = ARRIVAL_ENTRY.assemblyStart; z >= ARRIVAL_ENTRY.assemblyEnd; z -= 2) {
    const growth = entryGrowth(z);
    expect(growth).toBeGreaterThanOrEqual(previous);
    expect(growth - previous).toBeLessThan(0.005);
    previous = growth;
  }
  expect(previous).toBe(1);
});

test("the auditorium is already present on approach to the first arrival frame", () => {
  expect(entryGrowth(ARRIVAL_FRAMES[0] + 1)).toBe(1);
});

test("the skyline appears after the portal and fades continuously before terminal arrival", () => {
  expect(skylineOpacity(600)).toBe(0);
  expect(skylineOpacity(-1000)).toBe(1);
  expect(skylineOpacity(-JOURNEY.depth)).toBe(0);
  let previous = 1;
  for (let z = ARRIVAL_FRAMES[0]; z >= -JOURNEY.depth; z -= 10) {
    const alpha = skylineOpacity(z);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(previous);
    expect(previous - alpha).toBeLessThan(0.006);
    previous = alpha;
  }
});

test("the broad level arc joins both straight sections without a position or slope jump", () => {
  for (const z of [-1400, ARRIVAL_ENTRY.assemblyEnd]) {
    const before = roadBend(z - 1),
      at = roadBend(z),
      after = roadBend(z + 1);
    for (const key of ["x", "y", "roll"] as const) {
      expect(Math.abs(at[key])).toBeLessThan(1e-8);
      expect(Math.abs(after[key] - before[key])).toBeLessThan(1e-8);
      expect(Math.abs(after[key] - 2 * at[key] + before[key])).toBeLessThan(1e-8);
    }
  }
  for (let z = JOURNEY.roadStart; z >= JOURNEY.roadEnd; z -= 50) {
    const bend = roadBend(z);
    expect(bend.x).toBeGreaterThanOrEqual(0);
    expect(bend.y).toBe(0);
    expect(bend.roll).toBe(0);
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
