import { expect, type Page, test } from "@playwright/test";

// These tests pin content and image loading states plus the geometry around them.
// 这些用例固定正文与图片的加载状态及其周围几何。

const contentQuery = "**/__nuxt_content/**";
const bannerImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2172" height="724"><rect width="2172" height="724" fill="gray"/></svg>';

test.beforeEach(async ({ page }) => {
  await page.route("**/xca-banner-*.webp", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: bannerImage }),
  );
});

async function delayContentQuery(page: Page, milliseconds: number) {
  await page.route(contentQuery, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    await route.fulfill({ response: await route.fetch() });
  });
}

test("navigating to the about page shows a card-shaped skeleton before the content", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "关于学社", exact: true })).toBeVisible();
  await delayContentQuery(page, 900);

  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  const card = page.locator(".about-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect(card.locator(".about-card__skeleton-column")).toHaveCount(2);
  await expect(card.locator(".about-card__banner-skeleton")).toBeVisible();
  await expect(card.getByRole("img")).toHaveCount(0);

  const pendingBox = await card.boundingBox();
  if (!pendingBox) throw new Error("Pending card bounding box is missing");

  await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
  await expect(card.locator(".about-card__skeleton-column")).toHaveCount(0);

  const settledBox = await card.boundingBox();
  if (!settledBox) throw new Error("Settled card bounding box is missing");
  // The skeleton mirrors the block layout, so the swap must not reflow the page.
  // 骨架沿用区块布局，替换内容时不应让页面重排。
  expect(Math.abs(settledBox.height - pendingBox.height)).toBeLessThanOrEqual(240);
});

test("the banner keeps its own skeleton until the selected image loads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const { promise: imageGate, resolve: releaseImage } = Promise.withResolvers<void>();
  await page.route("**/xca-banner-light.webp", async (route) => {
    await imageGate;
    await route.fulfill({ contentType: "image/svg+xml", body: bannerImage });
  });

  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const card = page.locator(".about-card");
  const banner = card.locator(".about-card__banner");
  const skeleton = banner.locator(".about-card__banner-skeleton--light");
  try {
    await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
    await expect(card).toHaveAttribute("aria-busy", "false");
    await expect(skeleton).toBeVisible();
    await expect(banner.locator(".about-card__banner-skeleton--dark")).toBeHidden();
    await expect(banner.locator(".about-card__banner-light")).toBeVisible();
  } finally {
    releaseImage();
  }

  await expect(skeleton).toHaveCount(0);
  await expect
    .poll(() =>
      banner
        .locator(".about-card__banner-light")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
});

test("switching the about locale lands on the new language content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();

  await delayContentQuery(page, 900);
  await page.getByRole("radio", { name: "English", exact: true }).click();
  const card = page.locator(".about-card");
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect(card.locator(".about-card__skeleton-column")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1, name: "About us" })).toBeVisible();
  await expect(card).toHaveAttribute("aria-busy", "false");
  await expect(card.locator(".about-card__skeleton-column")).toHaveCount(0);
  await expect(card.locator(".about-card__layer")).toHaveCSS("opacity", "1");
});

test("loaded content crossfades with the skeleton in the same card area", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
  const query = Promise.withResolvers<void>();
  await page.route(contentQuery, async (route) => {
    await query.promise;
    await route.fulfill({ response: await route.fetch() });
  });
  const card = page.locator(".about-card");
  try {
    await page.getByRole("radio", { name: "English", exact: true }).click();
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(card.locator(".about-card__layer:has(h1)")).toHaveCount(0);
  } finally {
    query.resolve();
  }
  await expect
    .poll(
      () =>
        card.evaluate((element) => {
          const content = element.querySelector(".about-card__layer:has(h1)");
          const skeleton = element.querySelector(".about-card__content--skeleton")?.parentElement;
          if (!content || !skeleton) return false;
          const incoming = Number(getComputedStyle(content).opacity);
          const outgoing = Number(getComputedStyle(skeleton).opacity);
          const contentBox = content.getBoundingClientRect();
          const skeletonBox = skeleton.getBoundingClientRect();
          return (
            incoming > 0 &&
            incoming < 1 &&
            outgoing > 0 &&
            outgoing < 1 &&
            contentBox.y === skeletonBox.y &&
            contentBox.width === skeletonBox.width
          );
        }),
      { intervals: [16] },
    )
    .toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "About us" })).toBeVisible();
  await expect(card.locator(".about-card__content--skeleton")).toHaveCount(0);
  await expect(card.locator(".about-card__layer")).toHaveCSS("opacity", "1");
});

test("a loaded banner fades its skeleton away", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  const image = Promise.withResolvers<void>();
  await page.route("**/xca-banner-light.webp", async (route) => {
    await image.promise;
    await route.fulfill({ contentType: "image/svg+xml", body: bannerImage });
  });
  const skeleton = page.locator(".about-card__banner-skeleton--light");
  try {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    await expect(skeleton).toBeVisible();
  } finally {
    image.resolve();
  }
  await expect
    .poll(
      () =>
        skeleton.evaluateAll((elements) => {
          const opacity = elements[0] ? Number(getComputedStyle(elements[0]).opacity) : 0;
          return opacity > 0 && opacity < 1;
        }),
      { intervals: [16] },
    )
    .toBe(true);
  await expect(skeleton).toHaveCount(0);
});

test("banner loading settles independently when the theme changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const light = Promise.withResolvers<void>();
  const dark = Promise.withResolvers<void>();
  await page.route("**/xca-banner-*.webp", async (route) => {
    await (route.request().url().includes("-dark.webp") ? dark.promise : light.promise);
    await route.fulfill({ contentType: "image/svg+xml", body: bannerImage });
  });
  try {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const banner = page.locator(".about-card__banner");
    const lightSkeleton = banner.locator(".about-card__banner-skeleton--light");
    const darkSkeleton = banner.locator(".about-card__banner-skeleton--dark");
    await expect(lightSkeleton).toBeVisible();
    await page.getByRole("radio", { name: "深色", exact: true }).click();
    await expect(darkSkeleton).toBeVisible();
    await expect(lightSkeleton).toBeHidden();
    light.resolve();
    await expect(lightSkeleton).toHaveCount(0);
    await expect(darkSkeleton).toBeVisible();
    dark.resolve();
    await expect(darkSkeleton).toHaveCount(0);
  } finally {
    light.resolve();
    dark.resolve();
  }
});

test("a failed banner removes its loading skeleton", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.route("**/xca-banner-light.webp", (route) => route.abort());
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
  await expect(page.locator(".about-card__banner-skeleton--light")).toHaveCount(0);
});

test("a failed content query replaces the skeleton with an error page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.route(contentQuery, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ statusCode: 503, statusMessage: "Content unavailable" }),
    }),
  );
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await expect(page.locator(".about-card")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("503");
});
