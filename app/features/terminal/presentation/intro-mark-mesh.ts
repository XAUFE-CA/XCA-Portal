import { JOURNEY, JOURNEY_STATIONS } from "./intro-geometry";

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
function box(vertices: number[], origin: number[], size: number[], material = 2) {
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

function sceneryVertices(panelRadius: number): number[] {
  const vertices: number[] = [];
  for (const side of [-1, 1]) {
    const edge = JOURNEY.roadX + side * (JOURNEY.roadWidth / 2 + 120);
    const length = JOURNEY.depth + JOURNEY.roadStart;
    box(vertices, [edge - 14, JOURNEY.floorY - 170, JOURNEY.roadStart], [28, 120, length]);
    box(vertices, [edge - 27, JOURNEY.floorY - 190, JOURNEY.roadStart], [54, 20, length], 3);
  }
  for (const station of JOURNEY_STATIONS) {
    const { left, top, depth, width, height, side } = station;
    const leg = left + (side < 0 ? 50 : width - 134);
    const beamX = side < 0 ? leg : JOURNEY.roadX;
    const beamWidth = side < 0 ? JOURNEY.roadX - leg : leg + 84 - JOURNEY.roadX;
    box(vertices, [leg, top, depth + 44], [84, height, 88]);
    box(vertices, [leg - 34, JOURNEY.floorY - 36, depth + 100], [152, 36, 200]);
    box(vertices, [beamX, top, depth + 52], [beamWidth, 64, 104]);
    const roadEdge = JOURNEY.roadX + (side * JOURNEY.roadWidth) / 2;
    const baseX = side < 0 ? leg - 34 : roadEdge;
    const baseWidth = side < 0 ? roadEdge - baseX : leg + 118 - roadEdge;
    box(vertices, [baseX, JOURNEY.floorY, depth + 110], [baseWidth, 48, 220]);
    box(vertices, [roadEdge + side * 120 - 32, JOURNEY.floorY - 200, depth + 45], [64, 200, 90]);
    box(vertices, [roadEdge - 70, top + 64, depth + 30], [140, 12, 60], 3);
    if (!station.hasPanel) continue;
    const panelX = left + station.panelLeft,
      panelY = top + station.panelTop;
    panelHousing(
      vertices,
      panelX,
      panelY,
      depth + 16,
      station.panelWidth,
      station.panelHeight,
      panelRadius,
    );
    const mountX = side < 0 ? leg + 84 : panelX + station.panelWidth;
    const mountWidth = side < 0 ? panelX - mountX : leg - mountX;
    for (const offset of [90, 230]) {
      box(vertices, [mountX, panelY + offset, depth], [mountWidth, 24, 56]);
      box(vertices, [leg - 12, panelY + offset - 6, depth + 56], [108, 36, 112], 3);
    }
  }
  return vertices;
}

function roadVertices(): number[] {
  const left = JOURNEY.roadX - JOURNEY.roadWidth / 2,
    right = left + JOURNEY.roadWidth;
  const top = JOURNEY.floorY,
    bottom = top + 18;
  const start = JOURNEY.roadStart,
    end = -JOURNEY.depth;
  const vertices: number[] = [];
  quad(
    vertices,
    [
      [left, top, start],
      [right, top, start],
      [right, top, end],
      [left, top, end],
    ],
    [0, -1, 0],
    1,
  );
  quad(
    vertices,
    [
      [left, bottom, start],
      [right, bottom, start],
      [right, bottom, end],
      [left, bottom, end],
    ],
    [0, 1, 0],
    1,
  );
  quad(
    vertices,
    [
      [left, top, start],
      [left, bottom, start],
      [left, bottom, end],
      [left, top, end],
    ],
    [-1, 0, 0],
    1,
  );
  quad(
    vertices,
    [
      [right, top, start],
      [right, bottom, start],
      [right, bottom, end],
      [right, top, end],
    ],
    [1, 0, 0],
    1,
  );
  return vertices;
}

export function createMarkMesh(paths: SVGPathElement[], panelRadius: number): Float32Array {
  const body = paths.flatMap((path) => [...extrudeContour(sampleContour(path), JOURNEY.bodyDepth)]);
  const road = roadVertices();
  const scenery = sceneryVertices(panelRadius);
  const mesh = new Float32Array(body.length + road.length + scenery.length);
  mesh.set(body);
  mesh.set(road, body.length);
  mesh.set(scenery, body.length + road.length);
  return mesh;
}
