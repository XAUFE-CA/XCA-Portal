import { expect, test } from "@playwright/test";
import zh from "../../app/i18n/locales/zh-CN.json" with { type: "json" };
import { emberTint, litPixels, markWhite, TAGLINE_EN, TAGLINE_ZH, useFooterPage } from "./footer";

test.beforeEach(async ({ page }) => {
  await useFooterPage(page);
});

test("the about footer carries the copyright, licenses, credits and the build commit", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const footer = page.getByRole("contentinfo");
  await expect(footer).toHaveCount(1);
  await expect(footer).toBeVisible();
  await expect(footer.locator(".site-footer__tagline")).toHaveText(TAGLINE_EN);
  const copyright = footer.locator(".site-footer__copyright");
  await expect(copyright).toContainText(/© 2026( - \d{4})?/);
  await expect(copyright.getByRole("link", { name: "XAUFE-CA" })).toHaveAttribute(
    "href",
    "https://github.com/XAUFE-CA",
  );
  await expect(copyright.getByRole("link", { name: "Shenshijun" })).toHaveAttribute(
    "href",
    "https://shenshijun.space",
  );
  // Code is MIT, articles are CC BY-NC-SA 4.0.
  // 源码为 MIT，文章为 CC BY-NC-SA 4.0。
  const licenses = footer.locator(".site-footer__licenses");
  await expect(licenses).toContainText("本站源码采用");
  await expect(licenses).toContainText("文章采用");
  await expect(licenses.getByRole("link", { name: "MIT" })).toHaveAttribute(
    "href",
    "https://github.com/XAUFE-CA/XCA-Portal/blob/main/LICENSE",
  );
  await expect(licenses.getByRole("link", { name: "CC BY-NC-SA 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  );
  const lockup = footer.getByRole("img", { name: "XCA 与 Neoverse-UI 联合标识" });
  await expect(lockup.locator("img")).toHaveCount(2);
  // A Git-less build hides the row instead of inventing a commit.
  // 没有 Git 的构建隐藏该行，不伪造提交信息。
  const build = footer.locator(".site-footer__build");
  await expect(build).toContainText("本项目代码");
  await expect(build.getByRole("link", { name: "已开源" })).toHaveAttribute(
    "href",
    "https://github.com/XAUFE-CA/XCA-Portal",
  );
  const commit = footer.locator("a[href*='/commit/']");
  await expect(commit).toHaveCount(1);
  await expect(commit).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/XAUFE-CA\/XCA-Portal\/commit\/[0-9a-f]{40}$/,
  );
  await expect(commit).toHaveText(/^\([0-9a-f]{7,}( @ \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})?\)$/);
  // Organization, author, two licenses, repository, shared UI and commit.
  // 组织、作者、两项许可、项目仓库、共享库与提交。
  await expect(footer.locator("a")).toHaveCount(7);
  for (const link of await footer.locator("a[target='_blank']").all()) {
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
});

test("the shared-UI credit links only the library name above the build row", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const footer = page.getByRole("contentinfo");
  const credit = footer.locator(".site-footer__shared-ui");
  const build = footer.locator(".site-footer__build");
  await expect(credit).toBeVisible();
  await expect(build).toBeVisible();
  // The lead and tail phrases stay outside the anchor, so it reads as the library name alone.
  // 前后说明都留在链接之外，锚点只承载库名。
  await expect(credit).toContainText(zh["footer.sharedUiLead"]);
  await expect(credit).toContainText(zh["footer.sharedUiTail"]);
  await expect(credit.getByRole("link", { name: "Neoverse-UI", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/SSJ-ZYJ/Neoverse-UI",
  );
  const creditBox = await credit.boundingBox();
  const buildBox = await build.boundingBox();
  expect(buildBox?.y ?? 0).toBeGreaterThanOrEqual((creditBox?.y ?? 0) + (creditBox?.height ?? 0));
});

test("the tagline flame paints embers above the quote without taking input", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const tagline = page.locator(".site-footer__tagline");
  const flame = tagline.locator(".xca-tagline-flame__canvas");
  await expect(flame).toHaveCount(1);
  // The overlay is decorative and must never steal selection or clicks.
  // 叠加层仅作装饰，不得抢走选择或点击。
  await expect(flame).toHaveAttribute("aria-hidden", "true");
  await expect(flame).toHaveCSS("pointer-events", "none");
  await expect(flame).toHaveCSS("position", "absolute");
  await expect.poll(() => litPixels(flame)).toBeGreaterThan(0);
  // The embers stay yellow — red leads green leads blue — instead of reading as dark smoke.
  // 余烬保持黄色（红 > 绿 > 蓝），而不是被看成黑烟。
  const tint = await emberTint(flame);
  expect(tint.red).toBeGreaterThan(tint.green);
  expect(tint.green).toBeGreaterThan(tint.blue);
  // A bright yellow, not a muddy brown: the ember keeps a high red and a low blue.
  // 亮黄而非浊棕：余烬保持高红、低蓝。
  expect(tint.red).toBeGreaterThan(200);
  expect(tint.blue).toBeLessThan(120);
  // The embers are pixels only: the quote stays one plain text run for readers and search.
  // 余烬只是像素：引文对阅读器与检索仍是一段纯文本。
  await expect(tagline).toHaveText(TAGLINE_EN);
});

test("the tagline opens in English and its own click hands it to Chinese", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const tagline = page.locator(".site-footer__tagline");
  const quote = tagline.locator(".xca-tagline-flame__quote");
  // The site starts in Chinese, yet the quotation still opens in English.
  // 站点默认为中文，引语仍先以英文出现。
  await expect(quote).toHaveText(TAGLINE_EN);
  await expect(quote).toHaveAttribute("lang", "en");
  await tagline.getByRole("button").click();
  // The copy defocuses and thins away, then the arriving copy comes back from the same blur.
  // 旧文案失焦散开，抵达文案从同一层模糊中回焦。
  await expect(quote).toHaveClass(/tagline-voice-/);
  await expect(quote).toHaveText(TAGLINE_ZH);
  await expect(quote).toHaveAttribute("lang", "zh-CN");
  await tagline.getByRole("button").click();
  await expect(quote).toHaveText(TAGLINE_EN);
});

test("the tagline frame keeps its height while the copy changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // The narrow layout gives both copies different line heights, so any row jump would show.
  // 窄屏让两份文案的行高差异明显，任何行高跳动都会显现。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  const measurement = await page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>(".site-footer__tagline");
    const button = host?.querySelector("button");
    const ghost = host?.querySelector<HTMLElement>("[data-tagline-ghost]");
    if (!host || !button || !ghost) throw new Error("The tagline must expose its sizing copy");
    const samples: number[] = [host.getBoundingClientRect().height];
    const observer = new ResizeObserver(() => samples.push(host.getBoundingClientRect().height));
    observer.observe(host);
    button.click();
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 900);
    await promise;
    observer.disconnect();
    return { samples, ghostVisibility: getComputedStyle(ghost).visibility };
  });
  await expect(page.locator(".site-footer__tagline")).toHaveText(TAGLINE_ZH);
  // The frame never follows the line count, so the footer below stays put.
  // 框体从不跟随行数变化，页脚下方因此保持原位。
  expect(Math.max(...measurement.samples) - Math.min(...measurement.samples)).toBeLessThan(1);
  expect(measurement.ghostVisibility).toBe("hidden");
});

test("the flame resumes with the theme palette after a theme switch", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const flame = page.locator(".site-footer__tagline .xca-tagline-flame__canvas");
  await expect.poll(() => litPixels(flame)).toBeGreaterThan(0);
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The theme capture freezes the flame; painting must return once the snapshot settles.
  // 主题截取会冻结火焰；快照落定后必须恢复绘制。
  await expect.poll(() => litPixels(flame), { timeout: 20_000 }).toBeGreaterThan(0);
  // The dark palette keeps the same amber order instead of turning into grey smoke.
  // 深色配色保持同样的琥珀色序，而不是变成灰烟。
  const darkTint = await emberTint(flame);
  expect(darkTint.red).toBeGreaterThan(darkTint.green);
  expect(darkTint.green).toBeGreaterThan(darkTint.blue);
});

test("dark mode renders both footer marks in the same neutral white", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const ca = await markWhite(page, ".site-footer__mark");
  const neoverse = await markWhite(page, ".site-footer__wordmark");
  // Both marks must land on the same pure white, with no warm cast.
  // 两张标识必须落在同一个纯白上，不带暖调。
  expect(ca).toEqual([255, 255, 255]);
  expect(neoverse).toEqual(ca);
});

test("reduced motion keeps the tagline as plain text and swaps it without a blur", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  const tagline = page.locator(".site-footer__tagline");
  await expect(tagline.locator(".xca-tagline-flame__canvas")).toHaveCount(0);
  await expect(tagline).toHaveText(TAGLINE_EN);
  await tagline.getByRole("button").click();
  await expect(tagline).toHaveText(TAGLINE_ZH);
});

test("language switching swaps footer copy without changing the build link", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const footer = page.getByRole("contentinfo");
  const tagline = footer.locator(".site-footer__tagline");
  const commit = footer.locator("a[href*='/commit/']");
  const href = await commit.getAttribute("href");
  // The quote opens in English under the Chinese site and keeps its own language afterwards.
  // 引语在中文站点下先显示英文，之后保持自己的语言。
  await expect(tagline).toHaveText(TAGLINE_EN);
  await tagline.getByRole("button").click();
  await expect(tagline).toHaveText(TAGLINE_ZH);
  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(tagline).toHaveText(TAGLINE_ZH);
  await expect(footer.getByRole("link", { name: "Neoverse-UI", exact: true })).toBeVisible();
  await expect(footer.locator(".site-footer__shared-ui")).toContainText("Proudly powered by");
  await expect(footer.locator(".site-footer__licenses")).toContainText("Code is under the");
  await expect(footer.locator(".site-footer__build-status")).toHaveText("open source");
  await expect(
    footer.locator(".site-footer__copyright").getByRole("link", { name: "Shenshijun" }),
  ).toBeVisible();
  await expect(commit).toHaveAttribute("href", href ?? "");
});

test("the quotation stays centred against the credits in both tagline languages", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const footer = page.getByRole("contentinfo");
  const identity = footer.locator(".site-footer__identity");
  const tagline = footer.locator(".site-footer__tagline");
  const quote = tagline.locator(".xca-tagline-flame__quote");
  const centres = async () => {
    const [left, right] = await Promise.all([identity.boundingBox(), quote.boundingBox()]);
    return {
      left: (left?.y ?? 0) + (left?.height ?? 0) / 2,
      right: (right?.y ?? 0) + (right?.height ?? 0) / 2,
    };
  };
  // The two columns share one vertical centre on desktop, whatever the copy's line count.
  // 桌面下两列共用同一条竖直中线，与文案行数无关。
  const english = await centres();
  expect(Math.abs(english.left - english.right)).toBeLessThan(1.5);
  await tagline.getByRole("button").click();
  await expect(tagline).toHaveText(TAGLINE_ZH);
  const chinese = await centres();
  expect(Math.abs(chinese.left - chinese.right)).toBeLessThan(1.5);
});

test("the home footer stays below the fold on desktop and mobile", async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const footer = page.getByRole("contentinfo");
    await expect(footer).toHaveCount(1);
    const top = await footer.evaluate((node) => node.getBoundingClientRect().top);
    expect(top, `footer above the fold at ${width}px`).toBeGreaterThanOrEqual(height - 1);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect(footer).toBeInViewport();
    await expect.poll(() => footer.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  }
});
