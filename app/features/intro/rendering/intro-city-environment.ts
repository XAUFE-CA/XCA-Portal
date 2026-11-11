import { JOURNEY } from "../core/intro-geometry";
import { CITY_GRID, cityParcel, CITY_GROUND as GROUND, isCityPark } from "./intro-city-layout";
import { CITY_TRAFFIC_MATERIAL } from "./intro-city-life";
import { cityPlane, face, prism } from "./intro-city-primitives";

function streetLamp(vertices: number[], x: number, z: number, side: number) {
  prism(vertices, {
    x,
    z,
    width: 12,
    depth: 14,
    top: GROUND - 310,
    bottom: GROUND - 8,
    material: 5.2,
  });
  prism(vertices, {
    x: x + side * 45,
    z,
    width: 100,
    depth: 18,
    top: GROUND - 318,
    bottom: GROUND - 302,
    material: 5.2,
  });
  cityPlane(vertices, x + side * 75, z, 68, 32, GROUND - 302, 6);
}

function car(vertices: number[], x: number, z: number, side: number) {
  prism(vertices, {
    x,
    z,
    width: 96,
    depth: 208,
    top: GROUND - 42,
    bottom: GROUND + 2,
    material: CITY_TRAFFIC_MATERIAL,
    bottomFace: false,
  });
  prism(vertices, {
    x,
    z: z - side * 12,
    width: 80,
    depth: 112,
    top: GROUND - 75,
    bottom: GROUND - 40,
    material: CITY_TRAFFIC_MATERIAL,
    bottomFace: false,
    topScale: 0.8,
  });
  for (const edge of [-1, 1]) {
    const front = z + side * 105;
    const left = x + edge * 30 - 11;
    face(
      vertices,
      [
        [left, GROUND - 32, front],
        [left + 22, GROUND - 32, front],
        [left + 22, GROUND - 24, front],
        [left, GROUND - 24, front],
      ],
      CITY_TRAFFIC_MATERIAL,
    );
  }
}

function tree(vertices: number[], x: number, z: number) {
  prism(vertices, {
    x,
    z,
    width: 18,
    depth: 18,
    top: GROUND - 150,
    bottom: GROUND - 10,
    material: 5.2,
  });
  prism(vertices, {
    x,
    z,
    width: 150,
    depth: 154,
    top: GROUND - 200,
    bottom: GROUND - 118,
    material: 5.9,
    bevel: 42,
    topScale: 0.65,
  });
  prism(vertices, {
    x: x - 14,
    z: z + 12,
    width: 110,
    depth: 120,
    top: GROUND - 242,
    bottom: GROUND - 190,
    material: 5.9,
    bevel: 32,
    topScale: 0.6,
  });
}

function park(vertices: number[], x: number, z: number) {
  cityPlane(vertices, x, z, 2180, 2260, GROUND - 10, 5.9);
  cityPlane(vertices, x, z, 180, 2420, GROUND - 12, 5.7);
  cityPlane(vertices, x, z, 2320, 180, GROUND - 13, 5.7);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 5; index++) tree(vertices, x + side * 750, z - 850 + index * 420);
    for (const end of [-1, 1]) {
      prism(vertices, {
        x: x + side * 320,
        z: z + end * 540,
        width: 180,
        depth: 48,
        top: GROUND - 55,
        bottom: GROUND - 12,
        material: 5.2,
      });
    }
  }
}

/**
 * Streets, raised pavements and planted blocks share the same parcels as the buildings.
 * 街道、抬高的步道与绿地街区和楼宇共用同一地块坐标。
 */
export function appendCityEnvironment(vertices: number[]) {
  const groundColumns = CITY_GRID.columns + CITY_GRID.outerColumns;
  for (let column = -groundColumns; column <= groundColumns; column++) {
    for (let row = 0; row < CITY_GRID.rows + CITY_GRID.horizonRows; row++) {
      cityPlane(
        vertices,
        JOURNEY.roadX + column * CITY_GRID.width,
        -2000 - row * CITY_GRID.depth,
        CITY_GRID.width,
        CITY_GRID.depth,
        GROUND + 2,
        5.6,
      );
    }
  }
  for (const side of [-1, 1]) {
    for (let column = 0; column < CITY_GRID.columns; column++) {
      for (let row = 0; row < CITY_GRID.rows; row++) {
        const parcel = cityParcel(side, column, row);
        cityPlane(
          vertices,
          parcel.x,
          parcel.z,
          CITY_GRID.width - CITY_GRID.street - 100,
          CITY_GRID.depth - CITY_GRID.street - 100,
          GROUND - 6,
          5.7,
        );
        if (isCityPark(side, column, row)) park(vertices, parcel.x, parcel.z);
        const streetX = JOURNEY.roadX + side * (3500 + column * CITY_GRID.width);
        streetLamp(vertices, streetX - side * 260, parcel.z + 1320, side);
        if ((row + column) % 3 === 0) car(vertices, streetX + side * 102, parcel.z - 360, side);
        if (column === 0 && row % 2 === 0 && !isCityPark(side, column, row)) {
          tree(vertices, parcel.x - side * 1050, parcel.z + 1050);
        }
      }
    }
  }
}
