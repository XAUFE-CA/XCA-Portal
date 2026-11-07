import { expect, test } from "bun:test";
import { mix, relativeLuminance } from "./flame-palette";

test("mix interpolates each channel and pins at both ends", () => {
  expect(mix([0, 0, 0], [255, 255, 255], 0)).toEqual([0, 0, 0]);
  expect(mix([0, 0, 0], [255, 255, 255], 1)).toEqual([255, 255, 255]);
  expect(mix([252, 165, 165], [251, 191, 36], 0.45)).toEqual([252, 177, 107]);
});

test("relative luminance separates light and dark surfaces", () => {
  expect(relativeLuminance([0, 0, 0])).toBe(0);
  expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  // The threshold that picks the amber blend sits between the two theme surfaces.
  // 在琥珀配色之间做取舍的阈值落在两种主题底面之间。
  expect(relativeLuminance([210, 210, 210])).toBeGreaterThan(0.45);
  expect(relativeLuminance([128, 128, 128])).toBeLessThan(0.45);
});
