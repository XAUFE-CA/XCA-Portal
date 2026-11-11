import { expect, test } from "bun:test";
import { AUDITORIUM, AUDITORIUM_MATERIAL } from "../core/intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY, JOURNEY_STATIONS, roadBend } from "../core/intro-geometry";
import { CITY_TRAFFIC_SWAY } from "./intro-city-life";
import { createMarkMesh, extrudeContour, roundedPanelContour } from "./intro-mark-mesh";

test("extrusion closes a concave cap without filling its opening", () => {
  const contour = [
    [0, 0],
    [8, 0],
    [8, 2],
    [2, 2],
    [2, 8],
    [0, 8],
  ] as const;
  const mesh = extrudeContour(contour, 72);
  let capArea = 0;
  for (let offset = 0; offset < mesh.length; offset += 21) {
    const triangle = [0, 7, 14].map((vertex) => mesh.slice(offset + vertex, offset + vertex + 7));
    if (!triangle.every((vertex) => vertex[2] === 0)) continue;
    const [a, b, c] = triangle;
    if (!a || !b || !c) throw new Error("Incomplete triangle");
    capArea +=
      Math.abs(
        ((b[0] ?? 0) - (a[0] ?? 0)) * ((c[1] ?? 0) - (a[1] ?? 0)) -
          ((b[1] ?? 0) - (a[1] ?? 0)) * ((c[0] ?? 0) - (a[0] ?? 0)),
      ) / 2;
  }
  expect(capArea).toBeCloseTo(28, 6);
});

test("side walls span the entire depth without intermediate SVG slices", () => {
  const mesh = extrudeContour(
    [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ],
    72,
  );
  const sideTriangles: number[][] = [];
  for (let offset = 0; offset < mesh.length; offset += 21) {
    const depths = [mesh[offset + 2] ?? 0, mesh[offset + 9] ?? 0, mesh[offset + 16] ?? 0];
    if (new Set(depths).size > 1) sideTriangles.push(depths);
  }
  expect(sideTriangles).toHaveLength(8);
  for (const depths of sideTriangles) {
    expect(Math.min(...depths)).toBe(-72);
    expect(Math.max(...depths)).toBe(0);
  }
  expect([...mesh].every(Number.isFinite)).toBe(true);
});

test("reversing the source winding preserves the solid", () => {
  const contour = [
    [0, 0],
    [12, 0],
    [12, 8],
    [0, 8],
  ] as const;
  const forward = extrudeContour(contour, 72);
  const reverse = extrudeContour([...contour].reverse(), 72);
  expect(reverse.length).toBe(forward.length);
  expect(extrudeContour([], 72).length).toBe(0);
});

test("the road is a separate slab behind A, with no crossbar extension or etched geometry", () => {
  const mesh = createMarkMesh([], 16);
  let roadVertices = 0,
    supportVertices = 0;
  for (let offset = 0; offset < mesh.length; offset += 7) {
    const y = mesh[offset + 1],
      z = mesh[offset + 2];
    if (y === undefined || z === undefined) throw new Error("Incomplete road vertex");
    if (mesh[offset + 6] === 1) {
      roadVertices++;
      const localY = y - roadBend(z).y;
      expect(localY).toBeGreaterThanOrEqual(JOURNEY.floorY);
      expect(localY).toBeLessThanOrEqual(JOURNEY.floorY + 28);
      expect(z).toBeLessThanOrEqual(JOURNEY.roadStart);
      expect(z).toBeGreaterThanOrEqual(JOURNEY.roadEnd);
      const edgeDistance = Math.abs((mesh[offset] ?? 0) - roadBend(z).x - JOURNEY.roadX);
      expect(edgeDistance).toBeGreaterThanOrEqual(JOURNEY.roadWidth / 2 - 8.001);
      expect(edgeDistance).toBeLessThanOrEqual(JOURNEY.roadWidth / 2 + 0.001);
    } else {
      supportVertices++;
      const station = JOURNEY_STATIONS.find((item) => Math.abs(item.depth - z) <= 110);
      const bend = roadBend(station?.depth ?? z);
      const x = (mesh[offset] ?? 0) - bend.x;
      if (
        (mesh[offset + 6] ?? 0) < 4.5 &&
        y - bend.y >= JOURNEY.floorY - 50 &&
        y - bend.y < JOURNEY.floorY
      )
        expect(Math.abs(x - JOURNEY.roadX)).toBeGreaterThanOrEqual(JOURNEY.roadWidth / 2 - 0.001);
    }
  }
  expect(roadVertices / 3).toBeGreaterThan(1000);
  expect(supportVertices).toBeGreaterThan(0);
  expect([...mesh].every(Number.isFinite)).toBe(true);
  for (let offset = 0; offset < mesh.length; offset += 7) {
    expect(
      Math.hypot(mesh[offset + 3] ?? 0, mesh[offset + 4] ?? 0, mesh[offset + 5] ?? 0),
    ).toBeCloseTo(1, 5);
  }
});

test("sign housing follows the same corner radius as its content face", () => {
  const points = roundedPanelContour(600, 340, 16);
  expect(points.length).toBeGreaterThan(4);
  for (const [x, y] of points) {
    const centerX = x < 300 ? 16 : 584;
    const centerY = y < 170 ? 16 : 324;
    expect(Math.hypot(x - centerX, y - centerY)).toBeCloseTo(16, 8);
  }
  const body = extrudeContour(points, 48);
  expect([...body].every(Number.isFinite)).toBe(true);
  for (let offset = 0; offset < body.length; offset += 7) {
    const x = body[offset] ?? 0,
      y = body[offset + 1] ?? 0;
    expect((x === 0 || x === 600) && (y === 0 || y === 340)).toBe(false);
  }
});

test("city buildings clear the finite road and keep the central skyline behind the auditorium", () => {
  const mesh = createMarkMesh([], 16);
  let count = 0;
  for (let offset = 0; offset < mesh.length; offset += 21) {
    const material = mesh[offset + 6] ?? 0;
    if (material <= 4.5 || material >= 8.5 || material === 7) continue;
    count += 3;
    if (material >= 5.5 && material !== 8) continue;
    const xs = [0, 7, 14].map((at) => (mesh[offset + at] ?? 0) - JOURNEY.roadX);
    const zs = [0, 7, 14].map((at) => mesh[offset + at + 2] ?? 0);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      back = Math.min(...zs),
      front = Math.max(...zs);
    expect(
      right <= -JOURNEY.roadWidth / 2 - 140 ||
        left >= JOURNEY.roadWidth / 2 + 140 ||
        front <= JOURNEY.roadEnd ||
        back >= JOURNEY.roadStart,
    ).toBe(true);
    // Entire central triangles must stay behind the room, not merely their individual corners.
    // 中央三角形整体必须位于报告厅后方，不能仅凭各顶点在通道外侧判断。
    if (material === 8 && left < AUDITORIUM.halfWidth && right > -AUDITORIUM.halfWidth)
      expect(front).toBeLessThanOrEqual(AUDITORIUM.back - 1800);
  }
  // Buildings and street furniture stay below twenty thousand triangles.
  // 楼宇与街道设施保持少于两万个三角形。
  expect(count).toBeLessThan(60000);
});

test("the horizon stays filled above the road with gaps between clusters during approach", () => {
  const mesh = createMarkMesh([], 16);
  const facades: { left: number; right: number; z: number; top: number }[] = [];
  for (let offset = 0; offset < mesh.length; offset += 21) {
    if (mesh[offset + 6] !== 8 || (mesh[offset + 5] ?? 0) < 0.9) continue;
    facades.push({
      left: Math.min(...[0, 7, 14].map((at) => mesh[offset + at] ?? 0)) - JOURNEY.roadX,
      right: Math.max(...[0, 7, 14].map((at) => mesh[offset + at] ?? 0)) - JOURNEY.roadX,
      z: mesh[offset + 2] ?? 0,
      top: Math.min(...[0, 7, 14].map((at) => mesh[offset + at + 1] ?? 0)),
    });
  }
  for (const eyeZ of [-1000, -6000, -10000]) {
    // Sample fixed rays on a reference plane, so apparent gaps survive camera movement.
    // 在参考平面上采样固定视线，确保镜头推进后仍有可见的天际线间隙。
    const elevation = (x: number) => {
      const slope = x / (eyeZ - (AUDITORIUM.back - 5000));
      return Math.max(
        0,
        ...facades.map(({ left, right, z, top }) => {
          const distance = eyeZ - z;
          const at = slope * distance;
          return distance > 0 && at >= left && at <= right ? (JOURNEY.floorY - top) / distance : 0;
        }),
      );
    };
    const left = elevation(-3400),
      center = elevation(0),
      right = elevation(4250);
    expect(Math.min(left, center, right)).toBeGreaterThan(0.14);
    expect(elevation(-950)).toBeLessThan(Math.min(left, right) * 0.65);
  }
});

test("forward horizon advertisements occupy mounted middle facades, not only crowns", () => {
  const mesh = createMarkMesh([], 16);
  const walls: { x: number; y: number; z: number }[] = [];
  const screens: { x: number; y: number; z: number }[] = [];
  for (let offset = 0; offset < mesh.length; offset += 7) {
    const x = mesh[offset] ?? 0;
    const y = mesh[offset + 1] ?? 0;
    const z = mesh[offset + 2] ?? 0;
    if (z > AUDITORIUM.back - 1800) continue;
    if ((mesh[offset + 5] ?? 0) < 0.9) continue;
    if (mesh[offset + 6] === 8) walls.push({ x, y, z });
    if (Math.abs(x - JOURNEY.roadX) <= 3300 && Math.abs((mesh[offset + 6] ?? 0) - 8.2) < 0.001)
      screens.push({ x, y, z });
  }
  for (const side of [-1, 1]) {
    expect(screens.some(({ x, y }) => (x - JOURNEY.roadX) * side > 0 && y > -3000)).toBe(true);
  }
  for (const screen of screens) {
    const wall = walls.filter(({ z }) => Math.abs(z + 40 - screen.z) < 0.01);
    expect(screen.x).toBeGreaterThanOrEqual(Math.min(...wall.map(({ x }) => x)));
    expect(screen.x).toBeLessThanOrEqual(Math.max(...wall.map(({ x }) => x)));
    expect(screen.y).toBeGreaterThan(Math.min(...wall.map(({ y }) => y)));
    expect(screen.y).toBeLessThan(Math.max(...wall.map(({ y }) => y)));
  }
});

test("moving traffic stays grounded inside real street lanes for its entire excursion", () => {
  const mesh = createMarkMesh([], 16);
  for (let offset = 0; offset < mesh.length; offset += 7) {
    if (Math.abs((mesh[offset + 6] ?? 0) - 8.4) > 0.001) continue;
    const x = Math.abs((mesh[offset] ?? 0) - JOURNEY.roadX);
    const y = mesh[offset + 1] ?? 0;
    const z = mesh[offset + 2] ?? 0;
    const lane = 3500 + Math.round((x - 3500) / 3000) * 3000;
    const rowCenter = -2000 + Math.round((z + 2000) / 3200) * 3200;
    expect(x - lane).toBeGreaterThanOrEqual(54);
    expect(x - lane).toBeLessThanOrEqual(150);
    expect(Math.abs(z - rowCenter) + CITY_TRAFFIC_SWAY).toBeLessThan(1390);
    expect(y).toBeGreaterThanOrEqual(JOURNEY.floorY + JOURNEY.cityDrop - 75);
    expect(y).toBeLessThanOrEqual(JOURNEY.floorY + JOURNEY.cityDrop + 2);
  }
});

test("near-road cafe groups fit supported low roofs without entering the bridge corridor", () => {
  const mesh = createMarkMesh([], 16);
  const roofs: { left: number; right: number; back: number; front: number; y: number }[] = [];
  for (let offset = 0; offset < mesh.length; offset += 21) {
    if (mesh[offset + 6] !== 5 || (mesh[offset + 4] ?? 0) > -0.9) continue;
    const xs = [0, 7, 14].map((at) => mesh[offset + at] ?? 0);
    const zs = [0, 7, 14].map((at) => mesh[offset + at + 2] ?? 0);
    roofs.push({
      left: Math.min(...xs),
      right: Math.max(...xs),
      back: Math.min(...zs),
      front: Math.max(...zs),
      y: mesh[offset + 1] ?? 0,
    });
  }
  for (let offset = 0; offset < mesh.length; offset += 7) {
    if (Math.abs((mesh[offset + 6] ?? 0) - 8.1) > 0.001) continue;
    const x = mesh[offset] ?? 0;
    const y = mesh[offset + 1] ?? 0;
    const z = mesh[offset + 2] ?? 0;
    if (y > JOURNEY.floorY + JOURNEY.cityDrop - 300) continue;
    expect(Math.abs(x - JOURNEY.roadX)).toBeGreaterThan(JOURNEY.roadWidth / 2 + 140);
    expect(
      roofs.some(
        (roof) =>
          x >= roof.left &&
          x <= roof.right &&
          z >= roof.back &&
          z <= roof.front &&
          y <= roof.y &&
          y >= roof.y - 250,
      ),
    ).toBe(true);
  }
});

test("the viaduct crosses between visible lower roofs and taller towers", () => {
  const mesh = createMarkMesh([], 16);
  let lowerRoofs = 0,
    tallerRoofs = 0,
    piers = 0;
  for (let offset = 0; offset < mesh.length; offset += 7) {
    const y = mesh[offset + 1] ?? 0;
    if (mesh[offset + 6] === 5 && (mesh[offset + 4] ?? 0) < -0.5) {
      if (y > JOURNEY.floorY + 250) lowerRoofs++;
      if (y < JOURNEY.floorY - 250) tallerRoofs++;
    }
    if (mesh[offset + 6] === 2 && y === JOURNEY.floorY + JOURNEY.cityDrop) piers++;
  }
  expect(lowerRoofs).toBeGreaterThan(30);
  expect(tallerRoofs).toBeGreaterThan(30);
  expect(piers).toBeGreaterThan(30);
});

test("every sign footing has a solid outrigger reaching into the curved bridge deck", () => {
  const mesh = createMarkMesh([], 16);
  for (const station of JOURNEY_STATIONS.filter((item) => item.hasPanel)) {
    const leg = station.left + (station.side < 0 ? 92 : station.width - 126);
    const bend = roadBend(station.depth).x;
    const edge = JOURNEY.roadX + (station.side * JOURNEY.roadWidth) / 2 + bend;
    const footing = leg + 17 + bend;
    let connected = false;
    for (let offset = 0; offset < mesh.length; offset += 21) {
      const triangle = [0, 7, 14].map((vertex) => mesh.slice(offset + vertex, offset + vertex + 7));
      if (
        !triangle.every(
          (vertex) =>
            vertex[6] === 2 &&
            Math.abs((vertex[1] ?? 0) - JOURNEY.floorY - JOURNEY.bearingInset) < 0.001 &&
            Math.abs((vertex[2] ?? 0) - station.depth) <= 43,
        )
      )
        continue;
      const xs = triangle.map((vertex) => vertex[0] ?? 0);
      const minimum = Math.min(...xs),
        maximum = Math.max(...xs);
      if (minimum <= Math.min(edge, footing) && maximum >= Math.max(edge, footing))
        connected = true;
    }
    expect(connected).toBe(true);
  }
});

test("bridge supports do not overlap the driving surface with coplanar top faces", () => {
  const mesh = createMarkMesh([], 16);
  let coplanarFaces = 0;
  for (let offset = 0; offset < mesh.length; offset += 21) {
    if (mesh[offset + 6] !== 2) continue;
    const triangle = [0, 7, 14].map((vertex) => mesh.slice(offset + vertex, offset + vertex + 3));
    if (!triangle.every((vertex) => Math.abs((vertex[1] ?? 0) - JOURNEY.floorY) < 0.001)) continue;
    const xs = triangle.map(
      (vertex) => (vertex[0] ?? 0) - roadBend(vertex[2] ?? 0).x - JOURNEY.roadX,
    );
    const zs = triangle.map((vertex) => vertex[2] ?? 0);
    const area = Math.abs(
      ((xs[1] ?? 0) - (xs[0] ?? 0)) * ((zs[2] ?? 0) - (zs[0] ?? 0)) -
        ((xs[2] ?? 0) - (xs[0] ?? 0)) * ((zs[1] ?? 0) - (zs[0] ?? 0)),
    );
    if (
      area > 1 &&
      Math.min(...xs) < JOURNEY.roadWidth / 2 - 8 &&
      Math.max(...xs) > -JOURNEY.roadWidth / 2 + 8
    )
      coplanarFaces++;
  }
  expect(coplanarFaces).toBe(0);
});

test("the bridge and tiered central aisle form a continuous route without oversized drops", () => {
  const mesh = createMarkMesh([], 16);
  type Point = readonly [number, number];
  const floors: { points: [Point, Point, Point]; height: number }[] = [];
  const cross = (a: Point, b: Point, x: number, z: number) =>
    (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
  for (let offset = 0; offset < mesh.length; offset += 21) {
    if (
      mesh[offset + 4] !== -1 ||
      ![
        1,
        AUDITORIUM_MATERIAL.ground,
        AUDITORIUM_MATERIAL.carpet,
        AUDITORIUM_MATERIAL.connection,
      ].includes(mesh[offset + 6] ?? 0)
    )
      continue;
    const points = [0, 7, 14].map(
      (at) => [mesh[offset + at] ?? 0, mesh[offset + at + 2] ?? 0] as const,
    );
    const [a, b, c] = points;
    if (a && b && c && Math.abs(cross(a, b, c[0], c[1])) > 0.01)
      floors.push({ points: [a, b, c], height: mesh[offset + 1] ?? 0 });
  }
  let previous: number = JOURNEY.floorY;
  for (let z = JOURNEY.roadStart - 10; z >= -JOURNEY.depth + JOURNEY.perspective; z -= 37) {
    const x = JOURNEY.roadX + roadBend(z).x;
    const heights = floors
      .filter(({ points: [a, b, c] }) => {
        const signs = [cross(a, b, x, z), cross(b, c, x, z), cross(c, a, x, z)];
        return signs.every((value) => value >= -0.001) || signs.every((value) => value <= 0.001);
      })
      .map((floor) => floor.height);
    const height = Math.min(...heights);
    expect(Number.isFinite(height), `Missing floor at ${z}`).toBe(true);
    expect(height - previous).toBeGreaterThanOrEqual(-0.001);
    expect(height - previous).toBeLessThanOrEqual(38.001);
    previous = height;
  }
  expect(previous).toBe(AUDITORIUM.floorY);
});

test("the entrance cutout meets both bridge edges throughout the connection", () => {
  const mesh = createMarkMesh([], 16);
  for (const z of [
    ARRIVAL_ENTRY.front - 1,
    (ARRIVAL_ENTRY.front + JOURNEY.roadEnd) / 2,
    JOURNEY.roadEnd + 1,
  ]) {
    const road: number[] = [];
    const shoulder: number[] = [];
    for (let offset = 0; offset < mesh.length; offset += 21) {
      const material = mesh[offset + 6];
      if (material !== 1 && material !== AUDITORIUM_MATERIAL.connection) continue;
      const section = material === 1 ? road : shoulder;
      for (const [a, b] of [
        [0, 7],
        [7, 14],
        [14, 0],
      ] as const) {
        const ax = mesh[offset + a] ?? 0;
        const az = mesh[offset + a + 2] ?? 0;
        const bx = mesh[offset + b] ?? 0;
        const bz = mesh[offset + b + 2] ?? 0;
        if (az === bz || z < Math.min(az, bz) || z > Math.max(az, bz)) continue;
        section.push(ax + ((bx - ax) * (z - az)) / (bz - az));
      }
    }
    const left = shoulder.filter((x) => x < JOURNEY.roadX);
    const right = shoulder.filter((x) => x > JOURNEY.roadX);
    expect(Math.max(...left)).toBeCloseTo(Math.min(...road), 3);
    expect(Math.min(...right)).toBeCloseTo(Math.max(...road), 3);
  }
});
