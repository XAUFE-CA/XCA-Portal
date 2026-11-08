import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { Translator } from "~/i18n";

/** Closest image to the clicked node; an image may sit inside a link, so both apply. */
export function imageWithin(target: Element | null): HTMLImageElement | null {
  return target?.closest<HTMLImageElement>("img") ?? null;
}

/** Closest anchor to the clicked node, which is the link a footer or nav menu acts on. */
export function anchorWithin(target: Element | null): HTMLAnchorElement | null {
  return target?.closest<HTMLAnchorElement>("a[href]") ?? null;
}

/**
 * Link rows for the footer and navigation. Both regions act on one anchor, so they
 * share the same entries and the same selection mapping.
 * 页脚与导航的链接菜单项。两个区域都作用于同一个链接，因此共用同一组条目与选择映射。
 */
export function linkMenuEntries(
  anchor: HTMLAnchorElement | null,
  t: Translator,
  image: HTMLImageElement | null = null,
): ContextMenuEntry[] {
  const rows: ContextMenuEntry[] = [
    { id: "copy-link", label: t("contextMenu.copyLink"), disabled: anchor === null },
    { id: "open-link", label: t("contextMenu.openInNewTab"), disabled: anchor === null },
  ];
  // An image inside a link is the common case for logos and banners, so the image rows
  // follow the link rows instead of replacing them.
  // 图片位于链接内是标识与横幅的常见结构，因此图片项排在链接项之后，而不是替换它们。
  if (image) {
    rows.push(
      { type: "separator", id: "sep-image" },
      { id: "copy-image", label: t("contextMenu.copyImage") },
      { id: "copy-image-link", label: t("contextMenu.copyImageLink") },
    );
  }
  return rows;
}
