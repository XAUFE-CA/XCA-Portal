import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { Translator } from "~/i18n";
import { copyImage } from "./clipboard";
import { copyLinkResult } from "./copy-result";

/**
 * Closest image to the pressed node. An image may sit inside a link, so a region can act on
 * both; detection lives here so every menu gets the image rows without region wiring.
 * 最近的被按下图片。图片可能位于链接内，区域因此可以同时作用于两者；识别集中在此，
 * 各菜单无需接线即可获得图像行。
 */
export function imageWithin(target: Element | null): HTMLImageElement | null {
  return target?.closest<HTMLImageElement>("img") ?? null;
}

/**
 * Rows appended to any menu whose pressed element is an image, after the region's own rows.
 * A new image needs no code change: the menu state derives these from the pressed element.
 * 按到图片时追加到区域自有行之后的图像行。新增图片无需改代码：菜单状态按被按下的元素推导。
 */
export function imageMenuEntries(
  image: HTMLImageElement | null,
  t: Translator,
): ContextMenuEntry[] {
  if (!image) return [];
  return [
    { type: "separator", id: "sep-image" },
    { id: "copy-image", label: t("contextMenu.copyImage") },
    { id: "copy-image-link", label: t("contextMenu.copyImageLink") },
  ];
}

/**
 * Copy an image element, falling back to its address when the browser cannot write image
 * data to the clipboard, so the row always leaves something usable behind.
 * 复制图片元素；浏览器无法写入图片数据时回退到图片地址，使该行总能留下可用内容。
 */
async function copyImageResult(image: HTMLImageElement, t: Translator): Promise<string> {
  if (await copyImage(image)) return t("contextMenu.imageCopied");
  const copied = await copyLinkResult(image.currentSrc || image.src, t);
  return copied === t("contextMenu.copied") ? t("contextMenu.imageCopyFailed") : copied;
}

/**
 * Runs an image row and returns `undefined` for every other id, so the menu state can fall
 * back to the region's own mapping.
 * 执行图像行，其余标识返回 `undefined`，使菜单状态可以回落到区域自己的映射。
 */
export function runImageRow(
  id: string,
  image: HTMLImageElement | null,
  t: Translator,
): Promise<string> | undefined {
  if (id === "copy-image" && image) return copyImageResult(image, t);
  if (id === "copy-image-link" && image) return copyLinkResult(image.currentSrc || image.src, t);
  return undefined;
}
