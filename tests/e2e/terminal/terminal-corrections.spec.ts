import { expect, test } from "@playwright/test";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "../support/timing";

test("an older session marker does not suppress first entry and refresh uses brief entry", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("xca-terminal-intro-v1", "seen"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--logo")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
});

test("xca intro is discoverable and explicitly replays, including with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const input = page.locator("#xca-command-input");
  await input.fill("man xca intro");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-transcript")).toContainText("重新播放首页启动演出");
  await input.fill("xca intro");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-hero--boot")).toHaveCount(1);
  // BOOT_SEQUENCE has six lines; the seventh grid row is the progress bar.
  // BOOT_SEQUENCE 有六行，网格的第七行是进度条。
  await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(6);
  await expect(page.locator(".xca-terminal-boot-progress")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator(".xca-terminal-hero--branding")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(input).toBeEnabled();
});

test("xca theme uses shared segments and terminal command input has no form chrome", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const themes = page.getByRole("radiogroup", { name: "主题" });
  await expect(themes).toHaveClass(/ui-segmented-control/);
  await themes.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const input = page.locator("#xca-command-input");
  await expect(input).not.toHaveClass(/ui-input/);
  await expect(input).toHaveCSS("border-top-width", "0px");
  await expect(input).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator(".xca-terminal-screen").click({ position: { x: 30, y: 180 } });
  await expect(input).toBeFocused();
  await page.keyboard.type("echo direct-input");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xca-terminal-transcript")).toContainText("direct-input");
});

test("Tab with no completion keeps terminal focus and page scroll position", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const input = page.locator("#xca-command-input");
  await input.fill("unknown-command");
  const scroll = await page.evaluate(() => window.scrollY);
  await input.press("Tab");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(input).toHaveValue("unknown-command");
  await input.fill("cat missing-path");
  await input.press("Tab");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await input.fill("");
  await input.press("Tab");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await input.fill("hel");
  await input.press("Tab");
  await expect(input).toHaveValue("help ");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await input.fill("less /etc/os-release");
  await input.press("Enter");
  const application = page.locator(".xca-terminal-application");
  await expect(application).toBeFocused();
  const tuiScroll = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Tab");
  await expect(application).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(tuiScroll);
  await page.keyboard.press("q");
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  await expect(input).not.toBeFocused();
});

test("shared header controls fit narrow and intermediate viewports", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const width of [320, 390, 610, 900, 1121, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const toggle = page.locator(".site-menu").getByRole("button");
    // The toggle can unmount mid-read as the header reflows; read it in one pass.
    // 顶栏重排时开关可能中途卸载；一次读取完成判断。
    const expanded = await toggle.evaluateAll((elements) =>
      elements[0]?.getAttribute("aria-expanded"),
    );
    if (expanded === "false") await toggle.click();
    const boxes = await page.evaluate(() =>
      [".site-header__brand", ".site-navigation", ".site-theme-control"].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Header control is missing: ${selector}`);
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        if (!a || !b) throw new Error("Header control bounds are missing");
        expect(
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
          `header controls overlap at ${width}px`,
        ).toBe(true);
      }
  }
});

test("INTRO replaces edited output with welcome before replay and after docking @cinematic", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1);
  await page.keyboard.press("Escape");
  // The host stays inert until skipping settles; commands typed into it are silently dropped.
  // 跳过收尾前宿主仍为 inert，此时提交的命令会被静默丢弃。
  await expect(page.locator(".xca-terminal-window")).not.toHaveAttribute("inert", {
    timeout: SETTLE_TIMEOUT,
  });
  const input = page.locator("#xca-command-input");
  await input.fill("echo previous-output");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-transcript")).toContainText("previous-output");
  await input.fill("xca INTRO");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-hero--logo")).toHaveCount(1);
  await expect(page.locator(".xca-terminal-transcript")).not.toContainText("previous-output");
  await expect(page.locator(".xca-terminal-transcript")).toContainText(
    "XAUFE Computer Association",
    { timeout: SCENE_TIMEOUT },
  );
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SCENE_TIMEOUT,
  });
  await expect(page.locator(".xca-terminal-transcript")).not.toContainText("previous-output");
  await expect(input).toBeFocused();
  await input.press("ArrowUp");
  await expect(input).toHaveValue("xca INTRO");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("echo previous-output");
});
