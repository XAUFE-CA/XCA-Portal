<script setup lang="ts">
import AboutSection from "~/components/about/AboutSection.vue";

const { locale } = useSiteLocale();
// Lazy keeps client navigation and locale switches on a skeleton instead of
// freezing the previous page; the server still awaits the query for SEO.
// 懒加载让客户端导航与语言切换显示骨架而非冻结旧页，服务端仍为 SEO 等待查询。
const {
  data: page,
  status,
  error,
} = await useAsyncData(
  () => `about-${locale.value}`,
  () => queryCollection("about").where("locale", "=", locale.value).first(),
  { lazy: true },
);

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
