import { expect, test } from "@playwright/test";
import {
  advanceToScreen,
  expectCenteredTerminal,
  expectStageGlass,
  freezeApproach,
  recordBannerPrinting,
  resumeScene,
} from "../support/journey";
import { setThemePreference } from "../support/preferences";
import { recordTerminal, SCENE_TIMEOUT, terminalRecords } from "../support/timing";

for (const mode of [
  { width: 1440, height: 900, theme: "dark", dpr: 1 },
  { width: 1440, height: 900, theme: "light", dpr: 1 },
  { width: 390, height: 844, theme: "dark", dpr: 2 },
]) {
  test.describe(`journey ${mode.theme} ${mode.width}px DPR ${mode.dpr}`, () => {
    test.use({ viewport: mode, deviceScaleFactor: mode.dpr });
    test("the stage glass appears after CA without exposing terminal chrome @cinematic", async ({
      page,
    }) => {
      await setThemePreference(page, mode.theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const scene = page.locator(".xca-ca-intro");
      await expect(scene).toHaveAttribute("data-journey", "approach", { timeout: SCENE_TIMEOUT });
      const terminal = page.locator(".xca-terminal-window");
      for (const fraction of [0, 0.24, 0.43, 0.57, 0.78, 0.8]) {
        await freezeApproach(page, fraction);
        if (fraction >= 0.78) {
          await expect(terminal).toHaveCSS("visibility", "visible");
          await expect(terminal).toHaveCSS("opacity", "1");
          await expect(terminal).toHaveAttribute("inert", "");
          await expect(page.locator(".xca-terminal-chrome")).toHaveCSS("opacity", "0");
          await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(0);
          await expectStageGlass(page);
        } else {
          await expect(terminal).toHaveCSS("visibility", "hidden");
        }
        await page.screenshot({ path: test.info().outputPath(`camera-${fraction}.png`) });
      }
    });

    test("the stage glass becomes the single readable terminal through boot and docking @cinematic", async ({
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
      const terminal = page.locator(".xca-terminal-window");
      await terminal.evaluate((node) => node.setAttribute("data-journey-persistent", "yes"));
      await freezeApproach(page, 0.8);
      await resumeScene(page);
      await advanceToScreen(page, "boot");
      await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--boot/, {
        timeout: SCENE_TIMEOUT,
      });
      await recordBannerPrinting(page);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      await expectCenteredTerminal(page, mode);
      await advanceToScreen(page, "ready");
      await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--ready/, {
        timeout: SCENE_TIMEOUT,
      });
      await expect(page.locator(".xca-terminal-hero__heading")).not.toHaveCSS("opacity", "0");
      await expect(scene).toHaveCount(0);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      // Boot lines print one at a time; the records prove it without racing live counts.
      // 开机日志逐行打印；记录足以证明，无需与实时行数赛跑。
      const { sequence } = await terminalRecords(page);
      // Assert transient stages from the DOM recorder, not from a later live render.
      // 通过 DOM 记录断言瞬时阶段，不依赖随后读取的实时画面。
      const cruise = sequence.findIndex((entry) => entry.stage === "cruise");
      const retreat = sequence.findIndex((entry) => entry.stage === "retreat");
      expect(cruise).toBeGreaterThanOrEqual(0);
      expect(retreat).toBeGreaterThan(cruise);
      expect(sequence.some((entry) => entry.screen.includes("brand"))).toBe(true);
      const cruiseLines = sequence
        .filter((entry) => entry.stage === "cruise")
        .map((entry) => entry.bootLines);
      expect(Math.max(0, ...cruiseLines)).toBeLessThan(5);
      expect(cruiseLines.some((count) => count > 0)).toBe(true);
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
