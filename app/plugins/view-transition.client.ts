import { viewTransitionAttribute } from "@neoverse-ui/motion";

// Nuxt owns the route choreography; the shared attribute hands the capture the shared spatial
// timing instead of the user agent's own crossfade. Only the newest capture removes it, so an
// interrupted navigation cannot strip the marker from the one still on screen.
// 路由编排由 Nuxt 负责，共享属性让快照采用共享空间节奏而不是浏览器默认交叉淡化。只有最新的
// 快照负责移除标记，被中断的导航不会连带清掉仍在播放的那一次。
export default defineNuxtPlugin((nuxtApp) => {
  let active: ViewTransition | undefined;
  nuxtApp.hook("page:view-transition:start", (transition) => {
    active = transition;
    const root = document.documentElement;
    root.setAttribute(viewTransitionAttribute, "");
    const settle = () => {
      if (active !== transition) return;
      active = undefined;
      root.removeAttribute(viewTransitionAttribute);
    };
    void transition.finished.then(settle, settle);
  });
});
