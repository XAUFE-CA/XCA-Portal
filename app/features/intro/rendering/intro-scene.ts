import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
} from "three";
import { JOURNEY, roadBend } from "../core/intro-geometry";
import type { IntroMaterials } from "./intro-scene-materials";

export const INTRO_LAYERS = { exterior: 0, city: 1, auditorium: 2 } as const;

export interface IntroScene {
  scene: Scene;
  world: Group;
  mark: Group;
  dispose(): void;
}

export interface IntroCamera {
  camera: PerspectiveCamera;
  update(matrix: DOMMatrixReadOnly): void;
}

function selector(mesh: Float32Array, offset: number): number {
  return Math.round((mesh[offset + 6] ?? 0) * 100) / 100;
}

function orientFaces(geometry: BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const attributes = Object.values(geometry.attributes);
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    const ax = positions.getX(vertex + 1) - positions.getX(vertex);
    const ay = positions.getY(vertex + 1) - positions.getY(vertex);
    const az = positions.getZ(vertex + 1) - positions.getZ(vertex);
    const bx = positions.getX(vertex + 2) - positions.getX(vertex);
    const by = positions.getY(vertex + 2) - positions.getY(vertex);
    const bz = positions.getZ(vertex + 2) - positions.getZ(vertex);
    const facing =
      (ay * bz - az * by) * normals.getX(vertex) +
      (az * bx - ax * bz) * normals.getY(vertex) +
      (ax * by - ay * bx) * normals.getZ(vertex);
    if (facing >= 0) continue;
    for (const attribute of attributes) {
      for (let component = 0; component < attribute.itemSize; component++) {
        const a = (vertex + 1) * attribute.itemSize + component;
        const b = (vertex + 2) * attribute.itemSize + component;
        const value = attribute.array[a] ?? 0;
        attribute.array[a] = attribute.array[b] ?? 0;
        attribute.array[b] = value;
      }
    }
  }
}

function geometryFor(source: Float32Array, material: number, count: number): BufferGeometry {
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const across = new Float32Array(count);
  const along = new Float32Array(count);
  const colors = material === 0 ? new Float32Array(count * 3) : null;
  const shade = material === 0 ? new Color() : null;
  const city = material > 4.5 && material < 8.5 && material !== 7;
  let vertex = 0;
  for (let offset = 0; offset < source.length; offset += 7) {
    if (selector(source, offset) !== material) continue;
    const x = source[offset] ?? 0;
    const y = source[offset + 1] ?? 0;
    const z = source[offset + 2] ?? 0;
    const nx = source[offset + 3] ?? 0;
    positions[vertex * 3] = x;
    positions[vertex * 3 + 1] = -y;
    positions[vertex * 3 + 2] = z;
    normals[vertex * 3] = nx;
    normals[vertex * 3 + 1] = -(source[offset + 4] ?? 0);
    normals[vertex * 3 + 2] = source[offset + 5] ?? 0;
    // Preserve the former display-space axis shading, independent of the city's lights.
    // 保留原有显示空间轴向明暗，不受城市灯光影响。
    if (colors && shade) {
      const ny = source[offset + 4] ?? 0;
      const nz = source[offset + 5] ?? 0;
      const light = Math.abs(nz) > 0.99 ? 1 : 0.65 + 0.27 * Math.abs(ny) + 0.08 * Math.abs(nx);
      shade.setRGB(light, light, light, SRGBColorSpace);
      colors[vertex * 3] = shade.r;
      colors[vertex * 3 + 1] = shade.g;
      colors[vertex * 3 + 2] = shade.b;
    }
    uv[vertex * 2] = (city ? (Math.abs(nx) > 0.5 ? z : x) : x + z * 0.43) / 500;
    uv[vertex * 2 + 1] = y / 320;
    across[vertex] = (x - roadBend(z).x - JOURNEY.roadX) / JOURNEY.roadWidth + 0.5;
    along[vertex] = z;
    vertex++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setAttribute("roadAcross", new BufferAttribute(across, 1));
  geometry.setAttribute("introAlong", new BufferAttribute(along, 1));
  if (colors) geometry.setAttribute("color", new BufferAttribute(colors, 3));
  // Reflection reverses winding; authored normals also correct the old mesh's mixed caps.
  // 坐标反射会反转绕序，原有法线同时修正旧网格中绕序不一致的端面。
  orientFaces(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Keep geometry static and batch by surface; only the mark thickness and world offset move.
 * 几何保持静态并按表面合批，只改变标识厚度与场景偏移。
 */
export function createIntroScene(
  source: Float32Array,
  materials: Pick<IntroMaterials, "get">,
): IntroScene {
  const scene = new Scene();
  const world = new Group();
  const mark = new Group();
  scene.add(world, mark);
  const geometries: BufferGeometry[] = [];
  const counts = new Map<number, number>();
  for (let offset = 0; offset < source.length; offset += 7) {
    const id = selector(source, offset);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    const geometry = geometryFor(source, id, count);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, materials.get(id));
    mesh.name = `intro.surface.${id}`;
    const city = id > 4.5 && id < 8.5 && id !== 7;
    mesh.layers.set(
      city ? INTRO_LAYERS.city : id >= 9 ? INTRO_LAYERS.auditorium : INTRO_LAYERS.exterior,
    );
    mesh.castShadow = (id >= 9 && id < 14 && id !== 11) || id === 19;
    mesh.receiveShadow = id >= 9;
    (id === 0 ? mark : world).add(mesh);
  }
  return {
    scene,
    world,
    mark,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      scene.clear();
    },
  };
}

/**
 * Reflect the CSS downward Y axis once on each side of the existing view transform.
 * 在现有视图变换两侧各反转一次 CSS 向下的 Y 轴。
 */
export function createIntroCamera(width: number, height: number, focal: number): IntroCamera {
  const camera = new PerspectiveCamera(
    (2 * Math.atan(height / (2 * focal)) * 180) / Math.PI,
    width / height,
    JOURNEY.near,
    JOURNEY.far,
  );
  camera.matrixAutoUpdate = false;
  const reflection = new Matrix4().makeScale(1, -1, 1);
  const offset = new Matrix4().makeTranslation(0, 0, -focal);
  const cssView = new Matrix4();
  return {
    camera,
    update(matrix: DOMMatrixReadOnly) {
      cssView.set(
        matrix.m11,
        matrix.m21,
        matrix.m31,
        matrix.m41,
        matrix.m12,
        matrix.m22,
        matrix.m32,
        matrix.m42,
        matrix.m13,
        matrix.m23,
        matrix.m33,
        matrix.m43,
        matrix.m14,
        matrix.m24,
        matrix.m34,
        matrix.m44,
      );
      camera.matrixWorldInverse
        .copy(reflection)
        .multiply(offset)
        .multiply(cssView)
        .multiply(reflection);
      camera.matrix.copy(camera.matrixWorldInverse).invert();
      camera.matrixWorld.copy(camera.matrix);
      camera.matrixWorldNeedsUpdate = false;
    },
  };
}
