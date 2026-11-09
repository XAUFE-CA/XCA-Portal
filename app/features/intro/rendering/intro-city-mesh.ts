import { JOURNEY } from "../core/intro-geometry";
import { appendCityEnvironment } from "./intro-city-environment";
import { CITY_GRID, cityParcel, CITY_GROUND as GROUND, isCityPark } from "./intro-city-layout";
import { prism, type Volume } from "./intro-city-primitives";

/**
 * Street-edge pairs give the viaduct visible low roofs and narrow ground-level passages.
 * 沿街的成对低楼为高架提供可见屋顶，并在地面保留窄巷。
 */
function streetBlock(vertices: number[], x: number, z: number, seed: number) {
  for (const wing of [-1, 1]) {
    const height = 690 + ((seed + (wing + 1) * 2) % 5) * 145;
    const shell: Volume = {
      x: x + wing * 565,
      z: z + wing * (90 + (seed % 3) * 55),
      width: 1000,
      depth: 1850 + (seed % 3) * 100,
      top: GROUND - height,
      bottom: GROUND,
      material: 5,
      bevel: 24,
      bottomFace: false,
    };
    prism(vertices, shell);
    if ((seed + wing) % 3 === 0) {
      prism(vertices, {
        ...shell,
        x: shell.x + wing * 90,
        width: 780,
        depth: shell.depth * 0.64,
        top: shell.top - 260,
        bottom: shell.top + 4,
        material: 5.4,
        bevel: 18,
      });
    }
    prism(vertices, {
      x: shell.x,
      z: shell.z + shell.depth / 2 + 3,
      width: 780,
      depth: 12,
      top: GROUND - 250,
      bottom: GROUND - 65,
      material: 5.4,
    });
  }
}

function entranceCanopy(vertices: number[], x: number, z: number, width: number) {
  prism(vertices, {
    x,
    z: z + 42,
    width: width * 0.48,
    depth: 160,
    top: GROUND - 220,
    bottom: GROUND - 184,
    material: 5.2,
  });
  prism(vertices, {
    x,
    z: z + 104,
    width: width * 0.28,
    depth: 12,
    top: GROUND - 187,
    bottom: GROUND - 177,
    material: 6,
  });
}

/**
 * Two unequal offices share a street podium, leaving real gaps between their broad facades.
 * 两栋不等高办公楼共用临街裙房，在宽幅立面之间留下真实空隙。
 */
function officeBlock(vertices: number[], x: number, z: number, seed: number) {
  const podiumTop = GROUND - 520;
  prism(vertices, {
    x,
    z,
    width: 2240,
    depth: 2360,
    top: podiumTop,
    bottom: GROUND,
    material: 5,
    bevel: 28,
    bottomFace: false,
  });
  for (const wing of [-1, 1]) {
    const variant = (seed + (wing + 1) * 7) % 11;
    const height = 2180 + variant * 225;
    const stepped = variant === 2 || variant === 7;
    const shell: Volume = {
      x: x + wing * (540 + (seed % 3) * 25),
      z: z + wing * (220 + (seed % 4) * 60),
      width: 760 + (variant % 4) * 80,
      depth: 1080 + (variant % 4) * 120,
      top: GROUND - height * (stepped ? 0.8 : 1),
      bottom: podiumTop + 4,
      material: variant % 3 === 0 ? 5 : 5.4,
      bevel: 20 + (variant % 3) * 8,
      bottomFace: false,
    };
    prism(vertices, shell);
    if ((variant + (wing + 1) * 3) % 5 === 0)
      neonEdge(
        vertices,
        shell.x - shell.width * 0.3,
        shell.z + shell.depth / 2 + 4,
        shell.top + 260,
        shell.bottom - 220,
      );
    if (variant % 7 === 2) neonCrown(vertices, shell, shell.top + 140);
    if (stepped) {
      prism(vertices, {
        ...shell,
        x: shell.x + wing * 45,
        z: shell.z - 60,
        width: shell.width * 0.78,
        depth: shell.depth * 0.78,
        top: GROUND - height,
        bottom: shell.top + 4,
        bevel: 18,
      });
    } else if (variant === 4) {
      prism(vertices, {
        ...shell,
        x: shell.x + 80,
        z: shell.z - 100,
        width: 220,
        depth: 300,
        top: shell.top - 120,
        bottom: shell.top + 4,
        material: 5.2,
        bevel: 0,
      });
    }
  }
  if (seed % 4 === 0) entranceCanopy(vertices, x, z + 1180, 1120);
}

/**
 * Slim emissive edges and crowns read as deliberate signage instead of glowing the whole shell.
 * 细窄发光边与顶部光冠表现刻意的标识灯带，而非整壳发光。
 */
function neonEdge(vertices: number[], x: number, z: number, top: number, bottom: number) {
  prism(vertices, {
    x,
    z,
    width: 16,
    depth: 8,
    top,
    bottom,
    material: 6,
    bottomFace: false,
  });
}

function neonCrown(vertices: number[], tower: Volume, roof: number) {
  prism(vertices, {
    x: tower.x,
    z: tower.z,
    width: tower.width + 16,
    depth: tower.depth + 16,
    top: roof - 4,
    bottom: roof + 12,
    material: 6,
    bottomFace: false,
  });
}

/**
 * Four grounded landmarks retain distinct roles without repeated roof caps or glowing ribs.
 * 四处落地地标保留不同轮廓职责，不重复金属顶帽或发光肋条。
 */
function landmark(vertices: number[], x: number, z: number, height: number, profile: number) {
  const width = profile === 1 ? 840 : 1000;
  const depth = profile === 2 ? 1250 : 1080;
  const podiumTop = GROUND - 430;
  const shoulder = GROUND - height * (profile === 3 ? 0.84 : 0.76);
  prism(vertices, {
    x,
    z,
    width: 2200,
    depth: 2300,
    top: podiumTop,
    bottom: GROUND,
    material: 5,
    bevel: 36,
    bottomFace: false,
  });
  const tower: Volume = {
    x: x - 70,
    z: z - 80,
    width,
    depth,
    top: profile === 1 ? GROUND - height : shoulder,
    bottom: podiumTop + 4,
    material: profile === 2 ? 5 : 5.4,
    bevel: profile === 2 ? 56 : 34,
    bottomFace: false,
  };
  prism(vertices, tower);
  if (profile !== 1) {
    prism(vertices, {
      ...tower,
      x: tower.x + (profile === 2 ? -60 : 70),
      z: tower.z - 60,
      width: width * (profile === 3 ? 0.84 : 0.74),
      depth: depth * 0.78,
      top: GROUND - height,
      bottom: shoulder + 4,
      topScale: profile === 0 ? 0.86 : 1,
      bevel: 28,
    });
  }
  const upperRoof = GROUND - height;
  neonEdge(
    vertices,
    tower.x + width * 0.32,
    tower.z + depth / 2 + 4,
    shoulder + 160,
    podiumTop + 500,
  );
  const crown: Volume = {
    ...tower,
    x: tower.x + (profile === 1 ? 0 : profile === 2 ? -60 : 70),
    z: tower.z - (profile === 1 ? 0 : 60),
    width: profile === 1 ? width : width * (profile === 3 ? 0.84 : 0.74),
    depth: profile === 1 ? depth : depth * 0.78,
  };
  neonCrown(vertices, crown, upperRoof);
  if (profile === 0 || profile === 1) {
    const roof = GROUND - height;
    prism(vertices, {
      x: tower.x + 60,
      z: tower.z - 100,
      width: profile === 0 ? 250 : 320,
      depth: 300,
      top: roof - 140,
      bottom: roof + 4,
      material: 5.2,
      bottomFace: false,
    });
    if (profile === 1) {
      prism(vertices, {
        x: tower.x + 60,
        z: tower.z - 100,
        width: 18,
        depth: 18,
        top: roof - 390,
        bottom: roof - 135,
        material: 5.2,
        bottomFace: false,
      });
      prism(vertices, {
        x: tower.x + 60,
        z: tower.z - 100,
        width: 22,
        depth: 22,
        top: roof - 412,
        bottom: roof - 386,
        material: 6,
        bottomFace: false,
      });
    }
  }
  entranceCanopy(vertices, x, z + 1150, 1300);
}

/**
 * The existing enclosed link remains on one side of the viaduct, below its deck.
 * 既有封闭连廊仍位于高架单侧，整体低于桥面。
 */
function skywalk(vertices: number[]) {
  const volume: Volume = {
    x: JOURNEY.roadX + 3500,
    z: -8400,
    width: 3000,
    depth: 210,
    top: GROUND - 600,
    bottom: GROUND - 450,
    material: 5.4,
  };
  prism(vertices, volume);
  prism(vertices, { ...volume, top: volume.bottom - 8, bottom: volume.bottom + 28, material: 5.2 });
}

/**
 * Small independent silhouettes fill rear and lateral streets, rather than a single skyline wall.
 * 后方与侧向街网由独立的小体块填充，而非一整堵天际线墙。
 */
function distantBlock(vertices: number[], side: number, column: number, row: number) {
  const parcel = cityParcel(side, column, row);
  const seed = row * 19 + column * 31 + (side + 1) * 7;
  for (const wing of [-1, 1]) {
    const variant = (seed + (wing + 1) * 3) % 13;
    const height = 760 + variant * 150;
    const silhouette: Volume = {
      x: parcel.x + wing * (530 + (seed % 3) * 25),
      z: parcel.z + wing * (240 + (variant % 4) * 85),
      width: 720 + (variant % 4) * 110,
      depth: 940 + (variant % 4) * 130,
      top: GROUND - height,
      bottom: GROUND,
      material: 8,
      bevel: row < CITY_GRID.rows + 2 && variant % 4 === 0 ? 24 : 0,
      bottomFace: false,
    };
    prism(vertices, silhouette);
    if (variant === 3 && row < CITY_GRID.rows + 3) {
      prism(vertices, {
        ...silhouette,
        x: silhouette.x + 40,
        width: silhouette.width * 0.72,
        depth: silhouette.depth * 0.76,
        top: silhouette.top - 1450,
        bottom: silhouette.top + 4,
        bevel: 18,
      });
    }
  }
}

function distantCity(vertices: number[]) {
  for (const side of [-1, 1]) {
    for (let column = 0; column < CITY_GRID.columns + CITY_GRID.outerColumns; column++) {
      const firstRow = column < CITY_GRID.columns ? CITY_GRID.rows : 0;
      for (let row = firstRow; row < CITY_GRID.rows + CITY_GRID.horizonRows; row++) {
        distantBlock(vertices, side, column, row);
      }
    }
  }
}

/**
 * One static district spans low street edges, clustered offices and a continuous distant city.
 * 单一静态街区包含低层街沿、簇状办公楼与连续远城。
 */
export function createCityMesh(): number[] {
  const vertices: number[] = [];
  distantCity(vertices);
  for (const side of [-1, 1]) {
    for (let column = 0; column < CITY_GRID.columns; column++) {
      for (let row = 0; row < CITY_GRID.rows; row++) {
        if (isCityPark(side, column, row)) continue;
        const { x, z } = cityParcel(side, column, row);
        const seed = row * 7 + column * 13 + (side + 1) * 5;
        if (side < 0 && column === 1 && row === 2) landmark(vertices, x, z, 6600, 0);
        else if (side > 0 && column === 1 && row === 4) landmark(vertices, x, z, 8200, 1);
        else if (side < 0 && column === 3 && row === 5) landmark(vertices, x, z, 5600, 2);
        else if (side > 0 && column === 2 && row === 6) landmark(vertices, x, z, 7100, 3);
        else if (column === 0) streetBlock(vertices, x, z, seed);
        else officeBlock(vertices, x, z, seed);
      }
    }
  }
  appendCityEnvironment(vertices);
  skywalk(vertices);
  return vertices;
}
