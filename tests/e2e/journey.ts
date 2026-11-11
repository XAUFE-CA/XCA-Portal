import { expect, type Page } from "@playwright/test";
import { AUDITORIUM, AUDITORIUM_MATERIAL } from "../../app/features/intro/core/intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY } from "../../app/features/intro/core/intro-geometry";
import { advanceUntil, SCENE_TIMEOUT } from "./timing";

type ProbeRect = readonly [left: number, top: number, right: number, bottom: number];
export interface RoomPortalProbe {
  eyeZ: number;
  roadX: number;
  perspective: number;
  material: number;
  vertices: number[];
  levels: number[];
  growth: number;
  masks: ProbeRect[];
  expected: number[];
  tolerance: number[];
}
interface CapturedMaterial {
  shaders: { type: number; source: string }[];
  uniforms: { name: string; type: number; value: number | number[] }[];
}
interface PortalReplay {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  shaders: WebGLShader[];
  textures: WebGLTexture[];
}

declare global {
  interface Window {
    introMaterials: Record<number, CapturedMaterial>;
    introPortalReplay: PortalReplay | undefined;
  }
}

export async function freezeApproach(page: Page, fraction: number) {
  await page.evaluate((progress) => {
    const camera = document.getAnimations().find((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target instanceof Element && target.matches(".xca-ca-intro__camera");
    });
    const elapsed = Number(camera?.effect?.getTiming().duration ?? 0) * progress;
    for (const animation of document.getAnimations()) {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (!(target instanceof Element) || !target.closest(".xca-ca-intro, .xca-terminal-window"))
        continue;
      if (animation.playState === "finished") continue;
      animation.pause();
      animation.currentTime = elapsed;
    }
  }, fraction);
}

export function approachPositions(page: Page, depths: number[]) {
  return page.evaluate((targets) => {
    const camera = document
      .getAnimations()
      .find(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target instanceof Element &&
          animation.effect.target.matches(".xca-ca-intro__camera"),
      );
    if (!(camera?.effect instanceof KeyframeEffect)) throw new Error("Journey camera required");
    const viewport = document.querySelector(".xca-ca-intro__viewport");
    if (!viewport) throw new Error("Scene viewport required");
    const focal = Number.parseFloat(getComputedStyle(viewport).perspective);
    const frames = camera.effect.getKeyframes().map((frame) => ({
      progress: frame.computedOffset,
      z: new DOMMatrixReadOnly(String(frame.transform))
        .inverse()
        .transformPoint({ x: 0, y: 0, z: focal }).z,
    }));
    return targets.map(
      (depth) =>
        frames.reduce((nearest, frame) =>
          Math.abs(frame.z - depth) < Math.abs(nearest.z - depth) ? frame : nearest,
        ).progress,
    );
  }, depths);
}
export async function resumeScene(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations())
      if (animation.playState === "paused") animation.play();
  });
}

export async function recordBannerPrinting(page: Page) {
  await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>(".xca-terminal-screen");
    const banner = screen?.querySelector(".xca-terminal-banner");
    if (!screen || !banner) throw new Error("Terminal banner is required");
    const rows: number[] = [];
    const observer = new MutationObserver(() => {
      const text = banner.textContent ?? "";
      const count = text.length ? text.split("\n").length : 0;
      if (rows.at(-1) !== count) rows.push(count);
      screen.dataset.printedBannerRows = JSON.stringify(rows);
      if (screen.classList.contains("xca-terminal-screen--ready")) observer.disconnect();
    });
    observer.observe(screen, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

/** Step the scene timeline until the camera reports a journey stage. */
export function advanceToStage(page: Page, stage: string): Promise<boolean> {
  return advanceUntil(
    page,
    `document.querySelector(".xca-ca-intro")?.dataset.journey === "${stage}"`,
  );
}

/** Step the scene timeline until the terminal reports a screen modifier. */
export function advanceToScreen(page: Page, screen: string): Promise<boolean> {
  return advanceUntil(page, `!!document.querySelector(".xca-terminal-screen--${screen}")`);
}

export async function expectCenteredTerminal(
  page: Page,
  viewport: { width: number; height: number },
) {
  const terminal = page.locator(".xca-terminal-window");
  await expect(async () => {
    const geometry = await terminal.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return {
        width: bounds.width,
        height: bounds.height,
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
        scaleX: transform.a,
        scaleY: transform.d,
      };
    });
    expect(geometry.scaleX).toBeCloseTo(geometry.scaleY, 3);
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.height).toBeLessThanOrEqual(viewport.height);
    expect(geometry.x).toBeCloseTo(viewport.width / 2, 0);
    expect(geometry.y).toBeCloseTo(viewport.height / 2, 0);
  }).toPass({ timeout: SCENE_TIMEOUT });
  await expect(terminal).not.toHaveAttribute("inert");
}

export async function expectStageGlass(page: Page) {
  const surface = await page.locator(".xca-terminal-window").evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    const w = node.clientWidth / 2,
      h = node.clientHeight / 2;
    const project = (x: number, y: number) => {
      const point = matrix.transformPoint(new DOMPoint(x, y));
      return { x: point.x / point.w, y: point.y / point.w };
    };
    const top = project(-w, -h),
      right = project(w, -h),
      bottom = project(-w, h);
    return {
      vertical: Math.abs(top.x - bottom.x) / Math.abs(right.x - top.x),
      horizontal: top.y - right.y,
      edge: getComputedStyle(node, "::before").display,
    };
  });
  expect(surface.vertical).toBeLessThan(0.15);
  expect(surface.horizontal).toBeCloseTo(0, 6);
  expect(surface.edge).toBe("block");
}

export function roomPortalProbe(
  eyeZ: number,
  levels: number[],
  material: number = AUDITORIUM_MATERIAL.structure,
  planeZ: number = AUDITORIUM.back,
): RoomPortalProbe {
  const { floorY, roadX, perspective } = JOURNEY;
  const { front, width, height } = ARRIVAL_ENTRY;
  const scale = perspective / (eyeZ - planeZ);
  const wall: ProbeRect = [
    256 - AUDITORIUM.halfWidth * scale,
    256 + AUDITORIUM.ceiling * scale,
    256 + AUDITORIUM.halfWidth * scale,
    256 + floorY * scale,
  ];
  const outside = eyeZ > front;
  const gateScale = outside ? perspective / (eyeZ - front) : 0;
  const masks = levels.map((level): ProbeRect => {
    if (outside && (level === 0 || planeZ > front)) return [0, 0, 0, 0];
    const halfWidth = outside ? (width * level * gateScale) / 2 : Infinity;
    const halfHeight = outside ? (height * level * gateScale) / 2 : Infinity;
    const y = outside ? (floorY - height / 2) * gateScale : 0;
    return [
      Math.max(0, wall[0], 256 - halfWidth),
      Math.max(0, wall[1], 256 + y - halfHeight),
      Math.min(512, wall[2], 256 + halfWidth),
      Math.min(512, wall[3], 256 + y + halfHeight),
    ];
  });
  const expected = masks.map(
    ([left, top, right, bottom]) =>
      Math.max(0, Math.floor(right - 0.5) - Math.ceil(left - 0.5) + 1) *
      Math.max(0, Math.floor(bottom - 0.5) - Math.ceil(top - 0.5) + 1),
  );
  const tolerance = masks.map(
    ([left, top, right, bottom]) => 2 * (Math.max(0, right - left) + Math.max(0, bottom - top)) + 4,
  );
  const vertices = [
    [roadX - AUDITORIUM.halfWidth, AUDITORIUM.ceiling, planeZ],
    [roadX - AUDITORIUM.halfWidth, floorY, planeZ],
    [roadX + AUDITORIUM.halfWidth, AUDITORIUM.ceiling, planeZ],
    [roadX + AUDITORIUM.halfWidth, floorY, planeZ],
  ].flat();
  return {
    eyeZ,
    roadX,
    perspective,
    material,
    vertices,
    levels,
    growth: 1,
    masks,
    expected,
    tolerance,
  };
}

export async function captureRoomMaterials(page: Page) {
  await page.addInitScript(() => {
    const materials: Record<number, CapturedMaterial> = {};
    Object.assign(window, { introMaterials: materials });
    const prototype = WebGL2RenderingContext.prototype;
    const inspect = (gl: WebGL2RenderingContext) => {
      if (
        !(gl.canvas instanceof HTMLCanvasElement) ||
        !gl.canvas.classList.contains("xca-ca-intro__mesh")
      )
        return;
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program) return;
      const shaders = (gl.getAttachedShaders(program) ?? []).map((shader) => ({
        type: gl.getShaderParameter(shader, gl.SHADER_TYPE) as number,
        source: gl.getShaderSource(shader) ?? "",
      }));
      const selector = Number(shaders[0]?.source.match(/#define INTRO_MATERIAL (\d+)/)?.[1]);
      if (selector < 9 || !Number.isFinite(selector) || materials[selector]) return;
      const uniforms: CapturedMaterial["uniforms"] = [];
      for (
        let index = 0;
        index < Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
        index++
      ) {
        const info = gl.getActiveUniform(program, index);
        if (!info) continue;
        const location = gl.getUniformLocation(program, info.name);
        if (!location) continue;
        const value: number | boolean | Float32Array | Int32Array | Uint32Array = gl.getUniform(
          program,
          location,
        );
        uniforms.push({
          name: info.name,
          type: info.type,
          value:
            typeof value === "number" || typeof value === "boolean" ? Number(value) : [...value],
        });
      }
      materials[selector] = { shaders, uniforms };
    };
    const arrays = prototype.drawArrays,
      elements = prototype.drawElements;
    prototype.drawArrays = function (mode, first, count) {
      arrays.call(this, mode, first, count);
      inspect(this);
    };
    prototype.drawElements = function (mode, count, type, offset) {
      elements.call(this, mode, count, type, offset);
      inspect(this);
    };
  });
}

function createRoomReplay(probe: RoomPortalProbe) {
  const captured = window.introMaterials[probe.material];
  if (!captured) throw new Error(`Rendered Three material ${probe.material} required`);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new Error("WebGL2 required");
  const program = gl.createProgram(),
    buffer = gl.createBuffer();
  if (!program || !buffer) throw new Error("GPU resources required");
  const shaders: WebGLShader[] = [];
  window.introPortalReplay = { gl, program, buffer, shaders, textures: [] };
  for (const { type, source } of captured.shaders) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Shader required");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "Actual Three shader failed");
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "Actual Three program failed");
  gl.useProgram(program);
}

function uploadRoomUniforms(material: number) {
  const replay = window.introPortalReplay;
  const captured = window.introMaterials[material];
  if (!replay || !captured) throw new Error("Actual room program required");
  const { gl, program, textures } = replay;
  for (const { name, type, value } of captured.uniforms) {
    const location = gl.getUniformLocation(program, name);
    const values = typeof value === "number" ? [value] : value;
    if (type === gl.FLOAT) gl.uniform1fv(location, values);
    else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, values);
    else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, values);
    else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, values);
    else if (type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(location, false, values);
    else if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, values);
    else if (type === gl.INT || type === gl.BOOL) gl.uniform1iv(location, values);
    else if (type === gl.SAMPLER_CUBE) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Probe environment texture required");
      const unit = textures.length;
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      for (let face = 0; face < 6; face++)
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          0,
          gl.RGBA8,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([255, 255, 255, 255]),
        );
      gl.uniform1i(location, unit);
    } else if (type === gl.SAMPLER_2D || type === gl.SAMPLER_2D_SHADOW) {
      // Only illumination is neutralized; the captured geometry/opacity shader stays unmodified.
      // 仅中和照明纹理，捕获的几何与不透明度着色器保持原样。
      const texture = gl.createTexture();
      if (!texture) throw new Error("Probe illumination texture required");
      const unit = textures.length;
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (type === gl.SAMPLER_2D_SHADOW) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.DEPTH_COMPONENT16,
          1,
          1,
          0,
          gl.DEPTH_COMPONENT,
          gl.UNSIGNED_SHORT,
          new Uint16Array([65535]),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([255, 255, 255, 255]),
        );
      }
      gl.uniform1i(location, unit);
    } else throw new Error(`Unsupported actual room uniform ${name}: ${type}`);
  }
}

function drawRoomPortal(probe: RoomPortalProbe) {
  const replay = window.introPortalReplay;
  if (!replay) throw new Error("Actual room program required");
  const { gl, program, buffer } = replay;
  const identity = new DOMMatrix().toFloat32Array();
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "modelMatrix"), false, identity);
  const view = new DOMMatrix().translate(-probe.roadX, 0, -probe.eyeZ).toFloat32Array();
  for (const name of ["viewMatrix", "modelViewMatrix"])
    gl.uniformMatrix4fv(gl.getUniformLocation(program, name), false, view);
  gl.uniformMatrix3fv(
    gl.getUniformLocation(program, "normalMatrix"),
    false,
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
  );
  const near = 1,
    far = 100000,
    focal = probe.perspective / 256;
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "projectionMatrix"), false, [
    focal,
    0,
    0,
    0,
    0,
    focal,
    0,
    0,
    0,
    0,
    -(far + near) / (far - near),
    -1,
    0,
    0,
    (-2 * far * near) / (far - near),
    0,
  ]);
  gl.uniform3f(gl.getUniformLocation(program, "cameraPosition"), probe.roadX, 0, probe.eyeZ);
  gl.uniform3f(gl.getUniformLocation(program, "uIntroEye"), probe.roadX, 0, probe.eyeZ);
  for (const name of ["uIntroFill", "uIntroArrival"])
    gl.uniform1f(gl.getUniformLocation(program, name), 1);
  gl.uniform1f(gl.getUniformLocation(program, "uIntroGrowth"), probe.growth);
  gl.uniform1f(gl.getUniformLocation(program, "uIntroTravel"), 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(probe.vertices.map((value, index) => (index % 3 === 1 ? -value : value))),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  const along = gl.getAttribLocation(program, "introAlong");
  if (along >= 0) {
    gl.enableVertexAttribArray(along);
    gl.vertexAttribPointer(along, 1, gl.FLOAT, false, 12, 8);
  }
  const normal = gl.getAttribLocation(program, "normal");
  if (normal >= 0) gl.vertexAttrib3f(normal, 0, 0, 1);
  const pixels = new Uint8Array(512 * 512 * 4);
  const phases = probe.levels.map((level, step) => {
    const mask = probe.masks[step];
    if (!mask) throw new Error("Portal mask required");
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(gl.getUniformLocation(program, "uIntroEntry"), level);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0,
      partial = 0,
      outside = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (!pixels[index]) continue;
      if (pixels[index] === 255) covered++;
      else partial++;
      const pixel = (index - 3) / 4,
        x = (pixel % 512) + 0.5;
      const y = 512 - Math.floor(pixel / 512) - 0.5;
      if (x < mask[0] - 1 || x > mask[2] + 1 || y < mask[1] - 1 || y > mask[3] + 1) outside++;
    }
    return { covered, partial, outside };
  });
  if (gl.getError() !== gl.NO_ERROR)
    throw new Error("Actual room shader probe raised a WebGL error");
  return phases;
}

export async function sampleRoomPortal(page: Page, probe: RoomPortalProbe) {
  try {
    await page.evaluate(createRoomReplay, probe);
    await page.evaluate(uploadRoomUniforms, probe.material);
    return await page.evaluate(drawRoomPortal, probe);
  } finally {
    await page.evaluate(() => {
      const replay = window.introPortalReplay;
      if (!replay) return;
      const { gl, program, buffer, shaders, textures } = replay;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      for (const texture of textures) gl.deleteTexture(texture);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      window.introPortalReplay = undefined;
    });
  }
}
