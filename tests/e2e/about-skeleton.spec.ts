import { expect, type Page, test } from "@playwright/test";
import { useBriefEntry } from "./entry";
import { resumeAnimations } from "./timing";

// These tests pin content and image loading states plus the geometry around them.
// 这些用例固定正文与图片的加载状态及其周围几何。

const contentQuery = "**/__nuxt_content/**";
const bannerImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2172" height="724"><rect width="2172" height="724" fill="gray"/></svg>';

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
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

test("switching the about locale lands on the new language content without a skeleton", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
  const card = page.locator(".about-card");
  await expect(card).toHaveAttribute("aria-busy", "false");

  // Both languages arrive with the first query, so a delayed endpoint must not be hit again and
  // the card keeps its content instead of dropping back to the skeleton.
  // 两种语言随首次查询一起返回，被延迟的接口不应再次被请求，卡片保留正文而不退回骨架。
  await delayContentQuery(page, 900);
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About us" })).toBeVisible();
  await expect(card).toHaveAttribute("aria-busy", "false");
  await expect(card.locator(".about-card__skeleton-column")).toHaveCount(0);
  await expect(card.locator(".about-card__layer")).toHaveCSS("opacity", "1");
});

test("the about card swaps the copy in place and resizes when the language needs more room", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/about");
  const card = page.locator(".about-card");
  await expect(card).toHaveAttribute("aria-busy", "false");
  const before = await card.evaluate((element) => element.getBoundingClientRect().height);

  await page.getByRole("radio", { name: "English", exact: true }).click();
  // The copy is replaced outright — one layer, no glyph animation to catch in a faded state — while
  // a height animation carries the box to the size the English text needs.
  // 文案直接替换：只有一个内容层、没有会停在半透明状态的文字动画；盒子同时由高度动画带到英文正文
  // 所需的尺寸。
  await expect(page.getByRole("heading", { level: 1, name: "About us" })).toBeVisible();
  await expect(card.locator(".about-card__layer")).toHaveCount(1);
  const duration = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>(".about-card");
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const running = element?.getAnimations().find((candidate) => {
        const effect = candidate.effect;
        return (
          effect instanceof KeyframeEffect &&
          effect.getKeyframes().some((frame) => typeof frame.height === "string")
        );
      });
      if (running?.effect) return Number(running.effect.getComputedTiming().duration);
      await new Promise(requestAnimationFrame);
    }
    return 0;
  });
  expect(duration).toBeGreaterThan(0);
  await expect
    .poll(() => card.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(before + 1);
});

test("an interrupted language switch keeps resizing from the current edge", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/about");
  const card = page.locator(".about-card");
  await expect(card).toHaveAttribute("aria-busy", "false");
  const before = await card.evaluate((element) => element.getBoundingClientRect().height);

  const heights = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>(".about-card");
    if (!element) throw new Error("The about card is required");
    const option = (label: string) =>
      [...document.querySelectorAll<HTMLElement>(".site-header [role=radio]")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    const samples: number[] = [];
    const loop = () => {
      samples.push(element.getBoundingClientRect().height);
      if (samples.length < 90) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    option("English")?.click();
    // Reverse before the first resize settles: the second animation has to continue from the
    // height the first one reached instead of snapping to either endpoint.
    // 在第一次伸缩结束前反向切换：第二次动画必须从第一次已经到达的高度接续，而不是弹回任一端点。
    await new Promise((resolve) => setTimeout(resolve, 120));
    option("中文")?.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return samples;
  });

  // A snap shows up as one frame covering the whole distance; a continuous resize steps through it.
  // Headless Chromium may render both languages at the same height, so the frame-step check only
  // applies when the card actually resizes; the reverse switch must still restore the card.
  // 跳变表现为一帧走完全程，连续伸缩逐帧推进。无头 Chromium 下两种语言可能等高，
  // 只有卡片确实伸缩时才检查帧步长；反向切换仍须把卡片恢复原状。
  const steps = heights
    .slice(1)
    .map((height, index) => Math.abs(height - (heights[index] ?? height)));
  const travel = Math.max(...heights) - Math.min(...heights);
  if (travel > 0) expect(Math.max(...steps)).toBeLessThan(60);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect
    .poll(() => card.evaluate((element) => element.getBoundingClientRect().height))
    .toBeCloseTo(before, 0);
});

test("loaded content crossfades with the skeleton in the same card area", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  const query = Promise.withResolvers<void>();
  await page.route(contentQuery, async (route) => {
    await query.promise;
    await route.fulfill({ response: await route.fetch() });
  });
  const card = page.locator(".about-card");
  try {
    await page.getByRole("link", { name: "关于学社", exact: true }).click();
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(card.locator(".about-card__layer:has(h1)")).toHaveCount(0);
  } finally {
    query.resolve();
  }
  // Freeze the layer swap at its midpoint; polling frames misses the window on slow renderers.
  // 在交换中点冻结图层；慢速渲染器上逐帧轮询会错过该窗口。
  await expect
    .poll(() =>
      card.evaluate(() => {
        const content = document.querySelector(".about-card__layer:has(h1)");
        const skeleton = document.querySelector(".about-card__content--skeleton")?.parentElement;
        if (!content || !skeleton) return 0;
        const opacityAnimations = (element: Element) =>
          element.getAnimations().filter((animation) => {
            const effect = animation.effect;
            return (
              effect instanceof KeyframeEffect &&
              effect.getKeyframes().some((frame) => "opacity" in frame)
            );
          });
        // Both layers must already be blending: the frame right after the swap only carries
        // the skeleton's exit, whose midpoint would report an untouched incoming layer.
        // 两层都必须已经在混合：交换后的那一帧只有骨架退出，其中点会读到尚未进入的正文。
        const contentAnimations = opacityAnimations(content);
        const skeletonAnimations = opacityAnimations(skeleton);
        if (!contentAnimations.length || !skeletonAnimations.length) return 0;
        const animations = [...contentAnimations, ...skeletonAnimations];
        for (const animation of animations) {
          const timing = animation.effect?.getComputedTiming();
          // Skip the delay too: a delayed transition parked at its start reports opacity 0.
          // 同时跳过延迟：带延迟的过渡停在起点时透明度仍为 0。
          animation.pause();
          animation.currentTime = Number(timing?.delay ?? 0) + Number(timing?.duration ?? 0) / 2;
        }
        return animations.length;
      }),
    )
    .toBeGreaterThan(0);
  const crossfade = await card.evaluate((element) => {
    const content = element.querySelector(".about-card__layer:has(h1)");
    const skeleton = element.querySelector(".about-card__content--skeleton")?.parentElement;
    if (!content || !skeleton) return null;
    const incoming = Number(getComputedStyle(content).opacity);
    const outgoing = Number(getComputedStyle(skeleton).opacity);
    const contentBox = content.getBoundingClientRect();
    const skeletonBox = skeleton.getBoundingClientRect();
    return {
      incoming,
      outgoing,
      sameTop: contentBox.y === skeletonBox.y,
      sameWidth: contentBox.width === skeletonBox.width,
    };
  });
  if (!crossfade) throw new Error("The card must show both layers during the swap");
  expect(crossfade.incoming).toBeGreaterThan(0);
  expect(crossfade.incoming).toBeLessThan(1);
  expect(crossfade.outgoing).toBeGreaterThan(0);
  expect(crossfade.outgoing).toBeLessThan(1);
  expect(crossfade.sameTop).toBe(true);
  expect(crossfade.sameWidth).toBe(true);
  await resumeAnimations(page, ".about-card");
  await expect(page.getByRole("heading", { level: 1, name: "关于我们" })).toBeVisible();
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
  // Freeze the banner fade at its midpoint instead of sampling frames.
  // 在淡出中点冻结骨架，而不是逐帧采样。
  await expect
    .poll(() =>
      skeleton.evaluateAll((elements) => {
        const animations = elements.flatMap((element) => element.getAnimations());
        if (!animations.length) return 0;
        for (const animation of animations) {
          const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
          animation.pause();
          animation.currentTime = duration / 2;
        }
        return animations.length;
      }),
    )
    .toBeGreaterThan(0);
  const fade = await skeleton.evaluateAll((elements) =>
    elements.map((element) => Number(getComputedStyle(element).opacity)),
  );
  for (const opacity of fade) {
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  }
  await resumeAnimations(page, ".about-card");
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
  // The shell keeps navigation so a failed query never traps the visitor on an error page.
  // 站点外壳保留导航，查询失败不会把访客困在错误页上。
  await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
});
