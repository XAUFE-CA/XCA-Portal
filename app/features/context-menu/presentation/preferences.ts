import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { SiteTheme } from "../../../composables/useSiteTheme";
import { SITE } from "../../../config/site";
import { isSiteLocale, locales, type SiteLocale, type Translator } from "../../../i18n";

export interface PreferenceActions {
  setTheme: (value: SiteTheme) => void;
  setLocale: (value: SiteLocale) => void;
}

const isTheme = (value: string): value is SiteTheme => SITE.themes.some((theme) => theme === value);

/**
 * Theme and language rows shared by the title, terminal and about menus. Both expand into a
 * submenu so the current choice stays visible as a checked row.
 * 标题、终端与关于学社菜单共用的主题和语言行。两者都展开二级菜单，当前选项以勾选行显示。
 */
export function preferenceMenuEntries(
  t: Translator,
  theme: SiteTheme,
  locale: SiteLocale,
): ContextMenuEntry[] {
  return [
    {
      id: "theme",
      label: t("contextMenu.theme"),
      children: SITE.themes.map((value) => ({
        id: `theme:${value}`,
        label: t(`theme.${value}`),
        group: "theme",
        selection: "single" as const,
        checked: theme === value,
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
        checked: locale === value,
      })),
    },
  ];
}

/**
 * Applies a `theme:` or `locale:` row and reports whether the id belonged to preferences, so
 * each region keeps its own rows in one selection map.
 * 执行 `theme:` 或 `locale:` 行，并报告标识是否属于偏好设置，使各区域在同一选择映射中保留自有行。
 */
export function applyPreferenceRow(id: string, actions: PreferenceActions): boolean {
  if (id.startsWith("theme:")) {
    const value = id.slice("theme:".length);
    if (isTheme(value)) actions.setTheme(value);
    return true;
  }
  if (id.startsWith("locale:")) {
    const value = id.slice("locale:".length);
    if (isSiteLocale(value)) actions.setLocale(value);
    return true;
  }
  return false;
}
