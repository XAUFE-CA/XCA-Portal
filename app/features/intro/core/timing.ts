/**
 * Intro pacing, measured in Neoverse-UI duration units.
 * 入场节奏，以 Neoverse-UI 的时长单位计量。
 */
export const INTRO_PACING = {
  markDraw: 2.8,
  markStagger: 0.28,
  markFill: 2.2,
  journey: 28,
  arrival: 3,
  bootComplete: 0.42,
  bannerRow: 0.1,
  bannerCaption: 0.24,
  captionLine: 0.12,
  brandCrossfade: 0.28,
  brandHold: 0.4,
  revealSettle: 2,
  briefEnter: 1.6,
  briefStagger: 0.2,
} as const;
export const INTRO_HANDOFF = {
  rise: 0.7,
  start: 0.78,
  content: 0.81,
  settled: 0.86,
  arrival: 0.9,
} as const;
/**
 * Hero typewriter rhythm, measured in reading intervals.
 * 首页标题打字节奏，以阅读间隔计量。
 */
export const HERO_TYPING = {
  hold: 8,
  nextSentence: 5,
  letter: 0.25,
  punctuation: 0.65,
  erase: 0.12,
} as const;
