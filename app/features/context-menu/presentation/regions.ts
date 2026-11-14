import type { ContextMenuEntry } from "@neoverse-ui/vue";
import { SITE } from "~/config/site";
import { locales } from "~/i18n";
import { selectionWithin } from "./clipboard";
import { copyLinkResult, copyResult } from "./copy-result";
import { anchorWithin, linkMenuEntries } from "./entries";
import { type ContextMenuResult, type ContextMenuState, useContextMenu } from "./useContextMenu";

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
 * Rows a region adds after the shared link rows, computed from the pressed element so a
 * row can belong to one anchor instead of the whole region. `select` handles only those
 * ids and returns `undefined` for the rest, so the shared rows keep one implementation.
 * 区域在共享链接行之后追加的行。行按被按下的元素计算，使某一行只属于单个链接而不是整个区域。
 * `select` 只处理自己的标识，其余返回 `undefined`，使共享行保持单一实现。
 */
export interface LinkMenuExtras {
  entries: (target: Element | null) => ContextMenuEntry[];
  select: (id: string) => ContextMenuResult;
}

/**
 * Link regions (footer and navigation) share one menu shape: copy the anchor and open it
 * in a new tab. Each region passes its own label so the panel is named for where it opened,
 * and an optional extras set for rows only that region can offer.
 * 链接区域（页脚与导航）共用一种菜单：复制链接、在新标签页打开。
 * 每个区域传入自己的名称，使面板按打开位置命名，并可传入仅该区域提供的附加行。
 */
export function useLinkMenu(label?: () => string, extras?: LinkMenuExtras) {
  const { t } = useSiteLocale();

  return useContextMenu({
    label: label ?? (() => t("contextMenu.label")),
    entries: (target) => [
      ...linkMenuEntries(anchorWithin(target), t),
      ...(extras?.entries(target) ?? []),
    ],
    select: (id, target) => {
      const extra = extras?.select(id);
      if (extra !== undefined) return extra;
      const anchor = anchorWithin(target);
      if (id === "copy-link" && anchor) return copyLinkResult(anchor.href, t);
      if (id === "open-link" && anchor) openInNewTab(anchor.href);
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
