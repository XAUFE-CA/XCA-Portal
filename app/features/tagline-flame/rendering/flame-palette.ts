/**
 * Token colors for the tagline flame; the canvas module only consumes the baked sprites.
 * 标语火焰的 token 配色；画布模块只使用烘好的精灵图。
 */
const SURFACE_TOKEN = "--neoverse-color-surface-canvas";
const BODY_TOKEN = "--neoverse-color-amber-400";
const BLUSH_TOKEN = "--neoverse-color-red-300";
const HALO_TOKENS = {
  light: "--neoverse-color-amber-300",
  dark: "--neoverse-color-amber-500",
} as const;
const CORE_TOKENS = {
  light: "--neoverse-color-amber-500",
  dark: "--neoverse-color-amber-200",
} as const;
const SPRITE_RADIUS = 16;
const LIGHT_SURFACE_LUMINANCE = 0.45;
// The blush leans on amber so the edge stays warm instead of turning into a pure red.
// 浅红偏琥珀，使边缘保持暖调，而不是变成正红。
const BLUSH_AMBER_SHARE = 0.45;

type Rgb = readonly [number, number, number];

export interface FlamePalette {
  halo: HTMLCanvasElement;
  body: HTMLCanvasElement;
  core: HTMLCanvasElement;
  blush: HTMLCanvasElement;
  blend: GlobalCompositeOperation;
  strength: number;
}

/**
 * Resolve a color token through a probe so var() chains and light-dark() land on real channels.
 * 通过探针解析颜色 token，使 var() 链与 light-dark() 落到真实通道值。
 */
export function resolveRgb(host: HTMLElement, token: string): Rgb {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${token})`;
  host.append(probe);
  try {
    const channels =
      getComputedStyle(probe)
        .color.match(/[\d.]+/g)
        ?.map(Number) ?? [];
    return [channels[0] ?? 128, channels[1] ?? 128, channels[2] ?? 128];
  } finally {
    probe.remove();
  }
}

/**
 * WCAG relative luminance; only the polarity decides between additive glow and warm overlay.
 * WCAG 相对亮度；只用来判断叠加发光还是暖色叠加。
 */
export function relativeLuminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

/**
 * Bake one soft ember into a sprite so a frame costs a single drawImage per particle.
 * 把一颗柔边余烬烘进精灵图，使每帧每颗粒子只花一次 drawImage。
 */
function createSprite([red, green, blue]: Rgb): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_RADIUS * 2;
  sprite.height = SPRITE_RADIUS * 2;
  const context = sprite.getContext("2d");
  if (!context) return sprite;
  const center = SPRITE_RADIUS;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 1)`);
  gradient.addColorStop(0.4, `rgba(${red}, ${green}, ${blue}, 0.5)`);
  gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, center * 2, center * 2);
  return sprite;
}

/**
 * Step through the amber scale so the embers stay yellow in both themes.
 * 沿琥珀色阶取色，使余烬在两种主题下都保持黄色。
 */
export function createPalette(host: HTMLElement): FlamePalette {
  const lightSurface = relativeLuminance(resolveRgb(host, SURFACE_TOKEN)) > LIGHT_SURFACE_LUMINANCE;
  const mode = lightSurface ? "light" : "dark";
  const body = resolveRgb(host, BODY_TOKEN);
  return {
    // Mixing toward black would read as smoke, so only the amber steps change per theme.
    // 向黑色混合会被看成黑烟，因此只按主题切换琥珀色阶。
    halo: createSprite(resolveRgb(host, HALO_TOKENS[mode])),
    body: createSprite(body),
    core: createSprite(resolveRgb(host, CORE_TOKENS[mode])),
    blush: createSprite(mix(resolveRgb(host, BLUSH_TOKEN), body, BLUSH_AMBER_SHARE)),
    // A light page has no headroom for additive light, so the warm hue is laid over the surface.
    // 浅色页面没有叠加发光的余地，暖色直接叠在底面上。
    blend: lightSurface ? "source-over" : "lighter",
    strength: lightSurface ? 0.72 : 0.9,
  };
}
