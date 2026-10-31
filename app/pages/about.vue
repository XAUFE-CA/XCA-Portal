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

if (error.value) throw error.value;

// Errors raised after the awaited first load surface through the error page.
// 首次等待加载之后发生的错误通过错误页呈现。
watch(error, (value) => {
  if (value) showError(value);
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
  <AboutSection :page="page ?? null" :pending="status !== 'success'" />
</template>
