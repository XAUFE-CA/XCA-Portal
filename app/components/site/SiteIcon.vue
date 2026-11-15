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
  sincerity: [
    ["path", { d: "M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Z" }],
    ["path", { d: "m9 11.5 2 2 4-4" }],
  ],
  inclusion: [
    ["path", { d: "M9 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" }],
    ["path", { d: "M15 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" }],
  ],
  harmony: [
    ["path", { d: "M12 3v18M5 6h14M8 21h8" }],
    ["path", { d: "M5 6 2 13a3 3 0 0 0 6 0L5 6Z" }],
    ["path", { d: "M19 6l3 7a3 3 0 0 1-6 0l3-7Z" }],
  ],
  passion:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z",
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
