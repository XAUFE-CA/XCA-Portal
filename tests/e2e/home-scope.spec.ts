import { expect, test } from "@playwright/test";

test("the homepage exposes no deferred pages or terminal content queries", async ({
  page,
  request,
}) => {
  for (const path of ["/about", "/departments"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".site-navigation a")).toHaveCount(1);
  await expect(page.locator(".site-navigation a")).toHaveAttribute("href", "/");
  await expect(page.locator(".department-card, .reading-content")).toHaveCount(0);
  const input = page.locator("#xca-command-input");
  await input.fill("xca help");
  await input.press("Enter");
  const transcript = page.locator(".xca-terminal-transcript");
  await expect(transcript).toContainText("xca open");
  for (const name of ["about", "departments", "teams"]) {
    await expect(transcript).not.toContainText(`xca ${name}`);
  }
  await input.fill("xca open ");
  await input.press("Tab");
  await expect(input).toHaveValue("xca open home ");
  await input.fill("cat /community/about.md");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toContainText("/community/about.md");
  await expect(page.locator(".xca-terminal-line").last()).toHaveAttribute("data-tone", "error");
});
