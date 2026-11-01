<script setup lang="ts">
import { UiTerminalLine } from "@neoverse-ui/vue";
import { computed } from "vue";

const props = defineProps<{
  directory: string;
  columns: number;
  intro: boolean;
  introStage: string;
  running: boolean;
  application: boolean;
}>();
const { t } = useSiteLocale();
const details = computed(() => {
  if (!props.intro) return t(props.running ? "terminal.running" : "terminal.shortcuts");
  if (props.introStage === "boot") return t("terminal.boot");
  if (props.introStage === "brand") return t("terminal.welcomeLabel");
  return t("terminal.entering");
});
</script>

<template>
  <UiTerminalLine class="xca-terminal-statusbar" kind="status" tone="muted">
    <span class="xca-terminal-statusbar__context">
      <span>{{ t(application ? "terminal.tui" : "terminal.shell") }}</span>
      <span class="xca-terminal-statusbar__directory" :title="directory">{{ directory }}</span>
    </span>
    <span class="xca-terminal-statusbar__meta">
      <span v-if="!intro" class="xca-terminal-statusbar__columns">
        {{ columns }} {{ t("terminal.columns") }}
      </span>
      <span>{{ details }}</span>
    </span>
  </UiTerminalLine>
</template>

<style scoped>
.xca-terminal-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--neoverse-space-4);
  padding-top: var(--neoverse-space-2);
}
.xca-terminal-statusbar__context,
.xca-terminal-statusbar__meta {
  display: flex;
  align-items: center;
  gap: var(--neoverse-space-3);
  min-width: 0;
}
.xca-terminal-statusbar__context {
  flex: 1;
}
.xca-terminal-statusbar__directory {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xca-terminal-statusbar__meta {
  flex-shrink: 0;
  gap: var(--neoverse-space-4);
}
.xca-terminal-statusbar__columns {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (max-width: 38rem) {
  .xca-terminal-statusbar {
    align-items: stretch;
    flex-direction: column;
    gap: var(--neoverse-space-2);
  }
  .xca-terminal-statusbar__meta {
    justify-content: space-between;
  }
}
</style>
