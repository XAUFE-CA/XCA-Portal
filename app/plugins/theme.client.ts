export default defineNuxtPlugin((nuxtApp) => {
  const { restoreTheme } = useSiteTheme();
  // Wait for suspended layouts to hydrate, then restore before the first interactive frame.
  // 等待异步布局完成水合，再在首个交互帧前恢复主题。
  nuxtApp.hooks.hookOnce("app:suspense:resolve", restoreTheme);
});
