import { expect, test } from "bun:test";
import { playIntroMark } from "./intro-mark";

test("terminal boot handoff begins before camera completion and reuses its arrival cue", async () => {
  const camera = { style: { transform: "" } } as HTMLElement;
  const paths = [{}] as SVGPathElement[];
  let finishCamera: (() => void) | undefined;
  let cameraFinished = false;
  const root = {
    clientWidth: 1440,
    clientHeight: 900,
    dataset: {},
    style: { setProperty() {} },
    querySelector: () => camera,
    querySelectorAll: (selector: string) =>
      selector.includes("__front path") ? paths : selector.includes("__camera") ? [camera] : [],
  } as unknown as HTMLElement;
  const terminal = {
    style: { transform: "translate(0px, 0px)" },
    animate() {},
    getBoundingClientRect: () => ({ width: 960, height: 448 }),
  } as unknown as HTMLElement;
  await playIntroMark({
    root,
    terminal,
    centered: { x: 0, y: 0, scale: 1 },
    unit: 420,
    signal: new AbortController().signal,
    animate: async (element) => {
      if (element !== camera) return;
      await new Promise<void>((resolve) => {
        finishCamera = resolve;
      });
      cameraFinished = true;
    },
    onHandoff: async (arrival) => {
      expect(cameraFinished).toBe(false);
      expect(finishCamera).toBeDefined();
      await arrival;
      finishCamera?.();
    },
  });
  expect(cameraFinished).toBe(true);
});
