// Parser-blocking bootstrap: migrate legacy theme before rendering; intro gate is home-only.
// 阻塞解析的引导：渲染前迁移旧主题，开场门禁仅用于首页。
(() => {
  try {
    const saved = localStorage.getItem("xca-theme");
    if (saved === "light" || saved === "dark" || saved === "system") {
      const cookie = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("xca-theme="))
        ?.slice("xca-theme=".length);
      if (cookie !== "light" && cookie !== "dark" && cookie !== "system") {
        // Migration must complete synchronously before first paint, so the async Cookie Store API cannot be used.
        // 迁移必须早于首帧同步完成，因此不能使用异步的 Cookie Store API。
        document.cookie = `xca-theme=${saved}; path=/; max-age=31536000; samesite=lax`;
        if (document.cookie.split("; ").includes(`xca-theme=${saved}`)) {
          localStorage.removeItem("xca-theme");
          // Re-request SSR with the migrated preference before any control is painted.
          // 在任何控件绘制前，携带迁移后的偏好重新请求 SSR。
          location.reload();
          return;
        }
      } else {
        localStorage.removeItem("xca-theme");
      }
    }
  } catch {
    // Storage restrictions must not block the cookie-backed server-rendered page.
    // 存储限制不得阻塞使用 Cookie 偏好的服务端页面。
  }

  if (location.pathname !== "/") return;
  const root = document.documentElement;
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Stylesheets load after this script, so install the first-paint gate here.
    // 样式表在此脚本之后加载，故在此安装首帧门禁。
    const gateStyle = document.createElement("style");
    gateStyle.dataset.xcaIntroGate = "";
    gateStyle.textContent = `
      html[data-xca-intro="pending"] .site-header-wrap,
      html[data-xca-intro="pending"] .site-footer,
      html[data-xca-intro="pending"] .xca-terminal-hero__heading,
      html[data-xca-intro="pending"] .xca-terminal-window,
      html[data-xca-intro="pending"] .xca-document-scrollbar {
        opacity: 0 !important;
        visibility: hidden !important;
        transition: none !important;
      }
      html[data-xca-intro="pending"] body {
        overflow: hidden !important;
      }
      html[data-xca-intro="running"] .xca-document-scrollbar {
        visibility: hidden !important;
      }
    `;
    document.head.append(gateStyle);
    root.dataset.xcaIntro = "pending";
    // Failsafe release if hydration or client scripting fails.
    // 水合或客户端脚本失败时的兜底解除。
    setTimeout(() => {
      if (root.dataset.xcaIntro === "pending") delete root.dataset.xcaIntro;
    }, 8000);
  } catch {
    /* Bootstrap failure should never block the page.
       引导失败绝不应阻塞页面。 */
  }
})();
