<script setup lang="ts">
import { UiCard, UiSkeleton } from "@neoverse-ui/vue";
import type { AboutCollectionItem } from "@nuxt/content";
import { computed, reactive, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ page: AboutCollectionItem | null; pending?: boolean; errorText?: string }>(),
  { pending: false, errorText: "" },
);
const { t } = useSiteLocale();
const loading = computed(() => props.pending || !props.page);
const banner = ref<HTMLElement>();
const settledBanners = reactive(new Set<string>());

function hideLeavingLayer(element: Element) {
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
}

function settleBanner(image: HTMLImageElement) {
  const source = image.getAttribute("src");
  if (source) settledBanners.add(source);
}

function handleBannerSettled(event: Event) {
  if (event.currentTarget instanceof HTMLImageElement) settleBanner(event.currentTarget);
}

// Cached images may finish before hydration or mount after lazy content resolves.
// 缓存图片可能在水合前完成，也可能随懒加载正文挂载。
watch(
  banner,
  (element) => {
    for (const image of element?.querySelectorAll("img") ?? []) {
      if (image.complete) settleBanner(image);
    }
  },
  { flush: "post" },
);

// Blocks mirror the real card: full-width sections with one two-column topic block.
// 区块对应真实卡片：通栏章节加一组双栏主题。
const skeletonBlocks = [
  { type: "wide", lines: [88, 64] },
  { type: "wide", lines: [72] },
  {
    type: "columns",
    left: [90, 64],
    right: [84, 60],
  },
  { type: "wide", lines: [80, 56] },
  { type: "actions" },
] as const;
</script>

<template>
  <div v-if="errorText" class="about-page page-container" role="alert">
    <p>{{ errorText }}</p>
  </div>
  <div v-else class="about-page page-container">
    <UiCard
      as="article"
      surface="glass-elevated"
      class="about-card"
      :aria-label="page?.title ?? t('about.loading')"
      :aria-busy="loading"
    >
      <div class="about-card__stage">
        <Transition name="about-reveal" @before-leave="hideLeavingLayer">
          <div v-if="page && !loading" key="content" class="about-card__layer">
            <div ref="banner" class="about-card__banner">
              <img
                class="about-card__banner-light"
                :src="page.banner.light"
                :alt="page.banner.alt"
                :width="page.banner.width"
                :height="page.banner.height"
                loading="lazy"
                decoding="async"
                @load="handleBannerSettled"
                @error="handleBannerSettled"
              >
              <img
                class="about-card__banner-dark"
                :src="page.banner.dark"
                :alt="page.banner.alt"
                :width="page.banner.width"
                :height="page.banner.height"
                loading="lazy"
                decoding="async"
                @load="handleBannerSettled"
                @error="handleBannerSettled"
              >
              <Transition name="about-reveal">
                <UiSkeleton
                  v-if="!settledBanners.has(page.banner.light)"
                  variant="rect"
                  class="about-card__banner-skeleton about-card__banner-skeleton--light"
                  radius="var(--neoverse-radius-card)"
                />
              </Transition>
              <Transition name="about-reveal">
                <UiSkeleton
                  v-if="!settledBanners.has(page.banner.dark)"
                  variant="rect"
                  class="about-card__banner-skeleton about-card__banner-skeleton--dark"
                  radius="var(--neoverse-radius-card)"
                />
              </Transition>
            </div>
            <ContentRenderer :value="page" :prose="false" class="about-card__content" />
          </div>
          <div v-else key="skeleton" class="about-card__layer" aria-hidden="true" inert>
            <div class="about-card__banner">
              <UiSkeleton
                variant="rect"
                class="about-card__banner-skeleton"
                radius="var(--neoverse-radius-card)"
              />
            </div>
            <div class="about-card__content about-card__content--skeleton">
              <div
                v-for="(block, blockIndex) in skeletonBlocks"
                :key="blockIndex"
                class="about-card__skeleton-block"
                :class="`about-card__skeleton-block--${block.type}`"
              >
                <template v-if="block.type === 'wide'">
                  <!-- The first wide block stands in for the display heading. -->
                  <!-- 首个通栏区块替代展示级标题。 -->
                  <UiSkeleton
                    v-if="blockIndex === 0"
                    variant="rect"
                    height="var(--neoverse-font-size-xl)"
                    radius="var(--neoverse-radius-xs)"
                  />
                  <UiSkeleton v-else variant="title" />
                  <UiSkeleton
                    v-for="(width, lineIndex) in block.lines"
                    :key="lineIndex"
                    variant="text"
                    :style="{ width: `${width}%` }"
                  />
                </template>
                <template v-else-if="block.type === 'columns'">
                  <div class="about-card__skeleton-column">
                    <UiSkeleton variant="title" />
                    <UiSkeleton
                      v-for="(width, lineIndex) in block.left"
                      :key="lineIndex"
                      variant="text"
                      :style="{ width: `${width}%` }"
                    />
                  </div>
                  <div class="about-card__skeleton-column">
                    <UiSkeleton variant="title" />
                    <UiSkeleton
                      v-for="(width, lineIndex) in block.right"
                      :key="lineIndex"
                      variant="text"
                      :style="{ width: `${width}%` }"
                    />
                  </div>
                </template>
                <template v-else>
                  <UiSkeleton variant="rect" class="about-card__skeleton-action" />
                  <UiSkeleton variant="rect" class="about-card__skeleton-action" />
                </template>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.about-page {
  padding-block: var(--neoverse-space-10) var(--neoverse-space-16);
}
.about-card__stage {
  display: grid;
}
.about-card__layer {
  grid-area: 1 / 1;
  min-width: 0;
}
.about-reveal-enter-active,
.about-reveal-leave-active {
  transition: opacity var(--neoverse-motion-duration-expressive)
    var(--neoverse-motion-easing-linear);
}
.about-reveal-enter-from,
.about-reveal-leave-to {
  opacity: 0;
}
.about-reveal-leave-active {
  pointer-events: none;
}
.about-card__banner {
  position: relative;
  display: block;
}
.about-card__banner img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--neoverse-radius-card);
}
/* The loading skeleton mirrors the card geometry: a 3:1 banner plus the real
   block layout of full-width sections and one two-column topic block. */
/* 加载骨架沿用卡片几何：3:1 横幅加真实区块布局，通栏章节加一组双栏主题。 */
.about-card__banner-skeleton {
  height: auto;
  aspect-ratio: 3 / 1;
}
.about-card__banner-skeleton--light,
.about-card__banner-skeleton--dark {
  position: absolute;
  inset: 0;
  height: 100%;
  aspect-ratio: auto;
}
.about-card__banner > .about-card__banner-dark,
.about-card__banner > .about-card__banner-skeleton--dark,
:root[data-theme="dark"] .about-card__banner-light,
:root[data-theme="dark"] .about-card__banner-skeleton--light {
  display: none;
}
:root[data-theme="dark"] .about-card__banner-dark,
:root[data-theme="dark"] .about-card__banner-skeleton--dark {
  display: block;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-light,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-skeleton--light {
    display: none;
  }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-dark,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .about-card__banner-skeleton--dark {
    display: block;
  }
}
.about-card__skeleton-block {
  display: grid;
  align-content: start;
  gap: var(--neoverse-space-6);
  min-width: 0;
}
.about-card__skeleton-block--columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--neoverse-space-8) var(--neoverse-space-10);
}
.about-card__skeleton-block--actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--neoverse-space-3);
}
.about-card__skeleton-column {
  display: grid;
  align-content: start;
  gap: var(--neoverse-space-6);
  min-width: 0;
}
.about-card__skeleton-action {
  width: 9rem;
}
.about-card__content {
  --neoverse-typography-title-md-size: var(--neoverse-font-size-xl);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--neoverse-space-8) var(--neoverse-space-10);
  padding: clamp(var(--neoverse-space-4), 4vw, var(--neoverse-space-12));
}
.about-card__content--skeleton {
  row-gap: var(--neoverse-space-12);
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
  .about-card__skeleton-block--columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 38rem) {
  .about-page {
    padding-block: var(--neoverse-space-5) var(--neoverse-space-10);
  }
}
@media (prefers-reduced-motion: reduce) {
  .about-reveal-enter-active,
  .about-reveal-leave-active {
    transition: none;
  }
}
</style>
