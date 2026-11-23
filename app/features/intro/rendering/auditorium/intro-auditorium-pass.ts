import {
  Matrix4,
  type PerspectiveCamera,
  type Scene,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from "three";
import { AUDITORIUM } from "../../core/intro-auditorium";
import { ARRIVAL_ENTRY, JOURNEY } from "../../core/intro-geometry";

export interface AuditoriumPass {
  coversViewport(travel: number, roadGrowth: number): boolean;
  draw(scene: Scene, open: number, planeZ: number, warm: boolean): void;
}

/** Keep the shader's exact portal mask, but render only its conservative screen rectangle. */
export function createAuditoriumPass(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
): AuditoriumPass {
  const apertureCamera = camera.clone();
  const corner = new Vector3();
  const viewport = new Vector4();
  const crop = new Matrix4();
  function coversViewport(travel: number, roadGrowth: number): boolean {
    const eyeZ = camera.matrixWorld.elements[14] ?? 0;
    if (eyeZ >= ARRIVAL_ENTRY.front + travel) return false;
    const entrance = AUDITORIUM.entrance + travel;
    const back = AUDITORIUM.back + travel;
    const builtTo = JOURNEY.roadStart - roadGrowth * (JOURNEY.depth + JOURNEY.roadStart);
    let inTunnel = builtTo <= AUDITORIUM.entrance;
    let inRoom = true;
    for (let index = 0; index < 4; index++) {
      corner.set(index & 1 ? 1 : -1, index & 2 ? 1 : -1, -1).unproject(camera);
      // All forward rays must start inside one opaque volume at the near plane.
      // 近裁面上的所有前向射线必须从同一个不透明空间内出发。
      if (corner.z >= eyeZ || corner.z <= back) return false;
      const side = Math.abs(corner.x - JOURNEY.roadX);
      inTunnel &&=
        corner.z < JOURNEY.roadEnd + travel &&
        side < ARRIVAL_ENTRY.width / 2 &&
        corner.y > -JOURNEY.floorY &&
        corner.y < ARRIVAL_ENTRY.height - JOURNEY.floorY;
      inRoom &&=
        corner.z < entrance &&
        side < AUDITORIUM.halfWidth - 64 &&
        corner.y > -AUDITORIUM.floorY &&
        corner.y < -AUDITORIUM.ceiling;
    }
    return inTunnel || inRoom;
  }

  function draw(scene: Scene, open: number, planeZ: number, warm: boolean) {
    if (warm || (camera.matrixWorld.elements[14] ?? 0) <= planeZ) {
      renderer.render(scene, camera);
      return;
    }
    if (open <= 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const halfWidth = (ARRIVAL_ENTRY.width / 2) * open;
    const halfHeight = (ARRIVAL_ENTRY.height / 2) * open;
    const centerY = ARRIVAL_ENTRY.height / 2 - JOURNEY.floorY;
    for (let index = 0; index < 4; index++) {
      const x = index & 1 ? halfWidth : -halfWidth;
      const y = index & 2 ? halfHeight : -halfHeight;
      corner.set(JOURNEY.roadX + x, centerY + y, planeZ).applyMatrix4(camera.matrixWorldInverse);
      // Near-plane crossings can project beyond the corner bounds. Keep the full view there.
      // 门洞横跨近裁面时，角点不能包住投影，沿用完整视口。
      if (corner.z >= -camera.near) {
        renderer.render(scene, camera);
        return;
      }
      corner.applyMatrix4(camera.projectionMatrix);
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
    renderer.getViewport(viewport);
    const ratio = renderer.getPixelRatio();
    const width = Math.round(viewport.z * ratio);
    const height = Math.round(viewport.w * ratio);
    // Match the renderer's physical viewport and pad its projected aperture by one pixel.
    // 与渲染器的设备像素对齐，并将门洞投影向外扩一像素。
    const left = Math.max(0, Math.floor(((minX + 1) * width) / 2) - 1);
    const bottom = Math.max(0, Math.floor(((minY + 1) * height) / 2) - 1);
    const right = Math.min(width, Math.ceil(((maxX + 1) * width) / 2) + 1);
    const top = Math.min(height, Math.ceil(((maxY + 1) * height) / 2) + 1);
    if (right <= left || top <= bottom) return;
    if (left === 0 && bottom === 0 && right === width && top === height) {
      renderer.render(scene, camera);
      return;
    }

    const w = right - left;
    const h = top - bottom;
    crop.makeScale(width / w, height / h, 1);
    crop.setPosition((width - left - right) / w, (height - bottom - top) / h, 0);
    apertureCamera.layers.mask = camera.layers.mask;
    apertureCamera.matrix.copy(camera.matrix);
    apertureCamera.matrixWorld.copy(camera.matrixWorld);
    apertureCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
    apertureCamera.projectionMatrix.multiplyMatrices(crop, camera.projectionMatrix);
    apertureCamera.projectionMatrixInverse.copy(apertureCamera.projectionMatrix).invert();
    renderer.setViewport(
      viewport.x + left / ratio,
      viewport.y + bottom / ratio,
      w / ratio,
      h / ratio,
    );
    try {
      renderer.render(scene, apertureCamera);
    } finally {
      renderer.setViewport(viewport);
    }
  }
  return { coversViewport, draw };
}
