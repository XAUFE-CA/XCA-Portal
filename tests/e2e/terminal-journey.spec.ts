import { expect, type Page, test } from "@playwright/test";

async function freezeApproach(page: Page, fraction: number) {
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
async function resumeScene(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations())
      if (animation.playState === "paused") animation.play();
  });
}

async function recordBannerPrinting(page: Page) {
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

for (const mode of [
  { width: 1440, height: 900, theme: "dark", dpr: 1 },
  { width: 1440, height: 900, theme: "light", dpr: 1 },
  { width: 390, height: 844, theme: "dark", dpr: 2 },
]) {
  test.describe(`journey ${mode.theme} ${mode.width}px DPR ${mode.dpr}`, () => {
    test.use({ viewport: mode, deviceScaleFactor: mode.dpr });
    test("brand geometry reaches the single real terminal without a projection jump", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((theme) => localStorage.setItem("xca-theme", theme), mode.theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const scene = page.locator(".xca-ca-intro");
      await expect(scene).toHaveAttribute("data-journey", "approach", { timeout: 15000 });
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
      await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1);
      await recordBannerPrinting(page);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      const arriving = await terminal.boundingBox();
      if (!arriving) throw new Error("The single real terminal must be projected during boot");
      await expect
        .poll(async () => (await terminal.boundingBox())?.width ?? 0)
        .toBeGreaterThan(arriving.width);
      await expect(scene).toHaveAttribute("data-journey", "cruise");
      await expect
        .poll(() => page.locator(".xca-terminal-bootlog__line").count())
        .toBeGreaterThan(0);
      expect(await page.locator(".xca-terminal-bootlog__line").count()).toBeLessThan(5);
      await page.screenshot({ path: test.info().outputPath("boot-cruise.png") });
      await expect(scene).toHaveAttribute("data-journey", "retreat");
      await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(5);
      await page.waitForTimeout(160);
      await page.screenshot({ path: test.info().outputPath("boot-arrival.png") });
      await expect(page.locator(".xca-terminal-hero__heading")).not.toHaveCSS("opacity", "0");
      await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(6);
      await expect(page.locator(".xca-terminal-screen--brand")).toHaveCount(1);
      await expect(scene).toHaveCount(0);
      await expect(terminal).toHaveAttribute("data-journey-persistent", "yes");
      await expect(page.locator(".xca-terminal-screen--ready")).toHaveCount(1, { timeout: 8000 });
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

for (const stage of ["draw", "approach", "cruise", "retreat", "brand"]) {
  test(`Escape cleans up the ${stage} stage without replacing the host`, async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const terminal = page.locator(".xca-terminal-window");
    await terminal.evaluate((node) => {
      node.setAttribute("data-original-host", "yes");
    });
    if (stage === "brand")
      await expect(page.locator(`.xca-terminal-screen--${stage}`)).toHaveCount(1, {
        timeout: 15000,
      });
    else
      await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", stage, {
        timeout: 15000,
      });
    await page.keyboard.press("Escape");
    await expect(page.locator(".xca-ca-intro, .xca-terminal-hero__intro-backdrop")).toHaveCount(0);
    await expect(page.locator("#xca-command-input")).toBeEnabled();
    await expect(terminal).toHaveAttribute("data-original-host", "yes");
    expect(
      await page.evaluate(() =>
        document.getAnimations().some((animation) => {
          const target =
            animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          return target instanceof Element && !!target.closest(".xca-ca-intro");
        }),
      ),
    ).toBe(false);
  });
}

test("motion preference change and rotation settle a readable terminal", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
    timeout: 15000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "cruise", {
    timeout: 15000,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const stage of ["approach", "cruise"]) {
  test(`visibility pause preserves the ${stage} timeline and resumes it`, async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", stage, {
      timeout: 15000,
    });
    const before = await page.evaluate(async () => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      const paused = document
        .getAnimations()
        .filter((animation) => animation.playState === "paused");
      await Promise.all(paused.map((animation) => animation.ready));
      return {
        times: document
          .getAnimations()
          .filter((animation) => animation.playState === "paused")
          .map((animation) => animation.currentTime),
        lines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
      };
    });
    expect(before.times.length).toBeGreaterThan(0);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      times: document
        .getAnimations()
        .filter((animation) => animation.playState === "paused")
        .map((animation) => animation.currentTime),
      lines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
    }));
    expect(after).toEqual(before);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".xca-terminal-screen--ready")).toHaveCount(1, { timeout: 15000 });
  });
}

test("repeated intro replay preserves host, directory, appearance and history", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  const terminal = page.locator(".xca-terminal-window");
  await terminal.evaluate((node) => {
    node.setAttribute("data-session-host", "retained");
  });
  const input = page.locator("#xca-command-input");
  for (const command of ["cd /community", "xca theme dark", "echo retained-history"]) {
    await input.fill(command);
    await input.press("Enter");
  }
  for (let replay = 0; replay < 3; replay++) {
    await input.fill("xca intro");
    await input.press("Enter");
    await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "draw");
    await page.keyboard.press("Escape");
    await expect(input).toBeEnabled();
    await expect(terminal).toHaveAttribute("data-session-host", "retained");
    await expect(terminal.locator(".xca-terminal-statusbar")).toContainText("/community");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
  await input.press("ArrowUp");
  await expect(input).toHaveValue("xca intro");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("echo retained-history");
  await expect(terminal).toHaveCount(1);
});

test("natural journey records frame timings and releases spatial animations", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const metrics = { frames: [] as number[], longTasks: [] as number[] };
    Object.assign(window, { journeyMetrics: metrics });
    let started = false;
    let observer: PerformanceObserver | undefined;
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    }
    function record(time: number) {
      const intro = document.querySelector(".xca-terminal-hero--intro");
      if (intro) {
        started = true;
        metrics.frames.push(time);
      }
      if (!started || intro) requestAnimationFrame(record);
      else observer?.disconnect();
    }
    requestAnimationFrame(record);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-screen--ready")).toHaveCount(1, { timeout: 15000 });
  const metrics = await page.evaluate(() => {
    const data = (
      window as unknown as {
        journeyMetrics: { frames: number[]; longTasks: number[] };
      }
    ).journeyMetrics;
    const intervals = data.frames
      .slice(1)
      .map((value, index) => value - (data.frames[index] ?? value))
      .sort((a, b) => a - b);
    return {
      samples: intervals.length,
      medianFrameMs: intervals[Math.floor(intervals.length / 2)],
      p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
      longestTaskMs: Math.max(0, ...data.longTasks),
      runningSpatialEffects: document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return (
          target instanceof Element &&
          !!target.closest(".xca-ca-intro, .xca-terminal-window") &&
          animation.playState === "running"
        );
      }).length,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    };
  });
  expect(metrics.samples).toBeGreaterThan(10);
  expect(metrics.runningSpatialEffects).toBe(0);
  await testInfo.attach("journey-frame-timings", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});

test("a visualViewport-only resize settles the current projection", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "cruise", {
    timeout: 15000,
  });
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Chromium must expose visualViewport");
    Object.defineProperty(viewport, "height", { configurable: true, value: viewport.height - 120 });
    viewport.dispatchEvent(new Event("resize"));
    Reflect.deleteProperty(viewport, "height");
  });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
});
