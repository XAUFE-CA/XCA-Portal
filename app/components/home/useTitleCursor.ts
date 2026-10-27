import { onBeforeUnmount, onMounted, type Ref, watch } from "vue";

/**
 * Position the product heading's cursor from the selected shared font's real glyph metrics.
 * 依据所选共享字体的真实字形度量定位产品标题的光标。
 */
export function useTitleCursor(
  heading: Ref<HTMLElement | null>,
  title: Ref<string>,
  visible: Ref<number>,
) {
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let mounted = false;
  let context: CanvasRenderingContext2D | null = null;
  function measure() {
    const letter = heading.value?.querySelector<HTMLElement>(".xca-terminal-title__letter--cursor");
    if (!letter) return;
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) return;
    const style = getComputedStyle(letter);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = letter.textContent ?? "";
    const glyph = context.measureText(text);
    const reference = /\p{P}/u.test(text) ? (letter.previousElementSibling ?? letter) : letter;
    const ink = context.measureText(reference.textContent ?? text);
    const baseline = document.createElement("span");
    baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    reference.append(baseline);
    const baselineY = baseline.getBoundingClientRect().top;
    baseline.remove();
    const stroke = parseFloat(style.getPropertyValue("--neoverse-border-width-thin"));
    const top =
      baselineY +
      (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2 -
      letter.getBoundingClientRect().top;
    letter.style.setProperty("--xca-title-cursor-top", `${top}px`);
    letter.style.setProperty(
      "--xca-title-cursor-left",
      `${visible.value === 0 ? 0 : (text.trim() ? glyph.actualBoundingBoxRight : glyph.width) + stroke}px`,
    );
    letter.style.setProperty(
      "--xca-title-cursor-height",
      `${ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent}px`,
    );
  }
  function schedule() {
    if (!mounted) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }
  watch([title, visible], schedule, { flush: "post" });
  onMounted(() => {
    mounted = true;
    observer = new ResizeObserver(schedule);
    if (heading.value) observer.observe(heading.value);
    void document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    schedule();
  });
  onBeforeUnmount(() => {
    mounted = false;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    document.fonts.removeEventListener("loadingdone", schedule);
  });
}
