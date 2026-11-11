import {
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  type Scene,
  SpotLight,
  type Texture,
  type WebGLRenderer,
} from "three";
import { AUDITORIUM, AUDITORIUM_OBJECTS } from "../core/intro-auditorium";
import { JOURNEY } from "../core/intro-geometry";
import { INTRO_LAYERS } from "./intro-scene";
import { createIntroEnvironment } from "./intro-scene-environment";
import { INTRO_SKY_LIGHT_DIRECTION, type IntroPalette } from "./intro-scene-palette";
import type { IntroSky } from "./intro-sky";

export interface IntroLighting {
  update(palette: IntroPalette, travel: number): Texture;
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

function createCityLight() {
  const light = new DirectionalLight();
  light.castShadow = true;
  const shadow = light.shadow;
  shadow.autoUpdate = false;
  shadow.needsUpdate = true;
  shadow.mapSize.set(2048, 2048);
  shadow.camera.left = -20000;
  shadow.camera.right = 20000;
  shadow.camera.top = 18000;
  shadow.camera.bottom = -18000;
  shadow.camera.near = 100;
  shadow.camera.far = 100000;
  shadow.camera.layers.set(INTRO_LAYERS.city);
  shadow.camera.layers.enable(INTRO_LAYERS.exterior);
  shadow.bias = -0.0002;
  shadow.normalBias = 8;
  shadow.radius = 0.5;
  shadow.camera.updateProjectionMatrix();
  return light;
}

function createLights(): SceneLights {
  const lights = {
    cityFill: new HemisphereLight(),
    cityKey: createCityLight(),
    roomFill: new HemisphereLight(),
    roomKey: createRoomLight(),
    roomStage: STAGE_FIXTURES.map(() => new SpotLight(undefined, 1, 7000, 0.52, 0.7, 2)),
    roomCeiling: CEILING_FIXTURES.map(() => new SpotLight(undefined, 1, 6400, Math.PI / 4, 0.6, 2)),
  };
  lights.cityFill.name = "intro-city-neutral-sky-fill";
  lights.cityKey.name = "intro-city-sun-moon-key";
  lights.roomFill.name = "intro-auditorium-sky-fill";
  lights.roomStage.forEach((light, index) => {
    light.name = `intro-auditorium-stage-wash-${index}`;
  });
  lights.roomCeiling.forEach((light, index) => {
    light.name = `intro-auditorium-ceiling-${index}`;
  });
  // Exterior and auditorium passes gather different lights while retaining one depth buffer.
  // 室外与报告厅绘制分别收集灯光，仍保留同一深度缓冲。
  for (const light of [lights.cityFill, lights.cityKey]) {
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
  lights.cityFill.groundColor.copy(palette.pavement).multiplyScalar(0.28);
  lights.cityFill.intensity = 0.48 + daylight * 0.12;
  lights.cityKey.color.copy(palette.keyLight);
  lights.cityKey.intensity = 0.72 + daylight * 2.48;
  lights.cityKey.shadow.intensity = 0.2 + daylight * 0.8;
  const room = palette.auditorium;
  lights.roomFill.color.copy(room.fillLight);
  lights.roomFill.groundColor.copy(room.floor);
  lights.roomFill.intensity = 0.34 * room.lightIntensity;
  lights.roomKey.color.copy(room.keyLight);
  lights.roomKey.intensity = 18_000_000 * room.lightIntensity;
  lights.roomStage.forEach((light) => {
    light.color.copy(room.keyLight).lerp(room.accentLight, 0.04);
    light.angle = 0.52 + daylight * 0.42;
    light.penumbra = 0.7 + daylight * 0.15;
    light.intensity = 6_500_000 * room.lightIntensity * (1 + daylight * 6);
  });
  lights.roomCeiling.forEach((light) => {
    light.color.copy(room.keyLight);
    light.intensity = 3_000_000 * room.lightIntensity;
  });
}

function moveLights(lights: SceneLights, travel: number) {
  const roomCenter = (AUDITORIUM.entrance + AUDITORIUM.back) / 2;
  // A fixed world-space source agrees with the sky and PMREM, while sky fill opens dark facades.
  // 固定世界方向与天空和 PMREM 一致，天空补光保留暗立面的可读性。
  lights.cityKey.target.position.set(JOURNEY.roadX, -JOURNEY.floorY, -8000 + travel);
  lights.cityKey.position.copy(lights.cityKey.target.position);
  lights.cityKey.position.x += INTRO_SKY_LIGHT_DIRECTION[0] * 60000;
  lights.cityKey.position.y += INTRO_SKY_LIGHT_DIRECTION[1] * 60000;
  lights.cityKey.position.z += INTRO_SKY_LIGHT_DIRECTION[2] * 60000;
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
  lights.roomKey.updateMatrixWorld();
  lights.roomKey.target.updateMatrixWorld();
  // The depth image is translation-invariant, but its world projection must still follow.
  // 深度图在整体平移下保持不变，但其世界空间投影仍须跟随移动。
  lights.roomKey.shadow.updateMatrices(lights.roomKey);
  lights.cityKey.shadow.updateMatrices(lights.cityKey);
}

export function createIntroLighting(
  scene: Scene,
  renderer: WebGLRenderer,
  sky: IntroSky,
): IntroLighting {
  const previousEnvironment = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  const previousShadowEnabled = renderer.shadowMap.enabled;
  const previousShadowType = renderer.shadowMap.type;
  const environment = createIntroEnvironment(renderer, scene, sky);
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
      exteriorIntensity = 0.28 + palette.daylight * 0.32;
      colorLights(lights, palette);
      moveLights(lights, travel);
      activeEnvironment = environment.update(palette, travel);
      return activeEnvironment;
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
