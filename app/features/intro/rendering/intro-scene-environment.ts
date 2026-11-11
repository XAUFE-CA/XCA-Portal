import {
  Color,
  CubeCamera,
  HalfFloatType,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  type Scene,
  type Texture,
  Vector4,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { JOURNEY } from "../core/intro-geometry";
import { INTRO_LAYERS } from "./intro-scene";
import type { IntroPalette } from "./intro-scene-palette";
import type { IntroSky } from "./intro-sky";

export interface IntroEnvironment {
  update(palette: IntroPalette, travel: number): Texture;
  dispose(): void;
}

// Capture actual sky and neighboring buildings once, never once per animation frame.
// 只在配色准备时捕获真实天空与相邻楼宇，不在动画帧中重复捕获。
function captureCity(
  renderer: WebGLRenderer,
  generator: PMREMGenerator,
  scene: Scene,
  sky: IntroSky,
  base: Texture,
  travel: number,
) {
  const target = new WebGLCubeRenderTarget(512, { type: HalfFloatType, depthBuffer: true });
  target.texture.colorSpace = LinearSRGBColorSpace;
  const camera = new CubeCamera(JOURNEY.near, 60000, target);
  camera.layers.set(INTRO_LAYERS.city);
  for (const face of camera.children) face.layers.set(INTRO_LAYERS.city);
  camera.position.set(JOURNEY.roadX, -JOURNEY.floorY + 3500, -9000 + travel);
  const previous = {
    environment: scene.environment,
    intensity: scene.environmentIntensity,
    background: scene.background,
    before: scene.onBeforeRender,
    clearColor: renderer.getClearColor(new Color()),
    clearAlpha: renderer.getClearAlpha(),
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
    xr: renderer.xr.enabled,
    clear: renderer.autoClear,
    shadow: renderer.shadowMap.enabled,
    target: renderer.getRenderTarget(),
    face: renderer.getActiveCubeFace(),
    mip: renderer.getActiveMipmapLevel(),
  };
  const materials = new Map<MeshStandardMaterial, Texture | null>();
  try {
    scene.traverse((object) => {
      if (!(object instanceof Mesh) || !object.layers.isEnabled(INTRO_LAYERS.city)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!(material instanceof MeshStandardMaterial) || materials.has(material)) continue;
        materials.set(material, material.envMap);
        material.envMap = null;
      }
    });
    // The bootstrap uses the same photographic radiance, without recursively reflecting the old city.
    // 初始环境使用相同的摄影全景辐射值，不递归反射旧的城市环境。
    scene.environment = base;
    scene.environmentIntensity = 1;
    scene.background = null;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0, 0);
    renderer.setScissorTest(false);
    scene.onBeforeRender = (_renderer, _scene, view) => {
      renderer.autoClear = false;
      renderer.clear();
      if (view instanceof PerspectiveCamera) sky.draw(view, 1);
    };
    camera.update(renderer, scene);
    return generator.fromCubemap(target.texture);
  } finally {
    scene.environment = previous.environment;
    scene.environmentIntensity = previous.intensity;
    scene.background = previous.background;
    scene.onBeforeRender = previous.before;
    renderer.autoClear = previous.clear;
    renderer.shadowMap.enabled = previous.shadow;
    renderer.xr.enabled = previous.xr;
    renderer.setClearColor(previous.clearColor, previous.clearAlpha);
    renderer.setRenderTarget(previous.target, previous.face, previous.mip);
    renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);
    for (const [material, environment] of materials) material.envMap = environment;
    target.dispose();
  }
}

export function createIntroEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  sky: IntroSky,
): IntroEnvironment {
  const generator = new PMREMGenerator(renderer);
  const cache = new Map<string, WebGLRenderTarget>();
  return {
    update(palette, travel) {
      const source = sky.texture();
      const colors = [
        palette.haze,
        palette.pavement,
        palette.keyLight,
        palette.rimLight,
        palette.architecture,
        palette.glazing,
        palette.alloy,
        palette.fillLight,
        palette.officeLight,
        palette.accentLight,
        palette.accentSecondary,
        palette.ledBlue,
        palette.ledAccent,
        palette.ledWarm,
        palette.ledRose,
        palette.ledGreen,
        palette.ledSurface,
        palette.ledFrame,
      ];
      const key = [
        palette.daylight,
        palette.sky.mode,
        source.uuid,
        source.version,
        ...colors.flatMap((color) => [color.r, color.g, color.b]),
      ].join(":");
      const existing = cache.get(key);
      if (existing) return existing.texture;
      // The sky owns the source bitmap/texture; only the PMREM targets belong to this cache.
      // 天空拥有原始位图和纹理，此缓存只拥有 PMREM 渲染目标。
      let target: WebGLRenderTarget;
      let base: WebGLRenderTarget | undefined;
      try {
        base = generator.fromEquirectangular(source);
        target = captureCity(renderer, generator, scene, sky, base.texture, travel);
      } finally {
        base?.dispose();
      }
      if (cache.size === 2) {
        const oldest = cache.entries().next().value;
        if (oldest) {
          cache.delete(oldest[0]);
          oldest[1].dispose();
        }
      }
      cache.set(key, target);
      return target.texture;
    },
    dispose() {
      for (const target of cache.values()) target.dispose();
      cache.clear();
      generator.dispose();
    },
  };
}
