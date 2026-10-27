<script setup lang="ts">
const { t } = useSiteLocale();

import { SITE } from "~/config/site";
</script>

<template>
  <footer class="site-footer page-container">
    <div>
      <p class="site-footer__brand">
        {{ SITE.brand.acronym }} <span>·</span> {{ t("brand.name") }}
      </p>
      <p>{{ t("footer.tagline") }}</p>
    </div>
    <div class="site-footer__meta">
      <span>{{ SITE.brand.name }}</span>
      <span>{{ t("footer.community") }}</span>
    </div>
  </footer>
</template>
