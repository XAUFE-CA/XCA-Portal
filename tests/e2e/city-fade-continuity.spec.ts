import { expect, type Page, test } from "@playwright/test";
import { freezeApproach } from "./journey";
import { setThemePreference } from "./preferences";
import { SCENE_TIMEOUT } from "./timing";

type FadeProbe = {
  opacity: number | null;
  version: number;
  sampled: number;
  layer: boolean;
  pixels: Uint8Array | null;
};

declare global {
  interface Window {
    fadeProbe: FadeProbe;
  }
}

async function observeCity(page: Page, theme: "light" | "dark") {
  await setThemePreference(page, theme);
  await page.addInitScript(() => {
    const probe: FadeProbe = { opacity: null, version: 0, sampled: -1, layer: false, pixels: null };
    Object.assign(window, { fadeProbe: probe });
    const prototype = WebGL2RenderingContext.prototype;
    const composites = new WeakMap<WebGLProgram, WebGLUniformLocation | null>();
    const inspect = (gl: WebGL2RenderingContext) => {
      if (
        !(gl.canvas instanceof HTMLCanvasElement) ||
        !gl.canvas.classList.contains("xca-ca-intro__mesh")
      )
        return null;
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program) return null;
      if (!composites.has(program)) {
        const texture = gl.getUniformLocation(program, "cityTexture");
        composites.set(program, texture ? gl.getUniformLocation(program, "cityOpacity") : null);
      }
      const opacity = composites.get(program);
      if (!opacity) return null;
      probe.layer = true;
      // Three caches unchanged uniforms, so override the real consumer immediately before drawing.
      // Three 会缓存未变的 uniform，因此在实际消费者绘制前直接覆盖。
      if (probe.opacity !== null) gl.uniform1f(opacity, probe.opacity);
      const sampling =
        probe.opacity !== null && gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === null;
      if (sampling) {
        // Isolate the city composite from the separately rendered opaque world sky.
        // 隔离城市合成与独立绘制的不透明世界天空。
        const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.clearColor(clear[0] ?? 0, clear[1] ?? 0, clear[2] ?? 0, clear[3] ?? 0);
      }
      return sampling;
    };
    const sample = (gl: WebGL2RenderingContext) => {
      const width = Math.floor(gl.drawingBufferWidth * 0.3);
      const height = Math.floor(gl.drawingBufferHeight * 0.6);
      probe.pixels ??= new Uint8Array(width * height * 4);
      gl.readPixels(
        0,
        Math.floor(gl.drawingBufferHeight * 0.3),
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        probe.pixels,
      );
      probe.sampled = probe.version;
    };
    const arrays = prototype.drawArrays,
      elements = prototype.drawElements;
    prototype.drawArrays = function (mode, first, count) {
      const composite = inspect(this);
      arrays.call(this, mode, first, count);
      if (composite) sample(this);
    };
    prototype.drawElements = function (mode, count, type, offset) {
      const composite = inspect(this);
      elements.call(this, mode, count, type, offset);
      if (composite) sample(this);
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`city fade changes continuously at low opacity in ${theme}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 960, height: 640 });
    await observeCity(page, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
      timeout: SCENE_TIMEOUT,
    });
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-render-engine", "three");
    await freezeApproach(page, 0.55);
    const result = await page.evaluate(async () => {
      const probe = window.fadeProbe;
      async function sample(opacity: number) {
        probe.opacity = opacity;
        probe.version++;
        while (probe.sampled !== probe.version) {
          const { promise, resolve } = Promise.withResolvers<void>();
          requestAnimationFrame(() => resolve());
          await promise;
        }
        if (!probe.pixels) throw new Error("Actual city composite pixels required");
        return probe.pixels.slice();
      }
      function difference(pixels: Uint8Array, previous: Uint8Array): number {
        let maximum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          for (let channel = 0; channel < 3; channel++) {
            for (const background of [0, 255]) {
              const now =
                (pixels[index + channel] ?? 0) + background * (1 - (pixels[index + 3] ?? 0) / 255);
              const before =
                (previous[index + channel] ?? 0) +
                background * (1 - (previous[index + 3] ?? 0) / 255);
              maximum = Math.max(maximum, Math.abs(now - before));
            }
          }
        }
        return maximum;
      }
      const hidden = await sample(0),
        visible = await sample(1);
      let previous = hidden,
        worst = 0,
        reverse = 0;
      for (let step = 1; step <= 100; step++) {
        const pixels = await sample(step * 0.001);
        worst = Math.max(worst, difference(pixels, previous));
        for (let index = 3; index < pixels.length; index += 4)
          reverse = Math.max(reverse, (previous[index] ?? 0) - (pixels[index] ?? 0));
        previous = pixels;
      }
      const changed = difference(previous, hidden);
      let covered = 0,
        residual = 0;
      for (let index = 3; index < visible.length; index += 4) {
        if (visible[index]) covered++;
        residual = Math.max(residual, hidden[index] ?? 0);
      }
      return { worst, reverse, changed, covered, residual, layer: probe.layer };
    });
    expect(result.layer).toBe(true);
    expect(result.covered).toBeGreaterThan(100);
    expect(result.residual).toBe(0);
    expect(result.changed).toBeGreaterThan(2);
    expect(result.reverse).toBe(0);
    expect(result.worst).toBeLessThanOrEqual(2.1);
  });
}
