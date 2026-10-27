import { expect, type Page, test } from "@playwright/test";
import localizedHeroSentences from "../../app/data/hero-sentences.json" with { type: "json" };

const heroSentences = localizedHeroSentences["zh-CN"];
const firstSentence = heroSentences[0];
if (firstSentence === undefined) throw new Error("Chinese hero sentences must include a welcome");
const firstSentenceLength = Array.from(firstSentence).length;

async function openHero(page: Page, random = 0) {
  await page.addInitScript((value) => {
    Math.random = () => value;
  }, random);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1);
  await page.keyboard.press("Escape");
}

for (const width of [1440, 390]) {
  test(`title cursor stays beside the final glyph at ${width}px`, async ({ page }) => {
    await page.clock.install();
    await page.setViewportSize({ width, height: 900 });
    await openHero(page);
    await expect(page.locator(".xca-terminal-title__letter--visible")).toHaveCount(
      firstSentenceLength,
    );
    // Font downloads must not advance the title into its deletion phase.
    // 字体下载不得让标题进入其删除阶段。
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(100);

    const metrics = await page.locator(".xca-terminal-title__letter--cursor").evaluate((letter) => {
      const textStyle = getComputedStyle(letter);
      const cursorStyle = getComputedStyle(letter, "::after");
      // A real box with the pseudo-element's computed style exposes its geometry.
      // 用伪元素的计算样式构造真实盒子即可暴露其几何信息。
      const probe = document.createElement("i");
      for (const property of cursorStyle) {
        probe.style.setProperty(property, cursorStyle.getPropertyValue(property));
      }
      probe.style.animation = "none";
      letter.append(probe);
      const textBox = letter.getBoundingClientRect();
      const cursorBox = probe.getBoundingClientRect();
      probe.remove();

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("A 2D canvas context is required to measure hero glyphs");
      context.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
      const text = letter.textContent;
      if (text === null) throw new Error("The cursor letter must contain text");
      const glyph = context.measureText(text);
      // Punctuation nears the baseline; align to the Han glyph's ink, not the advance box.
      // 标点靠近基线，应对齐相邻汉字的墨迹，而非字体的字宽框。
      const han = letter.previousElementSibling;
      if (!han) throw new Error("The cursor letter must follow a Han glyph");
      const baseline = document.createElement("i");
      baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      han.append(baseline);
      const baselineY = baseline.getBoundingClientRect().top;
      baseline.remove();
      const hanText = han.textContent;
      if (hanText === null) throw new Error("The preceding Han glyph must contain text");
      const hanGlyph = context.measureText(hanText);
      const glyphCenter =
        baselineY + (hanGlyph.actualBoundingBoxDescent - hanGlyph.actualBoundingBoxAscent) / 2;
      return {
        fontSize: Number.parseFloat(textStyle.fontSize),
        gap: cursorBox.left - (textBox.left + glyph.actualBoundingBoxRight),
        verticalOffset: cursorBox.top + cursorBox.height / 2 - glyphCenter,
      };
    });

    expect(metrics.gap).toBeGreaterThanOrEqual(0);
    expect(metrics.gap).toBeLessThanOrEqual(metrics.fontSize * 0.2);
    expect(Math.abs(metrics.verticalOffset)).toBeLessThanOrEqual(metrics.fontSize * 0.04);
  });
}

test("title deletes and types again without shifting the heading", async ({ page }) => {
  await openHero(page);
  const visibleLetters = page.locator(".xca-terminal-title__letter--visible");
  await expect(visibleLetters).toHaveCount(firstSentenceLength);
  const heading = page.locator("#xca-terminal-title");
  await expect(heading).toHaveAttribute("aria-label", firstSentence);
  const fullBox = await heading.boundingBox();
  await expect(visibleLetters).toHaveCount(0, { timeout: 8000 });
  expect(await heading.boundingBox()).toEqual(fullBox);
  const nextSentence = heroSentences.find((sentence) => sentence !== firstSentence);
  if (nextSentence === undefined) throw new Error("Hero sentences must include a different title");
  await expect(heading).toHaveAttribute("aria-label", nextSentence);
  await expect(visibleLetters).toHaveCount(Array.from(nextSentence).length);
  expect(await heading.boundingBox()).toEqual(fullBox);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(visibleLetters).toHaveCount(Array.from(nextSentence).length);
  await page.clock.install();
  await page.clock.fastForward(10000);
  await expect(visibleLetters).toHaveCount(Array.from(nextSentence).length);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(visibleLetters).toHaveCount(0);
});

for (const locale of ["zh-CN", "en"] as const) {
  test(`welcome is always first in ${locale}, including after reload`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("A base URL is required to set the locale cookie");
    await context.addCookies([{ name: "xca-locale", value: locale, url: baseURL }]);
    await openHero(page, 0.999);
    const welcome = localizedHeroSentences[locale][0];
    if (welcome === undefined)
      throw new Error(`Hero sentences must include a welcome for ${locale}`);
    const heading = page.locator("#xca-terminal-title");
    await expect(heading).toHaveAttribute("aria-label", welcome);
    await expect(page.locator(".xca-terminal-title__letter--visible")).toHaveCount(
      Array.from(welcome).length,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(heading).toHaveAttribute("aria-label", welcome);
  });
}

test("the complete title stays visible before deletion", async ({ page }) => {
  await page.clock.install();
  await openHero(page);
  const visibleLetters = page.locator(".xca-terminal-title__letter--visible");
  await expect(visibleLetters).toHaveCount(firstSentenceLength);
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.clock.runFor(2500);
  await expect(visibleLetters).toHaveCount(firstSentenceLength);
  await page.clock.runFor(1200);
  expect(await visibleLetters.count()).toBeLessThan(firstSentenceLength);
});

test("terminal interaction finishes a partially typed sentence without revealing it at once", async ({
  page,
}) => {
  await page.clock.install();
  await openHero(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.runFor(420);

  const heading = page.locator("#xca-terminal-title");
  const visible = page.locator(".xca-terminal-title__letter--visible");
  const beforeClick = await visible.count();
  expect(beforeClick).toBeGreaterThan(0);
  expect(beforeClick).toBeLessThan(firstSentenceLength);
  await page.locator(".xca-terminal-screen").click({ position: { x: 30, y: 140 } });
  await expect(visible).toHaveCount(beforeClick);
  await expect(heading).toHaveAttribute("aria-label", firstSentence);

  await page.clock.runFor(315);
  const inProgress = await visible.count();
  expect(inProgress).toBeGreaterThan(beforeClick);
  expect(inProgress).toBeLessThan(firstSentenceLength);
  await page.clock.runFor(5000);
  await expect(visible).toHaveCount(firstSentenceLength);
  await expect(page.locator(".xca-terminal-title__letter--cursor")).toHaveCount(0);
  await page.clock.runFor(10000);
  await expect(visible).toHaveCount(firstSentenceLength);
  await expect(heading).toHaveAttribute("aria-label", firstSentence);
});

test("terminal interaction during deletion finishes the same sentence and removes the caret", async ({
  page,
}) => {
  await page.clock.install();
  await openHero(page);
  await expect(page.locator(".xca-terminal-title__letter--visible")).toHaveCount(
    firstSentenceLength,
  );
  await page.clock.pauseAt(new Date(Date.now() + 100));
  const visible = page.locator(".xca-terminal-title__letter--visible");
  // Catch the first deleted character regardless of the title's length.
  // 无论标题长度如何，都捕获第一个被删除的字符。
  for (
    let elapsed = 0;
    elapsed < 8000 && (await visible.count()) === firstSentenceLength;
    elapsed += 50
  ) {
    await page.clock.runFor(50);
  }
  const beforeClick = await visible.count();
  expect(beforeClick).toBeGreaterThan(0);
  expect(beforeClick).toBeLessThan(firstSentenceLength);

  await page.locator(".xca-terminal-screen").click({ position: { x: 30, y: 140 } });
  await expect(visible).toHaveCount(beforeClick);
  await page.clock.runFor(1000);
  expect(await visible.count()).toBeGreaterThan(beforeClick);
  await page.clock.runFor(5000);
  await expect(visible).toHaveCount(firstSentenceLength);
  await expect(page.locator(".xca-terminal-title__letter--cursor")).toHaveCount(0);
  await expect(page.locator("#xca-terminal-title")).toHaveAttribute("aria-label", firstSentence);
});

test("moving away keeps the heading paused, clicking outside resumes its normal loop", async ({
  page,
}) => {
  await page.clock.install();
  await openHero(page);
  const heading = page.locator("#xca-terminal-title");
  const visible = page.locator(".xca-terminal-title__letter--visible");
  const cursor = page.locator(".xca-terminal-title__letter--cursor");
  const terminal = page.locator(".xca-terminal-screen");

  await terminal.click({ position: { x: 30, y: 140 } });
  await expect(cursor).toHaveCount(0);
  await terminal.click({ position: { x: 35, y: 170 } });
  await page.locator(".xca-terminal-hero__subtitle").hover();
  await page.clock.runFor(12000);
  await expect(visible).toHaveCount(firstSentenceLength);
  await expect(cursor).toHaveCount(0);
  await expect(heading).toHaveAttribute("aria-label", firstSentence);

  await page.locator(".xca-terminal-hero__subtitle").click();
  await expect(visible).toHaveCount(firstSentenceLength);
  await expect(cursor).toHaveCount(1);
  await page.clock.runFor(2500);
  await expect(visible).toHaveCount(firstSentenceLength);
  await page.clock.runFor(1000);
  expect(await visible.count()).toBeLessThan(firstSentenceLength);
  await page.clock.runFor(9000);
  await expect(heading).not.toHaveAttribute("aria-label", firstSentence);
});

test("clicking outside during a partial line keeps typing without revealing characters", async ({
  page,
}) => {
  await page.clock.install();
  await openHero(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.runFor(420);

  const visible = page.locator(".xca-terminal-title__letter--visible");
  await page.locator(".xca-terminal-screen").click({ position: { x: 30, y: 140 } });
  const before = await visible.count();
  expect(before).toBeGreaterThan(0);
  expect(before).toBeLessThan(firstSentenceLength);
  await page.locator(".xca-terminal-hero__subtitle").click();
  await expect(visible).toHaveCount(before);
  await page.clock.runFor(315);
  const after = await visible.count();
  expect(after).toBeGreaterThan(before);
  expect(after).toBeLessThan(firstSentenceLength);
  // Check during the normal post-typing hold, before the resumed delete cycle.
  // 在打字后的正常停留阶段检查，早于重新开始的删除周期。
  await page.clock.runFor(1600);
  await expect(visible).toHaveCount(firstSentenceLength);
});
