<script setup lang="ts">
import { UiButton, UiIconButton } from "@neoverse-ui/vue";
import { onMounted, ref } from "vue";
import { detectTerminalPlatform, type TerminalPlatform } from "../presentation/terminal-platform";

defineProps<{
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
      <svg
        v-if="platform !== 'macos'"
        class="xca-terminal-chrome__symbol"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3m6 0h4" />
      </svg>
      <span class="xca-terminal-chrome__session">{{ user }}@{{ host }}</span>
      <span class="xca-terminal-chrome__directory">{{ directory }}</span>
    </span>
    <span class="xca-terminal-chrome__actions">
      <UiButton
        v-if="intro && introStage !== 'logo' && introStage !== 'handoff'"
        variant="ghost"
        size="sm"
        :aria-label="t('terminal.skipLabel')"
        @click="emit('skip')"
        >{{
          t("terminal.skip")
        }}</UiButton
      >
      <UiIconButton
        v-else-if="!intro"
        variant="ghost"
        size="sm"
        :label="expanded ? t('terminal.restoreLabel') : t('terminal.expandLabel')"
        :title="expanded ? t('terminal.restoreLabel') : t('terminal.expandLabel')"
        :aria-expanded="expanded"
        @click="emit('expand')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <g stroke-linejoin="round" stroke-linecap="round">
            <path v-if="expanded" d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5" />
            <path v-else d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
          </g>
        </svg>
      </UiIconButton>
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
  display: flex;
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
