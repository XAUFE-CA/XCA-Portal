import {
  CanvasTexture,
  type Color,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import type { IntroPalette } from "./intro-scene-palette";

export interface IntroEnvironment {
  update(palette: IntroPalette): Texture;
  dispose(): void;
}

/** A cool blue room reflection replaces the neutral white box; colors follow the room palette.
    冷蓝室内反射取代中性白色反射箱，颜色跟随报告厅配色。 */
function auditoriumTexture(palette: IntroPalette) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Intro room reflection unavailable");
  const room = palette.auditorium;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, room.keyLight.getStyle());
  gradient.addColorStop(0.3, room.panel.getStyle());
  gradient.addColorStop(0.48, room.glass.getStyle());
  gradient.addColorStop(0.62, room.structure.getStyle());
  gradient.addColorStop(1, room.floor.getStyle());
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Horizontal coves and slender uprights give glass a legible blue highlight pattern.
  // 水平灯槽与细竖向亮条让玻璃呈现可辨认的蓝色高光纹样。
  context.globalCompositeOperation = "screen";
  context.fillStyle = room.accentLight.getStyle();
  context.globalAlpha = 0.75;
  for (const y of [38, 92, 146]) context.fillRect(0, y, canvas.width, 5);
  context.globalAlpha = 0.35;
  for (let x = 24; x < canvas.width; x += 96) context.fillRect(x, 0, 10, canvas.height * 0.5);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}

export function createAuditoriumEnvironment(renderer: WebGLRenderer): IntroEnvironment {
  const generator = new PMREMGenerator(renderer);
  let cached: WebGLRenderTarget | undefined;
  let key = "";
  return {
    update(palette) {
      const next = [
        palette.auditorium.keyLight,
        palette.auditorium.panel,
        palette.auditorium.glass,
        palette.auditorium.structure,
        palette.auditorium.floor,
        palette.auditorium.accentLight,
      ]
        .map((color) => color.getHexString())
        .join(":");
      if (cached && key === next) return cached.texture;
      const source = auditoriumTexture(palette);
      try {
        const target = generator.fromEquirectangular(source);
        cached?.dispose();
        cached = target;
        key = next;
        return target.texture;
      } finally {
        source.dispose();
      }
    },
    dispose() {
      cached?.dispose();
      cached = undefined;
      generator.dispose();
    },
  };
}

function lightFace(
  context: CanvasRenderingContext2D,
  color: Color,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save();
  context.translate(x, y);
  context.scale(width, height);
  const glow = context.createRadialGradient(0, 0, 0.05, 0, 0, 1);
  glow.addColorStop(0, color.getStyle());
  glow.addColorStop(0.24, color.getStyle());
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(-1, -1, 2, 2);
  context.restore();
}

function skyTexture(palette: IntroPalette) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Intro reflection sky unavailable");
  // A colored sky and separate broad emitters replace the white reflection room.
  // 有色天空与分离的宽面光源取代白色反光箱，粗糙表面仍使用真实 PMREM。
  const sky = context.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, palette.skyTop.getStyle());
  sky.addColorStop(0.3, palette.skyTop.getStyle());
  sky.addColorStop(0.48, palette.skyHorizon.getStyle());
  sky.addColorStop(0.56, palette.haze.getStyle());
  sky.addColorStop(0.68, palette.pavement.getStyle());
  sky.addColorStop(1, palette.fabric.getStyle());
  context.fillStyle = sky;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "screen";
  // Compact colored emitters avoid a broad white strip across metal rooftops.
  // 紧凑有色光面避免金属屋顶铺满大块白色反射。
  context.globalAlpha = 0.06 + palette.daylight * 0.46;
  lightFace(context, palette.keyLight, 84, 82, 56, 34);
  context.globalAlpha = 0.08 + palette.daylight * 0.52;
  lightFace(context, palette.fillLight, 286, 64, 90, 40);
  context.globalAlpha = 0.12 + palette.daylight * 0.78;
  lightFace(context, palette.rimLight, 400, 118, 48, 34);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}

export function createIntroEnvironment(renderer: WebGLRenderer): IntroEnvironment {
  const generator = new PMREMGenerator(renderer);
  const cache = new Map<string, WebGLRenderTarget>();
  return {
    update(palette) {
      const key = [
        palette.skyTop,
        palette.skyHorizon,
        palette.haze,
        palette.pavement,
        palette.fabric,
        palette.keyLight,
        palette.fillLight,
        palette.rimLight,
      ]
        .map((color) => color.getHexString())
        .join(":");
      const existing = cache.get(key);
      if (existing) return existing.texture;
      const source = skyTexture(palette);
      let target: WebGLRenderTarget;
      try {
        target = generator.fromEquirectangular(source);
      } finally {
        source.dispose();
      }
      cache.set(key, target);
      if (cache.size > 2) {
        const oldest = cache.entries().next().value;
        if (oldest) {
          cache.delete(oldest[0]);
          oldest[1].dispose();
        }
      }
      return target.texture;
    },
    dispose() {
      for (const target of cache.values()) target.dispose();
      cache.clear();
      generator.dispose();
    },
  };
}
