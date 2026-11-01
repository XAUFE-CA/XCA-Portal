import { expect, test } from "@playwright/test";
import { useBriefEntry } from "./entry";
import { setThemePreference } from "./preferences";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
});

type RefreshObservation = {
  beforeHydration: number;
  samples: { selected: string[]; delta: number }[];
  stop: boolean;
};

declare global {
  interface Window {
    preferenceRefresh?: RefreshObservation;
  }
}

for (const mode of [
  { locale: "zh-CN", theme: "system", selected: ["中文", "系统"] },
  { locale: "zh-CN", theme: "dark", selected: ["中文", "深色"] },
  { locale: "en", theme: "light", selected: ["English", "Light"] },
  { locale: "en", theme: "system", selected: ["English", "System"] },
] as const) {
  test(`preferences stay selected and aligned throughout refresh / ${mode.locale} / ${mode.theme}`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Preference cookies need the test origin");
    await setThemePreference(page, mode.theme);
    await page.context().addCookies([{ name: "xca-locale", value: mode.locale, url: baseURL }]);
    await page.addInitScript(() => {
      const state: RefreshObservation = { beforeHydration: 0, samples: [], stop: false };
      window.preferenceRefresh = state;
      const sample = () => {
        const groups = [...document.querySelectorAll(".site-controls [role=radiogroup]")].filter(
          (group) => group.getBoundingClientRect().width > 0,
        );
        if (groups.length === 2) {
          const selected: string[] = [];
          let delta = 0;
          for (const group of groups) {
            const option = group.querySelector('[aria-checked="true"]');
            const slider = group.querySelector(".ui-segmented-control__slider");
            if (!option || !slider) throw new Error("A selected option and plate are required");
            const a = option.getBoundingClientRect();
            const b = slider.getBoundingClientRect();
            selected.push(option.textContent?.trim() ?? "");
            delta = Math.max(delta, Math.abs(a.left - b.left), Math.abs(a.width - b.width));
            if (slider.getAttribute("data-ready") === "false") state.beforeHydration++;
          }
          state.samples.push({ selected, delta });
        }
        if (!state.stop) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const { promise: hydration, resolve: release } = Promise.withResolvers<void>();
    await page.route("**/_nuxt/**", async (route) => {
      if (route.request().resourceType() === "script") await hydration;
      await route.continue();
    });
    const response = await page.goto("/about", { waitUntil: "commit" });
    try {
      expect(response?.status()).toBe(200);
      await expect
        .poll(() => page.evaluate(() => window.preferenceRefresh?.beforeHydration ?? 0))
        .toBeGreaterThan(2);
    } finally {
      release();
    }
    await expect(page.getByRole("radio", { name: mode.selected[1], exact: true })).toBeChecked();
    await expect(page.locator(".site-theme-control .ui-segmented-control__slider")).toHaveAttribute(
      "data-ready",
      "true",
    );
    const samples = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const state = window.preferenceRefresh;
      if (!state) throw new Error("Refresh observations are missing");
      state.stop = true;
      return state.samples;
    });
    for (const sample of samples) {
      expect(sample.selected).toEqual([...mode.selected]);
      expect(sample.delta).toBeLessThan(1);
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode.theme);
    await expect(page.locator("html")).not.toHaveAttribute("data-xca-intro");
  });
}
