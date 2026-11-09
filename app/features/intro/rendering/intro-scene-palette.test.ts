import { expect, test } from "bun:test";
import { Color } from "three";
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
  "red-200": "#fecaca",
  "red-300": "#fca5a5",
  "red-400": "#f87171",
  "neutral-200": "#d8e7ef",
  "neutral-400": "#9aaebb",
  white: "#ffffff",
  "accent-primary": "#38bdf8",
};

const read = (name: string) => {
  const value = TOKENS[name];
  if (!value) throw new Error(`Missing token ${name}`);
  return new Color(value);
};
const luminance = (color: Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

test("night and day are separate skies, with dense stars exclusive to night", () => {
  const night = selectIntroSky(read, 0);
  const day = selectIntroSky(read, 1);
  expect(night.mode).toBe("night");
  expect(day.mode).toBe("day");
  expect(night.starIntensity).toBe(1);
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

test("auditorium stays blue in both themes but night is clearly darker than day", () => {
  const night = createAuditoriumPalette(read, 0, read("accent-primary"));
  const day = createAuditoriumPalette(read, 1, read("accent-primary"));
  for (const room of [night, day]) {
    for (const surface of [room.structure, room.alloy, room.floor, room.panel, room.glass]) {
      expect(surface.b).toBeGreaterThan(surface.r);
      expect(luminance(surface)).toBeGreaterThan(0.05);
    }
  }
  expect(luminance(night.structure)).toBeLessThan(luminance(day.structure) * 0.6);
  expect(luminance(night.floor)).toBeLessThan(luminance(day.floor) * 0.6);
  expect(luminance(day.structure)).toBeGreaterThan(0.3);
  expect(day.environmentIntensity).toBeGreaterThan(night.environmentIntensity);
  // Bright blue coves survive the darker night exposure instead of dimming the whole room.
  // 明亮的蓝色灯槽在较暗夜景曝光下仍保持发光，不把整厅压黑。
  expect(luminance(night.accentLight)).toBeGreaterThan(0.4);
});
