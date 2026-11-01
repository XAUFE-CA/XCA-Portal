import { expect, test } from "@playwright/test";
import { useBriefEntry } from "./entry";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
});

for (const width of [1440, 390]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`shared CSS loads without runtime or hydration errors / ${width} / ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({
        colorScheme,
        reducedMotion: width === 390 ? "reduce" : "no-preference",
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (/hydration/i.test(message.text()) && /^(error|warning)$/.test(message.type()))
          errors.push(message.text());
      });
      const response = await page.goto("/", { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      for (const token of ["--neoverse-space-4", "--neoverse-radius-card"]) {
        await expect
          .poll(() =>
            page.evaluate(
              (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
              token,
            ),
          )
          .toMatch(/\S/);
      }
      expect(errors).toEqual([]);
    });
  }
}
