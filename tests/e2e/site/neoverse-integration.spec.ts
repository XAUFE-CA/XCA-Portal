import { expect, test } from "@playwright/test";

// Exercise the real menu when the browser cannot supply the native top layer.
// 当浏览器无法提供原生顶层时，改用真实菜单。
for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`shared menu fallback preserves keyboard dismissal and settings on the homepage / ${reducedMotion}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion, colorScheme: "light" });
    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, "showPopover", { value: undefined });
      Object.defineProperty(HTMLElement.prototype, "hidePopover", { value: undefined });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.keyboard.press("Escape");
    await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
    const toggle = page.locator(".site-menu").getByRole("button");
    await toggle.click();
    const menu = page.getByRole("dialog", { name: "菜单", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("opacity", "1");
    await expect(menu).toHaveCSS("scale", "1");
    await expect(menu).toHaveCSS("translate", "0px");
    await page.getByRole("radio", { name: "English", exact: true }).click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await toggle.click();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
