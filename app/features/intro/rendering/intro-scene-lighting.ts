import {
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PointLight,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { AUDITORIUM } from "../core/intro-auditorium";
import { JOURNEY } from "../core/intro-geometry";
import { INTRO_LAYERS } from "./intro-scene";
import { createAuditoriumEnvironment, createIntroEnvironment } from "./intro-scene-environment";
import type { IntroPalette } from "./intro-scene-palette";

export interface IntroLighting {
  update(palette: IntroPalette, travel: number): void;
  move(travel: number): void;
  useExterior(): void;
  useAuditorium(): void;
  dispose(): void;
}

interface SceneLights {
  cityFill: HemisphereLight;
  cityKey: DirectionalLight;
  cityRim: PointLight;
  cityLane: PointLight;
  cityDistant: PointLight;
  roomFill: HemisphereLight;
  roomKey: DirectionalLight;
  roomRim: DirectionalLight;
  roomCeiling: PointLight[];
}

function createRoomLight() {
  const light = new DirectionalLight();
  light.name = "intro-auditorium-key";
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -AUDITORIUM.halfWidth - 350;
  light.shadow.camera.right = AUDITORIUM.halfWidth + 350;
  light.shadow.camera.top = 3800;
  light.shadow.camera.bottom = -3800;
  light.shadow.camera.near = 100;
  light.shadow.camera.far = 16000;
  light.shadow.bias = -0.00025;
  light.shadow.normalBias = 3;
  light.shadow.radius = 2;
  light.shadow.camera.updateProjectionMatrix();
  return light;
}

function createLights(): SceneLights {
  const lights = {
    cityFill: new HemisphereLight(),
    cityKey: new DirectionalLight(),
    cityRim: new PointLight(undefined, 1, 14000, 2),
    cityLane: new PointLight(undefined, 1, 6200, 2),
    cityDistant: new PointLight(undefined, 1, 6800, 2),
    roomFill: new HemisphereLight(),
    roomKey: createRoomLight(),
    roomRim: new DirectionalLight(),
    roomCeiling: Array.from({ length: 4 }, () => new PointLight(undefined, 1, 6200, 2)),
  };
  lights.cityFill.name = "intro-city-indigo-fill";
  lights.cityKey.name = "intro-city-sky-key";
  lights.cityRim.name = "intro-city-local-warm-rim";
  lights.cityLane.name = "intro-city-near-light-pool";
  lights.cityDistant.name = "intro-city-distant-light-pool";
  lights.roomFill.name = "intro-auditorium-sky-fill";
  lights.roomRim.name = "intro-auditorium-stage-rim";
  lights.roomCeiling.forEach((light, index) => {
    light.name = `intro-auditorium-ceiling-${index}`;
  });
  // Exterior and auditorium passes gather different lights while retaining one depth buffer.
  // 室外与报告厅绘制分别收集灯光，仍保留同一深度缓冲。
  for (const light of [
    lights.cityFill,
    lights.cityKey,
    lights.cityRim,
    lights.cityLane,
    lights.cityDistant,
  ]) {
    light.layers.set(INTRO_LAYERS.city);
    light.layers.enable(INTRO_LAYERS.exterior);
  }
  for (const light of [lights.roomFill, lights.roomKey, lights.roomRim, ...lights.roomCeiling])
    light.layers.set(INTRO_LAYERS.auditorium);
  return lights;
}

function colorLights(lights: SceneLights, palette: IntroPalette) {
  const daylight = palette.daylight;
  lights.cityFill.color.copy(palette.fillLight);
  lights.cityFill.groundColor.copy(palette.pavement);
  lights.cityFill.intensity = 0.55 - daylight * 0.18;
  lights.cityKey.color.copy(palette.keyLight);
  lights.cityKey.intensity = 2.2 + daylight * 1.8;
  lights.cityRim.color.copy(palette.rimLight);
  lights.cityRim.intensity = 9_000_000 - daylight * 2_000_000;
  lights.cityLane.color.copy(palette.accentLight);
  lights.cityLane.intensity = 16_000_000 * (1 - daylight);
  lights.cityDistant.color.copy(palette.accentLight).lerp(palette.fillLight, 0.2);
  lights.cityDistant.intensity = 12_000_000 * (1 - daylight);
  const room = palette.auditorium;
  lights.roomFill.color.copy(room.fillLight);
  lights.roomFill.groundColor.copy(room.floor);
  lights.roomFill.intensity = 0.22 + daylight * 0.26;
  lights.roomKey.color.copy(room.keyLight);
  lights.roomKey.intensity = 0.7 + daylight * 0.6;
  lights.roomRim.color.copy(room.accentLight);
  lights.roomRim.intensity = 0.4 + daylight * 0.24;
  lights.roomCeiling.forEach((light, index) => {
    light.color.copy(room.keyLight).lerp(room.accentLight, index % 2 === 0 ? 0.3 : 0.55);
    light.intensity = 3_200_000 * (0.72 + daylight * 0.28);
  });
}

function moveLights(lights: SceneLights, travel: number) {
  const roomCenter = (AUDITORIUM.entrance + AUDITORIUM.back) / 2;
  // Lower lateral key light separates lit facades from roofs and indigo backsides.
  // 较低的侧向主光区分受光立面、屋顶与靛蓝背光面。
  lights.cityKey.position.set(JOURNEY.roadX - 8500, 3800, 2500 + travel);
  lights.cityKey.target.position.set(JOURNEY.roadX, -1900, -8000 + travel);
  lights.cityRim.position.set(JOURNEY.roadX + 4800, 200, -7500 + travel);
  lights.cityLane.position.set(JOURNEY.roadX - 1400, 200, -4200 + travel);
  lights.cityDistant.position.set(JOURNEY.roadX + 1600, 100, -10600 + travel);
  // A near-central key keeps the two side walls evenly lit instead of a bright left / dark right.
  // 主光接近中轴，让两侧墙面受光均匀，避免左侧过亮、右侧死黑。
  lights.roomKey.position.set(
    JOURNEY.roadX - 240,
    AUDITORIUM.ceiling + 220,
    roomCenter + 2200 + travel,
  );
  lights.roomKey.target.position.set(JOURNEY.roadX, 450, roomCenter + travel);
  // Ceiling pools correspond to the visible coves instead of adding uniform ambient.
  // 顶部光池对应可见灯槽，而不是叠加均匀环境光。
  lights.roomCeiling.forEach((light, index) => {
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    light.position.set(
      JOURNEY.roadX + side * 1750,
      AUDITORIUM.ceiling + 230,
      AUDITORIUM.entrance - 1500 - row * 1900 + travel,
    );
    light.updateMatrixWorld();
  });
  lights.roomRim.position.set(JOURNEY.roadX + 2200, 1200, AUDITORIUM.back + 800 + travel);
  lights.roomRim.target.position.set(JOURNEY.roadX, -400, roomCenter + travel);
  lights.cityKey.updateMatrixWorld();
  lights.cityKey.target.updateMatrixWorld();
  lights.cityRim.updateMatrixWorld();
  lights.cityLane.updateMatrixWorld();
  lights.cityDistant.updateMatrixWorld();
  lights.roomKey.updateMatrixWorld();
  lights.roomKey.target.updateMatrixWorld();
  lights.roomRim.updateMatrixWorld();
  lights.roomRim.target.updateMatrixWorld();
  // The depth image is translation-invariant, but its world projection must still follow.
  // 深度图在整体平移下保持不变，但其世界空间投影仍须跟随移动。
  lights.roomKey.shadow.updateMatrices(lights.roomKey);
}

export function createIntroLighting(scene: Scene, renderer: WebGLRenderer): IntroLighting {
  const previousEnvironment = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  const previousShadowEnabled = renderer.shadowMap.enabled;
  const previousShadowType = renderer.shadowMap.type;
  const environment = createIntroEnvironment(renderer);
  const auditoriumEnvironment = createAuditoriumEnvironment(renderer);
  const lights = createLights();
  const lightList = Object.values(lights).flat();
  const targets = [lights.cityKey.target, lights.roomKey.target, lights.roomRim.target];
  let activeEnvironment: Texture | null = null;
  let auditoriumTexture: Texture | null = null;
  let exteriorIntensity = 0;
  let auditoriumIntensity = 0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  for (const light of lightList) scene.add(light);
  for (const target of targets) scene.add(target);
  return {
    update(palette, travel) {
      activeEnvironment = environment.update(palette);
      auditoriumTexture = auditoriumEnvironment.update(palette);
      exteriorIntensity = 0.18 + palette.daylight * 0.36;
      auditoriumIntensity = palette.auditorium.environmentIntensity;
      colorLights(lights, palette);
      moveLights(lights, travel);
    },
    useExterior() {
      scene.environment = activeEnvironment;
      scene.environmentIntensity = exteriorIntensity;
    },
    useAuditorium() {
      scene.environment = auditoriumTexture;
      scene.environmentIntensity = auditoriumIntensity;
    },
    move(travel) {
      // Travel changes transforms only: no theme work, canvases or GPU allocations.
      // 行进只改变变换：不解析主题、不生成画布，也不分配 GPU 资源。
      moveLights(lights, travel);
    },
    dispose() {
      for (const light of lightList) {
        light.removeFromParent();
        light.dispose();
      }
      for (const target of targets) target.removeFromParent();
      if (scene.environment === activeEnvironment || scene.environment === auditoriumTexture) {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousIntensity;
      }
      environment.dispose();
      auditoriumEnvironment.dispose();
      renderer.shadowMap.enabled = previousShadowEnabled;
      renderer.shadowMap.type = previousShadowType;
    },
  };
}
