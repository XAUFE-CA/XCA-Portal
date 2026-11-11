import { onBeforeUnmount, onMounted, type Ref, ref, watch } from "vue";

/**
 * Position one heading caret from the selected shared font's real glyph metrics.
 * 依据所选共享字体的真实字形度量定位唯一的标题光标。
 */
export function useTitleCursor(
  heading: Ref<HTMLElement | null>,
  title: Ref<string>,
  visible: Ref<number>,
): Ref<boolean> {
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let mounted = false;
  let context: CanvasRenderingContext2D | null = null;
  // Vue owns the caret's class attribute, so the ready state is component state rather
  // than a class written straight to the node: a later render would drop it.
  // 光标的 class 属性由 Vue 管理，因此就绪状态属于组件状态而不是直接写节点；
  // 后续渲染会把它清掉。
  const ready = ref(false);
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
    const stroke = Number.parseFloat(style.getPropertyValue("--neoverse-border-width-thin"));
    const textBox = text.getBoundingClientRect();
    const letterBox = letter.getBoundingClientRect();
    // A zero-width baseline probe can be laid out at the previous line's end; the glyph's own
    // inline box plus the font ascent always reports the baseline of the line it wrapped onto.
    // 零宽基线探针可能被排到上一行行末；字符自身的内联盒加字体上伸部始终给出其所在行的基线。
    const baselineY = letterBox.top + ink.fontBoundingBoxAscent;
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
    ready.value = true;
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
  return ready;
}
