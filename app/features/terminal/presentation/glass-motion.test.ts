import { afterEach, expect, test } from "bun:test";
import { refreshGlassDuring } from "./glass-motion";

const originals = new Map<string, PropertyDescriptor | undefined>();
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

function harness(pixelRatio = 1) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  let refreshes = 0;
  let x = 0;
  const globals = {
    window: { devicePixelRatio: pixelRatio },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const finished = Promise.withResolvers<Animation>();
  const animation = {
    currentTime: 1,
    playState: "running",
    pending: false,
    effect: { getTiming: () => ({ delay: 0 }) },
    finished: finished.promise,
  } as Animation;
  const element = {
    getBoundingClientRect: () => ({ left: x, right: x + 100, top: 0, bottom: 100 }),
  } as HTMLElement;
  return {
    animation,
    element,
    renderer: { refresh: () => refreshes++ },
    count: () => refreshes,
    move: (value: number) => {
      x = value;
    },
    tick: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
    finish: () => finished.resolve(animation),
    cancel: () => finished.reject(new Error("cancelled")),
    pending: () => callbacks.size,
  };
}

test("expansion redraws only when a device-pixel boundary changes and flushes its final frame", async () => {
  const h = harness(2);
  refreshGlassDuring(h.animation, h.renderer, h.element);
  h.tick();
  for (let index = 0; index < 10; index++) h.tick();
  expect(h.count()).toBe(1);
  h.move(0.2);
  h.tick();
  expect(h.count()).toBe(1);
  h.move(0.3);
  h.tick();
  expect(h.count()).toBe(2);
  h.finish();
  await Promise.resolve();
  expect(h.count()).toBe(3);
  expect(h.pending()).toBe(0);
});

test("intro keeps refreshing non-geometric effects and cancellation releases the frame loop", async () => {
  const h = harness();
  refreshGlassDuring(h.animation, h.renderer);
  h.tick();
  h.tick();
  expect(h.count()).toBe(2);
  h.cancel();
  await Promise.resolve();
  expect(h.count()).toBe(3);
  expect(h.pending()).toBe(0);
  h.tick();
  expect(h.count()).toBe(3);
});
