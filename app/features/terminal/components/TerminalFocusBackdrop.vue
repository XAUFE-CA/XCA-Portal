<script setup lang="ts">
defineProps<{ expanded: boolean; shadeActive: boolean }>();
defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div
    class="xca-terminal-hero__focus-backdrop"
    :class="{ 'xca-terminal-hero__focus-backdrop--active': expanded }"
    aria-hidden="true"
    @click="$emit('dismiss')"
  />
  <div
    class="xca-terminal-focus-shade"
    :class="{ 'xca-terminal-focus-shade--active': shadeActive }"
    aria-hidden="true"
  />
</template>

<style scoped>
.xca-terminal-hero__focus-backdrop,
.xca-terminal-focus-shade {
  position: fixed;
  inset: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.xca-terminal-hero__focus-backdrop {
  z-index: 0;
  backdrop-filter: var(--neoverse-material-glass-subtle-filter);
  transition:
    opacity var(--neoverse-motion-duration-standard) var(--neoverse-motion-easing-standard),
    visibility var(--neoverse-motion-duration-standard);
}
.xca-terminal-hero__focus-backdrop--active {
  pointer-events: auto;
}
.xca-terminal-focus-shade {
  /* Paint above the terminal so its Aurora Glass never samples the darkening layer.
     绘制在终端之上，使极光玻璃不会采样到变暗遮罩。 */
  z-index: 2;
  inset: var(--xca-terminal-expanded-inset);
  border-radius: var(--neoverse-radius-card);
  box-shadow: 0 0 0 100vmax var(--neoverse-color-overlay-scrim);
}
.xca-terminal-hero__focus-backdrop--active {
  opacity: 1;
  visibility: visible;
}
.xca-terminal-focus-shade--active {
  visibility: visible;
}
@media (prefers-reduced-motion: reduce) {
  .xca-terminal-hero__focus-backdrop {
    transition: none;
  }
}
</style>
