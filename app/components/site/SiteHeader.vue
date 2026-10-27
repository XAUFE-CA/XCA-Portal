<script setup lang="ts">
import { UiPopover, UiSurface } from "@neoverse-ui/vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { tokenLength } from "~/utils/cssTokens";
import SiteHeaderNavigation from "./SiteHeaderNavigation.vue";
import SiteHeaderPreferences from "./SiteHeaderPreferences.vue";
import SiteLogo from "./SiteLogo.vue";

const route = useRoute();
const { t } = useSiteLocale();
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
    <UiSurface as="header" surface="glass-elevated" content-overflow="visible" class="site-header">
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
