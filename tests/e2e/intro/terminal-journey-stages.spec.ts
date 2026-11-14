import { expect, test } from "@playwright/test";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "../support/timing";

for (const stage of ["draw", "approach", "cruise", "retreat", "brand"]) {
  test(`Escape cleans up the ${stage} stage without replacing the host @cinematic`, async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const terminal = page.locator(".xca-terminal-window");
    await terminal.evaluate((node) => {
      node.setAttribute("data-original-host", "yes");
    });
    if (stage === "brand")
      await expect(page.locator(`.xca-terminal-screen--${stage}`)).toHaveCount(1, {
        timeout: SCENE_TIMEOUT,
      });
    else
      await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", stage, {
        timeout: SCENE_TIMEOUT,
      });
    await page.keyboard.press("Escape");
    await expect(page.locator(".xca-ca-intro, .xca-terminal-hero__intro-backdrop")).toHaveCount(0);
    await expect(page.locator("#xca-command-input")).toBeEnabled();
    await expect(terminal).toHaveAttribute("data-original-host", "yes");
    expect(
      await page.evaluate(() =>
        document.getAnimations().some((animation) => {
          const target =
            animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          return target instanceof Element && !!target.closest(".xca-ca-intro");
        }),
      ),
    ).toBe(false);
  });
}

test("motion preference change and rotation settle a readable terminal @cinematic", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
    timeout: SCENE_TIMEOUT,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  // A reload reuses the documented short entry, which never mounts the long scene.
  // 重载复用文档约定的短入场，它不会挂载长场景。
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0, { timeout: SETTLE_TIMEOUT });
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const stage of ["approach", "cruise"]) {
  test(`visibility pause preserves the ${stage} timeline and resumes it @cinematic`, async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", stage, {
      timeout: SCENE_TIMEOUT,
    });
    // A pause is proven by "nothing in the scene still runs"; counting paused animations
    // races the cue boundaries on a slow renderer.
    // 暂停的判据是"场景内不再有运行中的动画"；统计已暂停数量会与慢速渲染器上的提示边界赛跑。
    const before = await page.evaluate(async () => {
      const inScene = (animation: Animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return target instanceof Element && !!target.closest(".xca-ca-intro, .xca-terminal-window");
      };
      // Only timeline animations belong to the presentation; CSS animations run independently.
      // 只有时间线动画由展示层管理；CSS 动画独立运行。
      const owned = (animation: Animation) =>
        inScene(animation) && animation.constructor.name === "Animation";
      const scene = () => document.getAnimations().filter(owned);
      const runningBefore = scene().filter((animation) => animation.playState === "running").length;
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      const stillRunning = scene().filter((animation) => animation.playState === "running").length;
      const paused = scene().filter((animation) => animation.playState === "paused");
      await Promise.all(paused.map((animation) => animation.ready));
      return {
        runningBefore,
        stillRunning,
        times: scene()
          .filter((animation) => animation.playState === "paused")
          .map((animation) => animation.currentTime),
        lines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
      };
    });
    expect(before.runningBefore).toBeGreaterThan(0);
    expect(before.stillRunning).toBe(0);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => {
      const inScene = (animation: Animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return target instanceof Element && !!target.closest(".xca-ca-intro, .xca-terminal-window");
      };
      return {
        times: document
          .getAnimations()
          .filter((animation) => animation.playState === "paused")
          .filter((animation) => animation.constructor.name === "Animation")
          .map((animation) => animation.currentTime),
        lines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
      };
    });
    expect(after).toEqual({ times: before.times, lines: before.lines });
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".xca-terminal-screen--ready")).toHaveCount(1, {
      timeout: SCENE_TIMEOUT,
    });
  });
}
