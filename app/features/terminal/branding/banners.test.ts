import { expect, test } from "bun:test";
import { BANNERS, bannerWidth, selectBanner } from "./banners";

test("block wordmark uses clean ANSI Shadow lettering without hash pixels", () => {
  for (const banner of Object.values(BANNERS)) {
    expect(banner).not.toContain("#");
    expect(banner).not.toContain("+");
  }
  expect(BANNERS.wide).toContain("██");
  expect(BANNERS.wide).toContain("╚");
  expect(BANNERS.wide.split("\n")).toHaveLength(6);
  expect(BANNERS.compact.split("\n")).toHaveLength(13);
  expect(BANNERS.narrow.split("\n")).toHaveLength(8);
  expect(BANNERS.narrow).toContain("WELCOME TO");
  expect(bannerWidth(BANNERS.wide)).toBeLessThan(130);
  expect(bannerWidth(BANNERS.compact)).toBeLessThan(70);
  expect(bannerWidth(BANNERS.narrow)).toBeLessThan(30);
});

test("wordmark variants use available terminal columns", () => {
  expect(selectBanner(130)).toBe(BANNERS.wide);
  expect(selectBanner(80)).toBe(BANNERS.compact);
  expect(selectBanner(30)).toBe(BANNERS.narrow);
  expect(selectBanner(15)).toBe(BANNERS.plain);
  for (let columns = 14; columns <= 160; columns++)
    expect(bannerWidth(selectBanner(columns))).toBeLessThanOrEqual(columns);
});
