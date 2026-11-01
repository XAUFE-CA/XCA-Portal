import { expect, test } from "@playwright/test";
import {
  advanceToScreen,
  advanceToStage,
  freezeApproach,
  recordBannerPrinting,
  resumeScene,
} from "./journey";
import { setThemePreference } from "./preferences";
import { recordTerminal, SCENE_TIMEOUT, terminalRecords } from "./timing";

for (const mode of [
  { width: 1440, height: 900, theme: "dark", dpr: 1 },
  { width: 1440, height: 900, theme: "light", dpr: 1 },
  { width: 390, height: 844, theme: "dark", dpr: 2 },
]) {
  test.describe(`journey ${mode.theme} ${mode.width}px DPR ${mode.dpr}`, () => {
    test.use({ viewport: mode, deviceScaleFactor: mode.dpr });
    test("brand geometry reaches the single real terminal without a projection jump @cinematic", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await setThemePreference(page, mode.theme);
      // Record boot progression per DOM batch; frame sampling cannot keep up on CI runners.
      // 按 DOM 批次记录开机进度；CI 运行器上逐帧采样跟不上。
      await recordTerminal(page);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const scene = page.locator(".xca-ca-intro");
      await expect(scene).toHaveAttribute("data-journey", "approach", { timeout: SCENE_TIMEOUT });
      const original = await (await page.request.get("/brand/ca-mark.svg")).text();
      const paths = [...original.matchAll(/<path[\s\S]*?d="([\s\S]*?)"/g)].map((match) => match[1]);
      expect(
        await scene
          .locator(".xca-ca-intro__front path")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d"))),
      ).toEqual(paths);
      const terminal = page.locator(".xca-terminal-window");
      await terminal.evaluate((node) => node.setAttribute("data-journey-persistent", "yes"));
      for (const fraction of [0, 0.24, 0.43, 0.57, 0.8, 0.85]) {
        await freezeApproach(page, fraction);
        if (fraction >= 0.8) {
          await expect(terminal).toHaveCSS("visibility", "visible");
          const opacity = await terminal.evaluate((node) => Number(getComputedStyle(node).opacity));
          expect(opacity).toBeGreaterThan(fraction === 0.8 ? 0.05 : 0.4);
          expect(opacity).toBeLessThan(1);
          await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(0);
        }
        await page.screenshot({ path: test.info().outputPath(`camera-${fraction}.png`) });
      }
      await resumeScene(page);
      // Capture the projection before the arrival finish; the terminal must keep growing from here.
      // 在到达收尾前记录投影；终端此后必须继续放大。
      const arriving = await terminal.boundingBox();
      if (!arriving) throw new Error("The single real terminal must be projected during boot");
      await advanceToScreen(page, "boot");
      await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--boot/, {
        timeout: SCENE_TIMEOUT,
      });
      await recordBannerPrinting(page);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      // The stepped timeline can already reach the settled width, so require growth, not a jump.
      // 步进后的时间线可能已达最终宽度，因此只要求不缩小。
      const grown = (await terminal.boundingBox())?.width ?? 0;
      expect(grown).toBeGreaterThanOrEqual(arriving.width);
      await advanceToStage(page, "cruise");
      await expect(scene).toHaveAttribute("data-journey", "cruise", { timeout: SCENE_TIMEOUT });
      await expect
        .poll(() => page.locator(".xca-terminal-bootlog__line").count(), { timeout: SCENE_TIMEOUT })
        .toBeGreaterThan(0);
      await page.screenshot({ path: test.info().outputPath("boot-cruise.png") });
      await advanceToStage(page, "retreat");
      await expect(scene).toHaveAttribute("data-journey", "retreat", { timeout: SCENE_TIMEOUT });
      await page.waitForTimeout(160);
      await page.screenshot({ path: test.info().outputPath("boot-arrival.png") });
      await expect(page.locator(".xca-terminal-hero__heading")).not.toHaveCSS("opacity", "0");
      await advanceToScreen(page, "brand");
      await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--brand/);
      await expect(scene).toHaveCount(0);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      await advanceToScreen(page, "ready");
      await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--ready/, {
        timeout: SCENE_TIMEOUT,
      });
      // Boot lines print one at a time; the records prove it without racing live counts.
      // 开机日志逐行打印；记录足以证明，无需与实时行数赛跑。
      const { sequence } = await terminalRecords(page);
      const cruiseLines = sequence
        .filter((entry) => entry.stage === "cruise")
        .map((entry) => entry.bootLines);
      expect(Math.max(0, ...cruiseLines)).toBeLessThan(5);
      // The boot log unmounts once the terminal is ready, so only its printed prefix is monotonic.
      // 终端就绪后开机日志会卸载，因此只有已打印的前缀需要单调。
      const printedRecords = sequence.filter((entry) => entry.bootLines > 0);
      expect(Math.max(0, ...printedRecords.map((entry) => entry.bootLines))).toBe(6);
      for (let index = 1; index < printedRecords.length; index++) {
        const current = printedRecords[index];
        const previous = printedRecords[index - 1];
        if (!current || !previous) throw new Error("Boot records must be consecutive");
        expect(current.bootLines - previous.bootLines).toBeGreaterThanOrEqual(0);
        expect(current.bootLines - previous.bootLines).toBeLessThanOrEqual(1);
      }
      const printed: number[] = await page
        .locator(".xca-terminal-screen")
        .evaluate((node) => JSON.parse((node as HTMLElement).dataset.printedBannerRows ?? "[]"));
      expect(printed).toContain(1);
      for (let index = 1; index < printed.length; index++) {
        expect((printed[index] ?? 0) - (printed[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
      await expect(terminal).toHaveCount(1);
      await page.locator("#xca-command-input").fill("echo journey-ready");
      await page.locator("#xca-command-input").press("Enter");
      await expect(page.locator(".xca-terminal-line").last()).toHaveText("journey-ready");
      expect(errors).toEqual([]);
    });
  });
}
