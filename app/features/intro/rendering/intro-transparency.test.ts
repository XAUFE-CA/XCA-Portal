import { expect, test } from "bun:test";
import { createTransparentCity, sortTransparentCity } from "./intro-transparency";

function triangle(x: number, z: number, material: number): number[] {
  return [0, 1, 2].flatMap((index) => [x + index, 0, z, 0, 0, 1, material, 0]);
}

test("city faces sort back to front and preserve every vertex attribute", () => {
  const source = new Float32Array([
    ...triangle(0, -10, 5),
    ...triangle(10, -30, 6),
    ...triangle(20, -20, 8),
    ...triangle(0, 0, 1),
  ]);
  const city = createTransparentCity(source);
  expect(city.count).toBe(9);
  expect(sortTransparentCity(city, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toBe(true);
  expect(city.order).toEqual([1, 2, 0]);
  expect([...city.sorted.slice(0, 24)]).toEqual([...source.slice(24, 48)]);
  expect([...city.source]).toEqual([...source.slice(0, 72)]);
  expect(sortTransparentCity(city, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 500])).toBe(false);
  expect(sortTransparentCity(city, [1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0])).toBe(true);
  expect(city.order).toEqual([2, 1, 0]);
});

test("equal-depth faces keep deterministic ordering and non-city geometry stays out", () => {
  const city = createTransparentCity(
    new Float32Array([...triangle(0, -10, 5), ...triangle(0, -10, 6), ...triangle(0, 0, 7)]),
  );
  sortTransparentCity(city, []);
  expect(city.order).toEqual([0, 1]);
  expect(city.sorted.length).toBe(48);
});
