import { expect, test } from "bun:test";
import { JOURNEY } from "./intro-geometry";
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
      expect([JOURNEY.floorY, JOURNEY.floorY + 18]).toContain(y);
      expect([JOURNEY.roadStart, -JOURNEY.depth]).toContain(z);
    } else {
      supportVertices++;
      const x = mesh[offset] ?? 0;
      if (y >= JOURNEY.floorY - 50)
        expect(Math.abs(x - JOURNEY.roadX)).toBeGreaterThanOrEqual(JOURNEY.roadWidth / 2);
    }
  }
  expect(roadVertices / 3).toBe(8);
  expect(supportVertices).toBeGreaterThan(0);
  expect([...mesh].every(Number.isFinite)).toBe(true);
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
