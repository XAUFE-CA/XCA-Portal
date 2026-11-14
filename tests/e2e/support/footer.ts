import type { Locator, Page } from "@playwright/test";
import { useBriefEntry } from "./entry";

// Keep the long tagline in one place; the footer renders it verbatim.
// 长标语只在此处维护一份，页脚按原样渲染。
export const TAGLINE_ZH =
  "也许二十年后会令你失望的，不是你曾做过的事，而是你不曾做过的。\n所以抛开绳结，驶离安全的港湾。\n乘风而行，去探索、去梦想、去发现！";
export const TAGLINE_EN =
  "Twenty years from now you will be more disappointed by the things\nthat you didn't do than by the ones you did do.\nSo throw off the bowlines. Sail away from the safe harbor.\nCatch the trade winds in your sails. Explore. Dream. Discover.";

/** Start a footer spec in the brief entry with motion reduced.
 *  让页脚用例走短入场并减少动态效果。 */
export async function useFooterPage(page: Page): Promise<void> {
  await useBriefEntry(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
}

/** Count pixels the flame actually painted; a blank canvas keeps every alpha at zero.
 *  统计火焰实际绘制的像素；空白画布的所有通道保持为零。 */
export function litPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context) return 0;
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let lit = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 8) lit += 1;
    return lit;
  });
}

/** Average the lit pixels so the flame's hue can be asserted without a screenshot.
 *  统计亮起像素的平均色，使火焰色相不依赖截图也能断言。 */
export function emberTint(canvas: Locator): Promise<{ red: number; green: number; blue: number }> {
  return canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context) throw new Error("The flame canvas must expose a 2D context");
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let red = 0;
    let green = 0;
    let blue = 0;
    let lit = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] <= 8) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      lit += 1;
    }
    return {
      red: red / Math.max(lit, 1),
      green: green / Math.max(lit, 1),
      blue: blue / Math.max(lit, 1),
    };
  });
}

/** Read a mark's final color in dark mode by painting it through the page's own filter.
 *  把标识按页面自身的滤镜画入画布，读取它在深色下的最终颜色。 */
export async function markWhite(page: Page, selector: string): Promise<[number, number, number]> {
  return page.evaluate(async (target) => {
    const image = document.querySelector(target);
    if (!(image instanceof HTMLImageElement)) throw new Error(`missing ${target}`);
    await image.decode();
    const filter = getComputedStyle(image).filter;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The mark canvas must expose a 2D context");
    if (filter !== "none") context.filter = filter;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 250) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }
    const divisor = Math.max(count, 1);
    const white: [number, number, number] = [
      Math.round(red / divisor),
      Math.round(green / divisor),
      Math.round(blue / divisor),
    ];
    return white;
  }, selector);
}

/** Read the decorative plate painted behind a footer link.
 *  读取脚注链接背后绘制的装饰底板。 */
export function linkPlate(link: Locator) {
  return link.evaluate((node) => {
    const style = getComputedStyle(node, "::before");
    return {
      opacity: style.opacity,
      radius: style.borderRadius,
      background: style.backgroundColor,
      image: style.backgroundImage,
    };
  });
}

/** Read the painted plate against the link box and the ink it has to hold.
 *  读取底板相对链接盒与墨迹的绘制盒。 */
export function plateGeometry(link: Locator) {
  return link.evaluate((node) => {
    const style = getComputedStyle(node, "::before");
    const box = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const ink = range.getBoundingClientRect();
    const blockStart = Number.parseFloat(style.top);
    const blockEnd = Number.parseFloat(style.bottom);
    return {
      plateHeight: box.height - blockEnd + blockStart,
      plateWidth: box.width - Number.parseFloat(style.left) * 2,
      drop: (blockStart - blockEnd) / 2,
      boxHeight: box.height,
      inkWidth: ink.width,
    };
  });
}

/** Measure the clearance the plate leaves above and below the glyph ink.
 *  测量底板在字形墨迹上下的留白。 */
export function plateClearance(link: Locator) {
  return link.evaluate(async (node) => {
    // Measuring against the fallback face would read the wrong ascent, so wait for the webfont.
    // 用回退字体会读到错误的 ascent，因此先等网页字体就绪。
    await document.fonts.ready;
    const plate = getComputedStyle(node, "::before");
    const text = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The measure canvas must expose a 2D context");
    context.font = `${text.fontWeight} ${text.fontSize} ${text.fontFamily}`;
    const metrics = context.measureText(node.textContent ?? "");
    // The line box centres the font box, so the baseline follows from the half-leading.
    // 行盒让字体盒居中，基线因此可由半行距推出。
    const halfLeading =
      (Number.parseFloat(text.lineHeight) -
        metrics.fontBoundingBoxAscent -
        metrics.fontBoundingBoxDescent) /
      2;
    const baseline = box.top + halfLeading + metrics.fontBoundingBoxAscent;
    return {
      above: baseline - metrics.actualBoundingBoxAscent - (box.top + Number.parseFloat(plate.top)),
      below:
        box.bottom -
        Number.parseFloat(plate.bottom) -
        (baseline + metrics.actualBoundingBoxDescent),
    };
  });
}
