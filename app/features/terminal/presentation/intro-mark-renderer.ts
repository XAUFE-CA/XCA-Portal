import { tokenLength } from "~/utils/cssTokens";
import { compositeCityLayer, createCityLayer } from "./intro-city-layer";
import {
  ARRIVAL_ENTRY,
  arrivalOpacity,
  entryGrowth,
  JOURNEY,
  roadBend,
  roadGrowth,
  sceneryOpacity,
  skylineOpacity,
} from "./intro-geometry";
import { createMarkMesh } from "./intro-mark-mesh";
import { FRAGMENT, VERTEX } from "./intro-mark-shaders";
import { createTransparentCity, sortTransparentCity } from "./intro-transparency";

interface MeshState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  count: number;
  city: ReturnType<typeof createTransparentCity>;
  attributes: { location: number; size: number; offset: number }[];
  camera: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  fill: WebGLUniformLocation | null;
  reach: WebGLUniformLocation | null;
  travel: WebGLUniformLocation | null;
  passage: WebGLUniformLocation | null;
  skylineVisibility: WebGLUniformLocation | null;
  arrivalVisibility: WebGLUniformLocation | null;
  entryGrowth: WebGLUniformLocation | null;
  portalEye: WebGLUniformLocation | null;
}

function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const value = gl.createShader(type);
  if (!value) throw new Error("CA shader unavailable");
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    gl.deleteShader(value);
    throw new Error("CA shader compilation failed");
  }
  return value;
}

function program(gl: WebGLRenderingContext, vertex = VERTEX, fragment = FRAGMENT): WebGLProgram {
  const value = gl.createProgram();
  if (!value) throw new Error("CA program unavailable");
  const shaders: WebGLShader[] = [];
  try {
    shaders.push(shader(gl, gl.VERTEX_SHADER, vertex));
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, fragment));
    for (const stage of shaders) gl.attachShader(value, stage);
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error("CA shader link failed");
    return value;
  } catch (error) {
    gl.deleteProgram(value);
    throw error;
  } finally {
    for (const stage of shaders) gl.deleteShader(stage);
  }
}

function initialize(canvas: HTMLCanvasElement, mesh: Float32Array): MeshState | null {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true });
  if (!gl) return null;
  const pipeline = program(gl);
  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(pipeline);
    return null;
  }
  gl.useProgram(pipeline);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const packed = new Float32Array((mesh.length / 7) * 8);
  for (let index = 0; index < mesh.length / 7; index++) {
    packed.set(mesh.subarray(index * 7, index * 7 + 7), index * 8);
    const x = mesh[index * 7] ?? 0,
      z = mesh[index * 7 + 2] ?? 0;
    packed[index * 8 + 7] = (x - roadBend(z).x - JOURNEY.roadX) / JOURNEY.roadWidth + 0.5;
  }
  gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
  const attributes = (
    [
      ["position", 3, 0],
      ["normal", 3, 12],
      ["material", 1, 24],
      ["roadAcross", 1, 28],
    ] as const
  ).map(([name, size, offset]) => {
    const location = gl.getAttribLocation(pipeline, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    return { location, size, offset };
  });
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return {
    gl,
    program: pipeline,
    buffer,
    count: mesh.length / 7,
    city: createTransparentCity(packed),
    attributes,
    camera: gl.getUniformLocation(pipeline, "camera"),
    viewport: gl.getUniformLocation(pipeline, "viewport"),
    fill: gl.getUniformLocation(pipeline, "fill"),
    reach: gl.getUniformLocation(pipeline, "reach"),
    travel: gl.getUniformLocation(pipeline, "travel"),
    passage: gl.getUniformLocation(pipeline, "passage"),
    skylineVisibility: gl.getUniformLocation(pipeline, "skylineVisibility"),
    arrivalVisibility: gl.getUniformLocation(pipeline, "arrivalVisibility"),
    entryGrowth: gl.getUniformLocation(pipeline, "entryGrowth"),
    portalEye: gl.getUniformLocation(pipeline, "portalEye"),
  };
}

function colors(state: MeshState, canvas: HTMLCanvasElement) {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("CA theme color unavailable");
  const style = getComputedStyle(canvas);
  const home = canvas.closest(".site-shell--home");
  for (const [name, color] of [
    ["bodyColor", style.color],
    ["roadColor", style.getPropertyValue("--xca-mesh-road-color")],
    ["signalColor", style.getPropertyValue("--neoverse-color-accent-primary")],
    ["secondaryColor", style.getPropertyValue("--neoverse-color-accent-secondary")],
    ["skylineColor", style.getPropertyValue("--xca-mesh-skyline-color")],
    [
      "sceneColor",
      home
        ? getComputedStyle(home).backgroundColor
        : style.getPropertyValue("--neoverse-color-surface-canvas"),
    ],
  ]) {
    context.fillStyle = color ?? style.color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    state.gl.uniform3f(
      state.gl.getUniformLocation(state.program, name ?? ""),
      (pixel[0] ?? 0) / 255,
      (pixel[1] ?? 0) / 255,
      (pixel[2] ?? 0) / 255,
    );
  }
}

function draw(
  state: MeshState,
  layer: NonNullable<ReturnType<typeof createCityLayer>>,
  canvas: HTMLCanvasElement,
  camera: HTMLElement,
  front: SVGPathElement,
  travel: HTMLElement,
  signs: HTMLElement[],
) {
  const { gl } = state;
  bindMesh(state);
  // Read the existing WAAPI camera. No independent clock, easing or pose state.
  // 读取现有 WAAPI 相机；不维护独立时钟、缓动或姿态状态。
  const view = new DOMMatrixReadOnly(getComputedStyle(camera).transform);
  const eye = view.inverse().transformPoint({ x: 0, y: 0, z: JOURNEY.perspective });
  const movement = new DOMMatrixReadOnly(getComputedStyle(travel).transform).m43;
  const fill = Math.max(0, Math.min(1, Number.parseFloat(getComputedStyle(front).fillOpacity)));
  gl.uniformMatrix4fv(state.camera, false, view.toFloat32Array());
  gl.uniform2f(state.viewport, canvas.clientWidth, canvas.clientHeight);
  gl.uniform1f(state.fill, fill);
  const growth = roadGrowth(eye.z);
  gl.uniform1f(state.reach, growth);
  gl.uniform1f(state.travel, movement);
  gl.uniform1f(state.passage, (-eye.z + movement) / 700);
  gl.uniform1f(state.skylineVisibility, 1);
  gl.uniform1f(state.arrivalVisibility, arrivalOpacity(eye.z));
  gl.uniform1f(state.entryGrowth, entryGrowth(eye.z));
  gl.uniform3f(
    state.portalEye,
    (eye.x - JOURNEY.roadX) / ARRIVAL_ENTRY.width,
    (eye.y - JOURNEY.floorY + ARRIVAL_ENTRY.height / 2) / ARRIVAL_ENTRY.width,
    (eye.z - movement - ARRIVAL_ENTRY.front) / ARRIVAL_ENTRY.width,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.disable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  if (sortTransparentCity(state.city, view.toFloat64Array()))
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.city.sorted);
  gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLES, 0, state.city.count);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.depthMask(false);
  compositeCityLayer(gl, layer, skylineOpacity(eye.z));
  bindMesh(state);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.drawArrays(gl.TRIANGLES, state.city.count, state.count - state.city.count);
  for (const sign of signs) {
    const opacity = String(sceneryOpacity(growth, Number(sign.dataset.depth)));
    if (sign.style.opacity !== opacity) sign.style.opacity = opacity;
  }
}

function bindMesh(state: MeshState) {
  const { gl } = state;
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  for (const { location, size, offset } of state.attributes) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
  }
}

/**
 * Software rasterizers fill pixels on the CPU, so supersampling them costs frames without
 * gaining detail the scene can show. Detect one and keep the native resolution instead.
 * 软件光栅器在 CPU 上填充像素，对它超采样只会掉帧，换不来场景能呈现的细节。
 * 因此识别软件光栅器并保持原生分辨率。
 */
function softwareRasterizer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  if (!info) return false;
  const renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

function prepareCityLayer(state: MeshState, root: HTMLElement, canvas: HTMLCanvasElement) {
  // Supersample even if the driver declines the requested multisampling.
  // 即使驱动拒绝请求的多重采样，也仍进行超采样。
  const ratio = softwareRasterizer(state.gl)
    ? 1
    : Math.min(2.5, Math.max(2, window.devicePixelRatio || 1));
  const limit = state.gl.getParameter(state.gl.MAX_RENDERBUFFER_SIZE) as number;
  // Bound each full-screen attachment on large displays (8 million pixels).
  // 在大屏幕上限制每个全屏附件的显存占用（800 万像素）。
  const scale = Math.min(
    ratio,
    Math.sqrt(8_000_000 / (root.clientWidth * root.clientHeight)),
    limit / root.clientWidth,
    limit / root.clientHeight,
  );
  canvas.width = Math.max(1, Math.round(root.clientWidth * scale));
  canvas.height = Math.max(1, Math.round(root.clientHeight * scale));
  state.gl.viewport(0, 0, canvas.width, canvas.height);
  const layer = createCityLayer(state.gl, canvas.width, canvas.height, (v, f) =>
    program(state.gl, v, f),
  );
  return layer;
}

/**
 * A sorted transparent city pass precedes the depth-writing scene; WAAPI owns all motion.
 * 排序后的透明城市先于写入深度的场景绘制。所有运动由 WAAPI 驱动。
 */
export function mountMarkRenderer(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  paths: SVGPathElement[],
  unavailable: () => void,
): (() => void) | null {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const camera = root.querySelector<HTMLElement>(".xca-ca-intro__camera");
  const front = root.querySelector<SVGPathElement>(".xca-ca-intro__front path");
  const travel = root.querySelector<HTMLElement>(".xca-ca-intro__travel");
  if (!camera || !front || !travel) return null;
  const signs = [...root.querySelectorAll<HTMLElement>(".xca-ca-intro__rib")];
  let state: MeshState | null;
  try {
    state = initialize(canvas, createMarkMesh(paths, tokenLength(root, "--neoverse-radius-lg")));
  } catch {
    return null;
  }
  if (!state) return null;
  const active = state;
  const candidate = prepareCityLayer(active, root, canvas);
  if (!candidate) {
    active.gl.deleteBuffer(active.buffer);
    active.gl.deleteProgram(active.program);
    return null;
  }
  const layer = candidate;
  let frame = 0;
  let disposed = false;
  function paint() {
    draw(
      active,
      layer,
      canvas,
      camera as HTMLElement,
      front as SVGPathElement,
      travel as HTMLElement,
      signs,
    );
    frame = requestAnimationFrame(paint);
  }
  function sync() {
    cancelAnimationFrame(frame);
    if (root.dataset.journey === "draw")
      for (const sign of signs) sign.style.removeProperty("opacity");
    if (
      disposed ||
      !["approach", "cruise", "retreat"].includes(root.dataset.journey ?? "") ||
      document.hidden
    )
      return;
    colors(active, canvas);
    paint();
  }
  function lost(event: Event) {
    event.preventDefault();
    dispose();
    unavailable();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
    colorScheme.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", lost);
    delete root.dataset.markRenderer;
    active.gl.deleteBuffer(active.buffer);
    active.gl.deleteProgram(active.program);
    layer.dispose();
  }
  const observer = new MutationObserver(sync);
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", sync);
  observer.observe(root, { attributes: true, attributeFilter: ["data-journey"] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  canvas.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", sync);
  root.dataset.markRenderer = "mesh";
  return dispose;
}
