<script setup lang="ts">
import { UiScrollbar } from "@neoverse-ui/vue";
import { useRoute } from "vue-router";
import SiteFooter from "~/components/site/SiteFooter.vue";
import SiteHeader from "~/components/site/SiteHeader.vue";
import { SITE } from "~/config/site";

const route = useRoute();
</script>

<template>
  <div class="site-shell">
    <SiteHeader />
    <main id="main-content" class="site-main">
      <slot />
    </main>
    <SiteFooter v-if="route.path !== SITE.routes.home" />
    <!-- The document scrollbar is teleported out so it never inherits the site layout container's clipping or stacking isolation.
         文档级滚动条通过 Teleport 移到 body，避免继承站点布局容器的裁剪和层叠隔离。 -->
    <ClientOnly>
      <Teleport to="body">
        <UiScrollbar class="xca-document-scrollbar" :refresh-key="route.fullPath" />
      </Teleport>
    </ClientOnly>
  </div>
</template>
