import type { MessageKey } from "../../../i18n";

/** Viewport pointer anchor; the shared overlay runtime positions the panel from it. */
export interface MenuPoint {
  x: number;
  y: number;
}

export interface MenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Anchor for keyboard opens: the browser dispatches `contextmenu` without pointer
 * coordinates, so the panel opens at the centre of the focused element instead.
 * 键盘打开时的锚点。浏览器派发的 contextmenu 不带指针坐标，因此面板改在焦点元素中心打开。
 */
export function centerOf(rect: MenuRect): MenuPoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Cursor coordinates for a context-menu event. A keyboard invocation reports zero
 * on both axes, which is the signal to anchor on the target element instead.
 * 上下文菜单事件的指针坐标。键盘触发时两个轴都为零，据此改为锚定目标元素。
 */
export function resolveOpenPoint(event: MouseEvent, target: Element | null): MenuPoint | null {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }
  if (target === null) return null;
  return centerOf(target.getBoundingClientRect());
}

/**
 * Resolve the status line for a copy action; an empty source is reported as such
 * rather than as a permission failure.
 * 解析复制操作的提示行。内容为空时按空内容报告，而不是报告权限失败。
 */
export function copyFeedbackKey(text: string, copied: boolean): MessageKey {
  if (!text.trim()) return "contextMenu.emptySelection";
  return copied ? "contextMenu.copied" : "contextMenu.copyFailed";
}
