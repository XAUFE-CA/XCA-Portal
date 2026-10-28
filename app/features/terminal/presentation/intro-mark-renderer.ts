import { tokenLength } from "~/utils/cssTokens";
import {
  JOURNEY,
  ROAD_MATERIALIZATION,
  roadGrowth,
  SCENERY_REVEAL,
  sceneryOpacity,
} from "./intro-geometry";
import { createMarkMesh } from "./intro-mark-mesh";

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute float material;
uniform mat4 camera;
uniform vec2 viewport;
uniform mediump float fill;
uniform float growth;
uniform float travel;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
void main() {
  vec3 world = position;
  if (material < 0.5) world.z *= fill;
  else if (material < 1.5) world.z = ${JOURNEY.roadStart.toFixed(1)} + (position.z - ${JOURNEY.roadStart.toFixed(1)}) * growth + travel;
  else world.z += travel;
  vec4 view = camera * vec4(world, 1.0);
  float distance = ${JOURNEY.perspective.toFixed(1)} - view.z;
  gl_Position = vec4(2.0 * ${JOURNEY.perspective.toFixed(1)} * view.x / viewport.x,
    -2.0 * ${JOURNEY.perspective.toFixed(1)} * view.y / viewport.y,
    ${((JOURNEY.far + JOURNEY.near) / (JOURNEY.far - JOURNEY.near)).toFixed(12)} * distance - ${((2 * JOURNEY.far * JOURNEY.near) / (JOURNEY.far - JOURNEY.near)).toFixed(12)}, distance);
  light = material < 0.5
    ? (abs(normal.z) > 0.99 ? 1.0 : 0.65 + 0.27 * abs(normal.y) + 0.08 * abs(normal.x))
    : (material < 1.5 ? 0.75 + 0.25 * max(0.0, -normal.y) : 0.70 + 0.16 * abs(normal.y) + 0.14 * abs(normal.x));
  road = material;
  haze = smoothstep(1800.0, 11000.0, distance);
  roadUv = vec2((position.x - ${(JOURNEY.roadX - JOURNEY.roadWidth / 2).toFixed(1)}) / ${JOURNEY.roadWidth.toFixed(1)},
    (${JOURNEY.roadStart.toFixed(1)} - position.z) / ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)});
}`;
const FRAGMENT = `
precision mediump float;
uniform vec3 bodyColor;
uniform vec3 roadColor;
uniform mediump float fill;
uniform mediump float reach;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
void main() {
  vec3 color = bodyColor * light;
  float alpha = fill;
  if (road > 1.5) {
    alpha = smoothstep(roadUv.y + ${SCENERY_REVEAL.start.toFixed(3)}, roadUv.y + ${(SCENERY_REVEAL.start + SCENERY_REVEAL.span).toFixed(3)}, reach) * (1.0 - haze * 0.65);
    if (alpha < 0.001) discard;
    color = mix(roadColor, bodyColor, road > 2.5 ? 0.32 : 0.06) * light;
  } else if (road > 0.5) {
    float edge = 1.0 - smoothstep(0.0, 0.006, min(roadUv.x, 1.0 - roadUv.x));
    float reflection = pow(max(0.0, 1.0 - abs(roadUv.x - 0.35) * 1.7), 4.0) * 0.10;
    color = mix(roadColor * light, bodyColor, reflection + edge * 0.13);
    float solid = smoothstep(0.0, ${ROAD_MATERIALIZATION.reach.toFixed(3)}, reach);
    float distanceFromFront = (1.0 - roadUv.y) * reach * ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)};
    alpha = 0.94 * solid * smoothstep(0.0, ${ROAD_MATERIALIZATION.feather.toFixed(1)}, distanceFromFront);
    if (alpha < 0.001) discard;
  }
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

interface MeshState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  count: number;
  camera: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  fill: WebGLUniformLocation | null;
  growth: WebGLUniformLocation | null;
  reach: WebGLUniformLocation | null;
  travel: WebGLUniformLocation | null;
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

function program(gl: WebGLRenderingContext): WebGLProgram {
  const value = gl.createProgram();
  if (!value) throw new Error("CA program unavailable");
  const shaders: WebGLShader[] = [];
  try {
    shaders.push(shader(gl, gl.VERTEX_SHADER, VERTEX));
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
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
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  for (const [name, size, offset] of [
    ["position", 3, 0],
    ["normal", 3, 12],
    ["material", 1, 24],
  ] as const) {
    const location = gl.getAttribLocation(pipeline, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  return {
    gl,
    program: pipeline,
    buffer,
    count: mesh.length / 7,
    camera: gl.getUniformLocation(pipeline, "camera"),
    viewport: gl.getUniformLocation(pipeline, "viewport"),
    fill: gl.getUniformLocation(pipeline, "fill"),
    growth: gl.getUniformLocation(pipeline, "growth"),
    reach: gl.getUniformLocation(pipeline, "reach"),
    travel: gl.getUniformLocation(pipeline, "travel"),
  };
}

function colors(state: MeshState, canvas: HTMLCanvasElement) {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("CA theme color unavailable");
  const style = getComputedStyle(canvas);
  for (const [name, color] of [
    ["bodyColor", style.color],
    ["roadColor", style.getPropertyValue("--xca-mesh-road-color")],
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
  canvas: HTMLCanvasElement,
  camera: HTMLElement,
  front: SVGPathElement,
  travel: HTMLElement,
  signs: HTMLElement[],
) {
  const { gl } = state;
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
  gl.uniform1f(state.growth, growth);
  gl.uniform1f(state.reach, growth);
  gl.uniform1f(state.travel, movement);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, state.count);
  for (const sign of signs) {
    const opacity = String(sceneryOpacity(growth, Number(sign.dataset.depth)));
    if (sign.style.opacity !== opacity) sign.style.opacity = opacity;
  }
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
  // Supersample even if the driver declines the requested multisampling.
  // 即使驱动拒绝请求的多重采样，也仍进行超采样。
  const ratio = Math.min(2.5, Math.max(2, window.devicePixelRatio || 1));
  const limit = active.gl.getParameter(active.gl.MAX_RENDERBUFFER_SIZE) as number;
  // Bound full-screen attachment memory on large displays (8 million pixels).
  // 在大屏幕上限制全屏附件的显存占用（800 万像素）。
  const scale = Math.min(
    ratio,
    Math.sqrt(8_000_000 / (root.clientWidth * root.clientHeight)),
    limit / root.clientWidth,
    limit / root.clientHeight,
  );
  canvas.width = Math.max(1, Math.round(root.clientWidth * scale));
  canvas.height = Math.max(1, Math.round(root.clientHeight * scale));
  active.gl.viewport(0, 0, canvas.width, canvas.height);
  let frame = 0;
  let disposed = false;
  function paint() {
    draw(
      active,
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
    canvas.removeEventListener("webglcontextlost", lost);
    delete root.dataset.markRenderer;
    active.gl.deleteBuffer(active.buffer);
    active.gl.deleteProgram(active.program);
  }
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["data-journey"] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  canvas.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", sync);
  root.dataset.markRenderer = "mesh";
  return dispose;
}
