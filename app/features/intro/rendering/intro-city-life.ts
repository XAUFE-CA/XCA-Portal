import { JOURNEY } from "../core/intro-geometry";
import { CITY_GROUND } from "./intro-city-layout";
import { prism } from "./intro-city-primitives";

export const CITY_LIFE_MATERIAL = 8.1;
export const CITY_TRAFFIC_MATERIAL = 8.4;
export const CITY_TRAFFIC_SWAY = 540;

// Every vertex of a vehicle resolves the same street cell before any displacement.
// 每辆车的所有顶点在位移前都解析为同一个街道单元。
export const CITY_LIFE_VERTEX = `
if (float(INTRO_MATERIAL) == 8.4) {
  float introTrafficSide = sign(transformed.x - ${JOURNEY.roadX.toFixed(1)});
  float introTrafficColumn = floor((abs(transformed.x - ${JOURNEY.roadX.toFixed(1)}) - 3500.0) / 3000.0 + 0.5);
  float introTrafficRow = floor((transformed.z + 2000.0) / 3200.0 + 0.5);
  float introTrafficPace = 8000.0 + mod(abs(introTrafficRow) + introTrafficColumn * 2.0, 5.0) * 1700.0;
  float introTrafficTravel = max(uIntroTravel - uIntroEye.z, 0.0);
  transformed.z += introTrafficSide * ${CITY_TRAFFIC_SWAY.toFixed(1)} * (1.0 - exp(-introTrafficTravel / introTrafficPace));
}
`;

export const CITY_LIFE_SURFACE = `
if (introSelector == 8.1 || introSelector == 8.4) {
  float introLifeChoice = mod(floor(abs(vIntroWorld.x - ${JOURNEY.roadX.toFixed(1)}) / 160.0) + floor(vIntroAlong / 240.0), 4.0);
  vec3 introLifeTint = mix(uIntroLedWarm, uIntroLedRose, step(0.5, introLifeChoice));
  introLifeTint = mix(introLifeTint, uIntroLedGreen, step(1.5, introLifeChoice));
  introLifeTint = mix(introLifeTint, uIntroLedBlue, step(2.5, introLifeChoice));
  if (introSelector == 8.1) {
    float introShop = step(${((CITY_GROUND - 260) / 320).toFixed(5)}, vIntroUv.y);
    diffuseColor.rgb = mix(mix(introLifeTint, uIntroOffice, 0.3), uIntroLedWarm, introShop);
  } else {
    float introCarGlass = 1.0 - step(${((CITY_GROUND - 43) / 320).toFixed(5)}, vIntroUv.y);
    diffuseColor.rgb = mix(mix(introLifeTint, uIntroOffice, 0.24), uIntroLedBlue * 0.22, introCarGlass);
  }
}
`;

export const CITY_LIFE_EMISSION = `
if (introSelector == 8.1) {
  float introShopGlow = step(${((CITY_GROUND - 260) / 320).toFixed(5)}, vIntroUv.y) * step(0.7, abs(vIntroNormal.z));
  totalEmissiveRadiance += uIntroLedWarm * introShopGlow * mix(0.10, 1.15, uIntroNight);
} else if (introSelector == 8.4) {
  float introHeadlight = step(${((CITY_GROUND - 33) / 320).toFixed(5)}, vIntroUv.y) * (1.0 - step(${((CITY_GROUND - 23) / 320).toFixed(5)}, vIntroUv.y));
  totalEmissiveRadiance += uIntroOffice * introHeadlight * step(0.9, abs(vIntroNormal.z)) * mix(0.08, 0.9, uIntroNight);
}
`;

function furniture(
  vertices: number[],
  x: number,
  z: number,
  roof: number,
  width: number,
  depth: number,
  height: number,
  material = CITY_LIFE_MATERIAL,
) {
  prism(vertices, {
    x,
    z,
    width,
    depth,
    top: roof - height,
    bottom: roof,
    material,
    bottomFace: false,
  });
}

function person(vertices: number[], x: number, z: number, roof: number) {
  furniture(vertices, x, z, roof - 34, 32, 25, 50);
  furniture(vertices, x, z, roof - 84, 25, 25, 25);
  for (const side of [-1, 1]) furniture(vertices, x + side * 9, z, roof, 12, 16, 34, 5.2);
}

/**
 * Cafe furniture sits directly on the approach-side low roof, outside the bridge corridor.
 * 咖啡座直接落在来路一侧的低层屋顶上，避开桥梁通道。
 */
export function appendCityTerrace(vertices: number[], x: number, z: number, roof: number) {
  furniture(vertices, x + 110, z - 80, roof, 12, 12, 215, 5.2);
  prism(vertices, {
    x: x + 110,
    z: z - 80,
    width: 340,
    depth: 310,
    top: roof - 240,
    bottom: roof - 205,
    topScale: 0.16,
    material: CITY_LIFE_MATERIAL,
    bottomFace: false,
  });
  furniture(vertices, x + 110, z - 80, roof, 24, 24, 80, 5.2);
  furniture(vertices, x + 110, z - 80, roof - 74, 135, 105, 12);
  for (const side of [-1, 1]) {
    furniture(vertices, x + 110 + side * 105, z - 80, roof, 46, 58, 45, 5.2);
    furniture(vertices, x + side * 310, z + 240, roof, 120, 90, 54, 5.2);
    furniture(vertices, x + side * 310, z + 240, roof - 54, 108, 80, 70, 5.9);
  }
  person(vertices, x - 180, z + 70, roof);
  person(vertices, x - 110, z + 105, roof);
}
