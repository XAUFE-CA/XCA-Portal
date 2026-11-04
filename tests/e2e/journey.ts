import { expect, type Page } from "@playwright/test";
import {
  AUDITORIUM,
  AUDITORIUM_MATERIAL,
} from "../../app/features/terminal/presentation/intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY } from "../../app/features/terminal/presentation/intro-geometry";
import { advanceUntil } from "./timing";

type ProbeRect = readonly [left: number, top: number, right: number, bottom: number];
export interface RoomPortalProbe {
  eyeZ: number;
  roadX: number;
  perspective: number;
  material: number;
  vertices: number[];
  portalEye: readonly [number, number, number];
  levels: number[];
  masks: ProbeRect[];
  expected: number[];
  tolerance: number[];
}
interface PortalProbe extends RoomPortalProbe {
  vertex: string;
  fragment: string;
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
  const portalEye = [0, -(floorY - height / 2) / width, (eyeZ - front) / width] as const;
  return {
    eyeZ,
    roadX,
    perspective,
    material,
    vertices,
    portalEye,
    levels,
    masks,
    expected,
    tolerance,
  };
}

export function sampleRoomPortal(probe: PortalProbe) {
  const {
    vertex,
    fragment,
    eyeZ,
    roadX,
    perspective,
    material,
    vertices,
    portalEye,
    levels,
    masks,
  } = probe;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const gl = canvas.getContext("webgl", { antialias: false });
  if (!gl) throw new Error("WebGL required");
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!program || !buffer) throw new Error("GPU resources required");
  const shaders = (
    [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const
  ).map(([kind, source]) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error("Shader required");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed");
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "Link failed");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttrib1f(gl.getAttribLocation(program, "material"), material);
  gl.vertexAttrib3f(gl.getAttribLocation(program, "normal"), 0, 0, 1);
  gl.uniform2f(gl.getUniformLocation(program, "viewport"), canvas.width, canvas.height);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(program, "camera"),
    false,
    new DOMMatrix().translate(-roadX, 0, perspective - eyeZ).toFloat32Array(),
  );
  gl.uniform1f(gl.getUniformLocation(program, "fill"), 1);
  gl.uniform1f(gl.getUniformLocation(program, "reach"), 1);
  gl.uniform3f(gl.getUniformLocation(program, "portalEye"), ...portalEye);
  const growth = gl.getUniformLocation(program, "entryGrowth");
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  const phases: { covered: number; partial: number; outside: number }[] = [];
  for (const [step, level] of levels.entries()) {
    const mask = masks[step];
    if (!mask) throw new Error("Portal mask required");
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(growth, level);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0,
      partial = 0,
      outside = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (!pixels[index]) continue;
      if (pixels[index] === 255) covered++;
      else partial++;
      const pixel = (index - 3) / 4;
      const x = (pixel % 512) + 0.5,
        y = 512 - Math.floor(pixel / 512) - 0.5;
      if (x < mask[0] - 1 || x > mask[2] + 1 || y < mask[1] - 1 || y > mask[3] + 1) outside++;
    }
    phases.push({ covered, partial, outside });
  }
  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  return phases;
}
