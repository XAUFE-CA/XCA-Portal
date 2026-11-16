<script setup lang="ts">
import { UiSurface } from "@neoverse-ui/vue";

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ skip: [] }>();
const { t } = useSiteLocale();
</script>

<template>
  <!-- A viewport hint must leave the hero's glass stacking context, and a surface over the scene
       has to declare itself topmost for the shared edge canvas.
       视口提示必须离开首页的玻璃层叠上下文。覆盖场景的表面须向共享边缘画布声明最上层。 -->
  <Teleport to="body">
    <Transition name="xca-intro-skip-hint">
      <div v-if="visible" class="xca-intro-skip-hint">
        <UiSurface
          as="p"
          surface="glass-immersive"
          class="xca-intro-skip-hint__keys"
          data-neoverse-glass-occluder="topmost"
          role="status"
        >
          {{ t("intro.skipHint") }}
        </UiSurface>
        <UiSurface
          as="button"
          type="button"
          surface="glass-immersive"
          class="xca-intro-skip-hint__tap"
          data-neoverse-glass-occluder="topmost"
          @click="emit('skip')"
        >
          {{ t("intro.skipTap") }}
        </UiSurface>
      </div>
    </Transition>
  </Teleport>
</template>
