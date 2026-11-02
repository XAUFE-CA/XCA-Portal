<script setup lang="ts">
import { UiControlSurface, UiSegmentedControl } from "@neoverse-ui/vue";
import { computed } from "vue";
import { SITE } from "~/config/site";
import { locales } from "~/i18n";

const props = defineProps<{ labelled?: boolean }>();
const { locale, t, setLocale } = useSiteLocale();
const { theme, setTheme } = useSiteTheme();
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
  <div class="site-controls">
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
