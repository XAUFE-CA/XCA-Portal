import { bendRoadMesh, JOURNEY, JOURNEY_STATIONS } from "../core/intro-geometry";
import { createAuditoriumMesh } from "./intro-auditorium-mesh";
import { createCityMesh } from "./intro-city-mesh";

type Point = readonly [number, number];
// Each vertex contains position, normal, and body/road material selector.
// 每个顶点包含位置、法线以及主体/道路的材质选择器。

function turn(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Ear clipping preserves the concave CA opening; a triangle fan would fill it.
 * 耳切法保留 CA 的凹形开口；三角扇会将其填实。
 */
function capTriangles(points: readonly Point[]): number[] {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + (next ? point[0] * next[1] - next[0] * point[1] : 0);
  }, 0);
  const winding = Math.sign(area);
  const remaining = points.map((_, index) => index);
  const triangles: number[] = [];
  while (remaining.length > 3) {
    const ear = remaining.findIndex((current, index) => {
      const previous = remaining[(index + remaining.length - 1) % remaining.length];
      const next = remaining[(index + 1) % remaining.length];
      const a = points[previous ?? -1],
        b = points[current],
        c = points[next ?? -1];
      if (!a || !b || !c || turn(a, b, c) * winding <= 1e-8) return false;
      return !remaining.some((other) => {
        if (other === previous || other === current || other === next) return false;
        const p = points[other];
        return (
          p &&
          turn(a, b, p) * winding >= -1e-8 &&
          turn(b, c, p) * winding >= -1e-8 &&
          turn(c, a, p) * winding >= -1e-8
        );
      });
    });
    if (ear < 0) throw new Error("CA contour cannot be triangulated");
    triangles.push(
      remaining[(ear + remaining.length - 1) % remaining.length] ?? 0,
      remaining[ear] ?? 0,
      remaining[(ear + 1) % remaining.length] ?? 0,
    );
    remaining.splice(ear, 1);
  }
  return [...triangles, ...remaining];
}

export function extrudeContour(points: readonly Point[], depth: number): Float32Array {
  if (points.length < 3) return new Float32Array();
  const vertices: number[] = [];
  const triangles = capTriangles(points);
  for (const z of [0, -depth]) {
    for (const index of triangles) {
      const point = points[index];
      if (point) vertices.push(point[0], point[1], z, 0, 0, z === 0 ? 1 : -1, 0);
    }
  }
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length];
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 2) % points.length];
    if (!a || !b || !previous || !next) continue;
    // Smooth curved walls; retain a hard normal at the crossbars' sharp corners.
    // 曲面墙体保持平滑；横杠尖角处保留硬法线。
    const normal = (before: Point, at: Point, after: Point): Point => {
      const incoming = Math.hypot(at[0] - before[0], at[1] - before[1]);
      const outgoing = Math.hypot(after[0] - at[0], after[1] - at[1]);
      const cosine =
        ((at[0] - before[0]) * (after[0] - at[0]) + (at[1] - before[1]) * (after[1] - at[1])) /
        (incoming * outgoing);
      const tangent: Point =
        cosine > 0.8 ? [after[0] - before[0], after[1] - before[1]] : [b[0] - a[0], b[1] - a[1]];
      const length = Math.hypot(...tangent);
      return [tangent[1] / length, -tangent[0] / length];
    };
    const na = normal(previous, a, b),
      nb = normal(a, b, next);
    for (const [point, n, z] of [
      [a, na, 0],
      [b, nb, 0],
      [a, na, -depth],
      [b, nb, 0],
      [b, nb, -depth],
      [a, na, -depth],
    ] as const) {
      vertices.push(point[0], point[1], z, n[0], n[1], 0, 0);
    }
  }
  return new Float32Array(vertices);
}

/**
 * Bound curve error in scene units, rather than adding more depth slices.
 * 以场景单位限制曲线误差，而不是增加更多深度切片。
 */
export function sampleContour(path: SVGPathElement): Point[] {
  const length = path.getTotalLength();
  const point = (distance: number): Point => {
    const value = path.getPointAtLength(distance);
    return [value.x - 627, value.y - 627];
  };
  const points: Point[] = [];
  function subdivide(from: number, to: number, a: Point, b: Point) {
    const middle = point((from + to) / 2);
    const deviation = Math.hypot(middle[0] - (a[0] + b[0]) / 2, middle[1] - (a[1] + b[1]) / 2);
    if (to - from > 0.25 && (to - from > 12 || deviation > 0.08)) {
      subdivide(from, (from + to) / 2, a, middle);
      subdivide((from + to) / 2, to, middle, b);
    } else points.push(a);
  }
  subdivide(0, length, point(0), point(length));
  // Remove exactly straight intermediate samples before triangulating the cap.
  // 在端面三角化前移除完全共线的中间采样点。
  return points.filter((at, index) => {
    const before = points[(index + points.length - 1) % points.length];
    const after = points[(index + 1) % points.length];
    return before && after && Math.abs(turn(before, at, after)) > 1e-6;
  });
}

function quad(vertices: number[], points: number[][], normal: number[], material: number) {
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = points[index];
    if (point) vertices.push(...point, ...normal, material);
  }
}

/**
 * Solid boxes keep front, side and underside faces in the same depth buffer.
 * 实心盒体将正面、侧面与底面保留在同一深度缓冲中。
 */
function box(vertices: number[], origin: readonly number[], size: readonly number[], material = 2) {
  const [x = 0, y = 0, z = 0] = origin;
  const [width = 0, height = 0, depth = 0] = size;
  const a = [x, y, z],
    b = [x + width, y, z],
    c = [x + width, y + height, z],
    d = [x, y + height, z];
  const back = (point: number[]) => [point[0] ?? 0, point[1] ?? 0, z - depth];
  quad(vertices, [a, b, c, d], [0, 0, 1], material);
  quad(vertices, [back(a), back(b), back(c), back(d)], [0, 0, -1], material);
  quad(vertices, [a, b, back(b), back(a)], [0, -1, 0], material);
  quad(vertices, [d, c, back(c), back(d)], [0, 1, 0], material);
  quad(vertices, [a, d, back(d), back(a)], [-1, 0, 0], material);
  quad(vertices, [b, c, back(c), back(b)], [1, 0, 0], material);
}

export function roundedPanelContour(width: number, height: number, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0)
    return [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
  const points: Point[] = [];
  const corners = [
    [r, r],
    [width - r, r],
    [width - r, height - r],
    [r, height - r],
  ];
  for (const [corner, center] of corners.entries()) {
    for (let step = 0; step <= 8; step++) {
      const angle = Math.PI + (corner * Math.PI) / 2 + (step * Math.PI) / 16;
      const point: Point = [
        (center[0] ?? 0) + Math.cos(angle) * r,
        (center[1] ?? 0) + Math.sin(angle) * r,
      ];
      const previous = points.at(-1);
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8)
        points.push(point);
    }
  }
  const first = points[0],
    last = points.at(-1);
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-8) points.pop();
  return points;
}

function panelHousing(
  vertices: number[],
  x: number,
  y: number,
  front: number,
  width: number,
  height: number,
  radius: number,
) {
  const mesh = extrudeContour(roundedPanelContour(width, height, radius), 48);
  for (let offset = 0; offset < mesh.length; offset += 7) {
    vertices.push(
      (mesh[offset] ?? 0) + x,
      (mesh[offset + 1] ?? 0) + y,
      (mesh[offset + 2] ?? 0) + front,
      mesh[offset + 3] ?? 0,
      mesh[offset + 4] ?? 0,
      mesh[offset + 5] ?? 0,
      2,
    );
  }
}

/**
 * Sweep a closed section without internal end caps or overlapping segment boxes.
 * 扫掠闭合截面，不生成内部端盖或相互重叠的分段盒体。
 */
function sweepSection(profile: Point[], material: number, smooth = false): number[] {
  const vertices: number[] = [];
  const segments = 240;
  const normal = (index: number): Point => {
    const before = profile[(index + profile.length - 1) % profile.length];
    const at = profile[index],
      after = profile[(index + 1) % profile.length];
    if (!before || !at || !after) throw new Error("Incomplete road section");
    const dx = after[0] - (smooth ? before[0] : at[0]);
    const dy = after[1] - (smooth ? before[1] : at[1]);
    const length = Math.hypot(dx, dy);
    return [dy / length, -dx / length];
  };
  for (let segment = 0; segment < segments; segment++) {
    const start = JOURNEY.roadStart + ((JOURNEY.roadEnd - JOURNEY.roadStart) * segment) / segments;
    const end =
      JOURNEY.roadStart + ((JOURNEY.roadEnd - JOURNEY.roadStart) * (segment + 1)) / segments;
    for (let index = 0; index < profile.length; index++) {
      const next = (index + 1) % profile.length;
      const a = profile[index],
        b = profile[next];
      if (!a || !b) throw new Error("Incomplete road section");
      const na = normal(index),
        nb = smooth ? normal(next) : na;
      for (const [point, n, z] of [
        [a, na, start],
        [b, nb, start],
        [b, nb, end],
        [a, na, start],
        [b, nb, end],
        [a, na, end],
      ] as const) {
        vertices.push(point[0], point[1], z, n[0], n[1], 0, material);
      }
    }
  }
  for (const z of [JOURNEY.roadStart, JOURNEY.roadEnd]) {
    for (const index of capTriangles(profile)) {
      const point = profile[index];
      if (point)
        vertices.push(point[0], point[1], z, 0, 0, z === JOURNEY.roadStart ? 1 : -1, material);
    }
  }
  return bendRoadMesh(vertices);
}

function sceneryVertices(panelRadius: number): number[] {
  const vertices: number[] = [];
  for (const side of [-1, 1]) {
    const edge = JOURNEY.roadX + side * (JOURNEY.roadWidth / 2 + 44);
    for (const [width, height, elevation, radius, material, offset = 0] of [
      [24, 20, 142, 8, 2],
      [10, 12, 38, 5, 2],
      [5, 90, 128, 2, 4],
      [8, 6, 8, 3, 3],
      [104, 54, -JOURNEY.bearingInset, 8, 2, -32 * side],
    ]) {
      const section = roundedPanelContour(width ?? 0, height ?? 0, radius ?? 0)
        .filter((_, index) => index % 2 === 0 || index % 9 === 0 || index % 9 === 8)
        .map(
          ([x, y]): Point => [
            edge + offset - (width ?? 0) / 2 + x,
            JOURNEY.floorY - (elevation ?? 0) + y,
          ],
        );
      const strip = sweepSection(section, material ?? 2, true);
      for (const value of strip) vertices.push(value);
    }
    for (let z = JOURNEY.railPostStart; z > JOURNEY.roadEnd; z -= JOURNEY.railPostSpacing) {
      const post: number[] = [];
      box(post, [edge - 7, JOURNEY.floorY - 122, z], [14, 122 + JOURNEY.bearingInset, 18]);
      vertices.push(...bendRoadMesh(post, z));
    }
  }
  for (const station of JOURNEY_STATIONS) {
    if (!station.hasPanel) continue;
    const assembly: number[] = [];
    const { left, top, depth, width, side } = station;
    const leg = left + (side < 0 ? 92 : width - 126);
    const panelX = left + station.panelLeft,
      panelY = top + station.panelTop;
    box(assembly, [leg, panelY + 50, depth + 24], [34, JOURNEY.floorY - panelY - 50, 38]);
    box(assembly, [leg - 18, JOURNEY.floorY - 12, depth + 42], [70, 12 + JOURNEY.bearingInset, 74]);
    const roadEdge = JOURNEY.roadX + (side * JOURNEY.roadWidth) / 2;
    const bearingLeft = Math.min(leg - 18, roadEdge - 24);
    const bearingRight = Math.max(leg + 52, roadEdge + 24);
    box(
      assembly,
      [bearingLeft, JOURNEY.floorY + JOURNEY.bearingInset, depth + 42],
      [bearingRight - bearingLeft, 44, 74],
    );
    panelHousing(
      assembly,
      panelX,
      panelY,
      depth + 16,
      station.panelWidth,
      station.panelHeight,
      panelRadius,
    );
    const mountX = side < 0 ? leg + 34 : panelX + station.panelWidth;
    const mountWidth = side < 0 ? panelX - mountX : leg - mountX;
    for (const offset of [96, 230]) {
      box(assembly, [mountX, panelY + offset, depth], [mountWidth, 12, 20]);
    }
    vertices.push(...bendRoadMesh(assembly, depth));
  }
  return vertices;
}

function roadVertices(): number[] {
  const left = JOURNEY.roadX - JOURNEY.roadWidth / 2,
    right = left + JOURNEY.roadWidth;
  const y = JOURNEY.floorY;
  return sweepSection(
    [
      [left + 8, y],
      [right - 8, y],
      [right, y + 8],
      [right, y + 20],
      [right - 8, y + 28],
      [left + 8, y + 28],
      [left, y + 20],
      [left, y + 8],
    ],
    1,
  );
}

function viaductVertices(): number[] {
  const vertices: number[] = [];
  for (let z = -1600; z > JOURNEY.roadEnd; z -= 1700) {
    const support: number[] = [];
    box(support, [JOURNEY.roadX - 450, JOURNEY.floorY + 34, z], [900, 92, 200]);
    for (const side of [-1, 1]) {
      box(
        support,
        [JOURNEY.roadX + side * 340 - 42, JOURNEY.floorY + 126, z - 24],
        [84, JOURNEY.cityDrop - 126, 150],
      );
    }
    vertices.push(...bendRoadMesh(support, z));
  }
  return vertices;
}

export function createMarkMesh(paths: SVGPathElement[], panelRadius: number): Float32Array {
  const parts = [
    createCityMesh(),
    ...paths.map((path) => extrudeContour(sampleContour(path), JOURNEY.bodyDepth)),
    roadVertices(),
    sceneryVertices(panelRadius),
    createAuditoriumMesh(),
    viaductVertices(),
  ];
  const mesh = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    mesh.set(part, offset);
    offset += part.length;
  }
  return mesh;
}
