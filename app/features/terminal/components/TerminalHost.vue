<script setup lang="ts">
const { t } = useSiteLocale();

import {
  UiButton,
  UiTerminalLine,
  UiTerminalSurface,
  UiTerminalTranscript,
} from "@neoverse-ui/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { selectBanner } from "../branding/banners";
import type { TerminalSession } from "../core/session";
import type {
  TerminalInteraction as Interaction,
  PromptIdentity,
  TerminalApplication,
  TerminalEntry,
} from "../core/types";
import { useTerminalMetrics } from "../presentation/useTerminalMetrics";
import type { BootLine, TerminalPresentationStage } from "./presentation-contract";
import TerminalCommandInput from "./TerminalCommandInput.vue";
import TerminalInteraction from "./TerminalInteraction.vue";
import TerminalStatusBar from "./TerminalStatusBar.vue";
import TerminalTranscript from "./TerminalTranscript.vue";
import TerminalWindowHeader from "./TerminalWindowHeader.vue";

const props = defineProps<{
  session: TerminalSession;
  intro: boolean;
  introStage: TerminalPresentationStage;
  bootLines: readonly BootLine[];
  bootProgress: number;
  bannerRowsVisible: number;
  bannerCaptionLines: number;
  expanded: boolean;
  engaged: boolean;
}>();
const emit = defineEmits<{ skip: []; expand: [] }>();
const entries = ref<TerminalEntry[]>([...props.session.entries]);
const input = ref(props.session.draft);
const transcript = ref<InstanceType<typeof UiTerminalTranscript> | null>(null);
const viewport = computed<HTMLElement | null>(() => transcript.value?.$el ?? null);
const screen = ref<HTMLElement | null>(null);
const transcriptScrolled = ref(false);
const transcriptMoreBelow = ref(false);
const probe = ref<InstanceType<typeof UiTerminalLine> | null>(null);
const probeElement = computed<HTMLElement | null>(() => probe.value?.$el ?? null);
const appRegion = ref<HTMLElement | null>(null);
const { columns, bannerColumns, bannerScale, scheduleMeasurement } = useTerminalMetrics({
  session: props.session,
  screen,
  viewport,
  probe: probeElement,
});
const interaction = ref<Interaction | null>(props.session.interaction);
const application = ref<TerminalApplication | null>(props.session.application);
const appLines = ref<readonly string[]>([]);
const identity = ref<PromptIdentity>(props.session.identity());
const appearance = ref(props.session.appearanceRegistry.resolve(props.session.appearance));
const booting = computed(() => props.intro && props.introStage !== "reveal");
const glassScreen = computed(
  () =>
    props.intro &&
    (props.introStage === "logo" || (props.introStage === "reveal" && !props.bootLines.length)),
);
const bootBar = computed(() => {
  // Reserve room for brackets, spacing and the percentage on narrow terminals.
  // 在窄终端上为方括号、间距和百分比预留空间。
  const cells = Math.max(8, Math.min(32, columns.value - 8));
  const filled = Math.floor((props.bootProgress / 100) * cells);
  const head = props.bootProgress < 100 ? ">" : "";
  return {
    filled: "=".repeat(filled),
    head,
    empty: ".".repeat(cells - filled - head.length),
  };
});
const composing = ref(false);
const suggestionDismissed = ref(false);
const sessionRevision = ref(0);
const suggestion = computed(() => {
  // History, cwd and registered candidates always come from the live session.
  // 历史、当前目录和补全候选项始终从当前会话读取。
  sessionRevision.value;
  if (suggestionDismissed.value || composing.value || booting.value || running.value) return "";
  return props.session.suggest(input.value);
});
const historyIndex = ref(-1);
const running = ref(props.session.running);
let draftBeforeHistory = "";
let completion: { matches: string[]; index: number; value: string } | null = null;
let unsubscribe: (() => void) | undefined;

function focusInput() {
  if (application.value) appRegion.value?.focus({ preventScroll: true });
  else if (!interaction.value && !booting.value)
    screen.value
      ?.querySelector<HTMLInputElement>("#xca-command-input")
      ?.focus({ preventScroll: true });
}
function focusFromScreen() {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && screen.value?.contains(selection.anchorNode)) return;
  focusInput();
}
function scrollToLatest() {
  const node = viewport.value;
  if (!node?.isConnected || props.intro || application.value) return;
  // Scroll only the terminal; scrollIntoView would also move the surrounding page.
  // 只滚动终端。scrollIntoView 会连带滚动周围的页面。
  node.scrollTop = node.scrollHeight;
}
function syncTranscriptScroll() {
  const node = viewport.value;
  const top = node?.scrollTop ?? 0;
  transcriptScrolled.value = top > 0;
  transcriptMoreBelow.value = node ? node.scrollHeight - node.clientHeight - top > 1 : false;
}
function updateFromSession() {
  sessionRevision.value++;
  entries.value = [...props.session.entries];
  running.value = props.session.running;
  identity.value = props.session.identity();
  appearance.value = props.session.appearanceRegistry.resolve(props.session.appearance);
  const hadInteraction = !!interaction.value;
  const hadApp = !!application.value;
  interaction.value = props.session.interaction;
  application.value = props.session.application;
  appLines.value = [...(application.value?.lines ?? [])];
  if (!hadApp && application.value) void nextTick(focusInput);
  if ((hadApp || hadInteraction) && !application.value && !interaction.value)
    void nextTick(focusInput);
}
watch(input, (value) => {
  props.session.draft = value;
});
watch(appearance, () => {
  void nextTick(scheduleMeasurement);
});
watch(
  () => props.intro,
  (intro) => {
    if (!intro) void nextTick(scheduleMeasurement);
  },
);
watch(viewport, (node, previous) => {
  previous?.removeEventListener("scroll", syncTranscriptScroll);
  node?.addEventListener("scroll", syncTranscriptScroll, { passive: true });
  syncTranscriptScroll();
});
onMounted(() => {
  unsubscribe = props.session.subscribe(updateFromSession);
});
onBeforeUnmount(() => {
  unsubscribe?.();
  viewport.value?.removeEventListener("scroll", syncTranscriptScroll);
  props.session.cancel();
});
async function submit() {
  if (composing.value || booting.value || running.value || application.value) return;
  const value = input.value.trim();
  if (!value) return;
  resetCompletion();
  input.value = "";
  historyIndex.value = -1;
  const execution = props.session.execute(value);
  await nextTick();
  scrollToLatest();
  await execution;
  await nextTick();
  // Each new submission resumes following output, even after reading older history.
  // 每次新提交都会在用户回看旧历史后恢复自动跟随输出。
  scrollToLatest();
}
function resetCompletion() {
  completion = null;
}
function editInput() {
  resetCompletion();
  suggestionDismissed.value = false;
}
function acceptSuggestion(event: KeyboardEvent): boolean {
  const editor = event.target as HTMLInputElement;
  if (
    !suggestion.value ||
    editor.selectionStart !== input.value.length ||
    editor.selectionEnd !== input.value.length ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  event.preventDefault();
  input.value = suggestion.value;
  resetCompletion();
  void nextTick(() => editor.setSelectionRange(input.value.length, input.value.length));
  return true;
}
function completeInput() {
  if (!completion || completion.value !== input.value) {
    const source = input.value;
    const matches = props.session.complete(source);
    if (!matches.length) {
      resetCompletion();
      return;
    }
    if (matches.length > 1) {
      // Values keep the command and earlier arguments; list only the incomplete token.
      // 替换值保留命令与先前参数。列表仅显示正在补全的标记。
      const base = source.slice(0, source.lastIndexOf(" ") + 1);
      props.session.append({
        type: "line",
        text: matches.map((match) => match.slice(base.length)).join("    "),
        tone: "muted",
      });
    }
    completion = { matches, index: -1, value: source };
  }
  completion.index = (completion.index + 1) % completion.matches.length;
  const match = completion.matches[completion.index];
  if (match === undefined) throw new Error("Terminal completion index is outside its candidates.");
  input.value = match + (match.endsWith("/") ? "" : " ");
  completion.value = input.value;
  // A unique match restarts argument or path completion on the next Tab.
  // 唯一匹配可在下次按 Tab 时重新开始参数或路径补全。
  if (completion.matches.length === 1) resetCompletion();
  void nextTick(() => {
    scrollToLatest();
    const editor = screen.value?.querySelector<HTMLInputElement>("#xca-command-input");
    editor?.setSelectionRange(input.value.length, input.value.length);
  });
}
function recallHistory(event: KeyboardEvent) {
  const { history } = props.session;
  if (!history.length) return;
  event.preventDefault();
  if (historyIndex.value === -1) draftBeforeHistory = input.value;
  historyIndex.value =
    event.key === "ArrowUp"
      ? Math.min(history.length - 1, historyIndex.value + 1)
      : Math.max(-1, historyIndex.value - 1);
  input.value =
    historyIndex.value < 0
      ? draftBeforeHistory
      : (history[history.length - 1 - historyIndex.value] ?? "");
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return;
  if (!(event.key === "Tab" && event.shiftKey)) scrollToLatest();
  if (event.key !== "Tab" || event.shiftKey) resetCompletion();
  if (event.key === "Escape") suggestionDismissed.value = true;
  if (event.key === "ArrowRight" && acceptSuggestion(event)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    props.session.cancel();
    input.value = "";
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    props.session.clear();
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    recallHistory(event);
    return;
  }
  if (event.key === "Tab") {
    // Shift+Tab leaves the editor; plain Tab stays with the shell even with no candidates.
    // Shift+Tab 可离开编辑器。即使没有候选项，普通 Tab 仍交由 shell 处理。
    if (event.shiftKey) return;
    event.preventDefault();
    if (!running.value && !booting.value) completeInput();
  }
}
function appKeydown(event: KeyboardEvent) {
  if (event.isComposing || (event.key === "Tab" && event.shiftKey)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.ctrlKey && event.key.toLowerCase() === "c") props.session.cancel();
  else application.value?.onKey(event.key);
}
defineExpose({
  focusInput,
  getBannerRowCount: () => selectBanner(bannerColumns.value).split("\n").length,
  getWelcomeLineCount: () => entries.value.filter((entry) => entry.type === "line").length,
});
</script>

<template>
  <UiTerminalSurface
    :title="t('terminal.title')"
    :aria-label="t('terminal.label')"
    :aria-hidden="glassScreen || undefined"
    :inert="glassScreen"
    :data-neoverse-glass-edge-pass="glassScreen ? 'css' : undefined"
    surface="glass-elevated"
    class="xca-terminal-window scrollbar-immersive"
    :style="appearance"
    :class="{
      'xca-terminal-window--intro': intro,
      'xca-terminal-window--screen': glassScreen,
      'xca-terminal-window--expanded': expanded,
    }"
  >
    <template #header>
      <TerminalWindowHeader
        :user="identity.user"
        :host="identity.host"
        :directory="identity.directory"
        :intro="intro"
        :intro-stage="introStage"
        :expanded="expanded"
        @skip="emit('skip')"
        @expand="emit('expand')"
      />
    </template>
    <section
      ref="screen"
      :aria-label="t('terminal.output')"
      class="xca-terminal-screen"
      :style="{ '--xca-terminal-banner-scale': bannerScale }"
      :class="[`xca-terminal-screen--${introStage}`, { 'xca-terminal-screen--idle': !engaged }]"
      @click="focusFromScreen"
      @keydown.self.enter="focusInput"
    >
      <UiTerminalLine
        ref="probe"
        class="xca-terminal-brand-probe"
        :style="{ '--xca-terminal-banner-scale': 1 }"
        text="M"
        aria-hidden="true"
      />
      <UiTerminalTranscript
        ref="transcript"
        class="xca-terminal-transcript"
        :class="{
          'xca-terminal-transcript--hidden': application,
          'xca-terminal-transcript--scrolled': transcriptScrolled,
          'xca-terminal-transcript--more-below': transcriptMoreBelow,
        }"
        :label="t('terminal.output')"
        live="off"
      >
        <div class="xca-terminal-flow">
          <div class="xca-terminal-history">
            <TerminalTranscript
              :entries="entries"
              :columns="bannerColumns"
              :banner-rows-visible="
                intro && introStage !== 'reveal' ? bannerRowsVisible : undefined
              "
              :caption-lines-visible="
                !intro || introStage === 'reveal' ? undefined : bannerCaptionLines
              "
            />
          </div>
          <TerminalInteraction
            v-if="interaction"
            :interaction="interaction"
            :cancel="() => session.cancel()"
          />
          <form
            v-show="!interaction && !application"
            class="xca-terminal-prompt"
            autocomplete="off"
            @submit.prevent="submit"
          >
            <TerminalCommandInput
              id="xca-command-input"
              v-model="input"
              :readonly="running"
              :disabled="booting"
              :identity="identity"
              :suggestion="suggestion"
              :label="running ? t('terminal.inputRunning') : t('terminal.input')"
              @input="editInput"
              @blur="resetCompletion"
              @compositionstart="
                resetCompletion();
                composing = true;
              "
              @compositionend="composing = false"
              @keydown="keydown"
            />
            <UiTerminalLine
              v-if="running"
              class="xca-terminal-prompt__busy"
              kind="status"
              tone="muted"
              text="···"
              :aria-label="t('terminal.runningLabel')"
            />
          </form>
        </div>
      </UiTerminalTranscript>
      <div
        v-if="application"
        ref="appRegion"
        class="xca-terminal-application"
        tabindex="-1"
        role="application"
        :aria-label="application.title"
        @keydown="appKeydown"
        @click.stop="appRegion?.focus({ preventScroll: true })"
      >
        <UiTerminalLine class="xca-terminal-line xca-terminal-application__title" kind="command">
          {{ application.title }}
        </UiTerminalLine>
        <UiTerminalLine class="xca-terminal-application__output" :text="appLines.join('\n')" />
        <div class="xca-terminal-application__footer">
          <UiButton variant="ghost" size="sm" @click.stop="session.closeApplication()">{{
            t("terminal.exitReader")
          }}</UiButton>
        </div>
      </div>
      <div v-if="intro" class="xca-terminal-intro-output" aria-hidden="true">
        <div class="xca-terminal-bootlog">
          <UiTerminalLine
            v-for="(line, index) in bootLines"
            :key="index"
            class="xca-terminal-bootlog__line"
            :style="{ gridRow: index + 1 }"
            :tone="line.tone === 'ok' ? 'success' : 'muted'"
          >
            <span class="xca-terminal-bootlog__status"><span>{{ line.status }}</span></span>
            <span>{{ t(line.message.key, line.message.params) }}</span>
          </UiTerminalLine>
          <div
            class="xca-terminal-boot-progress"
            role="progressbar"
            :aria-label="t('terminal.boot')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="bootProgress"
          >
            <span class="xca-terminal-boot-progress__track"
              >[<span class="xca-terminal-boot-progress__fill">{{ bootBar.filled }}</span
              ><span class="xca-terminal-boot-progress__head">{{ bootBar.head }}</span
              ><span class="xca-terminal-boot-progress__empty">{{ bootBar.empty }}</span>]</span
            >
            <span class="xca-terminal-boot-progress__value">{{ bootProgress }}%</span>
          </div>
        </div>
      </div>
    </section>
    <TerminalStatusBar
      :directory="identity.directory"
      :columns="columns"
      :intro="intro"
      :intro-stage="introStage"
      :running="running"
      :application="!!application"
    />
    <span class="xca-terminal-sr-only" aria-live="polite">{{
      intro ? t("terminal.starting") : running ? t("terminal.runningLabel") : t("terminal.ready")
    }}</span>
  </UiTerminalSurface>
</template>
