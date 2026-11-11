import { ARRIVAL_ENTRY, JOURNEY } from "./intro-geometry";

const ROOM_FLOOR = JOURNEY.floorY + 760;
const STAGE_Y = ROOM_FLOOR - 80;
const SCREEN_WIDTH = 3400;
const SCREEN_HEIGHT = (SCREEN_WIDTH * 9) / 16;
const SCREEN_Z = -JOURNEY.depth - 1200;

export const AUDITORIUM = {
  entrance: ARRIVAL_ENTRY.back,
  back: SCREEN_Z - 600,
  halfWidth: 3300,
  ceiling: -2900,
  floorY: ROOM_FLOOR,
  stageFront: SCREEN_Z + 1100,
  stageHalfWidth: 2750,
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
  wallBand: 16,
  entryLight: 18,
  carpet: 17,
  graphite: 19,
  ceilingLight: 20,
  connection: 21,
  backdrop: 22,
} as const;

type Material = keyof typeof AUDITORIUM_MATERIAL;
type Vector = readonly [number, number, number];
export interface AuditoriumGeometry {
  axis: "x" | "y" | "z";
  radius: number;
  bevel?: number;
  profile?: "back" | "cushion";
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
  const { roadX: x } = JOURNEY;
  const floor = AUDITORIUM.floorY;
  const length = entrance - back;
  add("floor", [x - halfWidth, floor, entrance], [halfWidth * 2, 48, length], "ground");
  add("ceiling", [x - halfWidth, ceiling - 48, entrance], [halfWidth * 2, 48, length]);
  add(
    "rear-landing",
    [x - halfWidth, JOURNEY.floorY, entrance],
    [halfWidth * 2, floor - JOURNEY.floorY, 540],
    "carpet",
  );
  // Keep the entire terminal backdrop uninterrupted and matte.
  // 终端背后的完整墙面保持无分缝的哑光表面。
  add(
    "back-wall",
    [x - halfWidth, ceiling, back],
    [halfWidth * 2, floor - ceiling, 48],
    "backdrop",
  );
  for (const side of [-1, 1]) {
    const wall = x + side * halfWidth;
    add(`wall.${side}`, [wall - 32, ceiling, entrance], [64, floor - ceiling, length]);
    add(
      `wall-plinth.${side}`,
      [x + (side < 0 ? -halfWidth + 32 : halfWidth - 76), floor - 160, entrance],
      [44, 160, length],
      "graphite",
    );
  }
  sideWalls(add);
  ceilingArchitecture(add);
}

function sideWalls(add: AddObject) {
  const { entrance, back, halfWidth, ceiling, floorY } = AUDITORIUM;
  const { roadX: x } = JOURNEY;
  const spacing = (entrance - back - 600) / 7;
  for (const side of [-1, 1]) {
    for (let panel = 0; panel < 7; panel++) {
      const z = entrance - 420 - panel * spacing;
      const thickness = panel % 2 === 0 ? 76 : 48;
      const left = x + (side < 0 ? -halfWidth + 64 : halfWidth - 64 - thickness);
      const top = ceiling + 540 + (panel % 2) * 80;
      add(
        `acoustic-mount.${side}.${panel}`,
        [x + (side < 0 ? -halfWidth + 32 : halfWidth - 128), top - 28, z + 24],
        [96, floorY - top - 80, 780],
        "graphite",
        { axis: "x", radius: 24, bevel: 6 },
      );
      add(
        `acoustic.${side}.${panel}`,
        [left, top, z],
        [thickness, floorY - top - 160, 732],
        "acoustic",
        {
          axis: "x",
          radius: 24,
          bevel: 16,
        },
      );
      const face = side < 0 ? left + thickness : left;
      add(
        `panel-light.${side}.${panel}`,
        [face - 3, top + 44, z - 20],
        [6, floorY - top - 240, 8],
        "light",
      );
    }
    add(
      `wall-inset.${side}`,
      [x + (side < 0 ? -halfWidth + 48 : halfWidth - 64), ceiling + 160, entrance - 300],
      [16, 260, entrance - back - 600],
      "wallBand",
    );
  }
}

function ceilingArchitecture(add: AddObject) {
  const { entrance, back, ceiling } = AUDITORIUM;
  const { roadX: x } = JOURNEY;
  const length = entrance - back - 320;
  for (const side of [-1, 1]) {
    const center = x + side * (AUDITORIUM.halfWidth - 380);
    add(
      `ceiling-rail.${side}`,
      [center - 110, ceiling + 48, entrance - 160],
      [220, 104, length],
      "alloy",
      { axis: "y", radius: 44, bevel: 12 },
    );
    for (let mount = 0; mount < 2; mount++)
      add(
        `ceiling-rail-mount.${side}.${mount}`,
        [center - 40, ceiling, entrance - 460 - mount * (length - 700)],
        [80, 64, 160],
      );
    add(
      `ceiling-cove.${side}`,
      [center - 32, ceiling + 156, entrance - 224],
      [64, 28, length - 128],
      "light",
      { axis: "y", radius: 24, bevel: 4 },
    );
  }
  for (let canopy = 0; canopy < 5; canopy++) {
    const y = ceiling + 100 + (canopy % 2) * 24;
    const z = entrance - 740 - canopy * 1440;
    add(`suspended-canopy.${canopy}`, [x - 2580, y, z], [5160, 72, 940], "acoustic", {
      axis: "y",
      radius: 96,
      bevel: 16,
    });
    for (const side of [-1, 1]) {
      add(
        `canopy-mount.${canopy}.${side}`,
        [x + side * 2120 - 24, ceiling, z - 320],
        [48, y - ceiling + 16, 96],
      );
      add(
        `canopy-inlay.${canopy}.${side}`,
        [x + side * 2080 - 36, y + 80, z - 110],
        [72, 18, 700],
        "ceilingLight",
        { axis: "y", radius: 36, bevel: 4 },
      );
    }
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
    "connection",
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
      "connection",
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
  const { back, ceiling, stageY, stageFront } = AUDITORIUM;
  // Side pylons stand clear of the rear wall and outside the glass projection.
  // 侧翼立体构件与后墙分离，并位于玻璃投影之外。
  for (const side of [-1, 1]) {
    const center = x + side * 2200;
    add(
      `stage-wing.${side}.0`,
      [center - 180, ceiling + 160, back + 360],
      [360, stageY - ceiling - 156, 220],
      "structure",
      { axis: "z", radius: 68, bevel: 24 },
    );
    const z = stageFront + 260;
    add(
      `stage-spot-mount.${side}`,
      [x + side * 1680 - 30, ceiling, z - 70],
      [60, 208, 100],
      "structure",
    );
    add(
      `stage-spot-housing.${side}`,
      [x + side * 1680 - 110, ceiling + 190, z],
      [220, 132, 240],
      "structure",
      { axis: "y", radius: 48, bevel: 16 },
    );
    add(
      `stage-spot-aperture.${side}`,
      [x + side * 1680 - 78, ceiling + 330, z - 34],
      [156, 22, 156],
      "ceilingLight",
      { axis: "y", radius: 40, bevel: 4 },
    );
  }
}

function chair(add: AddObject, id: string, center: number, level: number, z: number) {
  add(`${id}.shell`, [center - 144, level - 344, z + 190], [288, 236, 80], "alloy", {
    axis: "z",
    radius: 48,
    bevel: 5,
    profile: "back",
  });
  add(`${id}.back`, [center - 127, level - 330, z + 178], [254, 210, 104], "seat", {
    axis: "z",
    radius: 42,
    bevel: 8,
    profile: "back",
  });
  add(`${id}.pan`, [center - 140, level - 114, z + 98], [280, 20, 228], "graphite", {
    axis: "y",
    radius: 32,
    bevel: 5,
  });
  add(`${id}.cushion`, [center - 129, level - 151, z + 92], [258, 46, 218], "seat", {
    axis: "y",
    radius: 38,
    bevel: 10,
    profile: "cushion",
  });
}

function seatRow(add: AddObject, side: number, row: number, level: number, z: number) {
  const x = JOURNEY.roadX;
  const left = x + (side < 0 ? -2450 : 650);
  const id = `row.${side}.${row}`;
  add(`${id}.beam`, [left, level - 110, z + 56], [1800, 50, 64], "graphite", {
    axis: "x",
    radius: 14,
    bevel: 3,
  });
  add(`${id}.spine`, [left, level - 138, z + 146], [1800, 36, 32], "alloy", {
    axis: "x",
    radius: 12,
    bevel: 3,
  });
  add(`${id}.guide`, [left + 24, level - 72, z + 150], [1752, 5, 5], "light");
  for (let leg = 0; leg < 3; leg++) {
    const center = left + 250 + leg * 650;
    add(
      `${id}.back-bracket.${leg}`,
      [center - 24, level - 115, z + 136],
      [48, 36, 128],
      "graphite",
    );
    add(`${id}.pedestal.${leg}`, [center - 24, level - 72, z + 42], [48, 72, 78], "graphite");
    add(`${id}.foot.${leg}`, [center - 52, level - 8, z + 74], [104, 8, 144], "graphite");
  }
  for (let column = 0; column < 6; column++)
    chair(add, `seat.${side}.${row}.${column}`, left + 150 + column * 300, level, z);
  for (let arm = 0; arm <= 6; arm++) {
    const center = left + arm * 300;
    add(`${id}.arm.${arm}`, [center - 13, level - 215, z + 80], [26, 22, 188], "alloy", {
      axis: "y",
      radius: 11,
      bevel: 3,
    });
    add(`${id}.arm-support.${arm}`, [center - 9, level - 193, z + 78], [18, 91, 24], "graphite");
  }
}

function seating(add: AddObject) {
  const { roadX: x, floorY: rear } = JOURNEY;
  const floor = AUDITORIUM.floorY;
  for (let row = 0; row < 10; row++) {
    const z = AUDITORIUM.entrance - 540 - row * 440;
    const level = rear + row * 76;
    for (const side of [-1, 1]) {
      const left = x + (side < 0 ? -2450 : 650);
      add(`tier.${side}.${row}`, [left, level, z], [1800, floor - level, 440], "graphite");
      add(`tier-carpet.${side}.${row}`, [left, level - 3, z], [1800, 3, 440], "carpet");
      seatRow(add, side, row, level - 3, z - 220);
    }
    for (let step = 0; step < 2; step++) {
      const top = level + step * 38;
      const depth = z - step * 220;
      for (const [aisle, left, width] of [
        ["center", x - 650, 1300],
        ["left", x - 3220, 770],
        ["right", x + 2450, 770],
      ] as const) {
        add(
          `stair.${aisle}.${row}.${step}`,
          [left, top, depth],
          [width, floor - top, 220],
          "carpet",
        );
        for (const edge of [0, 1])
          add(
            `step-light.${aisle}.${row}.${step}.${edge}`,
            [left + 16 + edge * (width - 80), top + 6, depth + 3],
            [48, 5, 5],
            "light",
          );
      }
    }
  }
}

function stage(add: AddObject) {
  const { roadX: x } = JOURNEY;
  const floor = AUDITORIUM.floorY;
  const { stageFront: front, stageY, stageHalfWidth: half, screen } = AUDITORIUM;
  add(
    "stage",
    [x - half, stageY, front],
    [half * 2, floor - stageY, front - AUDITORIUM.back - 32],
    "ground",
  );
  for (let step = 0; step < 2; step++) {
    const z = front + 280 - step * 140;
    const rise = 26 * (step + 1);
    add(`stage-step.${step}`, [x - 1080, floor - rise, z], [2160, rise, 140], "ground");
    add(
      `stage-edge.${step}`,
      [x - 1040, floor - 26 * (step + 1) + 8, z + 8],
      [2080, 12, 12],
      "light",
    );
  }
  add(
    "stage-front-light",
    [x - half + 32, stageY + 14, front + 12],
    [half * 2 - 64, 16, 16],
    "light",
  );
  const fasciaWidth = (half * 2 - 96) / 3;
  for (let panel = 0; panel < 3; panel++) {
    const left = x - half + 48 + panel * fasciaWidth;
    add(
      `stage-fascia-mount.${panel}`,
      [left + fasciaWidth / 2 - 40, stageY + 32, front + 12],
      [80, 24, 24],
    );
    add(
      `stage-fascia.${panel}`,
      [left, stageY + 20, front + 24],
      [fasciaWidth - 20, 48, 16],
      "acoustic",
      { axis: "z", radius: 12, bevel: 4 },
    );
  }
  for (const side of [-1, 1]) {
    add(
      `speaker.${side}`,
      [x + side * 2350 - 77, stageY - 460, screen.z + 120],
      [154, 460, 132],
      "acoustic",
      {
        axis: "z",
        radius: 14,
        bevel: 4,
      },
    );
    for (let slot = 0; slot < 4; slot++)
      add(
        `speaker-grille.${side}.${slot}`,
        [x + side * 2350 - 57, stageY - 390 + slot * 96, screen.z + 128],
        [114, 12, 12],
      );
  }
  add("lectern-foot", [x - 2135, stageY - 14, screen.z + 370], [180, 14, 150], "graphite", {
    axis: "y",
    radius: 12,
    bevel: 2,
  });
  add("lectern-column", [x - 2092, stageY - 184, screen.z + 340], [94, 170, 100], "alloy");
  add("lectern-top", [x - 2168, stageY - 202, screen.z + 390], [246, 18, 200], "alloy", {
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
