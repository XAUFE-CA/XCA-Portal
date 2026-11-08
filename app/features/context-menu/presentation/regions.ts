import { SITE } from "~/config/site";
import type { Translator } from "~/i18n";
import { locales } from "~/i18n";
import { copyImage, selectionWithin } from "./clipboard";
import { copyLinkResult, copyResult } from "./copy-result";
import { anchorWithin, imageWithin, linkMenuEntries } from "./entries";
import { type ContextMenuState, useContextMenu } from "./useContextMenu";

/**
 * Open a destination in a new tab through a real anchor click. `window.open` is treated
 * as a popup by some browsers once the panel has taken focus, while a synthetic anchor
 * click keeps the current page untouched and the new tab in the foreground.
 * 通过真实链接点击在新标签页打开目标。面板获得焦点后，部分浏览器会把 window.open 当作弹窗，
 * 而合成的链接点击不会替换当前页面，并让新标签页保持在前台。
 */
function openInNewTab(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
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
 * Link regions (footer and navigation) share one menu shape: copy the anchor, open it
 * in a new tab, and — when the press lands on an image — copy the image or its address.
 * 链接区域（页脚与导航）共用一种菜单：复制链接、在新标签页打开；按到图片时还可复制图片或其地址。
 */
export function useLinkMenu() {
  const { t } = useSiteLocale();

  return useContextMenu({
    label: () => t("contextMenu.label"),
    entries: (target) => linkMenuEntries(anchorWithin(target), t, imageWithin(target)),
    select: (id, target) => {
      const anchor = anchorWithin(target);
      const image = imageWithin(target);
      if (id === "copy-link" && anchor) return copyLinkResult(anchor.href, t);
      if (id === "open-link" && anchor) openInNewTab(anchor.href);
      if (id === "copy-image" && image) return copyImageResult(image, t);
      if (id === "copy-image-link" && image)
        return copyLinkResult(image.currentSrc || image.src, t);
      return undefined;
    },
  });
}

/**
 * About-page rows: copy the current selection, the page title or the canonical address.
 * 关于学社的行：复制当前选区、页面标题或规范地址。
 */
export function useAboutMenu(title: () => string | undefined, root: () => Element | null) {
  const { t } = useSiteLocale();
  const pageUrl = () => (typeof window === "undefined" ? SITE.routes.about : window.location.href);

  return useContextMenu({
    label: () => t("contextMenu.about"),
    entries: () => {
      const selection = selectionWithin(root());
      return [
        {
          id: "copy-selection",
          label: t("contextMenu.copySelection"),
          disabled: selection.length === 0,
        },
        { id: "copy-page-title", label: t("contextMenu.copyPageTitle"), disabled: !title() },
        { id: "copy-page-url", label: t("contextMenu.copyPageUrl") },
      ];
    },
    select: (id) => {
      if (id === "copy-selection") return copyResult(selectionWithin(root()), t);
      if (id === "copy-page-title") return copyResult(title() ?? "", t);
      if (id === "copy-page-url") return copyResult(pageUrl(), t);
      return undefined;
    },
  });
}

/**
 * Hero title rows: copy the two lines, then the shared page actions. Theme and language
 * open a submenu so the current value stays visible as a checked row.
 * 首页标题行：复制两行文案，然后提供共用页面操作。主题与语言展开二级菜单，当前值以勾选行显示。
 */
export function useTitleMenu(title: () => string, subtitle: () => string) {
  const { t } = useSiteLocale();
  const { theme, setTheme } = useSiteTheme();
  const { locale, setLocale } = useSiteLocale();

  return useContextMenu({
    label: () => t("contextMenu.title"),
    entries: () => [
      { id: "copy-title", label: t("contextMenu.copyTitle"), disabled: !title() },
      { id: "copy-subtitle", label: t("contextMenu.copySubtitle"), disabled: !subtitle() },
      { type: "separator", id: "sep-page" },
      { id: "replay-intro", label: t("contextMenu.replayIntro") },
      { id: "reload", label: t("contextMenu.reload") },
      { type: "separator", id: "sep-preferences" },
      {
        id: "theme",
        label: t("contextMenu.theme"),
        children: SITE.themes.map((value) => ({
          id: `theme:${value}`,
          label: t(`theme.${value}`),
          group: "theme",
          selection: "single" as const,
          checked: theme.value === value,
        })),
      },
      {
        id: "locale",
        label: t("contextMenu.locale"),
        children: locales.map((value) => ({
          id: `locale:${value}`,
          label: t(`locale.${value}`),
          group: "locale",
          selection: "single" as const,
          checked: locale.value === value,
        })),
      },
    ],
    select: (id) => {
      if (id === "reload") {
        if (typeof window !== "undefined") window.location.reload();
        return undefined;
      }
      if (id === "copy-title") return copyResult(title(), t);
      if (id === "copy-subtitle") return copyResult(subtitle(), t);
      if (id.startsWith("theme:")) {
        const value = id.slice(6);
        if (value === "light" || value === "dark" || value === "system") setTheme(value);
      } else if (id.startsWith("locale:")) setLocale(id.slice(7));
      return undefined;
    },
  });
}

/** Ref callback shape for a region element, matching the shared menu state. */
export type { ContextMenuState };
