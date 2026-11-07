<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { type FlameCanvas, mountFlameCanvas } from "../rendering/flame-canvas";

const props = defineProps<{ text: string }>();
const host = ref<HTMLParagraphElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const animated = ref(false);
let flame: FlameCanvas | null = null;
let motion: MediaQueryList | null = null;

function stop() {
  flame?.dispose();
  flame = null;
}

async function start() {
  await nextTick();
  if (!animated.value || !host.value || !canvas.value) return;
  flame = mountFlameCanvas(host.value, canvas.value);
}

function syncMotion() {
  animated.value = motion !== null && !motion.matches;
}

watch(animated, (enabled) => (enabled ? void start() : stop()));
// A new locale swaps the copy in place, which may keep the same box size.
// 切换语言会就地替换文案，盒子尺寸可能完全不变。
watch(
  () => props.text,
  async () => {
    await nextTick();
    flame?.remeasure();
  },
);

onMounted(() => {
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", syncMotion);
  syncMotion();
});
onBeforeUnmount(() => {
  motion?.removeEventListener("change", syncMotion);
  stop();
});
</script>

<template>
  <p ref="host" class="xca-tagline-flame">
    {{ text }}
    <canvas v-if="animated" ref="canvas" class="xca-tagline-flame__canvas" aria-hidden="true" />
  </p>
</template>

<style scoped>
.xca-tagline-flame {
  position: relative;
  isolation: isolate;
}
/* Give the flame a little headroom so rising embers are not cut off mid-air.
   火焰向上多留一点空间，避免上升的余烬在半空被裁断。 */
.xca-tagline-flame__canvas {
  position: absolute;
  top: calc(-1 * var(--neoverse-space-5));
  left: 0;
  width: 100%;
  height: calc(100% + var(--neoverse-space-5));
  pointer-events: none;
  z-index: 1;
}
</style>
