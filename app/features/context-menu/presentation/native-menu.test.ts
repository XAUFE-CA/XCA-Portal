import { afterEach, expect, it, mock } from "bun:test";
import { isNativeMenuEvent, isNativeMenuPending, requestNativeMenu } from "./native-menu";
import { attachRegionListeners } from "./region-listeners";

class TestEvents {
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function event(properties: Record<string, unknown>): Event {
  return { isTrusted: true, ...properties } as unknown as Event;
}

let cancel: (() => void) | undefined;

afterEach(() => {
  cancel?.();
  cancel = undefined;
});

it("passes one trusted event through all regions, then restores the custom menu", () => {
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  Object.defineProperty(globalThis, "Element", { value: class {}, configurable: true });
  const document = new TestEvents();
  const region = new TestEvents();
  const outerRegion = new TestEvents();
  const open = mock();
  const finish = mock();
  const options = { open, keepNativeMenu: () => false };
  const detach = attachRegionListeners(region as unknown as HTMLElement, options);
  const detachOuter = attachRegionListeners(outerRegion as unknown as HTMLElement, options);

  try {
    cancel = requestNativeMenu(document as unknown as Document, finish);
    document.emit("contextmenu", event({ isTrusted: false }));
    expect(isNativeMenuPending()).toBe(true);

    const preventDefault = mock();
    const nativeEvent = event({ target: null, clientX: 20, clientY: 30, preventDefault });
    document.emit("contextmenu", nativeEvent);
    region.emit("contextmenu", nativeEvent);
    outerRegion.emit("contextmenu", nativeEvent);
    expect(isNativeMenuEvent(nativeEvent)).toBe(true);
    expect(isNativeMenuPending()).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);

    const nextEvent = event({ target: null, clientX: 20, clientY: 30, preventDefault });
    document.emit("contextmenu", nextEvent);
    region.emit("contextmenu", nextEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    detach();
    detachOuter();
    if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});

it("keeps menu-key gestures armed and cancels on another click or key", () => {
  const document = new TestEvents();
  const finish = mock();
  cancel = requestNativeMenu(document as unknown as Document, finish);
  document.emit("keydown", event({ key: "Shift" }));
  document.emit("keydown", event({ key: "F10", shiftKey: true }));
  document.emit("keydown", event({ key: "ContextMenu" }));
  document.emit("click", event({ isTrusted: false }));
  expect(isNativeMenuPending()).toBe(true);

  document.emit("click", event({}));
  expect(isNativeMenuPending()).toBe(false);
  expect(finish).toHaveBeenCalledTimes(1);

  cancel = requestNativeMenu(document as unknown as Document, finish);
  document.emit("keydown", event({ key: "Escape" }));
  expect(isNativeMenuPending()).toBe(false);
  expect(finish).toHaveBeenCalledTimes(2);
});

it("replaces a pending request without letting its old owner cancel the new one", () => {
  const document = new TestEvents();
  const firstFinish = mock();
  const secondFinish = mock();
  const cancelFirst = requestNativeMenu(document as unknown as Document, firstFinish);
  cancel = requestNativeMenu(document as unknown as Document, secondFinish);
  expect(firstFinish).toHaveBeenCalledTimes(1);
  cancelFirst();
  expect(isNativeMenuPending()).toBe(true);
  document.emit("contextmenu", event({}));
  expect(secondFinish).toHaveBeenCalledTimes(1);
  expect(isNativeMenuPending()).toBe(false);
});

it("does not start a custom long press while the native menu is pending", async () => {
  const document = new TestEvents();
  const region = new TestEvents();
  const open = mock();
  const detach = attachRegionListeners(region as unknown as HTMLElement, {
    open,
    keepNativeMenu: () => false,
  });
  try {
    cancel = requestNativeMenu(document as unknown as Document, () => {});
    region.emit("pointerdown", event({ pointerType: "touch", clientX: 20, clientY: 30 }));
    await Bun.sleep(550);
    expect(open).not.toHaveBeenCalled();
    expect(isNativeMenuPending()).toBe(true);
  } finally {
    detach();
  }
});
