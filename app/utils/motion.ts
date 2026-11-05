/**
 * Text reading interval; independent of reduced-motion's 1ms spatial effects.
 * 文字阅读间隔。它独立于减少动效的 1ms 空间效果。
 */
export const INTRO_READING_UNIT_MS = 420;

/**
 * Read the expressive duration token, falling back to the reading interval.
 * 读取表现型时长 token，缺失时回退到文字阅读间隔。
 */
export function expressiveDuration(element: HTMLElement): number {
  const value = getComputedStyle(element)
    .getPropertyValue("--neoverse-motion-duration-expressive")
    .trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0
    ? value.endsWith("s") && !value.endsWith("ms")
      ? parsed * 1000
      : parsed
    : INTRO_READING_UNIT_MS;
}
