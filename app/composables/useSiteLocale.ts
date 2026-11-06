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
    if (!isSiteLocale(value) || value === locale.value) return;
    // The copy swaps in place without a page capture or a crossfade: a capture would replace the
    // live page and strip the shared glass rim for its whole duration. Only the boxes that need
    // more or less room move, and they animate on their own (the header shells, the about card).
    // 文案就地替换，不做整页快照也不做交叉淡化：快照会替换实时页面并在整段时间里剥掉共享玻璃
    // 边缘。只有需要更多或更少空间的盒子才会动，且各自带过渡（页头外壳、关于学社卡片）。
    locale.value = value;
    saved.value = value;
  }
  return { locale, t, setLocale };
}
