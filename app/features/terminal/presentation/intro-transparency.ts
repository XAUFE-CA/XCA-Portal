export function createTransparentCity(packed: Float32Array) {
  let count = 0;
  while ([5, 6, 8].includes(packed[count * 8 + 6] ?? -1)) count++;
  const source = packed.slice(0, count * 8);
  const sorted = new Float32Array(source.length);
  const order = Array.from({ length: count / 3 }, (_, index) => index);
  const centers = new Float32Array(order.length * 3);
  const depths = new Float64Array(order.length);
  for (const triangle of order) {
    for (let axis = 0; axis < 3; axis++) {
      centers[triangle * 3 + axis] =
        ((source[triangle * 24 + axis] ?? 0) +
          (source[triangle * 24 + axis + 8] ?? 0) +
          (source[triangle * 24 + axis + 16] ?? 0)) /
        3;
    }
  }
  return { count, source, sorted, order, centers, depths, basis: [] as number[] };
}

/**
 * Stable back-to-front triangles preserve translucent layering without writing city depth.
 * 稳定地从远到近排列三角形，在不写入城市深度时保留半透明层次。
 */
export function sortTransparentCity(
  city: ReturnType<typeof createTransparentCity>,
  view: ArrayLike<number>,
): boolean {
  const x = view[2] ?? 0,
    y = view[6] ?? 0,
    z = view[10] ?? 1;
  if (city.basis[0] === x && city.basis[1] === y && city.basis[2] === z) return false;
  city.basis = [x, y, z];
  for (let index = 0; index < city.order.length; index++) {
    city.depths[index] =
      (city.centers[index * 3] ?? 0) * x +
      (city.centers[index * 3 + 1] ?? 0) * y +
      (city.centers[index * 3 + 2] ?? 0) * z;
  }
  city.order.sort((a, b) => (city.depths[a] ?? 0) - (city.depths[b] ?? 0) || a - b);
  city.order.forEach((triangle, index) => {
    city.sorted.set(city.source.subarray(triangle * 24, triangle * 24 + 24), index * 24);
  });
  return true;
}
