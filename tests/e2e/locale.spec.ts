import { expect, test } from "@playwright/test";
import { useBriefEntry } from "./entry";
import { SETTLE_TIMEOUT } from "./timing";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("language switching preserves the terminal and persists through SSR and reload", async ({
  page,
  request,
}) => {
  const input = page.locator("#xca-command-input");
  await input.fill("cd /community");
  await input.press("Enter");
  await expect(input).not.toHaveAttribute("readonly");
  await input.fill("echo pending");
  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("XCA · Computer Association");
  await expect(input).toHaveValue("echo pending");
  await expect(page.locator(".xca-terminal-history")).toContainText(
    "Explore technology · Share knowledge · Build things",
  );
  await input.fill("pwd");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("/community");
  await input.fill("help");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-history")).toContainText("List available commands");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("XCA · Computer Association");
  // Read raw HTML separately from the hydrated page to prove locale-aware SSR.
  // 单独读取原始 HTML 与水合后的页面，以证明 SSR 具备语言感知。
  const response = await request.get("/", { headers: { Cookie: "xca-locale=en" } });
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('lang="en"');
  expect(html).toContain("XCA · Computer Association");
  await page
    .getByRole("radiogroup", { name: "Language" })
    .getByRole("radio", { name: "中文" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
});

test("an unsupported cookie falls back to Chinese", async ({ page, context, baseURL }) => {
  if (baseURL === undefined) throw new Error("A base URL is required to set the locale cookie");
  await context.addCookies([{ name: "xca-locale", value: "unsupported", url: baseURL }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("radio", { name: "中文" })).toHaveAttribute("aria-checked", "true");
});

function measureHeaderIssues() {
  function overlappingGroups(groups: DOMRect[]) {
    const issues: string[] = [];
    for (const [index, a] of groups.entries()) {
      for (let next = index + 1; next < groups.length; next++) {
        const b = groups[next];
        if (!b) throw new Error(`Header group ${next} is missing`);
        if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))
          issues.push("overlapping header groups");
      }
    }
    return issues;
  }
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) throw new Error("The header is required to measure localized navigation");
  const issues: string[] = [];
  const rowControls = [
    ...header.querySelectorAll<HTMLElement>(
      ".site-logo, :scope > .site-navigation a, :scope > .site-controls [role=radiogroup], .site-menu > button",
    ),
  ].map((element) => element.getBoundingClientRect());
  const rowCenters = rowControls.map((rect) => rect.top + rect.height / 2);
  if (Math.max(...rowCenters) - Math.min(...rowCenters) > 1) issues.push("misaligned header row");
  for (const control of header.querySelectorAll<HTMLElement>("a, button")) {
    const rect = control.getBoundingClientRect();
    if (rect.left < 0 || rect.right > window.innerWidth) issues.push("offscreen control");
  }
  const groups = [".site-header__brand", ".site-navigation", ".site-controls"].map((selector) => {
    const group = header.querySelector(selector);
    if (!group) throw new Error(`Header group is missing: ${selector}`);
    return group.getBoundingClientRect();
  });
  issues.push(...overlappingGroups(groups));
  return issues;
}
test("header navigation and settings remain reachable without overlap in both languages", async ({
  page,
}) => {
  for (const width of [320, 390, 610, 900, 1121, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const mobileMenu = page.locator(".site-menu").getByRole("button");
    if (await mobileMenu.isVisible()) {
      if ((await mobileMenu.getAttribute("aria-expanded")) === "false") await mobileMenu.click();
      // The panel must report itself open before its controls can be clicked.
      // 面板必须先报告已展开，其控件才可以点击。
      await expect(mobileMenu).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".site-controls")).toBeVisible();
    }
    for (const language of ["English", "中文"]) {
      await page
        .locator(".site-controls")
        .getByRole("radio", { name: language, exact: true })
        .click({ timeout: SETTLE_TIMEOUT });
      const differences = await page.evaluate(measureHeaderIssues);
      expect(differences, `${language}, ${width}px`).toEqual([]);
    }
  }
});
