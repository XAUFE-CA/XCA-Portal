import { nextTick } from "vue";

export type SiteTheme = "light" | "dark" | "system";

const COOKIE_KEY = "xca-theme";
const VIEW_TRANSITION = "data-neoverse-theme-view-transitioning";
const COLOR_TRANSITION = "data-neoverse-theme-transitioning";
// Client document only; all callers (header and terminal) share interruption state.
// 仅限客户端文档。所有调用方（页头与终端）共享中断状态。
let transition: ViewTransition | undefined;
let request = 0;
let cleanupTimer: number | undefined;
let refreshFrame: number | undefined;

export function useSiteTheme() {
  const saved = useCookie<string>(COOKIE_KEY, { sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  const theme = useState<SiteTheme>(COOKIE_KEY, () =>
    saved.value === "light" || saved.value === "dark" ? saved.value : "system",
  );
  const { $glassRenderer } = useNuxtApp();

  function setTheme(value: SiteTheme, options: { animate?: boolean } = {}) {
    // Command services read the selected mode synchronously after setTheme.
    // 命令服务在 setTheme 之后同步读取所选模式。
    theme.value = value;
    saved.value = value;
    if (!import.meta.client) return;

    const root = document.documentElement;
    const version = ++request;
    transition?.skipTransition();
    transition = undefined;
    window.clearTimeout(cleanupTimer);
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame);
    cleanupTimer = undefined;
    refreshFrame = undefined;
    root.removeAttribute(VIEW_TRANSITION);
    root.removeAttribute(COLOR_TRANSITION);
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const resolve = (mode: string | undefined) =>
      mode === "light" || mode === "dark" ? mode : system;
    const apply = () => {
      if (version !== request) return;
      root.dataset.theme = value;
    };
    if (
      options.animate === false ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      resolve(root.dataset.theme) === resolve(value)
    ) {
      apply();
      $glassRenderer?.refresh();
      return;
    }
    if (typeof document.startViewTransition === "function") {
      try {
        root.setAttribute(VIEW_TRANSITION, "");
        const active = document.startViewTransition(async () => {
          apply();
          await nextTick();
          // Include the shared WebGL Aurora Glass edge in the incoming snapshot.
          // 把共享的 WebGL 极光玻璃边缘纳入进入快照。
          $glassRenderer?.refresh();
        });
        transition = active;
        const cleanup = () => {
          if (version !== request) return;
          transition = undefined;
          root.removeAttribute(VIEW_TRANSITION);
        };
        void active.ready.catch(() => undefined);
        void active.updateCallbackDone.catch(() => {
          apply();
          $glassRenderer?.refresh();
        });
        void active.finished.then(cleanup, cleanup);
        return;
      } catch {
        root.removeAttribute(VIEW_TRANSITION);
      }
    }
    // Older browsers interpolate the registered color variables in shared motion CSS.
    // 旧版浏览器依靠共享动效 CSS 对已注册颜色变量做插值。
    root.setAttribute(COLOR_TRANSITION, "");
    const style = getComputedStyle(root);
    const duration = style.getPropertyValue("--neoverse-motion-theme-fallback-duration").trim();
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    // Resolve the old color with transition properties active before changing variables.
    // 在更改样式变量前先让过渡属性生效并解析旧颜色。
    style.getPropertyValue("--neoverse-color-surface-canvas");
    apply();
    const refresh = () => {
      if (version !== request) return;
      $glassRenderer?.refresh();
      refreshFrame = requestAnimationFrame(refresh);
    };
    refresh();
    cleanupTimer = window.setTimeout(
      () => {
        if (version !== request) return;
        if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame);
        refreshFrame = undefined;
        cleanupTimer = undefined;
        root.removeAttribute(COLOR_TRANSITION);
        $glassRenderer?.refresh();
      },
      Number.isFinite(milliseconds) ? milliseconds : 0,
    );
  }

  return { theme, setTheme };
}
