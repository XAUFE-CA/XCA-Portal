/**
 * Ember state for the footer tagline flame; no DOM, so the rules stay testable.
 * 页脚标语火焰的余烬状态；不依赖 DOM，规则可直接测试。
 */
export interface EmberGlyph {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmberParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  heat: number;
  sway: number;
}

const MIN_COUNT = 16;
const MAX_COUNT = 72;
const GLYPH_AREA_PER_EMBER = 500;
const DRAG_PER_SECOND = 0.6;
const BUOYANCY = 9;
const SWAY_SPEED = 7;
const SWAY_DISTANCE = 9;

/**
 * Keep the ember count proportional to the inked glyph area, bounded so frames stay cheap.
 * 余烬数量与字形面积成正比，并限定上下限，使每帧开销保持稳定。
 */
export function emberCount(glyphs: readonly EmberGlyph[]): number {
  const area = glyphs.reduce((sum, glyph) => sum + glyph.width * glyph.height, 0);
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(area / GLYPH_AREA_PER_EMBER)));
}

/**
 * Spawn one ember in the lower part of a random glyph; returns null when there is no glyph.
 * 在随机字形的下半部生成一颗粒子；没有字形时返回 null。
 */
export function spawnEmber(
  glyphs: readonly EmberGlyph[],
  random: () => number,
): EmberParticle | null {
  if (glyphs.length === 0) return null;
  const glyph = glyphs[Math.min(glyphs.length - 1, Math.floor(random() * glyphs.length))];
  if (!glyph) return null;
  return {
    // Embers leave the glyph between its midline and baseline.
    // 余烬从字形中线到基线之间离开。
    x: glyph.x + random() * glyph.width,
    y: glyph.y + glyph.height * (0.45 + random() * 0.5),
    vx: (random() - 0.5) * 12,
    vy: -(14 + random() * 30),
    age: 0,
    life: 1.1 + random() * 1.5,
    size: 1.1 + random() * 2.2,
    heat: random(),
    sway: random() * Math.PI * 2,
  };
}

/**
 * Advance embers, dropping those that burned out or left the canvas.
 * 推进余烬，移除燃尽或离开画布的粒子。
 */
export function stepEmbers(particles: EmberParticle[], dt: number, height: number): void {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    if (!particle) {
      particles.splice(index, 1);
      continue;
    }
    particle.age += dt;
    if (particle.age >= particle.life) {
      particles.splice(index, 1);
      continue;
    }
    // Light drag plus buoyancy keeps the plume climbing instead of settling into smoke.
    // 轻微阻尼叠加浮力，让火舌持续上浮，而不是沉降成烟。
    particle.vy = particle.vy * Math.max(0, 1 - DRAG_PER_SECOND * dt) - BUOYANCY * dt;
    particle.x +=
      (particle.vx + Math.sin(particle.sway + particle.age * SWAY_SPEED) * SWAY_DISTANCE) * dt;
    particle.y += particle.vy * dt;
    if (particle.y < -12 || particle.y > height + 12) particles.splice(index, 1);
  }
}
