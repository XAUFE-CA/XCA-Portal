import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator(".site-header-wrap")).toHaveCSS("transform", "none");
});

test("virtual paths, argument completion, prompt segments and appearance persist through theme and viewport changes", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  async function run(command: string) {
    await input.fill(command);
    await input.press("Enter");
    await expect(input).not.toHaveAttribute("readonly");
  }
  await run("cd /community");
  await expect(
    page.locator(".xca-terminal-prompt .ui-terminal-prompt__segment[data-tone='path']"),
  ).toHaveText("/community");
  await input.fill("cat /etc/o");
  await input.press("Tab");
  await expect(input).toHaveValue("cat /etc/os-release ");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-transcript")).toContainText(
    'NAME="XCA Browser Terminal"',
  );
  await run("xca background canvas");
  const background = await page
    .locator(".xca-terminal-window")
    .evaluate((node) =>
      (node as HTMLElement).style.getPropertyValue("--neoverse-terminal-background"),
    );
  await input.fill("unfinished draft");
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 850 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(input).toHaveValue("unfinished draft");
  await expect
    .poll(() =>
      page
        .locator(".xca-terminal-window")
        .evaluate((node) =>
          (node as HTMLElement).style.getPropertyValue("--neoverse-terminal-background"),
        ),
    )
    .toBe(background);
  await expect(
    page.locator(".xca-terminal-prompt .ui-terminal-prompt__segment[data-tone='path']"),
  ).toHaveText("/community");
});

test("menu and alternate TUI screen accept keyboard and pointer input without losing history", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  await input.fill("xca explore");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-menu")).toBeVisible();
  // The shared focus ring must stay inside the scrollport instead of being clipped at its left edge.
  // 共享焦点环必须完整落在滚动视口内，不能在左边缘被裁切。
  const focusRingFits = await page.evaluate(() => {
    const item = document.querySelector<HTMLElement>(".xca-terminal-menu__item");
    const region = document.querySelector<HTMLElement>(".xca-terminal-interaction");
    if (!item || !region) return false;
    const style = getComputedStyle(item);
    const ring = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    return item.getBoundingClientRect().left - ring >= region.getBoundingClientRect().left;
  });
  expect(focusRingFits).toBe(true);
  await expect(page.locator(".xca-terminal-menu__item").first()).toHaveClass(/--selected/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xca-terminal-menu")).toHaveCount(0);
  await expect(page.locator(".xca-terminal-transcript")).toContainText("当前主题");
  await input.fill("less /etc/os-release");
  await input.press("Enter");
  const application = page.locator(".xca-terminal-application");
  await expect(application).toBeVisible();
  await expect(application).toBeFocused();
  await expect(application).toContainText('NAME="XCA Browser Terminal"');
  await page.keyboard.press("q");
  await expect(application).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill("xca explore");
  await input.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-menu")).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill("echo ready");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-transcript")).toContainText("ready");
});

test("header smoothly morphs between the page top and floating state with a stable shell", async ({
  page,
}) => {
  // Extend the document fixture to exercise scrolling without another production route.
  // 延长文档测试夹具，以在不引入其他生产路由的情况下验证滚动。
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "2000px";
    document.querySelector(".site-main")?.append(spacer);
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
    )
    .toBeGreaterThan(200);
  const header = page.locator(".site-header");
  const wrap = page.locator(".site-header-wrap");
  const full = await header.boundingBox();
  const shellHeight = await wrap.evaluate((el) => el.clientHeight);
  if (!full) throw new Error("Page-top header bounding box is missing");
  expect(full.y).toBe(0);
  expect(full.width).toBeGreaterThan(1400);
  await expect(header).toHaveCSS("border-radius", "0px 0px 16px 16px");
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
  await expect(wrap).toHaveClass(/floating/);
  await expect
    .poll(async () => {
      const box = await header.boundingBox();
      if (!box) throw new Error("Floating header bounding box is missing");
      return box.width;
    })
    .toBeLessThan(full.width - 20);
  await page.waitForTimeout(500);
  const floating = await header.boundingBox();
  if (!floating) throw new Error("Floating header bounding box is missing");
  expect(floating.y).toBeGreaterThan(0);
  expect(await wrap.evaluate((el) => el.clientHeight)).toBe(shellHeight);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(wrap).not.toHaveClass(/floating/);
  await expect(header).toHaveCSS("border-radius", "0px 0px 16px 16px");
  expect(await wrap.evaluate((el) => el.clientHeight)).toBe(shellHeight);
});
