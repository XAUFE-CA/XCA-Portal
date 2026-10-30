import { expect, test } from "@playwright/test";
import { setThemePreference } from "./preferences";

test("skipping the journey releases the city texture and framebuffer", async ({ page }) => {
  await page.addInitScript(() => {
    const textures = new WeakSet<WebGLTexture>(),
      framebuffers = new WeakSet<WebGLFramebuffer>();
    const live = { textures: 0, framebuffers: 0 };
    Object.assign(window, { cityResources: live });
    const prototype = WebGLRenderingContext.prototype;
    const createTexture = prototype.createTexture,
      deleteTexture = prototype.deleteTexture;
    prototype.createTexture = function () {
      const texture = createTexture.call(this);
      if (
        texture &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.classList.contains("xca-ca-intro__mesh")
      ) {
        textures.add(texture);
        live.textures++;
      }
      return texture;
    };
    prototype.deleteTexture = function (texture) {
      if (texture && textures.delete(texture)) live.textures--;
      return deleteTexture.call(this, texture);
    };
    const createFramebuffer = prototype.createFramebuffer,
      deleteFramebuffer = prototype.deleteFramebuffer;
    prototype.createFramebuffer = function () {
      const framebuffer = createFramebuffer.call(this);
      if (
        framebuffer &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.classList.contains("xca-ca-intro__mesh")
      ) {
        framebuffers.add(framebuffer);
        live.framebuffers++;
      }
      return framebuffer;
    };
    prototype.deleteFramebuffer = function (framebuffer) {
      if (framebuffer && framebuffers.delete(framebuffer)) live.framebuffers--;
      return deleteFramebuffer.call(this, framebuffer);
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-mark-renderer", "mesh");
  const resources = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            cityResources: { textures: number; framebuffers: number };
          }
        ).cityResources,
    );
  expect(await resources()).toEqual({ textures: 1, framebuffers: 1 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  expect(await resources()).toEqual({ textures: 0, framebuffers: 0 });
});

test("the city uses a transparent pass before the depth-writing road pass", async ({ page }) => {
  await page.addInitScript(() => {
    const draws: { first: number; count: number; writesDepth: boolean; offscreen: boolean }[] = [];
    Object.assign(window, { cityDraws: draws });
    const original = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
      if (
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.classList.contains("xca-ca-intro__mesh") &&
        draws.length < 12
      )
        draws.push({
          first,
          count,
          writesDepth: Boolean(this.getParameter(this.DEPTH_WRITEMASK)),
          offscreen: this.getParameter(this.FRAMEBUFFER_BINDING) !== null,
        });
      return original.call(this, mode, first, count);
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => (window as unknown as { cityDraws: unknown[] }).cityDraws.length >= 6,
  );
  for (const fraction of [0.45, 0.84]) {
    await page.evaluate((progress) => {
      const camera = document
        .getAnimations()
        .find(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target instanceof Element &&
            animation.effect.target.matches(".xca-ca-intro__camera"),
        );
      if (!camera?.effect) throw new Error("Journey camera required");
      const time = Number(camera.effect.getTiming().duration) * progress;
      for (const animation of document.getAnimations()) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (
          !(target instanceof Element) ||
          !target.closest(".xca-ca-intro, .xca-terminal-window") ||
          animation.playState === "finished"
        )
          continue;
        animation.pause();
        animation.currentTime = time;
      }
      (window as unknown as { cityDraws: unknown[] }).cityDraws.length = 0;
    }, fraction);
    await page.waitForFunction(
      () => (window as unknown as { cityDraws: unknown[] }).cityDraws.length >= 6,
    );
    expect(
      await page.evaluate(() =>
        (window as unknown as { cityDraws: { writesDepth: boolean }[] }).cityDraws.some(
          (draw) => !draw.writesDepth,
        ),
      ),
    ).toBe(true);
  }
  const draws = await page.evaluate(
    () =>
      (
        window as unknown as {
          cityDraws: { first: number; count: number; writesDepth: boolean; offscreen: boolean }[];
        }
      ).cityDraws,
  );
  expect(draws.some((draw) => !draw.writesDepth)).toBe(true);
  for (let index = 0; index + 2 < draws.length; index += 3) {
    expect(draws[index]?.first).toBe(0);
    expect(draws[index]?.writesDepth).toBe(false);
    expect(draws[index]?.offscreen).toBe(true);
    expect(draws[index + 1]?.offscreen).toBe(false);
    expect(draws[index + 1]?.count).toBe(3);
    expect(draws[index + 1]?.writesDepth).toBe(false);
    expect(draws[index + 2]?.writesDepth).toBe(true);
    expect(draws[index + 2]?.first).toBe(draws[index]?.count);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`intro background matches the initial home canvas in ${theme}`, async ({ page }) => {
    await setThemePreference(page, theme);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const backdrop = page.locator(".xca-terminal-hero__intro-backdrop");
    await expect(backdrop).toHaveCount(1);
    const colors = await backdrop.evaluate((element) => {
      const shell = element.closest(".site-shell--home");
      if (!shell) throw new Error("Home canvas required");
      const home = getComputedStyle(shell),
        intro = getComputedStyle(element);
      return {
        home: [home.backgroundColor, home.backgroundImage],
        intro: [intro.backgroundColor, intro.backgroundImage],
      };
    });
    expect(colors.intro).toEqual(colors.home);
  });
}

test("city fragment opacity stays continuous without threshold discard", async ({ page }) => {
  await page.addInitScript(() => {
    const original = WebGLRenderingContext.prototype.shaderSource;
    WebGLRenderingContext.prototype.shaderSource = function (shader, source) {
      if (source.includes("uniform float skylineVisibility"))
        Object.assign(window, { introCityFragment: source });
      return original.call(this, shader, source);
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-mark-renderer", "mesh");
  const pixels = await page.evaluate(() => {
    const fragment = (window as unknown as { introCityFragment: string }).introCityFragment;
    if (!fragment) throw new Error("Actual intro fragment shader required");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL required");
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Shader required");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed");
      return shader;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      `
      attribute vec3 position;
      attribute float level;
      varying mediump float light, road, haze, altitude;
      varying mediump vec2 roadUv, facadeUv;
      varying mediump vec3 surfaceNormal, viewDirection;
      void main() {
        gl_Position = vec4(position, 1.0);
        light = 1.0; road = 5.0; haze = 0.0; altitude = level;
        roadUv = vec2(0.0); facadeUv = vec2(0.0);
        surfaceNormal = vec3(0.0, 0.0, 1.0); viewDirection = surfaceNormal;
      }`,
    );
    const pixelShader = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error("GPU resources required");
    gl.attachShader(program, vertex);
    gl.attachShader(program, pixelShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "Link failed");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const position = gl.getAttribLocation(program, "position");
    const level = gl.getAttribLocation(program, "level");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const colors: number[][] = [];
    for (let step = 0; step <= 40; step++) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(gl.getUniformLocation(program, "skylineVisibility"), 0.08 * (1 - step / 40));
      for (const front of [true, false]) {
        gl.uniform3f(
          gl.getUniformLocation(program, "skylineColor"),
          front ? 1 : 0,
          0,
          front ? 0 : 1,
        );
        gl.vertexAttrib1f(level, front ? 0.04 : 1);
        const z = front ? -0.5 : 0.5;
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, z, 3, -1, z, -1, 3, z]),
          gl.STATIC_DRAW,
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const pixel = new Uint8Array(4);
      gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      colors.push([...pixel]);
    }
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(pixelShader);
    return colors;
  });
  expect(pixels.every((pixel) => pixel[2] === 0)).toBe(true);
  expect(pixels.at(-1)).toEqual([0, 0, 0, 0]);
  for (let index = 1; index < pixels.length; index++)
    expect(pixels[index]?.[3] ?? 0).toBeLessThanOrEqual(pixels[index - 1]?.[3] ?? 0);
});
