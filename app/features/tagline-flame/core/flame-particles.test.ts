import { expect, test } from "bun:test";
import { type EmberGlyph, emberCount, spawnEmber, stepEmbers } from "./flame-particles";

const GLYPH: EmberGlyph = { x: 10, y: 20, width: 12, height: 16 };

/** Replay fixed random samples so spawn geometry stays deterministic.
 *  以固定随机值复现，保证生成位置可断言。 */
function sequence(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

test("ember count follows the glyph area inside fixed bounds", () => {
  expect(emberCount([])).toBe(16);
  expect(emberCount([GLYPH])).toBe(16);
  const wide: EmberGlyph = { x: 0, y: 0, width: 60, height: 30 };
  expect(emberCount(Array.from({ length: 100 }, () => wide))).toBe(72);
  // Mid-range areas grow with the measured ink.
  // 中间区间随实测字形面积增长。
  const medium = Array.from({ length: 60 }, () => GLYPH);
  expect(emberCount(medium)).toBe(Math.round((60 * GLYPH.width * GLYPH.height) / 500));
});

test("spawn stays inside the lower half of a glyph", () => {
  const ember = spawnEmber([GLYPH], sequence([0.999, 0.999, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0]));
  expect(ember).not.toBeNull();
  if (!ember) return;
  expect(ember.x).toBeGreaterThanOrEqual(GLYPH.x);
  expect(ember.x).toBeLessThanOrEqual(GLYPH.x + GLYPH.width);
  expect(ember.y).toBeGreaterThanOrEqual(GLYPH.y + GLYPH.height * 0.45);
  expect(ember.y).toBeLessThanOrEqual(GLYPH.y + GLYPH.height);
  expect(ember.vy).toBeLessThan(0);
  expect(ember.life).toBeGreaterThan(0);
});

test("spawn returns null without glyphs", () => {
  expect(spawnEmber([], sequence([0.5]))).toBeNull();
});

test("embers rise, burn out and leave the canvas", () => {
  const spawned = spawnEmber([GLYPH], sequence([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0.5]));
  if (!spawned) throw new Error("expected an ember");
  const particles = [spawned];
  const startY = spawned.y;
  stepEmbers(particles, 0.1, 400);
  expect(particles).toHaveLength(1);
  expect(particles[0]?.y).toBeLessThan(startY);
  expect(particles[0]?.age).toBeCloseTo(0.1);
  stepEmbers(particles, 5, 400);
  expect(particles).toHaveLength(0);
});

test("embers beyond the canvas are dropped then replaced by new spawns", () => {
  const particles = [{ x: 0, y: 4, vx: 0, vy: -400, age: 0, life: 9, size: 1, heat: 0.5, sway: 0 }];
  stepEmbers(particles, 0.1, 400);
  expect(particles).toHaveLength(0);
  const replacement = spawnEmber([GLYPH], sequence([0, 0, 0, 0, 0, 0, 0, 0]));
  expect(replacement?.y).toBeGreaterThan(0);
});
