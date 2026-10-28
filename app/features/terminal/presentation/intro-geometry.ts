/**
 * Scene units follow the CA mark SVG's centred 1254-unit viewBox.
 * 场景坐标沿用 CA 标识 SVG 居中的 1254 单位 viewBox。
 */
export const JOURNEY = {
  depth: 14200,
  perspective: 900,
  roadX: 180,
  floorY: 300,
  roadWidth: 960,
  roadStart: -240,
  roadLookAhead: 4500,
  roadRevealStart: 900,
  roadUnfoldDistance: 2000,
  bodyDepth: 72,
  near: 32,
  far: 50000,
} as const;

/**
 * Build the road behind A as the opening fills, then hold a lead at camera speed.
 * 开口充满视野时在 A 身后延展道路，随后以相机速度保持领先。
 */
export function roadGrowth(eyeZ: number): number {
  const t = Math.max(0, Math.min(1, (JOURNEY.roadRevealStart - eyeZ) / JOURNEY.roadUnfoldDistance));
  const reveal = t * t * t * (10 + t * (-15 + 6 * t));
  const length = JOURNEY.depth + JOURNEY.roadStart;
  const distance = JOURNEY.roadStart - eyeZ;
  // Smooth the positive part so passing the road origin does not change speed abruptly.
  // 对正向部分做平滑，使越过道路原点时速度不突变。
  const s = Math.max(0, Math.min(1, (distance + 200) / 400));
  const travelled = distance >= 200 ? distance : 400 * (s ** 3 - s ** 4 / 2);
  return Math.min(1, ((travelled + JOURNEY.roadLookAhead) * reveal) / length);
}

export const SCENERY_REVEAL = { start: 0.01, span: 0.06 } as const;
export const ROAD_MATERIALIZATION = { reach: 0.18, feather: 900 } as const;

/**
 * Shared mounting coordinates for the mesh supports and their Vue sign faces.
 * 网格支架及其 Vue 标志面共用的安装坐标。
 */
export const JOURNEY_STATIONS = [-2600, -4500, -6400, -8300, -10200, -12100].flatMap(
  (depth, index) =>
    ([-1, 1] as const).map((side) => ({
      index,
      side,
      depth,
      width: 760,
      height: 860,
      left: JOURNEY.roadX + side * (JOURNEY.roadWidth / 2 + 140) - (side < 0 ? 760 : 0),
      top: JOURNEY.floorY - 860,
      panelLeft: side < 0 ? 340 : -180,
      panelTop: 260,
      panelWidth: 600,
      panelHeight: 340,
      hasPanel: side === (index % 2 ? 1 : -1),
    })),
);

export function sceneryOpacity(growth: number, depth: number): number {
  const distance = (JOURNEY.roadStart - depth) / (JOURNEY.depth + JOURNEY.roadStart);
  const t = Math.max(
    0,
    Math.min(1, (growth - distance - SCENERY_REVEAL.start) / SCENERY_REVEAL.span),
  );
  return t * t * (3 - 2 * t);
}
