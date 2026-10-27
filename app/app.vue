<script setup lang="ts">
const { locale, t } = useSiteLocale();
useHead(() => ({ htmlAttrs: { lang: locale.value }, title: t("home.title") }));
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
