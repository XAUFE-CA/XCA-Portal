<script setup lang="ts">
defineProps<{ home: boolean }>();
</script>

<template>
  <div class="site-atmosphere" :class="{ 'site-atmosphere--home': home }" aria-hidden="true">
    <template v-if="home">
      <div class="site-atmosphere__light" />
      <div class="site-atmosphere__depth" />
    </template>
  </div>
</template>
