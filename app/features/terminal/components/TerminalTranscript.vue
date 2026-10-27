<script setup lang="ts">
const { t } = useSiteLocale();

import { UiAction, UiTerminalEcho, UiTerminalLine } from "@neoverse-ui/vue";
import { selectBanner } from "../branding/banners";
import type { TerminalEntry } from "../core/types";

defineProps<{
  entries: readonly TerminalEntry[];
  columns: number;
  bannerRowsVisible?: number;
  captionVisible?: boolean;
}>();
</script>
<template>
  <template v-for="entry in entries" :key="entry.id">
    <UiTerminalLine
      v-if="entry.type === 'banner'"
      class="xca-terminal-banner"
      preformatted
      :text="selectBanner(columns).split('\n').slice(0, bannerRowsVisible).join('\n')"
      :aria-label="t('terminal.welcomeLabel')"
    />
    <UiTerminalLine
      v-else-if="entry.type === 'line' && captionVisible !== false"
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
