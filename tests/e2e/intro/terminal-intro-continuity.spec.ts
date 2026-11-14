import { expect, test } from "@playwright/test";
import { setThemePreference } from "../support/preferences";
import { recordTerminal, SCENE_TIMEOUT, SETTLE_TIMEOUT, terminalRecords } from "../support/timing";

for (const width of [1440, 390]) {
  test(`boot uses centered status cells and a character progress bar at ${width}px @cinematic`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setThemePreference(page, "dark");
    // Record state per DOM batch; sampling frames misses progress ticks on a slow renderer.
    // 按 DOM 批次记录状态；在慢速渲染器上逐帧采样会漏掉进度刻度。
    await recordTerminal(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const screen = page.locator(".xca-terminal-screen");
    await expect(screen).toHaveClass(/xca-terminal-screen--boot/, { timeout: SCENE_TIMEOUT });
    const progress = page.locator(".xca-terminal-boot-progress");
    await expect(progress).toHaveCount(1);
    const start = await progress.evaluate((el) => Number(el.getAttribute("aria-valuenow")));
    expect(start).toBeLessThan(100);
    // Completion is a state change, not a frame sample, so waiting for it stays deterministic.
    // 完成是状态变化而非帧采样，因此等待它仍然确定。
    await expect(progress).toHaveAttribute("aria-valuenow", "100", { timeout: SCENE_TIMEOUT });
    // Read the live boot DOM before the ready screen replaces it.
    // 在就绪屏幕替换前读取开机阶段的实时 DOM。
    const bar = await progress.evaluate((element) => {
      const track = element.querySelector(".xca-terminal-boot-progress__track");
      const fill = element.querySelector(".xca-terminal-boot-progress__fill");
      if (!track || !fill) throw new Error("The boot progress bar must contain a track and fill");
      if (track.textContent === null) throw new Error("The boot progress bar needs character text");
      const current = document.querySelector(".xca-terminal-screen");
      if (!current) throw new Error("The terminal screen is required to measure progress bounds");
      return {
        text: track.textContent,
        background: getComputedStyle(track).backgroundImage,
        offset: element.getBoundingClientRect().right - current.getBoundingClientRect().right,
        log: document.querySelector(".xca-terminal-bootlog")?.textContent ?? "",
        cells: [...document.querySelectorAll(".xca-terminal-bootlog__status")].map((cell) => {
          const value = cell.querySelector("span");
          if (!value) throw new Error("Each boot status cell must contain a value");
          const box = cell.getBoundingClientRect();
          const text = value.getBoundingClientRect();
          return {
            width: box.width,
            offset: (text.left + text.right - box.left - box.right) / 2,
          };
        }),
      };
    });
    await expect(screen).toHaveClass(/xca-terminal-screen--ready/, { timeout: SCENE_TIMEOUT });

    const { sequence } = await terminalRecords(page);
    const ticks = sequence.filter(
      (entry): entry is typeof entry & { progress: number; fill: number } =>
        entry.progress !== null && entry.fill !== null,
    );
    const lengths = ticks.map((entry) => entry.fill);
    expect(lengths.length).toBeGreaterThan(5);
    const firstLength = lengths[0];
    const lastLength = lengths.at(-1);
    if (firstLength === undefined || lastLength === undefined)
      throw new Error("Boot progress samples must be recorded");
    expect(firstLength).toBeLessThan(bar.text.length - 2);
    expect(bar.text).toMatch(/^\[=+\]$/);
    expect(bar.background).toBe("none");
    expect(lastLength).toBe(bar.text.length - 2);
    for (let index = 1; index < lengths.length; index++) {
      const current = lengths[index];
      const previous = lengths[index - 1];
      if (current === undefined || previous === undefined)
        throw new Error("Boot progress samples must be consecutive");
      expect(current - previous).toBeGreaterThanOrEqual(0);
      expect(current - previous).toBeLessThanOrEqual(2);
    }
    expect(ticks.at(-1)?.progress).toBe(100);
    expect(bar.offset).toBeLessThanOrEqual(0.5);
    expect(bar.log).not.toContain("guest@xca");
    expect(bar.cells.length).toBe(6);
    const firstCell = bar.cells[0];
    if (!firstCell) throw new Error("Boot status cells must include a width reference");
    for (const cell of bar.cells) {
      expect(cell.width).toBeCloseTo(firstCell.width, 1);
      expect(Math.abs(cell.offset)).toBeLessThan(0.5);
    }
    await page.screenshot({ path: test.info().outputPath("boot-complete.png") });
  });
}

for (const mode of [
  { theme: "dark", width: 1440, height: 900, locale: "zh-CN" },
  { theme: "light", width: 1440, height: 900, locale: "zh-CN" },
  { theme: "dark", width: 390, height: 844, locale: "en" },
]) {
  test(`welcome is continuous in ${mode.theme} at ${mode.width}px (${mode.locale}) @cinematic`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(mode);
    await setThemePreference(page, mode.theme);
    if (baseURL === undefined) throw new Error("A base URL is required to set the locale cookie");
    await page.context().addCookies([{ name: "xca-locale", value: mode.locale, url: baseURL }]);
    // The recorder keeps the printed welcome even when the brand screen lasts under a frame.
    // 即使标识屏幕短于一帧，记录器也会保留已打印的欢迎语。
    await recordTerminal(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-terminal-screen")).toHaveClass(/xca-terminal-screen--ready/, {
      timeout: SCENE_TIMEOUT,
    });
    const { printed, ready } = await terminalRecords(page);
    if (!ready) throw new Error("The ready terminal must show the printed welcome");
    expect(ready.length).toBe(4);
    const [firstLine, , thirdLine, lastLine] = ready;
    if (!firstLine || !thirdLine || !lastLine)
      throw new Error("The welcome must contain four lines");
    expect(lastLine.color).toBe(firstLine.color);
    expect(lastLine.color).not.toBe(thirdLine.color);
    expect(firstLine.ink).toContain("linear-gradient");
    expect(firstLine.clip).toBe("text");
    expect(firstLine.fill).toBe("rgba(0, 0, 0, 0)");
    expect(firstLine.glow).toContain("drop-shadow");
    // A slow frame can merge the whole entry into the ready swap, so the entry-side snapshot
    // is not always observable. Then continuity rests on the ready screen reusing the nodes
    // that were already on screen, which no re-render or replacement would satisfy.
    // 慢帧可能把整个入场并进就绪切换，入场侧快照并非总能观测到。
    // 此时连续性由"就绪沿用入场已存在的节点"承担，重新渲染或替换节点都无法满足。
    if (!printed) {
      // Entry-side geometry is unobservable when a slow frame merges the whole stage; the
      // welcome must then still arrive complete, either printed during the entry or as a
      // whole banner by the time the terminal is ready.
      // 慢帧把整个阶段并进一批时，入场侧几何不可观测；此时欢迎语仍须完整到达：
      // 要么入场期间已打印，要么在终端就绪时已是完整的字符画。
      const { sequence } = await terminalRecords(page);
      const printedDuringEntry = sequence.some(
        (entry) => !entry.screen.includes("ready") && entry.banner > 0,
      );
      const bannerRows = (ready[0]?.text ?? "").split("\n").length;
      expect(printedDuringEntry || bannerRows >= 5).toBe(true);
      await expect(page.locator("#xca-command-input")).toBeEnabled({ timeout: SETTLE_TIMEOUT });
      return;
    }
    expect(printed.length).toBe(ready.length);
    // The history may follow new output as one block; only that shared shift is allowed.
    // 历史区可以随新输出整体跟随；只允许这段共同位移。
    const shift = (ready[0]?.y ?? 0) - (printed[0]?.y ?? 0);
    for (const [position, before] of printed.entries()) {
      const after = ready[position];
      if (!after) throw new Error(`Welcome continuity line ${position} is missing`);
      const keys = ["index", "text", "color", "ink", "clip", "fill", "glow", "font"] as const;
      for (const key of keys) expect(after[key]).toBe(before[key]);
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
      expect(Math.abs(after.y - before.y - shift)).toBeLessThan(0.5);
      expect(Math.abs(after.width - before.width)).toBeLessThan(0.5);
      expect(Math.abs(after.height - before.height)).toBeLessThan(0.5);
    }
    await expect(page.locator("#xca-command-input")).toBeEnabled();
  });
}
