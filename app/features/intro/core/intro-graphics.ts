/**
 * A WebGL2 context that can sustain the scene, or null for the flat entry.
 * 能够承载场景的 WebGL2 上下文；不支持时返回 null，由二维入场接手。
 */
export function releaseIntroGraphics(gl: WebGL2RenderingContext): void {
  try {
    if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Releasing an already invalid context must not surface as an intro failure.
    // 释放已失效的上下文不应成为入场失败。
  }
}

export function probeIntroGraphics(): WebGL2RenderingContext | null {
  const canvas = document.createElement("canvas");
  // The probe carries the scene class so cold-start tests can delay this first context call.
  // 探测画布沿用场景类名，冷启动测试因此能延迟这第一次上下文调用。
  canvas.className = "xca-ca-intro__mesh";
  canvas.setAttribute("aria-hidden", "true");
  try {
    // Chromium refuses the context when it would fall back to a major performance caveat,
    // which is what a device without usable hardware acceleration reports.
    // 浏览器将被迫降级到重大性能告警时会拒绝该上下文，这正是没有可用硬件加速的设备所报告的状态。
    return canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    // A blocked or failed probe is a missing capability, not an error to surface.
    // 被阻止或失败的探测属于能力缺失，不作为错误上报。
    return null;
  }
}
