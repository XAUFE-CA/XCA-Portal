const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = position * 0.5 + 0.5;
}`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D cityTexture;
uniform float cityOpacity;
varying vec2 uv;
void main() {
  gl_FragColor = texture2D(cityTexture, uv) * cityOpacity;
}`;

/**
 * Fade the completed city once, rather than quantizing opacity on every overlapping facade.
 * 对完整城市只淡入淡出一次，避免每个重叠立面分别量化透明度。
 */
export function createCityLayer(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  makeProgram: (vertex: string, fragment: string) => WebGLProgram,
) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  const buffer = gl.createBuffer();
  let program: WebGLProgram | null = null;
  const dispose = () => {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
  try {
    if (!texture || !framebuffer || !buffer) throw new Error("City layer unavailable");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("City layer incomplete");
    program = makeProgram(VERTEX, FRAGMENT);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      framebuffer,
      texture,
      buffer,
      program,
      dispose,
      position: gl.getAttribLocation(program, "position"),
      opacity: gl.getUniformLocation(program, "cityOpacity"),
      sampler: gl.getUniformLocation(program, "cityTexture"),
    };
  } catch {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    dispose();
    return null;
  }
}

export function compositeCityLayer(
  gl: WebGLRenderingContext,
  layer: NonNullable<ReturnType<typeof createCityLayer>>,
  opacity: number,
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(layer.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
  gl.enableVertexAttribArray(layer.position);
  gl.vertexAttribPointer(layer.position, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, layer.texture);
  gl.uniform1i(layer.sampler, 0);
  gl.uniform1f(layer.opacity, opacity);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
