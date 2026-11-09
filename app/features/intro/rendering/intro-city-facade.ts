import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
} from "three";

function noise(column: number, floor: number): number {
  const value = Math.sin(column * 127.1 + floor * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function panel(context: CanvasRenderingContext2D, column: number, floor: number) {
  const x = column * 64;
  const y = floor * 32;
  const block = noise(Math.floor(column / 8), Math.floor(floor / 16));
  const suite = Math.floor((column + (Math.floor(floor / 7) % 2)) / 3);
  const group = noise(suite, Math.floor(floor / 2));
  const serviceFloor = floor % 13 === 0 || floor % 19 === 0;
  const occupied =
    !serviceFloor && group > (block > 0.55 ? 0.64 : 0.78) && noise(column + 13, floor) > 0.2;
  const lighting = 72 + Math.round(group * 90 + noise(suite + 31, floor) * 24);
  const tint = noise(suite + 19, Math.floor(floor / 5));
  const room = tint < 0.08 ? 30 : tint > 0.975 ? 232 : 112;
  // RGB is linear data: glass coverage, local lamp radiance, coherent room tint.
  // RGB 为线性数据：玻璃覆盖、局部灯具辐射与成组室内色温。
  const glass = 164 + Math.round(noise(suite, Math.floor(floor / 4)) * 38);
  context.fillStyle = `rgb(${glass}, 0, ${room})`;
  context.fillRect(x + 3, y + 4, 58, 25);
  context.fillStyle = `rgb(${glass - 18}, 0, ${room})`;
  context.fillRect(x + 4, y + 21, 56, 7);
  context.fillStyle = `rgb(42, 0, ${room})`;
  context.fillRect(x + 31, y + 4, 1, 25);
  context.fillStyle = `rgb(30, 0, ${room})`;
  context.fillRect(x, y + 30, 64, 1);
  if (occupied) {
    const offset = Math.floor(noise(suite, floor + 73) * 3);
    const width = 30 + Math.floor(group * 20);
    context.fillStyle = `rgb(${glass}, ${lighting}, ${room})`;
    context.fillRect(x + 7, y + 10 + offset, width, 4);
    context.fillStyle = `rgb(${glass - 14}, ${Math.round(lighting * 0.22)}, ${room})`;
    context.fillRect(x + 8, y + 14 + offset, width - 2, 5);
    if (noise(suite + 41, floor) > 0.72) {
      context.fillStyle = `rgb(42, 0, ${room})`;
      context.fillRect(x + 8, y + 13 + offset, width - 2, 1);
    }
  }
  // A few interrupted service strips remain subordinate to the occupied offices.
  // 少量断续设备竖灯带从属于亮灯办公室，不描亮整栋轮廓。
  if (column % 17 === 6 && block > 0.72 && floor % 16 > 3 && floor % 16 < 12) {
    context.fillStyle = "rgb(180, 62, 112)";
    context.fillRect(x + 2, y + 5, 1, 23);
  }
}

/**
 * Build one data atlas; small grouped luminaires survive minification as sparse city lights.
 * 一次生成数据图集；成组细小灯具在缩小时形成稀疏城市光点。
 */
export function createFacadeTexture(anisotropy = 1): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2048;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create the intro facade atlas");
  context.fillStyle = "rgb(12, 0, 112)";
  context.fillRect(0, 0, 2048, 2048);
  for (let floor = 0; floor < 64; floor++) {
    for (let column = 0; column < 32; column++) panel(context, column, floor);
    if (floor % 13 === 0 || floor % 19 === 0) {
      context.fillStyle = "rgb(8, 0, 112)";
      context.fillRect(0, floor * 32, 2048, 4);
      context.fillStyle = "rgb(35, 0, 112)";
      context.fillRect(0, floor * 32 + 4, 2048, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.name = "intro-facade-data";
  texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(4, anisotropy);
  // Match the original unflipped data upload; the shader applies the facade repeat.
  // 对齐原有不翻转的数据上传，由着色器应用立面重复比例。
  texture.flipY = false;
  return texture;
}
