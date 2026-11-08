import { describe, expect, it } from "bun:test";
import { centerOf, copyFeedbackKey, resolveOpenPoint } from "./menu-model";

function contextEvent(clientX: number, clientY: number): MouseEvent {
  return { clientX, clientY } as MouseEvent;
}

describe("context menu anchors", () => {
  it("uses pointer coordinates when the event carries them", () => {
    expect(resolveOpenPoint(contextEvent(240, 160), null)).toEqual({ x: 240, y: 160 });
  });

  it("falls back to the target centre for a keyboard invocation", () => {
    const target = {
      getBoundingClientRect: () => ({ left: 100, top: 40, width: 200, height: 20 }),
    } as unknown as Element;
    expect(resolveOpenPoint(contextEvent(0, 0), target)).toEqual({ x: 200, y: 50 });
  });

  it("reports no anchor when a keyboard invocation has no target", () => {
    expect(resolveOpenPoint(contextEvent(0, 0), null)).toBeNull();
  });

  it("centres a rectangle regardless of its size", () => {
    expect(centerOf({ left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    expect(centerOf({ left: 10, top: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 });
  });
});

describe("copy feedback", () => {
  it("reports empty content instead of a permission failure", () => {
    expect(copyFeedbackKey("   ", false)).toBe("contextMenu.emptySelection");
  });

  it("reports success and failure for real content", () => {
    expect(copyFeedbackKey("text", true)).toBe("contextMenu.copied");
    expect(copyFeedbackKey("text", false)).toBe("contextMenu.copyFailed");
  });
});
