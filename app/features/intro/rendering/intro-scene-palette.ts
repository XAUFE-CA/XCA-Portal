import { Color, SRGBColorSpace } from "three";

export interface AuditoriumPalette {
  structure: Color;
  alloy: Color;
  floor: Color;
  fabric: Color;
  panel: Color;
  glass: Color;
  keyLight: Color;
  fillLight: Color;
  accentLight: Color;
  environmentIntensity: number;
}

export type IntroSkyMode = "night" | "day";

/** Night and day own separate authored skies; neither is a brightness variant of the other.
    夜景与日景各自拥有独立天空，不是同一套视觉的明暗变体。 */
export interface IntroSkyStyle {
  mode: IntroSkyMode;
  top: Color;
  mid: Color;
  horizon: Color;
  haze: Color;
  sunColor: Color;
  cloudLight: Color;
  cloudShadow: Color;
  cloudCover: number;
  sunGlow: number;
  starIntensity: number;
  cloudOpacity: number;
  glow: number;
}

export interface IntroPalette {
  scene: Color;
  daylight: number;
  sky: IntroSkyStyle;
  architecture: Color;
  glazing: Color;
  alloy: Color;
  pavement: Color;
  fabric: Color;
  keyLight: Color;
  fillLight: Color;
  rimLight: Color;
  officeLight: Color;
  skyTop: Color;
  skyHorizon: Color;
  haze: Color;
  accentLight: Color;
  accentSecondary: Color;
  brand: Color;
  auditorium: AuditoriumPalette;
}

export type ReadPrimitive = (name: string) => Color;

function mix(first: Color, second: Color, amount: number) {
  return first.clone().lerp(second, amount);
}

/** A hard theme split keeps stars exclusive to night instead of fading them through daylight.
    硬性主题分界让繁星只属于夜空，不随日景亮度渐隐残留。 */
export function selectIntroSky(read: ReadPrimitive, daylight: number): IntroSkyStyle {
  if (daylight < 0.5) {
    const top = read("blue-950").multiplyScalar(0.3);
    const horizon = mix(read("blue-700"), read("cyan-500"), 0.4).multiplyScalar(0.42);
    return {
      mode: "night",
      top,
      mid: mix(top, horizon, 0.5),
      horizon,
      haze: mix(top, horizon, 0.32),
      sunColor: read("blue-100").multiplyScalar(0.5),
      cloudLight: mix(read("blue-300"), read("cyan-200"), 0.35).multiplyScalar(0.38),
      cloudShadow: mix(read("blue-950"), read("blue-800"), 0.4),
      cloudCover: 0.2,
      sunGlow: 0.05,
      starIntensity: 1,
      cloudOpacity: 0.2,
      glow: 0.06,
    };
  }
  // Blue remains the dominant sky color; sunset warmth is a narrow shader-added glow.
  // 蓝色仍是天空主体，夕阳暖光只是着色器叠加的局部霞光，不把天空染黄。
  return {
    mode: "day",
    top: mix(read("blue-400"), read("blue-500"), 0.5),
    mid: mix(read("blue-200"), read("cyan-100"), 0.35),
    horizon: mix(read("blue-200"), read("amber-200"), 0.22),
    haze: mix(read("blue-200"), read("blue-300"), 0.35),
    sunColor: mix(read("amber-300"), read("red-400"), 0.22),
    cloudLight: mix(read("amber-100"), read("white"), 0.55),
    cloudShadow: mix(read("blue-700"), read("blue-400"), 0.35),
    cloudCover: 0.5,
    sunGlow: 0.9,
    starIntensity: 0,
    cloudOpacity: 0.42,
    glow: 0.8,
  };
}

/** Night keeps the same blue identity at a lower exposure; coves and glazing stay bright.
    夜景沿用同一蓝色调但降低曝光，灯槽与玻璃高光仍保持明亮。 */
export function createAuditoriumPalette(
  read: ReadPrimitive,
  daylight: number,
  accentPrimary: Color,
): AuditoriumPalette {
  const exposure = 0.38 + daylight * 0.62;
  const finish = (first: string, second: string, amount: number, scale: number) =>
    mix(read(first), read(second), amount).multiplyScalar(scale * exposure);
  return {
    structure: finish("blue-200", "cyan-100", 0.38, 0.7).lerp(accentPrimary, 0.12 * exposure),
    alloy: finish("blue-100", "cyan-200", 0.45, 0.82),
    floor: finish("blue-300", "blue-500", 0.55, 0.58),
    fabric: finish("blue-300", "cyan-300", 0.32, 0.78),
    panel: finish("blue-200", "cyan-200", 0.5, 0.8),
    glass: mix(read("cyan-100"), read("blue-100"), 0.4).multiplyScalar(0.6 + daylight * 0.4),
    keyLight: mix(read("blue-50"), read("cyan-100"), 0.35),
    fillLight: mix(read("blue-100"), read("cyan-200"), 0.4).multiplyScalar(0.75 + daylight * 0.25),
    accentLight: mix(read("cyan-300"), read("blue-300"), 0.35).lerp(accentPrimary, 0.18),
    environmentIntensity: 0.34 + daylight * 0.44,
  };
}

function sceneColors(read: ReadPrimitive, daylight: number, sky: IntroSkyStyle) {
  const transition = (night: Color, day: Color) => night.lerp(day, daylight);
  // Scene hues come from public primitives, never from black/white text roles.
  // 场景色域源于公开基础色，绝不以黑白文字角色推导建筑与灯光。
  const coolRim = mix(read("blue-400"), read("cyan-400"), 0.4);
  // Daytime facades and pavement stay light so warm sunset light reads on them, not on dark grey.
  // 日景立面与路面保持明亮，让夕阳暖光有可读的受光面，而不是压在深灰上。
  const architecture = transition(
    mix(read("neutral-600"), read("neutral-800"), 0.35),
    mix(read("blue-200"), read("blue-100"), 0.35),
  );
  const glazing = transition(
    mix(read("neutral-800"), read("neutral-600"), 0.12),
    mix(read("blue-400"), read("cyan-200"), 0.5),
  );
  const alloy = transition(
    mix(read("neutral-700"), read("neutral-400"), 0.18),
    mix(read("neutral-500"), read("blue-300"), 0.4),
  );
  const pavement = transition(
    mix(read("neutral-600"), read("neutral-700"), 0.5),
    mix(read("blue-200"), read("cyan-100"), 0.35),
  );
  const fabric = transition(read("neutral-900"), mix(read("neutral-500"), read("blue-400"), 0.4));
  const keyLight = transition(
    mix(read("neutral-300"), read("blue-200"), 0.15),
    mix(read("amber-200"), read("amber-100"), 0.35),
  );
  const fillLight = transition(
    mix(read("neutral-500"), read("blue-300"), 0.35),
    mix(read("blue-300"), read("neutral-300"), 0.2),
  );
  const rimLight = transition(coolRim, mix(read("amber-400"), read("red-300"), 0.24));
  const officeLight = transition(
    mix(read("neutral-200"), read("blue-200"), 0.25),
    mix(read("amber-100"), read("neutral-200"), 0.25),
  );
  // The WebGL sky, reflection environment and fog share one authored theme sky.
  // WebGL 天空、反射环境与雾化共用同一套主题天空颜色。
  const skyTop = sky.top.clone();
  const skyHorizon = sky.horizon.clone();
  const haze = sky.haze.clone();
  const accentLight = transition(read("blue-200"), read("amber-300"));
  const accentSecondary = transition(
    mix(read("blue-700"), read("cyan-600"), 0.25),
    mix(read("blue-500"), read("cyan-500"), 0.4),
  );
  return {
    architecture,
    glazing,
    alloy,
    pavement,
    fabric,
    keyLight,
    fillLight,
    rimLight,
    officeLight,
    skyTop,
    skyHorizon,
    haze,
    accentLight,
    accentSecondary,
    brand: transition(read("white"), read("neutral-900")),
  };
}

function updateAura(canvas: HTMLCanvasElement, palette: IntroPalette) {
  const root = canvas.closest<HTMLElement>(".xca-ca-intro");
  if (!root) return;
  const sky = palette.sky;
  // WAAPI still owns opacity; these sRGB colors only describe the revealed sky.
  // 透明度仍由 WAAPI 管理；这些 sRGB 颜色仅描述逐渐显现的天空。
  root.dataset.sky = sky.mode;
  root.style.setProperty("--xca-intro-sky-top", sky.top.getStyle());
  root.style.setProperty("--xca-intro-sky-mid", sky.mid.getStyle());
  root.style.setProperty("--xca-intro-sky-horizon", sky.horizon.getStyle());
  root.style.setProperty("--xca-intro-haze", sky.haze.getStyle());
  root.style.setProperty("--xca-intro-key-light", palette.keyLight.getStyle());
  root.style.setProperty("--xca-intro-rim-light", palette.rimLight.getStyle());
  root.style.setProperty("--xca-intro-cloud-light", sky.cloudLight.getStyle());
  root.style.setProperty("--xca-intro-cloud-shadow", sky.cloudShadow.getStyle());
  root.style.setProperty("--xca-intro-cloud-opacity", sky.cloudOpacity.toFixed(2));
  root.style.setProperty("--xca-intro-stars", sky.starIntensity.toFixed(2));
  root.style.setProperty("--xca-intro-glow", sky.glow.toFixed(2));
}

export function createIntroPalette(canvas: HTMLCanvasElement): IntroPalette {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Intro theme colors unavailable");
  const style = getComputedStyle(canvas);
  const color = (value: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return new Color().setRGB(
      (pixel[0] ?? 0) / 255,
      (pixel[1] ?? 0) / 255,
      (pixel[2] ?? 0) / 255,
      SRGBColorSpace,
    );
  };
  const read: ReadPrimitive = (name) => color(style.getPropertyValue(`--neoverse-color-${name}`));
  const home = canvas.closest(".site-shell--home");
  // Preserve the real homepage clear color so the unlit opening frame does not flash.
  // 保留首页实际清屏色，保证尚未显现灯光的首帧不会闪变。
  const scene = color(
    home
      ? getComputedStyle(home).backgroundColor
      : style.getPropertyValue("--neoverse-color-surface-canvas"),
  );
  const luminance = scene.r * 0.2126 + scene.g * 0.7152 + scene.b * 0.0722;
  const daylight = Math.min(1, Math.max(0, (luminance - 0.04) / 0.7));
  const sky = selectIntroSky(read, daylight);
  const colors = sceneColors(read, daylight, sky);
  const palette: IntroPalette = {
    ...colors,
    scene,
    daylight,
    sky,
    auditorium: createAuditoriumPalette(read, daylight, read("accent-primary")),
  };
  updateAura(canvas, palette);
  return palette;
}
