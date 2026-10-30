import { expect, test } from "@playwright/test";
import { setThemePreference } from "./preferences";

for (const width of [1440, 390]) {
  test(`boot uses centered status cells and a character progress bar at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setThemePreference(page, "dark");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, { timeout: 15000 });
    const progress = page.locator(".xca-terminal-boot-progress");
    await expect(progress).toHaveCount(1);
    const start = await progress.evaluate((el) => Number(el.getAttribute("aria-valuenow")));
    expect(start).toBeLessThan(100);
    const fills = await progress.evaluate(async (element) => {
      const track = element.querySelector(".xca-terminal-boot-progress__track");
      const fill = element.querySelector(".xca-terminal-boot-progress__fill");
      if (!track || !fill) throw new Error("The boot progress bar must contain a track and fill");
      function requiredText(node: Element) {
        const text = node.textContent;
        if (text === null) throw new Error("The boot progress bar must contain character text");
        return text;
      }
      const lengths: number[] = [];
      while (element.getAttribute("aria-valuenow") !== "100") {
        lengths.push(requiredText(fill).length);
        await new Promise(requestAnimationFrame);
      }
      lengths.push(requiredText(fill).length);
      return {
        lengths,
        text: requiredText(track),
        background: getComputedStyle(track).backgroundImage,
      };
    });
    expect(fills.lengths.length).toBeGreaterThan(5);
    expect(fills.lengths[0]).toBeLessThan(fills.text.length - 2);
    expect(fills.text).toMatch(/^\[=+\]$/);
    expect(fills.background).toBe("none");
    expect(fills.lengths.at(-1)).toBe(fills.text.length - 2);
    for (let index = 1; index < fills.lengths.length; index++) {
      const current = fills.lengths[index];
      const previous = fills.lengths[index - 1];
      if (current === undefined || previous === undefined)
        throw new Error("Boot progress samples must be consecutive");
      expect(current - previous).toBeGreaterThanOrEqual(0);
      expect(current - previous).toBeLessThanOrEqual(2);
    }
    await expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(
      await progress.evaluate((element) => {
        const screen = document.querySelector(".xca-terminal-screen");
        if (!screen) throw new Error("The terminal screen is required to measure progress bounds");
        return element.getBoundingClientRect().right - screen.getBoundingClientRect().right;
      }),
    ).toBeLessThanOrEqual(0.5);
    await expect(page.locator(".xca-terminal-bootlog")).not.toContainText("guest@xca");
    const cells = await page.locator(".xca-terminal-bootlog__status").evaluateAll((elements) =>
      elements.map((element) => {
        const value = element.querySelector("span");
        if (!value) throw new Error("Each boot status cell must contain a value");
        const cell = element.getBoundingClientRect();
        const text = value.getBoundingClientRect();
        return { width: cell.width, offset: (text.left + text.right - cell.left - cell.right) / 2 };
      }),
    );
    expect(cells.length).toBe(6);
    const firstCell = cells[0];
    if (!firstCell) throw new Error("Boot status cells must include a width reference");
    for (const cell of cells) {
      expect(cell.width).toBeCloseTo(firstCell.width, 1);
      expect(Math.abs(cell.offset)).toBeLessThan(0.5);
    }
    await page.screenshot({ path: test.info().outputPath("boot-complete.png") });
  });
}

async function observeWelcomeContinuity(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const read = () => {
      const screen = document.querySelector(".xca-terminal-screen");
      const terminal = document.querySelector(".xca-terminal-window");
      if (!screen || !terminal) throw new Error("Terminal geometry is required");
      const origin = screen.getBoundingClientRect();
      const transform = new DOMMatrixReadOnly(getComputedStyle(terminal).transform);
      const scale = Math.hypot(transform.a, transform.b);
      return [
        ...screen.querySelectorAll<HTMLElement>(
          ".xca-terminal-history .xca-terminal-banner, .xca-terminal-history .xca-terminal-line",
        ),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          node: element.dataset.continuity,
          text: element.textContent,
          color: style.color,
          ink: style.backgroundImage,
          clip: style.backgroundClip,
          fill: style.webkitTextFillColor,
          glow: style.filter,
          font: style.font,
          x: (rect.x - origin.x) / scale,
          y: (rect.y - origin.y) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        };
      });
    };
    type Welcome = ReturnType<typeof read>;
    return new Promise<{ printed: Welcome; ready: Welcome }>((resolve, reject) => {
      const deadline = performance.now() + 20000;
      let printed: Welcome | undefined;
      function sample() {
        const screen = document.querySelector(".xca-terminal-screen");
        const lines = screen?.querySelectorAll<HTMLElement>(
          ".xca-terminal-history .xca-terminal-banner, .xca-terminal-history .xca-terminal-line",
        );
        if (
          !printed &&
          screen?.classList.contains("xca-terminal-screen--brand") &&
          lines?.length === 4
        ) {
          lines.forEach((line, index) => {
            line.dataset.continuity = String(index);
          });
          printed = read();
        }
        if (printed && screen?.classList.contains("xca-terminal-screen--ready")) {
          resolve({ printed, ready: read() });
          return;
        }
        if (performance.now() > deadline) {
          reject(new Error("Printed welcome did not reach the ready terminal"));
          return;
        }
        requestAnimationFrame(sample);
      }
      sample();
    });
  });
}

for (const mode of [
  { theme: "dark", width: 1440, height: 900, locale: "zh-CN" },
  { theme: "light", width: 1440, height: 900, locale: "zh-CN" },
  { theme: "dark", width: 390, height: 844, locale: "en" },
]) {
  test(`welcome is continuous in ${mode.theme} at ${mode.width}px (${mode.locale})`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(mode);
    await setThemePreference(page, mode.theme);
    if (baseURL === undefined) throw new Error("A base URL is required to set the locale cookie");
    await page.context().addCookies([{ name: "xca-locale", value: mode.locale, url: baseURL }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const { printed, ready } = await observeWelcomeContinuity(page);
    expect(printed.length).toBe(4);
    const [firstLine, , thirdLine, lastLine] = printed;
    if (!firstLine || !thirdLine || !lastLine)
      throw new Error("The welcome must contain four lines");
    expect(lastLine.color).toBe(firstLine.color);
    expect(lastLine.color).not.toBe(thirdLine.color);
    expect(firstLine.ink).toContain("linear-gradient");
    expect(firstLine.clip).toBe("text");
    expect(firstLine.fill).toBe("rgba(0, 0, 0, 0)");
    expect(firstLine.glow).toContain("drop-shadow");
    for (const [index, before] of printed.entries()) {
      const after = ready[index];
      if (!after) throw new Error(`Welcome continuity line ${index} is missing`);
      for (const key of ["node", "text", "color", "ink", "clip", "fill", "glow", "font"] as const)
        expect(after[key]).toBe(before[key]);
      for (const key of ["x", "y", "width", "height"] as const)
        expect(Math.abs(after[key] - before[key])).toBeLessThan(0.5);
    }
    await expect(page.locator("#xca-command-input")).toBeEnabled();
  });
}
