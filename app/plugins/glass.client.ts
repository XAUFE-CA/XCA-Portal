import { createGlassRenderer } from "@neoverse-ui/glass-runtime";

export default defineNuxtPlugin((nuxtApp) => {
  const renderer = createGlassRenderer();
  let disposed = false;
  const dispose = () => {
    disposed = true;
    renderer.destroy();
  };
  onNuxtReady(() => {
    // One shared edge renderer per document; the CSS material is the fallback.
    // 每个文档共用一个边缘渲染器；CSS 材质作为回退。
    if (!disposed) renderer.mount();
  });
  nuxtApp.vueApp.onUnmount(dispose);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  return { provide: { glassRenderer: renderer } };
});
