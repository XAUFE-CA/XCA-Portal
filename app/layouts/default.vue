<script setup lang="ts">
import { UiScrollbar } from "@neoverse-ui/vue";
import { useRoute } from "vue-router";
import SiteFooter from "~/components/site/SiteFooter.vue";
import SiteHeader from "~/components/site/SiteHeader.vue";
import { SITE } from "~/config/site";

const route = useRoute();
</script>

<template>
  <div class="site-shell" :class="{ 'site-shell--home': route.path === SITE.routes.home }">
    <SiteHeader />
    <main id="main-content" class="site-main">
      <slot />
    </main>
    <SiteFooter v-if="route.path !== SITE.routes.home" />
    <!-- The rail is server rendered so the shared stylesheet removes the native bar on the
         first paint; teleporting it to body keeps it out of the site layout container's
         clipping and stacking isolation.
         文档滚动条参与服务端渲染，使共享样式表在首帧即移除原生条；通过 Teleport 移到 body
         可避免继承站点布局容器的裁剪和层叠隔离。 -->
    <Teleport to="body">
      <UiScrollbar class="xca-document-scrollbar" :refresh-key="route.fullPath" />
    </Teleport>
  </div>
</template>
