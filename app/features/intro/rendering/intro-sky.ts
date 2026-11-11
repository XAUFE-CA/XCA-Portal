import {
  ClampToEdgeWrapping,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  type WebGLRenderer,
} from "three";
import type { IntroPalette, IntroSkyMode } from "./intro-scene-palette";

const VERTEX = `
varying vec2 skyUv;
void main() {
  skyUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FRAGMENT = `
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform sampler2D panorama;
uniform float opacity;
uniform float stars;
uniform float daylight;
varying vec2 skyUv;
float skyHash(vec2 cell) {
  vec3 value = fract(vec3(cell.xyx) * 0.1031);
  value += dot(value, value.yzx + 33.33);
  return fract((value.x + value.y) * value.z);
}
vec3 starfield(vec2 angular, vec3 direction, vec3 cloud) {
  vec2 field = angular * vec2(512.0, 256.0);
  vec2 cell = mod(floor(field), vec2(512.0, 256.0));
  vec2 footprint = max(fwidth(field), vec2(0.0001));
  float density = 0.022 * sqrt(max(0.0, 1.0 - direction.y * direction.y));
  if (skyHash(cell) >= density) return vec3(0.0);
  vec2 center = 0.2 + vec2(skyHash(cell + 19.7), skyHash(cell + 41.3)) * 0.6;
  vec2 distance = (fract(field) - center) / footprint;
  float point = exp(-dot(distance, distance) * 1.8);
  float filtering = min(1.0, 0.020 / dot(footprint, footprint));
  float clearSky = 1.0 - smoothstep(0.012, 0.060, dot(cloud, vec3(0.2126, 0.7152, 0.0722)));
  float altitude = smoothstep(0.04, 0.22, direction.y);
  float magnitude = mix(0.35, 1.0, skyHash(cell + 7.2));
  vec3 color = mix(vec3(0.68, 0.84, 1.0), vec3(1.0, 0.91, 0.78), step(0.8, skyHash(cell + 3.1)));
  return color * point * filtering * clearSky * altitude * magnitude * stars * 5.0;
}
void main() {
  vec4 eye = inverseProjection * vec4(skyUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 direction = normalize((cameraWorld * vec4(normalize(eye.xyz), 0.0)).xyz);
  // Match Three's equirectangular PMREM orientation, including the vertical image flip.
  // 与 Three 等距柱状 PMREM 的方向一致，包括图像的垂直翻转。
  vec2 angular = vec2(
    atan(direction.z, direction.x) * 0.15915494309189535 + 0.5,
    asin(clamp(direction.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5);
  // SRGB texture sampling already returns linear radiance; HDR targets remain linear.
  // SRGB 纹理采样已经返回线性辐射值，HDR 目标始终保持线性。
  vec3 radiance = texture2D(panorama, angular).rgb;
  if (stars > 0.0) radiance += starfield(angular, direction, radiance);
  gl_FragColor = vec4(radiance, opacity);
  #include <tonemapping_fragment>
  // Day imagery is display-referred; a second filmic curve washes out blue and cloud contrast.
  // 日景素材已按显示效果生成，重复胶片映射会冲淡蓝天与云层对比。
  if (daylight > 0.5) gl_FragColor.rgb = radiance;
  #include <colorspace_fragment>
  gl_FragColor.rgb *= opacity;
}`;

interface Panorama {
  texture: Texture;
  bitmap: ImageBitmap;
}

type Panoramas = Record<IntroSkyMode, Panorama>;

interface Preparation {
  panoramas: Panoramas | null;
  pending: Promise<void> | null;
  controller: AbortController | null;
  disposed: boolean;
}

function releasePanorama(panorama: Panorama) {
  panorama.texture.dispose();
  panorama.bitmap.close();
}

async function loadPanorama(url: string, signal: AbortSignal): Promise<Panorama> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Intro sky unavailable: ${response.status} ${url}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  let texture: Texture | undefined;
  try {
    signal.throwIfAborted();
    texture = new Texture(bitmap);
    texture.name = url;
    texture.colorSpace = SRGBColorSpace;
    texture.mapping = EquirectangularReflectionMapping;
    // ImageBitmap ignores Texture.flipY, so the decoder owns the one required flip.
    // ImageBitmap 忽略 Texture.flipY，因此由解码器完成唯一一次必要翻转。
    texture.flipY = false;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return { texture, bitmap };
  } catch (error) {
    texture?.dispose();
    bitmap.close();
    throw error;
  }
}

async function loadPanoramas(controller: AbortController): Promise<Panoramas> {
  const load = (url: string) =>
    loadPanorama(url, controller.signal).catch((error: unknown) => {
      controller.abort(error);
      throw error;
    });
  // Await both settlements before cleanup: a late bitmap decode must never escape ownership.
  // 等待两项都结束后再清理，避免稍后完成的位图解码脱离资源管理。
  const results = await Promise.allSettled([
    load("/intro/sky-day.webp"),
    load("/intro/sky-night.webp"),
  ]);
  const [day, night] = results;
  if (day.status === "fulfilled" && night.status === "fulfilled" && !controller.signal.aborted) {
    return { day: day.value, night: night.value };
  }
  for (const result of results) {
    if (result.status === "fulfilled") releasePanorama(result.value);
  }
  controller.signal.throwIfAborted();
  throw new Error("Intro sky preparation failed");
}

function preparePanoramas(
  state: Preparation,
  signal: AbortSignal,
  renderer: WebGLRenderer,
): Promise<void> {
  if (state.disposed) return Promise.reject(new Error("Intro sky already disposed"));
  if (signal.aborted) return Promise.reject(signal.reason);
  if (state.panoramas) return Promise.resolve();
  if (state.pending) return state.pending;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  state.controller = controller;
  state.pending = loadPanoramas(controller)
    .then((panoramas) => {
      try {
        controller.signal.throwIfAborted();
        if (state.disposed) throw new Error("Intro sky already disposed");
        panoramas.day.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        renderer.initTexture(panoramas.day.texture);
        renderer.initTexture(panoramas.night.texture);
        state.panoramas = panoramas;
      } catch (error) {
        releasePanorama(panoramas.day);
        releasePanorama(panoramas.night);
        throw error;
      }
    })
    .finally(() => {
      signal.removeEventListener("abort", abort);
      state.controller = null;
      state.pending = null;
    });
  return state.pending;
}

export interface IntroSky {
  prepare(signal: AbortSignal): Promise<void>;
  texture(): Texture;
  update(palette: IntroPalette): void;
  draw(camera: PerspectiveCamera, opacity: number): void;
  dispose(): void;
}

/** World-space clouds and filtered stars stay fixed during travel and enter reflection capture.
    世界方向云层与像素过滤星点在运动中保持固定，并参与城市反射捕获。 */
export function createIntroSky(renderer: WebGLRenderer): IntroSky {
  const preparation: Preparation = {
    panoramas: null,
    pending: null,
    controller: null,
    disposed: false,
  };
  let mode: IntroSkyMode = "night";
  const geometry = new PlaneGeometry(2, 2);
  const uniforms = {
    inverseProjection: { value: new Matrix4() },
    cameraWorld: { value: new Matrix4() },
    panorama: { value: null as Texture | null },
    opacity: { value: 0 },
    stars: { value: 0 },
    daylight: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    transparent: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    async prepare(signal) {
      await preparePanoramas(preparation, signal, renderer);
      const panoramas = preparation.panoramas;
      if (!panoramas) throw new Error("Intro sky is unavailable after preparation");
      uniforms.panorama.value = panoramas[mode].texture;
    },
    texture() {
      if (!preparation.panoramas) throw new Error("Intro sky has not been prepared");
      return preparation.panoramas[mode].texture;
    },
    update(palette) {
      mode = palette.sky.mode;
      uniforms.daylight.value = palette.daylight;
      uniforms.stars.value = palette.sky.starIntensity;
      if (preparation.panoramas) uniforms.panorama.value = preparation.panoramas[mode].texture;
    },
    draw(current, opacity) {
      if (!preparation.panoramas || preparation.disposed) return;
      uniforms.inverseProjection.value.copy(current.projectionMatrixInverse);
      uniforms.cameraWorld.value.copy(current.matrixWorld);
      uniforms.opacity.value = Math.max(0, Math.min(1, opacity));
      renderer.render(scene, camera);
    },
    dispose() {
      if (preparation.disposed) return;
      preparation.disposed = true;
      preparation.controller?.abort(new DOMException("Intro sky disposed", "AbortError"));
      if (preparation.panoramas) {
        releasePanorama(preparation.panoramas.day);
        releasePanorama(preparation.panoramas.night);
        preparation.panoramas = null;
      }
      uniforms.panorama.value = null;
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}
