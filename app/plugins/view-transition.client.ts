import { viewTransitionAttribute } from "@neoverse-ui/motion";
import type { RouteLocationNormalized } from "vue-router";

// A reversal inside the spatial transition's lifetime would replay the page just left as the
// incoming snapshot; the short post-settle window covers a tap that lands after the fade ends.
// 在空间过渡时长内反向导航会把刚离开的页面当作进入快照重放；落定后（快照结束起算）的短窗口
// 覆盖淡出刚结束时的点击。
const QUICK_REVERSAL_WINDOW_MS = 1000;
const PAGE_SELECTOR = ".site-main";
const CAPTURE_ATTRIBUTE = "data-xca-route-capture";
const GLASS_PAUSE_ATTRIBUTE = "data-xca-route-glass-pause";
const HEADER_RESIZE_TARGETS =
  ".site-header__brand, .site-navigation > [data-surface], .site-preference-group > [data-surface]";
let glassPauses = 0;

// Chrome can resample the live header glass as white while it captures the incoming route
// snapshot; an in-flight language width animation keeps the glass repainting and makes that
// frame likely. Pause only the backdrop sampling before that capture, then restore the live
// sample once the snapshot is painted. The shared fallback keeps the plane opaque meanwhile.
// Chrome 在截取进入路由快照时可能把实时页头玻璃重新采样为一帧白色；语言宽度动画进行中会持续
// 重绘玻璃，使这一帧更容易出现。只在该次截取开始前暂停背景采样，快照绘制完成后恢复实时采样；
// 暂停期间使用共享回退底面保持不透明。
function headerIsResizing(): boolean {
  return [...document.querySelectorAll<HTMLElement>(HEADER_RESIZE_TARGETS)].some((element) =>
    element
      .getAnimations()
      .some(
        (animation) =>
          typeof KeyframeEffect !== "undefined" &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.getKeyframes().some((frame) => "width" in frame),
      ),
  );
}

function pauseHeaderGlass(force = false): (() => void) | undefined {
  // The width animation may finish before the incoming capture; the resize it started is
  // still the trigger, so the caller decides whether the capture needs the opaque plane.
  // 宽度动画可能在进入截取前结束，但触发它的是同一次尺寸变化；由调用方决定该次截取
  // 是否需要不透明底面。
  if (!force && !headerIsResizing()) return undefined;
  const root = document.documentElement;
  glassPauses += 1;
  root.setAttribute(GLASS_PAUSE_ATTRIBUTE, "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    glassPauses = Math.max(glassPauses - 1, 0);
    if (glassPauses === 0) root.removeAttribute(GLASS_PAUSE_ATTRIBUTE);
  };
}

// Keep the opaque fallback through the frame that paints the incoming snapshot; sampling
// resumes immediately afterwards, and the navigation itself keeps the live glass.
// 暂停需覆盖进入快照绘制的那一帧；随后立即恢复采样，导航过程保持实时玻璃。
function resumeHeaderGlassAfterPaint(resume: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(resume));
}

function resumeHeaderGlassAfterCapture(transition: ViewTransition, resume: () => void): void {
  void transition.ready.then(() => resumeHeaderGlassAfterPaint(resume), resume);
  void transition.finished.then(resume, resume);
}
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
  let currentOrigin: string | undefined;
  let lastRouteChange: { from: string; at: number } | undefined;
  let captureSequence = 0;
  let captureNeedsGlass = false;
  const suppressed = new WeakSet<RouteLocationNormalized>();
  const router = useRouter();

  router.beforeEach((to, from) => {
    currentNavigation = to;
    currentOrigin = from.fullPath;
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
    if (!active && !quickReturn) {
      // Remember the resize that preceded the navigation; it may end before the incoming
      // capture, but it is still the reason that capture can resample the glass white.
      // 记下导航前正在进行的尺寸变化；它可能在进入截取前结束，但仍是该次截取可能把玻璃
      // 重新采样成白色的原因。
      captureNeedsGlass = headerIsResizing();
      return;
    }
    captureNeedsGlass = false;
    suppressed.add(to);
    active?.skipTransition();
  });

  router.afterEach((to, from, failure) => {
    if (failure) captureNeedsGlass = false;
    suppressed.delete(to);
    if (failure || from.matched.length === 0 || to.fullPath === from.fullPath) return;
    // Only settled client navigations set the reversal origin; a canceled one never arrived.
    // 只有落定的客户端导航记录反向起点；被取消的导航从未到达。
    lastRouteChange = { from: from.fullPath, at: performance.now() };
  });

  nuxtApp.hook("page:finish", () => {
    if (!captureNeedsGlass) return;
    captureNeedsGlass = false;
    // Resolve immediately before the incoming snapshot is taken, not after its promise
    // resolves: the capture has already happened by then.
    // 在进入快照截取前立即暂停，而不是等其 Promise 解析后：那时截取已经完成。
    const resume = pauseHeaderGlass(true);
    if (!resume) return;
    if (active) resumeHeaderGlassAfterCapture(active, resume);
    else resume();
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
    const origin = currentOrigin;
    document.documentElement.setAttribute(viewTransitionAttribute, "");
    // The reversal window starts where the fade ends, not at route commit: a slow renderer
    // commits seconds before the settled capture, and a tap right after the fade would
    // otherwise get the snapshot the window exists to prevent.
    // 反向窗口从淡出结束起算而非路由提交：慢速渲染器会早于落定快照数秒提交，淡出刚结束的
    // 点击否则会得到本应由窗口挡下的快照。
    void transition.finished.then(
      () => {
        if (sequence !== captureSequence) return;
        if (origin === undefined || lastRouteChange?.from !== origin) return;
        lastRouteChange = { from: origin, at: performance.now() };
      },
      () => undefined,
    );
    keepRouteSnapshotsStill(
      transition,
      () => sequence === captureSequence,
      () => {
        if (active === transition) active = undefined;
      },
    );
  });
});
