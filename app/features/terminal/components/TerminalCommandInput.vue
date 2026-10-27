<script setup lang="ts">
import { type TerminalPromptSegment, UiTerminalPrompt } from "@neoverse-ui/vue";
import { computed } from "vue";
import type { PromptIdentity } from "../core/types";

const props = defineProps<{ identity: PromptIdentity; label: string; suggestion?: string }>();
const command = defineModel<string>({ required: true });
const segments = computed<TerminalPromptSegment[]>(() => [
  { id: "host", label: `${props.identity.user}@${props.identity.host}`, tone: "host" },
  { id: "path", label: props.identity.directory, tone: "path" },
]);
</script>

<template>
  <UiTerminalPrompt
    v-model="command"
    :label="label"
    :segments="segments"
    :suggestion="suggestion"
    :error="identity.status !== 0"
    enterkeyhint="go"
  />
</template>
