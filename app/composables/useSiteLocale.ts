import { startViewTransition } from "@neoverse-ui/motion";
import { nextTick } from "vue";
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
    // One switch rewrites the navigation labels and the page content at the same time, so the
    // change runs as a single crossfade instead of a hard cut; reduced motion, a missing View
    // Transitions API and an interrupted request fall back inside the shared helper.
    // 一次切换会同时改写导航词条与页面内容，因此以一次交叉淡化代替硬切；减少动态效果、
    // 缺少 View Transitions API 与被中断的请求都由共享能力内部回退。
    void startViewTransition(
      async () => {
        locale.value = value;
        saved.value = value;
        // The swap has to be painted before the incoming snapshot is captured.
        // 需要在截取进入快照之前完成这次替换。
        await nextTick();
      },
      { particle: "crossfade" },
    );
  }
  return { locale, t, setLocale };
}
