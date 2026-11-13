<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { type FlameCanvas, mountFlameCanvas } from "../rendering/flame-canvas";

type TaglineLanguage = "en" | "zh-CN";

const props = defineProps<{
  texts: Readonly<Record<TaglineLanguage, string>>;
  hint: string;
}>();
const host = ref<HTMLParagraphElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const animated = ref(false);
// The quotation opens in English whatever the site language, and keeps its own choice after.
// 无论站点使用哪种语言，引语都先以英文出现，之后保留自己的选择。
const language = ref<TaglineLanguage>("en");
const text = computed(() => props.texts[language.value]);
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

function toggleLanguage() {
  language.value = language.value === "en" ? "zh-CN" : "en";
}

let pressOrigin: { x: number; y: number } | null = null;

function rememberPress(event: PointerEvent) {
  pressOrigin = { x: event.clientX, y: event.clientY };
}

// Dragging across the quotation selects it; only a pointer press that stays in place toggles the
// language. Keyboard activation reports no click count and always toggles.
// 在引语上拖动是选择文字；只有停在原地的指针按压才切换语言。键盘激活不带点击次数，始终切换。
function handleClick(event: MouseEvent) {
  const origin = pressOrigin;
  pressOrigin = null;
  if (
    event.detail > 0 &&
    origin &&
    Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4
  )
    return;
  toggleLanguage();
}

// Read the glyph boxes again once the arriving copy sits at its final position.
// 抵达的文案落到最终位置后重新读取字形盒子。
function remeasure() {
  void nextTick().then(() => flame?.remeasure());
}

watch(animated, (enabled) => (enabled ? void start() : stop()));

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
    <button
      class="xca-tagline-flame__toggle"
      type="button"
      :title="hint"
      @pointerdown="rememberPress"
      @click="handleClick"
    >
      <span class="xca-tagline-flame__live" aria-live="polite">
        <Transition name="tagline-voice" mode="out-in" @after-enter="remeasure">
          <span :key="language" class="xca-tagline-flame__quote" :lang="language">{{ text }}</span>
        </Transition>
      </span>
      <span
        class="xca-tagline-flame__ghost"
        data-tagline-ghost
        :data-text="texts.en"
        aria-hidden="true"
        lang="en"
      ></span>
    </button>
    <canvas v-if="animated" ref="canvas" class="xca-tagline-flame__canvas" aria-hidden="true" />
  </p>
</template>

<style scoped>
.xca-tagline-flame {
  position: relative;
  isolation: isolate;
}
/* Both copies share one grid cell, so the frame keeps the taller English height while the visible
   copy changes; the footer below never moves with the line count.
   两份文案共用同一个网格单元，框体始终保留更高的英文高度；可见文案切换时页脚下方不随行数移动。 */
.xca-tagline-flame__toggle {
  display: grid;
  /* A shorter copy is centred in the taller frame so it shares the credits' vertical middle.
     较短的文案在更高的框体内垂直居中，与左侧署名的中线对齐。 */
  align-items: center;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  white-space: inherit;
  cursor: pointer;
}
.xca-tagline-flame__live,
.xca-tagline-flame__ghost {
  grid-area: 1 / 1;
}
.xca-tagline-flame__quote {
  display: block;
}
/* The ghost only sizes the cell; it is invisible, untouchable and absent from the accessibility tree.
   Its copy comes from an attribute so the paragraph's text content stays single-language.
   幽灵文案只负责撑起单元尺寸；不可见、不可操作，也不进入无障碍树。文案来自属性，
   使段落的文本内容始终只有当前语言。 */
.xca-tagline-flame__ghost {
  visibility: hidden;
  pointer-events: none;
  user-select: none;
}
.xca-tagline-flame__ghost::before {
  content: attr(data-text);
}
/* The departing copy loses focus and thins away while the arriving copy comes back from the same
   blur, so the change reads as one focus pull instead of a plain fade.
   离场文案失焦变淡，抵达文案从同一层模糊中回到清晰，使变化读作一次对焦拉动而不是单纯的淡出。 */
/* The copy loses focus and thins away, then the arriving copy comes back from the same blur, so the
   change reads as one focus pull instead of a plain fade.
   旧文案先失焦散开，新文案从同一层模糊中回焦，使变化读作一次对焦拉动而不是单纯的淡出。 */
@media (prefers-reduced-motion: no-preference) {
  .tagline-voice-leave-active {
    animation: tagline-voice-away var(--neoverse-motion-duration-fast)
      var(--neoverse-motion-easing-linear) both;
  }
  .tagline-voice-enter-active {
    animation: tagline-voice-arrive var(--neoverse-motion-duration-standard)
      var(--neoverse-motion-easing-symmetric) both;
  }
}
@keyframes tagline-voice-away {
  0% {
    opacity: 1;
    filter: blur(0);
  }
  100% {
    opacity: 0;
    filter: blur(0.42em);
  }
}
/* The arriving copy enters already blurred and partly lit, so the frame never goes empty.
   抵达文案带着模糊与部分亮度入场，框体因此不会出现空帧。 */
@keyframes tagline-voice-arrive {
  0% {
    opacity: 0.35;
    filter: blur(0.42em);
  }
  100% {
    opacity: 1;
    filter: blur(0);
  }
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
