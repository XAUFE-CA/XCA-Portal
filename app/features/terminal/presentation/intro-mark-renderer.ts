import { tokenLength } from "~/utils/cssTokens";
import { compositeCityLayer, createCityLayer } from "./intro-city-layer";
import {
  arrivalOpacity,
  JOURNEY,
  ROAD_MATERIALIZATION,
  roadBend,
  roadGrowth,
  SCENERY_REVEAL,
  sceneryOpacity,
  skylineOpacity,
} from "./intro-geometry";
import { createMarkMesh } from "./intro-mark-mesh";
import { createTransparentCity, sortTransparentCity } from "./intro-transparency";

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute float material;
attribute float roadAcross;
uniform mat4 camera;
uniform vec2 viewport;
uniform mediump float fill;
uniform float travel;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
varying mediump vec3 surfaceNormal;
varying mediump vec3 viewDirection;
varying mediump float altitude;
varying mediump vec2 facadeUv;
void main() {
  vec3 world = position;
  if (material < 0.5) world.z *= fill;
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
  surfaceNormal = mat3(camera) * normal;
  viewDirection = normalize(vec3(-view.xy, distance));
  altitude = max(0.0, (${(JOURNEY.floorY + JOURNEY.cityDrop).toFixed(1)} - position.y) / 1200.0);
  facadeUv = vec2((position.x + position.z * 0.43) / 500.0, position.y / 320.0);
  roadUv = vec2(roadAcross,
    (${JOURNEY.roadStart.toFixed(1)} - position.z) / ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)});
}`;
const FRAGMENT = `
precision mediump float;
uniform vec3 bodyColor;
uniform vec3 roadColor;
uniform vec3 signalColor;
uniform vec3 secondaryColor;
uniform float passage;
uniform vec3 skylineColor;
uniform vec3 sceneColor;
uniform float skylineVisibility;
uniform float arrivalVisibility;
uniform mediump float fill;
uniform mediump float reach;
varying mediump float light;
varying mediump float road;
varying mediump vec2 roadUv;
varying mediump float haze;
varying mediump vec3 surfaceNormal;
varying mediump vec3 viewDirection;
varying mediump float altitude;
varying mediump vec2 facadeUv;
float grain(vec2 coordinate) {
  vec3 p = fract(vec3(coordinate.xyx) * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 color = bodyColor * light;
  float alpha = fill;
  if (road > 6.5 && road < 7.5) {
    alpha = arrivalVisibility * 0.65;
    if (alpha < 0.001) discard;
    color = mix(signalColor, secondaryColor, 0.28);
  } else if (road > 4.5) {
    alpha = skylineVisibility * smoothstep(0.0, 0.22, altitude) * (0.22 - haze * 0.15);
    color = mix(skylineColor * (0.86 + light * 0.14), sceneColor, haze * 0.38);
    float bay = abs(fract(facadeUv.x) - 0.5);
    float mullion = smoothstep(0.46, 0.495, bay);
    float floors = smoothstep(0.44, 0.49, abs(fract(facadeUv.y) - 0.5));
    float reflectionBand = pow(max(0.0, 1.0 - abs(fract(facadeUv.x * 0.18 + altitude * 0.08) - 0.42) * 2.2), 5.0);
    float grazing = pow(1.0 - abs(dot(normalize(surfaceNormal), normalize(viewDirection))), 3.0);
    float detail = 1.0 - smoothstep(0.2, 0.85, haze);
    color = mix(color * (1.0 - (mullion * 0.18 + floors * 0.09) * detail), mix(sceneColor, secondaryColor, 0.2), reflectionBand * 0.2 + grazing * 0.12);
    if (road > 7.5) {
      alpha *= 1.5;
      color = mix(color, sceneColor, 0.22);
    }
    float emission = road > 5.5 && road < 6.5 ? detail : 0.0;
    color = mix(color, mix(signalColor, secondaryColor, 0.35), emission * 0.8);
    alpha += skylineVisibility * emission * (0.32 - haze * 0.18);
  } else if (road > 1.5) {
    alpha = smoothstep(roadUv.y + ${SCENERY_REVEAL.start.toFixed(3)}, roadUv.y + ${(SCENERY_REVEAL.start + SCENERY_REVEAL.span).toFixed(3)}, reach) * (1.0 - haze * 0.65);
    if (alpha < 0.001) discard;
    vec3 n = normalize(surfaceNormal);
    vec3 lighting = normalize(vec3(-0.4, -0.7, 0.6));
    float diffuse = 0.66 + 0.24 * abs(dot(n, lighting));
    float highlight = pow(max(0.0, dot(n, normalize(lighting + normalize(viewDirection)))), 28.0);
    color = mix(roadColor, bodyColor, 0.12) * diffuse + bodyColor * highlight * 0.24;
    if (road > 3.5) {
      float fresnel = pow(1.0 - abs(dot(n, normalize(viewDirection))), 3.0);
      alpha *= 0.16 + fresnel * 0.2;
      float cells = abs(fract(roadUv.y * 56.0) - 0.5);
      float grid = smoothstep(0.46, 0.49, cells);
      alpha += grid * 0.1 * (1.0 - haze);
      color = mix(roadColor, signalColor, 0.38 + fresnel * 0.25 + grid * 0.18);
    } else if (road > 2.5) {
      float nodes = pow(max(0.0, sin(roadUv.y * 150.0)), 12.0);
      color = mix(signalColor, secondaryColor, nodes * 0.35) * (1.0 + nodes * 0.3);
    }
  } else if (road > 0.5) {
    float edge = 1.0 - smoothstep(0.0, 0.006, min(roadUv.x, 1.0 - roadUv.x));
    float across = min(roadUv.x, 1.0 - roadUv.x);
    float shoulder = 1.0 - smoothstep(0.014, 0.04, across);
    float inlay = smoothstep(0.048, 0.052, across) * (1.0 - smoothstep(0.055, 0.059, across));
    float reflection = pow(max(0.0, 1.0 - abs(roadUv.x - 0.4) * 1.8), 6.0) * 0.07;
    color = mix(roadColor * light * (1.0 - shoulder * 0.14), bodyColor, reflection + edge * 0.18 + inlay * 0.14);
    float textureFade = 1.0 - haze;
    float aggregate = grain(floor(roadUv * vec2(460.0, 1850.0)));
    float roughness = grain(floor(roadUv * vec2(22.0, 160.0)));
    float seam = smoothstep(0.47, 0.495, abs(fract(roadUv.y * 72.0) - 0.5));
    float longitudinalJoint = 1.0 - smoothstep(0.001, 0.003, abs(roadUv.x - 0.5));
    color *= 1.0 + (aggregate - 0.5) * 0.065 * textureFade + (roughness - 0.5) * 0.035;
    color *= 1.0 - (seam * 0.08 + longitudinalJoint * 0.07) * textureFade;
    float grazingRoad = pow(1.0 - abs(dot(normalize(surfaceNormal), normalize(viewDirection))), 4.0);
    float edgeReflection = exp(-abs(across - 0.08) * 21.0) * (0.6 + roughness * 0.4);
    color = mix(color, mix(roadColor, signalColor, 0.35), grazingRoad * edgeReflection * 0.13);
    float guide = smoothstep(0.074, 0.078, across) * (1.0 - smoothstep(0.082, 0.086, across));
    float segment = smoothstep(0.10, 0.18, fract(roadUv.y * 18.0)) * (1.0 - smoothstep(0.78, 0.86, fract(roadUv.y * 18.0)));
    float pulse = pow(max(0.0, sin(roadUv.y * 42.0 - passage)), 8.0);
    float crossline = smoothstep(0.46, 0.49, abs(fract(roadUv.y * 9.0) - 0.5));
    float node = smoothstep(0.12, 0.13, across) * (1.0 - smoothstep(0.15, 0.16, across));
    vec3 guidance = mix(signalColor, secondaryColor, pulse * 0.65);
    float circuitry = inlay * 0.22 + guide * segment * (0.28 + pulse * 0.5 + arrivalVisibility * 0.3) + crossline * (0.025 + node * 0.2);
    color = mix(color, guidance, min(0.86, circuitry * 1.4));
    float solid = smoothstep(0.0, ${ROAD_MATERIALIZATION.reach.toFixed(3)}, reach);
    float distanceFromFront = (reach - roadUv.y) * ${(JOURNEY.depth + JOURNEY.roadStart).toFixed(1)};
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
