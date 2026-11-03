import { viewTransitionAttribute } from "@neoverse-ui/motion";
import type { RouteLocationNormalized } from "vue-router";

// A reversal inside the spatial transition's lifetime would replay the page just left as the
// incoming snapshot; the short post-settle window covers a tap that lands after the fade ends.
// 在空间过渡时长内反向导航会把刚离开的页面当作进入快照重放；路由落定后的短窗口覆盖淡出刚结束时的点击。
const QUICK_REVERSAL_WINDOW_MS = 1000;

// Nuxt owns the route choreography; the shared attribute hands the capture the shared spatial
// timing instead of the user agent's own crossfade. Only the newest capture removes it, so an
// interrupted navigation cannot strip the marker from the one still on screen.
// 路由编排由 Nuxt 负责，共享属性让快照采用共享空间节奏而不是浏览器默认交叉淡化。只有最新的
// 快照负责移除标记，被中断的导航不会连带清掉仍在播放的那一次。
export default defineNuxtPlugin((nuxtApp) => {
  let active: ViewTransition | undefined;
  let currentNavigation: RouteLocationNormalized | undefined;
  let lastRouteChange: { from: string; at: number } | undefined;
  const suppressed = new WeakSet<RouteLocationNormalized>();
  const router = useRouter();

  router.beforeEach((to, from) => {
    currentNavigation = to;
    if (to.fullPath === from.fullPath) {
      // Returning to the route already on screen supersedes the capture in flight; it must not
      // keep painting the page the user has returned to.
      // 回到当前已在屏幕上的路由会取代进行中的快照；旧快照不得继续绘制用户已经返回的页面。
      active?.skipTransition();
      return;
    }
    // A quick reversal must not capture the page it is leaving: that snapshot would fade in
    // over the destination and read as the old page flashing on the new one.
    // 快速反向导航不得截取正在离开的页面：该快照会在目的页上淡入，被看成旧页在新页上闪一下。
    const quickReturn =
      lastRouteChange !== undefined &&
      to.fullPath === lastRouteChange.from &&
      performance.now() - lastRouteChange.at <= QUICK_REVERSAL_WINDOW_MS;
    if (!active && !quickReturn) return;
    suppressed.add(to);
    active?.skipTransition();
  });

  router.afterEach((to, from, failure) => {
    suppressed.delete(to);
    if (failure || from.matched.length === 0 || to.fullPath === from.fullPath) return;
    // Only settled client navigations set the reversal origin; a canceled one never arrived.
    // 只有落定的客户端导航记录反向起点；被取消的导航从未到达。
    lastRouteChange = { from: from.fullPath, at: performance.now() };
  });

  nuxtApp.hook("page:view-transition:start", (transition) => {
    // An interrupted or quickly reversed navigation commits without a snapshot; the capture
    // would paint the page the user just left after they already asked to leave it.
    // 被中断或快速反向的导航不截取快照直接提交；否则快照会在用户已经离开后重新绘制旧页。
    if (currentNavigation !== undefined && suppressed.has(currentNavigation)) {
      suppressed.delete(currentNavigation);
      transition.skipTransition();
      return;
    }
    active = transition;
    const root = document.documentElement;
    root.setAttribute(viewTransitionAttribute, "");
    const settle = () => {
      if (active !== transition) return;
      active = undefined;
      root.removeAttribute(viewTransitionAttribute);
    };
    // A canceled capture can reject ready while its route update never finishes.
    // 已取消的快照可能使 ready 失败，而路由更新始终无法结束。
    void transition.ready.catch(settle);
    void transition.finished.then(settle, settle);
  });
});
