<script setup lang="ts">
import { UiButton, UiIconButton } from "@neoverse-ui/vue";
import { computed, onMounted, ref } from "vue";
import SiteIcon from "~/components/site/SiteIcon.vue";
import { detectTerminalPlatform, type TerminalPlatform } from "../presentation/terminal-platform";

const props = defineProps<{
  user: string;
  host: string;
  directory: string;
  intro: boolean;
  introStage: string;
  expanded: boolean;
}>();
const emit = defineEmits<{ skip: []; expand: [] }>();
const { t } = useSiteLocale();
const platform = ref<TerminalPlatform>("other");
const skipVisible = computed(
  () => props.intro && props.introStage !== "logo" && props.introStage !== "handoff",
);
onMounted(() => {
  platform.value = detectTerminalPlatform(navigator);
});
</script>

<template>
  <div class="xca-terminal-chrome" :data-platform="platform">
    <span v-if="platform === 'macos'" class="xca-terminal-chrome__lights" aria-hidden="true">
      <span class="xca-terminal-chrome__light--close" />
      <span class="xca-terminal-chrome__light--minimize" />
      <span class="xca-terminal-chrome__light--zoom" />
    </span>
    <span class="xca-terminal-chrome__title" :title="`${user}@${host} — ${directory}`">
      <SiteIcon v-if="platform !== 'macos'" name="terminal" class="xca-terminal-chrome__symbol" />
      <span class="xca-terminal-chrome__session">{{ user }}@{{ host }}</span>
      <span class="xca-terminal-chrome__directory">{{ directory }}</span>
    </span>
    <span class="xca-terminal-chrome__actions xca-terminal-chrome-swap">
      <span
        class="xca-terminal-chrome-swap__layer"
        :data-active="skipVisible"
        :aria-hidden="!skipVisible || undefined"
        :inert="!skipVisible"
      >
        <UiButton
          variant="ghost"
          size="sm"
          :aria-label="t('terminal.skipLabel')"
          :tabindex="skipVisible ? undefined : -1"
          @click="skipVisible && emit('skip')"
          >{{
            t("terminal.skip")
          }}</UiButton
        >
      </span>
      <span
        class="xca-terminal-chrome-swap__layer"
        :data-active="!intro"
        :aria-hidden="intro || undefined"
        :inert="intro"
      >
        <UiIconButton
          variant="ghost"
          size="sm"
          :label="expanded ? t('terminal.restoreLabel') : t('terminal.expandLabel')"
          :title="expanded ? t('terminal.restoreLabel') : t('terminal.expandLabel')"
          :aria-expanded="expanded"
          :tabindex="intro ? -1 : undefined"
          @click="!intro && emit('expand')"
        >
          <SiteIcon :name="expanded ? 'restore' : 'expand'" />
        </UiIconButton>
      </span>
    </span>
  </div>
</template>

<style scoped>
.xca-terminal-chrome {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--neoverse-space-4);
  flex: 1;
  min-width: 0;
  min-height: var(--neoverse-button-height-sm);
  font-size: var(--neoverse-typography-caption-size);
  color: var(--neoverse-color-text-secondary);
}
.xca-terminal-chrome__title {
  display: flex;
  align-items: center;
  gap: var(--neoverse-space-3);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.xca-terminal-chrome__symbol {
  flex-shrink: 0;
  width: var(--neoverse-icon-size-sm);
  height: var(--neoverse-icon-size-sm);
}
.xca-terminal-chrome__session {
  color: var(--neoverse-color-text-primary);
}
.xca-terminal-chrome__directory {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.xca-terminal-chrome__actions {
  display: grid;
  align-items: center;
  justify-self: end;
  min-height: var(--neoverse-button-height-sm);
}
.xca-terminal-chrome[data-platform="macos"] {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
}
.xca-terminal-chrome[data-platform="macos"] .xca-terminal-chrome__title {
  justify-self: center;
  max-width: 100%;
}
.xca-terminal-chrome__lights {
  display: flex;
  gap: var(--neoverse-space-2);
}
.xca-terminal-chrome__lights span {
  width: var(--neoverse-space-3);
  height: var(--neoverse-space-3);
  border-radius: var(--neoverse-radius-pill);
}
.xca-terminal-chrome__light--close {
  background: var(--neoverse-color-status-danger);
}
.xca-terminal-chrome__light--minimize {
  background: var(--neoverse-color-status-warning);
}
.xca-terminal-chrome__light--zoom {
  background: var(--neoverse-color-status-success);
}
</style>
