import type { Page } from "@playwright/test";
import { advanceUntil } from "./timing";

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
