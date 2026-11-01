import type { Page } from "@playwright/test";

/**
 * Start the document in the brief entry that a later navigation in the same session uses.
 * The long scene is covered by the intro specs; functional specs only need a ready terminal,
 * and every extra second of choreography costs a software-rendered runner several more.
 * 让文档走会话内后续导航的短入场。长场景由入场专项用例覆盖，功能用例只需要就绪终端；
 * 而编排每多一秒，软件渲染的运行器就要多花数秒。
 */
export async function useBriefEntry(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("xca-intro-session", "1");
    } catch {
      // Unavailable storage keeps the full entry for this document.
      // 存储不可用时该文档仍走完整入场。
    }
  });
}
