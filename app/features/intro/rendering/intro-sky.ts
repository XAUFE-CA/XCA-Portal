import {
  Color,
  Matrix4,
  Mesh,
  NoBlending,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { IntroPalette } from "./intro-scene-palette";

const VERTEX = `
varying vec2 skyUv;
void main() {
  skyUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FRAGMENT = `
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform vec3 skyTop;
uniform vec3 skyMid;
uniform vec3 skyHorizon;
uniform vec3 haze;
uniform vec3 sunColor;
uniform vec3 cloudLight;
uniform vec3 cloudShadow;
uniform vec3 sunDirection;
uniform float opacity;
uniform float stars;
uniform float sunGlow;
uniform float sunset;
uniform float cloudCover;
varying vec2 skyUv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), local.x),
    local.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}
// Three world-space layers give the night sky dense faint stars and a few bright ones.
// 三层世界方向星场提供密集暗星与少量亮星。
float starCell(vec2 grid, float threshold, float seedOffset) {
  vec2 id = floor(grid);
  vec2 jitter = vec2(hash(id + seedOffset), hash(id + seedOffset + 27.7)) - 0.5;
  vec2 cell = fract(grid) - 0.5 - jitter * 0.5;
  float seed = hash(id + seedOffset * 3.1);
  float radial = length(cell);
  float radius = 0.055 + 0.09 * fract(seed * 11.7);
  float core = 1.0 - smoothstep(radius * 0.2, radius, radial);
  float halo = exp(-radial * 15.0) * 0.3;
  return step(threshold, seed) * (core + halo) * (0.45 + 0.55 * fract(seed * 3.7));
}
// Offset density samples approximate self-shadowing and backlit rims in two cloud decks.
// 偏移密度采样近似两层云的自阴影与逆光边缘。
vec4 cloudLayer(vec2 uv, vec2 lightOffset, float coverage) {
  float density = fbm(uv);
  // A single noise sample approximates the lit density, keeping the full-screen pass cheap.
  // 单次噪声近似向阳密度，避免全屏绘制承担过多 fbm 采样。
  float lit = noise(uv + lightOffset);
  float body = smoothstep(coverage, coverage + 0.2, density);
  float shadow = clamp((density - lit) * 2.2 + 0.5, 0.0, 1.0);
  float rim = clamp((density - coverage) * 4.0, 0.0, 1.0) * (1.0 - body * 0.65);
  return vec4(body, shadow, rim, density);
}
void main() {
  vec2 ndc = skyUv * 2.0 - 1.0;
  vec4 eye = inverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 direction = normalize((cameraWorld * vec4(normalize(eye.xyz), 0.0)).xyz);
  float elevation = direction.y;
  // Night keeps its original wide cool gradient; day uses a three-stop blue gradient.
  // 夜景保留原有宽幅冷色渐变，日景使用三段蓝色渐变。
  vec3 nightColor = mix(skyHorizon, skyTop, smoothstep(-0.02, 0.75, elevation));
  vec3 dayColor = mix(skyHorizon, skyMid, smoothstep(-0.01, 0.12, elevation));
  dayColor = mix(dayColor, skyTop, smoothstep(0.08, 0.42, elevation));
  vec3 color = mix(nightColor, dayColor, sunset);
  // Day haze stays a shallow blue band; night keeps its original wide deep gradient.
  // 日景浅蓝雾只占窄带，夜景保留原有宽幅深色渐变。
  float hazeRange = mix(0.32, 0.12, sunset);
  color = mix(haze, color, smoothstep(-hazeRange, 0.02, elevation));
  float sun = max(dot(direction, sunDirection), 0.0);
  // A distinct low sun disc and a narrow glow band create sunset without tinting the whole sky.
  // 明确的低垂太阳圆盘与窄霞光带营造夕阳，不把整片天空染色。
  float disc = smoothstep(0.9986, 0.9994, sun);
  float bloom = pow(sun, 30.0) * 0.9 + pow(sun, 5.0) * 0.2;
  color += sunColor * (disc * 1.3 + bloom) * sunGlow;
  float sunsetBand = exp(-abs(elevation - sunDirection.y) * 9.0) * pow(sun, 2.0);
  color += sunColor * sunsetBand * sunset * 0.42;
  float band = smoothstep(-0.01, 0.12, elevation) *
    (1.0 - smoothstep(0.52, 0.85, elevation));
  float cloud = 0.0;
  vec3 cloudColor = cloudShadow;
  if (band > 0.001) {
    vec2 skyUv = direction.xz / max(elevation + 0.34, 0.06);
    vec2 lightOffset = normalize(vec2(sunDirection.x, sunDirection.z) + vec2(0.001)) * 0.09;
    vec4 lowerDeck = cloudLayer(skyUv * 2.1 + vec2(3.4, 7.1), lightOffset, 0.52);
    vec4 upperDeck = cloudLayer(skyUv * 0.95 + vec2(11.7, 2.3), lightOffset * 0.6, 0.58);
    float lowerMask = band * (1.0 - smoothstep(0.28, 0.62, elevation));
    float upperMask = band * smoothstep(0.12, 0.4, elevation);
    cloud = max(lowerDeck.x * lowerMask, upperDeck.x * upperMask * 0.72);
    float shadow = mix(lowerDeck.y, upperDeck.y, upperMask * 0.5);
    float rim = max(lowerDeck.z * lowerMask, upperDeck.z * upperMask * 0.6);
    // Warm transmission and silver linings give the sunset decks visible depth.
    // 暖色透射与逆光银边让黄昏云层产生可见厚度。
    cloudColor = mix(cloudShadow, cloudLight, shadow * 0.7 + 0.12);
    cloudColor += sunColor * pow(sun, 6.0) * (0.2 + rim * 0.85) * sunGlow;
    cloudColor += cloudLight * rim * 0.22 * (0.3 + sunGlow * 0.7);
  }
  color = mix(color, cloudColor, cloud * cloudCover);
  // Stars are exclusive to the night sky; the day shader never enters this branch.
  // 繁星只属于夜空，日景着色器不会进入该分支。
  if (stars > 0.001 && elevation > 0.015) {
    vec2 field = direction.xz / (max(elevation, 0.03) + 0.55);
    float fine = starCell(field * 190.0, 0.88, 1.0);
    float middle = starCell(field * 96.0, 0.962, 7.0);
    float bright = starCell(field * 48.0, 0.991, 19.0);
    float milky = smoothstep(0.42, 0.72, fbm(field * 2.2 + vec2(4.1, 1.7)));
    float amount =
      (fine * 0.5 + middle * 1.1 + bright * 2.8) *
      (0.55 + 0.85 * milky) *
      smoothstep(0.015, 0.22, elevation) *
      stars;
    vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.96, 0.88), min(bright, 1.0) * 0.6);
    color += tint * amount * (1.0 - cloud * cloudCover * 0.9) * 1.35;
  }
  gl_FragColor = vec4(color, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= opacity;
}`;

export interface IntroSky {
  update(palette: IntroPalette): void;
  draw(camera: PerspectiveCamera, opacity: number): void;
  dispose(): void;
}

/**
 * A camera-relative full-screen pass samples a world direction, so the sky stays fixed
 * in the world while the view rotates. Clouds and stars therefore never ride the viewport.
 * 相机相对的全屏绘制按世界方向采样，因此视角旋转时天空固定在世界中，
 * 云与星点不会跟着视口滑动。
 */
export function createIntroSky(renderer: WebGLRenderer): IntroSky {
  const geometry = new PlaneGeometry(2, 2);
  const uniforms = {
    inverseProjection: { value: new Matrix4() },
    cameraWorld: { value: new Matrix4() },
    skyTop: { value: new Color() },
    skyMid: { value: new Color() },
    skyHorizon: { value: new Color() },
    haze: { value: new Color() },
    sunColor: { value: new Color() },
    cloudLight: { value: new Color() },
    cloudShadow: { value: new Color() },
    sunDirection: { value: new Vector3(0.28, 0.14, -0.95).normalize() },
    opacity: { value: 0 },
    stars: { value: 0 },
    sunGlow: { value: 0 },
    sunset: { value: 0 },
    cloudCover: { value: 0.5 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    transparent: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    update(palette) {
      const sky = palette.sky;
      uniforms.skyTop.value.copy(sky.top);
      uniforms.skyMid.value.copy(sky.mid);
      uniforms.skyHorizon.value.copy(sky.horizon);
      uniforms.haze.value.copy(sky.haze);
      uniforms.sunColor.value.copy(sky.sunColor);
      uniforms.cloudLight.value.copy(sky.cloudLight);
      uniforms.cloudShadow.value.copy(sky.cloudShadow);
      uniforms.stars.value = sky.starIntensity;
      uniforms.sunGlow.value = sky.sunGlow;
      uniforms.sunset.value = sky.mode === "day" ? 1 : 0;
      uniforms.cloudCover.value = sky.cloudCover;
    },
    draw(current, opacity) {
      uniforms.inverseProjection.value.copy(current.projectionMatrixInverse);
      uniforms.cameraWorld.value.copy(current.matrixWorld);
      uniforms.opacity.value = Math.max(0, Math.min(1, opacity));
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}
