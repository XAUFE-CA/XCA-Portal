import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("home uses a plain theme canvas and keeps the terminal interactive", async ({ page }) => {
  for (const [label, theme] of [
    ["深色", "dark"],
    ["浅色", "light"],
  ] as const) {
    await page.getByRole("radio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".site-atmosphere")).toHaveCount(0);
    const canvas = await page.locator(".site-shell").evaluate((shell) => ({
      color: getComputedStyle(shell).backgroundColor,
      image: getComputedStyle(shell).backgroundImage,
      root: getComputedStyle(document.documentElement).backgroundColor,
    }));
    expect(canvas.image).toBe("none");
    expect(canvas.color).toBe(canvas.root);
  }
  const input = page.locator("#xca-command-input");
  await input.fill("echo background-ok");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("background-ok");
});

test("plain home canvas survives narrow viewports and reload without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".site-atmosphere")).toHaveCount(0);
  await expect(page.locator(".site-shell")).toHaveCSS("background-image", "none");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  await expect(page.locator("#xca-command-input")).toBeVisible();
});

test("system theme keeps the plain canvas in both color schemes", async ({ page }) => {
  await page.getByRole("radio", { name: "系统", exact: true }).click();
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.locator(".site-shell")).toHaveCSS("background-image", "none");
    await expect(page.locator(".site-atmosphere")).toHaveCount(0);
  }
});
