/**
 * Scene units follow the CA mark SVG's centred 1254-unit viewBox.
 * 场景坐标沿用 CA 标识 SVG 居中的 1254 单位 viewBox。
 */
export const JOURNEY = {
  depth: 14200,
  perspective: 900,
  roadX: 180,
  floorY: 300,
  cityDrop: 1800,
  bearingInset: 12,
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
 * One broad horizontal bow joins the straight sections with zero slope and curvature.
 * 单个舒展的水平弧线以零斜率和曲率连接两端直线。
 */
export function roadBend(z: number) {
  const t = Math.max(0, Math.min(1, (-z - 1400) / 8400));
  const envelope = Math.sin(Math.PI * t) ** 4;
  return { x: 340 * envelope, y: 0, roll: 0 };
}

/**
 * Distance-driven skyline reveal and departure share the existing camera timeline.
 * 由距离驱动的天际线显现与退场沿用现有摄像机时间线。
 */
export function skylineOpacity(eyeZ: number): number {
  const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (10 + t * (-15 + 6 * t));
  };
  return smooth((600 - eyeZ) / 1600) * (1 - smooth((-eyeZ - 8200) / 3500));
}

/**
 * The destination frame precedes the real terminal and dissolves as it becomes readable.
 * 目的地光框先于真实终端出现，并在终端逐渐可读时消散。
 */
export function arrivalOpacity(eyeZ: number): number {
  const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (10 + t * (-15 + 6 * t));
  };
  return smooth((-eyeZ - 6500) / 2000) * (1 - smooth((-eyeZ - 9900) / 2200));
}

/**
 * Bend continuous geometry and its normals; station assemblies use one rigid translation.
 * 弯曲连续几何与法线。路牌组件使用整体平移。
 */
export function bendRoadMesh(vertices: number[], stationDepth?: number): number[] {
  for (let index = 0; index < vertices.length; index += 7) {
    const z = stationDepth ?? vertices[index + 2] ?? 0;
    const bend = roadBend(z);
    vertices[index] = (vertices[index] ?? 0) + bend.x;
    vertices[index + 1] = (vertices[index + 1] ?? 0) + bend.y;
    if (stationDepth !== undefined) continue;
    const before = roadBend(z - 1),
      after = roadBend(z + 1);
    const nx = vertices[index + 3] ?? 0,
      ny = vertices[index + 4] ?? 0;
    const nz =
      (vertices[index + 5] ?? 0) -
      (nx * (after.x - before.x)) / 2 -
      (ny * (after.y - before.y)) / 2;
    const length = Math.hypot(nx, ny, nz);
    vertices[index + 3] = nx / length;
    vertices[index + 4] = ny / length;
    vertices[index + 5] = nz / length;
  }
  return vertices;
}

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

/**
 * Shared normalized architectural profiles keep city silhouettes deterministic.
 * 共用归一化建筑轮廓，使城市剪影保持确定。
 */
export const CITY_PROFILES = [
  [
    [0, 1],
    [0, 0.22],
    [0.22, 0.22],
    [0.22, 0],
    [0.78, 0],
    [0.78, 0.22],
    [1, 0.22],
    [1, 1],
  ],
  [
    [0, 1],
    [0, 0],
    [0.34, 0],
    [0.34, 0.32],
    [0.64, 0.32],
    [0.64, 0.12],
    [1, 0.12],
    [1, 1],
  ],
  [
    [0, 1],
    [0, 0.16],
    [0.72, 0],
    [1, 0.09],
    [1, 1],
  ],
  [
    [0, 1],
    [0, 0.5],
    [0.18, 0.5],
    [0.18, 0.25],
    [0.7, 0.25],
    [0.7, 0],
    [1, 0],
    [1, 1],
  ],
] as const;
