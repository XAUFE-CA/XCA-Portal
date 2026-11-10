import { expect, test } from "bun:test";
import { AUDITORIUM, AUDITORIUM_OBJECTS, type AuditoriumObject } from "./intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY, JOURNEY_STATIONS } from "./intro-geometry";

type Bounds = [number, number, number, number, number, number];
type Point3 = readonly [number, number, number];

function intersectsSegment(start: Point3, end: Point3, box: Bounds): boolean {
  let near = 0;
  let far = 1;
  for (const [axis, low, high] of [
    [0, box[0], box[1]],
    [1, box[2], box[3]],
    [2, box[4], box[5]],
  ] as const) {
    const direction = end[axis] - start[axis];
    if (Math.abs(direction) < 1e-8) {
      if (start[axis] < low || start[axis] > high) return false;
      continue;
    }
    const a = (low - start[axis]) / direction;
    const b = (high - start[axis]) / direction;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return true;
}

function bounds(object: AuditoriumObject): Bounds {
  const [x, y, z] = object.origin;
  const [width, height, depth] = object.size;
  return [x, x + width, y, y + height, z - depth, z];
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.001 &&
    Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > 0.001 &&
    Math.min(a[5], b[5]) - Math.max(a[4], b[4]) > 0.001
  );
}

test("the auditorium entrance leaves every road sign plane outside its solid walls", () => {
  for (const station of JOURNEY_STATIONS.filter((item) => item.hasPanel)) {
    const left = station.left + station.panelLeft;
    const top = station.top + station.panelTop;
    for (const wall of AUDITORIUM_OBJECTS.filter(
      (item) => item.id.startsWith("entry-wall.") || item.id.startsWith("entry-facade."),
    )) {
      const [minX, maxX, minY, maxY, minZ, maxZ] = bounds(wall);
      const intersects =
        station.depth > minZ &&
        station.depth < maxZ &&
        Math.min(left + station.panelWidth, maxX) > Math.max(left, minX) &&
        Math.min(top + station.panelHeight, maxY) > Math.max(top, minY);
      expect(intersects, `Sign ${station.index + 1} intersects ${wall.id}`).toBe(false);
    }
  }
});

test("the central view through the entrance remains open into the auditorium", () => {
  const passage: Bounds = [
    JOURNEY.roadX - ARRIVAL_ENTRY.width / 4,
    JOURNEY.roadX + ARRIVAL_ENTRY.width / 4,
    JOURNEY.floorY - (ARRIVAL_ENTRY.height * 3) / 4,
    JOURNEY.floorY - ARRIVAL_ENTRY.height / 4,
    AUDITORIUM.entrance - 400,
    ARRIVAL_ENTRY.front,
  ];
  const blockers = AUDITORIUM_OBJECTS.filter((object) => overlaps(passage, bounds(object)));
  expect(blockers.map((object) => object.id)).toEqual([]);
});

test("front walls hide the room outside the aperture without closing the opening", () => {
  const x = JOURNEY.roadX;
  const top = JOURNEY.floorY - ARRIVAL_ENTRY.height;
  const half = ARRIVAL_ENTRY.width / 2;
  const centerY = JOURNEY.floorY - ARRIVAL_ENTRY.height / 2;
  const start: Point3 = [x, centerY, ARRIVAL_ENTRY.front + 1200];
  for (const [targetX, targetY, expected] of [
    [x - half - 120, centerY, true],
    [x + half + 120, centerY, true],
    [x - AUDITORIUM.halfWidth + 64, centerY, true],
    [x + AUDITORIUM.halfWidth - 64, centerY, true],
    [x, top - 120, true],
    [x, AUDITORIUM.ceiling + 32, true],
    [x, centerY, false],
    [x - half + 16, top + 16, false],
    [x + half - 16, top + 16, false],
    [x - half + 16, JOURNEY.floorY - 16, false],
    [x + half - 16, JOURNEY.floorY - 16, false],
  ] as const) {
    const target: Point3 = [targetX, targetY, ARRIVAL_ENTRY.front];
    const blocked = AUDITORIUM_OBJECTS.some((object) =>
      intersectsSegment(start, target, bounds(object)),
    );
    expect(blocked, `Entrance sightline (${targetX}, ${targetY})`).toBe(expected);
  }
});

test("the screen has a clear front bay above the seats and inside the surrounding walls", () => {
  const screen = AUDITORIUM.screen;
  const seats = AUDITORIUM_OBJECTS.filter((object) => object.id.startsWith("seat."));
  const highestBack = Math.min(
    ...seats.filter((object) => object.id.endsWith(".back")).map((object) => object.origin[1]),
  );
  const lastSeat = Math.min(...seats.map((object) => object.origin[2] - object.size[2]));
  const seatDepth = Math.max(...seats.map((object) => object.size[2]));
  expect(screen.y + screen.height / 2).toBeLessThan(highestBack - JOURNEY.near * 2);
  expect(screen.y - screen.height / 2 - AUDITORIUM.ceiling).toBeGreaterThan(screen.height * 0.1);
  expect(AUDITORIUM.halfWidth - screen.width / 2).toBeGreaterThan(screen.width * 0.15);
  expect(lastSeat - AUDITORIUM.stageFront).toBeGreaterThan(seatDepth * 6);
  for (const object of AUDITORIUM_OBJECTS.filter(
    (item) => item.id === "lectern-foot" || item.id.startsWith("speaker."),
  )) {
    expect(object.origin[1] + object.size[1]).toBe(AUDITORIUM.stageY);
    expect(object.origin[2]).toBeLessThan(AUDITORIUM.stageFront);
    expect(object.origin[2] - object.size[2]).toBeGreaterThan(AUDITORIUM.back);
  }
});

test("linked rows share supports and every seating terrace descends toward the stage", () => {
  for (const side of [-1, 1]) {
    let previous = JOURNEY.floorY - 76;
    for (let row = 0; row < 10; row++) {
      const tier = AUDITORIUM_OBJECTS.find((object) => object.id === `tier.${side}.${row}`);
      const beam = AUDITORIUM_OBJECTS.find((object) => object.id === `row.${side}.${row}.beam`);
      if (!tier || !beam) throw new Error(`Missing tier or shared beam for ${side}.${row}`);
      expect(tier.origin[1] - previous).toBe(76);
      previous = tier.origin[1];
      const pedestals = AUDITORIUM_OBJECTS.filter((object) =>
        object.id.startsWith(`row.${side}.${row}.pedestal.`),
      );
      for (const pedestal of pedestals) {
        expect(pedestal.origin[1] + pedestal.size[1]).toBe(tier.origin[1] - 3);
        expect(pedestal.origin[1]).toBeLessThan(beam.origin[1] + beam.size[1]);
      }
      for (const back of AUDITORIUM_OBJECTS.filter(
        (object) => object.id.startsWith(`seat.${side}.${row}.`) && object.id.endsWith(".back"),
      )) {
        expect(back.origin[0]).toBeGreaterThan(beam.origin[0]);
        expect(back.origin[0] + back.size[0]).toBeLessThan(beam.origin[0] + beam.size[0]);
      }
    }
  }
});

test("ceiling emitters clear their opaque supports instead of intersecting them", () => {
  for (const emitter of AUDITORIUM_OBJECTS.filter(
    (object) => object.id.startsWith("canopy-inlay.") || object.id.startsWith("ceiling-cove."),
  )) {
    const parts = emitter.id.split(".");
    const supportId = emitter.id.startsWith("canopy-inlay.")
      ? `suspended-canopy.${parts[1]}`
      : `ceiling-rail.${parts[1]}`;
    const support = AUDITORIUM_OBJECTS.find((object) => object.id === supportId);
    if (!support) throw new Error(`Missing support for ${emitter.id}`);
    expect(emitter.origin[1], emitter.id).toBeGreaterThan(support.origin[1] + support.size[1]);
    expect(overlaps(bounds(emitter), bounds(support)), emitter.id).toBe(false);
  }
});

test("the stage and its stairs rest on the room floor without buried faces or suspended treads", () => {
  const floor = AUDITORIUM_OBJECTS.find((object) => object.id === "floor");
  if (!floor) throw new Error("Missing auditorium floor");
  for (const object of AUDITORIUM_OBJECTS.filter(
    (item) => item.id === "stage" || item.id.startsWith("stage-step."),
  )) {
    expect(object.origin[1] + object.size[1], object.id).toBe(AUDITORIUM.floorY);
    expect(overlaps(bounds(object), bounds(floor)), object.id).toBe(false);
  }
  for (const fascia of AUDITORIUM_OBJECTS.filter((object) =>
    object.id.startsWith("stage-fascia."),
  )) {
    expect(fascia.origin[1]).toBeGreaterThan(AUDITORIUM.stageY);
    expect(fascia.origin[1] + fascia.size[1]).toBeLessThan(AUDITORIUM.floorY);
  }
});
