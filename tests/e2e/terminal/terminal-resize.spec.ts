import { expect, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
});

test("following survives terminal column and viewport reflow without a new command", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const input = page.locator("#xca-command-input");
  const transcript = page.locator(".xca-terminal-transcript");
  const distance = () =>
    transcript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  for (let index = 0; index < 16; index++) {
    await input.fill(`echo resize-result-${index}`);
    await input.press("Enter");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText(`resize-result-${index}`);
  }
  await expect.poll(distance).toBeLessThanOrEqual(3);
  await input.fill("echo preserved draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(distance).toBeLessThanOrEqual(3);
  await expect(input).toHaveValue("echo preserved draft");
  await transcript.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(input).toHaveValue("echo preserved draft");
});
