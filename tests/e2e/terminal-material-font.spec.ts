import { expect, test } from "@playwright/test";
import zh from "../../app/i18n/locales/zh-CN.json" with { type: "json" };

// Terminal faces are WOFF2 subsets under /_nuxt; an isolated profile avoids local font fallback.
// 终端字体是 /_nuxt 下的 WOFF2 子集，使用隔离的浏览器配置，避免回退到本地字体。
const REGULAR_FONT = "/_nuxt/maple-mono-nf-cn-regular";
const ITALIC_FONT = "/_nuxt/maple-mono-nf-cn-italic";

async function openHome(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("terminal font uses the shared Maple role for Chinese, Latin and command text", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const regular = page.waitForResponse(
      (response) => response.url().includes(REGULAR_FONT) && response.status() === 200,
      { timeout: 20_000 },
    );
    await openHome(page);

    const selectors = [
      ".xca-terminal-window",
      ".xca-terminal-chrome",
      ".xca-terminal-screen",
      ".xca-terminal-banner",
      ".ui-terminal-prompt__editor",
      ".xca-terminal-statusbar",
    ];
    for (const selector of selectors) {
      await expect
        .poll(() =>
          page
            .locator(selector)
            .first()
            .evaluate((el) => getComputedStyle(el).fontFamily.includes("Maple Mono NF CN")),
        )
        .toBe(true);
    }

    // The subset must cover the CJK, banner and box-drawing glyphs the portal renders.
    // 该子集必须覆盖门户渲染所需的 CJK、横幅与制表符号字形。
    const fontReady = await page.evaluate(async () => {
      await document.fonts.load('400 14px "Maple Mono NF CN"', "计算机学社 Explore █╔║");
      return document.fonts.check('400 14px "Maple Mono NF CN"', "计算机学社 Explore █╔║");
    });
    expect(fontReady).toBe(true);

    // A 19.8 MB upstream face is the regression this guards against.
    // 19.8 MB 的上游字体正是此处防范的回归。
    const response = await regular;
    const body = await response.body();
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThan(1_500_000);
    expect(response.headers()["cache-control"]).toContain("immutable");

    const input = page.locator("#xca-command-input");
    await input.fill("help");
    await input.press("Enter");
    const transcript = page.locator(".xca-terminal-transcript");
    await expect(transcript).toContainText(zh["command.available"]);
    const commands = (await transcript.textContent()) ?? "";
    expect(commands).not.toMatch(/\bfont\s+查看或切换/);
  } finally {
    await context.close();
  }
});

for (const localFonts of [true, false]) {
  test(`completion uses real Maple Italic with local fonts ${localFonts ? "enabled" : "disabled"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const italicRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(ITALIC_FONT)) italicRequests.push(request.url());
    });
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      await cdp.send("CSS.setLocalFontsEnabled", { enabled: localFonts });
      await openHome(page);

      const input = page.locator("#xca-command-input");
      const ghost = page.locator(".ui-terminal-prompt__ghost-suffix");
      await input.fill("echo clear 中文");
      await input.press("Enter");
      await expect(input).not.toHaveAttribute("readonly");
      await input.fill("echo c");
      await expect(ghost).toHaveText("lear 中文");
      await expect(ghost).toHaveCSS("font-style", "italic");
      await page.evaluate(() => document.fonts.ready);

      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: ".ui-terminal-prompt__ghost-suffix",
      });
      await expect
        .poll(async () => {
          const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
          return (
            fonts.length > 0 &&
            fonts.every((font) => font.postScriptName === "XCA-Code-Subset-Italic")
          );
        })
        .toBe(true);
      // A clean profile must fetch the subset; a local install may satisfy it instead.
      // 隔离配置下必须请求该子集。本地安装的字体可能替代满足。
      if (!localFonts) expect(italicRequests.length).toBeGreaterThan(0);
      await expect(input).toHaveCSS("font-style", "normal");
      await input.press("ArrowRight");
      await expect(input).toHaveValue("echo clear 中文");
      await expect(ghost).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("glass material remains translucent and usable in both themes", async ({ page }) => {
  await openHome(page);
  const shell = page.locator(".xca-terminal-window");
  const header = page.locator(".site-header");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const component of [shell, header]) {
      await expect(component).toHaveClass(/material-glass-elevated/);
      expect(await component.getAttribute("data-neoverse-glass-edge-pass")).toBeNull();
      const filter = await component.evaluate((el) => getComputedStyle(el).backdropFilter);
      expect(filter).toContain("blur(");
    }
    const bg = await page
      .locator(".xca-terminal-screen")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator(".xca-terminal-chrome")).toHaveCSS("font-family", /Maple Mono NF CN/);
  }
});
