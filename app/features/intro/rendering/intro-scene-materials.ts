import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Texture,
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
import {
  AUDITORIUM_EMISSION,
  AUDITORIUM_NORMAL,
  AUDITORIUM_ROUGHNESS,
  AUDITORIUM_SURFACE,
  createAuditoriumMaterial,
  updateAuditoriumMaterial,
} from "./intro-auditorium-surfaces";
import {
  createFacadeTexture,
  FACADE_DECLARATIONS,
  FACADE_OPTICS,
  FACADE_SURFACE,
} from "./intro-city-facade";
import { CITY_LED_FRAME_MATERIAL, CITY_LED_MATERIAL } from "./intro-city-led";
import {
  createLedUniforms,
  LED_DECLARATIONS,
  LED_EMISSION,
  LED_SURFACE,
  updateLedMaterial,
  updateLedUniforms,
} from "./intro-city-led-surface";
import { CITY_LIFE_EMISSION, CITY_LIFE_SURFACE, CITY_LIFE_VERTEX } from "./intro-city-life";
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
  setEnvironment(environment: Texture): void;
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
  if (introSelector == 21.0 && introRoadDepth > uIntroGrowth) discard;
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
uniform vec3 uIntroMineral;
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
${FACADE_DECLARATIONS}
${LED_DECLARATIONS}
`;

const SURFACE = `
float introWindows = 0.0;
vec3 introFacadeData = vec3(0.0);
vec3 introOfficeTint = uIntroOffice;
float introDetail = 1.0 - smoothstep(0.0008, 0.003, max(length(dFdx(vIntroUv)), length(dFdy(vIntroUv))));
float introFinish = introGrain(floor(vIntroUv * vec2(145.0, 190.0))) - 0.5;
float introGuide = 0.0;
float introStructure = 0.0;
float introRoadFinish = 0.0;
float introWindowRelief = 0.0;
float roomFinish = 0.0;
float roomRelief = 0.0;
vec3 introLedRadiance = vec3(0.0);
if (introSelector == ${CITY_LED_MATERIAL.toFixed(1)}) {
  ${LED_SURFACE}
} else if (introSelector == 5.0 || introSelector == 5.4 || introSelector == 5.8 || introSelector == 8.0) {
  ${FACADE_SURFACE}
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
  // Glass panels stay fixed to the authored deck, including their filtered joints.
  // 玻璃分板及其过滤后的接缝固定于原始桥面坐标。
  vec2 introRoad = vec2(vIntroAcross * ${JOURNEY.roadWidth.toFixed(1)}, vIntroAlong);
  float introFootprint = max(length(dFdx(introRoad)), length(dFdy(introRoad)));
  vec2 introPanelSize = vec2(${(JOURNEY.roadWidth / 4).toFixed(1)}, 1200.0);
  vec2 introPanelDistance = abs(fract(introRoad / introPanelSize + 0.5) - 0.5) * introPanelSize;
  vec2 introPanelEdge = 1.0 - smoothstep(vec2(0.8), vec2(1.6 + introFootprint), introPanelDistance);
  float introJoint = max(introPanelEdge.x, introPanelEdge.y) * 1.6 / (1.6 + introFootprint);
  introRoadFinish = introJoint * 0.12;
  diffuseColor.rgb = mix(diffuseColor.rgb, uIntroSecondary * 0.24, introJoint * 0.65);
  vec3 introDeckView = normalize((uIntroEye - vIntroWorld) * vec3(1.0, -1.0, 1.0));
  float introGrazing = pow(1.0 - clamp(abs(dot(normalize(vIntroNormal), introDeckView)), 0.0, 1.0), 3.0);
  diffuseColor.a *= mix(0.78, 1.2, introGrazing);
  diffuseColor.a = mix(diffuseColor.a, 0.94, introJoint * 0.45);
  float introAcross = min(vIntroAcross, 1.0 - vIntroAcross);
  float introStripFootprint = max(fwidth(vIntroAcross), 0.000001);
  float introStrip = (1.0 - smoothstep(0.0008, 0.0008 + introStripFootprint, abs(introAcross - 0.0796))) * 0.0016 / (0.0016 + introStripFootprint);
  introStrip *= 1.0 - smoothstep(180.0, 540.0, introFootprint);
  float introSegment = smoothstep(0.12, 0.18, fract(-vIntroAlong / 900.0)) * (1.0 - smoothstep(0.78, 0.84, fract(-vIntroAlong / 900.0)));
  introGuide = introStrip * introSegment * mix(0.14, 1.7, uIntroNight);
  diffuseColor.rgb = mix(diffuseColor.rgb, uIntroSecondary, introStrip * introSegment * 0.55);
} else if (introSelector == 2.0) {
  // Shared selector: metal above the deck, mineral bearings and supports below it.
  // 共用选择器：桥面以上为金属，以下的支座与桥墩为矿物混凝土。
  introStructure = smoothstep(${(JOURNEY.floorY - 6).toFixed(1)}, ${(JOURNEY.floorY + 24).toFixed(1)}, vIntroWorld.y);
  vec3 introStructureAnchor = vec3(vIntroWorld.xy, vIntroAlong);
  float introConcrete = introNoise(introStructureAnchor * 0.035) - 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb, uIntroMineral * (0.94 + introConcrete * 0.12), introStructure);
} else if (introSelector > 8.5) {
  ${AUDITORIUM_SURFACE}
}
${CITY_LIFE_SURFACE}
diffuseColor.a *= introVisibility;
`;

const ROUGHNESS = `
if (introSelector < 8.5) {
  if (introSelector == 1.0) {
    roughnessFactor = clamp(roughnessFactor + introRoadFinish, 0.065, 0.24);
  } else if (introSelector == 2.0) {
    roughnessFactor = mix(roughnessFactor, 0.88, introStructure);
  } else if (introSelector == 5.0 || introSelector == 5.4 || introSelector == 5.8 || introSelector == 8.0) {
    roughnessFactor = mix(0.80, 0.045 + (1.0 - introFacadeData.r) * 0.02, introWindows);
  }
} else {
  roughnessFactor = clamp(roughnessFactor + introFinish * introDetail * 0.035, 0.18, 1.0);
}
${AUDITORIUM_ROUGHNESS}
`;

const METALNESS = `
if (introSelector == 2.0) metalnessFactor *= 1.0 - introStructure;
if (introSelector == 5.0 || introSelector == 5.4 || introSelector == 5.8 || introSelector == 8.0) metalnessFactor *= introWindows;
`;

const EMISSION = `
if (introWindows > 0.0) {
  totalEmissiveRadiance += introOfficeTint * introFacadeData.g * introWindows * mix(0.006, 0.75, uIntroNight);
}
if (introGuide > 0.0) {
  totalEmissiveRadiance += mix(uIntroSignal, uIntroSecondary, 0.9) * introGuide;
}
${AUDITORIUM_EMISSION}
${LED_EMISSION}
${CITY_LIFE_EMISSION}
`;

// Screen-space surface gradients perturb the real PBR normal, not the final color.
// 屏幕空间表面梯度扰动真实 PBR 法线，而非最终颜色。
const MICRO_NORMAL = `
if (introWindows > 0.0) {
  vec3 introDx = dFdx(-vViewPosition);
  vec3 introDy = dFdy(-vViewPosition);
  vec3 introRx = cross(introDy, normal);
  vec3 introRy = cross(normal, introDx);
  float introDet = dot(introDx, introRx) * faceDirection;
  vec3 introGradient = sign(introDet) * (dFdx(introWindowRelief) * introRx + dFdy(introWindowRelief) * introRy);
  normal = normalize(max(abs(introDet), 1e-8) * normal - introGradient);
}
${AUDITORIUM_NORMAL}
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
    .replace(
      "#include <project_vertex>",
      `${CITY_LIFE_VERTEX}\n#include <project_vertex>\n${WORLD_COORDINATES}`,
    );
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
  } else if (selector >= 9) {
    material = createAuditoriumMaterial(selector);
  } else if (selector === 1 || selector === 4) {
    const deck = selector === 1;
    material = new MeshPhysicalMaterial({
      roughness: deck ? 0.085 : 0.16,
      metalness: deck ? 0.12 : 0,
      transmission: deck ? 0 : 0.76,
      ior: 1.46,
      thickness: deck ? 28 : 5,
      opacity: deck ? 0.7 : 0.38,
      clearcoat: deck ? 1 : 0,
      clearcoatRoughness: 0.045,
    });
  } else if (selector === 5 || selector === 5.4 || selector === 5.8 || selector === 8) {
    // A thin metallic solar coating supplies frontal reflection without a fictitious IOR.
    // 薄金属遮阳镀层提供正视反射，无需虚构的高折射率。
    material = new MeshPhysicalMaterial({
      roughness: 0.05,
      metalness: 0.62,
      clearcoat: 0.95,
      clearcoatRoughness: 0.035,
      specularIntensity: 1,
      ior: 1.5,
    });
  } else if (selector === 5.2 || selector === 2) {
    material = new MeshPhysicalMaterial({
      roughness: selector === 5.2 ? 0.88 : 0.4,
      metalness: selector === 5.2 ? 0 : 0.82,
    });
  } else {
    let roughness = 0.55;
    if (selector === 5.6 || selector === 5.9) roughness = 0.94;
    if (selector === 5.7) roughness = 0.86;
    if (selector === 8.1 || selector === 8.4) roughness = selector === 8.1 ? 0.72 : 0.28;
    material = new MeshStandardMaterial({
      roughness,
      metalness: selector === 8.4 ? 0.24 : 0,
    });
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
    updateAuditoriumMaterial(material, selector, palette.auditorium);
    return;
  }
  material.emissive.setRGB(0, 0, 0);
  material.envMapIntensity = 0.65;
  if (selector === 1 || selector === 5.6) {
    material.color.copy(selector === 1 ? palette.glazing : palette.pavement);
    material.envMapIntensity = selector === 1 ? 1.55 + (1 - daylight) * 0.65 : 0.55;
  } else if (selector === 4) {
    material.color.copy(palette.glazing).lerp(palette.alloy, 0.2);
    material.envMapIntensity = 1.0 + (1 - daylight) * 0.75;
  } else if (selector === 5 || selector === 5.4 || selector === 5.8 || selector === 8) {
    material.color.copy(palette.architecture);
    material.envMapIntensity = 1.15 + (1 - daylight) * 1.25;
  } else if (selector === 2 || selector === 5.2) {
    material.color.copy(selector === 5.2 ? palette.architecture : palette.alloy);
    material.envMapIntensity = selector === 5.2 ? 0.55 : 1.0;
  } else if (selector === 5.7) {
    material.color
      .copy(palette.pavement)
      .lerp(palette.architecture, 0.16)
      .multiplyScalar(0.78 + daylight * 0.12);
  } else if (selector === 5.9) {
    material.color.copy(palette.pavement).lerp(palette.glazing, 0.18);
    material.envMapIntensity = 0.5;
  } else if (selector === CITY_LED_MATERIAL || selector === CITY_LED_FRAME_MATERIAL) {
    updateLedMaterial(material, selector, palette);
  } else if (selector === 8.1 || selector === 8.4) {
    material.color.setRGB(1, 1, 1);
  } else {
    material.color.copy(palette.architecture).multiplyScalar(selector === 8 ? 0.76 : 1);
  }
  if (material instanceof MeshPhysicalMaterial) material.sheenColor.copy(palette.fabric);
  // Light sources retain colored radiance; reflective roofs never share their emission.
  // 光源保留彩色辐射，反射屋面不会共用光源的自发光。
  if (selector === 3 || selector === 6 || selector === 7) {
    material.color
      .copy(palette.accentLight)
      .lerp(palette.accentSecondary, selector === 3 ? 0.78 : 0.18);
    material.emissive.copy(material.color);
    material.emissiveIntensity =
      selector === 3
        ? 0.004 + (1 - daylight) * 0.14
        : selector === 6
          ? 0.04 + (1 - daylight) * 0.28
          : 0.48;
    if (selector === 3) material.color.multiplyScalar(0.22);
  }
}

export function createIntroMaterials(renderer: WebGLRenderer, frame: IntroFrame): IntroMaterials {
  const facade = createFacadeTexture(renderer.capabilities.getMaxAnisotropy());
  const materials = new Map<number, IntroMaterial>();
  const uniforms = {
    ...frameUniforms(frame),
    uIntroFacade: { value: facade },
    ...createLedUniforms(renderer.capabilities.getMaxAnisotropy()),
    uIntroGlass: { value: new Color() },
    uIntroMineral: { value: new Color() },
    uIntroOffice: { value: new Color() },
    uIntroSignal: { value: new Color() },
    uIntroSecondary: { value: new Color() },
    uIntroNight: { value: 1 },
  };
  let palette: IntroPalette | undefined;
  let environment: Texture | null = null;
  return {
    get(selector: number): IntroMaterial {
      selector = Math.round(selector * 10) / 10;
      const existing = materials.get(selector);
      if (existing) return existing;
      const material = buildMaterial(selector);
      if (selector > 0 && selector < 9 && material instanceof MeshStandardMaterial)
        material.envMap = environment;
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
            "#include <metalnessmap_fragment>",
            `#include <metalnessmap_fragment>\n${METALNESS}`,
          )
          .replace(
            "#include <lights_physical_fragment>",
            `#include <lights_physical_fragment>\n${FACADE_OPTICS}`,
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
      material.customProgramCacheKey = () => `intro-pbr-${selector}-v12`;
      materials.set(selector, material);
      if (palette) updateMaterial(material, selector, palette);
      return material;
    },
    update(next: IntroPalette) {
      palette = next;
      uniforms.uIntroNight.value = 1 - next.daylight;
      uniforms.uIntroSignal.value.copy(next.accentLight);
      uniforms.uIntroSecondary.value.copy(next.accentSecondary);
      updateLedUniforms(uniforms, next);
      uniforms.uIntroGlass.value.copy(next.glazing);
      uniforms.uIntroMineral.value.copy(next.architecture);
      uniforms.uIntroOffice.value.copy(next.officeLight);
      for (const [selector, material] of materials) updateMaterial(material, selector, next);
    },
    setEnvironment(next: Texture) {
      environment = next;
      for (const [selector, material] of materials) {
        if (selector <= 0 || selector >= 9 || !(material instanceof MeshStandardMaterial)) continue;
        if (material.envMap === null) material.needsUpdate = true;
        material.envMap = next;
      }
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      materials.clear();
      facade.dispose();
      uniforms.uIntroLed.value.dispose();
    },
  };
}
