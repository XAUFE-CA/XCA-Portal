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
 * Rows every region shares, assembled in one order: the pressed element's own actions, then
 * the image rows it owns, then the rows shared by every menu of this kind, then the browser
 * menu. Keeping the order here stops a region from splitting its own actions across groups.
 * 各区域共享的菜单行，按同一顺序组装：按下元素自己的操作、它自带的图像行、同类菜单共用的行，
 * 最后是浏览器菜单。顺序集中在此，区域不会把自己的操作拆到不同分组。
 */
export function regionMenuEntries(
  target: Element | null,
  regionEntries: (target: Element | null) => ContextMenuEntry[],
  sharedEntries: ((target: Element | null) => ContextMenuEntry[]) | undefined,
  t: Translator,
): ContextMenuEntry[] {
  const rows = [...regionEntries(target)];
  const images = imageMenuEntries(imageWithin(target), t);
  if (images.length) {
    if (rows.length) rows.push({ type: "separator", id: "sep-image" });
    rows.push(...images);
  }
  const shared = sharedEntries?.(target) ?? [];
  if (shared.length) {
    if (rows.length) rows.push({ type: "separator", id: "sep-shared" });
    rows.push(...shared);
  }
  return [
    ...rows,
    ...(rows.length ? [{ type: "separator" as const, id: "sep-native-menu" }] : []),
    { id: "native-menu", label: t("contextMenu.showNativeMenu") },
  ];
}
