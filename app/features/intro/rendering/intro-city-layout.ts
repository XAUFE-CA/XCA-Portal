import { JOURNEY } from "../core/intro-geometry";

export const CITY_GROUND = JOURNEY.floorY + JOURNEY.cityDrop;
export const CITY_GRID = {
  columns: 5,
  rows: 9,
  horizonRows: 8,
  outerColumns: 2,
  width: 3000,
  depth: 3200,
  street: 420,
} as const;

export function cityParcel(side: number, column: number, row: number) {
  return {
    x: JOURNEY.roadX + side * (2000 + column * CITY_GRID.width),
    z: -2000 - row * CITY_GRID.depth,
  };
}

export function isCityPark(side: number, column: number, row: number): boolean {
  return (side < 0 && column === 0 && row === 2) || (side > 0 && column === 1 && row === 1);
}
