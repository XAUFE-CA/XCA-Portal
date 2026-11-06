<script setup lang="ts">
import AboutSection from "~/components/about/AboutSection.vue";

const { locale } = useSiteLocale();
// One query holds both languages, so switching language swaps the card content in place. Keying
// the query by language re-fetched it on every switch, which dropped the card back to its
// skeleton — the visible "content disappears, then comes back" during a language change.
// 一次查询同时取回两种语言，语言切换就地替换卡片内容。按语言分键会在每次切换时重新取数，
// 使卡片退回骨架，表现为切换语言时内容消失再出现。
const {
  data: pages,
  status,
  error,
} = await useAsyncData("about", () => queryCollection("about").all(), { lazy: true });
const page = computed(() => pages.value?.find((entry) => entry.locale === locale.value) ?? null);

// A failed content query keeps the site shell and its navigation; only the card is replaced.
// 内容查询失败时保留站点外壳与导航，只替换卡片。
const errorText = computed(() => {
  const value = error.value as
    | { statusCode?: number; statusMessage?: string; message?: string }
    | null
    | undefined;
  if (!value) return "";
  return [value.statusCode, value.statusMessage ?? value.message].filter(Boolean).join(" ");
});

// Missing content only counts once the query settled, so loading never 404s.
// 仅在查询结束后判定正文缺失，加载中不会返回 404。
watchEffect(() => {
  if (status.value === "success" && !page.value) {
    showError(createError({ statusCode: 404, statusMessage: "About content not found" }));
  }
});

useSeoMeta({
  title: () => page.value?.title,
  description: () => page.value?.description,
  ogTitle: () => page.value?.title,
  ogDescription: () => page.value?.description,
});
</script>

<template>
  <AboutSection :page="page ?? null" :pending="status !== 'success'" :error-text="errorText" />
</template>
