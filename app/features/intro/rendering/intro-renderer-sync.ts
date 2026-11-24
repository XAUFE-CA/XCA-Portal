import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from "three";

export type IntroRendererTier = "software" | "integrated" | "discrete";

const DISCRETE_MAX_PIXELS = 8_000_000;
const INTEGRATED_MAX_PIXELS = 780_000;
const SYNC_KEYFRAME = { transform: "translateZ(var(--xca-sync, 0px))" };

/**
 * Classify a WebGL renderer string into software, integrated, or discrete hardware tiers.
 * 将 WebGL 渲染器字符串归类为软件、核显或独显层级。
 */
export function classifyIntroRenderer(info: string): IntroRendererTier {
  if (/swiftshader|llvmpipe|lavapipe|softpipe|software|basic render/i.test(info)) {
    return "software";
  }
  const intelIntegrated = /\bintel\b/i.test(info) && !/\barc(?:\(tm\))?\s+[ab]\d{3}\b/i.test(info);
  const amdIntegrated = /\bradeon(?:\(tm\))?\s+(?:graphics\b|vega\s*\d+\b|\d{3}m\b)/i.test(info);
  const mobileGpu = /\b(?:adreno|mali|powervr|vivante|tegra|immortalis)\b/i.test(info);
  if (intelIntegrated || amdIntegrated || mobileGpu) {
    return "integrated";
  }
  return "discrete";
}

/**
 * Bound drawing buffer pixel ratio by GPU tier, pixel budget, and max texture size.
 * 按 GPU 层级、像素预算和最大纹理尺寸限制绘制缓冲像素比。
 */
export function computeIntroPixelRatio(
  width: number,
  height: number,
  dpr: number,
  maxTextureSize: number,
  tier: IntroRendererTier,
): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const ratioCap = tier === "discrete" ? Math.min(2, dpr || 1) : Math.min(1, dpr || 1);
  const maxPixels = tier === "discrete" ? DISCRETE_MAX_PIXELS : INTEGRATED_MAX_PIXELS;
  return Math.min(
    ratioCap,
    Math.sqrt(maxPixels / (safeWidth * safeHeight)),
    maxTextureSize / safeWidth,
    maxTextureSize / safeHeight,
  );
}

/**
 * Create the scene WebGL2 renderer and bound its drawing buffer pixel budget.
 * 创建场景 WebGL2 渲染器，并限制绘制缓冲像素预算。
 */
export function createRenderer(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, context, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.autoClear = false;
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererString = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  const tier = classifyIntroRenderer(rendererString);
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  const ratio = computeIntroPixelRatio(
    width,
    height,
    window.devicePixelRatio || 1,
    renderer.capabilities.maxTextureSize,
    tier,
  );
  // Integrated and software tiers halve transmission pass resolution while keeping original materials.
  // 核显与软件层将透射通道分辨率减半，同时保留全部原始材质。
  if (tier !== "discrete") renderer.transmissionResolutionScale = 0.5;
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  return renderer;
}

/**
 * Keep WAAPI-transformed DOM elements locked to the main-thread WebGL commit cadence.
 * 使 WAAPI 变换的 DOM 元素与主线程 WebGL 提交节拍保持同步。
 */
export function createCompositorSync(targets: readonly (HTMLElement | null)[]) {
  const locks = new Map<HTMLElement, Animation>();
  function sync() {
    for (const target of targets) {
      if (!target) continue;
      const lock = locks.get(target);
      const hasPrimary = target
        .getAnimations()
        .some((animation) => animation !== lock && animation.playState === "running");
      if (hasPrimary && !lock) {
        // An additive var() transform prevents compositor-thread drift without changing the matrix.
        // 叠加使用 var() 的零变换可阻止合成器线程提前走位，同时保持变换矩阵完全不变。
        const nextLock = target.animate([SYNC_KEYFRAME, SYNC_KEYFRAME], {
          duration: 1000,
          iterations: Number.POSITIVE_INFINITY,
          composite: "add",
        });
        locks.set(target, nextLock);
      } else if (!hasPrimary && lock) {
        lock.cancel();
        locks.delete(target);
      }
    }
  }
  function release() {
    for (const lock of locks.values()) lock.cancel();
    locks.clear();
  }
  return { sync, release };
}
