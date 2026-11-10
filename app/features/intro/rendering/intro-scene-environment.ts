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
