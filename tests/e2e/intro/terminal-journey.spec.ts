import { expect, test } from "@playwright/test";
import { advanceToScreen } from "../support/journey";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "../support/timing";

test("motion preference change and rotation settle a readable terminal @cinematic", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "approach", {
    timeout: SCENE_TIMEOUT,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  // A reload reuses the documented short entry, which never mounts the long scene.
  // 重载复用文档约定的短入场，它不会挂载长场景。
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0, { timeout: SETTLE_TIMEOUT });
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("repeated intro replay preserves host, directory, appearance and history @cinematic", async ({
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
    // Skipping settles asynchronously; an inert host silently drops the next keys on fast renderers.
    // 跳过的收尾是异步的；快渲染器上仍为 inert 的宿主会静默丢弃后续按键。
    await expect(terminal).not.toHaveAttribute("inert", { timeout: SETTLE_TIMEOUT });
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

test("journey timeline records frame timings and releases spatial animations @cinematic", async ({
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
  // Step the timeline to ready; rAF samples stay real, but cues no longer wait out their wall clock.
  // 将时间线步进到 ready；rAF 样本仍是真实帧，但提示不再按墙钟等完。
  await advanceToScreen(page, "ready");
  await expect(page.locator(".xca-terminal-screen--ready")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
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
      // Ambient loops such as the shared caret breathe never settle by design, so only
      // finite arrival effects count as still running.
      // 共享光标呼吸等环境循环本就永不结束，因此只统计有限的到达动效。
      runningSpatialEffects: document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return (
          target instanceof Element &&
          !!target.closest(".xca-ca-intro, .xca-terminal-window") &&
          animation.playState === "running" &&
          animation.effect?.getComputedTiming().iterations !== Infinity
        );
      }).length,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    };
  });
  expect(metrics.samples).toBeGreaterThan(10);
  // Spatial effects are released as the arrival settles, so wait for the release.
  // 空间效果随到达收尾释放，因此等待释放完成。
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.getAnimations().filter((animation) => {
              const target =
                animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
              return (
                target instanceof Element &&
                !!target.closest(".xca-ca-intro, .xca-terminal-window") &&
                animation.playState === "running" &&
                animation.effect?.getComputedTiming().iterations !== Infinity
              );
            }).length,
        ),
      { timeout: SETTLE_TIMEOUT },
    )
    .toBe(0);
  await testInfo.attach("journey-frame-timings", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});

test("a visualViewport-only resize settles the current projection @cinematic", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "cruise", {
    timeout: SCENE_TIMEOUT,
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
