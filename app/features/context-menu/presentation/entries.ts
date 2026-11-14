import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { Translator } from "~/i18n";

/** Closest anchor to the clicked node, which is the link a footer or nav menu acts on. */
export function anchorWithin(target: Element | null): HTMLAnchorElement | null {
  return target?.closest<HTMLAnchorElement>("a[href]") ?? null;
}

/**
 * Link rows for the footer and navigation. Both regions act on one anchor, so they share
 * the same entries and the same selection mapping. Image rows are not added here: the menu
 * state derives them from the pressed element for every region.
 * 页脚与导航的链接菜单项。两个区域都作用于同一个链接，因此共用同一组条目与选择映射。
 * 图像行不在此处追加：菜单状态按被按下的元素为所有区域统一推导。
 */
export function linkMenuEntries(
  anchor: HTMLAnchorElement | null,
  t: Translator,
): ContextMenuEntry[] {
  return [
    { id: "copy-link", label: t("contextMenu.copyLink"), disabled: anchor === null },
    { id: "open-link", label: t("contextMenu.openInNewTab"), disabled: anchor === null },
  ];
}
