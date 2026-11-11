type Vertex = readonly [number, number, number];
export interface Volume {
  x: number;
  z: number;
  width: number;
  depth: number;
  top: number;
  bottom: number;
  material: number;
  bevel?: number;
  topScale?: number;
  bottomFace?: boolean;
}

export function face(vertices: number[], points: readonly Vertex[], material: number) {
  const a = points[0],
    b = points[1],
    c = points[2];
  if (!a || !b || !c) return;
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  for (let index = 1; index < points.length - 1; index++) {
    for (const point of [a, points[index], points[index + 1]]) {
      if (point) vertices.push(...point, nx / length, ny / length, nz / length, material);
    }
  }
}

/**
 * Closed convex footprints support chamfered walls and tapered upper floors.
 * 闭合凸平面用于倒角墙体与收分的上部楼层。
 */
export function prism(vertices: number[], volume: Volume) {
  const { x, z, width, depth, top, bottom, material, bevel = 0, topScale = 1 } = volume;
  const w = width / 2,
    d = depth / 2;
  const cut = Math.min(bevel, w * 0.8, d * 0.8);
  const footprint = cut
    ? [
        [-w + cut, d],
        [w - cut, d],
        [w, d - cut],
        [w, -d + cut],
        [w - cut, -d],
        [-w + cut, -d],
        [-w, -d + cut],
        [-w, d - cut],
      ]
    : [
        [-w, d],
        [w, d],
        [w, -d],
        [-w, -d],
      ];
  const roof: Vertex[] = [],
    base: Vertex[] = [];
  for (const [u = 0, v = 0] of footprint) {
    roof.push([x + u * topScale, top, z + v * topScale]);
    base.push([x + u, bottom, z + v]);
  }
  face(vertices, [...roof].reverse(), material);
  if (volume.bottomFace !== false) face(vertices, base, material);
  for (let index = 0; index < roof.length; index++) {
    const next = (index + 1) % roof.length;
    const a = roof[index],
      b = roof[next],
      c = base[next],
      d = base[index];
    if (a && b && c && d) face(vertices, [a, b, c, d], material);
  }
}

export function cityPlane(
  vertices: number[],
  x: number,
  z: number,
  width: number,
  depth: number,
  y: number,
  material: number,
) {
  face(
    vertices,
    [
      [x - width / 2, y, z + depth / 2],
      [x - width / 2, y, z - depth / 2],
      [x + width / 2, y, z - depth / 2],
      [x + width / 2, y, z + depth / 2],
    ],
    material,
  );
}
