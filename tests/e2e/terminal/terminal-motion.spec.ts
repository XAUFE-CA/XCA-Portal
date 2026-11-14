import { expect, test } from "@playwright/test";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "../support/timing";

interface GlassFinish {
  filter: string;
  background: string;
}
interface IntroGlassContinuity {
  brand: GlassFinish | null;
  ready: GlassFinish | null;
}

declare global {
  interface Window {
    terminalIntroMaterial?: IntroGlassContinuity;
  }
}

function recordIntroGlassMaterial() {
  const material: IntroGlassContinuity = { brand: null, ready: null };
  window.terminalIntroMaterial = material;
  new MutationObserver(() => {
    const terminal = document.querySelector(".xca-terminal-window");
    const screen = document.querySelector(".xca-terminal-screen");
    if (!terminal || !screen) return;
    const style = getComputedStyle(terminal);
    const finish = { filter: style.backdropFilter, background: style.backgroundColor };
    if (screen.classList.contains("xca-terminal-screen--brand")) material.brand = finish;
    if (
      screen.classList.contains("xca-terminal-screen--ready") &&
      material.brand &&
      !material.ready
    )
      material.ready = finish;
  }).observe(document, { subtree: true, attributes: true, childList: true });
}

test("glass edge and background stay continuous through docking and intro completion", async ({
  page,
}) => {
  await page.addInitScript(recordIntroGlassMaterial);
  await page.addInitScript(() => {
    const drawn: [number, number, number, number][] = [];
    const renderers = new WeakSet<WebGLRenderingContext | WebGL2RenderingContext>();
    Object.assign(window, { terminalDrawnRects: drawn });
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const names = new WeakMap<WebGLUniformLocation, string>();
      const locate = prototype.getUniformLocation;
      prototype.getUniformLocation = function (program, name) {
        const location = locate.call(this, program, name);
        if (location) names.set(location, name);
        if (location && name === "u_rect") renderers.add(this);
        return location;
      };
      const clear = prototype.clear;
      prototype.clear = function (mask) {
        // The CA mark canvas must not clear samples recorded by the glass renderer.
        // CA 标识画布不能清空玻璃渲染器记录的采样。
        if (renderers.has(this)) drawn.length = 0;
        return clear.call(this, mask);
      };
      const uniform = prototype.uniform4f;
      prototype.uniform4f = function (location, x, y, width, height) {
        if (location && names.get(location) === "u_rect") drawn.push([x, y, width, height]);
        return uniform.call(this, location, x, y, width, height);
      };
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--docking")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  await expect(page.locator("html")).toHaveAttribute("data-neoverse-glass-renderer", "webgl");
  const samples = await page.evaluate(async () => {
    const result: { edgeError: number; edgeFound: boolean; top: number; ready: boolean }[] = [];
    const terminal = document.querySelector(".xca-terminal-window");
    if (!terminal) throw new Error("The terminal is required to measure docking motion");
    for (let i = 0; i < 100; i++) {
      await new Promise(requestAnimationFrame);
      const box = terminal.getBoundingClientRect();
      // The init script records every u_rect call as a four-coordinate tuple.
      // 初始化脚本将每次 u_rect 调用记录为四坐标元组。
      const monitoredWindow = window as unknown as {
        terminalDrawnRects: [number, number, number, number][];
      };
      const rectangles = monitoredWindow.terminalDrawnRects;
      const edge = rectangles.find((rect) => Math.abs(rect[2] - box.width) < 200 && rect[3] > 300);
      result.push({
        edgeFound: !!edge,
        edgeError: edge
          ? Math.max(
              Math.abs(edge[0] - box.x),
              Math.abs(edge[1] - box.y),
              Math.abs(edge[2] - box.width),
            )
          : 0,
        top: box.top,
        ready: !document.querySelector(".xca-terminal-hero--intro"),
      });
    }
    return result;
  });
  expect(samples.some((sample) => sample.edgeFound)).toBe(true);
  expect(
    Math.max(...samples.map((sample) => sample.edgeError)),
    "WebGL edge must stay on the animated DOM frame",
  ).toBeLessThan(4);
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT,
  });
  const terminal = page.locator(".xca-terminal-window");
  await expect(terminal).not.toHaveAttribute("data-neoverse-glass-edge-pass");
  await expect(page.locator("html")).toHaveAttribute("data-neoverse-glass-renderer", "webgl");
  expect(await terminal.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur(");
  const material = await page.evaluate(() => window.terminalIntroMaterial);
  if (!material?.brand || !material.ready)
    throw new Error("Intro material boundaries were not recorded");
  expect(material.brand.filter).toContain("blur(");
  expect(material.ready).toEqual(material.brand);
  const ready = samples.findIndex((sample) => sample.ready);
  if (ready > 0) {
    const current = samples[ready];
    const previous = samples[ready - 1];
    if (!current || !previous) throw new Error("Docking transition samples must be consecutive");
    expect(Math.abs(current.top - previous.top)).toBeLessThan(1);
  }
  await expect
    .poll(() =>
      terminal.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity),
    )
    .toBe(true);
  expect(
    await terminal.evaluate(
      (el) => el.getAnimations().filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
});
