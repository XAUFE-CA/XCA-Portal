import { expect, type Page, test } from "@playwright/test";

/**
 * Exercise the fallback independently of browsers with native page captures.
 * 独立覆盖不支持原生页面快照的浏览器回退路径。
 */
async function disableViewTransitions(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(document, "startViewTransition", {
      value: undefined,
      configurable: true,
    }),
  );
}

function samplePreferenceResize(page: Page, label: "English" | "中文") {
  return page.evaluate(async (nextLabel) => {
    const shell = document.querySelectorAll<HTMLElement>(
      ".site-preference-group > [data-surface]",
    )[1];
    const option = [
      ...document.querySelectorAll<HTMLButtonElement>(".site-controls [role=radio]"),
    ].find((button) => button.textContent?.trim() === nextLabel);
    if (!shell || !option) throw new Error("Preference shell and language option are required");
    const width = () => Number.parseFloat(getComputedStyle(shell).width);
    const before = width();
    option.click();
    const deadline = performance.now() + 5000;
    let animation: Animation | undefined;
    do {
      await new Promise(requestAnimationFrame);
      animation = shell
        .getAnimations()
        .find(
          (candidate) =>
            candidate.effect instanceof KeyframeEffect &&
            candidate.effect.getKeyframes().some((frame) => typeof frame.width === "string"),
        );
      if (animation || option.getAttribute("aria-checked") === "true") break;
    } while (performance.now() < deadline);
    if (!animation || !(animation.effect instanceof KeyframeEffect)) {
      return { before, start: null, middle: null, after: width(), settled: true };
    }
    const duration = animation.effect.getComputedTiming().duration;
    if (typeof duration !== "number") throw new Error("Resize animation needs a finite duration");
    animation.pause();
    animation.currentTime = 0;
    const start = width();
    animation.currentTime = duration / 2;
    const middle = width();
    animation.finish();
    await animation.finished;
    await new Promise(requestAnimationFrame);
    return { before, start, middle, after: width(), settled: shell.getAnimations().length === 0 };
  }, label);
}

function preferenceSurfaces(page: Page) {
  return page.evaluate(() => {
    const navigation = document.querySelector(".site-navigation > [data-surface]");
    if (!navigation) throw new Error("The navigation surface is required");
    const appearance = (element: Element) => {
      const style = getComputedStyle(element);
      return [
        style.backgroundColor,
        style.backgroundImage,
        style.boxShadow,
        style.borderColor,
        style.borderWidth,
        style.borderRadius,
        style.getPropertyValue("--neoverse-material-filter").trim(),
      ].join("|");
    };
    const expected = appearance(navigation);
    const surfaces = document.querySelectorAll(".site-preference-group > [data-surface]");
    const groups = document.querySelectorAll(".site-controls [role=radiogroup]");
    const balanced = [...surfaces].every((surface) => {
      const control = surface.querySelector("[role=radiogroup]");
      if (!control) return false;
      const outer = surface.getBoundingClientRect();
      const inner = control.getBoundingClientRect();
      const insets = [
        inner.left - outer.left,
        outer.right - inner.right,
        inner.top - outer.top,
        outer.bottom - inner.bottom,
      ];
      return Math.max(...insets) - Math.min(...insets) < 1;
    });
    return {
      surfaces: surfaces.length,
      balanced,
      matching: [...surfaces].every(
        (surface) =>
          surface.getAttribute("data-surface") === "glass-subtle" &&
          surface.getAttribute("data-neoverse-glass-edge-pass") === "css" &&
          appearance(surface) === expected,
      ),
      embedded: [...groups].filter((group) => {
        const style = getComputedStyle(group);
        return (
          group.getAttribute("data-surface") === "none" &&
          style.backgroundColor === "rgba(0, 0, 0, 0)" &&
          style.backgroundImage === "none" &&
          style.boxShadow === "none" &&
          style.backdropFilter === "none"
        );
      }).length,
    };
  });
}

for (const width of [1440, 390]) {
  test(`header controls retain shared surfaces, typography and proportions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.goto("/");
    if (width === 390) {
      await page.locator(".site-menu").getByRole("button").click();
    }

    const controls = page.locator(".site-controls");
    const themeOptions = controls.getByRole("radiogroup").last().getByRole("radio");
    const localeOptions = controls.getByRole("radiogroup").first().getByRole("radio");
    for (const locale of [0, 1]) {
      await localeOptions.nth(locale).click();
      for (const theme of [0, 1, 2]) {
        await themeOptions.nth(theme).click();
        await page.mouse.move(0, 0);
        await expect
          .poll(() => preferenceSurfaces(page))
          .toEqual({
            surfaces: 2,
            balanced: true,
            matching: true,
            embedded: 2,
          });
        const geometry = await page.evaluate(() => {
          const navigation = document.querySelector(".site-navigation a");
          if (!navigation) throw new Error("Header navigation is missing");
          const reference = getComputedStyle(navigation);
          const options = [...document.querySelectorAll(".site-controls [role=radio]")];
          return options.map((option) => {
            const style = getComputedStyle(option);
            return {
              fontSize: style.fontSize,
              expectedFontSize: reference.fontSize,
              height: option.getBoundingClientRect().height,
              expectedHeight: navigation.getBoundingClientRect().height,
              fontWeight: style.fontWeight,
              expectedFontWeight: style.getPropertyValue("--neoverse-font-weight-bold").trim(),
            };
          });
        });
        expect(geometry).toHaveLength(5);
        for (const option of geometry) {
          expect(option.fontSize).toBe(option.expectedFontSize);
          expect(option.height).toBe(option.expectedHeight);
          expect(option.fontWeight).toBe(option.expectedFontWeight);
        }
      }
    }
  });
}

for (const width of [1440, 390]) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`preference shells resize smoothly at ${width}px / ${reducedMotion}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion });
      await page.goto("/about");
      if (width === 390) await page.locator(".site-menu").getByRole("button").click();
      await page.evaluate(() => document.fonts.ready);
      for (const label of ["English", "中文"] as const) {
        const result = await samplePreferenceResize(page, label);
        expect(Math.abs(result.after - result.before)).toBeGreaterThan(1);
        expect(result.settled).toBe(true);
        if (reducedMotion === "reduce") {
          expect(result.middle).toBeNull();
        } else {
          if (result.start === null || result.middle === null)
            throw new Error("Language changes must animate the preference shell width");
          expect(result.start).toBeCloseTo(result.before, 0);
          expect(result.middle).toBeGreaterThan(Math.min(result.before, result.after));
          expect(result.middle).toBeLessThan(Math.max(result.before, result.after));
        }
        await expect(page.getByRole("radio", { name: label, exact: true })).toBeChecked();
      }
    });
  }
}

test("rapid language reversals continue from the visible width and resize restores auto sizing", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await disableViewTransitions(page);
  await page.goto("/about");
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const shell = document.querySelectorAll<HTMLElement>(
      ".site-preference-group > [data-surface]",
    )[1];
    if (!shell) throw new Error("The theme shell is required");
    const width = () => Number.parseFloat(getComputedStyle(shell).width);
    const initial = width();
    const switchLanguage = (label: string) => {
      const option = [
        ...document.querySelectorAll<HTMLButtonElement>(".site-controls [role=radio]"),
      ].find((button) => button.textContent?.trim() === label);
      if (!option) throw new Error("The language option is required");
      option.click();
    };
    switchLanguage("English");
    await new Promise(requestAnimationFrame);
    const first = shell.getAnimations()[0];
    if (!first || !(first.effect instanceof KeyframeEffect)) throw new Error("Resize is missing");
    first.pause();
    first.currentTime = Number(first.effect.getComputedTiming().duration) / 2;
    const interrupted = width();
    switchLanguage("中文");
    await new Promise(requestAnimationFrame);
    const second = shell.getAnimations()[0];
    if (!second) throw new Error("The reverse resize is missing");
    second.pause();
    second.currentTime = 0;
    const resumed = width();
    window.dispatchEvent(new Event("resize"));
    return { initial, interrupted, resumed, final: width(), active: shell.getAnimations().length };
  });
  expect(result.resumed).toBeCloseTo(result.interrupted, 0);
  expect(result.final).toBeCloseTo(result.initial, 0);
  expect(result.active).toBe(0);
});

test("mobile navigation stays compact until opened and keeps shared theme controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);

  const header = page.locator(".site-header");
  const toggle = page.locator(".site-menu").getByRole("button");
  const closedBox = await header.boundingBox();
  if (!closedBox) throw new Error("The closed mobile header must have a bounding box");
  const closedHeight = closedBox.height;
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".site-navigation")).toBeHidden();
  await expect(page.locator(".site-controls")).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".site-navigation")).toBeVisible();
  await expect(page.locator(".site-controls")).toBeVisible();
  const openBox = await header.boundingBox();
  if (!openBox) throw new Error("The open mobile header must have a bounding box");
  expect(openBox.height).toBe(closedHeight);
  await expect(page.getByRole("dialog", { name: "菜单", exact: true })).toBeVisible();

  await page.getByRole("radio", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".site-navigation")).toBeHidden();
  await expect(page.locator(".site-controls")).toBeHidden();
});

test("the compact menu trigger uses the shared ghost button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });

  const trigger = page.locator(".site-menu").getByRole("button");
  await expect(trigger).toHaveClass(/ui-button--ghost/);
  await expect(trigger).not.toHaveClass(/ui-button--secondary/);
});

test("intermediate widths keep primary links grouped beside the brand and settings in the menu", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1045, height: 850 });
  await page.goto("/");
  const toggle = page.locator(".site-menu").getByRole("button");
  const controls = page.locator(".site-controls");
  const navigation = page.locator(".site-navigation");

  for (const width of [610, 768, 900, 1045, 1120]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(navigation).toBeVisible();
    await expect(controls).toBeHidden();
    const layout = await page.evaluate(() => {
      const brandElement = document.querySelector(".site-header__brand");
      if (!brandElement) throw new Error("The header brand is required to measure navigation");
      const brand = brandElement.getBoundingClientRect();
      const links = [...document.querySelectorAll(".site-navigation a")].map((link) =>
        link.getBoundingClientRect(),
      );
      return {
        aligned: links.every((link) => link.top >= brand.top && link.bottom <= brand.bottom),
        grouped: links.slice(1).every((link, index) => {
          const previous = links[index];
          if (!previous) throw new Error(`Navigation link ${index} is missing`);
          return link.left - previous.right < Math.min(link.width, previous.width);
        }),
      };
    });
    expect(layout).toEqual({ aligned: true, grouped: true });
  }

  await toggle.click();
  await expect(controls).toBeVisible();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(controls).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(navigation).toBeVisible();

  await toggle.click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(controls).toBeHidden();

  await toggle.click();
  await page.locator("#main-content").click({ position: { x: 10, y: 10 } });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(controls).toBeHidden();

  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await page.setViewportSize({ width: 1045, height: 850 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(controls).toBeHidden();
});

test("interacting with the terminal settles the heading while preserving commands", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);

  const input = page.locator("#xca-command-input");
  await input.fill("echo hello");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("hello");

  const heading = page.locator("#xca-terminal-title");
  const title = await heading.getAttribute("aria-label");
  if (title === null) throw new Error("The terminal heading must have an accessible title");
  await page.clock.fastForward(20000);
  await expect(heading).toHaveAttribute("aria-label", title);
  await expect(
    page.locator(".xca-terminal-title__letter:not(.xca-terminal-title__letter--visible)"),
  ).toHaveCount(0);
});

test("laptop-height homepage does not scroll just for bottom padding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Escape");
    await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(overflow, `unexpected page scroll at ${width}px`).toBeLessThanOrEqual(1);
  }
});
