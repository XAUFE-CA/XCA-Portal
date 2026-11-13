import { expect, test } from "@playwright/test";
import { linkPlate, plateClearance, plateGeometry, useFooterPage } from "./footer";

test.beforeEach(async ({ page }) => {
  await useFooterPage(page);
});

test("footer links answer hover with a rounded plate behind the text", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const link = page.getByRole("contentinfo").getByRole("link", { name: "MIT", exact: true });
  // The plate is painted behind the text, rounded, and invisible until the pointer arrives.
  // 底板绘制在文字之后，带圆角，指针到达前保持不可见。
  const rest = await linkPlate(link);
  expect(rest.opacity).toBe("0");
  expect(rest.radius).not.toBe("0px");
  await expect(link).toHaveCSS("text-decoration-line", "none");
  // The plate covers the line box, drops a hair below it and runs a little wider than the ink.
  // 底板盖住行盒、在下方略微溢出，并比墨迹略宽。
  const plate = await plateGeometry(link);
  expect(plate.plateHeight).toBeGreaterThanOrEqual(plate.boxHeight);
  expect(plate.plateHeight).toBeLessThan(plate.boxHeight * 1.2);
  // The drop stays a hair, so the plate never turns into a control-sized surface.
  // 下移量只有一丝，底板不会长成控件大小的面。
  expect(plate.drop).toBeGreaterThan(0);
  expect(plate.drop).toBeLessThan(plate.boxHeight * 0.1);
  expect(plate.plateWidth).toBeGreaterThan(plate.inkWidth);
  // A link with a descender exposes the bias: the plate keeps equal clearance above and below.
  // 带下伸部分的链接能暴露偏移：底板在墨迹上下保持相同留白。
  const author = page.getByRole("contentinfo").getByRole("link", { name: "Shenshijun" });
  const clearance = await plateClearance(author);
  expect(Math.abs(clearance.above - clearance.below)).toBeLessThan(2);
  // Painting must not move the text: the plate is decoration, not layout.
  // 绘制不得挤动文字：底板只是装饰，不参与排版。
  const before = await link.boundingBox();
  await link.hover();
  await expect.poll(async () => (await linkPlate(link)).opacity).toBe("1");
  expect((await linkPlate(link)).background).not.toBe("rgba(0, 0, 0, 0)");
  const after = await link.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
});

test("footer links press into the plate without fading it", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const link = page.getByRole("contentinfo").getByRole("link", { name: "MIT", exact: true });
  await link.hover();
  const hovered = await linkPlate(link);
  // Pressing stacks a second layer of the same field, so the plate deepens and pulls in.
  // 按下时再叠一层同色底板，使底板变深并向内收紧。
  await page.mouse.down();
  await expect.poll(async () => (await linkPlate(link)).image).toContain("gradient");
  await expect
    .poll(() => link.evaluate((node) => getComputedStyle(node, "::before").transform))
    .not.toBe("none");
  // The base colour must survive the press instead of fading.
  // 底色必须在按下时保持，而不是变淡。
  expect((await linkPlate(link)).background).toBe(hovered.background);
  // Release away from the link so the test never opens the destination.
  // 移开后再抬起鼠标，避免测试真的打开目标页面。
  await page.mouse.move(0, 0);
  await page.mouse.up();
});
