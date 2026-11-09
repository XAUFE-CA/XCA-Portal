import {
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export interface CityLayer {
  target: WebGLRenderTarget;
  composite(opacity: number): void;
  dispose(): void;
}

const VERTEX = `
varying vec2 cityUv;
void main() {
  cityUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FRAGMENT = `
uniform sampler2D cityTexture;
uniform float cityOpacity;
uniform vec2 cityTexel;
varying vec2 cityUv;
vec3 bloom(vec2 offset) {
  vec4 sampleColor = texture2D(cityTexture, cityUv + offset * cityTexel);
  float brightness = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
  return sampleColor.rgb * smoothstep(1.0, 2.5, brightness);
}
void main() {
  vec4 city = texture2D(cityTexture, cityUv);
  vec3 halo = (bloom(vec2(-2.0, 0.0)) + bloom(vec2(2.0, 0.0)) +
    bloom(vec2(0.0, -2.0)) + bloom(vec2(0.0, 2.0))) * 0.035;
  gl_FragColor = vec4(city.rgb + halo, city.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Fade after display conversion, keeping low-alpha transitions continuous.
  // 在显示颜色转换后淡出，保持低透明度过渡连续。
  gl_FragColor.a *= cityOpacity;
  #include <premultiplied_alpha_fragment>
}`;

/**
 * Opaque city surfaces share depth before the completed image fades exactly once.
 * 不透明城市表面共用深度缓冲，完整图像只淡出一次。
 */
export function createCityLayer(renderer: WebGLRenderer, width: number, height: number): CityLayer {
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error("Intro city requires WebGL2");
  const supported: unknown = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  const samples =
    supported instanceof Int32Array ? (supported.find((count) => count > 0 && count <= 2) ?? 0) : 0;
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples,
  });
  target.texture.name = "intro.city";
  const geometry = new PlaneGeometry(2, 2);
  const cityOpacity = { value: 0 };
  const material = new ShaderMaterial({
    uniforms: {
      cityTexture: { value: target.texture },
      cityOpacity,
      cityTexel: { value: new Vector2(1 / width, 1 / height) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const dispose = () => {
    target.dispose();
    geometry.dispose();
    material.dispose();
    scene.clear();
  };
  // Allocate attachments now so initialization failure still takes the SVG fallback.
  // 立即分配附件，使初始化失败仍可进入 SVG 回退。
  renderer.initRenderTarget(target);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  renderer.setRenderTarget(previous);
  if (!complete) {
    dispose();
    throw new Error("Intro city framebuffer unavailable");
  }
  return {
    target,
    composite(opacity: number) {
      cityOpacity.value = opacity;
      renderer.render(scene, camera);
    },
    dispose,
  };
}
