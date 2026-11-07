<script setup lang="ts">
const { t } = useSiteLocale();

import { UiButton, UiField, UiInput, UiTerminalLine } from "@neoverse-ui/vue";
import { nextTick, ref, watch } from "vue";
import type { TerminalInteraction } from "../core/types";

const props = defineProps<{ interaction: TerminalInteraction; cancel: () => void }>();
const value = ref("");
const selected = ref(0);
const region = ref<HTMLElement>();
watch(
  () => props.interaction,
  async () => {
    value.value = "";
    selected.value = 0;
    await nextTick();
    region.value?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  },
  { immediate: true },
);
function submit() {
  if (props.interaction.type !== "prompt") return;
  const answer = value.value;
  value.value = "";
  props.interaction.submit(answer);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "c")) {
    event.preventDefault();
    event.stopPropagation();
    value.value = "";
    props.cancel();
    return;
  }
  if (
    props.interaction.type !== "menu" ||
    !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
  )
    return;
  event.preventDefault();
  const length = props.interaction.items.length;
  selected.value =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? length - 1
        : (selected.value + (event.key === "ArrowDown" ? 1 : -1) + length) % length;
  region.value
    ?.querySelectorAll<HTMLButtonElement>("button[data-menu-item]")
    [selected.value]?.focus();
}
</script>
<template>
  <section
    ref="region"
    :aria-label="interaction.type === 'menu' ? interaction.title : interaction.label"
    class="xca-terminal-interaction"
    @keydown="keydown"
    @click.stop
  >
    <template v-if="interaction.type === 'menu'">
      <UiTerminalLine
        class="xca-terminal-line xca-terminal-interaction__title"
        kind="command"
        :text="interaction.title"
      />
      <div class="xca-terminal-menu" role="menu" :aria-label="interaction.title">
        <UiButton
          v-for="(item, index) in interaction.items"
          :key="item.id"
          role="menuitem"
          :tabindex="selected === index ? 0 : -1"
          data-menu-item
          :class="[
            'xca-terminal-menu__item',
            { 'xca-terminal-menu__item--selected': selected === index },
          ]"
          variant="ghost"
          size="sm"
          @focus="selected = index"
          @click="interaction.type === 'menu' && interaction.select(item.id)"
        >
          <span class="xca-terminal-menu__marker" aria-hidden="true">{{
            selected === index ? "❯" : "·"
          }}</span>
          <span class="xca-terminal-menu__label">{{ item.label }}</span>
          <UiTerminalLine
            v-if="item.description"
            class="xca-terminal-menu__description"
            tone="muted"
            :text="item.description"
          />
        </UiButton>
      </div>
    </template>
    <form v-else autocomplete="off" @submit.prevent="submit">
      <UiField
        v-slot="{ controlAttrs }"
        control-id="xca-interaction-input"
        :label="interaction.label"
      >
        <div class="xca-terminal-interaction__input">
          <UiInput
            v-bind="controlAttrs"
            v-model="value"
            :type="interaction.kind === 'secret' ? 'password' : 'text'"
            :inputmode="interaction.kind === 'otp' ? 'numeric' : 'text'"
            :autocomplete="interaction.kind === 'otp' ? 'one-time-code' : 'off'"
          />
          <UiButton type="submit" size="sm">{{ t("interaction.continue") }}</UiButton>
        </div>
      </UiField>
    </form>
    <div class="xca-terminal-interaction__footer">
      <UiButton
        variant="ghost"
        size="sm"
        @click="
          value = '';
          cancel();
        "
        >{{
          t("interaction.cancel")
        }}</UiButton
      >
    </div>
  </section>
</template>
