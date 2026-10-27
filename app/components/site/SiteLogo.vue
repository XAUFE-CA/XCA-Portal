<script setup lang="ts">
const { t } = useSiteLocale();

import { SITE } from "~/config/site";
</script>

<template>
  <NuxtLink :to="SITE.routes.home" class="site-logo" :aria-label="t('brand.home')">
    <img class="site-logo__icon" :src="SITE.brand.mark" alt="">
    <span class="site-logo__mark" aria-hidden="true">{{ SITE.brand.acronym }}<span>.</span></span>
    <span class="site-logo__divider" aria-hidden="true" />
    <span class="site-logo__name">{{ t("brand.name") }}</span>
  </NuxtLink>
</template>
