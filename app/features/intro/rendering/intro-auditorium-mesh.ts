import { AUDITORIUM_OBJECTS, type AuditoriumObject } from "../core/intro-auditorium";

type SectionPoint = readonly [number, number, number, number];
type Vertex = readonly [number, number, number, number, number, number];
type Axis = "x" | "y" | "z";

/**
 * Four segments per corner preserve furniture silhouettes without dense flat faces.
 * 每个转角用四段保留家具轮廓，不密集细分平面。
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
    for (let step = 0; step <= 4; step++) {
      const angle = Math.PI + (corner * Math.PI) / 2 + (step * Math.PI) / 8;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      points.push([center[0] + nx * (radius - inset), center[1] + ny * (radius - inset), nx, ny]);
    }
  }
  return points;
}

function refineSection(section: SectionPoint[]): SectionPoint[] {
  const points: SectionPoint[] = [];
  for (let index = 0; index < section.length; index++) {
    const a = section[index];
    const b = section[(index + 1) % section.length];
    if (!a || !b) continue;
    const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40);
    for (let step = 0; step < count; step++) {
      const t = step / count;
      points.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ]);
    }
  }
  return points;
}

function emit(vertices: number[], object: AuditoriumObject, axis: Axis, vertex: Vertex) {
  const [x, y, z] = object.origin;
  const [u, v, t, nu, nv, nt] = vertex;
  const [width, height, depth] = object.size;
  if (object.geometry?.profile === "back") {
    const fraction = v / height;
    const across = (u * 2) / width - 1;
    const scale = 1 - 0.14 * fraction - 0.06 * Math.sin(Math.PI * fraction);
    const slope = (-0.14 - 0.06 * Math.PI * Math.cos(Math.PI * fraction)) / height;
    const thickness = object.material === 10 ? 36 : 18;
    const nz = -nt / (thickness / depth);
    const nx = (nu + (72 * across * nz) / width) / scale;
    const ny = nv - (u - width / 2) * slope * nx + (36 / height) * nz;
    const length = Math.hypot(nx, ny, nz);
    vertices.push(
      x + width / 2 + (u - width / 2) * scale,
      y + v,
      z - (t * thickness) / depth - 36 * fraction - 18 * across * across,
      nx / length,
      ny / length,
      nz / length,
      object.material,
    );
  } else if (object.geometry?.profile === "cushion") {
    const a = (Math.PI * u) / width;
    const b = (Math.PI * v) / depth;
    const ny = nt / (1 - 10 / height);
    const nx = nu + ((10 * Math.PI) / width) * Math.cos(a) * Math.sin(b) * ny;
    const nz = -nv - ((10 * Math.PI) / depth) * Math.sin(a) * Math.cos(b) * ny;
    const length = Math.hypot(nx, ny, nz);
    vertices.push(
      x + u,
      y + 10 + t * (1 - 10 / height) - 10 * Math.sin(a) * Math.sin(b),
      z - v,
      nx / length,
      ny / length,
      nz / length,
      object.material,
    );
  } else if (axis === "x") vertices.push(x + t, y + v, z - u, nt, nv, -nu, object.material);
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
  if (object.geometry?.profile) {
    const width = object.size[0];
    const height = axis === "y" ? object.size[2] : object.size[1];
    for (let ring = 0; ring < 4; ring++) {
      for (let index = 0; index < section.length; index++) {
        const a = section[index];
        const b = section[(index + 1) % section.length];
        if (!a || !b) continue;
        const point = (p: SectionPoint, scale: number): Vertex => [
          width / 2 + (p[0] - width / 2) * scale,
          height / 2 + (p[1] - height / 2) * scale,
          t,
          0,
          0,
          normal,
        ];
        const inner = ring / 4;
        const outer = (ring + 1) / 4;
        const aa = point(a, inner),
          bb = point(b, inner);
        const cc = point(b, outer),
          dd = point(a, outer);
        if (ring > 0)
          triangle(vertices, object, axis, aa, normal < 0 ? cc : bb, normal < 0 ? bb : cc);
        triangle(vertices, object, axis, aa, normal < 0 ? dd : cc, normal < 0 ? cc : dd);
      }
    }
    return;
  }
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
  const section = roundedSection(u, v, radius, 0);
  const endSection = bevel > 0 ? roundedSection(u, v, radius, bevel) : section;
  const outer = object.geometry?.profile ? refineSection(section) : section;
  const ends = object.geometry?.profile ? refineSection(endSection) : endSection;
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
