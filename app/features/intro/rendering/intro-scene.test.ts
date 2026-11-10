import { expect, test } from "bun:test";
import { Matrix4, Mesh, MeshStandardMaterial, Vector3, Vector4 } from "three";
import { AUDITORIUM } from "../core/intro-auditorium";
import { JOURNEY } from "../core/intro-geometry";
import { createIntroCamera, createIntroScene } from "./intro-scene";
import { createRoomLight } from "./intro-scene-lighting";

function cssMatrix(matrix: Matrix4): DOMMatrixReadOnly {
  const fields: Record<string, number> = {};
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      fields[`m${column + 1}${row + 1}`] = matrix.elements[column * 4 + row] ?? 0;
    }
  }
  return fields as unknown as DOMMatrixReadOnly;
}

test("Three projection matches CSS perspective through rotations and portrait focal lengths", () => {
  for (const [width, height, focal] of [
    [1440, 900, 900],
    [390, 844, 342.7734375],
  ]) {
    if (!width || !height || !focal) throw new Error("Viewport required");
    const view = new Matrix4()
      .makeTranslation(0, 0, focal)
      .multiply(new Matrix4().makeRotationX(0.17))
      .multiply(new Matrix4().makeRotationY(-0.32))
      .multiply(new Matrix4().makeTranslation(-180, 120, 5100));
    const adapter = createIntroCamera(width, height, focal);
    adapter.update(cssMatrix(view));
    const oldPoint = new Vector4(420, 210, -7200, 1).applyMatrix4(view);
    const projected = new Vector3(420, -210, -7200).project(adapter.camera);
    expect((projected.x * width) / 2).toBeCloseTo((oldPoint.x * focal) / (focal - oldPoint.z), 8);
    expect((-projected.y * height) / 2).toBeCloseTo((oldPoint.y * focal) / (focal - oldPoint.z), 8);
    const eye = new Vector4(0, 0, focal, 1).applyMatrix4(view.clone().invert());
    expect(adapter.camera.matrixWorld.elements[12]).toBeCloseTo(eye.x, 8);
    expect(adapter.camera.matrixWorld.elements[13]).toBeCloseTo(-eye.y, 8);
    expect(adapter.camera.matrixWorld.elements[14]).toBeCloseTo(eye.z, 8);
  }
});

test("surface batching corrects reflected winding without losing normals or road coordinates", () => {
  const material = new MeshStandardMaterial();
  const source = new Float32Array([
    0, 0, -600, 0, 0, 1, 2, 80, 0, -600, 0, 0, 1, 2, 0, 80, -600, 0, 0, 1, 2, 0, 0, -680, 0, 0, -1,
    2, 80, 0, -680, 0, 0, -1, 2, 0, 80, -680, 0, 0, -1, 2,
  ]);
  const scene = createIntroScene(source, { get: () => material });
  const mesh = scene.world.children[0];
  expect(mesh).toBeInstanceOf(Mesh);
  if (!(mesh instanceof Mesh)) throw new Error("Surface mesh required");
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const along = geometry.getAttribute("introAlong");
  const across = geometry.getAttribute("roadAcross");
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    const a = new Vector3().fromBufferAttribute(positions, vertex);
    const b = new Vector3().fromBufferAttribute(positions, vertex + 1);
    const c = new Vector3().fromBufferAttribute(positions, vertex + 2);
    const face = b.sub(a).cross(c.sub(a)).normalize();
    expect(face.dot(new Vector3().fromBufferAttribute(normals, vertex))).toBeCloseTo(1, 8);
    for (let corner = vertex; corner < vertex + 3; corner++) {
      expect(along.getX(corner)).toBe(positions.getZ(corner));
      expect(across.getX(corner)).toBeCloseTo(
        (positions.getX(corner) - JOURNEY.roadX) / JOURNEY.roadWidth + 0.5,
        6,
      );
    }
  }
  scene.dispose();
  material.dispose();
});

test("the auditorium shadow beam covers the aisle but excludes the enclosing roof", () => {
  const light = createRoomLight();
  try {
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    const frustum = light.shadow.getFrustum();
    expect(frustum.containsPoint(light.target.position)).toBe(true);
    for (const x of [-AUDITORIUM.halfWidth + 100, 0, AUDITORIUM.halfWidth - 100]) {
      for (const z of [
        AUDITORIUM.entrance - 800,
        (AUDITORIUM.entrance + AUDITORIUM.back) / 2,
        AUDITORIUM.back + 100,
      ]) {
        expect(
          frustum.containsPoint(new Vector3(JOURNEY.roadX + x, -AUDITORIUM.ceiling + 1, z)),
        ).toBe(false);
      }
    }
  } finally {
    light.dispose();
  }
});
