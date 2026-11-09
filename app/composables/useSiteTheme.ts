import type { GlassRenderer } from "@neoverse-ui/glass-runtime";
import { nextTick } from "vue";
import { hasOpenTopLayerSurface, waitForTopLayerClose } from "~/utils/top-layer";

export type SiteTheme = "light" | "dark" | "system";

/** The shared Aurora Glass renderer repaints its edge for the new palette. */
type Glass = Pick<GlassRenderer, "refresh"> | undefined;

const COOKIE_KEY = "xca-theme";
// Track the active theme capture independently of route and language transitions.
// 独立于路由与语言过渡跟踪当前主题快照。
const themeViewTransitionAttribute = "data-neoverse-theme-view-transitioning";
const COLOR_TRANSITION = "data-neoverse-theme-transitioning";
// Client document only; all callers (header and terminal) share interruption state.
// 仅限客户端文档。所有调用方（页头与终端）共享中断状态。
let transition: ViewTransition | undefined;
let request = 0;
let cleanupTimer: number | undefined;
let refreshFrame: number | undefined;

// A newer request owns the document; pending timers and frames from the previous one are stale.
// 较新的请求接管文档，上一请求遗留的计时器与帧都已经失效。
function resetPendingWork(): void {
  window.clearTimeout(cleanupTimer);
  if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame);
  cleanupTimer = undefined;
  refreshFrame = undefined;
}

/** Commit the new palette at once, for reduced motion, an unchanged result or a kept-open surface. */
function commitTheme(apply: () => void, glass: Glass): void {
  apply();
  glass?.refresh();
}

/**
 * Crossfade the whole document from the old palette to the new one. View Transitions capture the
 * page itself; browsers without support interpolate the registered semantic color variables.
 * 把整个文档从旧配色淡化到新配色。视图过渡截取页面本身；不支持的浏览器改为插值已注册的语义颜色变量。
 */
function animateTheme(root: HTMLElement, apply: () => void, version: number, glass: Glass): void {
  if (typeof document.startViewTransition === "function") {
    try {
      root.setAttribute(themeViewTransitionAttribute, "");
      const active = document.startViewTransition(async () => {
        apply();
        await nextTick();
        // Include the shared WebGL Aurora Glass edge in the incoming snapshot.
        // 把共享的 WebGL 极光玻璃边缘纳入进入快照。
        glass?.refresh();
      });
      transition = active;
      const cleanup = () => {
        if (version !== request) return;
        transition = undefined;
        root.removeAttribute(themeViewTransitionAttribute);
      };
      void active.ready.catch(() => undefined);
      void active.updateCallbackDone.catch(() => {
        apply();
        glass?.refresh();
      });
      void active.finished.then(cleanup, cleanup);
      return;
    } catch {
      root.removeAttribute(themeViewTransitionAttribute);
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
    glass?.refresh();
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
      glass?.refresh();
    },
    Number.isFinite(milliseconds) ? milliseconds : 0,
  );
}

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
    resetPendingWork();
    root.removeAttribute(themeViewTransitionAttribute);
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
      commitTheme(apply, $glassRenderer);
      return;
    }
    // An open surface in the native top layer cannot sample the page behind it, so the capture
    // has to wait for it. A menu row closes its own panel in the same tick as it commits this
    // preference, so that panel is still open here and only a kept-open surface commits at once.
    // 原生顶层中打开的表面上无法采样其背后的页面，因此截取必须等它离开。菜单行在提交本偏好的
    // 同一时刻关闭自身面板，此刻它仍然打开；只有保持打开的表面才立即提交。
    if (!hasOpenTopLayerSurface()) {
      animateTheme(root, apply, version, $glassRenderer);
      return;
    }
    void waitForTopLayerClose().then((closed) => {
      if (version !== request) return;
      if (closed) animateTheme(root, apply, version, $glassRenderer);
      else commitTheme(apply, $glassRenderer);
    });
  }

  return { theme, setTheme };
}
