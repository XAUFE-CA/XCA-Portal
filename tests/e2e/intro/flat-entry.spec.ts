import { expect, type Page, test } from "@playwright/test";

type Graphics = "unavailable" | "blocked";

async function setGraphics(page: Page, graphics: Graphics) {
  await page.addInitScript((mode) => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
      if (args[0] !== "webgl2") return Reflect.apply(getContext, this, args);
      if (mode === "blocked") throw new Error("WebGL2 is blocked");
      return null;
    } as typeof getContext;
  }, graphics);
}

for (const graphics of ["unavailable", "blocked"] as const) {
  test(`a ${graphics} GPU plays the flat entry and hands over one usable terminal`, async ({
    page,
  }) => {
    await setGraphics(page, graphics);
    const panoramas: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/intro/")) panoramas.push(request.url());
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page
      .locator(".xca-terminal-window")
      .evaluate((node) => node.setAttribute("data-original-terminal", "yes"));
    const mark = page.locator('.xca-ca-intro[data-intro-scene="flat"]');
    await expect(mark).toBeVisible({ timeout: 5000 });
    // The flat entry never mounts a projected scene or a canvas.
    await expect(mark.locator("canvas")).toHaveCount(0);
    await expect(page.locator(".xca-terminal-bootlog__line").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(mark).toHaveCount(0);
    const input = page.locator("#xca-command-input");
    await expect(input).toBeEnabled({ timeout: 30_000 });
    await input.fill("echo flat-entry");
    await input.press("Enter");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText("flat-entry");
    await expect(page.locator(".xca-terminal-window")).toHaveAttribute(
      "data-original-terminal",
      "yes",
    );
    expect(panoramas).toEqual([]);
  });
}

test("skipping the flat entry keeps the welcome screen and its terminal", async ({ page }) => {
  await setGraphics(page, "unavailable");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.xca-ca-intro[data-intro-scene="flat"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".xca-terminal-bootlog")).toHaveCount(0);
  const input = page.locator("#xca-command-input");
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill("echo after-flat-skip");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("after-flat-skip");
});
