<script setup lang="ts">
import { motionRoles, prefersReducedMotion } from "@neoverse-ui/motion";
import { UiControlSurface, UiSegmentedControl } from "@neoverse-ui/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { SITE } from "~/config/site";
import { locales } from "~/i18n";

const props = defineProps<{ labelled?: boolean }>();
const { locale, t, setLocale } = useSiteLocale();
const { theme, setTheme } = useSiteTheme();
const controls = ref<HTMLElement>();
const animations = new Map<HTMLElement, Animation>();
let measurements: { element: HTMLElement; width: string }[] = [];
let reducedMotion: MediaQueryList | undefined;

function cancelResizing() {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
}
const resizeSource = () => [locale.value, theme.value] as const;
// A pre-flush watcher measures the visible width before the label swap, and a post-flush
// watcher animates from it. Watching the source directly keeps the transition independent
// of whether the parent re-renders the header, which update callbacks depend on.
// 前置侦听在标签替换前测量可见宽度，后置侦听据此播放动画。直接侦听来源，
// 使过渡不依赖父级是否重渲染顶栏，而更新回调恰恰依赖这一点。
watch(
  resizeSource,
  () => {
    measurements = [
      ...(controls.value?.querySelectorAll<HTMLElement>(
        ".site-preference-group > [data-surface]",
      ) ?? []),
    ].map((element) => ({ element, width: getComputedStyle(element).width }));
    cancelResizing();
  },
  { flush: "pre" },
);
watch(
  resizeSource,
  () => {
    if (prefersReducedMotion()) return;
    for (const { element, width } of measurements) {
      if (typeof element.animate !== "function") continue;
      const style = getComputedStyle(element);
      const target = style.width;
      if (Math.abs(Number.parseFloat(target) - Number.parseFloat(width)) < 0.5) continue;
      const duration = style.getPropertyValue(motionRoles.spatial.duration).trim();
      const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) continue;
      const animation = element.animate([{ width }, { width: target }], {
        duration: milliseconds,
        easing: style.getPropertyValue(motionRoles.spatial.easing).trim(),
        fill: "both",
      });
      animations.set(element, animation);
      const finish = () => {
        if (animations.get(element) !== animation) return;
        animations.delete(element);
        animation.cancel();
      };
      void animation.finished.then(finish, finish);
    }
  },
  { flush: "post" },
);
onMounted(() => {
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.addEventListener("change", cancelResizing);
  window.addEventListener("resize", cancelResizing);
});
onBeforeUnmount(() => {
  cancelResizing();
  reducedMotion?.removeEventListener("change", cancelResizing);
  window.removeEventListener("resize", cancelResizing);
});
const themeOptions = computed(() =>
  SITE.themes.map((value) => ({ value, label: t(`theme.${value}`) })),
);
const localeOptions = computed(() =>
  locales.map((value) => ({ value, label: t(`locale.${value}`) })),
);
function selectTheme(value: string) {
  if (value === "light" || value === "dark" || value === "system") setTheme(value);
}
</script>

<template>
  <div ref="controls" class="site-controls">
    <div class="site-preference-group">
      <p v-if="props.labelled" class="site-preference-label">{{ t("locale.label") }}</p>
      <UiControlSurface edge-mode="local">
        <UiSegmentedControl
          surface="none"
          :options="localeOptions"
          :model-value="locale"
          :aria-label="t('locale.label')"
          @update:model-value="setLocale"
        />
      </UiControlSurface>
    </div>
    <div class="site-preference-group">
      <p v-if="props.labelled" class="site-preference-label">{{ t("theme.label") }}</p>
      <UiControlSurface edge-mode="local">
        <UiSegmentedControl
          surface="none"
          :options="themeOptions"
          class="site-theme-control"
          :model-value="theme"
          :aria-label="t('theme.label')"
          @update:model-value="selectTheme"
        />
      </UiControlSurface>
    </div>
  </div>
</template>
