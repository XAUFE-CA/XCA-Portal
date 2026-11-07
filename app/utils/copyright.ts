export const FIRST_PUBLISH_YEAR = 2026;

// Keep the first year alone until a later year arrives; show a range afterwards.
// 首年单独显示，之后才显示起止区间。
export function copyrightYears(currentYear: number, firstYear = FIRST_PUBLISH_YEAR): string {
  return currentYear > firstYear ? `${firstYear} - ${currentYear}` : String(firstYear);
}
