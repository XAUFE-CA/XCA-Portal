import { expect, test } from "bun:test";
import { Color } from "three";
import { AUDITORIUM_MATERIAL } from "../../core/intro-auditorium";
import {
  createAuditoriumMaterial,
  updateAuditoriumMaterial,
} from "../auditorium/intro-auditorium-surfaces";
import { createAuditoriumPalette, selectIntroSky } from "./intro-scene-palette";

const TOKENS: Record<string, string> = {
  "blue-50": "#f0f9ff",
  "blue-100": "#e0f2fe",
  "blue-200": "#bae6fd",
  "blue-300": "#7dd3fc",
  "blue-400": "#38bdf8",
  "blue-500": "#0ea5e9",
  "blue-700": "#0369a1",
  "blue-800": "#075985",
  "blue-900": "#0c4a6e",
  "blue-950": "#082f49",
  "cyan-100": "#cffafe",
  "cyan-200": "#a5f3fc",
  "cyan-300": "#67e8f9",
  "cyan-500": "#06b6d4",
  "amber-50": "#fffbeb",
  "amber-100": "#fef3c7",
  "amber-200": "#fde68a",
  "amber-300": "#fcd34d",
  "amber-400": "#fbbf24",
  "amber-700": "#b45309",
  "red-200": "#fecaca",
  "red-300": "#fca5a5",
  "red-400": "#f87171",
  "red-700": "#b91c1c",
  "green-400": "#4ade80",
  "green-700": "#15803d",
  "neutral-100": "#eaf3f8",
  "neutral-200": "#d8e7ef",
  "neutral-300": "#bfd4df",
  "neutral-400": "#9aaebb",
  "neutral-500": "#6c7f90",
  "neutral-800": "#263b50",
  "neutral-900": "#0f172a",
  white: "#ffffff",
  "accent-primary": "#38bdf8",
};

const read = (name: string) => {
  const value = TOKENS[name];
  if (!value) throw new Error(`Missing token ${name}`);
  return new Color(value);
};
const luminance = (color: Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
// Stand-ins for the homepage clear colour the renderer reads from the page shell.
// 渲染器从站点外壳读取的首页清屏色的替身。
const NIGHT_CANVAS = new Color("#0b1220");
const DAY_CANVAS = new Color("#f2f7fb");

test("night and day are separate skies, with stars exclusive to night", () => {
  const night = selectIntroSky(read, 0);
  const day = selectIntroSky(read, 1);
  expect(night.mode).toBe("night");
  expect(day.mode).toBe("day");
  expect(night.starIntensity).toBeGreaterThan(0);
  expect(day.starIntensity).toBe(0);
  expect(night.cloudCover).toBeLessThan(day.cloudCover);
  expect(night.sunGlow).toBeLessThan(day.sunGlow);
  expect(luminance(night.top)).toBeLessThan(0.05);
  // Blue dominates every band of the day sky; warmth belongs only to the sun and cloud rims.
  // 蓝色主导日景天空的每一层，暖色只属于太阳与云缘。
  for (const band of [day.top, day.mid, day.horizon, day.haze]) {
    expect(band.b).toBeGreaterThan(band.r);
  }
  expect(luminance(day.mid)).toBeGreaterThan(luminance(day.top));
  expect(day.sunColor.r).toBeGreaterThan(day.sunColor.b);
  expect(day.cloudShadow.b).toBeGreaterThan(day.cloudShadow.r);
  expect(day.cloudCover).toBeLessThan(0.6);
  // A hard theme split, not a daylight fade that leaves stars in a bright sky.
  // 硬性主题分界，不是会在明亮天空残留星点的日照渐隐。
  expect(selectIntroSky(read, 0.49).mode).toBe("night");
  expect(selectIntroSky(read, 0.5).mode).toBe("day");
  expect(selectIntroSky(read, 0.5).starIntensity).toBe(0);
});

test("auditorium separates blue upholstery from silver finishes and dims lighting at night", () => {
  const night = createAuditoriumPalette(read, 0, read("accent-primary"), NIGHT_CANVAS);
  const day = createAuditoriumPalette(read, 1, read("accent-primary"), DAY_CANVAS);
  for (const room of [night, day]) {
    expect(luminance(room.alloy)).toBeGreaterThan(luminance(room.fabric) * 5);
    expect(luminance(room.panel)).toBeGreaterThan(luminance(room.carpet) * 4);
    expect(room.fabric.b).toBeGreaterThan(room.fabric.r * 3);
    expect(room.keyLight.b / room.keyLight.r).toBeLessThan(1.1);
  }
  expect(night.lightIntensity).toBeLessThan(day.lightIntensity / 3);
  expect(luminance(night.alloy)).toBeGreaterThan(luminance(day.alloy) * 0.75);
});

test("auditorium walls borrow the page canvas instead of turning pure white", () => {
  const night = createAuditoriumPalette(read, 0, read("accent-primary"), NIGHT_CANVAS);
  const day = createAuditoriumPalette(read, 1, read("accent-primary"), DAY_CANVAS);
  // Night keeps one finish for structure and backdrop, now tinted by the dark canvas.
  // 夜间后墙与结构共用同一饰面，现在带有深色画布色调。
  expect(night.backdrop.equals(night.structure)).toBe(true);
  expect(luminance(night.structure)).toBeLessThan(luminance(day.structure));
  // Daylight stays bright enough to read as a projection wall, never as pure white.
  // 日间仍足够明亮以读作投影墙，但不再是纯白。
  expect(luminance(day.backdrop)).toBeGreaterThan(0.6);
  expect(luminance(day.backdrop)).toBeLessThan(0.85);
  expect(luminance(day.backdrop)).toBeGreaterThan(luminance(day.structure) * 1.15);
  expect(
    Math.max(day.backdrop.r, day.backdrop.g, day.backdrop.b) -
      Math.min(day.backdrop.r, day.backdrop.g, day.backdrop.b),
  ).toBeLessThan(0.12);
});

test("auditorium architecture stays matte and opaque without environment reflections", () => {
  const room = createAuditoriumPalette(read, 0, read("accent-primary"), NIGHT_CANVAS);
  for (const selector of [
    AUDITORIUM_MATERIAL.structure,
    AUDITORIUM_MATERIAL.ground,
    AUDITORIUM_MATERIAL.acoustic,
    AUDITORIUM_MATERIAL.wallBand,
  ]) {
    const material = createAuditoriumMaterial(selector);
    try {
      updateAuditoriumMaterial(material, selector, room);
      expect(material.roughness).toBeGreaterThanOrEqual(0.6);
      expect(material.envMapIntensity).toBe(0);
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
    } finally {
      material.dispose();
    }
  }
});
