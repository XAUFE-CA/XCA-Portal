<script setup lang="ts">
import { UiContextMenu, UiSurface } from "@neoverse-ui/vue";
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
  <!-- A viewport status must leave the region's glass stacking context, and a
       pointer-transparent surface has to declare itself topmost for the shared edge canvas.
       视口提示必须离开区域的玻璃层叠上下文；不吃指针事件的表面须向共享边缘画布声明最上层。 -->
  <Teleport to="body">
    <Transition name="xca-context-menu-status">
      <UiSurface
        v-if="props.menu.status.value"
        as="p"
        surface="glass-immersive"
        class="xca-context-menu-status"
        data-neoverse-glass-occluder="topmost"
        role="status"
      >
        {{ props.menu.status.value }}
      </UiSurface>
    </Transition>
  </Teleport>
</template>
