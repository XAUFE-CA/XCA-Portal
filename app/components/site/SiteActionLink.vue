<script setup lang="ts">
import { UiAction } from "@neoverse-ui/vue";
import { NuxtLink } from "#components";

withDefaults(
  defineProps<{
    to: string;
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md" | "lg";
  }>(),
  {
    variant: "primary",
    size: "md",
  },
);
</script>

<template>
  <UiAction :as="NuxtLink" :to="to" :variant="variant" :size="size">
    <slot />
  </UiAction>
</template>
