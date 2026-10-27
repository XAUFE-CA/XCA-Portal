import { expect, test } from "bun:test";
import { JOURNEY, JOURNEY_STATIONS, roadGrowth, sceneryOpacity } from "./intro-geometry";

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
