function sampleAnimationTime(animation: Animation, onTime: (elapsed: number) => void) {
  let frame = requestAnimationFrame(sample);
  function sample() {
    const elapsed = animation.currentTime;
    if (animation.playState === "running" && typeof elapsed === "number") onTime(elapsed);
    frame = requestAnimationFrame(sample);
  }
  return () => cancelAnimationFrame(frame);
}

export function createIntroPlayback(
  refresh: (animation: Animation) => void,
  frame: () => Element | null,
) {
  const animations = new Set<Animation>();
  const frozen = new Set<Animation>();
  async function animate(
    element: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
    signal: AbortSignal,
    onTime?: (elapsed: number) => void,
  ): Promise<void> {
    signal.throwIfAborted();
    const animation = element.animate(keyframes, options);
    animations.add(animation);
    if (element === frame() && keyframes.some((keyframe) => keyframe.transform)) refresh(animation);
    if (document.hidden) animation.pause();
    const stopSampling = onTime && sampleAnimationTime(animation, onTime);
    const stop = () => {
      stopSampling?.();
      if (!frozen.has(animation)) animation.cancel();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await animation.finished;
      signal.throwIfAborted();
    } finally {
      stopSampling?.();
      signal.removeEventListener("abort", stop);
      // Keep filled or frozen effects until the terminal has reached its final layout.
      // 填充或冻结效果保留到终端抵达最终布局。
      if (!frozen.has(animation) && options.fill !== "both" && options.fill !== "forwards") {
        animations.delete(animation);
        animation.cancel();
      }
    }
  }
  function freeze() {
    for (const animation of animations) {
      frozen.add(animation);
      animation.pause();
    }
  }
  function cancel() {
    for (const animation of animations) animation.cancel();
    animations.clear();
    frozen.clear();
  }
  function onVisibilityChange() {
    for (const animation of animations) {
      if (frozen.has(animation)) continue;
      if (document.hidden && animation.playState === "running") animation.pause();
      else if (!document.hidden && animation.playState === "paused") animation.play();
    }
  }
  return { animate, freeze, cancel, onVisibilityChange };
}
