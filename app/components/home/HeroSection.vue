<script setup lang="ts">
import type { VNodeRef } from "vue";
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import heroSentences from "~/data/hero-sentences.json";
import {
  CaIntroMark,
  HERO_TYPING,
  INTRO_READING_UNIT_MS,
  useIntroPresentation,
} from "~/features/intro";
import { useTerminalSession } from "~/features/terminal/client-session";
import TerminalFocusBackdrop from "~/features/terminal/components/TerminalFocusBackdrop.vue";
import TerminalHost from "~/features/terminal/components/TerminalHost.vue";
import type { TerminalServices } from "~/features/terminal/core/types";
import { parseHeroTitle } from "./hero-title";
import { useTitleCursor } from "./useTitleCursor";

const { locale, t } = useSiteLocale();
const sentences = computed(() =>
  heroSentences[locale.value].map((sentence) => sentence.trim()).filter(Boolean),
);
// Each visit, locale change and intro replay starts with the welcome line.
// 每次访问、语言切换与开场重放都从欢迎语开始。
const title = ref(sentences.value[0] ?? "");
// Accent spans come from the sentence markup, never from its punctuation.
// 强调范围来自语句标注，与标点位置无关。
const parsedTitle = computed(() => parseHeroTitle(title.value));
const titleText = computed(() => parsedTitle.value.text);
const titleLetters = computed(() => parsedTitle.value.letters);
const titleLength = computed(() => titleLetters.value.length);
const sentenceTexts = computed(() =>
  sentences.value.map((sentence) => parseHeroTitle(sentence).text),
);
// Keep the complete heading in SSR; animation starts after the intro reveals it.
// SSR 保留完整标题。动画在开场显示后才开始。
const visibleLetters = ref(titleLength.value);
const titleElement = ref<HTMLElement | null>(null);
useTitleCursor(titleElement, title, visibleLetters);
const titlePaused = ref(true);
// Do not keep drawing attention away from the terminal once the visitor uses it.
// 访客一旦使用终端，就不再让标题持续抢走注意力。
const terminalEngaged = ref(false);
const titleSettled = computed(
  () => terminalEngaged.value && visibleLetters.value === titleLength.value,
);
let typingTimer: ReturnType<typeof setTimeout> | undefined;
let motionPreference: MediaQueryList | undefined;
let stopTitleWatch: (() => void) | undefined;

function stopTyping() {
  clearTimeout(typingTimer);
  typingTimer = undefined;
}
function engageTerminal() {
  if (terminalEngaged.value || phase.value !== "ready") return;
  terminalEngaged.value = true;
  if (titleSettled.value) {
    // A fully printed line needs no more animation or blinking cursor.
    // 已完整打出的整行无需更多动画或闪烁光标。
    stopTyping();
    titlePaused.value = true;
  } else if (typingTimer === undefined) {
    // Keep the existing line and finish it character by character.
    // 保留现有整行并逐字补完。
    typingTimer = setTimeout(typeNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.letter);
  }
}
function resumeTitleOutsideTerminal(event: PointerEvent) {
  if (
    !terminalEngaged.value ||
    phase.value !== "ready" ||
    (event.target instanceof Node && anchor.value?.contains(event.target))
  )
    return;
  terminalEngaged.value = false;
  if (motionPreference?.matches) return;

  if (visibleLetters.value === titleLength.value) {
    // Resume with the normal reading pause, not an abrupt deletion.
    // 以正常阅读停顿恢复，而非突然删除。
    stopTyping();
    titlePaused.value = true;
    typingTimer = setTimeout(deleteNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.hold);
  } else if (typingTimer === undefined) {
    // An unfinished line already has a timer; do not create a second one.
    // 未完成的整行已有定时器，不再创建第二个。
    typingTimer = setTimeout(typeNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.letter);
  }
}
function onTerminalKeydown(event: KeyboardEvent) {
  // Escape skips the intro and Tab traverses the UI; neither signals interest.
  // Escape 跳过开场，Tab 切换界面焦点。两者都不算开始使用终端。
  if (event.key !== "Escape" && event.key !== "Tab") engageTerminal();
}
function selectSentence() {
  const choices = sentences.value.filter((sentence) => sentence !== title.value);
  title.value = choices[Math.floor(Math.random() * choices.length)] ?? title.value;
}
function typeNextLetter() {
  titlePaused.value = false;
  visibleLetters.value += 1;
  if (visibleLetters.value === titleLength.value) {
    titlePaused.value = true;
    if (terminalEngaged.value) {
      typingTimer = undefined;
      return;
    }
    typingTimer = setTimeout(deleteNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.hold);
    return;
  }
  const previousLetter = titleLetters.value[visibleLetters.value - 1]?.letter;
  typingTimer = setTimeout(
    typeNextLetter,
    INTRO_READING_UNIT_MS *
      (/[，,]/.test(previousLetter ?? "") ? HERO_TYPING.punctuation : HERO_TYPING.letter),
  );
}
function deleteNextLetter() {
  if (terminalEngaged.value) {
    // If interaction begins during deletion, type the same sentence back in.
    // 若删除期间开始交互，则把同一句重新打出。
    typingTimer = setTimeout(typeNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.letter);
    return;
  }
  titlePaused.value = false;
  visibleLetters.value -= 1;
  if (visibleLetters.value === 0) {
    titlePaused.value = true;
    typingTimer = setTimeout(() => {
      if (!terminalEngaged.value) selectSentence();
      typeNextLetter();
    }, INTRO_READING_UNIT_MS * HERO_TYPING.nextSentence);
    return;
  }
  typingTimer = setTimeout(deleteNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.erase);
}

const { theme, setTheme } = useSiteTheme();
const {
  phase,
  revealing,
  spatialIntro,
  bootLines,
  bootProgress,
  bannerRowsVisible,
  bannerCaptionLines,
  expanded,
  shadeActive,
  anchor,
  terminalRef,
  markRef,
  startIntro,
  skipIntro,
  toggleExpanded,
} = useIntroPresentation(() => session.registry.list().length);
const bindTerminal: VNodeRef = (instance) => {
  terminalRef.value = instance as InstanceType<typeof TerminalHost> | null;
};
const bindIntroMark: VNodeRef = (instance) => {
  markRef.value = instance as InstanceType<typeof CaIntroMark> | null;
};
const services: TerminalServices = {
  getLocale: () => locale.value,
  navigate: async (path) => {
    await navigateTo(path);
  },
  getTheme: () => theme.value,
  setTheme: (value) => setTheme(value),
  replayIntro: () => {
    void nextTick(() => startIntro({ explicit: true }));
  },
};
const session = markRaw(useTerminalSession(services));
watch(locale, () => {
  title.value = sentences.value[0] ?? "";
  restartTyping();
});

function restartTyping() {
  stopTyping();
  titlePaused.value = true;
  if (terminalEngaged.value) {
    visibleLetters.value = titleLength.value;
    return;
  }
  const visible = revealing.value || phase.value === "ready";
  if (!visible) title.value = sentences.value[0] ?? "";
  visibleLetters.value = motionPreference?.matches ? titleLength.value : 0;
  if (visible && !motionPreference?.matches && titleLength.value > 0) {
    typingTimer = setTimeout(typeNextLetter, INTRO_READING_UNIT_MS * HERO_TYPING.letter);
  }
}

onMounted(() => {
  motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionPreference.addEventListener("change", restartTyping);
  document.addEventListener("pointerdown", resumeTitleOutsideTerminal);
  stopTitleWatch = watch(() => revealing.value || phase.value === "ready", restartTyping, {
    immediate: true,
  });
});
onBeforeUnmount(() => {
  stopTitleWatch?.();
  stopTyping();
  document.removeEventListener("pointerdown", resumeTitleOutsideTerminal);
  motionPreference?.removeEventListener("change", restartTyping);
});
</script>

<template>
  <section
    class="xca-terminal-hero page-container"
    :class="{
      'xca-terminal-hero--intro': phase !== 'ready',
      'xca-terminal-hero--logo': phase === 'logo',
      'xca-terminal-hero--boot': phase === 'boot',
      'xca-terminal-hero--branding': phase === 'brand',
      'xca-terminal-hero--docking': revealing,
      'xca-terminal-hero--revealing': revealing,
      'xca-terminal-hero--focused': expanded,
    }"
    aria-labelledby="xca-terminal-title"
  >
    <div v-if="phase !== 'ready'" class="xca-terminal-hero__intro-backdrop" aria-hidden="true" />
    <CaIntroMark v-if="spatialIntro" :ref="bindIntroMark" />
    <TerminalFocusBackdrop
      :expanded="expanded"
      :shade-active="shadeActive"
      @dismiss="toggleExpanded"
    />
    <div class="xca-terminal-hero__heading">
      <h1
        ref="titleElement"
        id="xca-terminal-title"
        class="xca-terminal-title"
        :aria-label="titleText"
      >
        <span class="xca-terminal-sr-only">{{ titleText }}</span>
        <span
          v-for="(sentence, index) in sentenceTexts"
          :key="index"
          class="xca-terminal-title__sizing"
          aria-hidden="true"
          >{{
            sentence
          }}</span
        >
        <span class="xca-terminal-title__text" aria-hidden="true">
          <span
            v-for="{ letter, index, accent } in titleLetters"
            :key="index"
            class="xca-terminal-title__letter"
            :class="{
              'xca-terminal-title__letter--accent': accent,
              'xca-terminal-title__letter--visible': index < visibleLetters,
              'xca-terminal-title__letter--cursor':
                !titleSettled && index === Math.max(0, visibleLetters - 1),
              'xca-terminal-title__letter--cursor-before': visibleLetters === 0 && index === 0,
              'xca-terminal-title__letter--punctuation': /[，,。.!！?？;；:：]/u.test(letter),
            }"
            >{{
              letter
            }}</span
          >
          <span
            class="xca-terminal-title__caret"
            :class="{
              'xca-terminal-title__caret--hidden': titleSettled,
              'xca-terminal-title__caret--paused': titlePaused,
            }"
            aria-hidden="true"
          />
        </span>
      </h1>
      <p class="xca-terminal-hero__subtitle">{{ t("home.subtitle") }}</p>
    </div>
    <section
      ref="anchor"
      :aria-label="t('terminal.label')"
      class="xca-terminal-anchor"
      @pointerdown="engageTerminal"
      @keydown="onTerminalKeydown"
      @input="engageTerminal"
    >
      <TerminalHost
        :ref="bindTerminal"
        :session="session"
        :intro="phase !== 'ready'"
        :intro-stage="phase"
        :boot-lines="bootLines"
        :boot-progress="bootProgress"
        :banner-rows-visible="bannerRowsVisible"
        :banner-caption-lines="bannerCaptionLines"
        :expanded="expanded"
        :engaged="terminalEngaged"
        @skip="skipIntro"
        @expand="toggleExpanded"
      />
    </section>
  </section>
</template>
