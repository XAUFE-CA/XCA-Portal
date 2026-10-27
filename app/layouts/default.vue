<script setup lang="ts">
import { UiScrollbar } from "@neoverse-ui/vue";
import { useRoute } from "vue-router";
import SiteAtmosphere from "~/components/site/SiteAtmosphere.vue";
import SiteFooter from "~/components/site/SiteFooter.vue";
import SiteHeader from "~/components/site/SiteHeader.vue";
import { SITE } from "~/config/site";

const route = useRoute();
</script>

<template>
  <div class="site-shell">
    <SiteAtmosphere :home="route.path === SITE.routes.home" />
    <SiteHeader />
    <main id="main-content" class="site-main">
      <slot />
    </main>
    <SiteFooter v-if="route.path !== SITE.routes.home" />
    <!-- The document-level rail must not inherit the clipped/isolated site shell.
         文档级滚动条不得继承被裁剪或隔离的站点外壳。 -->
    <ClientOnly>
      <Teleport to="body">
        <UiScrollbar class="xca-document-scrollbar" :refresh-key="route.fullPath" />
      </Teleport>
    </ClientOnly>
  </div>
</template>
