import type { ComputedRef, Ref } from "vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { BANNERS, bannerWidth } from "../branding/banners";
import { TERMINAL } from "../config";
import type { TerminalSession } from "../core/session";

interface TerminalMetricsOptions {
  session: TerminalSession;
  screen: Ref<HTMLElement | null>;
  viewport: ComputedRef<HTMLElement | null>;
  probe: ComputedRef<HTMLElement | null>;
}
/**
 * Measures the rendered terminal font and keeps session columns, banner width and scale in sync.
 * 测量实际渲染的终端字体，并同步会话列数、字标宽度与缩放。
 */
export function useTerminalMetrics({ session, screen, viewport, probe }: TerminalMetricsOptions) {
  const columns = ref(session.size.columns);
  const bannerColumns = ref(session.size.columns);
  const bannerScale = ref(1);
  let metricsContext: CanvasRenderingContext2D | null = null;
  let measureFrame = 0;
  let observer: ResizeObserver | undefined;

  function updateColumns() {
    const node = viewport.value;
    const probeNode = probe.value;
    if (!node || !probeNode || !screen.value) return;
    // Measure real selected font metrics instead of trusting the window's FLIP scale.
    // 测量所选字体的真实度量，而不依赖窗口的 FLIP 缩放。
    const editor = screen.value.querySelector<HTMLInputElement>("#xca-command-input");
    if (!editor) return;
    const style = getComputedStyle(editor);
    metricsContext ??= document.createElement("canvas").getContext("2d");
    const context = metricsContext;
    if (!context) return;
    context.font = `${style.fontSize} ${style.fontFamily}`;
    const cell = context.measureText("M").width;
    const bannerStyle = getComputedStyle(probeNode);
    context.font = `${bannerStyle.fontSize} ${bannerStyle.fontFamily}`;
    // Wordmark cells overlap slightly, so the measured cell width includes that tracking.
    // 字标字符格轻微重叠，测量的单元格宽度须计入该字距。
    const bannerCell =
      context.measureText("M").width + (parseFloat(bannerStyle.letterSpacing) || 0);
    columns.value = Math.max(TERMINAL.layout.minColumns, Math.floor(node.clientWidth / cell));
    if (window.matchMedia("(min-width: 52rem)").matches) {
      // Scale glyphs to the panel width so the desktop welcome wordmark stays on one line.
      // 按面板宽度缩放字形，使桌面欢迎字标保持单行。
      const wideBannerColumns = bannerWidth(BANNERS.wide);
      bannerScale.value = Math.min(1, (node.clientWidth - 2) / (wideBannerColumns * bannerCell));
      bannerColumns.value = wideBannerColumns;
    } else {
      bannerScale.value = 1;
      bannerColumns.value = Math.max(
        TERMINAL.layout.minColumns,
        Math.floor(node.clientWidth / bannerCell),
      );
    }
    session.resize({
      columns: columns.value,
      rows: Math.max(
        TERMINAL.layout.minRows,
        Math.floor(node.clientHeight / parseFloat(style.lineHeight)),
      ),
    });
  }
  function scheduleMeasurement() {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(updateColumns);
  }
  onMounted(() => {
    if (screen.value) {
      observer = new ResizeObserver(scheduleMeasurement);
      observer.observe(screen.value);
    }
    updateColumns();
    void document.fonts.ready.then(() => {
      if (screen.value?.isConnected) scheduleMeasurement();
    });
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(measureFrame);
  });
  return { columns, bannerColumns, bannerScale, scheduleMeasurement };
}
