const nativeMenuEvents = new WeakSet<Event>();
let cancelPendingMenu: (() => void) | undefined;

/**
 * Pass the next real context-menu gesture through every region without cancelling it.
 * A different click or key cancels the request, and the owner can cancel it on unmount.
 * 让下一次真实的上下文菜单操作通过所有区域，不取消浏览器默认行为。
 * 其他点击或按键会取消请求，所属组件卸载时也可以取消。
 */
export function requestNativeMenu(document: Document, onFinish: () => void): () => void {
  cancelPendingMenu?.();
  let active = true;

  function finish() {
    if (!active) return;
    active = false;
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    if (cancelPendingMenu === finish) cancelPendingMenu = undefined;
    onFinish();
  }

  function onContextMenu(event: Event) {
    if (!event.isTrusted) return;
    nativeMenuEvents.add(event);
    finish();
  }

  function onClick(event: MouseEvent) {
    if (event.isTrusted) finish();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!event.isTrusted) return;
    if (["Shift", "Control", "Alt", "Meta", "ContextMenu"].includes(event.key)) return;
    if (event.key === "F10" && event.shiftKey) return;
    finish();
  }

  cancelPendingMenu = finish;
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  return finish;
}

export function isNativeMenuPending(): boolean {
  return cancelPendingMenu !== undefined;
}

export function isNativeMenuEvent(event: Event): boolean {
  return nativeMenuEvents.has(event);
}
