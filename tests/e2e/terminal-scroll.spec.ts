import { expect, test } from "@playwright/test";
import zh from "../../app/i18n/locales/zh-CN.json" with { type: "json" };

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("prompt follows output without an empty fixed-height gap", async ({ page }) => {
  const gap = await page.evaluate(() => {
    const lines = document.querySelectorAll(".xca-terminal-transcript .xca-terminal-line");
    const prompt = document.querySelector(".xca-terminal-prompt");
    const last = lines[lines.length - 1];
    if (!prompt || !last) throw new Error("Terminal prompt or last output line is missing");
    return prompt.getBoundingClientRect().top - last.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(24);
});

test("command results scroll into the terminal while the page stays still", async ({ page }) => {
  const input = page.locator("#xca-command-input");
  const pageScroll = await page.evaluate(() => window.scrollY);
  for (let index = 0; index < 12; index++) {
    await input.fill(`echo result-${index}`);
    await input.press("Enter");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText(`result-${index}`);
  }
  await page.locator(".xca-terminal-transcript").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await input.fill("echo newest-result");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("newest-result");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const transcript = document.querySelector(".xca-terminal-transcript");
        if (!transcript) throw new Error("Terminal transcript is missing");
        const result = transcript.querySelectorAll(".xca-terminal-line");
        const bounds = transcript.getBoundingClientRect();
        const lastLine = result[result.length - 1];
        if (!lastLine) throw new Error("Last terminal output line is missing");
        const last = lastLine.getBoundingClientRect();
        return transcript.scrollTop > 0 && last.top >= bounds.top && last.bottom <= bounds.bottom;
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  await expect(input).toBeFocused();
});

test("long output keeps the next prompt visible and clear resets its position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.locator("#xca-command-input");
  await input.fill("help");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-history")).toContainText(zh["command.available"]);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const transcript = document.querySelector(".xca-terminal-transcript");
        const promptElement = document.querySelector(".xca-terminal-prompt");
        if (!transcript || !promptElement)
          throw new Error("Terminal transcript or prompt is missing");
        const viewport = transcript.getBoundingClientRect();
        const prompt = promptElement.getBoundingClientRect();
        return prompt.top >= viewport.top && prompt.bottom <= viewport.bottom + 1;
      }),
    )
    .toBe(true);
  await input.fill("clear");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-history")).toBeEmpty();
  await expect
    .poll(() => page.locator(".xca-terminal-transcript").evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(input).toBeFocused();
});
