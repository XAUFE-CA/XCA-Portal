import { ARRIVAL_ENTRY, JOURNEY } from "./intro-geometry";

const STAGE_Y = JOURNEY.floorY - 80;
const SCREEN_WIDTH = 3000;
const SCREEN_HEIGHT = (SCREEN_WIDTH * 9) / 16;
const SCREEN_Z = -JOURNEY.depth - 1200;

export const AUDITORIUM = {
  entrance: ARRIVAL_ENTRY.back,
  back: SCREEN_Z - 600,
  halfWidth: 2600,
  ceiling: -2200,
  stageFront: SCREEN_Z + 1100,
  stageHalfWidth: 2100,
  stageY: STAGE_Y,
  screen: {
    x: JOURNEY.roadX,
    y: -180 - SCREEN_HEIGHT / 2,
    z: SCREEN_Z,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
} as const;

export const AUDITORIUM_MATERIAL = {
  structure: 9,
  seat: 10,
  light: 11,
  acoustic: 12,
  alloy: 13,
  ground: 14,
  gateway: 15,
  entryLight: 18,
} as const;

type Material = keyof typeof AUDITORIUM_MATERIAL;
type Vector = readonly [number, number, number];
export interface AuditoriumGeometry {
  axis: "x" | "y" | "z";
  radius: number;
  bevel?: number;
}
export interface AuditoriumObject {
  id: string;
  origin: Vector;
  size: Vector;
  material: (typeof AUDITORIUM_MATERIAL)[Material];
  geometry?: AuditoriumGeometry;
}
type AddObject = (
  id: string,
  origin: Vector,
  size: Vector,
  material?: Material,
  geometry?: AuditoriumGeometry,
) => void;

function architecture(add: AddObject) {
  const { entrance, back, halfWidth, ceiling } = AUDITORIUM;
  const { roadX: x, floorY: floor } = JOURNEY;
  const length = entrance - back;
  add("floor", [x - halfWidth, floor, entrance], [halfWidth * 2, 48, length]);
  add("ceiling", [x - halfWidth, ceiling - 48, entrance], [halfWidth * 2, 48, length]);
  add("back-wall", [x - halfWidth, ceiling, back], [halfWidth * 2, floor - ceiling, 48], "alloy");
  for (const side of [-1, 1]) {
    const wall = x + side * halfWidth;
    add(`wall.${side}`, [wall - 32, ceiling, entrance], [64, floor - ceiling, length]);
    const interior = side < 0 ? wall + 32 : wall - 60;
    add(`wall-plinth.${side}`, [interior, floor - 86, entrance], [28, 86, length], "acoustic");
    add(
      `ceiling-rail.${side}`,
      [x + side * 2040 - 28, ceiling, entrance],
      [56, 42, length],
      "acoustic",
    );
    add(
      `ceiling-cove.${side}`,
      [x + side * 1970 - 2, ceiling + 42, entrance],
      [4, 3, length],
      "light",
    );
    const guide = JOURNEY.roadWidth * 0.42;
    add(
      `aisle-light.${side}`,
      [x + side * guide - 2, floor - 2, entrance],
      [4, 2, length],
      "light",
    );
    const panelX = side < 0 ? wall + 32 : wall - 56;
    for (let panel = 0; panel < 10; panel++) {
      const z = entrance - 180 - (panel * (length - 360)) / 10;
      add(`acoustic.${side}.${panel}`, [panelX, -900, z], [24, 1000, 310], "acoustic", {
        axis: "x",
        radius: 12,
        bevel: 3,
      });
      const lightX = side < 0 ? panelX + 24 : panelX - 2;
      add(`wall-light.${side}.${panel}`, [lightX, -740, z - 346], [2, 660, 4], "light");
    }
  }
  for (let bay = 0; bay < 7; bay++) {
    const z = entrance - 420 - bay * 650;
    add(`ceiling-baffle.${bay}`, [x - 2080, ceiling, z], [4160, 64, 88], "acoustic", {
      axis: "x",
      radius: 10,
      bevel: 3,
    });
    add(`ceiling-channel.${bay}`, [x - 1220, ceiling + 64, z - 29], [2440, 5, 28], "structure");
    add(`ceiling-light.${bay}`, [x - 1200, ceiling + 69, z - 40], [2400, 3, 6], "light");
  }
}

function entryHall(add: AddObject) {
  const { roadX: x, floorY: floor, roadWidth } = JOURNEY;
  const { front, width, height } = ARRIVAL_ENTRY;
  const half = width / 2;
  const top = floor - height;
  const length = front - AUDITORIUM.entrance;
  const facadeDepth = 48;
  const shellHalf = AUDITORIUM.halfWidth + 32;
  const shellTop = AUDITORIUM.ceiling - facadeDepth;
  // Attach the front wall around the aperture, never across its open passage.
  // 前墙围住入口开口，不跨过中间的开放通道。
  add(
    "entry-facade.header",
    [x - half, shellTop, front + facadeDepth],
    [width, top - shellTop, facadeDepth],
    "gateway",
  );
  add(
    "entry-floor",
    [x - roadWidth / 2, floor, JOURNEY.roadEnd],
    [roadWidth, 48, JOURNEY.roadEnd - AUDITORIUM.entrance],
    "ground",
  );
  for (const side of [-1, 1]) {
    add(
      `entry-facade.${side}`,
      [x + (side < 0 ? -shellHalf : half), shellTop, front + facadeDepth],
      [shellHalf - half, floor + facadeDepth - shellTop, facadeDepth],
      "gateway",
    );
    add(
      `entry-wall.${side}`,
      [x + (side < 0 ? -half - 60 : half), top, front],
      [60, height, length],
      "gateway",
    );
    add(
      `entry-shoulder.${side}`,
      [x + (side < 0 ? -half - 60 : roadWidth / 2), floor, front],
      [half + 60 - roadWidth / 2, 48, length],
      "ground",
    );
    add(
      `entry-rail.${side}`,
      [x + side * (half - 4) - 2, floor - 142, front],
      [4, 4, length],
      "entryLight",
    );
  }
  add("entry-ceiling", [x - half - 60, top - 28, front], [width + 120, 28, length], "gateway");
  for (const side of [-1, 1])
    add(`entry-cove.${side}`, [x + side * 420 - 3, top + 1, front], [6, 3, length], "entryLight");
}

function stageArchitecture(add: AddObject) {
  const { roadX: x } = JOURNEY;
  const { back, ceiling } = AUDITORIUM;
  for (const side of [-1, 1]) {
    for (let layer = 0; layer < 2; layer++) {
      const left = x + (side < 0 ? -2470 : 1550);
      const y = -850 + layer * 400;
      add(`stage-wing.${side}.${layer}`, [left, y, back + 80], [920, 180, 80], "alloy", {
        axis: "z",
        radius: 48,
        bevel: 12,
      });
      add(
        `stage-wing-inlay.${side}.${layer}`,
        [left + 110, y + 155, back + 83],
        [700, 3, 5],
        "light",
      );
    }
  }
  for (let canopy = 0; canopy < 3; canopy++) {
    const y = ceiling + 140 + canopy * 60;
    const z = AUDITORIUM.stageFront + 1700 - canopy * 750;
    add(`suspended-canopy.${canopy}`, [x - 1750, y, z], [3500, 24, 240], "alloy", {
      axis: "y",
      radius: 60,
      bevel: 6,
    });
    add(`canopy-inlay.${canopy}`, [x - 1640, y + 25, z - 20], [3280, 3, 5], "light");
  }
}

function seating(add: AddObject) {
  const { roadX: x, floorY: floor } = JOURNEY;
  const rowDepth = 360;
  for (let row = 0; row < 7; row++) {
    const z = AUDITORIUM.entrance - 650 - row * rowDepth;
    const level = floor - (7 - row) * 20;
    for (const side of [-1, 1]) {
      const left = x + (side < 0 ? -1940 : 570);
      add(
        `tier.${side}.${row}`,
        [left, level, z + rowDepth / 2 + 20],
        [1370, floor + 40 - level, rowDepth],
      );
      add(
        `step-light.${side}.${row}`,
        [left + 12, level - 2, z - rowDepth / 2 + 26],
        [1346, 2, 4],
        "light",
      );
      for (let column = 0; column < 5; column++) {
        const center = x + side * (700 + column * 260);
        const id = `seat.${side}.${row}.${column}`;
        add(`${id}.base`, [center - 37, level - 94, z - 14], [74, 94, 68]);
        add(`${id}.frame`, [center - 119, level - 94, z + 64], [238, 14, 180]);
        add(`${id}.cushion`, [center - 104, level - 120, z + 68], [208, 26, 190], "seat", {
          axis: "y",
          radius: 24,
          bevel: 5,
        });
        add(`${id}.back`, [center - 105, level - 260, z + 104], [210, 166, 40], "seat", {
          axis: "z",
          radius: 24,
          bevel: 5,
        });
        for (const arm of [-1, 1]) {
          const armX = center + arm * 113;
          add(`${id}.arm.${arm}`, [armX - 8, level - 165, z + 62], [16, 14, 166], "structure", {
            axis: "y",
            radius: 7,
            bevel: 2,
          });
          for (const support of [-1, 1])
            add(
              `${id}.arm-support.${arm}.${support}`,
              [armX - 4, level - 151, z - 18 + support * 62],
              [8, 71, 10],
            );
        }
      }
    }
  }
}

function stage(add: AddObject) {
  const { roadX: x, floorY: floor } = JOURNEY;
  const { stageFront: front, stageY, stageHalfWidth: half, screen } = AUDITORIUM;
  add("stage", [x - half, stageY, front], [half * 2, 128, front - AUDITORIUM.back]);
  for (let step = 0; step < 2; step++) {
    const z = front + 280 - step * 140;
    add(`stage-step.${step}`, [x - 1080, floor - 26 * (step + 1), z], [2160, 30, 140]);
    add(
      `stage-edge.${step}`,
      [x - 1068, floor - 26 * (step + 1) - 2, z - 2],
      [2136, 2, 3],
      "light",
    );
  }
  add("stage-front-light", [x - half + 12, stageY - 2, front - 2], [half * 2 - 24, 2, 3], "light");
  const fasciaWidth = (half * 2 - 24) / 11;
  for (let panel = 0; panel < 11; panel++)
    add(
      `stage-fascia.${panel}`,
      [x - half + 12 + panel * fasciaWidth, stageY + 4, front + 4],
      [fasciaWidth - 8, 64, 14],
      "acoustic",
      {
        axis: "z",
        radius: 4,
        bevel: 1,
      },
    );
  for (const side of [-1, 1]) {
    add(
      `speaker.${side}`,
      [x + side * 1930 - 77, -240, screen.z + 120],
      [154, 460, 132],
      "acoustic",
      {
        axis: "z",
        radius: 14,
        bevel: 4,
      },
    );
    for (let slot = 0; slot < 6; slot++)
      add(
        `speaker-grille.${side}.${slot}`,
        [x + side * 1930 - 57, -190 + slot * 64, screen.z + 122],
        [114, 3, 2],
      );
  }
  add("lectern-foot", [x - 1735, 206, screen.z + 370], [180, 14, 150], "structure", {
    axis: "y",
    radius: 12,
    bevel: 2,
  });
  add("lectern-column", [x - 1692, 36, screen.z + 340], [94, 184, 100], "acoustic");
  add("lectern-top", [x - 1768, 18, screen.z + 390], [246, 18, 200], "structure", {
    axis: "y",
    radius: 14,
    bevel: 3,
  });
}

/**
 * Named, bounded objects are the geometry source for rendering and later scene selection.
 * 带名称与范围的物体同时作为绘制几何及后续场景选择的来源。
 */
function createAuditorium(): readonly AuditoriumObject[] {
  const objects: AuditoriumObject[] = [];
  const add: AddObject = (id, origin, size, material = "structure", geometry) => {
    objects.push({ id, origin, size, material: AUDITORIUM_MATERIAL[material], geometry });
  };
  architecture(add);
  entryHall(add);
  stageArchitecture(add);
  seating(add);
  stage(add);
  return objects;
}

export const AUDITORIUM_OBJECTS = createAuditorium();
