import { expect, type Page, test } from "@playwright/test";
import { useBriefEntry } from "./entry";
import { setThemePreference } from "./preferences";

/**
 * Record every View Transition the document starts, including the shared timing that
 * the portal applies to it.
 * 记录文档发起的每次视图过渡，以及门户为它套用的共享节奏。
 */
function recordViewTransitions(page: Page) {
  return page.addInitScript(() => {
    const native = document.startViewTransition?.bind(document);
    const observations: {
      duration: string;
      shared: boolean;
      groupAnimations: number;
      animationDuration: number;
      headerLive: boolean;
    }[] = [];
    Object.assign(window, { transitions: observations });
    if (!native) return;
    document.startViewTransition = (update) => {
      const transition = native(update);
      const record = {
        duration: "",
        shared: false,
        groupAnimations: 0,
        animationDuration: 0,
        headerLive: false,
      };
      observations.push(record);
      void transition.ready.then(
        () => {
          const root = document.documentElement;
          record.duration = getComputedStyle(root, "::view-transition-new(root)").animationDuration;
          record.shared = root.hasAttribute("data-neoverse-view-transitioning");
          const header = document.querySelector(".site-header-wrap");
          const content = document.querySelector(".site-main");
          record.headerLive =
            !!header &&
            !!content &&
            getComputedStyle(root).viewTransitionName === "none" &&
            getComputedStyle(header).viewTransitionName === "none" &&
            getComputedStyle(content).viewTransitionName === "root" &&
            getComputedStyle(root, "::view-transition").clipPath !== "none";
          // The root group carries the crossfade; its animation proves the page blends.
          // 根分组承载交叉淡化，该动画证明页面确实在混合。
          const groups = document.getAnimations().filter((animation) => {
            const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
            return typeof pseudo === "string" && pseudo.startsWith("::view-transition");
          });
          record.groupAnimations = groups.length;
          record.animationDuration = Math.max(
            0,
            ...groups.map((animation) =>
              Number(animation.effect?.getComputedTiming().duration ?? 0),
            ),
          );
        },
        () => undefined,
      );
      return transition;
    };
  });
}

async function latestTransition(page: Page) {
  return page.evaluate(() => {
    const observed = window as unknown as {
      transitions: {
        duration: string;
        shared: boolean;
        groupAnimations: number;
        animationDuration: number;
        headerLive: boolean;
      }[];
    };
    const latest = observed.transitions.at(-1);
    if (!latest) throw new Error("The page did not start a View Transition");
    return latest;
  });
}

async function skipIntro(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setThemePreference(page, "light");
});

test("switching the language crossfades the page through the shared motion timing", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/");
  await skipIntro(page);

  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const transition = await latestTransition(page);
  expect(parseFloat(transition.duration)).toBeGreaterThan(0);
  expect(transition.shared).toBe(true);
  expect(transition.groupAnimations).toBeGreaterThan(0);
  expect(transition.animationDuration).toBeGreaterThan(0);
  expect(transition.headerLive).toBe(true);
});

test("navigating between the pages crossfades instead of swapping the content", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.waitForTimeout(500);

  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  const transition = await latestTransition(page);
  expect(parseFloat(transition.duration)).toBeGreaterThan(0);
  expect(transition.shared).toBe(true);
  expect(transition.groupAnimations).toBeGreaterThan(0);
  expect(transition.animationDuration).toBeGreaterThan(0);
  expect(transition.headerLive).toBe(true);
});

test("reduced motion switches the language without a View Transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.waitForTimeout(500);

  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const started = await page.evaluate(
    () => (window as unknown as { transitions: unknown[] }).transitions.length,
  );
  expect(started).toBe(0);
});

for (const choice of [
  {
    name: "language",
    selector: ".site-preference-group:first-child .ui-segmented-control__slider",
    label: "English",
  },
  { name: "theme", selector: ".site-theme-control .ui-segmented-control__slider", label: "深色" },
  {
    name: "navigation",
    selector: ".site-navigation .ui-control-surface__indicator",
    label: "首页",
  },
] as const) {
  test(`${choice.name} selection moves continuously while the page transition is active`, async ({
    page,
  }) => {
    await recordViewTransitions(page);
    await page.goto("/about");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(choice.selector)).toHaveAttribute("data-ready", "true");
    let previousLabel: string | undefined;
    for (const label of choice.name === "navigation" ? ["首页", "关于学社"] : [choice.label]) {
      if (previousLabel !== undefined && choice.name === "navigation") {
        // Rapid reversals commit without a snapshot; let the reversal window expire first.
        // 快速反向导航直接提交、不截取快照；先让反向窗口过期。
        await page.waitForTimeout(1100);
      }
      previousLabel = label;
      const result = await sampleSelectionMotion(page, { selector: choice.selector, label });
      expect(result.end).not.toBeCloseTo(result.start, 0);
      expect(result.middle).toBeGreaterThan(Math.min(result.start, result.end));
      expect(result.middle).toBeLessThan(Math.max(result.start, result.end));
      await expect.poll(async () => (await latestTransition(page)).headerLive).toBe(true);
      await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
    }
  });
}

test("language changes move the whole navigation shell without overshooting or rebounding", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const observed = window as unknown as { headerWidths: Animation[] };
    observed.headerWidths = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (
        this.closest(".site-header") &&
        Array.isArray(keyframes) &&
        keyframes.some((frame) => "width" in frame)
      ) {
        animation.pause();
        animation.currentTime = 0;
        observed.headerWidths.push(animation);
      }
      return animation;
    };
  });
  const shell = page.locator(".site-navigation > [data-surface]");
  for (const label of ["English", "中文"]) {
    const before = await shell.boundingBox();
    if (!before) throw new Error("The navigation shell is required");
    await page.getByRole("radio", { name: label, exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const observed = window as unknown as { headerWidths: Animation[] };
          return observed.headerWidths.length;
        }),
      )
      .toBeGreaterThan(0);
    const samples = await page.evaluate(async () => {
      const observed = window as unknown as { headerWidths: Animation[] };
      const element = document.querySelector(".site-navigation > [data-surface]");
      if (!element) throw new Error("The navigation shell is required");
      const positions = [0, 0.1, 0.25, 0.5, 0.75, 1].map((progress) => {
        for (const animation of observed.headerWidths) {
          animation.currentTime = Number(animation.effect?.getComputedTiming().duration) * progress;
        }
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      });
      const finished = observed.headerWidths.map((animation) => animation.finished);
      for (const animation of observed.headerWidths) animation.finish();
      await Promise.all(finished);
      observed.headerWidths = [];
      const rect = element.getBoundingClientRect();
      return { positions, after: { x: rect.x, width: rect.width } };
    });
    const first = samples.positions[0];
    const last = samples.positions.at(-1);
    if (!first || !last) throw new Error("The complete geometry trajectory is required");
    expect(first.x).toBeCloseTo(before.x, 0);
    expect(first.width).toBeCloseTo(before.width, 0);
    expect(last.x).toBeCloseTo(samples.after.x, 0);
    expect(last.width).toBeCloseTo(samples.after.width, 0);
    expect(Math.abs(last.x - first.x)).toBeGreaterThan(1);
    const direction = Math.sign(last.x - first.x);
    for (let index = 1; index < samples.positions.length; index += 1) {
      const previous = samples.positions[index - 1];
      const current = samples.positions[index];
      if (!previous || !current) throw new Error("Consecutive positions are required");
      expect((current.x - previous.x) * direction).toBeGreaterThanOrEqual(-0.1);
      expect(current.x).toBeGreaterThanOrEqual(Math.min(first.x, last.x) - 0.1);
      expect(current.x).toBeLessThanOrEqual(Math.max(first.x, last.x) + 0.1);
    }
    await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
  }
});

async function sampleSelectionMotion(page: Page, choice: { selector: string; label: string }) {
  return page.evaluate(async ({ selector, label }) => {
    const indicator = document.querySelector<HTMLElement>(selector);
    const option = [
      ...document.querySelectorAll<HTMLElement>(".site-header a, .site-header [role=radio]"),
    ].find((element) => element.textContent?.trim() === label);
    if (!indicator || !option) throw new Error("The selection indicator and option are required");
    const position = () =>
      Number.parseFloat(getComputedStyle(indicator).left) ||
      new DOMMatrixReadOnly(getComputedStyle(indicator).transform).m41;
    const before = position();
    option.click();
    const deadline = performance.now() + 5000;
    let motion: Animation[] = [];
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      motion = indicator.getAnimations();
      if (motion.length > 0) break;
    }
    if (motion.length === 0) throw new Error("Selection must travel instead of swapping endpoints");
    for (const animation of motion) animation.pause();
    const sample = (progress: number) => {
      for (const animation of motion) {
        animation.currentTime = Number(animation.effect?.getComputedTiming().duration) * progress;
      }
      return position();
    };
    const start = sample(0);
    const middle = sample(0.5);
    const end = sample(1);
    for (const animation of motion) animation.finish();
    await Promise.all(motion.map((animation) => animation.finished));
    if (Math.abs(start - before) > 1)
      throw new Error("Selection must start at its visible position");
    return { start, middle, end };
  }, choice);
}

test("the sticky header stays above the docked terminal card on short viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/");
  await skipIntro(page);

  const result = await page.evaluate(async () => {
    const scroller = document.scrollingElement;
    if (!scroller) throw new Error("The document scroller is required");
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector<HTMLElement>(".site-header");
    const card = document.querySelector<HTMLElement>(".xca-terminal-window");
    if (!header || !card) throw new Error("The header and the terminal card are required");
    const headerRect = header.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const x = Math.round(Math.max(headerRect.left + 30, cardRect.left + 40));
    const y = Math.round(headerRect.top + headerRect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      overlapped: cardRect.top < headerRect.bottom,
      headerOnTop: !!hit?.closest(".site-header"),
      cardOnTop: !!hit?.closest(".xca-terminal-window"),
    };
  });

  expect(result.overlapped).toBe(true);
  expect(result.headerOnTop).toBe(true);
  expect(result.cardOnTop).toBe(false);
});
