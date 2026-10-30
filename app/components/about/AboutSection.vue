<script setup lang="ts">
import { UiCard } from "@neoverse-ui/vue";
import type { AboutCollectionItem } from "@nuxt/content";

defineProps<{ page: AboutCollectionItem }>();
</script>

<template>
  <div class="about-page page-container">
    <UiCard as="article" surface="glass-elevated" class="about-card" :aria-label="page.title">
      <div class="about-card__banner">
        <img
          class="about-card__banner-light"
          :src="page.banner.light"
          :alt="page.banner.alt"
          :width="page.banner.width"
          :height="page.banner.height"
          loading="lazy"
          decoding="async"
        >
        <img
          class="about-card__banner-dark"
          :src="page.banner.dark"
          :alt="page.banner.alt"
          :width="page.banner.width"
          :height="page.banner.height"
          loading="lazy"
          decoding="async"
        >
      </div>
      <ContentRenderer :value="page" :prose="false" class="about-card__content" />
    </UiCard>
  </div>
</template>

<style scoped>
.about-page {
  padding-block: var(--neoverse-space-10) var(--neoverse-space-16);
}
.about-card__banner,
.about-card__banner img {
  display: block;
}
.about-card__banner img {
  width: 100%;
  height: auto;
  border-radius: var(--neoverse-radius-card);
}
.about-card__banner > .about-card__banner-dark,
:root[data-theme="dark"] .about-card__banner-light {
  display: none;
}
:root[data-theme="dark"] .about-card__banner-dark {
  display: block;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-light {
    display: none;
  }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-dark {
    display: block;
  }
}
.about-card__content {
  --neoverse-typography-title-md-size: var(--neoverse-font-size-xl);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--neoverse-space-8) var(--neoverse-space-10);
  padding: clamp(var(--neoverse-space-4), 4vw, var(--neoverse-space-12));
}
.about-card__content > :deep(*) {
  grid-column: 1 / -1;
  min-width: 0;
}
.about-card__content > :deep(.about-topic) {
  grid-column: auto;
}
.about-card__content :deep(section > :first-child) {
  margin-block-start: 0;
}
.about-card__content :deep(section > :last-child) {
  margin-block-end: 0;
}
.about-card__content :deep(.about-intro) {
  --neoverse-typography-title-lg-size: var(--neoverse-typography-display-md-size);
  --neoverse-typography-title-lg-weight: var(--neoverse-font-weight-display);
  --neoverse-typography-title-lg-letter-spacing: var(--neoverse-letter-spacing-tight);
  max-width: 72ch;
  font-size: var(--neoverse-typography-body-lg-size);
  line-height: var(--neoverse-line-height-relaxed);
}
.about-card__content :deep(.about-intro > h1) {
  margin-block: var(--neoverse-space-3) var(--neoverse-space-5);
}
.about-card__content :deep(.about-eyebrow) {
  color: var(--neoverse-color-accent-primary);
  font-size: var(--neoverse-font-size-sm);
  font-weight: var(--neoverse-font-weight-semibold);
  letter-spacing: var(--neoverse-letter-spacing-wide);
}
.about-card__content :deep(.about-values) {
  --neoverse-prose-strong-foreground: var(--neoverse-color-accent-primary);
  padding-block: var(--neoverse-space-6);
  border-block: var(--neoverse-border-width-thin) solid var(--neoverse-color-border-subtle);
}
.about-card__content :deep(.about-values strong) {
  font-size: var(--neoverse-font-size-2xl);
  line-height: var(--neoverse-line-height-snug);
}
.about-card__content :deep(.about-participate) {
  padding-top: var(--neoverse-space-6);
  border-top: var(--neoverse-border-width-thin) solid var(--neoverse-color-border-subtle);
}
.about-card__content :deep(.about-actions) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--neoverse-space-3);
}
.about-card__content :deep(.about-actions > p) {
  margin: 0;
}
@media (max-width: 48rem) {
  .about-card__content {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 38rem) {
  .about-page {
    padding-block: var(--neoverse-space-5) var(--neoverse-space-10);
  }
}
</style>
