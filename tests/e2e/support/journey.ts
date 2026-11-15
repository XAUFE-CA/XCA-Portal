import { expect, type Page } from "@playwright/test";
import { advanceUntil, SCENE_TIMEOUT } from "./timing";

export async function freezeApproach(page: Page, fraction: number) {
  await page.evaluate((progress) => {
    const camera = document.getAnimations().find((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return target instanceof Element && target.matches(".xca-ca-intro__camera");
    });
    const elapsed = Number(camera?.effect?.getTiming().duration ?? 0) * progress;
    for (const animation of document.getAnimations()) {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (!(target instanceof Element) || !target.closest(".xca-ca-intro, .xca-terminal-window"))
        continue;
      if (animation.playState === "finished") continue;
      animation.pause();
      animation.currentTime = elapsed;
    }
  }, fraction);
}

export function approachPositions(page: Page, depths: number[]) {
  return page.evaluate((targets) => {
    const camera = document
      .getAnimations()
      .find(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target instanceof Element &&
          animation.effect.target.matches(".xca-ca-intro__camera"),
      );
    if (!(camera?.effect instanceof KeyframeEffect)) throw new Error("Journey camera required");
    const viewport = document.querySelector(".xca-ca-intro__viewport");
    if (!viewport) throw new Error("Scene viewport required");
    const focal = Number.parseFloat(getComputedStyle(viewport).perspective);
    const frames = camera.effect.getKeyframes().map((frame) => ({
      progress: frame.computedOffset,
      z: new DOMMatrixReadOnly(String(frame.transform))
        .inverse()
        .transformPoint({ x: 0, y: 0, z: focal }).z,
    }));
    return targets.map(
      (depth) =>
        frames.reduce((nearest, frame) =>
          Math.abs(frame.z - depth) < Math.abs(nearest.z - depth) ? frame : nearest,
        ).progress,
    );
  }, depths);
}
export async function resumeScene(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations())
      if (animation.playState === "paused") animation.play();
  });
}

export async function recordBannerPrinting(page: Page) {
  await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>(".xca-terminal-screen");
    const banner = screen?.querySelector(".xca-terminal-banner");
    if (!screen || !banner) throw new Error("Terminal banner is required");
    const rows: number[] = [];
    const observer = new MutationObserver(() => {
      const text = banner.textContent ?? "";
      const count = text.length ? text.split("\n").length : 0;
      if (rows.at(-1) !== count) rows.push(count);
      screen.dataset.printedBannerRows = JSON.stringify(rows);
      if (screen.classList.contains("xca-terminal-screen--ready")) observer.disconnect();
    });
    observer.observe(screen, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

/** Step the scene timeline until the camera reports a journey stage. */
export function advanceToStage(page: Page, stage: string): Promise<boolean> {
  return advanceUntil(
    page,
    `document.querySelector(".xca-ca-intro")?.dataset.journey === "${stage}"`,
  );
}

/** Step the scene timeline until the terminal reports a screen modifier. */
export function advanceToScreen(page: Page, screen: string): Promise<boolean> {
  return advanceUntil(page, `!!document.querySelector(".xca-terminal-screen--${screen}")`);
}

export async function expectCenteredTerminal(
  page: Page,
  viewport: { width: number; height: number },
) {
  const terminal = page.locator(".xca-terminal-window");
  await expect(async () => {
    const geometry = await terminal.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return {
        width: bounds.width,
        height: bounds.height,
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
        scaleX: transform.a,
        scaleY: transform.d,
      };
    });
    expect(geometry.scaleX).toBeCloseTo(geometry.scaleY, 3);
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.height).toBeLessThanOrEqual(viewport.height);
    expect(geometry.x).toBeCloseTo(viewport.width / 2, 0);
    expect(geometry.y).toBeCloseTo(viewport.height / 2, 0);
  }).toPass({ timeout: SCENE_TIMEOUT });
  await expect(terminal).not.toHaveAttribute("inert");
}

export async function expectStageGlass(page: Page) {
  const surface = await page.locator(".xca-terminal-window").evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    const w = node.clientWidth / 2,
      h = node.clientHeight / 2;
    const project = (x: number, y: number) => {
      const point = matrix.transformPoint(new DOMPoint(x, y));
      return { x: point.x / point.w, y: point.y / point.w };
    };
    const top = project(-w, -h),
      right = project(w, -h),
      bottom = project(-w, h);
    return {
      vertical: Math.abs(top.x - bottom.x) / Math.abs(right.x - top.x),
      horizontal: top.y - right.y,
      edge: getComputedStyle(node, "::before").display,
    };
  });
  expect(surface.vertical).toBeLessThan(0.15);
  expect(surface.horizontal).toBeCloseTo(0, 6);
  expect(surface.edge).toBe("block");
}

export {
  captureRoomMaterials,
  type RoomPortalProbe,
  roomPortalProbe,
  sampleRoomPortal,
} from "./room-portal";
