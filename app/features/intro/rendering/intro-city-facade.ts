import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
} from "three";

function noise(column: number, floor: number): number {
  const value = Math.sin(column * 127.1 + floor * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function panel(context: CanvasRenderingContext2D, column: number, floor: number) {
  const x = column * 64;
  const y = floor * 32;
  const suiteWidth = 3 + Math.floor(noise(floor, 31) * 5);
  const suite = Math.floor((column + (floor % 3)) / suiteWidth);
  const group = noise(suite, floor);
  const block = noise(Math.floor(column / 8), Math.floor(floor / 12));
  const serviceFloor = floor % 17 === 0;
  const occupied = !serviceFloor && group > (block > 0.55 ? 0.73 : 0.87);
  const lighting = 36 + Math.round(noise(suite + 31, floor) ** 1.6 * 152);
  const temperature = noise(suite + 19, floor);
  const tint = temperature < 0.36 ? 62 : temperature > 0.85 ? 170 : 118;
  // RGB stores coverage, suite radiance and temperature, never painted reflections.
  // RGB 存储覆盖率、套间辐射和色温，绝不绘制固定反射。
  context.fillStyle = `rgb(255, 0, ${tint})`;
  context.fillRect(x, y, 64, 32);
  if (occupied) {
    const radiance = Math.round(lighting * (0.8 + noise(column + 41, floor) * 0.2));
    const light = context.createLinearGradient(0, y, 0, y + 32);
    light.addColorStop(0, `rgb(255, ${Math.round(radiance * 0.7)}, ${tint})`);
    light.addColorStop(0.32, `rgb(255, ${radiance}, ${tint})`);
    light.addColorStop(1, `rgb(255, ${Math.round(radiance * 0.38)}, ${tint})`);
    context.fillStyle = light;
    context.fillRect(x, y, 64, 32);
    if (noise(column + 41, floor) > 0.78) {
      context.fillStyle = `rgb(255, ${Math.round(radiance * 0.14)}, ${tint})`;
      context.fillRect(x, y, 64, 4 + Math.floor(noise(column, floor + 41) * 12));
    }
  }
  // Thin dark mullions preserve continuous reflections without heavy horizontal belts.
  // 深色细竖梃保留连续反射，不铺设粗重的水平饰带。
  context.fillStyle = `rgb(0, 0, ${tint})`;
  context.fillRect(x, y, 2.4, 32);
  context.fillStyle = `rgb(16, 0, ${tint})`;
  context.fillRect(x, y + 31.2, 64, 0.8);
}

/**
 * Build one RGB data atlas; sparse, grouped room interiors remain readable after minification.
 * 一次生成 RGB 数据图集；稀疏成组的室内空间在缩小时仍保持可读。
 */
export function createFacadeTexture(anisotropy = 1): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2048;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create the intro facade atlas");
  context.fillStyle = "rgb(255, 0, 118)";
  context.fillRect(0, 0, 2048, 2048);
  for (let floor = 0; floor < 64; floor++) {
    for (let column = 0; column < 32; column++) panel(context, column, floor);
    if (floor % 17 === 0) {
      context.fillStyle = "rgb(12, 0, 118)";
      context.fillRect(0, floor * 32 + 30.7, 2048, 1.3);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.name = "intro-facade-data";
  texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(4, anisotropy);
  // Match the original unflipped data upload; the shader applies the facade repeat.
  // 对齐原有不翻转的数据上传，由着色器应用立面重复比例。
  texture.flipY = false;
  return texture;
}

// Ray-box interiors use the actual face frame; minification converges to suite radiance.
// 射线盒室内使用真实立面坐标系，缩小时收敛为套间平均辐射。
export const FACADE_DECLARATIONS = `
float introRoomInterior(vec2 bay, vec3 faceNormal, vec3 tangent, vec3 viewDirection, float footprint) {
  vec3 origin = vec3(fract(bay), 0.0);
  vec3 down = normalize(cross(tangent, faceNormal));
  vec3 ray = vec3(-dot(viewDirection, tangent) / 72.0, -dot(viewDirection, down) / 96.0, max(abs(dot(viewDirection, faceNormal)), 0.025) / 120.0);
  vec3 safeRay = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), ray)) * max(abs(ray), vec3(0.00001));
  vec3 distanceToWall = (step(vec3(0.0), ray) - origin) / safeRay;
  float distanceInside = min(distanceToWall.x, min(distanceToWall.y, distanceToWall.z));
  vec3 hit = clamp(origin + ray * distanceInside, 0.0, 1.0);
  float filterWidth = clamp(footprint * 0.7, 0.015, 0.25);
  float backWall = step(distanceToWall.z, min(distanceToWall.x, distanceToWall.y));
  float ceiling = (1.0 - backWall) * step(distanceToWall.y, distanceToWall.x) * (1.0 - step(0.5, hit.y));
  float floorSurface = (1.0 - backWall) * step(distanceToWall.y, distanceToWall.x) * step(0.5, hit.y);
  float radiance = mix(0.36, 0.76, backWall) + ceiling * 0.55 - floorSurface * 0.20;
  float desk = smoothstep(0.59 - filterWidth, 0.59 + filterWidth, hit.y) * (1.0 - smoothstep(0.77 - filterWidth, 0.77 + filterWidth, hit.y));
  desk *= smoothstep(0.08, 0.08 + filterWidth, hit.x) * (1.0 - smoothstep(0.88 - filterWidth, 0.88, hit.x));
  float chair = (1.0 - smoothstep(0.11, 0.11 + filterWidth, abs(hit.x - 0.64))) * smoothstep(0.47, 0.47 + filterWidth, hit.y);
  radiance *= 1.0 - backWall * max(desk * 0.72, chair * 0.80);
  float ceilingLight = (1.0 - smoothstep(0.22, 0.22 + filterWidth, abs(hit.x - 0.5))) * (1.0 - smoothstep(0.25, 0.25 + filterWidth, abs(hit.z - 0.52)));
  radiance += ceiling * ceilingLight * 1.25;
  return mix(0.58, radiance, 1.0 - smoothstep(0.10, 0.46, footprint));
}
`;

export const FACADE_SURFACE = `
vec3 introFaceNormal = normalize(vIntroNormal);
float introVertical = 1.0 - smoothstep(0.35, 0.85, abs(introFaceNormal.y));
vec3 introTangent = normalize(vec3(introFaceNormal.z, 0.0, -introFaceNormal.x) + vec3(0.00001, 0.0, 0.0));
vec3 introAnchor = vec3(vIntroWorld.x, -vIntroWorld.y, vIntroAlong);
float introFace = floor(dot(introAnchor, introFaceNormal) * 0.1 + 0.01);
vec2 introShift = floor(vec2(introGrain(vec2(introFace, 1.0)), introGrain(vec2(introFace, 7.0))) * vec2(32.0, 64.0));
vec3 introDown = normalize(cross(introTangent, introFaceNormal));
vec2 introBay = vec2(dot(introAnchor, introTangent) / 72.0, dot(introAnchor, introDown) / 96.0) + introShift;
introFacadeData = texture2D(uIntroFacade, introBay / vec2(32.0, 64.0)).rgb;
introWindows = introFacadeData.r * introVertical;
float introPaneVariation = introGrain(floor(introBay)) - 0.5;
float introRoomEnergy = dot(uIntroOffice, vec3(0.2126, 0.7152, 0.0722));
vec3 introNeutralRoom = mix(vec3(introRoomEnergy), uIntroOffice, 0.10);
vec3 introCoolRoom = introNeutralRoom * vec3(0.84, 0.96, 1.12);
vec3 introWarmRoom = introNeutralRoom * vec3(1.22, 0.91, 0.62);
introOfficeTint = mix(introCoolRoom, introWarmRoom, 1.0 - smoothstep(0.28, 0.65, introFacadeData.b));
float introBayFootprint = max(length(dFdx(introBay)), length(dFdy(introBay)));
if (introFacadeData.g > 0.001 && introWindows > 0.001) {
  vec3 introWorldPosition = vec3(vIntroWorld.x, -vIntroWorld.y, vIntroWorld.z);
  vec3 introViewDirection = normalize(cameraPosition - introWorldPosition);
  float introRoom = 0.58;
  if (uIntroNight > 0.001 && introBayFootprint < 0.46) {
    introRoom = introRoomInterior(introBay, introFaceNormal, introTangent, introViewDirection, introBayFootprint);
  }
  float introRoomTransmission = 1.0 - 0.78 * pow(1.0 - abs(dot(introViewDirection, introFaceNormal)), 5.0);
  introFacadeData.g *= introRoom * introRoomTransmission;
}
// A silver-blue metal film reflects the environment across the entire glazed area.
// 银蓝色金属薄膜让整片玻璃反射环境，接缝和屋面保持原有材质。
vec3 introPane = uIntroGlass * (1.0 + introPaneVariation * 0.045);
vec3 introMullion = uIntroMineral * 0.13;
vec3 introCladding = mix(introMullion, introPane, introWindows);
diffuseColor.rgb = mix(diffuseColor.rgb, introCladding, introVertical);
introWindowRelief = sin(introBay.x * 6.283185) * sin(introBay.y * 6.283185) * 0.018 * introWindows * (1.0 - smoothstep(0.10, 0.46, introBayFootprint));
`;

export const FACADE_OPTICS = `
if (introSelector == 5.0 || introSelector == 5.4 || introSelector == 5.8 || introSelector == 8.0) {
  material.specularColor *= mix(0.40, 1.0, introWindows);
  material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
  material.specularF90 *= mix(0.45, 1.0, introWindows);
  #ifdef USE_CLEARCOAT
    material.clearcoat *= introWindows;
  #endif
}
`;
