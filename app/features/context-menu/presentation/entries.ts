import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { Translator } from "~/i18n";
import { imageMenuEntries, imageWithin } from "./image-menu";

/** Closest anchor to the clicked node, which is the link a footer or nav menu acts on. */
export function anchorWithin(target: Element | null): HTMLAnchorElement | null {
  return target?.closest<HTMLAnchorElement>("a[href]") ?? null;
}

/**
 * Link rows for the footer and navigation. Both regions act on one anchor, so they share
 * the same entries and the same selection mapping. Image rows are added by regionMenuEntries.
 * 页脚与导航的链接菜单项。两个区域都作用于同一个链接，因此共用同一组条目与选择映射。
 * 图像行由 regionMenuEntries 追加。
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

/**
 * Rows every region shares: its own entries, image rows from the pressed element, then
 * the browser-menu row. The inputs fully determine the result, so the menu state only
 * supplies the open-time target.
 * 各区域共享的菜单行：区域自有条目、按被按下元素生成的图像行，最后是浏览器菜单行。
 * 输入完全决定结果，菜单状态只负责提供打开时的目标。
 */
export function regionMenuEntries(
  target: Element | null,
  regionEntries: (target: Element | null) => ContextMenuEntry[],
  t: Translator,
): ContextMenuEntry[] {
  const rows = [...regionEntries(target), ...imageMenuEntries(imageWithin(target), t)];
  return [
    ...rows,
    ...(rows.length ? [{ type: "separator" as const, id: "sep-native-menu" }] : []),
    { id: "native-menu", label: t("contextMenu.showNativeMenu") },
  ];
}
