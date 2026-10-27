import { createTranslator, isSiteLocale, type SiteLocale } from "~/i18n";

export function useSiteLocale() {
  // The cookie is available during SSR, so reloads render the selected language immediately.
  // Cookie 在 SSR 期间可用，因此刷新后立即渲染所选语言。
  const saved = useCookie<string>("xca-locale", { sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  const locale = useState<SiteLocale>("xca-locale", () =>
    isSiteLocale(saved.value) ? saved.value : "zh-CN",
  );
  const t = createTranslator(() => locale.value);
  function setLocale(value: string) {
    if (!isSiteLocale(value)) return;
    locale.value = value;
    saved.value = value;
  }
  return { locale, t, setLocale };
}
