<script setup lang="ts">
import { UiControlSurface, UiNavigationItem } from "@neoverse-ui/vue";
import { computed } from "vue";
import { SITE } from "~/config/site";
import { ContextMenuHost, useLinkMenu } from "~/features/context-menu";

const emit = defineEmits<{ navigate: [] }>();
const { t } = useSiteLocale();
const route = useRoute();
const menu = useLinkMenu(() => t("contextMenu.navigation"));
const navigation = computed(() =>
  SITE.navigation.map((item) => ({ to: SITE.routes[item.route], label: t(item.label) })),
);
</script>

<template>
  <nav class="site-navigation" :aria-label="t('nav.label')" :ref="menu.regionRef">
    <ContextMenuHost :menu="menu" />
    <UiControlSurface navigation-indicator edge-mode="local">
      <NuxtLink
        v-for="item in navigation"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ href, navigate }"
      >
        <UiNavigationItem
          :href="href ?? undefined"
          :label="item.label"
          :active="route.path === item.to"
          surface="none"
          @click="
            navigate($event);
            emit('navigate');
          "
        />
      </NuxtLink>
    </UiControlSurface>
  </nav>
</template>
