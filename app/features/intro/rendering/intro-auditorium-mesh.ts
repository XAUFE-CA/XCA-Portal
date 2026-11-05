import { AUDITORIUM_OBJECTS, type AuditoriumObject } from "../core/intro-auditorium";

type SectionPoint = readonly [number, number, number, number];
type Vertex = readonly [number, number, number, number, number, number];
type Axis = "x" | "y" | "z";

/**
 * Two segments per corner soften the silhouette without tessellating the flat faces.
 * 每个转角只用两段柔化轮廓，不细分平直表面。
 */
function roundedSection(
  width: number,
  height: number,
  radius: number,
  inset: number,
): SectionPoint[] {
  if (radius === 0)
    return [
      [0, 0, 0, 0],
      [width, 0, 0, 0],
      [width, height, 0, 0],
      [0, height, 0, 0],
    ];
  const points: SectionPoint[] = [];
  const centers = [
    [radius, radius],
    [width - radius, radius],
    [width - radius, height - radius],
    [radius, height - radius],
  ] as const;
  for (const [corner, center] of centers.entries()) {
    for (let step = 0; step <= 2; step++) {
      const angle = Math.PI + (corner * Math.PI) / 2 + (step * Math.PI) / 4;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      points.push([center[0] + nx * (radius - inset), center[1] + ny * (radius - inset), nx, ny]);
    }
  }
  return points;
}

function emit(vertices: number[], object: AuditoriumObject, axis: Axis, vertex: Vertex) {
  const [x, y, z] = object.origin;
  const [u, v, t, nu, nv, nt] = vertex;
  if (axis === "x") vertices.push(x + t, y + v, z - u, nt, nv, -nu, object.material);
  else if (axis === "y") vertices.push(x + u, y + t, z - v, nu, nt, -nv, object.material);
  else vertices.push(x + u, y + v, z - t, nu, nv, -nt, object.material);
}

function triangle(
  vertices: number[],
  object: AuditoriumObject,
  axis: Axis,
  a: Vertex,
  b: Vertex,
  c: Vertex,
) {
  emit(vertices, object, axis, a);
  emit(vertices, object, axis, axis === "z" ? c : b);
  emit(vertices, object, axis, axis === "z" ? b : c);
}

function ringVertex(point: SectionPoint, t: number, nu: number, nv: number, axial: number): Vertex {
  const scale = axial === 0 ? 1 : Math.SQRT1_2;
  return [point[0], point[1], t, nu * scale, nv * scale, axial * scale];
}

/**
 * Connect complete rings so rounded edges never contain overlapping segment caps.
 * 连续连接完整截环，圆角内部不生成重叠的分段端盖。
 */
function connectRings(
  vertices: number[],
  object: AuditoriumObject,
  axis: Axis,
  start: SectionPoint[],
  end: SectionPoint[],
  startT: number,
  endT: number,
  axial: number,
) {
  const smooth = (object.geometry?.radius ?? 0) > 0;
  for (let index = 0; index < start.length; index++) {
    const next = (index + 1) % start.length;
    const a = start[index];
    const b = start[next];
    const c = end[next];
    const d = end[index];
    if (!a || !b || !c || !d) continue;
    const length = smooth ? 1 : Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nu = smooth ? 0 : (b[1] - a[1]) / length;
    const nv = smooth ? 0 : (a[0] - b[0]) / length;
    const av = ringVertex(a, startT, smooth ? a[2] : nu, smooth ? a[3] : nv, axial);
    const bv = ringVertex(b, startT, smooth ? b[2] : nu, smooth ? b[3] : nv, axial);
    const cv = ringVertex(c, endT, smooth ? c[2] : nu, smooth ? c[3] : nv, axial);
    const dvtx = ringVertex(d, endT, smooth ? d[2] : nu, smooth ? d[3] : nv, axial);
    triangle(vertices, object, axis, av, bv, cv);
    triangle(vertices, object, axis, av, cv, dvtx);
  }
}

function cap(
  vertices: number[],
  object: AuditoriumObject,
  axis: Axis,
  section: SectionPoint[],
  t: number,
  normal: number,
) {
  const first = section[0];
  if (!first) return;
  const a: Vertex = [first[0], first[1], t, 0, 0, normal];
  for (let index = 1; index < section.length - 1; index++) {
    const point = section[index];
    const next = section[index + 1];
    if (!point || !next) continue;
    const b: Vertex = [point[0], point[1], t, 0, 0, normal];
    const c: Vertex = [next[0], next[1], t, 0, 0, normal];
    triangle(vertices, object, axis, a, normal < 0 ? c : b, normal < 0 ? b : c);
  }
}

function appendObject(vertices: number[], object: AuditoriumObject) {
  const [width, height, depth] = object.size;
  const axis = object.geometry?.axis ?? "z";
  const u = axis === "x" ? depth : width;
  const v = axis === "y" ? depth : height;
  const length = axis === "x" ? width : axis === "y" ? height : depth;
  const radius = Math.min(object.geometry?.radius ?? 0, u / 2, v / 2);
  const bevel = Math.min(object.geometry?.bevel ?? 0, radius / 2, length / 4);
  const outer = roundedSection(u, v, radius, 0);
  const ends = bevel > 0 ? roundedSection(u, v, radius, bevel) : outer;
  cap(vertices, object, axis, ends, 0, -1);
  if (bevel > 0) connectRings(vertices, object, axis, ends, outer, 0, bevel, -1);
  connectRings(vertices, object, axis, outer, outer, bevel, length - bevel, 0);
  if (bevel > 0) connectRings(vertices, object, axis, outer, ends, length - bevel, length, 1);
  cap(vertices, object, axis, ends, length, 1);
}

function buildAuditoriumMesh(): number[] {
  const vertices: number[] = [];
  for (const object of AUDITORIUM_OBJECTS) appendObject(vertices, object);
  return vertices;
}

const AUDITORIUM_MESH = buildAuditoriumMesh();

/**
 * Reuse the static seven-float mesh generated from the bounded scene objects once.
 * 复用从有界场景物体一次生成的静态七分量网格。
 */
export function createAuditoriumMesh(): number[] {
  return AUDITORIUM_MESH;
}
