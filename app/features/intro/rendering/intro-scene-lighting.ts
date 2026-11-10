import {
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PointLight,
  type Scene,
  SpotLight,
  type Texture,
  type WebGLRenderer,
} from "three";
import { AUDITORIUM, AUDITORIUM_OBJECTS } from "../core/intro-auditorium";
import { JOURNEY } from "../core/intro-geometry";
import { INTRO_LAYERS } from "./intro-scene";
import { createIntroEnvironment } from "./intro-scene-environment";
import type { IntroPalette } from "./intro-scene-palette";

export interface IntroLighting {
  update(palette: IntroPalette, travel: number): void;
  move(travel: number): void;
  useExterior(): void;
  useAuditorium(): void;
  dispose(): void;
}

const CEILING_FIXTURES = AUDITORIUM_OBJECTS.filter((object) =>
  object.id.startsWith("canopy-inlay."),
);
const STAGE_FIXTURES = AUDITORIUM_OBJECTS.filter((object) =>
  object.id.startsWith("stage-spot-aperture."),
);

interface SceneLights {
  cityFill: HemisphereLight;
  cityKey: DirectionalLight;
  cityRim: PointLight;
  cityLane: PointLight;
  cityDistant: PointLight;
  roomFill: HemisphereLight;
  roomKey: SpotLight;
  roomStage: SpotLight[];
  roomCeiling: SpotLight[];
}

export function createRoomLight() {
  const light = new SpotLight(undefined, 1, 10000, Math.PI / 3, 0.65, 2);
  light.name = "intro-auditorium-key";
  const roomCenter = (AUDITORIUM.entrance + AUDITORIUM.back) / 2;
  light.position.set(JOURNEY.roadX, -AUDITORIUM.ceiling - 220, roomCenter + 1200);
  light.target.position.set(JOURNEY.roadX, -AUDITORIUM.floorY, roomCenter);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = JOURNEY.near;
  light.shadow.camera.far = light.distance;
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
    roomStage: STAGE_FIXTURES.map(() => new SpotLight(undefined, 1, 7000, 0.52, 0.7, 2)),
    roomCeiling: CEILING_FIXTURES.map(() => new SpotLight(undefined, 1, 6400, Math.PI / 4, 0.6, 2)),
  };
  lights.cityFill.name = "intro-city-indigo-fill";
  lights.cityKey.name = "intro-city-sky-key";
  lights.cityRim.name = "intro-city-local-warm-rim";
  lights.cityLane.name = "intro-city-near-light-pool";
  lights.cityDistant.name = "intro-city-distant-light-pool";
  lights.roomFill.name = "intro-auditorium-sky-fill";
  lights.roomStage.forEach((light, index) => {
    light.name = `intro-auditorium-stage-wash-${index}`;
  });
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
  for (const light of [lights.roomFill, lights.roomKey, ...lights.roomStage, ...lights.roomCeiling])
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
  lights.roomFill.intensity = 0.34 * room.lightIntensity;
  lights.roomKey.color.copy(room.keyLight);
  lights.roomKey.intensity = 18_000_000 * room.lightIntensity;
  lights.roomStage.forEach((light) => {
    light.color.copy(room.keyLight).lerp(room.accentLight, 0.04);
    light.intensity = 6_500_000 * room.lightIntensity;
  });
  lights.roomCeiling.forEach((light) => {
    light.color.copy(room.keyLight);
    light.intensity = 3_000_000 * room.lightIntensity;
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
  // A finite downward shadow cone excludes the enclosing roof instead of projecting it onto the wall.
  // 有限下射阴影光锥排除封闭屋顶，不把屋顶投影到后墙。
  lights.roomKey.position.z = roomCenter + 1200 + travel;
  lights.roomKey.target.position.z = roomCenter + travel;
  // Downward cones start below the actual apertures and cannot illuminate the ceiling above.
  // 向下光锥从真实灯面下方发出，不照亮上方顶棚。
  lights.roomCeiling.forEach((light, index) => {
    const fixture = CEILING_FIXTURES[index];
    if (!fixture) return;
    const [x, y, z] = fixture.origin;
    light.position.set(
      x + fixture.size[0] / 2,
      -y - fixture.size[1] - 4,
      z - fixture.size[2] / 2 + travel,
    );
    light.target.position.set(light.position.x, -AUDITORIUM.floorY, light.position.z);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  });
  // Stage fixtures wash the screen backdrop instead of shining away from it toward the audience.
  // 舞台灯具洗亮屏幕后墙，不再背向后墙照向观众区。
  lights.roomStage.forEach((light, index) => {
    const fixture = STAGE_FIXTURES[index];
    if (!fixture) return;
    const [x, y, z] = fixture.origin;
    const side = x < JOURNEY.roadX ? -1 : 1;
    light.position.set(
      x + fixture.size[0] / 2,
      -y - fixture.size[1] - 4,
      z - fixture.size[2] / 2 + travel,
    );
    light.target.position.set(
      JOURNEY.roadX + side * 900,
      -AUDITORIUM.screen.y,
      AUDITORIUM.back + 1 + travel,
    );
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  });
  lights.cityKey.updateMatrixWorld();
  lights.cityKey.target.updateMatrixWorld();
  lights.cityRim.updateMatrixWorld();
  lights.cityLane.updateMatrixWorld();
  lights.cityDistant.updateMatrixWorld();
  lights.roomKey.updateMatrixWorld();
  lights.roomKey.target.updateMatrixWorld();
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
  const lights = createLights();
  const lightList = Object.values(lights).flat();
  const targets = [
    lights.cityKey.target,
    lights.roomKey.target,
    ...lights.roomCeiling.map((light) => light.target),
    ...lights.roomStage.map((light) => light.target),
  ];
  let activeEnvironment: Texture | null = null;
  let exteriorIntensity = 0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  for (const light of lightList) scene.add(light);
  for (const target of targets) scene.add(target);
  return {
    update(palette, travel) {
      activeEnvironment = environment.update(palette);
      exteriorIntensity = 0.18 + palette.daylight * 0.36;
      colorLights(lights, palette);
      moveLights(lights, travel);
    },
    useExterior() {
      scene.environment = activeEnvironment;
      scene.environmentIntensity = exteriorIntensity;
    },
    useAuditorium() {
      scene.environment = null;
      scene.environmentIntensity = 0;
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
      if (scene.environment === activeEnvironment || scene.environment === null) {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousIntensity;
      }
      environment.dispose();
      renderer.shadowMap.enabled = previousShadowEnabled;
      renderer.shadowMap.type = previousShadowType;
    },
  };
}
