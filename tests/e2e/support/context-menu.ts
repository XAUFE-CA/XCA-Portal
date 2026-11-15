import { expect, type Locator, type Page } from "@playwright/test";
import { useBriefEntry } from "./entry";

// Every region mounts its own panel, so only the open one is visible.
// 每个区域各挂载一个面板，只有打开的那个可见。
export const contextMenuPanel = (page: Page): Locator => page.locator(".ui-context-menu:visible");

/** Open a region's menu at a viewport point, so a case asserts the panel rather than the pointer path.
 *  在视口坐标打开区域菜单，使用例针对面板本身，而不是指针如何到达那里。 */
export async function openContextMenuAt(
  page: Page,
  region: Locator,
  offset = { x: 8, y: 8 },
): Promise<void> {
  const box = await region.boundingBox();
  if (!box) throw new Error("Region must be laid out before opening its menu");
  await page.mouse.click(box.x + offset.x, box.y + offset.y, { button: "right" });
  await expect(contextMenuPanel(page)).toBeVisible();
}

/** Start a context-menu case in the brief entry with motion reduced.
 *  让上下文菜单用例走短入场并减少动态效果。 */
export async function useContextMenuPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useBriefEntry(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
}
