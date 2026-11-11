import {
  HalfFloatType,
  Mesh,
  NoBlending,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export interface CityLayer {
  target: WebGLRenderTarget;
  resize(width: number, height: number): void;
  composite(opacity: number, daylight: number): void;
  dispose(): void;
}

const VERTEX = `
varying vec2 cityUv;
void main() {
  cityUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const EXTRACT = `
uniform sampler2D sourceTexture;
uniform vec2 sourceTexel;
varying vec2 cityUv;
vec3 emission(vec2 offset) {
  vec4 source = texture2D(sourceTexture, cityUv + offset * sourceTexel);
  float brightness = max(source.r, max(source.g, source.b));
  float chromatic = smoothstep(0.08, 0.45, brightness - min(source.r, min(source.g, source.b)));
  return source.rgb * chromatic * smoothstep(0.65, 1.6, brightness);
}
void main() {
  gl_FragColor = vec4((emission(vec2(-0.5, -0.5)) + emission(vec2(0.5, -0.5)) +
    emission(vec2(-0.5, 0.5)) + emission(vec2(0.5, 0.5))) * 0.25, 0.0);
}`;
const BLUR = `
uniform sampler2D sourceTexture;
uniform vec2 blurStep;
varying vec2 cityUv;
void main() {
  vec3 color = texture2D(sourceTexture, cityUv).rgb * 0.227027;
  color += (texture2D(sourceTexture, cityUv + blurStep * 1.384615).rgb +
    texture2D(sourceTexture, cityUv - blurStep * 1.384615).rgb) * 0.316216;
  color += (texture2D(sourceTexture, cityUv + blurStep * 3.230769).rgb +
    texture2D(sourceTexture, cityUv - blurStep * 3.230769).rgb) * 0.070270;
  gl_FragColor = vec4(color, 0.0);
}`;
const FRAGMENT = `
uniform sampler2D cityTexture;
uniform sampler2D tightTexture;
uniform sampler2D wideTexture;
uniform float cityOpacity;
uniform float daylight;
varying vec2 cityUv;
void main() {
  vec4 city = texture2D(cityTexture, cityUv);
  vec3 straightCity = city.a > 0.0 ? city.rgb / city.a : vec3(0.0);
  vec3 halo = texture2D(tightTexture, cityUv).rgb * mix(0.36, 0.12, daylight) +
    texture2D(wideTexture, cityUv).rgb * mix(0.62, 0.16, daylight);
  gl_FragColor = vec4(straightCity + halo, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 surface = gl_FragColor.rgb;
  gl_FragColor = vec4(halo, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 diffusion = gl_FragColor.rgb;
  float haloCoverage = clamp(max(diffusion.r, max(diffusion.g, diffusion.b)), 0.0, 1.0);
  // Emission owns coverage beyond silhouettes; no fullscreen alpha or unassociated RGB.
  // 自发光在轮廓外拥有覆盖率，不产生全屏透明度或未关联 RGB。
  gl_FragColor = vec4(mix(diffusion, surface, city.a),
    city.a + (1.0 - city.a) * haloCoverage);
  // Fade associated display color and coverage once, after HDR/display conversion.
  // 在 HDR 与显示转换后，仅一次淡出已关联的显示颜色和覆盖率。
  gl_FragColor *= cityOpacity;
}`;

function createTarget(width: number, height: number, depthBuffer = false, samples = 0) {
  return new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    depthBuffer,
    stencilBuffer: false,
    samples,
  });
}

function createPass(
  fragmentShader: string,
  uniforms: ShaderMaterial["uniforms"],
  composite = false,
) {
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader,
    transparent: composite,
    premultipliedAlpha: composite,
    blending: composite ? NormalBlending : NoBlending,
    toneMapped: composite,
    depthTest: false,
    depthWrite: false,
  });
}

function resizeTargets(targets: readonly WebGLRenderTarget[], width: number, height: number) {
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(height));
  if (targets[0]?.width === width && targets[0].height === height) return;
  targets.forEach((target, index) => {
    const scale = index === 0 ? 1 : index < 3 ? 2 : 8;
    target.setSize(Math.max(1, Math.ceil(width / scale)), Math.max(1, Math.ceil(height / scale)));
  });
}

function initializeTargets(renderer: WebGLRenderer, targets: readonly WebGLRenderTarget[]) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new Vector4());
  const scissor = renderer.getScissor(new Vector4());
  const scissorTest = renderer.getScissorTest();
  const gl = renderer.getContext();
  try {
    for (const target of targets) {
      renderer.initRenderTarget(target);
      renderer.setRenderTarget(target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Intro city framebuffer unavailable");
    }
  } finally {
    renderer.setRenderTarget(previous, face, mip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
  }
}

function createTargets(renderer: WebGLRenderer, width: number, height: number) {
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error("Intro city requires WebGL2");
  const supported: unknown = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  const samples =
    supported instanceof Int32Array ? (supported.find((count) => count > 0 && count <= 2) ?? 0) : 0;
  const target = createTarget(1, 1, true, samples);
  target.texture.name = "intro.city";
  const targets = [
    target,
    createTarget(1, 1),
    createTarget(1, 1),
    createTarget(1, 1),
    createTarget(1, 1),
  ] as const;
  resizeTargets(targets, width, height);
  return targets;
}

/**
 * Keep the sharp HDR city separate from half/eighth-resolution blue diffusion.
 * 将清晰 HDR 城市与半分辨率、八分之一分辨率的蓝色扩散分离。
 */
export function createCityLayer(renderer: WebGLRenderer, width: number, height: number): CityLayer {
  const targets = createTargets(renderer, width, height);
  const [target, tight, scratch, wideScratch, wide] = targets;
  const sourceTexture = { value: target.texture };
  const sourceTexel = { value: new Vector2() };
  const blurStep = { value: new Vector2() };
  const cityOpacity = { value: 0 };
  const daylight = { value: 1 };
  const extract = createPass(EXTRACT, { sourceTexture, sourceTexel });
  const blur = createPass(BLUR, { sourceTexture, blurStep });
  const material = createPass(
    FRAGMENT,
    {
      cityTexture: { value: target.texture },
      tightTexture: { value: tight.texture },
      wideTexture: { value: wide.texture },
      cityOpacity,
      daylight,
    },
    true,
  );
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const viewport = new Vector4();
  const scissor = new Vector4();
  let warmed = false;
  const render = (output: WebGLRenderTarget, pass: ShaderMaterial) => {
    quad.material = pass;
    renderer.setRenderTarget(output);
    renderer.render(scene, camera);
  };
  const dispose = () => {
    for (const output of targets) output.dispose();
    for (const pass of [extract, blur, material]) pass.dispose();
    geometry.dispose();
    scene.clear();
  };
  try {
    initializeTargets(renderer, targets);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    target,
    resize: (nextWidth, nextHeight) => resizeTargets(targets, nextWidth, nextHeight),
    composite(opacity, nextDaylight) {
      cityOpacity.value = Math.max(0, Math.min(1, opacity));
      if (cityOpacity.value === 0 && warmed) return;
      daylight.value = Math.max(0, Math.min(1, nextDaylight));
      const previous = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const mip = renderer.getActiveMipmapLevel();
      renderer.getViewport(viewport);
      renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest();
      const autoClear = renderer.autoClear;
      const xr = renderer.xr.enabled;
      try {
        renderer.autoClear = renderer.xr.enabled = false;
        renderer.setScissorTest(false);
        sourceTexture.value = target.texture;
        sourceTexel.value.set(1 / target.width, 1 / target.height);
        render(tight, extract);
        sourceTexture.value = tight.texture;
        blurStep.value.set(1 / tight.width, 0);
        render(scratch, blur);
        sourceTexture.value = scratch.texture;
        blurStep.value.set(0, 1 / tight.height);
        render(tight, blur);
        sourceTexture.value = tight.texture;
        blurStep.value.set(1 / wide.width, 0);
        render(wideScratch, blur);
        sourceTexture.value = wideScratch.texture;
        blurStep.value.set(0, 1 / wide.height);
        render(wide, blur);
        renderer.setRenderTarget(previous, face, mip);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        quad.material = material;
        renderer.render(scene, camera);
        warmed = true;
      } finally {
        renderer.setRenderTarget(previous, face, mip);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        renderer.autoClear = autoClear;
        renderer.xr.enabled = xr;
      }
    },
    dispose,
  };
}
