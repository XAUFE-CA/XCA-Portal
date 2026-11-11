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
const introDetails = computed(() => {
  if (props.introStage === "boot") return "boot";
  if (props.introStage === "brand") return "brand";
  return "entering";
});
</script>

<template>
  <UiTerminalLine class="xca-terminal-statusbar" kind="status" tone="muted">
    <span class="xca-terminal-statusbar__context">
      <span>{{ t(application ? "terminal.tui" : "terminal.shell") }}</span>
      <span class="xca-terminal-statusbar__directory" :title="directory">{{ directory }}</span>
    </span>
    <span class="xca-terminal-statusbar__meta xca-terminal-chrome-swap">
      <span
        class="xca-terminal-chrome-swap__layer"
        :data-active="intro && introDetails === 'boot'"
        :aria-hidden="!intro || introDetails !== 'boot' || undefined"
        :inert="!intro || introDetails !== 'boot'"
        >{{
          t("terminal.boot")
        }}</span
      >
      <span
        class="xca-terminal-chrome-swap__layer"
        :data-active="intro && introDetails === 'brand'"
        :aria-hidden="!intro || introDetails !== 'brand' || undefined"
        :inert="!intro || introDetails !== 'brand'"
        >{{
          t("terminal.welcomeLabel")
        }}</span
      >
      <span
        class="xca-terminal-chrome-swap__layer"
        :data-active="intro && introDetails === 'entering'"
        :aria-hidden="!intro || introDetails !== 'entering' || undefined"
        :inert="!intro || introDetails !== 'entering'"
        >{{
          t("terminal.entering")
        }}</span
      >
      <span
        class="xca-terminal-statusbar__ready xca-terminal-chrome-swap__layer"
        :data-active="!intro"
        :aria-hidden="intro || undefined"
        :inert="intro"
      >
        <span class="xca-terminal-statusbar__columns">
          {{ columns }} {{ t("terminal.columns") }}
        </span>
        <span>{{ t(running ? "terminal.running" : "terminal.shortcuts") }}</span>
      </span>
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
.xca-terminal-statusbar__ready {
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
  display: grid;
  align-items: center;
  flex-shrink: 0;
}
.xca-terminal-statusbar__ready {
  justify-self: stretch;
  justify-content: end;
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
  .xca-terminal-statusbar__ready {
    justify-content: space-between;
  }
}
</style>
