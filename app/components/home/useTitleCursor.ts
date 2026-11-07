import { onBeforeUnmount, onMounted, type Ref, watch } from "vue";

/**
 * Position one heading caret from the selected shared font's real glyph metrics.
 * 依据所选共享字体的真实字形度量定位唯一的标题光标。
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
    const root = heading.value;
    const text = root?.querySelector<HTMLElement>(".xca-terminal-title__text");
    const caret = root?.querySelector<HTMLElement>(".xca-terminal-title__caret");
    const letter = root?.querySelector<HTMLElement>(".xca-terminal-title__letter--cursor");
    if (!text || !caret || !letter) return;
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) return;
    const style = getComputedStyle(letter);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const content = letter.textContent ?? "";
    const glyph = context.measureText(content);
    const reference = /\p{P}/u.test(content) ? (letter.previousElementSibling ?? letter) : letter;
    const ink = context.measureText(reference.textContent ?? content);
    const baseline = document.createElement("span");
    baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    reference.append(baseline);
    const baselineY = baseline.getBoundingClientRect().top;
    baseline.remove();
    const stroke = Number.parseFloat(style.getPropertyValue("--neoverse-border-width-thin"));
    const textBox = text.getBoundingClientRect();
    const letterBox = letter.getBoundingClientRect();
    const centerY =
      baselineY + (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2 - textBox.top;
    const x =
      letterBox.left -
      textBox.left +
      (visible.value === 0
        ? 0
        : (content.trim() ? glyph.actualBoundingBoxRight : glyph.width) +
          (Number.isFinite(stroke) ? stroke : 0));
    caret.style.setProperty("--xca-title-caret-x", `${x}px`);
    caret.style.setProperty("--xca-title-caret-y", `${centerY}px`);
    caret.style.setProperty(
      "--xca-title-caret-height",
      `${ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent}px`,
    );
    // The first placement is instant; only later moves glide.
    // 首次定位立即生效，之后的移动才使用过渡。
    caret.classList.add("xca-terminal-title__caret--ready");
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
