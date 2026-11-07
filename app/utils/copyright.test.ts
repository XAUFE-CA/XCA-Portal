import { expect, test } from "bun:test";
import { copyrightYears } from "./copyright";

test("shows the first year alone through 2026 and a range afterwards", () => {
  expect(copyrightYears(2026)).toBe("2026");
  expect(copyrightYears(2027)).toBe("2026 - 2027");
  expect(copyrightYears(2030)).toBe("2026 - 2030");
});

test("keeps the first year for earlier or invalid clocks", () => {
  expect(copyrightYears(2025)).toBe("2026");
  expect(copyrightYears(Number.NaN)).toBe("2026");
});
