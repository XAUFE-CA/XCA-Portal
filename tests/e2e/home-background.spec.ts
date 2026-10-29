import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  for (const theme of ["dark", "light"] as const) {
    test(`neutral home canvas in ${theme} at ${width}px survives reload`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.addInitScript((value) => localStorage.setItem("xca-theme", value), theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const shell = page.locator(".site-shell--home");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("#xca-command-input")).toBeVisible();
      await expect(page.locator(".site-atmosphere")).toHaveCount(0);
      const canvas = await shell.evaluate((element) => {
        const style = getComputedStyle(element);
        const sample = (value: string) => {
          const context = document.createElement("canvas").getContext("2d");
          if (!context) throw new Error("Color sampling requires a 2D context");
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--xca-home-canvas-center)";
        element.append(probe);
        const center = sample(getComputedStyle(probe).backgroundColor);
        probe.remove();
        return {
          image: style.backgroundImage,
          edge: sample(style.backgroundColor),
          center,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(canvas.image.match(/radial-gradient/g)).toHaveLength(1);
      expect(canvas.image.match(/linear-gradient/g)).toHaveLength(1);
      for (const color of [canvas.edge, canvas.center]) {
        const spread = Math.max(...color) - Math.min(...color);
        expect(spread).toBeLessThanOrEqual(theme === "dark" ? 24 : 20);
        if (theme === "dark") {
          expect(spread).toBeGreaterThanOrEqual(12);
          expect(color[2]).toBeGreaterThan(color[1] ?? 0);
          expect(color[1]).toBeGreaterThan(color[0] ?? 0);
        }
      }
      if (theme === "dark") {
        expect(canvas.edge).toEqual([6, 11, 19]);
        for (const [index, channel] of canvas.center.entries()) {
          expect(channel - (canvas.edge[index] ?? 0)).toBeGreaterThanOrEqual(1);
          expect(channel - (canvas.edge[index] ?? 0)).toBeLessThanOrEqual(9);
        }
      } else {
        expect(canvas.edge).toEqual([245, 249, 252]);
        expect((canvas.center[1] ?? 0) - (canvas.center[0] ?? 0)).toBeGreaterThanOrEqual(10);
        expect(canvas.center[1]).toBeGreaterThanOrEqual(canvas.center[2] ?? 0);
        for (const channel of canvas.center) {
          expect(channel).toBeGreaterThanOrEqual(225);
        }
      }
      expect(canvas.overflow).toBeLessThanOrEqual(0);
      const input = page.locator("#xca-command-input");
      await input.fill("echo background-ok");
      await input.press("Enter");
      await expect(page.locator(".xca-terminal-line").last()).toHaveText("background-ok");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("#xca-command-input")).toBeVisible();
      await expect(shell).toHaveCSS("background-image", canvas.image);
    });
  }
}

test("system theme updates the neutral canvas without replacing the terminal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("radio", { name: "系统", exact: true }).click();
  const input = page.locator("#xca-command-input");
  await input.fill("echo draft");
  const original = await input.elementHandle();
  const colors: string[] = [];
  for (const colorScheme of ["dark", "light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.locator(".site-shell--home")).toHaveCSS("color-scheme", colorScheme);
    colors.push(
      await page
        .locator(".site-shell--home")
        .evaluate((shell) => getComputedStyle(shell).backgroundColor),
    );
    await expect(input).toHaveValue("echo draft");
    expect(await input.evaluate((node, previous) => node === previous, original)).toBe(true);
  }
  expect(colors[0]).not.toBe(colors[1]);
  expect(colors[0]).toBe(colors[2]);
});
