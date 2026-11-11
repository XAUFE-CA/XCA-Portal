import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  type MeshStandardMaterial,
  NoColorSpace,
} from "three";
import {
  CITY_LED_FRAME_MATERIAL,
  CITY_LED_MATERIAL,
  CITY_LED_PATTERN_U,
  CITY_LED_PORTRAIT_U,
  CITY_LED_VARIANTS,
} from "./intro-city-led";
import type { IntroPalette } from "./intro-scene-palette";

const TILE_WIDTH = 512;
const TILE_HEIGHT = 288;
const PORTRAIT_HEIGHT = 912;
const ATLAS_HEIGHT = TILE_HEIGHT + PORTRAIT_HEIGHT;
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

// Channels encode primary, accent and neutral artwork masks, never baked display colors.
// 通道编码主色、辅色和中性图案遮罩，不烘焙显示颜色。
const PRIMARY = "rgb(228, 0, 0)";
const ACCENT = "rgb(0, 224, 0)";
const NEUTRAL = "rgb(0, 0, 208)";

function pixelWord(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
) {
  context.fillStyle = PRIMARY;
  let glyphX = x;
  for (const letter of text) {
    const rows = GLYPHS[letter] ?? [];
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < 5; column++) {
        if (rows[row]?.[column] === "1")
          context.fillRect(glyphX + column * scale, y + row * scale, scale, scale);
      }
    }
    glyphX += 6 * scale;
  }
}

function trace(context: CanvasRenderingContext2D, points: readonly number[], color: string) {
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let index = 2; index < points.length; index += 2)
    context.lineTo(points[index] ?? 0, points[index + 1] ?? 0);
  context.stroke();
}

function circuitry(context: CanvasRenderingContext2D) {
  context.lineWidth = 2;
  for (let index = 0; index < 6; index++) {
    const y = 38 + index * 37;
    trace(
      context,
      [20, y, 30 + index * 7, y, 46 + index * 7, y + 16, 82, y + 16],
      index % 2 ? "rgb(0, 72, 0)" : "rgb(80, 0, 0)",
    );
    trace(
      context,
      [300, y, 320, y, 336, y + 16, 486, y + 16],
      index % 2 ? "rgb(0, 120, 0)" : "rgb(116, 0, 0)",
    );
  }
  context.fillStyle = "rgb(0, 0, 60)";
  for (let row = 0; row < 12; row++) {
    for (let column = 0; column < 10; column++) {
      if ((row * 7 + column * 11) % 13 < 4)
        context.fillRect(348 + column * 12, 74 + row * 12, 4, 4);
    }
  }
  pixelWord(context, "XCA", 54, 91, 13);
  context.fillStyle = ACCENT;
  context.fillRect(348, 237, 78, 5);
  context.fillStyle = NEUTRAL;
  context.fillRect(434, 237, 32, 5);
}

function poster(context: CanvasRenderingContext2D) {
  context.fillStyle = "rgb(20, 5, 0)";
  context.fillRect(12, 12, TILE_WIDTH - 24, PORTRAIT_HEIGHT - 24);
  context.lineWidth = 6;
  trace(context, [34, 272, 34, 48, 172, 48], PRIMARY);
  trace(context, [478, 348, 478, 48, 340, 48], ACCENT);
  pixelWord(context, "XCA", 64, 114, 22);
  context.lineWidth = 18;
  for (let ring = 0; ring < 3; ring++) {
    context.strokeStyle = ring % 2 ? ACCENT : PRIMARY;
    context.beginPath();
    const start = ring * 0.9;
    context.arc(256, 556, 118 + ring * 31, start, start + Math.PI * 1.5);
    context.stroke();
  }
  context.lineWidth = 12;
  trace(context, [118, 692, 256, 420, 394, 692, 118, 692], NEUTRAL);
  context.fillStyle = PRIMARY;
  context.fillRect(236, 536, 40, 40);
  context.fillStyle = ACCENT;
  context.fillRect(64, 800, 248, 36);
  context.fillStyle = NEUTRAL;
  context.fillRect(326, 800, 122, 36);
  context.fillStyle = PRIMARY;
  context.fillRect(64, 852, 384, 8);
}

function waveform(context: CanvasRenderingContext2D, height: number) {
  pixelWord(context, "LIVE", 34, 22, height > 400 ? 18 : 6);
  context.lineWidth = 7;
  for (let layer = 0; layer < 4; layer++) {
    context.strokeStyle = layer % 2 ? PRIMARY : ACCENT;
    context.beginPath();
    for (let step = 0; step <= 96; step++) {
      const x = 28 + step * 4.75;
      const y = height * 0.4 + Math.sin(step * 0.12 + layer * 0.7) * height * 0.16 + layer * 12;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  for (let bar = 0; bar < 32; bar++) {
    const length = (0.08 + Math.abs(Math.sin(bar * 0.28)) * 0.19) * height;
    context.fillStyle = bar % 5 === 0 ? NEUTRAL : PRIMARY;
    context.fillRect(34 + bar * 14, height * 0.88 - length, 8, length);
  }
}

function matrix(context: CanvasRenderingContext2D, height: number) {
  pixelWord(context, "NEXT", 48, 22, height > 400 ? 17 : 5);
  const cy = height * 0.46;
  const size = Math.min(116, height * 0.22);
  context.lineWidth = 9;
  context.strokeStyle = PRIMARY;
  context.strokeRect(256 - size, cy - size, size * 2, size * 2);
  context.lineWidth = 4;
  context.strokeStyle = NEUTRAL;
  context.strokeRect(256 - size * 0.6, cy - size * 0.6, size * 1.2, size * 1.2);
  for (let port = 0; port < 6; port++) {
    const y = cy - size + ((port + 0.5) * size) / 3;
    trace(context, [28, y + 24, 76, y + 24, 100, y, 256 - size, y], port % 2 ? ACCENT : PRIMARY);
    trace(context, [484, y - 24, 436, y - 24, 412, y, 256 + size, y], port % 2 ? PRIMARY : ACCENT);
  }
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 8; column++) {
      context.fillStyle = (column + row * 3) % 5 === 0 ? NEUTRAL : ACCENT;
      context.fillRect(48 + column * 53, height * 0.79 + row * 18, 34, 10);
    }
  }
}

function constellation(context: CanvasRenderingContext2D, height: number) {
  pixelWord(context, "ORBIT", 38, 22, height > 400 ? 14 : 5);
  const cy = height * 0.44;
  const radius = Math.min(180, height * 0.3);
  context.lineWidth = 4;
  context.strokeStyle = PRIMARY;
  for (let meridian = 1; meridian <= 5; meridian++) {
    context.beginPath();
    context.ellipse(256, cy, (radius * meridian) / 5, radius, -0.3, 0, Math.PI * 2);
    context.stroke();
  }
  for (let parallel = -2; parallel <= 2; parallel++) {
    context.beginPath();
    context.ellipse(
      256,
      cy + parallel * radius * 0.3,
      radius * Math.sqrt(1 - (parallel * 0.3) ** 2),
      radius * 0.12,
      -0.3,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  context.lineWidth = 12;
  context.strokeStyle = ACCENT;
  context.beginPath();
  context.ellipse(256, cy, radius * 1.25, radius * 0.48, -0.6, 0.3, Math.PI * 1.8);
  context.stroke();
  context.fillStyle = NEUTRAL;
  context.fillRect(256 + radius * 0.8, cy - radius * 0.4, 18, 18);
  context.fillStyle = PRIMARY;
  context.fillRect(76, height * 0.83, 360, 12);
  context.fillStyle = NEUTRAL;
  context.fillRect(76, height * 0.87, 144, 6);
}

function cityscape(context: CanvasRenderingContext2D, height: number) {
  pixelWord(context, "CITY", 38, 24, height > 400 ? 18 : 9);
  const ground = height * 0.76;
  context.lineWidth = 3;
  trace(context, [28, ground, 484, ground], NEUTRAL);
  for (let block = 0; block < 9; block++) {
    const x = 34 + block * 51;
    const rise = height * (0.15 + ((block * 7) % 9) * 0.035);
    context.fillStyle = block % 3 === 0 ? ACCENT : PRIMARY;
    context.fillRect(x, ground - rise, 38, rise);
    context.fillStyle = NEUTRAL;
    for (let row = 0; row < 4; row++)
      context.fillRect(x + 7, ground - rise + 12 + row * rise * 0.17, 24, 4);
  }
  context.lineWidth = 12;
  trace(
    context,
    [34, height * 0.88, 176, height * 0.88, 228, height * 0.82, 478, height * 0.82],
    ACCENT,
  );
}

function exhibition(context: CanvasRenderingContext2D, height: number) {
  pixelWord(context, "FORM", 40, 30, height > 400 ? 18 : 9);
  const cy = height * 0.56;
  const size = Math.min(116, height * 0.24);
  context.fillStyle = ACCENT;
  context.beginPath();
  context.arc(170, cy, size, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = PRIMARY;
  context.fillRect(252, cy - size, size * 1.5, size * 2);
  context.lineWidth = 7;
  trace(context, [82, cy + size, 256, cy - size * 1.3, 430, cy + size, 82, cy + size], NEUTRAL);
  context.fillStyle = NEUTRAL;
  context.fillRect(40, height * 0.88, 260, 8);
  context.fillStyle = ACCENT;
  context.fillRect(322, height * 0.88, 150, 8);
}

/**
 * Generate original static artwork once; glyphs need no font, image or external license.
 * 一次生成原创静态图案；字形不依赖字体、图像或外部授权。
 */
export function createLedTexture(anisotropy = 1): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_WIDTH * CITY_LED_VARIANTS;
  canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create the intro LED atlas");
  context.fillStyle = "rgb(0, 0, 0)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  type Artwork = (target: CanvasRenderingContext2D, height: number) => void;
  const compositions: readonly (readonly [Artwork, Artwork])[] = [
    [circuitry, poster],
    [constellation, waveform],
    [waveform, matrix],
    [matrix, constellation],
    [cityscape, exhibition],
    [exhibition, cityscape],
  ];
  let tile = 0;
  for (const pair of compositions) {
    let y = 0;
    for (const art of pair) {
      const height = y === 0 ? TILE_HEIGHT : PORTRAIT_HEIGHT;
      context.save();
      context.translate(tile * TILE_WIDTH, y);
      context.beginPath();
      context.rect(12, 12, TILE_WIDTH - 24, height - 24);
      context.clip();
      context.fillStyle = "rgb(0, 0, 0)";
      context.fillRect(0, 0, TILE_WIDTH, height);
      art(context, height);
      context.restore();
      y += TILE_HEIGHT;
    }
    tile++;
  }
  const texture = new CanvasTexture(canvas);
  texture.name = "intro-city-led-data";
  texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(4, anisotropy);
  // Canvas top maps to UV y=1, matching the authored top-left front vertex.
  // Canvas 顶部对应 UV y=1，与原始正面左上顶点一致。
  texture.flipY = true;
  return texture;
}

export const LED_DECLARATIONS = `
uniform sampler2D uIntroLed;
uniform vec3 uIntroLedBlue;
uniform vec3 uIntroLedAccent;
uniform vec3 uIntroLedWarm;
uniform vec3 uIntroLedRose;
uniform vec3 uIntroLedGreen;
uniform vec3 uIntroLedSurface;
`;

export const LED_SURFACE = `
float introLedTile = floor(vIntroUv.x / ${CITY_LED_PATTERN_U.toFixed(1)});
float introLedShape = vIntroUv.x - introLedTile * ${CITY_LED_PATTERN_U.toFixed(1)};
float introLedPortrait = step(${(CITY_LED_PORTRAIT_U - 0.5).toFixed(1)}, introLedShape);
float introLedHeight = mix(${TILE_HEIGHT.toFixed(1)}, ${PORTRAIT_HEIGHT.toFixed(1)}, introLedPortrait);
vec2 introLedSize = vec2(${TILE_WIDTH.toFixed(1)}, introLedHeight);
vec2 introLedLocal = vec2(introLedShape - introLedPortrait * ${CITY_LED_PORTRAIT_U.toFixed(1)}, vIntroUv.y);
vec2 introLedUv = clamp(introLedLocal, 0.5 / introLedSize, 1.0 - 0.5 / introLedSize);
vec2 introLedAtlas = vec2((introLedTile + introLedUv.x) / ${CITY_LED_VARIANTS.toFixed(1)}, (introLedUv.y * introLedHeight + (1.0 - introLedPortrait) * ${PORTRAIT_HEIGHT.toFixed(1)}) / ${ATLAS_HEIGHT.toFixed(1)});
vec3 introLedMask = texture2D(uIntroLed, introLedAtlas).rgb;
vec2 introLedPixel = introLedLocal * introLedSize;
vec2 introLedWidth = fwidth(introLedPixel);
float introLedResolution = 1.0 - smoothstep(0.25, 0.85, max(introLedWidth.x, introLedWidth.y));
vec2 introLedAperture = smoothstep(vec2(0.30), vec2(0.48), abs(fract(introLedPixel) - 0.5));
float introLedPixelGain = 1.0 - max(introLedAperture.x, introLedAperture.y) * introLedResolution * 0.14;
vec3 introLedPrimary = uIntroLedBlue;
vec3 introLedSecondary = uIntroLedAccent;
if (introLedTile < 0.5) {
  introLedSecondary = uIntroLedGreen;
} else if (introLedTile < 1.5) {
  introLedPrimary = uIntroLedAccent;
  introLedSecondary = uIntroLedRose;
} else if (introLedTile < 2.5) {
  introLedPrimary = uIntroLedRose;
  introLedSecondary = mix(uIntroLedAccent, uIntroLedBlue, 0.5);
} else if (introLedTile < 3.5) {
  introLedPrimary = uIntroLedGreen;
  introLedSecondary = uIntroLedBlue;
} else if (introLedTile < 4.5) {
  introLedSecondary = uIntroLedAccent;
} else {
  introLedPrimary = mix(uIntroLedBlue, uIntroLedAccent, 0.6);
  introLedSecondary = uIntroLedGreen;
}
float introLedNight = clamp(uIntroNight, 0.0, 1.0);
float introLedCoverage = clamp(dot(introLedMask, vec3(1.0)), 0.0, 1.0);
vec3 introLedBase = uIntroLedSurface;
if (introLedNight < 1.0) {
  vec3 introLedBaseStart = mix(uIntroLedSurface, uIntroLedBlue, 0.35);
  vec3 introLedBaseEnd = mix(uIntroLedSurface, uIntroLedGreen, 0.5);
  if (introLedTile > 0.5 && introLedTile < 1.5) {
    introLedBaseStart = mix(uIntroLedSurface, uIntroLedAccent, 0.65);
    introLedBaseEnd = mix(uIntroLedSurface, uIntroLedRose, 0.45);
  } else if (introLedTile < 2.5 && introLedTile > 1.5) {
    introLedBaseStart = mix(uIntroLedSurface, uIntroLedBlue, 0.6);
    introLedBaseEnd = mix(uIntroLedSurface, uIntroLedRose, 0.6);
  } else if (introLedTile < 3.5 && introLedTile > 2.5) {
    introLedBaseStart = mix(uIntroLedSurface, uIntroLedGreen, 0.65);
    introLedBaseEnd = mix(uIntroLedSurface, uIntroOffice, 0.18);
  } else if (introLedTile < 4.5 && introLedTile > 3.5) {
    introLedBaseStart = mix(uIntroLedSurface, uIntroLedAccent, 0.55);
    introLedBaseEnd = mix(uIntroLedSurface, uIntroLedBlue, 0.15);
  } else if (introLedTile > 4.5) {
    introLedBaseStart = mix(uIntroLedSurface, uIntroLedRose, 0.5);
    introLedBaseEnd = mix(uIntroLedSurface, uIntroLedAccent, 0.45);
  }
  vec2 introLedWashUv = mix(introLedUv, introLedUv.yx, mod(introLedTile, 2.0));
  float introLedWash = smoothstep(0.0, 1.0, introLedWashUv.y * 0.72 + introLedWashUv.x * 0.28);
  vec2 introLedSpot = vec2(0.22 + mod(introLedTile, 2.0) * 0.56, 0.72 - step(2.5, introLedTile) * 0.34);
  float introLedSoftLight = 1.0 - smoothstep(0.0, 0.9, length(introLedUv - introLedSpot));
  introLedBase = mix(introLedBaseStart, introLedBaseEnd, introLedWash) * mix(0.88, 1.12, introLedSoftLight);
}
vec3 introLedInk = introLedPrimary * introLedMask.r + introLedSecondary * introLedMask.g
  + mix(mix(uIntroOffice, uIntroLedBlue, 0.12) * 0.7, uIntroOffice * 0.65, introLedNight) * introLedMask.b;
// Emission, not sunlit albedo, carries daylight artwork into scene captures and HDR.
// 日间图案通过自发光而非日照反照率进入场景反射捕获与 HDR。
vec3 introLedDayDiffuse = mix(introLedBase, introLedInk / max(introLedCoverage, 0.001), introLedCoverage) * 0.12;
diffuseColor.rgb = mix(introLedDayDiffuse, diffuseColor.rgb, introLedNight);
vec3 introLedBackground = mix(introLedBase * 0.16 * (1.0 - introLedCoverage), uIntroLedBlue * 0.004, introLedNight);
introLedRadiance = (introLedInk + introLedBackground) * introLedPixelGain;
`;

export const LED_EMISSION = `
if (introSelector == ${CITY_LED_MATERIAL.toFixed(1)}) {
  totalEmissiveRadiance += introLedRadiance * mix(5.0, 8.0, clamp(uIntroNight, 0.0, 1.0));
}
`;

export interface LedUniforms {
  uIntroLed: { value: CanvasTexture };
  uIntroLedBlue: { value: Color };
  uIntroLedAccent: { value: Color };
  uIntroLedWarm: { value: Color };
  uIntroLedRose: { value: Color };
  uIntroLedGreen: { value: Color };
  uIntroLedSurface: { value: Color };
}

export function createLedUniforms(anisotropy = 1) {
  return {
    uIntroLed: { value: createLedTexture(anisotropy) },
    uIntroLedBlue: { value: new Color() },
    uIntroLedAccent: { value: new Color() },
    uIntroLedWarm: { value: new Color() },
    uIntroLedRose: { value: new Color() },
    uIntroLedGreen: { value: new Color() },
    uIntroLedSurface: { value: new Color() },
  };
}

export function updateLedUniforms(uniforms: LedUniforms, palette: IntroPalette) {
  uniforms.uIntroLedBlue.value.copy(palette.ledBlue);
  uniforms.uIntroLedAccent.value.copy(palette.ledAccent);
  uniforms.uIntroLedWarm.value.copy(palette.ledWarm);
  uniforms.uIntroLedRose.value.copy(palette.ledRose);
  uniforms.uIntroLedGreen.value.copy(palette.ledGreen);
  uniforms.uIntroLedSurface.value.copy(palette.ledSurface);
}

export function updateLedMaterial(
  material: MeshStandardMaterial,
  selector: number,
  palette: IntroPalette,
) {
  const screen = selector === CITY_LED_MATERIAL;
  material.color.copy(screen ? palette.ledSurface : palette.ledFrame);
  material.roughness = 0.46;
  material.metalness =
    selector === CITY_LED_FRAME_MATERIAL ? 0.18 + (1 - palette.daylight) * 0.64 : 0;
  material.envMapIntensity = screen ? 0.2 : 0.45;
}
