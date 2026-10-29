import { expect, type Page, test } from "@playwright/test";

type FadeProbe = { opacity: number | null; layer: boolean; pixels: Uint8Array | null };

async function observeCity(page: Page, theme: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("xca-theme", value);
    const probe: FadeProbe = { opacity: null, layer: false, pixels: null };
    Object.assign(window, { fadeProbe: probe });
    const names = new WeakMap<WebGLUniformLocation, string>();
    const locate = WebGLRenderingContext.prototype.getUniformLocation;
    WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
      const location = locate.call(this, program, name);
      if (location) names.set(location, name);
      if (name === "cityOpacity") probe.layer = true;
      return location;
    };
    const uniform = WebGLRenderingContext.prototype.uniform1f;
    WebGLRenderingContext.prototype.uniform1f = function (location, value) {
      const name = location ? names.get(location) : null;
      if (
        probe.opacity !== null &&
        (name === "cityOpacity" || (name === "skylineVisibility" && !probe.layer))
      )
        value = probe.opacity;
      return uniform.call(this, location, value);
    };
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
      const scene =
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.classList.contains("xca-ca-intro__mesh");
      if (scene && probe.opacity !== null && first > 0 && this.getParameter(this.DEPTH_WRITEMASK))
        return;
      draw.call(this, mode, first, count);
      if (
        !scene ||
        probe.opacity === null ||
        first !== 0 ||
        this.getParameter(this.FRAMEBUFFER_BINDING) !== null
      )
        return;
      const width = Math.floor(this.drawingBufferWidth * 0.3),
        height = Math.floor(this.drawingBufferHeight * 0.6);
      probe.pixels ??= new Uint8Array(width * height * 4);
      this.readPixels(
        0,
        Math.floor(this.drawingBufferHeight * 0.3),
        width,
        height,
        this.RGBA,
        this.UNSIGNED_BYTE,
        probe.pixels,
      );
    };
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`city fade changes continuously at low opacity in ${theme}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 960, height: 640 });
    await observeCity(page, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
      timeout: 15000,
    });
    const result = await page.evaluate(async (theme) => {
      const camera = document
        .getAnimations()
        .find(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target instanceof Element &&
            animation.effect.target.matches(".xca-ca-intro__camera"),
        );
      if (!camera?.effect) throw new Error("Journey camera required");
      for (const animation of document.getAnimations()) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (target instanceof Element && target.closest(".xca-ca-intro, .xca-terminal-window")) {
          animation.pause();
          animation.currentTime = Number(camera.effect.getTiming().duration) * 0.55;
        }
      }
      const probe = (window as unknown as { fadeProbe: FadeProbe }).fadeProbe;
      const background = theme === "light" ? [245, 249, 252] : [6, 11, 19];
      function difference(pixels: Uint8Array, previous: Uint8Array): number {
        let maximum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          for (let channel = 0; channel < 3; channel++) {
            const base = background[channel] ?? 0;
            const now =
              (pixels[index + channel] ?? 0) + base * (1 - (pixels[index + 3] ?? 0) / 255);
            const before =
              (previous[index + channel] ?? 0) + base * (1 - (previous[index + 3] ?? 0) / 255);
            maximum = Math.max(maximum, Math.abs(now - before));
          }
        }
        return maximum;
      }
      let previous: Uint8Array | undefined,
        worst = 0;
      for (let step = 0; step <= 100; step++) {
        probe.opacity = step * 0.001;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const pixels = probe.pixels;
        if (!pixels) throw new Error("City framebuffer sample required");
        if (previous) worst = Math.max(worst, difference(pixels, previous));
        previous = pixels.slice();
      }
      return { worst, layer: probe.layer };
    }, theme);
    expect(result.layer).toBe(true);
    expect(result.worst).toBeLessThanOrEqual(2.1);
  });
}
