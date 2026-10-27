<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import "~/assets/css/intro-journey.css";
import { SITE } from "~/config/site";
import { JOURNEY, JOURNEY_STATIONS } from "~/features/terminal/presentation/intro-geometry";
import { mountMarkRenderer } from "~/features/terminal/presentation/intro-mark-renderer";
import type { MessageKey } from "~/i18n";
import mark from "../../../public/brand/ca-mark.svg?raw";

const { t } = useSiteLocale();
const front = ref<HTMLElement | null>(null);
const scene = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const meshReady = ref(false);
let releaseMesh: (() => void) | null = null;
// The draw phase and non-WebGL fallback keep the authoritative SVG paths.
// 绘制阶段与非 WebGL 回退都沿用权威的 SVG 路径。
const svg = mark
  .replace(/<title[\s\S]*?<\/title>/, "")
  .replace(/\s(?:role|aria-labelledby)="[^"]*"/g, "")
  .replaceAll("<path", '<path pathLength="1"')
  .replace(/fill="#[\da-f]+"/gi, 'fill="currentColor"');
const depthLayers = Array.from({ length: 18 }, (_, index) => (index + 1) * 4);
const signposts: { label: MessageKey; detail: string; command: string }[] = [
  ...SITE.navigation.map((item) => ({
    label: item.label,
    detail: SITE.routes[item.route],
    command: `xca open ${item.route}`,
  })),
  { label: "summary.help", detail: "help", command: "help" },
  { label: "summary.uname", detail: "uname -a", command: "uname -a" },
  { label: "terminal.tui", detail: "help / theme", command: "xca explore" },
  { label: "theme.label", detail: "light / dark / system", command: "xca theme" },
  { label: "terminal.shell", detail: "pwd / ls / cat", command: "help" },
];
const fins = JOURNEY_STATIONS.map((station) => ({
  ...station,
  panel: station.hasPanel ? signposts[station.index] : null,
}));

onMounted(() => {
  const paths = [...(front.value?.querySelectorAll("path") ?? [])];
  if (scene.value && canvas.value) {
    releaseMesh = mountMarkRenderer(scene.value, canvas.value, paths, () => {
      meshReady.value = false;
    });
    meshReady.value = Boolean(releaseMesh);
  }
});
onBeforeUnmount(() => releaseMesh?.());
</script>

<template>
  <div ref="scene" class="xca-ca-intro">
    <span class="xca-terminal-sr-only" role="status">{{ t("terminal.starting") }}</span>
    <div class="xca-ca-intro__aura" aria-hidden="true" />
    <canvas ref="canvas" class="xca-ca-intro__mesh" aria-hidden="true" />
    <div class="xca-ca-intro__viewport" aria-hidden="true">
      <div class="xca-ca-intro__camera">
        <div class="xca-ca-intro__mark">
          <template v-if="!meshReady">
            <div
              v-for="(depth, index) in depthLayers"
              :key="depth"
              class="xca-ca-intro__depth"
              :data-depth="depth"
              :style="{ transform: `translateZ(${-depth}px)`, '--xca-depth-light': 84 - index * 2 }"
              v-html="svg"
            />
          </template>
          <div ref="front" class="xca-ca-intro__front" v-html="svg" />
        </div>
        <div class="xca-ca-intro__travel">
          <div
            v-for="(fin, index) in fins"
            :key="index"
            class="xca-ca-intro__rib"
            :data-side="fin.side"
            :data-depth="fin.depth"
            :style="{
              width: `${fin.width}px`,
              height: `${fin.height}px`,
              left: `${fin.left}px`,
              top: `${fin.top}px`,
              transform: `translateZ(${fin.depth + 24}px)`,
              '--xca-sign-left': `${fin.panelLeft}px`,
              '--xca-sign-top': `${fin.panelTop}px`,
              '--xca-sign-width': `${fin.panelWidth}px`,
              '--xca-sign-height': `${fin.panelHeight}px`,
            }"
          >
            <div v-if="fin.panel" class="xca-ca-intro__content">
              <div class="xca-ca-intro__content-heading">
                <span class="xca-ca-intro__content-brand">{{ SITE.brand.acronym }}</span>
                <span class="xca-ca-intro__content-index">0{{ fin.index + 1 }}</span>
              </div>
              <strong>{{ t(fin.panel.label) }}</strong>
              <code>{{ fin.panel.detail }}</code>
              <div class="xca-ca-intro__content-footer">
                <code>{{ fin.panel.command }}</code>
                <svg viewBox="0 0 24 24" aria-hidden="true" class="xca-ca-intro__content-arrow">
                  <path d="M12 21V3M5 10l7-7 7 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
