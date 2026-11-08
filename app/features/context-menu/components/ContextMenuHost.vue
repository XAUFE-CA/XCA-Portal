<script setup lang="ts">
import { UiContextMenu } from "@neoverse-ui/vue";
import type { ContextMenuState } from "../presentation/useContextMenu";

// The region owns the state; this shell only renders it, so two mounts cannot
// diverge into separate open flags for the same panel.
// 状态由区域持有，此壳只负责渲染，因此两处挂载不会各自维护同一面板的打开标志。
const props = defineProps<{ menu: ContextMenuState }>();
</script>

<template>
  <UiContextMenu
    v-bind="{ ariaLabel: props.menu.label.value }"
    :open="props.menu.isOpen.value"
    :point="props.menu.point.value"
    :auto-focus="props.menu.autoFocus.value"
    :focus-return="props.menu.focusReturn.value ?? undefined"
    :entries="props.menu.entries.value"
    class="xca-context-menu"
    @update:open="props.menu.isOpen.value = $event"
    @select="props.menu.select($event.id)"
  />
  <p
    v-if="props.menu.status.value"
    class="xca-context-menu-status"
    role="status"
    :style="{
      '--xca-context-menu-x': `${props.menu.point.value.x}px`,
      '--xca-context-menu-y': `${props.menu.point.value.y}px`,
    }"
  >
    {{ props.menu.status.value }}
  </p>
</template>
