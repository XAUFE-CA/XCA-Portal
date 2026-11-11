import {
  ACESFilmicToneMapping,
  Fog,
  MathUtils,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { tokenLength } from "~/utils/cssTokens";
import {
  arrivalOpacity,
  entryGrowth,
  journeyPerspective,
  roadGrowth,
  sceneryOpacity,
  skylineOpacity,
} from "../core/intro-geometry";
import { type CityLayer, createCityLayer } from "./intro-city-layer";
import { createMarkMesh } from "./intro-mark-mesh";
import {
  createIntroCamera,
  createIntroScene,
  INTRO_LAYERS,
  type IntroCamera,
  type IntroScene,
} from "./intro-scene";
import { createIntroLighting, type IntroLighting } from "./intro-scene-lighting";
import {
  createIntroMaterials,
  type IntroFrame,
  type IntroMaterials,
} from "./intro-scene-materials";
import { createIntroPalette, type IntroPalette } from "./intro-scene-palette";
import { createIntroSky, type IntroSky } from "./intro-sky";

interface Pipeline {
  renderer: WebGLRenderer;
  frame: IntroFrame;
  materials: IntroMaterials;
  scene: IntroScene;
  lighting: IntroLighting;
  city: CityLayer;
  sky: IntroSky;
  view: IntroCamera;
  palette: IntroPalette;
  fog: Fog;
  dispose(): void;
}

function createRenderer(root: HTMLElement, canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.autoClear = false;
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const software =
    info &&
    /swiftshader|llvmpipe|softpipe|software|basic render/i.test(
      String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)),
    );
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  const limit = renderer.capabilities.maxTextureSize;
  const ratio = Math.min(
    software ? 1 : Math.min(2, window.devicePixelRatio || 1),
    Math.sqrt(8_000_000 / (width * height)),
    limit / width,
    limit / height,
  );
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  return renderer;
}

function createPipeline(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  paths: SVGPathElement[],
): Pipeline {
  const renderer = createRenderer(root, canvas);
  const releases: (() => void)[] = [
    () => {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  ];
  try {
    const frame: IntroFrame = {
      fill: { value: 0 },
      growth: { value: 0 },
      entry: { value: 0 },
      arrival: { value: 0 },
      travel: { value: 0 },
      eye: { value: new Vector3() },
    };
    const materials = createIntroMaterials(renderer, frame);
    releases.unshift(() => materials.dispose());
    const radius = root.clientWidth <= 767 ? 0 : tokenLength(root, "--neoverse-radius-lg");
    const scene = createIntroScene(createMarkMesh(paths, radius), materials);
    releases.unshift(() => scene.dispose());
    const sky = createIntroSky(renderer);
    releases.unshift(() => sky.dispose());
    const lighting = createIntroLighting(scene.scene, renderer, sky);
    releases.unshift(() => lighting.dispose());
    const city = createCityLayer(renderer, canvas.width, canvas.height);
    releases.unshift(() => city.dispose());
    const view = createIntroCamera(
      root.clientWidth,
      root.clientHeight,
      journeyPerspective(root.clientWidth),
    );
    const palette = createIntroPalette(canvas);
    sky.update(palette);
    const fog = new Fog(palette.haze, 9000, 65000);
    scene.scene.fog = fog;
    return {
      renderer,
      frame,
      materials,
      scene,
      lighting,
      city,
      sky,
      view,
      palette,
      fog,
      dispose() {
        for (const release of releases) release();
      },
    };
  } catch (error) {
    for (const release of releases) release();
    throw error;
  }
}

function draw(
  state: Pipeline,
  camera: HTMLElement,
  front: SVGPathElement,
  travel: HTMLElement,
  signs: HTMLElement[],
  aura: HTMLElement,
) {
  const { renderer, frame, scene, view, city, sky } = state;
  // WAAPI remains the only camera clock, including pauses, replay and interruption.
  // WAAPI 仍是唯一相机时钟，涵盖暂停、重播与中断。
  const matrix = new DOMMatrixReadOnly(getComputedStyle(camera).transform);
  view.update(matrix);
  const elements = view.camera.matrixWorld.elements;
  frame.eye.value.set(elements[12] ?? 0, -(elements[13] ?? 0), elements[14] ?? 0);
  const movement = new DOMMatrixReadOnly(getComputedStyle(travel).transform).m43;
  const changed = frame.travel.value !== movement;
  frame.travel.value = movement;
  frame.fill.value = Math.max(
    0,
    Math.min(1, Number.parseFloat(getComputedStyle(front).fillOpacity)),
  );
  frame.growth.value = roadGrowth(frame.eye.value.z);
  frame.entry.value = entryGrowth(frame.eye.value.z);
  frame.arrival.value = arrivalOpacity(frame.eye.value.z);
  scene.mark.scale.z = Math.max(0.00001, frame.fill.value);
  scene.mark.visible = frame.fill.value > 0;
  scene.world.position.z = movement;
  if (changed) {
    state.lighting.move(movement);
  }
  state.lighting.useExterior();
  view.camera.layers.set(INTRO_LAYERS.city);
  state.fog.near = 9000;
  state.fog.far = 65000;
  city.resize(renderer.domElement.width, renderer.domElement.height);
  renderer.setRenderTarget(city.target);
  renderer.clear();
  // Exterior and room shadows warm independently, then reuse their static depth images.
  // 室外与室内阴影分别预热，随后复用各自的静态深度图。
  const shadows = renderer.shadowMap.needsUpdate;
  renderer.render(scene.scene, view.camera);
  renderer.shadowMap.needsUpdate = false;
  renderer.setRenderTarget(null);
  renderer.clear();
  // Daylight enters later; night retains its existing reveal cadence.
  // 日景延后显现，夜景保留原有的显现节奏。
  const auraOpacity = Number.parseFloat(getComputedStyle(aura).opacity || "0");
  const reveal =
    state.palette.daylight >= 0.5
      ? MathUtils.smoothstep(auraOpacity, 0.18, 0.92)
      : Math.min(1, auraOpacity / 0.58);
  sky.draw(view.camera, reveal);
  city.composite(skylineOpacity(frame.eye.value.z), state.palette.daylight);
  view.camera.layers.set(INTRO_LAYERS.exterior);
  state.fog.near = 6000;
  state.fog.far = 30000;
  renderer.render(scene.scene, view.camera);
  view.camera.layers.set(INTRO_LAYERS.auditorium);
  state.lighting.useAuditorium();
  renderer.shadowMap.needsUpdate = shadows;
  renderer.render(scene.scene, view.camera);
  for (const sign of signs) {
    const opacity = String(sceneryOpacity(frame.growth.value, Number(sign.dataset.depth)));
    if (sign.style.opacity !== opacity) sign.style.opacity = opacity;
  }
}

interface RenderElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: HTMLElement;
  front: SVGPathElement;
  travel: HTMLElement;
  signs: HTMLElement[];
  aura: HTMLElement;
}

async function warmPipeline(state: Pipeline, elements: RenderElements, signal: AbortSignal) {
  await state.sky.prepare(signal);
  signal.throwIfAborted();
  state.materials.update(state.palette);
  state.sky.update(state.palette);
  state.materials.setEnvironment(state.lighting.update(state.palette, state.frame.travel.value));
  state.lighting.useExterior();
  state.renderer.shadowMap.needsUpdate = true;
  // Precompile both output variants before SVG stroke animation can start.
  // 在 SVG 描边动画开始前预编译两种输出格式。
  state.renderer.setRenderTarget(state.city.target);
  await state.renderer.compileAsync(state.scene.scene, state.view.camera);
  signal.throwIfAborted();
  state.renderer.setRenderTarget(null);
  await state.renderer.compileAsync(state.scene.scene, state.view.camera);
  signal.throwIfAborted();
  draw(state, elements.camera, elements.front, elements.travel, elements.signs, elements.aura);
}

class MarkRenderer {
  private frame = 0;
  private disposed = false;
  private observer = new MutationObserver(() => this.sync());
  private colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

  constructor(
    private state: Pipeline,
    private elements: RenderElements,
    private unavailable: () => void,
    private signal: AbortSignal,
  ) {
    this.observer.observe(elements.root, { attributes: true, attributeFilter: ["data-journey"] });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    this.colorScheme.addEventListener("change", this.sync);
    elements.canvas.addEventListener("webglcontextlost", this.lost);
    document.addEventListener("visibilitychange", this.sync);
    signal.addEventListener("abort", this.dispose, { once: true });
  }

  async prepare() {
    try {
      await warmPipeline(this.state, this.elements, this.signal);
      if (this.disposed) return null;
      this.signal.removeEventListener("abort", this.dispose);
      this.elements.root.dataset.markRenderer = "mesh";
      this.elements.root.dataset.renderEngine = "three";
      this.sync();
      return this.dispose;
    } catch {
      this.dispose();
      if (!this.signal.aborted) this.unavailable();
      return null;
    }
  }

  private paint = () => {
    const { camera, front, travel, signs, aura } = this.elements;
    try {
      draw(this.state, camera, front, travel, signs, aura);
      this.frame = requestAnimationFrame(this.paint);
    } catch {
      this.dispose();
      this.unavailable();
    }
  };

  private sync = () => {
    cancelAnimationFrame(this.frame);
    const { root, canvas, signs } = this.elements;
    if (root.dataset.journey === "draw")
      for (const sign of signs) sign.style.removeProperty("opacity");
    if (
      this.disposed ||
      root.dataset.markRenderer !== "mesh" ||
      document.hidden ||
      !["approach", "cruise", "retreat"].includes(root.dataset.journey ?? "")
    )
      return;
    this.state.palette = createIntroPalette(canvas);
    this.state.fog.color.copy(this.state.palette.haze);
    this.state.materials.update(this.state.palette);
    this.state.sky.update(this.state.palette);
    this.state.materials.setEnvironment(
      this.state.lighting.update(this.state.palette, this.state.frame.travel.value),
    );
    this.state.renderer.shadowMap.needsUpdate = true;
    this.paint();
  };

  private lost = (event: Event) => {
    event.preventDefault();
    this.dispose();
    this.unavailable();
  };

  private dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.sync);
    this.colorScheme.removeEventListener("change", this.sync);
    this.elements.canvas.removeEventListener("webglcontextlost", this.lost);
    this.signal.removeEventListener("abort", this.dispose);
    delete this.elements.root.dataset.markRenderer;
    delete this.elements.root.dataset.renderEngine;
    this.state.dispose();
  };
}

/**
 * Three.js prepares before drawing; WAAPI still owns all visible motion.
 * Three.js 在描边前完成准备，所有可见运动仍由 WAAPI 驱动。
 */
export async function mountMarkRenderer(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  paths: SVGPathElement[],
  unavailable: () => void,
  signal: AbortSignal,
): Promise<(() => void) | null> {
  if (signal.aborted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const camera = root.querySelector<HTMLElement>(".xca-ca-intro__camera");
  const front = root.querySelector<SVGPathElement>(".xca-ca-intro__front path");
  const travel = root.querySelector<HTMLElement>(".xca-ca-intro__travel");
  const aura = root.querySelector<HTMLElement>(".xca-ca-intro__aura");
  if (!camera || !front || !travel || !aura) return null;
  try {
    const state = createPipeline(root, canvas, paths);
    const elements = {
      root,
      canvas,
      camera,
      front,
      travel,
      aura,
      signs: [...root.querySelectorAll<HTMLElement>(".xca-ca-intro__rib")],
    };
    return await new MarkRenderer(state, elements, unavailable, signal).prepare();
  } catch {
    return null;
  }
}
