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
  glass: 16,
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
  const { entrance, back, halfWidth, ceiling, stageFront } = AUDITORIUM;
  const { roadX: x, floorY: floor } = JOURNEY;
  const length = entrance - back;
  add("floor", [x - halfWidth, floor, entrance], [halfWidth * 2, 48, length]);
  add("ceiling", [x - halfWidth, ceiling - 48, entrance], [halfWidth * 2, 48, length]);
  // Keep the entire terminal backdrop uninterrupted and matte.
  // 终端背后的完整墙面保持无分缝的哑光表面。
  add("back-wall", [x - halfWidth, ceiling, back], [halfWidth * 2, floor - ceiling, 48]);
  for (const side of [-1, 1]) {
    const wall = x + side * halfWidth;
    add(`wall.${side}`, [wall - 32, ceiling, entrance], [64, floor - ceiling, length]);
    add(
      `wall-plinth.${side}`,
      [x + (side < 0 ? -2568 : 2524), floor - 160, entrance],
      [44, 160, length],
      "acoustic",
    );
    const guide = JOURNEY.roadWidth * 0.42;
    add(
      `aisle-light.${side}`,
      [x + side * guide - 9, floor - 8, entrance],
      [18, 12, entrance - stageFront - 300],
      "light",
    );
  }
  sideWalls(add);
  ceilingArchitecture(add);
}

function sideWalls(add: AddObject) {
  const { entrance, back } = AUDITORIUM;
  const { roadX: x } = JOURNEY;
  const spacing = (entrance - back - 1200) / 5;
  for (const side of [-1, 1]) {
    for (let panel = 0; panel < 5; panel++) {
      const z = entrance - 650 - panel * spacing;
      const thickness = panel % 2 === 0 ? 144 : 96;
      const left = x + (side < 0 ? -2500 : 2500 - thickness);
      const top = -1740 + (panel % 2) * 90;
      add(
        `acoustic-mount.${side}.${panel}`,
        [x + (side < 0 ? -2568 : 2472), -1850, z + 36],
        [96, 1700, 732],
        "alloy",
        { axis: "x", radius: 72, bevel: 16 },
      );
      add(`acoustic.${side}.${panel}`, [left, top, z], [thickness, 1500, 660], "acoustic", {
        axis: "x",
        radius: 64,
        bevel: 16,
      });
      const face = side < 0 ? left + thickness : left;
      const stripX = face - 6;
      for (const [edge, depth] of [
        ["left", z - 12],
        ["right", z - 648],
      ] as const)
        add(
          `panel-light.${side}.${panel}.${edge}`,
          [stripX, top + 60, depth],
          [12, 1380, 16],
          "light",
        );
      add(
        `panel-light.${side}.${panel}.foot`,
        [stripX, top + 1460, z - 330],
        [12, 14, 640],
        "light",
      );
    }
    add(
      `wall-glass.${side}`,
      [x + (side < 0 ? -2568 : 2552), -2080, entrance - 300],
      [16, 300, entrance - back - 600],
      "glass",
    );
  }
}

function ceilingArchitecture(add: AddObject) {
  const { entrance, back, ceiling } = AUDITORIUM;
  const { roadX: x } = JOURNEY;
  const length = entrance - back - 320;
  for (const side of [-1, 1]) {
    const center = x + side * 2190;
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
      [center - 32, ceiling + 148, entrance - 224],
      [64, 28, length - 128],
      "light",
      { axis: "y", radius: 24, bevel: 4 },
    );
  }
  for (let canopy = 0; canopy < 3; canopy++) {
    const y = ceiling + 82 + canopy * 18;
    const z = entrance - 1120 - canopy * 1180;
    add(`suspended-canopy.${canopy}`, [x - 1640, y, z], [3280, 88, 650], "alloy", {
      axis: "y",
      radius: 96,
      bevel: 16,
    });
    for (const side of [-1, 1]) {
      add(
        `canopy-mount.${canopy}.${side}`,
        [x + side * 1260 - 24, ceiling, z - 220],
        [48, y - ceiling + 16, 96],
      );
      add(
        `canopy-inlay.${canopy}.${side}`,
        [x + side * 1150 - 70, y + 80, z - 84],
        [140, 28, 480],
        "light",
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
      "light",
      { axis: "y", radius: 40, bevel: 4 },
    );
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
        [left + (side < 0 ? 1282 : 24), level + 14, z + rowDepth / 2 + 28],
        [64, 16, 16],
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
  add("stage", [x - half, stageY, front], [half * 2, 128, front - AUDITORIUM.back - 32]);
  for (let step = 0; step < 2; step++) {
    const z = front + 280 - step * 140;
    add(`stage-step.${step}`, [x - 1080, floor - 26 * (step + 1), z], [2160, 30, 140]);
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
      [left + fasciaWidth / 2 - 40, stageY + 48, front + 12],
      [80, 40, 24],
    );
    add(
      `stage-fascia.${panel}`,
      [left, stageY + 40, front + 24],
      [fasciaWidth - 20, 64, 16],
      "acoustic",
      { axis: "z", radius: 12, bevel: 4 },
    );
  }
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
    for (let slot = 0; slot < 4; slot++)
      add(
        `speaker-grille.${side}.${slot}`,
        [x + side * 1930 - 57, -170 + slot * 96, screen.z + 128],
        [114, 12, 12],
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
