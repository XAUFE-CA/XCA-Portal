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
import { AUDITORIUM, AUDITORIUM_MATERIAL } from "../../core/intro-auditorium";
import { JOURNEY, roadBend } from "../../core/intro-geometry";
import { CITY_GRID, cityParcel } from "../city/intro-city-layout";
import {
  CITY_LED_MATERIAL,
  CITY_LED_PATTERN_U,
  CITY_LED_PORTRAIT_U,
  CITY_LED_UV,
  CITY_LED_VARIANTS,
} from "../city/intro-city-led";
import { CITY_TRAFFIC_MATERIAL } from "../city/intro-city-life";
import type { IntroMaterials } from "./intro-scene-materials";

export const INTRO_LAYERS = { exterior: 0, city: 1, auditorium: 2 } as const;
const LED_PARCEL_ORIGIN = cityParcel(1, 0, 0);

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

/** Index exact duplicates without welding positions across hard normals or changing triangles. */
function indexAuditoriumGeometry(
  geometry: BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
) {
  const count = positions.length / 3;
  const positionBits = new Uint32Array(positions.buffer);
  const normalBits = new Uint32Array(normals.buffer);
  const slots = new Uint32Array(2 ** Math.ceil(Math.log2(count * 2)));
  const mask = slots.length - 1;
  const indices = count < 65536 ? new Uint16Array(count) : new Uint32Array(count);
  const attributes = Object.entries(geometry.attributes);
  let unique = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const start = vertex * 3;
    let hash = 0x811c9dc5;
    for (let axis = 0; axis < 3; axis++) {
      hash = Math.imul(hash ^ (positionBits[start + axis] ?? 0), 0x01000193);
      hash = Math.imul(hash ^ (normalBits[start + axis] ?? 0), 0x01000193);
    }
    let slot = hash & mask;
    for (;;) {
      const indexed = (slots[slot] ?? 0) - 1;
      const other = indexed * 3;
      if (indexed < 0) {
        indices[vertex] = unique;
        slots[slot] = unique + 1;
        // Room surface UVs and road attributes are derived from position alone.
        // 室内表面的 UV 和道路属性均由顶点位置推导。
        if (unique !== vertex) {
          for (const [, attribute] of attributes) {
            const size = attribute.itemSize;
            attribute.array.copyWithin(unique * size, vertex * size, (vertex + 1) * size);
          }
        }
        unique++;
        break;
      }
      if (
        positionBits[start] === positionBits[other] &&
        positionBits[start + 1] === positionBits[other + 1] &&
        positionBits[start + 2] === positionBits[other + 2] &&
        normalBits[start] === normalBits[other] &&
        normalBits[start + 1] === normalBits[other + 1] &&
        normalBits[start + 2] === normalBits[other + 2]
      ) {
        indices[vertex] = indexed;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  for (const [name, attribute] of attributes)
    geometry.setAttribute(
      name,
      new BufferAttribute(
        attribute.array.slice(0, unique * attribute.itemSize),
        attribute.itemSize,
      ),
    );
  geometry.setIndex(new BufferAttribute(indices, 1));
}

function geometryFor(source: Float32Array, material: number, triangles: number[]): BufferGeometry {
  const count = triangles.length * 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const across = new Float32Array(count);
  const along = new Float32Array(count);
  const colors = material === 0 ? new Float32Array(count * 3) : null;
  const shade = material === 0 ? new Color() : null;
  const city = material > 4.5 && material < 8.5 && material !== 7;
  let ledShape = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const offset = (triangles[Math.floor(vertex / 3)] ?? 0) + (vertex % 3) * 7;
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
    if (material === CITY_LED_MATERIAL) {
      if (vertex % 6 === 0) {
        const width = Math.hypot((source[offset + 7] ?? x) - x, (source[offset + 9] ?? z) - z);
        const height = Math.abs((source[offset + 15] ?? y) - y);
        ledShape = height > width ? CITY_LED_PORTRAIT_U : 0;
        const centerX = (x + (source[offset + 14] ?? x)) / 2;
        const centerZ = (z + (source[offset + 16] ?? z)) / 2;
        const column = Math.round(
          (Math.abs(centerX - JOURNEY.roadX) - (LED_PARCEL_ORIGIN.x - JOURNEY.roadX)) /
            CITY_GRID.width,
        );
        const row = Math.round((LED_PARCEL_ORIGIN.z - centerZ) / CITY_GRID.depth);
        const face = Math.abs(nx) > 0.5 ? 1 : 0;
        const pattern =
          (row + column + (centerX < JOURNEY.roadX ? 0 : 2) + face) % CITY_LED_VARIANTS;
        ledShape += pattern * CITY_LED_PATTERN_U;
      }
      uv[vertex * 2] = (CITY_LED_UV[(vertex % 6) * 2] ?? 0) + ledShape;
      uv[vertex * 2 + 1] = CITY_LED_UV[(vertex % 6) * 2 + 1] ?? 0;
    } else {
      uv[vertex * 2] = (city ? (Math.abs(nx) > 0.5 ? z : x) : x + z * 0.43) / 500;
      uv[vertex * 2 + 1] = y / 320;
    }
    across[vertex] = (x - roadBend(z).x - JOURNEY.roadX) / JOURNEY.roadWidth + 0.5;
    along[vertex] = z;
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
  if (material >= 9) indexAuditoriumGeometry(geometry, positions, normals);
  geometry.computeBoundingSphere();
  return geometry;
}

function surfaceBatches(source: Float32Array) {
  const materials = new Map<number, Map<number, number[]>>();
  for (let offset = 0; offset < source.length; offset += 21) {
    const material = selector(source, offset);
    let batches = materials.get(material);
    if (!batches) {
      batches = new Map();
      materials.set(material, batches);
    }
    let tile = 0;
    if (
      material === AUDITORIUM_MATERIAL.seat ||
      material === AUDITORIUM_MATERIAL.alloy ||
      material === AUDITORIUM_MATERIAL.graphite
    ) {
      // Two seating rows per tile, without merging the banks across the aisle.
      // 每个分块覆盖两排座位，通道两侧可分别剔除。
      const x =
        ((source[offset] ?? 0) + (source[offset + 7] ?? 0) + (source[offset + 14] ?? 0)) / 3;
      const z =
        ((source[offset + 2] ?? 0) + (source[offset + 9] ?? 0) + (source[offset + 16] ?? 0)) / 3;
      const col = x < JOURNEY.roadX ? 0 : 1;
      const row = Math.floor((z - AUDITORIUM.entrance) / 880);
      tile = row * 2 + col;
    }
    let triangles = batches.get(tile);
    if (!triangles) {
      triangles = [];
      batches.set(tile, triangles);
    }
    triangles.push(offset);
  }
  return materials;
}

/**
 * Batch by surface, splitting dense seating surfaces into spatial tiles for frustum culling.
 * 按表面合批；高密度座席按空间分块，供视锥剔除。
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
  for (const [id, batches] of surfaceBatches(source)) {
    for (const triangles of batches.values()) {
      const geometry = geometryFor(source, id, triangles);
      geometries.push(geometry);
      const mesh = new Mesh(geometry, materials.get(id));
      mesh.name = `intro.surface.${id}`;
      // Whole-bridge batch centers cannot determine the overlap order of transparent glass.
      // 整座桥的合批中心不能决定透明玻璃的叠放顺序。
      mesh.renderOrder = id === 1 ? 1 : id === 4 ? 2 : 0;
      const city = id > 4.5 && id < 8.5 && id !== 7;
      mesh.layers.set(
        city ? INTRO_LAYERS.city : id >= 9 ? INTRO_LAYERS.auditorium : INTRO_LAYERS.exterior,
      );
      mesh.castShadow =
        (city && id !== 6 && id !== CITY_TRAFFIC_MATERIAL) ||
        id === 1 ||
        id === 2 ||
        (id >= 9 && id < 14 && id !== 11) ||
        id === 19 ||
        id === 22;
      mesh.receiveShadow = city || id === 1 || id === 2 || id >= 9;
      (id === 0 ? mark : world).add(mesh);
    }
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
