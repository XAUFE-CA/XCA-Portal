import { type MenuPoint, resolveOpenPoint } from "../core/menu-model";
import { isNativeMenuEvent, isNativeMenuPending } from "./native-menu";

/** Viewport tolerance for a press that still counts as stationary. */
const LONG_PRESS_TOLERANCE = 10;
// Touch has no secondary click, so a stationary press opens the menu the way a long
// press opens the system one. Movement beyond the tolerance means the visitor scrolls.
// 触屏没有次要点击，因此静止长按以系统菜单的方式打开。移动超过阈值即视为访客在滚动。
const LONG_PRESS_MS = 500;
const NATIVE_MENU_OWNERS = 'input, textarea, [contenteditable="true"]';

export interface RegionListenerOptions {
  /**
   * Called with the resolved anchor, the pressed element, and whether focus should move
   * into the panel. A pointer open keeps focus in place; a keyboard open moves it.
   * 传入解析后的锚点、被按下的元素，以及焦点是否应移入面板。指针打开保留焦点，键盘打开移动焦点。
   */
  open: (anchor: MenuPoint, target: Element | null, takeFocus: boolean) => void;
  /** Whether a text field inside this region keeps the browser menu. */
  keepNativeMenu: (target: Element | null) => boolean;
}

/**
 * Attach the pointer and contextmenu entry points to one region element and return the
 * detach function. Keeping this outside the state composable keeps long-press timing,
 * movement tolerance and the native-menu policy in one place.
 * 把指针与 contextmenu 入口挂到区域元素上并返回解绑函数。放在状态组合函数之外，
 * 使长按计时、移动阈值与原生菜单策略集中在一处。
 */
export function attachRegionListeners(element: HTMLElement, options: RegionListenerOptions) {
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressOrigin: MenuPoint | undefined;
  let pressElement: Element | null = null;
  // A right-click fires pointerdown before contextmenu; a keyboard invocation fires
  // contextmenu alone. The flag therefore distinguishes the two without guessing from
  // coordinates, which a keyboard open may still fill in with the element centre.
  // 右键先派发 pointerdown 再派发 contextmenu；键盘触发只派发 contextmenu。
  // 该标记据此区分两者，而不依赖坐标——键盘触发同样可能带上元素中心坐标。
  let pointerInitiated = false;

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = undefined;
    pressOrigin = undefined;
    pressElement = null;
  }

  function onContextMenu(event: MouseEvent) {
    if (isNativeMenuEvent(event)) {
      pointerInitiated = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (options.keepNativeMenu(target)) return;
    const anchor = resolveOpenPoint(event, target);
    if (anchor === null) return;
    event.preventDefault();
    // A pointer open keeps focus only where a selection highlight must survive; every
    // other open moves focus into the panel so the rows stay keyboard-operable.
    // 只有需要保留选区高亮时，指针打开才保留焦点；其他打开都把焦点移入面板，使菜单行可用键盘操作。
    options.open(anchor, target, !pointerInitiated || !holdsSelection(target));
    pointerInitiated = false;
  }

  function onPointerDown(event: PointerEvent) {
    pointerInitiated = true;
    if (event.pointerType !== "touch") return;
    if (isNativeMenuPending()) {
      pointerInitiated = false;
      cancelPress();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (options.keepNativeMenu(target)) return;
    cancelPress();
    pressOrigin = { x: event.clientX, y: event.clientY };
    pressElement = target;
    pressTimer = setTimeout(() => {
      if (pressOrigin !== undefined) options.open(pressOrigin, pressElement, false);
      cancelPress();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent) {
    if (pressOrigin === undefined) return;
    const moved =
      Math.abs(event.clientX - pressOrigin.x) > LONG_PRESS_TOLERANCE ||
      Math.abs(event.clientY - pressOrigin.y) > LONG_PRESS_TOLERANCE;
    if (moved) cancelPress();
  }

  element.addEventListener("contextmenu", onContextMenu);
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", cancelPress);
  element.addEventListener("pointercancel", cancelPress);

  return () => {
    cancelPress();
    element.removeEventListener("contextmenu", onContextMenu);
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", cancelPress);
    element.removeEventListener("pointercancel", cancelPress);
  };
}

/** Whether the pressed element is a text field with a non-empty selection. */
function holdsSelection(target: Element | null): boolean {
  if (target === null) return false;
  const field = target.closest<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (field === null) return false;
  return (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
}

/**
 * Whether a text field keeps the browser menu. A custom menu cannot supply spellcheck or
 * the assistive-technology entry points, so only regions that reimplement paste opt out.
 * 文本输入是否保留浏览器菜单。自定义菜单无法提供拼写检查与辅助技术入口，因此只有自行实现
 * 粘贴的区域才不保留。
 */
export function keepsNativeMenuByDefault(target: Element | null): boolean {
  return target !== null && target.closest(NATIVE_MENU_OWNERS) !== null;
}
