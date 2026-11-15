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
        <span v-if="running" class="xca-terminal-statusbar__running">{{
          t("terminal.running")
        }}</span>
        <span v-else class="xca-terminal-statusbar__shortcuts">{{ t("terminal.shortcuts") }}</span>
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
  /* A touch screen has no Tab or arrow keys, so the footer drops that hint and keeps one row.
     触摸屏没有 Tab 与方向键，页脚因此去掉该提示并保持单行。 */
  .xca-terminal-statusbar__shortcuts {
    display: none;
  }
  /* The intro stage labels are redundant with the boot animation; dropping them frees the row
     for the context instead of shrinking it between two long strings.
     开场阶段标签与启动动画重复；在手机上去掉它们，让这一行留给上下文而不是在两条长文案之间被挤压。 */
  .xca-terminal-statusbar__meta
    > .xca-terminal-chrome-swap__layer:not(.xca-terminal-statusbar__ready) {
    display: none;
  }
  .xca-terminal-statusbar__context {
    overflow: hidden;
    white-space: nowrap;
  }
  .xca-terminal-statusbar__ready {
    justify-content: end;
    gap: var(--neoverse-space-2);
  }
}
@media (pointer: coarse) {
  /* Landscape phones keep the touch pointer, so the keyboard hint stays hidden at any width.
     横屏手机仍使用触摸指针，键盘提示在任何宽度下都保持隐藏。 */
  .xca-terminal-statusbar__shortcuts {
    display: none;
  }
}
</style>
