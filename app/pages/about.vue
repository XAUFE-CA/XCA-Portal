<script setup lang="ts">
import AboutSection from "~/components/about/AboutSection.vue";

const { locale } = useSiteLocale();
const { data: page, error } = await useAsyncData(
  () => `about-${locale.value}`,
  () => queryCollection("about").where("locale", "=", locale.value).first(),
);

if (error.value) throw error.value;
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: "About content not found" });
}

useSeoMeta({
  title: () => page.value?.title,
  description: () => page.value?.description,
  ogTitle: () => page.value?.title,
  ogDescription: () => page.value?.description,
});
</script>

<template>
  <AboutSection v-if="page" :page="page" />
</template>
