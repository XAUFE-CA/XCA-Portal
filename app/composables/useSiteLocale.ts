import { startViewTransition } from "@neoverse-ui/motion";
import { nextTick } from "vue";
import { createTranslator, isSiteLocale, type SiteLocale } from "~/i18n";

// Chrome can paint one white frame while it captures the incoming snapshot next to the sampled
// glass plane. Suspend sampling only until the snapshot is painted, then restore the live glass.
// Chrome 在截取进入快照时重新采样相邻的玻璃面可能绘制一帧白色；只在快照绘制完成前暂停采样，
// 随后立即恢复实时玻璃，不改变切换期间的整体外观。
const LOCALE_TRANSITION_ATTRIBUTE = "data-xca-locale-transitioning";
let localeTransitions = 0;

function releaseLocaleTransition(): void {
  localeTransitions = Math.max(localeTransitions - 1, 0);
  if (localeTransitions === 0) {
    document.documentElement.removeAttribute(LOCALE_TRANSITION_ATTRIBUTE);
  }
}

function isViewTransitionAnimation(animation: Animation): boolean {
  const effect = animation.effect;
  return (
    typeof KeyframeEffect !== "undefined" &&
    effect instanceof KeyframeEffect &&
    (effect.pseudoElement?.startsWith("::view-transition") ?? false)
  );
}

function releaseAfterSnapshot(release: () => void): void {
  const root = document.documentElement;
  const schedule = () => {
    if (!root.hasAttribute("data-neoverse-view-transitioning")) {
      release();
      return;
    }
    if (document.getAnimations().some(isViewTransitionAnimation)) {
      release();
      return;
    }
    requestAnimationFrame(schedule);
  };
  requestAnimationFrame(schedule);
}

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
    localeTransitions += 1;
    document.documentElement.setAttribute(LOCALE_TRANSITION_ATTRIBUTE, "");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseLocaleTransition();
    };
    void startViewTransition(
      async () => {
        locale.value = value;
        saved.value = value;
        // The swap has to be painted before the incoming snapshot is captured.
        // 需要在截取进入快照之前完成这次替换。
        await nextTick();
      },
      { particle: "crossfade" },
    ).finally(release);
    releaseAfterSnapshot(release);
  }
  return { locale, t, setLocale };
}
