import { expect, type Page, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";
import { setThemePreference } from "../support/preferences";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setThemePreference(page, "light");
});

async function skipIntro(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
}

async function pauseRouteCaptures(page: Page) {
  await page.addInitScript(() => {
    const native = document.startViewTransition?.bind(document);
    const captures: { transition: ViewTransition; paused: boolean }[] = [];
    Object.assign(window, { routeCaptures: captures });
    if (!native) throw new Error("View Transitions are required for this regression");
    document.startViewTransition = (update) => {
      const transition = native(update);
      const capture = { transition, paused: false };
      captures.push(capture);
      // Hold the first capture near its end so the reversal happens while the about page owns
      // the screen, which is when a lingering snapshot would flash over the home page.
      // 将首个快照停在接近终点的位置，使用户在“关于学社”占据画面时反向导航；旧快照残留时
      // 会在首页上闪出关于学社内容。
      const progress = captures.length === 1 ? 0.9 : 0.02;
      void transition.ready.then(
        () => {
          for (const animation of document.getAnimations()) {
            const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
            if (!pseudo?.startsWith("::view-transition")) continue;
            animation.pause();
            animation.currentTime =
              Number(animation.effect?.getComputedTiming().duration) * progress;
          }
          capture.paused = true;
        },
        () => undefined,
      );
      return transition;
    };
  });
}

/**
 * A route navigation that interrupts a paused capture must retire it; a capture left running
 * keeps painting its snapshot over the destination until the snapshot's last frame.
 * 中断暂停快照的路由导航必须终结该快照；仍在运行的空快照会持续覆盖目的页，直到最后一帧才消失。
 */
async function expectInterruptedCaptureRetired(page: Page, index: number) {
  const retired = await page.evaluate(async (captureIndex) => {
    // The init script owns this test-only window state; its shape is fixed at creation.
    // 该窗口状态由初始化脚本创建，形状固定。
    const observed = window as unknown as {
      routeCaptures?: { transition: ViewTransition }[];
    };
    const capture = observed.routeCaptures?.[captureIndex];
    if (!capture) throw new Error(`Missing route capture ${captureIndex}`);
    const timeout = Promise.withResolvers<boolean>();
    const timer = window.setTimeout(() => timeout.resolve(false), 500);
    const settled = await Promise.race([
      capture.transition.finished.then(
        () => true,
        () => true,
      ),
      timeout.promise,
    ]);
    window.clearTimeout(timer);
    return settled;
  }, index);
  expect(retired).toBe(true);
}

function routeAnimationCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.getAnimations().filter((animation) => {
        const effect = animation.effect;
        return (
          effect instanceof KeyframeEffect &&
          effect.pseudoElement?.startsWith("::view-transition") === true
        );
      }).length,
  );
}

async function expectNoRouteSnapshot(page: Page) {
  await expect.poll(() => routeAnimationCount(page)).toBe(0);
}

/**
 * Sample every frame for route snapshots while a navigation reverses; a peak above zero means
 * the page just left is still being animated over the destination.
 * 反向导航期间逐帧采样路由快照；峰值大于零说明所离开的页面仍在目的页上播放。
 */
async function startReturnSnapshotSampling(page: Page) {
  await page.evaluate(() => {
    const state = { peak: 0, sampling: true };
    Object.assign(window, { returnSnapshot: state });
    const tick = () => {
      if (!state.sampling) return;
      state.peak = Math.max(
        state.peak,
        document.getAnimations().filter((animation) => {
          const effect = animation.effect;
          return (
            effect instanceof KeyframeEffect &&
            effect.pseudoElement?.startsWith("::view-transition") === true
          );
        }).length,
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopReturnSnapshotSampling(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = Reflect.get(window, "returnSnapshot");
    if (
      typeof state !== "object" ||
      state === null ||
      !("sampling" in state) ||
      typeof state.sampling !== "boolean" ||
      !("peak" in state) ||
      typeof state.peak !== "number"
    ) {
      throw new Error("The return snapshot sampler is missing");
    }
    state.sampling = false;
    return state.peak;
  });
}

async function expectSubsequentRouteCapture(page: Page) {
  const previousCaptures = await page.evaluate(
    () => (window as unknown as { routeCaptures: unknown[] }).routeCaptures.length,
  );
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
      if (pseudo?.startsWith("::view-transition")) animation.finish();
    }
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
  // The quick-reversal window must expire before recovery is expected to capture again.
  // 快速反向窗口须先过期，之后恢复截取才符合预期。
  await page.waitForTimeout(1100);
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { routeCaptures: unknown[] }).routeCaptures.length),
    )
    .toBeGreaterThan(previousCaptures);
}

for (const mode of [
  { name: "light", preference: "light", scheme: "light" },
  { name: "dark", preference: "dark", scheme: "dark" },
  { name: "system dark", preference: "system", scheme: "dark" },
] as const) {
  test(`reversing a route transition does not restore the about page in ${mode.name}`, async ({
    page,
  }) => {
    await setThemePreference(page, mode.preference);
    await page.emulateMedia({ colorScheme: mode.scheme });
    await page.route("**/xca-banner-*.webp", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="2172" height="724"><rect width="2172" height="724" fill="#777"/></svg>',
      }),
    );
    await pauseRouteCaptures(page);

    await page.goto("/");
    await skipIntro(page);
    await page.getByRole("link", { name: "关于学社", exact: true }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as { routeCaptures: { paused: boolean }[] }).routeCaptures[0]?.paused,
    );
    await expect(page.locator(".about-card")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".about-card__content--skeleton")).toHaveCount(0);
    await expect(page.locator(`.about-card__banner-${mode.scheme}`)).toHaveJSProperty(
      "complete",
      true,
    );

    await page.getByRole("link", { name: "首页", exact: true }).click();
    await page.waitForFunction(
      () => location.pathname === "/" && !!document.querySelector(".xca-terminal-hero"),
    );
    // The interrupted capture must stop before the destination can paint its own transition.
    // 被中断的快照必须在目的页绘制自己的过渡前停止。
    await expectInterruptedCaptureRetired(page, 0);
    // No route snapshot may keep painting the old page over the destination.
    // 目的页上不得再有继续绘制旧页的路由快照。
    await expectNoRouteSnapshot(page);
    await expect(page.locator(".xca-terminal-hero")).toBeVisible();
    await expect(page.locator(".about-card")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");

    await expectSubsequentRouteCapture(page);
  });
}

test("a quick return after the forward transition settles commits without a snapshot", async ({
  page,
}) => {
  await page.goto("/");
  await skipIntro(page);
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await expect(page.locator(".about-card")).toHaveAttribute("aria-busy", "false");
  // Finish the forward capture by animation time; waiting out its wall clock on a software
  // renderer exhausts the product's quick-reversal window before the return can be clicked.
  // 按动画时间结束进入快照；软件渲染器按墙钟等完时，产品的快速返回窗口已经过期。
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
      if (pseudo?.startsWith("::view-transition")) animation.finish();
    }
  });
  await expect.poll(() => routeAnimationCount(page)).toBe(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");

  await startReturnSnapshotSampling(page);
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  // A quick return must not animate a snapshot of the page it leaves behind.
  // 快速返回不得播放所离开页面的快照。
  await page.waitForTimeout(600);
  expect(await stopReturnSnapshotSampling(page)).toBe(0);
  await expect(page.locator(".about-card")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
});

test("a pending about query cannot restore the page after returning home", async ({ page }) => {
  const started = Promise.withResolvers<void>();
  const query = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  await page.route("**/__nuxt_content/**", async (route) => {
    started.resolve();
    await query.promise;
    await route.fulfill({ response: await route.fetch() });
    completed.resolve();
  });

  try {
    await page.goto("/");
    await skipIntro(page);
    await page.getByRole("link", { name: "关于学社", exact: true }).click();
    await started.promise;
    await expect(page.locator(".about-card")).toHaveAttribute("aria-busy", "true");
    await page.getByRole("link", { name: "首页", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    query.resolve();
  }
  await completed.promise;
  await expect(page.locator(".xca-terminal-hero")).toBeVisible();
  await expect(page.locator(".about-card")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
});

test("a canceled capture releases its marker before a delayed update finishes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const native = document.startViewTransition.bind(document);
    const gate = Promise.withResolvers<void>();
    const state = { waiting: false, skipped: false, release: gate.resolve };
    Object.assign(window, { routeGate: state });
    let first = true;
    document.startViewTransition = (update) => {
      if (!first || typeof update !== "function") return native(update);
      first = false;
      const transition = native(async () => {
        state.waiting = true;
        await gate.promise;
        return update();
      });
      void transition.ready.catch(() => {
        state.skipped = true;
      });
      return transition;
    };
  });
  await page.goto("/");
  await skipIntro(page);
  await page.evaluate(() =>
    document.querySelector<HTMLAnchorElement>('.site-navigation a[href="/about"]')?.click(),
  );
  await page.waitForFunction(
    () => (window as unknown as { routeGate: { waiting: boolean } }).routeGate.waiting,
  );
  await page.evaluate(() =>
    document.querySelector<HTMLAnchorElement>('.site-navigation a[href="/"]')?.click(),
  );
  await page.waitForFunction(
    () => (window as unknown as { routeGate: { skipped: boolean } }).routeGate.skipped,
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
  await page.evaluate(() =>
    (window as unknown as { routeGate: { release: () => void } }).routeGate.release(),
  );
  await expect(page.locator(".xca-terminal-hero")).toBeVisible();
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await expect(page.locator(".about-card")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
});

test("narrow-screen navigation respects reduced motion and preserves the terminal draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const native = document.startViewTransition?.bind(document);
    const captures: ViewTransition[] = [];
    Object.assign(window, { reducedMotionCaptures: captures });
    if (!native) return;
    document.startViewTransition = (update) => {
      const transition = native(update);
      captures.push(transition);
      return transition;
    };
  });
  await page.goto("/");
  const input = page.locator("#xca-command-input");
  await input.fill("echo draft");
  const menu = page.getByRole("button", { name: "菜单", exact: true });
  await menu.click();
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await expect(page.getByRole("heading", { name: "关于我们", level: 1 })).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await menu.click();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(input).toHaveValue("echo draft");
  await expect(page.locator(".about-card")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await input.focus();
  await expect(input).toBeFocused();
  const captures = await page.evaluate(
    () => (window as unknown as { reducedMotionCaptures: unknown[] }).reducedMotionCaptures.length,
  );
  expect(captures).toBe(0);
});
