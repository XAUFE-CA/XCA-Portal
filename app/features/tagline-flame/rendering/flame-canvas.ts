import {
  type EmberGlyph,
  type EmberParticle,
  emberCount,
  spawnEmber,
  stepEmbers,
} from "../core/flame-particles";
import { createPalette, type FlamePalette } from "./flame-palette";

// The footer is outside the route snapshot but part of the theme snapshot, so the flame keeps
// running for navigation and freezes for the theme capture.
// 页脚不在路由快照内但属于主题快照，因此导航时火焰继续运行，主题截取时冻结。
const THEME_TRANSITION_ATTRIBUTE = "data-neoverse-theme-view-transitioning";
const THEME_ATTRIBUTE = "data-theme";
const MAX_FRAME_STEP = 0.05;
const MAX_FRAME_SPAWNS = 4;
const TOP_FADE_PX = 10;

interface FlameState {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  particles: EmberParticle[];
  palette: FlamePalette;
  glyphs: EmberGlyph[];
  width: number;
  height: number;
  frame: number;
  last: number;
  visible: boolean;
  disposed: boolean;
}

export interface FlameCanvas {
  remeasure: () => void;
  dispose: () => void;
}

/**
 * Read one box per glyph so embers leave the letters themselves, not the line box.
 * 逐字读取盒子，让余烬从字母本身离开，而不是整行盒子。
 */
function measureGlyphs(host: HTMLElement, origin: DOMRectReadOnly): EmberGlyph[] {
  const glyphs: EmberGlyph[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!character || character.trim() === "") continue;
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const box = range.getBoundingClientRect();
      if (box.width < 0.5 || box.height < 0.5) continue;
      glyphs.push({
        x: box.left - origin.left,
        y: box.top - origin.top,
        width: box.width,
        height: box.height,
      });
    }
  }
  return glyphs;
}

function emberSprite(palette: FlamePalette, heat: number): HTMLCanvasElement {
  if (heat > 0.74) return palette.core;
  if (heat < 0.26) return palette.blush;
  return palette.body;
}

function paintFlame(state: FlameState) {
  const { context, palette } = state;
  context.clearRect(0, 0, state.width, state.height);
  context.globalCompositeOperation = palette.blend;
  for (const particle of state.particles) {
    const burned = particle.age / particle.life;
    // Embers fade into the canvas top instead of being cut off by it.
    // 余烬在画布顶部渐隐，而不是被边缘裁断。
    const edge = Math.min(1, Math.max(0, particle.y / TOP_FADE_PX));
    // A slow flicker keeps the plume alive instead of reading as drifting smoke.
    // 缓慢的闪烁让火舌保持活性，而不是像飘散的烟。
    const flicker = 0.78 + 0.22 * Math.sin(particle.sway * 2.6 + particle.age * 9);
    const alpha =
      (1 - burned) ** 1.2 * palette.strength * edge * flicker * (0.5 + particle.heat * 0.5);
    if (alpha < 0.01) continue;
    const radius = particle.size * (1 + burned * 0.9);
    // The soft halo carries the warm light; core, body and blush carry the ember itself.
    // 柔边光晕承载暖光；核心、主体与浅红承载余烬本身。
    const haloRadius = radius * 2.4;
    context.globalAlpha = alpha * 0.34;
    context.drawImage(
      palette.halo,
      particle.x - haloRadius,
      particle.y - haloRadius,
      haloRadius * 2,
      haloRadius * 2,
    );
    // A faster ember stretches taller, the way a flame tongue does.
    // 速度越快的余烬拉得越高，像火舌一样。
    const height = radius * 2 * (1 + Math.min(1.1, Math.abs(particle.vy) / 45));
    const cool = particle.heat < 0.26;
    context.globalAlpha = cool ? alpha * 0.8 : alpha;
    context.drawImage(
      emberSprite(palette, particle.heat),
      particle.x - radius,
      particle.y - height * 0.68,
      radius * 2,
      height,
    );
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}

function tickFlame(state: FlameState) {
  // A paused capture can leave a stale timestamp; clamp so embers never jump.
  // 暂停截取会留下过期时间戳；限制步长，使余烬不会跳帧。
  const now = performance.now();
  const dt = Math.min(MAX_FRAME_STEP, Math.max(0, (now - state.last) / 1000));
  state.last = now;
  if (state.width > 1 && state.height > 1) {
    const target = emberCount(state.glyphs);
    let spawned = 0;
    while (state.particles.length < target && spawned < MAX_FRAME_SPAWNS) {
      const ember = spawnEmber(state.glyphs, Math.random);
      if (!ember) break;
      state.particles.push(ember);
      spawned += 1;
    }
    stepEmbers(state.particles, dt, state.height);
    paintFlame(state);
  }
  state.frame = requestAnimationFrame(() => tickFlame(state));
}

function syncFlame(state: FlameState) {
  const shouldRun =
    state.visible &&
    !document.hidden &&
    !document.documentElement.hasAttribute(THEME_TRANSITION_ATTRIBUTE);
  if (shouldRun && state.frame === 0) {
    state.last = performance.now();
    state.frame = requestAnimationFrame(() => tickFlame(state));
    return;
  }
  if (!shouldRun && state.frame !== 0) {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
  }
}

function measureFlame(state: FlameState) {
  const box = state.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(box.width));
  const nextHeight = Math.max(1, Math.round(box.height));
  const resized = nextWidth !== state.width || nextHeight !== state.height;
  state.width = nextWidth;
  state.height = nextHeight;
  state.canvas.width = Math.round(nextWidth * ratio);
  state.canvas.height = Math.round(nextHeight * ratio);
  state.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.glyphs = box.width > 1 && box.height > 1 ? measureGlyphs(state.host, box) : [];
  // Embers from the previous text or size would float over the new layout.
  // 旧文字或旧尺寸留下的余烬会飘在新布局上。
  if (resized) state.particles.length = 0;
  paintFlame(state);
}

/**
 * Wire the observers that decide when the flame may paint; the returned function tears them down.
 * 接上决定火焰是否可以绘制的观察器，返回的函数负责全部拆除。
 */
function watchFlame(state: FlameState): () => void {
  const { host } = state;
  const resizeObserver = new ResizeObserver(() => measureFlame(state));
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver((entries) => {
    state.visible = entries.some((entry) => entry.isIntersecting);
    syncFlame(state);
  });
  intersectionObserver.observe(host);
  // Rebuild the palette on every theme mutation so the next frame matches the new tokens.
  // 每次主题属性变化都重建配色，使下一帧与新 token 一致。
  const themeObserver = new MutationObserver(() => {
    state.palette = createPalette(host);
    syncFlame(state);
    if (state.frame === 0) paintFlame(state);
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE, THEME_TRANSITION_ATTRIBUTE],
  });
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const syncColorScheme = () => {
    state.palette = createPalette(host);
  };
  colorScheme.addEventListener("change", syncColorScheme);
  const syncVisibility = () => syncFlame(state);
  document.addEventListener("visibilitychange", syncVisibility);
  if (document.fonts)
    void document.fonts.ready.then(() => {
      if (!state.disposed) measureFlame(state);
    });
  return () => {
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    themeObserver.disconnect();
    colorScheme.removeEventListener("change", syncColorScheme);
    document.removeEventListener("visibilitychange", syncVisibility);
  };
}

/**
 * Mount the tagline flame; returns null when the canvas has no 2D context.
 * 挂载标语火焰；画布没有 2D 上下文时返回 null。
 */
export function mountFlameCanvas(host: HTMLElement, canvas: HTMLCanvasElement): FlameCanvas | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const state: FlameState = {
    host,
    canvas,
    context,
    particles: [],
    palette: createPalette(host),
    glyphs: [],
    width: 0,
    height: 0,
    frame: 0,
    last: 0,
    visible: false,
    disposed: false,
  };
  const release = watchFlame(state);
  measureFlame(state);
  return {
    remeasure: () => measureFlame(state),
    dispose: () => {
      state.disposed = true;
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      release();
      context.clearRect(0, 0, state.width, state.height);
    },
  };
}
