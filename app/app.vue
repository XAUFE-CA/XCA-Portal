<script setup lang="ts">
const { locale, t } = useSiteLocale();
const { theme } = useSiteTheme();
// Only register the initial theme here; interactive changes apply inside the view transition.
// 此处仅注册首屏主题，交互切换由视图过渡内部应用。
if (import.meta.server) useHead({ htmlAttrs: { "data-theme": theme.value } });
useHead(() => ({ htmlAttrs: { lang: locale.value }, title: t("home.title") }));
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
