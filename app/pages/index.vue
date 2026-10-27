<script setup lang="ts">
const { t } = useSiteLocale();

import terminalFont from "~/assets/fonts/maple-mono-nf-cn-regular.woff2?url";
import HeroSection from "~/components/home/HeroSection.vue";

// The home terminal paints its first frame during boot; start the subset early.
// 首页终端在启动阶段绘制首帧，因此提前开始加载该子集。
useHead({
  link: [
    {
      rel: "preload",
      as: "font",
      type: "font/woff2",
      href: terminalFont,
      crossorigin: "anonymous",
    },
  ],
});

useSeoMeta({
  title: () => t("home.title"),
  description: () => t("home.description"),
  ogTitle: () => t("home.title"),
  ogDescription: () => t("home.ogDescription"),
});
</script>

<template>
  <HeroSection />
</template>
