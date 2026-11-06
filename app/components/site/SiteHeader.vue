<script setup lang="ts">
import { UiPopover, UiSurface, useLayoutWidthMotion } from "@neoverse-ui/vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { tokenLength } from "~/utils/cssTokens";
import SiteHeaderNavigation from "./SiteHeaderNavigation.vue";
import SiteHeaderPreferences from "./SiteHeaderPreferences.vue";
import SiteLogo from "./SiteLogo.vue";

const route = useRoute();
const { locale, t } = useSiteLocale();
const { theme } = useSiteTheme();
const compactHeader = ref(false);
const compactNavigation = ref(false);
let headerQuery: MediaQueryList | undefined;
let navigationQuery: MediaQueryList | undefined;
function updateResponsiveLayout() {
  compactHeader.value = headerQuery?.matches ?? false;
  compactNavigation.value = navigationQuery?.matches ?? false;
  mobileMenuOpen.value = false;
}
const floating = ref(false);
const mobileMenuOpen = ref(false);
const headerWrap = ref<HTMLElement | null>(null);
// Measure every grid contributor together so one resizing group cannot push
// the navigation past its destination before the other groups catch up.
// 同时测量所有网格占宽区域，避免某组先变宽，把导航推过终点后再由其他组拉回。
useLayoutWidthMotion({
  root: headerWrap,
  targets:
    ".site-header__brand, .site-navigation > [data-surface], .site-preference-group > [data-surface]",
  trigger: () => [locale.value, theme.value],
});
watch(
  () => route.path,
  () => {
    mobileMenuOpen.value = false;
  },
);
let headerObserver: ResizeObserver | undefined;
let threshold = 0;
let scrollFrame = 0;
function updatePosition() {
  floating.value = window.scrollY > threshold;
}
function onScroll() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(updatePosition);
}
onMounted(() => {
  headerQuery = window.matchMedia("(max-width: 70rem)");
  navigationQuery = window.matchMedia("(max-width: 38rem)");
  updateResponsiveLayout();
  headerQuery.addEventListener("change", updateResponsiveLayout);
  navigationQuery.addEventListener("change", updateResponsiveLayout);
  if (headerWrap.value) {
    headerObserver = new ResizeObserver(() => {
      if (headerWrap.value)
        document.documentElement.style.setProperty(
          "--xca-site-header-height",
          `${headerWrap.value.offsetHeight}px`,
        );
    });
    headerObserver.observe(headerWrap.value);
  }
  threshold = tokenLength(document.documentElement, "--neoverse-space-4");
  updatePosition();
  window.addEventListener("scroll", onScroll, { passive: true });
});
onBeforeUnmount(() => {
  headerQuery?.removeEventListener("change", updateResponsiveLayout);
  navigationQuery?.removeEventListener("change", updateResponsiveLayout);
  headerObserver?.disconnect();
  document.documentElement.style.removeProperty("--xca-site-header-height");
  window.removeEventListener("scroll", onScroll);
  cancelAnimationFrame(scrollFrame);
});
</script>

<template>
  <div
    ref="headerWrap"
    class="site-header-wrap"
    :class="{ 'site-header-wrap--floating': floating }"
  >
    <a class="skip-link" href="#main-content">{{ t("nav.skip") }}</a>
    <!-- Fallback popovers stay inside this layout surface instead of the native top layer.
         回退弹层保留在此布局层内，而非原生顶层。 -->
    <!-- The bar is anchored to the window, so it asks the shared UI for the painted
         stroke that refraction cannot supply without backdrop light.
         顶栏贴着窗口，折射在背后没有内容时无法成边，因此启用共享 UI 的绘制描边。 -->
    <UiSurface
      as="header"
      surface="glass-elevated"
      content-overflow="visible"
      class="site-header"
      data-neoverse-glass-edge-stroke
    >
      <div class="site-header__brand">
        <SiteLogo />
      </div>

      <SiteHeaderNavigation v-if="!compactNavigation" />
      <UiPopover
        v-if="compactHeader"
        v-model:open="mobileMenuOpen"
        class="site-menu"
        placement="bottom-end"
        :aria-label="t('nav.menu')"
        trigger-variant="ghost"
      >
        <template #trigger>
          <span class="site-menu-trigger">
            <svg
              class="site-menu-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="3.5" y="3.5" width="6" height="6" rx="1.5" />
              <rect x="14.5" y="3.5" width="6" height="6" rx="1.5" />
              <rect x="3.5" y="14.5" width="6" height="6" rx="1.5" />
              <rect x="14.5" y="14.5" width="6" height="6" rx="1.5" />
            </svg>
            {{ t("nav.menu") }}
          </span>
        </template>
        <div class="site-menu-content">
          <SiteHeaderNavigation
            v-if="compactNavigation"
            class="site-menu-navigation"
            @navigate="mobileMenuOpen = false"
          />
          <SiteHeaderPreferences class="site-menu-preferences" labelled />
        </div>
      </UiPopover>
      <SiteHeaderPreferences v-else />
    </UiSurface>
  </div>
</template>
