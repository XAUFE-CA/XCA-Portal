<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import "~/assets/css/intro-flat.css";
import "~/assets/css/intro-journey.css";
import SiteIcon from "~/components/site/SiteIcon.vue";
import { SITE } from "~/config/site";
import type { MessageKey } from "~/i18n";
import mark from "../../../../public/brand/ca-mark.svg?raw";
import { JOURNEY_STATIONS, roadBend } from "../core/intro-geometry";
import { releaseIntroGraphics } from "../core/intro-graphics";

const { t } = useSiteLocale();
const props = defineProps<{ preparing: boolean; flat: boolean }>();
const front = ref<HTMLElement | null>(null);
const scene = ref<HTMLElement | null>(null);
const meshSlot = ref<HTMLElement | null>(null);
const meshReady = ref(false);
let releaseMesh: (() => void) | null = null;
let mounted = false;
const flatSvg = mark
  .replace(/<title[\s\S]*?<\/title>/, "")
  .replace(/\s(?:role|aria-labelledby)="[^"]*"/g, "")
  .replaceAll("<path", '<path pathLength="1"')
  .replace(/fill="#[\da-f]+"/gi, 'fill="currentColor"');
// Spatial geometry uses the original coordinate space, not the cropped square viewBox.
// 空间几何使用原始坐标系，不使用裁剪后的方形视框。
const spatialSvg = flatSvg
  .replace(/viewBox="[^"]*"/, 'viewBox="0 0 1254 1254"')
  .replace(/width="\d+"/, 'width="1254"')
  .replace(/height="\d+"/, 'height="1254"');
const depthLayers = Array.from({ length: 18 }, (_, index) => (index + 1) * 4);
const signposts: {
  label: MessageKey;
  alt: MessageKey;
  icon: "sincerity" | "inclusion" | "harmony" | "passion";
}[] = [
  {
    label: "intro.value.sincerity",
    alt: "intro.value.sincerity.alt",
    icon: "sincerity",
  },
  {
    label: "intro.value.inclusion",
    alt: "intro.value.inclusion.alt",
    icon: "inclusion",
  },
  {
    label: "intro.value.harmony",
    alt: "intro.value.harmony.alt",
    icon: "harmony",
  },
  {
    label: "intro.value.passion",
    alt: "intro.value.passion.alt",
    icon: "passion",
  },
];
const fins = JOURNEY_STATIONS.map((station) => ({
  ...station,
  bend: roadBend(station.depth),
  panel: station.hasPanel ? signposts[station.index] : null,
}));

onMounted(() => {
  mounted = true;
});

async function prepareRenderer(gl: WebGL2RenderingContext, signal: AbortSignal): Promise<boolean> {
  const canvas = gl.canvas;
  const stop = () => {
    meshReady.value = false;
  };
  if (
    props.flat ||
    !scene.value ||
    !meshSlot.value ||
    !(canvas instanceof HTMLCanvasElement) ||
    signal.aborted
  ) {
    releaseIntroGraphics(gl);
    return false;
  }
  meshSlot.value.append(canvas);
  try {
    // Three.js stays out of the initial bundle: only the spatial entry, after a passed probe,
    // may load it, so a GPU-less device never downloads the renderer.
    // Three.js 不进入初始包：只有探测通过的空间入场才加载它，没有 GPU 的设备因此不下载渲染器。
    const { mountMarkRenderer } = await import("../rendering/intro-mark-renderer");
    if (!mounted || signal.aborted || !scene.value || gl.isContextLost()) {
      releaseIntroGraphics(gl);
      return false;
    }
    const paths = [...(front.value?.querySelectorAll("path") ?? [])];
    releaseMesh = await mountMarkRenderer(scene.value, canvas, gl, paths, stop, signal);
    if (!mounted || signal.aborted) {
      releaseMesh?.();
      return false;
    }
    meshReady.value = Boolean(releaseMesh);
    if (!releaseMesh) releaseIntroGraphics(gl);
    return meshReady.value;
  } catch {
    releaseIntroGraphics(gl);
    return false;
  }
}
defineExpose({ prepareRenderer });
onBeforeUnmount(() => {
  mounted = false;
  releaseMesh?.();
});
</script>

<template>
  <div ref="scene" class="xca-ca-intro" :data-intro-scene="flat ? 'flat' : 'spatial'">
    <!-- An empty stage reports loading in its own centre; the running scene reports through text.
         空场景在自己的中央报告载入状态，运行中的场景改由文本报告。 -->
    <div v-if="preparing && !flat" class="xca-ca-intro__loading" role="status">
      {{ t("intro.preparing") }}
    </div>
    <span v-else class="xca-terminal-sr-only" role="status">{{ t("terminal.starting") }}</span>
    <!-- The flat entry keeps the same root so a failed renderer can swap scenes in place.
         二维入场沿用同一根节点，渲染器失败时可在原处切换场景。 -->
    <div v-if="flat" class="xca-intro-flat" aria-hidden="true">
      <div class="xca-intro-flat__mark" v-html="flatSvg" />
    </div>
    <template v-else>
      <div class="xca-ca-intro__aura" aria-hidden="true" />
      <div ref="meshSlot" />
      <div class="xca-ca-intro__viewport" aria-hidden="true">
        <div class="xca-ca-intro__camera">
          <div class="xca-ca-intro__mark">
            <!-- A failed renderer keeps the layered SVG mark instead of an empty stage.
                 渲染器失败时保留分层 SVG 标识，而不是空白场景。 -->
            <template v-if="!meshReady">
              <div
                v-for="(depth, index) in depthLayers"
                :key="depth"
                class="xca-ca-intro__depth"
                :data-depth="depth"
                :style="{
                  transform: `translateZ(${-depth}px)`,
                  '--xca-depth-light': 84 - index * 2,
                }"
                v-html="spatialSvg"
              />
            </template>
            <div ref="front" class="xca-ca-intro__front" v-html="spatialSvg" />
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
                left: `${fin.left + fin.bend.x}px`,
                top: `${fin.top + fin.bend.y}px`,
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
                <strong>
                  {{ t(fin.panel.label) }}
                </strong>
                <div class="xca-ca-intro__content-footer">
                  <code>{{ t(fin.panel.alt) }}</code>
                  <SiteIcon :name="fin.panel.icon" class="xca-ca-intro__content-icon" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
