/**
 * Intro pacing, measured in Neoverse-UI duration units.
 * 入场节奏，以 Neoverse-UI 的时长单位计量。
 */
export const INTRO_PACING = {
  markDraw: 2.8,
  markStagger: 0.28,
  markFill: 0.65,
  journey: 21,
  arrival: 3,
  bootComplete: 0.42,
  bannerRow: 0.1,
  bannerCaption: 0.2,
  brandCrossfade: 0.42,
  brandHold: 0.35,
  revealSettle: 2,
} as const;
export const INTRO_HANDOFF = { start: 0.85, boot: 0.91, arrival: 0.96 } as const;
export const TERMINAL_EXPAND_UNITS = 0.92;
/**
 * Text reading interval; independent of reduced-motion's 1ms spatial effects.
 * 文字阅读间隔。它独立于减少动效的 1ms 空间效果。
 */
export const INTRO_READING_UNIT_MS = 420;

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

export const HERO_TYPING = {
  hold: 8,
  nextSentence: 5,
  letter: 0.25,
  punctuation: 0.65,
  erase: 0.12,
} as const;
