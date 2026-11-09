import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Vector3,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import {
  ARRIVAL_ENTRY,
  JOURNEY,
  ROAD_MATERIALIZATION,
  SCENERY_REVEAL,
} from "../core/intro-geometry";
import { createFacadeTexture } from "./intro-city-facade";
import type { IntroPalette } from "./intro-scene-palette";

export interface IntroFrame {
  fill: { value: number };
  growth: { value: number };
  entry: { value: number };
  arrival: { value: number };
  travel: { value: number };
  eye: { value: Vector3 };
}

type IntroMaterial = MeshBasicMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
interface FrameUniforms {
  uIntroFill: IntroFrame["fill"];
  uIntroGrowth: IntroFrame["growth"];
  uIntroEntry: IntroFrame["entry"];
  uIntroArrival: IntroFrame["arrival"];
  uIntroTravel: IntroFrame["travel"];
  uIntroEye: IntroFrame["eye"];
}

export interface IntroMaterials {
  get(selector: number): IntroMaterial;
  update(palette: IntroPalette): void;
  dispose(): void;
}

const DECLARATIONS = `
uniform float uIntroFill;
uniform float uIntroGrowth;
uniform float uIntroEntry;
uniform float uIntroArrival;
uniform float uIntroTravel;
uniform vec3 uIntroEye;
varying vec3 vIntroWorld;
varying vec3 vIntroNormal;
varying vec2 vIntroUv;
varying float vIntroAcross;
varying float vIntroAlong;
`;

const VERTEX_DECLARATIONS = `
attribute float roadAcross;
attribute float introAlong;
`;

const WORLD_COORDINATES = `
vec3 introWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vIntroWorld = vec3(introWorld.x, -introWorld.y, introWorld.z);
vIntroNormal = mat3(modelMatrix) * normal;
vIntroUv = uv;
vIntroAcross = roadAcross;
vIntroAlong = introAlong;
`;

// The aperture clips visibility without altering the room's physical shadow casters.
// 门洞只裁切可见性，不改变报告厅物理阴影的遮挡体。
const CLIPPING = `
float introSelector = float(INTRO_MATERIAL);
float introVisibility = 1.0;
float introRoadDepth = (${JOURNEY.roadStart.toFixed(1)} - vIntroAlong) / ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)};
if (introSelector > 8.5) {
  vec3 introCenter = vec3(${JOURNEY.roadX.toFixed(1)}, ${(JOURNEY.floorY - ARRIVAL_ENTRY.height / 2).toFixed(1)}, ${ARRIVAL_ENTRY.front.toFixed(1)} + uIntroTravel);
  vec3 introEye = (uIntroEye - introCenter) / ${ARRIVAL_ENTRY.width.toFixed(1)};
  vec3 introPoint = (vIntroWorld - introCenter) / ${ARRIVAL_ENTRY.width.toFixed(1)};
  if (introEye.z > 0.0) {
    if (uIntroEntry <= 0.0 || introPoint.z > 0.0) discard;
    float introDistance = introEye.z - introPoint.z;
    vec2 introRay = introPoint.xy * introEye.z - introEye.xy * introPoint.z;
    vec2 introBounds = vec2(0.5, ${(ARRIVAL_ENTRY.height / ARRIVAL_ENTRY.width / 2).toFixed(9)}) * uIntroEntry;
    if (min(introBounds.x * introDistance - abs(introRay.x), introBounds.y * introDistance - abs(introRay.y)) < 0.0) discard;
  }
  if (introSelector > 13.5 && introSelector < 15.5 && introRoadDepth > uIntroGrowth) discard;
} else if (introSelector < 0.5) {
  introVisibility = uIntroFill;
} else if (introSelector < 1.5) {
  float introFront = (uIntroGrowth - introRoadDepth) * ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)};
  introVisibility = smoothstep(0.0, ${ROAD_MATERIALIZATION.reach.toFixed(3)}, uIntroGrowth) * smoothstep(0.0, ${ROAD_MATERIALIZATION.feather.toFixed(1)}, introFront);
} else if (introSelector < 4.5) {
  introVisibility = smoothstep(introRoadDepth + ${SCENERY_REVEAL.start.toFixed(3)}, introRoadDepth + ${(SCENERY_REVEAL.start + SCENERY_REVEAL.span).toFixed(3)}, uIntroGrowth);
} else if (abs(introSelector - 7.0) < 0.1) {
  introVisibility = uIntroArrival;
}
if (introVisibility < 0.001) discard;
`;

const SURFACE_DECLARATIONS = `
uniform sampler2D uIntroFacade;
uniform vec3 uIntroGlass;
uniform vec3 uIntroOffice;
uniform vec3 uIntroSignal;
uniform vec3 uIntroSecondary;
uniform float uIntroNight;
float introGrain(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}
float introNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  vec2 a = cell.xy + cell.z * vec2(37.0, 19.0);
  vec2 b = a + vec2(37.0, 19.0);
  float low = mix(mix(introGrain(a), introGrain(a + vec2(1.0, 0.0)), t.x), mix(introGrain(a + vec2(0.0, 1.0)), introGrain(a + vec2(1.0)), t.x), t.y);
  float high = mix(mix(introGrain(b), introGrain(b + vec2(1.0, 0.0)), t.x), mix(introGrain(b + vec2(0.0, 1.0)), introGrain(b + vec2(1.0)), t.x), t.y);
  return mix(low, high, t.z);
}
`;

const SURFACE = `
float introWindows = 0.0;
vec3 introFacadeData = vec3(0.0);
vec3 introOfficeTint = uIntroOffice;
float introDetail = 1.0 - smoothstep(0.0008, 0.003, max(length(dFdx(vIntroUv)), length(dFdy(vIntroUv))));
float introFinish = introGrain(floor(vIntroUv * vec2(145.0, 190.0))) - 0.5;
float introGuide = 0.0;
if (introSelector > 4.5 && introSelector < 8.5 && abs(introSelector - 7.0) > 0.1 && (introSelector < 5.5 || introSelector > 7.5)) {
  introFacadeData = texture2D(uIntroFacade, vIntroUv * vec2(0.217014, 0.052083)).rgb;
  float introVertical = 1.0 - smoothstep(0.35, 0.85, abs(normalize(vIntroNormal).y));
  float introAlloy = 1.0 - smoothstep(0.06, 0.16, abs(introSelector - 5.2));
  introWindows = introFacadeData.r * introVertical * (1.0 - introAlloy);
  float introRoomEnergy = dot(uIntroOffice, vec3(0.2126, 0.7152, 0.0722));
  vec3 introNeutralRoom = mix(vec3(introRoomEnergy), uIntroOffice, 0.18);
  vec3 introCoolRoom = mix(introNeutralRoom * vec3(0.78, 0.92, 1.0), uIntroSignal, 0.10);
  vec3 introWarmRoom = introNeutralRoom * vec3(1.12, 0.84, 0.54);
  float introWarm = 1.0 - smoothstep(0.18, 0.30, introFacadeData.b);
  float introAccent = smoothstep(0.78, 0.90, introFacadeData.b);
  introOfficeTint = mix(introCoolRoom, introWarmRoom, introWarm);
  introOfficeTint = mix(introOfficeTint, uIntroSecondary, introAccent * 0.38);
  float introFacadeVariation = introNoise(vIntroWorld * vec3(0.0007, 0.0004, 0.0007));
  float introFloorVariation = introNoise(vec3(vIntroUv.x * 0.35, floor(vIntroUv.y * 3.333333), 4.0));
  float introElevation = clamp((vIntroWorld.y + ${(JOURNEY.floorY + JOURNEY.cityDrop).toFixed(1)}) / 4600.0, 0.0, 1.0);
  float introBlockTint = introNoise(floor(vIntroWorld * 0.00035));
  diffuseColor.rgb *= mix(0.82, 1.06, introElevation);
  diffuseColor.rgb *= 0.82 + introFacadeVariation * 0.2 + introBlockTint * 0.1 + introFinish * 0.02;
  vec3 introPane = uIntroGlass * (0.64 + introFacadeVariation * 0.2 + introFloorVariation * 0.12);
  diffuseColor.rgb = mix(diffuseColor.rgb, introPane, introWindows);
} else if (introSelector > 5.55 && introSelector < 5.75) {
  vec2 introStreet = vec2(vIntroWorld.x - ${JOURNEY.roadX.toFixed(1)}, vIntroAlong);
  float introGx = abs(mod(abs(introStreet.x) - 2000.0, 3000.0) - 1500.0);
  if (abs(introStreet.x) < 2000.0) introGx = abs(abs(introStreet.x) - 800.0);
  float introGz = abs(mod(-introStreet.y - 2000.0, 3200.0) - 1600.0);
  if (introSelector < 5.65) {
    float introLaneX = (1.0 - smoothstep(5.0, 12.0, introGx)) * step(0.45, fract(-introStreet.y / 260.0)) * smoothstep(240.0, 300.0, introGz);
    float introLaneZ = (1.0 - smoothstep(5.0, 12.0, introGz)) * step(0.45, fract(introStreet.x / 260.0)) * smoothstep(240.0, 300.0, introGx);
    float introCrossing = step(248.0, introGz) * (1.0 - step(440.0, introGz)) * (1.0 - step(190.0, introGx)) * step(0.5, fract(introStreet.x / 70.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uIntroOffice, clamp(introLaneX + introLaneZ + introCrossing, 0.0, 1.0) * introDetail * mix(0.48, 0.20, uIntroNight));
  } else {
    vec2 introJoints = abs(fract(introStreet / 100.0) - 0.5);
    diffuseColor.rgb *= 1.0 - max(smoothstep(0.47, 0.5, introJoints.x), smoothstep(0.47, 0.5, introJoints.y)) * introDetail * 0.14;
  }
} else if (abs(introSelector - 1.0) < 0.1) {
  float introAcross = min(vIntroAcross, 1.0 - vIntroAcross);
  float introInlay = smoothstep(0.050, 0.051, introAcross) * (1.0 - smoothstep(0.052, 0.053, introAcross));
  float introStrip = smoothstep(0.078, 0.079, introAcross) * (1.0 - smoothstep(0.081, 0.082, introAcross));
  float introSegment = smoothstep(0.10, 0.18, fract(introRoadDepth * 18.0)) * (1.0 - smoothstep(0.78, 0.86, fract(introRoadDepth * 18.0)));
  float introPulse = pow(max(0.0, sin(introRoadDepth * 42.0 - uIntroGrowth * 8.0)), 8.0);
  introGuide = introInlay * 0.07 + introStrip * introSegment * (0.12 + introPulse * 0.14);
  float introJoint = smoothstep(0.47, 0.495, abs(fract(introRoadDepth * 72.0) - 0.5));
  diffuseColor.rgb *= 1.0 + introFinish * 0.055 * introDetail - introJoint * 0.075 * introDetail;
} else if (introSelector > 8.5) {
  float introWeave = sin(vIntroUv.x * 1500.0) * sin(vIntroUv.y * 1200.0);
  float introFabric = abs(introSelector - 10.0) < 0.1 ? introWeave * 0.025 : 0.0;
  diffuseColor.rgb *= 1.0 + (introFinish * 0.035 + introFabric) * introDetail;
}
diffuseColor.a *= introVisibility;
`;

const ROUGHNESS = `
if (introWindows > 0.0) {
  roughnessFactor = mix(roughnessFactor, 0.48 + introFacadeData.r * 0.14, introWindows);
}
roughnessFactor = clamp(roughnessFactor + introFinish * introDetail * 0.035, 0.18, 1.0);
`;

const EMISSION = `
if (introWindows > 0.0) {
  totalEmissiveRadiance += introOfficeTint * introFacadeData.g * introWindows * mix(0.025, 1.15, uIntroNight);
}
if (introGuide > 0.0) {
  totalEmissiveRadiance += mix(uIntroSignal, uIntroSecondary, 0.12) * introGuide * 0.72;
}
`;

// Screen-space surface gradients perturb the real PBR normal, not the final color.
// 屏幕空间表面梯度扰动真实 PBR 法线，而非最终颜色。
const MICRO_NORMAL = `
if (abs(introSelector - 1.0) < 0.1 || abs(introSelector - 9.0) < 0.1 || abs(introSelector - 10.0) < 0.1 || abs(introSelector - 12.0) < 0.1 || abs(introSelector - 14.0) < 0.1) {
  vec3 introAnchor = vec3(vIntroWorld.xy, vIntroAlong);
  float introFrequency = abs(introSelector - 10.0) < 0.1 ? 3.5 : 0.75;
  float introFootprint = max(length(dFdx(introAnchor)), length(dFdy(introAnchor))) * introFrequency;
  float introMicroFilter = 1.0 - smoothstep(0.35, 1.2, introFootprint);
  float introHeight = introNoise(introAnchor * introFrequency) * (introSelector < 1.5 ? 0.16 : 0.07);
  if (abs(introSelector - 10.0) < 0.1 || abs(introSelector - 12.0) < 0.1) {
    introHeight = (sin(introAnchor.x * introFrequency) + sin(introAnchor.y * introFrequency) + sin(introAnchor.z * introFrequency)) * 0.025;
  }
  introHeight *= introMicroFilter;
  vec3 introDx = dFdx(-vViewPosition);
  vec3 introDy = dFdy(-vViewPosition);
  vec3 introRx = cross(introDy, normal);
  vec3 introRy = cross(normal, introDx);
  float introDet = dot(introDx, introRx) * faceDirection;
  vec3 introGradient = sign(introDet) * (dFdx(introHeight) * introRx + dFdy(introHeight) * introRy);
  normal = normalize(max(abs(introDet), 1e-8) * normal - introGradient);
}
`;

function frameUniforms(frame: IntroFrame) {
  return {
    uIntroFill: frame.fill,
    uIntroGrowth: frame.growth,
    uIntroEntry: frame.entry,
    uIntroArrival: frame.arrival,
    uIntroTravel: frame.travel,
    uIntroEye: frame.eye,
  };
}

function installCoordinates(shader: WebGLProgramParametersWithUniforms, uniforms: FrameUniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${DECLARATIONS}${VERTEX_DECLARATIONS}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${WORLD_COORDINATES}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${DECLARATIONS}`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\n${CLIPPING}`,
    );
}

function buildMaterial(selector: number): IntroMaterial {
  let material: IntroMaterial;
  if (selector === 0) {
    material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, vertexColors: true });
  } else if (selector === 4) {
    material = new MeshPhysicalMaterial({
      roughness: 0.34,
      transmission: 0.48,
      ior: 1.46,
      thickness: 5,
      opacity: 0.68,
    });
  } else if (selector === 5.4 || selector === 5.8) {
    material = new MeshPhysicalMaterial({
      roughness: selector === 5.4 ? 0.52 : 0.68,
      metalness: 0.03,
      specularIntensity: selector === 5.4 ? 0.32 : 0.22,
      clearcoat: selector === 5.4 ? 0.035 : 0.02,
      clearcoatRoughness: 0.58,
    });
  } else if (selector === 10 || selector === 12) {
    // Acoustic panels read as frosted glass; seats keep their woven fabric.
    // 声学板采用磨砂玻璃观感，座椅保留织物纹理。
    material = new MeshPhysicalMaterial({
      roughness: selector === 10 ? 0.82 : 0.34,
      sheen: selector === 10 ? 0.35 : 0.22,
      sheenRoughness: 0.8,
      clearcoat: selector === 12 ? 0.9 : 0,
      clearcoatRoughness: selector === 12 ? 0.24 : 0.18,
      ior: 1.5,
      specularIntensity: selector === 12 ? 1 : 0.5,
    });
  } else if (selector === 16) {
    material = new MeshPhysicalMaterial({
      roughness: 0.07,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      ior: 1.5,
      specularIntensity: 1,
      iridescence: 0.16,
    });
  } else if (selector === 13) {
    material = new MeshPhysicalMaterial({
      roughness: 0.22,
      metalness: 0.72,
      anisotropy: 0.18,
      anisotropyRotation: Math.PI / 2,
      clearcoat: 0.4,
      clearcoatRoughness: 0.12,
    });
  } else if (selector === 5.2 || selector === 2) {
    material = new MeshPhysicalMaterial({
      roughness: selector === 5.2 ? 0.9 : 0.74,
      metalness: selector === 5.2 ? 0.08 : 0.24,
      anisotropy: selector === 5.2 ? 0 : 0.22,
      anisotropyRotation: Math.PI / 2,
    });
  } else {
    let roughness = selector >= 9 ? 0.68 : 0.55;
    let metalness = 0.04;
    if (selector === 1) roughness = 0.76;
    if (selector === 14) {
      roughness = 0.2;
      metalness = 0.12;
    }
    if (selector === 5.6 || selector === 5.9) roughness = 0.94;
    if (selector === 5.7) roughness = 0.86;
    material =
      selector === 14
        ? new MeshPhysicalMaterial({
            roughness,
            metalness,
            clearcoat: 0.9,
            clearcoatRoughness: 0.1,
          })
        : new MeshStandardMaterial({ roughness, metalness });
  }
  material.name = `intro-pbr-${selector}`;
  material.side = material.shadowSide = DoubleSide;
  material.dithering = true;
  material.fog = selector > 0 && selector < 9;
  material.transparent = selector < 4.5 || selector === 7;
  material.depthWrite = selector !== 4 && selector !== 7;
  material.forceSinglePass = true;
  material.defines = { ...material.defines, INTRO_MATERIAL: selector };
  if (selector === 7) material.opacity = 0.65;
  return material;
}

function updateMaterial(material: IntroMaterial, selector: number, palette: IntroPalette) {
  // The CA face follows the theme foreground instead of architectural lighting.
  // CA 正面取主题前景色，不随建筑光照变化。
  if (material instanceof MeshBasicMaterial) {
    material.color.copy(palette.brand);
    return;
  }
  const daylight = palette.daylight;
  if (selector >= 9) {
    const room = palette.auditorium;
    const fabric = selector === 10;
    const panel = selector === 12;
    const glass = selector === 16;
    material.color.copy(
      glass
        ? room.glass
        : panel
          ? room.panel
          : fabric
            ? room.fabric
            : selector === 13
              ? room.alloy
              : selector === 14
                ? room.floor
                : room.structure,
    );
    material.emissive.setRGB(0, 0, 0);
    // Brighter reflections separate clear glazing, frosted panels, metal and polished floor.
    // 更高的反射强度区分清透玻璃、磨砂板、金属与抛光地面。
    material.envMapIntensity = glass
      ? 1.3
      : panel
        ? 1.0
        : fabric
          ? 0.3
          : selector === 13
            ? 1.1
            : selector === 14
              ? 1.25
              : 0.7;
    if (selector === 13) material.color.lerp(room.accentLight, 0.12);
    if (selector === 14) material.color.lerp(room.accentLight, 0.05);
    if (material instanceof MeshPhysicalMaterial) {
      material.sheenColor.copy(selector === 10 ? room.fabric : room.panel);
      if (panel || glass) material.specularColor.copy(room.glass);
    }
    if (selector === 11 || selector === 18) {
      material.color.copy(room.accentLight);
      material.emissive.copy(room.accentLight);
      material.emissiveIntensity = 1.15;
    }
    return;
  }
  material.emissive.setRGB(0, 0, 0);
  material.envMapIntensity = 0.2 + daylight * 0.16;
  if (selector === 1 || selector === 5.6) {
    material.color.copy(palette.pavement).multiplyScalar(0.62 + daylight * 0.32);
    material.envMapIntensity = 0.1 + daylight * 0.16;
  } else if (selector === 4 || selector === 5.4) {
    material.color.copy(palette.glazing);
    if (selector === 4) material.color.lerp(palette.accentLight, 0.12);
    material.envMapIntensity = selector === 4 ? 0.32 : 0.15 + daylight * 0.16;
  } else if (selector === 2 || selector === 5.2) {
    material.color
      .copy(selector === 5.2 ? palette.architecture : palette.alloy)
      .multiplyScalar(selector === 5.2 ? 0.66 + daylight * 0.16 : 0.46 + daylight * 0.26);
    material.envMapIntensity = selector === 5.2 ? 0.055 + daylight * 0.045 : 0.14;
  } else if (selector === 5.7) {
    material.color
      .copy(palette.pavement)
      .lerp(palette.architecture, 0.16)
      .multiplyScalar(0.78 + daylight * 0.12);
  } else if (selector === 5.9) {
    material.color.copy(palette.pavement).lerp(palette.glazing, 0.18);
    material.envMapIntensity = 0.16;
  } else {
    material.color.copy(palette.architecture).multiplyScalar(selector === 8 ? 0.76 : 1);
    if (selector === 5.8) material.color.lerp(palette.alloy, 0.18);
  }
  if (material instanceof MeshPhysicalMaterial) material.sheenColor.copy(palette.fabric);
  // Light sources retain colored radiance; reflective roofs never share their emission.
  // 光源保留彩色辐射，反射屋面不会共用光源的自发光。
  if (selector === 3 || selector === 6 || selector === 7) {
    material.color.copy(palette.accentLight).lerp(palette.accentSecondary, 0.18);
    material.emissive.copy(material.color);
    material.emissiveIntensity = selector === 3 ? 0.18 : selector === 6 ? 0.65 : 0.48;
  }
}

export function createIntroMaterials(renderer: WebGLRenderer, frame: IntroFrame): IntroMaterials {
  const facade = createFacadeTexture(renderer.capabilities.getMaxAnisotropy());
  const materials = new Map<number, IntroMaterial>();
  const uniforms = {
    ...frameUniforms(frame),
    uIntroFacade: { value: facade },
    uIntroGlass: { value: new Color() },
    uIntroOffice: { value: new Color() },
    uIntroSignal: { value: new Color() },
    uIntroSecondary: { value: new Color() },
    uIntroNight: { value: 1 },
  };
  let palette: IntroPalette | undefined;
  return {
    get(selector: number): IntroMaterial {
      selector = Math.round(selector * 10) / 10;
      const existing = materials.get(selector);
      if (existing) return existing;
      const material = buildMaterial(selector);
      material.onBeforeCompile = (shader) => {
        installCoordinates(shader, uniforms);
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\n${SURFACE_DECLARATIONS}`)
          .replace("#include <map_fragment>", `#include <map_fragment>\n${SURFACE}`)
          .replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>\n${ROUGHNESS}`,
          )
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>\n${MICRO_NORMAL}`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>\n${EMISSION}`,
          );
      };
      material.customProgramCacheKey = () => `intro-pbr-${selector}-v3`;
      materials.set(selector, material);
      if (palette) updateMaterial(material, selector, palette);
      return material;
    },
    update(next: IntroPalette) {
      palette = next;
      uniforms.uIntroNight.value = 1 - next.daylight;
      uniforms.uIntroSignal.value.copy(next.accentLight);
      uniforms.uIntroSecondary.value.copy(next.accentSecondary);
      uniforms.uIntroGlass.value.copy(next.glazing);
      uniforms.uIntroOffice.value.copy(next.officeLight);
      for (const [selector, material] of materials) updateMaterial(material, selector, next);
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      materials.clear();
      facade.dispose();
    },
  };
}
