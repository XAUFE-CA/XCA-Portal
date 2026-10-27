import { expect, type Page, test } from "@playwright/test";

async function readTerminalShadeTimeline(page: Page) {
  return page.evaluate(() => {
    const terminal = document.querySelector(".xca-terminal-window");
    const shade = document.querySelector(".xca-terminal-focus-shade");
    if (!terminal || !shade) return null;
    const terminalAnimation = terminal
      .getAnimations()
      .find(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.getKeyframes().some((frame) => "transform" in frame),
      );
    const shadeAnimation = shade
      .getAnimations()
      .find(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.getKeyframes().some((frame) => "opacity" in frame),
      );
    if (!terminalAnimation || !shadeAnimation) return null;
    const terminalTiming = terminalAnimation.effect?.getComputedTiming();
    const shadeTiming = shadeAnimation.effect?.getComputedTiming();
    if (
      !terminalTiming ||
      !shadeTiming ||
      terminalAnimation.startTime === null ||
      shadeAnimation.startTime === null ||
      terminalAnimation.currentTime === null ||
      shadeAnimation.currentTime === null
    ) {
      return null;
    }
    return {
      terminalDuration: Number(terminalTiming.duration),
      shadeDuration: Number(shadeTiming.duration),
      terminalEasing: terminalTiming.easing,
      shadeEasing: shadeTiming.easing,
      terminalStartTime: terminalAnimation.startTime,
      shadeStartTime: shadeAnimation.startTime,
      terminalCurrentTime: Number(terminalAnimation.currentTime),
      shadeCurrentTime: Number(shadeAnimation.currentTime),
      shadeOpacity: Number(getComputedStyle(shade).opacity),
    };
  });
}

async function expectSynchronizedTerminalShade(page: Page) {
  await expect
    .poll(async () => {
      const timeline = await readTerminalShadeTimeline(page);
      return Boolean(timeline && timeline.shadeOpacity > 0 && timeline.shadeOpacity < 1);
    })
    .toBe(true);
  const timeline = await readTerminalShadeTimeline(page);
  if (!timeline) throw new Error("Terminal and shade animations are missing");
  expect(timeline.shadeDuration).toBe(timeline.terminalDuration);
  expect(timeline.shadeEasing).toBe(timeline.terminalEasing);
  expect(timeline.shadeStartTime).toBe(timeline.terminalStartTime);
  expect(Math.abs(timeline.shadeCurrentTime - timeline.terminalCurrentTime)).toBeLessThan(17);
  expect(timeline.shadeOpacity).toBeGreaterThan(0);
  expect(timeline.shadeOpacity).toBeLessThan(1);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`expanded terminal keeps neutral background blur in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("radio", { name: "系统", exact: true }).click();
    const terminal = page.locator(".xca-terminal-window");
    const input = page.locator("#xca-command-input");
    await input.fill("echo draft");
    await page.getByRole("button", { name: "展开终端", exact: true }).click();
    const backdrop = page.locator(".xca-terminal-hero__focus-backdrop");
    await expect(backdrop).toHaveCSS("opacity", "1");
    await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const shade = page.locator(".xca-terminal-focus-shade");
    await expect(shade).toHaveCSS("opacity", "1");
    await expect(shade).toHaveCSS("pointer-events", "none");
    await expect(shade).toHaveCSS(
      "border-radius",
      await terminal.evaluate((el) => getComputedStyle(el).borderRadius),
    );
    await expect(shade).toHaveCSS("z-index", "2");
    expect(
      await shade.evaluate((el) => {
        const shadow = getComputedStyle(el).boxShadow;
        const spread = Number.parseFloat(shadow.split(" ").at(-1) ?? "0");
        return spread >= Math.max(innerWidth, innerHeight);
      }),
    ).toBe(true);
    expect(await backdrop.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur(");
    expect(await terminal.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur(");
    await expect(page.locator("[data-neoverse-glass-renderer-canvas]")).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await terminal.boundingBox();
    if (!box) throw new Error("Expanded terminal bounding box is missing");
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(390);
    const shadeBox = await shade.boundingBox();
    if (!shadeBox) throw new Error("Expanded terminal shade aperture is missing");
    expect(shadeBox.x).toBe(box.x);
    expect(shadeBox.y).toBe(box.y);
    expect(shadeBox.width).toBe(box.width);
    expect(shadeBox.height).toBe(box.height);
    await input.press("Escape");
    await expect(backdrop).toHaveCSS("opacity", "0");
    await expect(shade).toHaveCSS("opacity", "0");
    await expect(input).toHaveValue("echo draft");
    await expect(page.locator(".xca-terminal-window")).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "展开终端", exact: true }).click();
    await page.mouse.click(4, 450);
    await expect(backdrop).toHaveCSS("opacity", "0");
  });
}

test("outside shade follows the terminal expansion and collapse timeline", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Escape");
  await page.locator(".xca-terminal-window").evaluate((element) => {
    element.style.setProperty("--neoverse-motion-duration-expressive", "3s");
  });
  const shade = page.locator(".xca-terminal-focus-shade");

  await page.getByRole("button", { name: "展开终端", exact: true }).click();
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(1);
  await expectSynchronizedTerminalShade(page);
  await expect(shade).toHaveCSS("opacity", "1", { timeout: 10_000 });
  await page.getByRole("button", { name: "还原终端大小", exact: true }).click();
  await expectSynchronizedTerminalShade(page);
  await expect(shade).toHaveCSS("opacity", "0", { timeout: 10_000 });
  await expect(shade).toHaveCSS("visibility", "hidden");
});
