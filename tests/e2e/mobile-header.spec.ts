import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`header controls retain shared typography and proportions at ${width}px`, async ({
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
