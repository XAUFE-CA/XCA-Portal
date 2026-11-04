import { viewTransitionAttribute } from "@neoverse-ui/motion";
import type { RouteLocationNormalized } from "vue-router";

// A reversal inside the spatial transition's lifetime would replay the page just left as the
// incoming snapshot; the short post-settle window covers a tap that lands after the fade ends.
// 在空间过渡时长内反向导航会把刚离开的页面当作进入快照重放；路由落定后的短窗口覆盖淡出刚结束时的点击。
const QUICK_REVERSAL_WINDOW_MS = 1000;
const PAGE_SELECTOR = ".site-main";
const CAPTURE_ATTRIBUTE = "data-xca-route-capture";
const SNAPSHOT_PROPERTIES = {
  top: "--xca-route-snapshot-top",
  width: "--xca-route-snapshot-width",
  height: "--xca-route-snapshot-height",
  offset: "--xca-route-snapshot-offset",
} as const;

// The named page is taller than the viewport, so the group's default geometry carries the
// scroll offset and slides both snapshots during the fade. Pin that geometry to the capture
// box and move the incoming snapshot back to its own top; each side then stays still.
// 命名页面高于视口，默认分组几何会携带滚动偏移，使两张快照在淡出期间一起滑动。把分组
// 固定到截取时的盒模型，再把进入快照移回自身顶部，两侧画面便保持静止。
function keepRouteSnapshotsStill(
  transition: ViewTransition,
  isCurrent: () => boolean,
  onSettle: () => void,
): void {
  const root = document.documentElement;
  const sourceRect = document.querySelector<HTMLElement>(PAGE_SELECTOR)?.getBoundingClientRect();
  let syncFrame = 0;
  let listening = false;
  let retired = false;
  const syncOffset = () => {
    syncFrame = 0;
    if (!isCurrent() || !sourceRect) return;
    const target = document.querySelector<HTMLElement>(PAGE_SELECTOR);
    if (!target) return;
    root.style.setProperty(
      SNAPSHOT_PROPERTIES.offset,
      `${target.getBoundingClientRect().top - sourceRect.top}px`,
    );
  };
  const onScroll = () => {
    if (syncFrame === 0) syncFrame = requestAnimationFrame(syncOffset);
  };
  const retire = () => {
    if (retired) return;
    retired = true;
    if (syncFrame !== 0) cancelAnimationFrame(syncFrame);
    syncFrame = 0;
    if (listening) window.removeEventListener("scroll", onScroll);
    listening = false;
    onSettle();
    if (!isCurrent()) return;
    // The snapshot tree can outlive `finished` by a compositor frame. Dropping the pinned
    // geometry or the transition name in that frame snaps the old capture back to the
    // unscrolled page top, so retire the capture only after two settled frames.
    // 快照树可能比 finished 多存活一个合成帧。在该帧移除固定几何或过渡名会把旧快照弹回
    // 未滚动页顶，因此等两个稳定帧后再回收截取。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!isCurrent()) return;
        root.removeAttribute(viewTransitionAttribute);
        root.removeAttribute(CAPTURE_ATTRIBUTE);
        for (const property of Object.values(SNAPSHOT_PROPERTIES))
          root.style.removeProperty(property);
      });
    });
  };
  if (sourceRect) {
    root.setAttribute(CAPTURE_ATTRIBUTE, "");
    root.style.setProperty(SNAPSHOT_PROPERTIES.top, `${sourceRect.top}px`);
    root.style.setProperty(SNAPSHOT_PROPERTIES.width, `${sourceRect.width}px`);
    root.style.setProperty(SNAPSHOT_PROPERTIES.height, `${sourceRect.height}px`);
    root.style.setProperty(SNAPSHOT_PROPERTIES.offset, "0px");
    // The header settles from its floating to its expanded height after the route commits;
    // follow the live page top so the incoming snapshot never jumps when the capture ends.
    // 路由提交后页头会从悬浮高度回到展开高度；跟随实时页顶，使快照结束时不会突然跳动。
    void transition.ready.then(
      () => {
        if (!isCurrent()) return;
        syncOffset();
        window.addEventListener("scroll", onScroll, { passive: true });
        listening = true;
      },
      () => undefined,
    );
  }
  // A canceled capture can reject ready while its route update never finishes.
  // 已取消的快照可能使 ready 失败，而路由更新始终无法结束。
  void transition.ready.catch(retire);
  void transition.finished.then(retire, retire);
}

// Nuxt owns the route choreography; the shared attribute hands the capture the shared spatial
// timing instead of the user agent's own crossfade. Only the newest capture removes it, so an
// interrupted navigation cannot strip the marker from the one still on screen.
// 路由编排由 Nuxt 负责，共享属性让快照采用共享空间节奏而不是浏览器默认交叉淡化。只有最新的
// 快照负责移除标记，被中断的导航不会连带清掉仍在播放的那一次。
export default defineNuxtPlugin((nuxtApp) => {
  let active: ViewTransition | undefined;
  let currentNavigation: RouteLocationNormalized | undefined;
  let lastRouteChange: { from: string; at: number } | undefined;
  let captureSequence = 0;
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
    const sequence = ++captureSequence;
    document.documentElement.setAttribute(viewTransitionAttribute, "");
    keepRouteSnapshotsStill(
      transition,
      () => sequence === captureSequence,
      () => {
        if (active === transition) active = undefined;
      },
    );
  });
});
