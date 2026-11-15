<script setup lang="ts">
const { t } = useSiteLocale();

import { UiAction, UiTerminalEcho, UiTerminalLine } from "@neoverse-ui/vue";
import { computed } from "vue";
import { BANNERS, NARROW_LEAD, selectBanner } from "../branding/banners";
import type { TerminalEntry } from "../core/types";

const props = defineProps<{
  entries: readonly TerminalEntry[];
  columns: number;
  bannerRowsVisible?: number;
  captionLinesVisible?: number;
}>();
const banner = computed(() => selectBanner(props.columns));
const bannerRows = computed(() => banner.value.split("\n"));
// The narrow banner splits its caption from the mark so both can be set at their own scale.
// 窄屏字标把标题与字标拆开，使两者各自按合适的字号呈现。
const narrowWelcome = computed(() => banner.value === BANNERS.narrow);
// The lead prints as one stage before the mark; the mark keeps the row mask.
// 标题在字标前作为一个阶段整体出现；字标保留逐行遮罩。
const bannerLeadVisible = computed(
  () =>
    narrowWelcome.value && (props.bannerRowsVisible === undefined || props.bannerRowsVisible > 0),
);
const visibleArtRows = computed(() =>
  props.bannerRowsVisible === undefined
    ? bannerRows.value.length
    : Math.max(
        0,
        Math.min(props.bannerRowsVisible - (narrowWelcome.value ? 1 : 0), bannerRows.value.length),
      ),
);
// Rows still print in order; the mask feathers the newest row so it fades in.
// 字符画仍按顺序打印，遮罩柔化最新一行，使其淡入。
const bannerStyle = computed(() => ({
  "--xca-banner-rows": visibleArtRows.value,
}));
const bannerText = computed(() => bannerRows.value.slice(0, visibleArtRows.value).join("\n"));
// A staged count reveals welcome copy in order; an absent count leaves normal output untouched.
// 分阶段计数让欢迎文案依次显现；未提供计数时，普通输出保持不变。
const stagedCaptions = computed(() => {
  if (props.captionLinesVisible === undefined) return null;
  return new Set(
    props.entries
      .filter((entry) => entry.type === "line")
      .slice(0, props.captionLinesVisible)
      .map((entry) => entry.id),
  );
});
function captionVisible(entry: TerminalEntry): boolean {
  return stagedCaptions.value === null || stagedCaptions.value.has(entry.id);
}
</script>
<template>
  <template v-for="entry in entries" :key="entry.id">
    <div v-if="entry.type === 'banner' && narrowWelcome" class="xca-terminal-welcome">
      <div v-if="bannerLeadVisible" class="xca-terminal-welcome__lead-frame">
        <UiTerminalLine
          class="xca-terminal-welcome__lead"
          preformatted
          :text="NARROW_LEAD"
          aria-hidden="true"
        />
      </div>
      <div class="xca-terminal-welcome__mark-frame">
        <UiTerminalLine
          class="xca-terminal-banner xca-terminal-banner--narrow"
          preformatted
          :style="bannerStyle"
          :text="bannerText"
          :aria-label="t('terminal.welcomeLabel')"
        />
      </div>
    </div>
    <UiTerminalLine
      v-else-if="entry.type === 'banner'"
      class="xca-terminal-banner"
      preformatted
      :style="bannerStyle"
      :text="bannerText"
      :aria-label="t('terminal.welcomeLabel')"
    />
    <UiTerminalLine
      v-else-if="entry.type === 'line' && captionVisible(entry)"
      class="xca-terminal-line"
      :class="{
        'xca-terminal-welcome-brand': entry.message?.key === 'terminal.brand',
        'xca-terminal-welcome-hint': entry.message?.key === 'terminal.welcomeHint',
      }"
      :kind="entry.tone === 'accent' ? 'command' : 'text'"
      :tone="entry.tone === 'accent' ? 'normal' : entry.tone"
      :text="entry.message ? t(entry.message.key, entry.message.params) : entry.text"
    />
    <UiTerminalEcho
      v-else-if="entry.type === 'command'"
      class="xca-terminal-command"
      :text="entry.source"
      :error="entry.prompt.status !== 0"
      :segments="[
        { id: 'host', label: `${entry.prompt.user}@${entry.prompt.host}`, tone: 'host' },
        { id: 'path', label: entry.prompt.directory, tone: 'path' },
      ]"
    />
    <div v-else-if="entry.type === 'links'" class="xca-terminal-links">
      <NuxtLink
        v-for="item in entry.items"
        :key="item.route"
        :to="item.route"
        custom
        v-slot="{ href, navigate }"
      >
        <UiAction
          as="a"
          :href="href ?? undefined"
          variant="ghost"
          size="sm"
          @click.stop="navigate"
          >{{
            item.label
          }}</UiAction
        >
      </NuxtLink>
    </div>
  </template>
</template>
