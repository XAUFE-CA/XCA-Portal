import { Color, SRGBColorSpace } from "three";

export interface AuditoriumPalette {
  structure: Color;
  backdrop: Color;
  alloy: Color;
  floor: Color;
  fabric: Color;
  panel: Color;
  wallBand: Color;
  carpet: Color;
  graphite: Color;
  lightIntensity: number;
  keyLight: Color;
  fillLight: Color;
  accentLight: Color;
}

export type IntroSkyMode = "night" | "day";

/** The key and photographic-sky rotation share one fixed world-space azimuth.
    主光与摄影天空的水平旋转共用固定世界方位。 */
export const INTRO_SKY_LIGHT_DIRECTION = [0.62, 0.48, -0.62] as const;

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
  ledBlue: Color;
  ledAccent: Color;
  ledWarm: Color;
  ledRose: Color;
  ledGreen: Color;
  ledSurface: Color;
  ledFrame: Color;
  brand: Color;
  auditorium: AuditoriumPalette;
}

export type ReadPrimitive = (name: string) => Color;

function mix(first: Color, second: Color, amount: number) {
  return first.clone().lerp(second, amount);
}

/** Public neutral primitives are blue-tinted, so mineral albedo uses their linear luminance.
    公开中性色基础色偏蓝，因此矿物基色采用其线性亮度。 */
function neutral(read: ReadPrimitive, name: string) {
  const color = read(name);
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return color.setRGB(luminance, luminance, luminance);
}

/** A hard theme split keeps stars exclusive to night instead of fading them through daylight.
    硬性主题分界让繁星只属于夜空，不随日景亮度渐隐残留。 */
export function selectIntroSky(read: ReadPrimitive, daylight: number): IntroSkyStyle {
  if (daylight < 0.5) {
    const top = mix(read("neutral-900"), read("blue-950"), 0.32).multiplyScalar(0.6);
    const horizon = mix(read("neutral-800"), read("blue-900"), 0.24).multiplyScalar(0.62);
    return {
      mode: "night",
      top,
      mid: mix(top, horizon, 0.5),
      horizon,
      haze: mix(top, horizon, 0.78),
      sunColor: mix(neutral(read, "neutral-200"), read("blue-100"), 0.06),
      cloudLight: mix(neutral(read, "neutral-500"), horizon, 0.7).multiplyScalar(0.4),
      cloudShadow: top.clone(),
      cloudCover: 0.12,
      sunGlow: 0.015,
      starIntensity: 0.22,
      cloudOpacity: 0.12,
      glow: 0.025,
    };
  }
  // Desaturated blue and a pale mineral horizon avoid a cyan wash or sunset-wide orange.
  // 低饱和蓝与浅矿物色地平线避免青色泛染或铺满天空的橙色晚霞。
  const top = mix(neutral(read, "neutral-500"), read("blue-400"), 0.65);
  top.g *= 0.65;
  top.multiplyScalar(0.65);
  const horizon = mix(neutral(read, "neutral-200"), top, 0.35);
  return {
    mode: "day",
    top,
    mid: mix(top, neutral(read, "neutral-200"), 0.35),
    horizon,
    haze: mix(horizon, top, 0.18),
    sunColor: mix(neutral(read, "neutral-100"), read("amber-100"), 0.28),
    cloudLight: mix(neutral(read, "neutral-100"), read("amber-100"), 0.08),
    cloudShadow: mix(neutral(read, "neutral-400"), top, 0.12),
    cloudCover: 0.24,
    sunGlow: 0.42,
    starIntensity: 0,
    cloudOpacity: 0.24,
    glow: 0.24,
  };
}

/** The same neutral finishes use dimmed architectural lighting at night.
    同一套中性饰面在夜间使用调暗的建筑照明。 */
export function createAuditoriumPalette(
  read: ReadPrimitive,
  daylight: number,
  accentPrimary: Color,
): AuditoriumPalette {
  const exposure = 0.86 + daylight * 0.14;
  const finish = (first: string, second: string, amount: number, scale: number) =>
    mix(read(first), read(second), amount).multiplyScalar(scale * exposure);
  return {
    structure: finish("neutral-400", "neutral-200", 0.42, 0.58),
    backdrop:
      daylight < 0.5
        ? finish("neutral-400", "neutral-200", 0.42, 0.58)
        : mix(neutral(read, "neutral-100"), read("white"), 0.7).lerp(read("amber-50"), 0.04),
    alloy: finish("neutral-200", "white", 0.4, 0.9),
    floor: finish("neutral-400", "neutral-200", 0.1, 0.26),
    fabric: finish("blue-900", "blue-800", 0.2, 0.7),
    panel: finish("neutral-200", "white", 0.2, 0.75),
    wallBand: finish("neutral-400", "neutral-200", 0.24, 0.48),
    carpet: finish("neutral-400", "blue-950", 0.32, 0.2),
    graphite: finish("neutral-400", "blue-950", 0.18, 0.12),
    keyLight: mix(read("white"), read("blue-50"), 0.05),
    fillLight: mix(read("neutral-200"), read("blue-100"), 0.1),
    accentLight: mix(read("cyan-300"), read("blue-300"), 0.35).lerp(accentPrimary, 0.15),
    lightIntensity: 0.24 + daylight * 0.76,
  };
}

/** Both themes emit cool screen colors; daylight keeps a softly tinted luminous backing.
    两种主题均使用冷色发光图案，日间保留带色调的柔和发光底面。 */
export function createLedColors(read: ReadPrimitive, daylight: number) {
  const day = daylight >= 0.5;
  return {
    ledBlue: mix(read("blue-500"), read(day ? "cyan-400" : "cyan-500"), day ? 0.3 : 0.18),
    ledAccent: mix(read(day ? "blue-500" : "blue-400"), read("red-400"), 0.35),
    ledWarm: read(day ? "amber-700" : "amber-400"),
    ledRose: mix(read("red-400"), read("blue-500"), 0.12),
    ledGreen: day ? mix(read("cyan-400"), read("green-400"), 0.45) : read("green-400"),
    ledSurface: day
      ? mix(read("blue-400"), read("cyan-300"), 0.25)
      : mix(read("blue-950"), read("neutral-900"), 0.3).multiplyScalar(0.22),
    ledFrame: day
      ? mix(read("white"), neutral(read, "neutral-200"), 0.2)
      : neutral(read, "neutral-400").multiplyScalar(0.075),
  };
}

function sceneColors(read: ReadPrimitive, daylight: number, sky: IntroSkyStyle) {
  const transition = (night: Color, day: Color) => night.lerp(day, daylight);
  // The same dry finishes survive both themes; lighting, not blue albedo, creates night.
  // 两种主题共用干燥饰面，以照明而非蓝色基色表现夜景。
  const architecture = mix(neutral(read, "neutral-400"), read("amber-100"), 0.025);
  const glazing = mix(neutral(read, "neutral-400"), read("blue-400"), 0.28).multiplyScalar(0.7);
  const alloy = mix(neutral(read, "neutral-300"), read("neutral-300"), 0.04);
  const pavement = neutral(read, "neutral-500");
  const fabric = neutral(read, "neutral-900");
  const keyLight = transition(
    mix(neutral(read, "neutral-100"), read("blue-100"), 0.06),
    mix(neutral(read, "neutral-100"), read("amber-100"), 0.28),
  );
  const fillLight = transition(
    mix(neutral(read, "neutral-300"), read("blue-100"), 0.08),
    mix(neutral(read, "neutral-200"), read("blue-200"), 0.14),
  );
  const rimLight = keyLight.clone();
  const officeLight = mix(neutral(read, "neutral-100"), read("amber-100"), 0.16);
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
    ...createLedColors(read, daylight),
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
