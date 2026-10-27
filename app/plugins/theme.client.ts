export default defineNuxtPlugin(() => {
  const { restoreTheme } = useSiteTheme();
  onNuxtReady(restoreTheme);
});
