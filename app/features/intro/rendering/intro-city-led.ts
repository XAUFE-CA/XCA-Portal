import { JOURNEY } from "../core/intro-geometry";
import { face, type Volume } from "./intro-city-primitives";

export const CITY_LED_MATERIAL = 8.2;
export const CITY_LED_FRAME_MATERIAL = 8.3;
export const CITY_LED_PORTRAIT_U = 2;
export const CITY_LED_PATTERN_U = 4;
export const CITY_LED_VARIANTS = 6;
export const CITY_LED_UV = Object.freeze([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0] as const);

function panel(
  vertices: number[],
  shell: Volume,
  side: -1 | 0 | 1,
  portrait: boolean,
  inset: number,
) {
  const height = shell.bottom - shell.top;
  const margin = (shell.bevel ?? 0) + 36;
  const aspect = portrait ? 9 / 16 : 16 / 9;
  const width = Math.min(
    (side === 0 ? shell.width : shell.depth) - margin * 2,
    height * 0.7 * aspect,
  );
  const screenHeight = width / aspect;
  const top = Math.min(shell.top + height * inset, shell.bottom - screenHeight - margin);
  const bottom = top + screenHeight;
  const nx = side;
  const nz = side === 0 ? 1 : 0;
  const wallX = shell.x + (nx * shell.width) / 2;
  const wallZ = shell.z + (nz * shell.depth) / 2;
  const x = wallX + nx * 40;
  const z = wallZ + nz * 40;
  const dx = (nz * width) / 2;
  const dz = (-nx * width) / 2;
  // The display closes the casing front; the hidden rear stays inside the building.
  // 显示面封闭壳体正面，隐藏的背面位于楼体内部。
  const a = [x - dx, top, z - dz] as const;
  const b = [x + dx, top, z + dz] as const;
  const c = [x + dx, bottom, z + dz] as const;
  const d = [x - dx, bottom, z - dz] as const;
  const rearA = [a[0] - nx * 60, top, a[2] - nz * 60] as const;
  const rearB = [b[0] - nx * 60, top, b[2] - nz * 60] as const;
  const rearC = [c[0] - nx * 60, bottom, c[2] - nz * 60] as const;
  const rearD = [d[0] - nx * 60, bottom, d[2] - nz * 60] as const;
  face(vertices, [a, rearA, rearB, b], CITY_LED_FRAME_MATERIAL);
  face(vertices, [b, rearB, rearC, c], CITY_LED_FRAME_MATERIAL);
  face(vertices, [d, c, rearC, rearD], CITY_LED_FRAME_MATERIAL);
  face(vertices, [a, d, rearD, rearA], CITY_LED_FRAME_MATERIAL);
  vertices.push(x - dx, top, z - dz, nx, 0, nz, CITY_LED_MATERIAL);
  vertices.push(x + dx, top, z + dz, nx, 0, nz, CITY_LED_MATERIAL);
  vertices.push(x + dx, bottom, z + dz, nx, 0, nz, CITY_LED_MATERIAL);
  vertices.push(x - dx, top, z - dz, nx, 0, nz, CITY_LED_MATERIAL);
  vertices.push(x + dx, bottom, z + dz, nx, 0, nz, CITY_LED_MATERIAL);
  vertices.push(x - dx, bottom, z - dz, nx, 0, nz, CITY_LED_MATERIAL);
}

/**
 * Large paired displays face the approach and the road without replacing the whole facade.
 * 成对大屏朝向来路与道路，不替换整片玻璃立面。
 */
export function appendCityLed(
  vertices: number[],
  shell: Volume,
  portrait: boolean,
  inset = 0.07,
): void {
  panel(vertices, shell, 0, portrait, inset);
  panel(vertices, shell, shell.x < JOURNEY.roadX ? 1 : -1, portrait, inset);
}
