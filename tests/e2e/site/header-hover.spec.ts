import { expect, type Locator, type Page, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";

const NAV_ITEM = ".site-navigation .ui-navigation-item:not(.ui-navigation-item--active)";
const SEGMENT_OPTION =
  ".site-controls .ui-segmented-control__option:not(.ui-segmented-control__option--active)";

/** Wait for the control's feedback transition, including the press wash.
 *  等待控件的反馈过渡（含按下浅色）落定。 */
async function settleFeedback(target: Locator): Promise<void> {
  await target.evaluate(async (node) => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
}

/** Read the hover plate of one quiet control after its feedback transition settles.
 *  静默控件的反馈过渡落定后，读取它的悬浮底板颜色。 */
async function hoverPlate(page: Page, selector: string): Promise<string> {
  const target = page.locator(selector).first();
  await page.mouse.move(0, 0);
  await target.hover();
  await settleFeedback(target);
  return target.evaluate((node) => getComputedStyle(node).backgroundColor);
}

/** Hold one quiet control down and read the plate while the press is active.
 *  按住静默控件，并在按下状态读取底板颜色。 */
async function pressedPlate(page: Page, selector: string): Promise<string> {
  const target = page.locator(selector).first();
  await page.mouse.move(0, 0);
  await target.hover();
  await settleFeedback(target);
  const box = await target.boundingBox();
  if (box === null) throw new Error("Quiet control must be laid out");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await settleFeedback(target);
  const background = await target.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.mouse.up();
  return background;
}

/** Drop the alpha channel so the hue of two states can be compared.
 *  去掉透明度通道，以便比较两个状态的色相。 */
function channels(value: string): string {
  return value.replace(/\/[^/]*\)$/, ")").replace(/,\s*[\d.]+\)$/, ")");
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useBriefEntry(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
});

test("navigation and segmented options share one quiet hover plate in both themes", async ({
  page,
}) => {
  const navLight = await hoverPlate(page, NAV_ITEM);
  const segmentLight = await hoverPlate(page, SEGMENT_OPTION);
  expect(navLight).not.toBe("rgba(0, 0, 0, 0)");
  expect(navLight).toBe(segmentLight);

  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const navDark = await hoverPlate(page, NAV_ITEM);
  const segmentDark = await hoverPlate(page, SEGMENT_OPTION);
  expect(navDark).not.toBe("rgba(0, 0, 0, 0)");
  expect(navDark).toBe(segmentDark);
});

test("pressing a quiet control deepens the same neutral plate it hovers with", async ({ page }) => {
  const hovered = await hoverPlate(page, NAV_ITEM);
  const pressed = await pressedPlate(page, NAV_ITEM);
  expect(pressed).not.toBe(hovered);
  expect(channels(pressed)).toBe(channels(hovered));
});
