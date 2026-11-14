import { expect, test } from "@playwright/test";
import { SCENE_TIMEOUT } from "../support/timing";

declare global {
  interface Window {
    outlineSamples: number[];
    outlineFinished: boolean;
  }
}

test("CA outline advances without jumping while a cold renderer initializes @cinematic", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const samples: number[] = [];
    Object.assign(window, { outlineSamples: samples, outlineFinished: false });
    let delayed = false;
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
      if (!delayed && args[0] === "webgl2" && this.classList.contains("xca-ca-intro__mesh")) {
        delayed = true;
        // Model a cold driver on a slower device without relying on the runner's GPU speed.
        // 模拟较慢设备的冷启动驱动，不依赖运行器的 GPU 速度。
        const until = performance.now() + 320;
        while (performance.now() < until) {
          // Keep the simulated driver call synchronous.
          // 保持模拟驱动调用的同步行为。
        }
      }
      return Reflect.apply(context, this, args);
    } as typeof context;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (
        !(this instanceof SVGPathElement) ||
        samples.length ||
        !Array.isArray(frames) ||
        !frames.some((frame) => "strokeDashoffset" in frame)
      )
        return animation;
      samples.push(1);
      const sample = () => {
        const offset = Number.parseFloat(getComputedStyle(this).strokeDashoffset);
        samples.push(offset);
        if (offset <= 0.001) Object.assign(window, { outlineFinished: true });
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return animation;
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.outlineFinished, undefined, { timeout: SCENE_TIMEOUT });
  const samples = await page.evaluate(() => window.outlineSamples);
  const maximumJump = samples.reduce(
    (maximum, value, index) => Math.max(maximum, Math.abs(value - (samples[index - 1] ?? value))),
    0,
  );
  expect(maximumJump).toBeLessThan(0.2);
  expect(samples.some((value) => value > 0.3 && value < 0.7)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
});
