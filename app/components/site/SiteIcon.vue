<script setup lang="ts">
import type { IconInput } from "morphicons";
import { MorphIcon } from "morphicons/vue";

const icons = {
  menu: [
    ["rect", { x: 3.5, y: 3.5, width: 6, height: 6, rx: 1.5 }],
    ["rect", { x: 14.5, y: 3.5, width: 6, height: 6, rx: 1.5 }],
    ["rect", { x: 3.5, y: 14.5, width: 6, height: 6, rx: 1.5 }],
    ["rect", { x: 14.5, y: 14.5, width: 6, height: 6, rx: 1.5 }],
  ],
  close: "M6 6l12 12M18 6 6 18",
  terminal: [
    ["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
    ["path", { d: "m7 9 3 3-3 3m6 0h4" }],
  ],
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  restore: "M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5",
  arrowUp: "M12 21V3M5 10l7-7 7 7",
} satisfies Record<string, IconInput>;

defineProps<{ name: keyof typeof icons }>();
</script>

<template>
  <MorphIcon
    :icon="icons[name]"
    :data-icon="name"
    spring="smooth"
    reduced-motion="user"
    :stroke-width="1.5"
    focusable="false"
  />
</template>
