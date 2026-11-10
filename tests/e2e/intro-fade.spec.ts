import { expect, type Page, test } from "@playwright/test";
import { AUDITORIUM_MATERIAL } from "../../app/features/intro/core/intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY } from "../../app/features/intro/core/intro-geometry";
import {
  approachPositions,
  captureRoomMaterials,
  freezeApproach,
  roomPortalProbe,
  sampleRoomPortal,
} from "./journey";
import { setThemePreference } from "./preferences";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "./timing";

type RoadProbe = { opacity: number; version: number; sampled: number; pixel: number[] };

declare global {
  interface Window {
    cityResources: { textures: number; framebuffers: number };
    roadProbe: RoadProbe;
  }
}

test("skipping the journey releases its material textures and city framebuffer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const textures = new Set<WebGLTexture>(),
      framebuffers = new Set<WebGLFramebuffer>();
    const live = { textures: 0, framebuffers: 0 };
    const contexts = new WeakSet<WebGL2RenderingContext>();
    Object.assign(window, { cityResources: live });
    const scene = (gl: WebGL2RenderingContext) =>
      gl.canvas instanceof HTMLCanvasElement && gl.canvas.classList.contains("xca-ca-intro__mesh");
    const prototype = WebGL2RenderingContext.prototype;
    const createTexture = prototype.createTexture,
      deleteTexture = prototype.deleteTexture;
    prototype.createTexture = function () {
      const texture = createTexture.call(this);
      if (texture && scene(this)) {
        textures.add(texture);
        live.textures = textures.size;
        if (!contexts.has(this)) {
          contexts.add(this);
          // Context loss releases resources even after the canvas leaves the document.
          // 即使画布已离开文档，上下文丢失也会释放资源。
          this.canvas.addEventListener("webglcontextlost", () => {
            textures.clear();
            framebuffers.clear();
            live.textures = live.framebuffers = 0;
          });
        }
      }
      return texture;
    };
    prototype.deleteTexture = function (texture) {
      if (texture) textures.delete(texture);
      live.textures = textures.size;
      return deleteTexture.call(this, texture);
    };
    const createFramebuffer = prototype.createFramebuffer,
      deleteFramebuffer = prototype.deleteFramebuffer;
    prototype.createFramebuffer = function () {
      const framebuffer = createFramebuffer.call(this);
      if (framebuffer && scene(this)) {
        framebuffers.add(framebuffer);
        live.framebuffers = framebuffers.size;
      }
      return framebuffer;
    };
    prototype.deleteFramebuffer = function (framebuffer) {
      if (framebuffer) framebuffers.delete(framebuffer);
      live.framebuffers = framebuffers.size;
      return deleteFramebuffer.call(this, framebuffer);
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-render-engine", "three");
  const resources = () => page.evaluate(() => ({ ...window.cityResources }));
  await expect
    .poll(async () => (await resources()).framebuffers, { timeout: SETTLE_TIMEOUT })
    .toBeGreaterThan(0);
  expect((await resources()).textures).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect.poll(resources).toEqual({ textures: 0, framebuffers: 0 });
});

async function observeRoad(page: Page) {
  await page.addInitScript(() => {
    const probe: RoadProbe = { opacity: 0, version: 0, sampled: -1, pixel: [] };
    Object.assign(window, { roadProbe: probe });
    const prototype = WebGL2RenderingContext.prototype;
    const composites = new WeakMap<WebGLProgram, WebGLUniformLocation | null>();
    const before = (gl: WebGL2RenderingContext) => {
      if (
        !(gl.canvas instanceof HTMLCanvasElement) ||
        !gl.canvas.classList.contains("xca-ca-intro__mesh")
      )
        return false;
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program) return false;
      if (!composites.has(program))
        composites.set(
          program,
          gl.getUniformLocation(program, "cityTexture")
            ? gl.getUniformLocation(program, "cityOpacity")
            : null,
        );
      const opacity = composites.get(program);
      if (opacity) gl.uniform1f(opacity, probe.opacity);
      return gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === null;
    };
    const after = (gl: WebGL2RenderingContext) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(gl.drawingBufferWidth / 2),
        Math.floor(gl.drawingBufferHeight * 0.15),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      probe.pixel = [...pixel];
      probe.sampled = probe.version;
    };
    const arrays = prototype.drawArrays,
      elements = prototype.drawElements;
    prototype.drawArrays = function (mode, first, count) {
      const visible = before(this);
      arrays.call(this, mode, first, count);
      if (visible) after(this);
    };
    prototype.drawElements = function (mode, count, type, offset) {
      const visible = before(this);
      elements.call(this, mode, count, type, offset);
      if (visible) after(this);
    };
  });
}

async function roadPixel(page: Page, opacity: number) {
  return page.evaluate(async (value) => {
    const probe = window.roadProbe;
    probe.opacity = value;
    probe.version++;
    while (probe.sampled !== probe.version) {
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => resolve());
      await promise;
    }
    return probe.pixel;
  }, opacity);
}

for (const theme of ["light", "dark"] as const) {
  test(`the road occludes the city and stays opaque through the auditorium entrance in ${theme}`, async ({
    page,
  }) => {
    await setThemePreference(page, theme);
    await observeRoad(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const scene = page.locator(".xca-ca-intro");
    await expect(scene).toHaveAttribute("data-journey", "approach", { timeout: SCENE_TIMEOUT });
    await expect(scene).toHaveAttribute("data-render-engine", "three");
    const depths = [
      ARRIVAL_ENTRY.assemblyStart,
      ARRIVAL_ENTRY.assemblyEnd,
      ARRIVAL_ENTRY.front + 500,
      ARRIVAL_ENTRY.front + JOURNEY.near * 2,
      ARRIVAL_ENTRY.front - JOURNEY.near * 2,
      ARRIVAL_ENTRY.back - 500,
    ];
    const positions = [0.55, ...(await approachPositions(page, depths))];
    for (const position of positions) {
      await freezeApproach(page, position);
      const hidden = await roadPixel(page, 0),
        visible = await roadPixel(page, 1);
      expect(hidden[3]).toBeGreaterThanOrEqual(235);
      expect(visible[3]).toBeGreaterThanOrEqual(235);
      for (let channel = 0; channel < 4; channel++)
        expect(Math.abs((hidden[channel] ?? 0) - (visible[channel] ?? 0))).toBeLessThanOrEqual(2);
    }
    await page.keyboard.press("Escape");
    await expect(scene).toHaveCount(0);
    await expect(page.locator("#xca-command-input")).toBeEnabled();
    await expect(page.locator(".xca-terminal-window")).toHaveCount(1);
  });

  test(`intro background visually matches the initial home canvas in ${theme}`, async ({
    page,
  }) => {
    await setThemePreference(page, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const backdrop = page.locator(".xca-terminal-hero__intro-backdrop");
    await expect(backdrop).toHaveCount(1);
    await backdrop.evaluate((element) => {
      const shell = element.closest(".site-shell--home");
      if (!shell) throw new Error("Home canvas required");
      for (const child of shell.querySelectorAll("*"))
        if (child instanceof HTMLElement || child instanceof SVGElement)
          child.style.visibility = "hidden";
      element.style.visibility = "visible";
    });
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Visible viewport required");
    const clip = { x: 0, y: 0, ...viewport };
    const intro = await page.screenshot({ clip });
    await backdrop.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    const home = await page.screenshot({ clip });
    const difference = await page.evaluate(
      async (images) => {
        const pixels = await Promise.all(
          images.map(async (bytes) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: "image/png" }),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Screenshot decoder required");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          }),
        );
        const [before, after] = pixels;
        if (!before || !after) throw new Error("Both rendered backgrounds required");
        return before.reduce(
          (maximum, value, index) => Math.max(maximum, Math.abs(value - (after[index] ?? 0))),
          0,
        );
      },
      [[...intro], [...home]],
    );
    expect(difference).toBeLessThanOrEqual(1);
  });
}

async function prepareRoomProbe(page: Page) {
  await captureRoomMaterials(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
    timeout: SCENE_TIMEOUT,
  });
  const [position] = await approachPositions(page, [ARRIVAL_ENTRY.front + 500]);
  if (position === undefined) throw new Error("Entrance camera position required");
  await freezeApproach(page, position);
  await page.waitForFunction(
    () => window.introMaterials[9] && window.introMaterials[15],
    undefined,
    { timeout: SETTLE_TIMEOUT },
  );
}

test("the portal reveals opaque room surfaces only inside its growing aperture", async ({
  page,
}) => {
  await prepareRoomProbe(page);
  const probe = roomPortalProbe(
    ARRIVAL_ENTRY.assemblyStart,
    Array.from({ length: 21 }, (_, step) => step / 20),
  );
  const phases = await sampleRoomPortal(page, probe);
  expect(phases[0]?.covered).toBe(0);
  let previous = 0;
  for (const [index, phase] of phases.entries()) {
    expect(phase.partial).toBe(0);
    expect(phase.outside).toBe(0);
    expect(Math.abs(phase.covered - (probe.expected[index] ?? 0))).toBeLessThanOrEqual(
      probe.tolerance[index] ?? 0,
    );
    expect(phase.covered).toBeGreaterThanOrEqual(previous);
    expect(phase.covered - previous).toBeLessThan((probe.expected.at(-1) ?? 0) / 4);
    previous = phase.covered;
  }
  expect(previous).toBeGreaterThan(100);
});

test("the portal crossing leaves the complete room independent of aperture progress", async ({
  page,
}) => {
  await prepareRoomProbe(page);
  for (const eyeZ of [
    ARRIVAL_ENTRY.front + JOURNEY.near * 2,
    ARRIVAL_ENTRY.front - JOURNEY.near * 2,
  ]) {
    const probe = roomPortalProbe(eyeZ, eyeZ > ARRIVAL_ENTRY.front ? [1] : [0, 0.5, 1]);
    const phases = await sampleRoomPortal(page, probe);
    for (const [index, phase] of phases.entries()) {
      expect(phase.partial).toBe(0);
      expect(phase.outside).toBe(0);
      expect(phase.covered).toBeGreaterThan(100);
      expect(Math.abs(phase.covered - (probe.expected[index] ?? 0))).toBeLessThanOrEqual(
        probe.tolerance[index] ?? 0,
      );
    }
  }
});

test("destination geometry in front of the portal cannot form an exterior shell", async ({
  page,
}) => {
  await prepareRoomProbe(page);
  const probe = roomPortalProbe(
    ARRIVAL_ENTRY.assemblyStart,
    [1],
    AUDITORIUM_MATERIAL.gateway,
    ARRIVAL_ENTRY.front + 48,
  );
  const phases = await sampleRoomPortal(page, probe);
  expect(phases).toEqual([{ covered: 0, partial: 0, outside: 0 }]);
  const interior = await sampleRoomPortal(
    page,
    roomPortalProbe(ARRIVAL_ENTRY.assemblyStart, [1], AUDITORIUM_MATERIAL.gateway),
  );
  expect(interior[0]?.covered).toBeGreaterThan(100);
  expect(interior[0]?.partial).toBe(0);
  expect(interior[0]?.outside).toBe(0);
});

test("road growth clips only the connection, never the auditorium floor or stage", async ({
  page,
}) => {
  await prepareRoomProbe(page);
  const probe = roomPortalProbe(
    ARRIVAL_ENTRY.front - JOURNEY.near * 2,
    [1],
    AUDITORIUM_MATERIAL.ground,
  );
  probe.growth = 0;
  const floor = await sampleRoomPortal(page, probe);
  expect(floor[0]?.covered).toBeGreaterThan(100);
  expect(floor[0]?.partial).toBe(0);
  const connection = await sampleRoomPortal(page, {
    ...probe,
    material: AUDITORIUM_MATERIAL.connection,
  });
  expect(connection).toEqual([{ covered: 0, partial: 0, outside: 0 }]);
});
