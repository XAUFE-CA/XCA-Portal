import { expect, type Page, test } from "@playwright/test";
import { setThemePreference } from "../support/preferences";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "../support/timing";

async function ready(page: Page) {
  // Skipping settles by frames on software renderers; the default 20s window is too short.
  // 软件渲染器按帧完成跳过收尾，默认 20s 窗口不够。
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT,
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-xca-intro", {
    timeout: SETTLE_TIMEOUT,
  });
  // An inert host silently drops keys after skipping; toBeEnabled does not check inert.
  // 跳过后仍为 inert 的宿主元素会静默丢弃按键；toBeEnabled 不检查 inert。
  await expect(page.locator(".xca-terminal-window")).not.toHaveAttribute("inert", {
    timeout: SETTLE_TIMEOUT,
  });
  await expect(page.locator("#xca-command-input")).toBeEnabled();
}

async function watchScenes(page: Page) {
  await page.addInitScript(() => {
    const seen = { scene: false, boot: false };
    Object.assign(window, { entrySeen: seen });
    new MutationObserver(() => {
      seen.scene ||= !!document.querySelector(".xca-ca-intro");
      seen.boot ||= !!document.querySelector(".xca-terminal-screen--boot");
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
}

async function holdBriefEntry(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("xca-intro-session", "1");
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches(".xca-terminal-window, .xca-terminal-hero__heading")) animation.pause();
      return animation;
    };
  });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".xca-terminal-window")
        .evaluate((node) =>
          node.getAnimations().some((animation) => animation.playState === "paused"),
        ),
    )
    .toBe(true);
}

test("brief entry keeps the terminal usable without skip controls", async ({ page }) => {
  await holdBriefEntry(page);
  await expect(page.getByRole("button", { name: "跳过进入动画", exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.getByRole("radio", { name: "深色", exact: true })).toBeChecked();
  await page.locator("#xca-command-input").fill("echo during-entry");
  await page.locator("#xca-command-input").press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("during-entry");
});

test("brief entry allows repeated navigation before its animations finish", async ({ page }) => {
  await holdBriefEntry(page);
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole("link", { name: "关于学社", exact: true }).click({ timeout: 1500 });
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("html")).not.toHaveAttribute("data-xca-intro");
    await expect(page.locator(".xca-terminal-hero__intro-backdrop")).toHaveCount(0);
    await page.getByRole("link", { name: "首页", exact: true }).click();
    await expect(page.locator("#xca-command-input")).toBeEnabled();
  }
});

test("expansion interrupts brief entry without a late reset", async ({ page }) => {
  await holdBriefEntry(page);
  await page.getByRole("button", { name: "展开终端", exact: true }).click();
  await expect(page.locator(".xca-terminal-window")).toHaveClass(/xca-terminal-window--expanded/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "还原终端大小", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "还原终端大小", exact: true }).click();
  await expect(page.locator(".xca-terminal-window")).not.toHaveClass(
    /xca-terminal-window--expanded/,
  );
  await page.locator("#xca-command-input").fill("echo interrupted-entry");
  await page.locator("#xca-command-input").press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("interrupted-entry");
});

test("saved theme keeps its text and selection background aligned through reload and switching", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("xca-intro-session", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  const themes = page.getByRole("radiogroup", { name: "主题", exact: true });
  for (const name of ["浅色", "深色", "系统"]) {
    await themes.getByRole("radio", { name, exact: true }).click();
    await expect(themes.getByRole("radio", { name, exact: true })).toBeChecked();
    await expect
      .poll(() =>
        themes.evaluate((group) => {
          const selected = group.querySelector<HTMLElement>('[aria-checked="true"]');
          const slider = group.querySelector<HTMLElement>(".ui-segmented-control__slider");
          if (!selected || !slider)
            throw new Error("A selected option and background are required");
          const option = selected.getBoundingClientRect(),
            background = slider.getBoundingClientRect();
          return Math.max(
            Math.abs(option.left - background.left),
            Math.abs(option.width - background.width),
          );
        }),
      )
      .toBeLessThan(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    await expect(themes.getByRole("radio", { name, exact: true })).toBeChecked();
    const state = await themes.evaluate((group) => {
      const selected = group.querySelector<HTMLElement>('[aria-checked="true"]');
      const slider = group.querySelector<HTMLElement>(".ui-segmented-control__slider");
      if (!selected || !slider) throw new Error("A selected option and background are required");
      const option = selected.getBoundingClientRect(),
        background = slider.getBoundingClientRect();
      return {
        active: selected.classList.contains("ui-segmented-control__option--active"),
        difference: Math.max(
          Math.abs(option.left - background.left),
          Math.abs(option.width - background.width),
        ),
      };
    });
    expect(state.active).toBe(true);
    expect(state.difference).toBeLessThan(1);
  }
});

test("the skip hint belongs to the city stage, not the CA drawing @cinematic", async ({ page }) => {
  // Hold the stroke animation so the scene stays in its drawing stage.
  // 暂停描边动画，让场景停留在绘制阶段。
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this instanceof SVGPathElement) animation.pause();
      return animation;
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('.xca-ca-intro[data-journey="draw"]')).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  // The drawing owns no hint: its loading report has left and the city hint is not due yet.
  // 绘制阶段不持有提示条：载入报告已退出，城市场景的提示条尚未到期。
  await expect(page.locator(".xca-ca-intro__loading")).toHaveCount(0);
  await expect(page.locator(".xca-intro-skip-hint")).toHaveCount(0);
});

test("three separate spaces smoothly skip the scene and retain the real terminal @cinematic", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  // The hint owns the city stage; the header button only appears with the boot output.
  // 提示条属于城市场景；标题栏按钮要到启动输出才出现。
  const hint = page.locator(".xca-intro-skip-hint");
  await expect(hint).toContainText("Esc", { timeout: SCENE_TIMEOUT });
  await expect(page.locator(".xca-ca-intro__loading")).toHaveCount(0);
  await page
    .locator(".xca-terminal-window")
    .evaluate((node) => node.setAttribute("data-host", "original"));
  // Hold the skip fade at its midpoint: a slow renderer can drop the whole fade in one frame.
  // 把跳过淡出冻结在中点：慢速渲染器可能一帧就走完整个淡出。
  const faded = await page.evaluate(async () => {
    // Press in one task: once the city stage saturates the main thread, a per-key round trip
    // exceeds the 700 ms shortcut window that a real keyboard fills in a few dozen.
    // 在同一任务内按键：城市场景占满主线程后，逐键往返会超过 700 毫秒的快捷键窗口，
    // 而真实键盘只需几十毫秒就能填满该窗口。
    for (let press = 0; press < 3; press++)
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }),
      );
    // A busy city frame delays the skip cue by about a second and the scene unmounts as soon
    // as the fade ends, so every probe resolves the scene again instead of reusing one node.
    // 繁忙的城市场景帧会把跳过提示推迟约一秒，且淡出结束即卸载场景，
    // 因此每次探测都重新解析场景，而不是复用同一个节点。
    const probe = () => {
      const scene = document.querySelector<HTMLElement>(".xca-ca-intro");
      if (!scene) return null;
      const animations = scene
        .getAnimations()
        .filter((animation) => animation.constructor.name === "Animation");
      return animations.length ? { scene, animations } : null;
    };
    let current = probe();
    const deadline = performance.now() + 4000;
    while (!current && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      current = probe();
    }
    if (!current) return null;
    const { scene, animations } = current;
    const span = Math.max(
      ...animations.map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)),
    );
    for (const animation of animations) animation.pause();
    for (const animation of animations) animation.currentTime = span / 2;
    const opacity = Number(getComputedStyle(scene).opacity);
    for (const animation of animations) animation.play();
    return opacity;
  });
  if (faded === null) throw new Error("The skip fade must animate the scene");
  expect(faded).toBeGreaterThan(0);
  expect(faded).toBeLessThan(1);
  await ready(page);
  await expect(page.locator(".xca-terminal-window")).toHaveAttribute("data-host", "original");
  await expect(page.locator(".xca-ca-intro, .xca-terminal-hero__intro-backdrop")).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(page.locator("#xca-command-input")).toHaveValue("");
  await page.locator("#xca-command-input").fill("echo skipped");
  await page.locator("#xca-command-input").press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("skipped");
  await page.waitForTimeout(800);
  await expect(page.locator(".xca-terminal-bootlog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("slow presses, intervening keys, held space and modified keys do not skip", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.waitForTimeout(750);
  await page.keyboard.press("Space");
  await expect(page.locator(".xca-terminal-screen--reveal")).toHaveCount(0);
  await page.keyboard.press("KeyA");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await page.keyboard.press("Control+Space");
  await page.keyboard.press("Shift+Space");
  await expect(page.locator(".xca-terminal-screen--reveal")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await ready(page);
  await page.locator("#xca-command-input").fill("echo");
  await page.locator("#xca-command-input").press("End");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Space");
  await expect(page.locator("#xca-command-input")).toHaveValue("echo   ");
});

test("refresh reuses the session entry while a new tab plays the intro", async ({
  page,
  context,
}) => {
  await watchScenes(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await ready(page);
  expect(await page.evaluate(() => sessionStorage.getItem("xca-intro-session"))).toBe("1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { entrySeen: { scene: boolean; boot: boolean } }).entrySeen,
    ),
  ).toEqual({ scene: false, boot: false });
  const other = await context.newPage();
  await other.goto("/", { waitUntil: "domcontentloaded" });
  await expect(other.locator(".xca-ca-intro")).toBeVisible();
  await other.keyboard.press("Escape");
  await ready(other);
  await other.close();
});

test("entering on another route consumes the session entry and returning keeps session state", async ({
  page,
}) => {
  await watchScenes(page);
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  // The entry record lands during client startup, after the document is interactive.
  // 入口记录在客户端启动时写入，晚于文档可交互。
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("xca-intro-session")))
    .toBe("1");
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await ready(page);
  const input = page.locator("#xca-command-input");
  await input.fill("echo retained");
  await input.press("Enter");
  await input.fill("draft text");
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await ready(page);
  await expect(input).toHaveValue("draft text");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("retained");
  expect(
    await page.evaluate(
      () => (window as unknown as { entrySeen: { scene: boolean; boot: boolean } }).entrySeen,
    ),
  ).toEqual({ scene: false, boot: false });
});

test("explicit replay still works after refresh and can be skipped repeatedly @cinematic", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await ready(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  for (let replay = 0; replay < 2; replay++) {
    await page.locator("#xca-command-input").fill("xca intro");
    await page.locator("#xca-command-input").press("Enter");
    await expect(page.locator(".xca-ca-intro")).toBeVisible();
    // The replay shortcut listens only after the new scene starts running.
    // 重播快捷键只在新场景开始运行后才监听。
    await expect(page.locator("html")).toHaveAttribute("data-xca-intro", "running");
    for (let press = 0; press < 3; press++) await page.keyboard.press("Space");
    await ready(page);
    await expect(page.locator(".xca-terminal-window")).toHaveCount(1);
  }
});

for (const interruption of ["resize", "motion", "navigation"] as const) {
  test(`a skip interrupted by ${interruption} releases its tasks and overlay`, async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-ca-intro")).toBeVisible();
    for (let press = 0; press < 3; press++) await page.keyboard.press("Space");
    if (interruption === "resize") await page.setViewportSize({ width: 390, height: 844 });
    else if (interruption === "motion") await page.emulateMedia({ reducedMotion: "reduce" });
    else {
      await page.getByRole("link", { name: "关于学社", exact: true }).click();
      await page.getByRole("link", { name: "首页", exact: true }).click();
    }
    await ready(page);
    await expect(page.locator(".xca-ca-intro, .xca-terminal-hero__intro-backdrop")).toHaveCount(0);
  });
}

test("blocked browser storage still allows skipping and client navigation", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await ready(page);
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  // Wait for the route to commit so the second click proves client navigation actually happened.
  // 等路由提交后再点第二次，才能证明确实发生了客户端导航。
  await expect(page).toHaveURL(/\/about/, { timeout: SETTLE_TIMEOUT });
  await page.getByRole("link", { name: "首页", exact: true }).click({ timeout: SETTLE_TIMEOUT });
  await ready(page);
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
});

for (const mode of [
  { width: 1440, height: 900, theme: "dark", locale: "zh-CN" },
  { width: 390, height: 844, theme: "light", locale: "en" },
]) {
  test(`skip docks from the visible projection in ${mode.theme} at ${mode.width}px`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(mode);
    await setThemePreference(page, mode.theme);
    if (!baseURL) throw new Error("The locale cookie needs the test origin");
    await page.context().addCookies([{ name: "xca-locale", value: mode.locale, url: baseURL }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, {
      timeout: SCENE_TIMEOUT,
    });
    // Skip motion is sampled per frame; a software renderer yields only a few samples.
    // 跳过动画按帧采样；软件渲染器只能给出少量样本。
    const sample = await page.evaluate(async () => {
      const terminal = document.querySelector(".xca-terminal-window");
      if (!terminal) throw new Error("A projected terminal is required");
      const before = terminal.getBoundingClientRect();
      for (let press = 0; press < 3; press++)
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
        );
      await new Promise(requestAnimationFrame);
      const first = terminal.getBoundingClientRect();
      const positions: number[] = [];
      while (document.querySelector(".xca-terminal-hero--intro")) {
        positions.push(terminal.getBoundingClientRect().top);
        await new Promise(requestAnimationFrame);
      }
      return {
        firstJump: Math.max(Math.abs(first.top - before.top), Math.abs(first.width - before.width)),
        positions,
        end: terminal.getBoundingClientRect().top,
      };
    });
    expect(sample.firstJump).toBeLessThan(3);
    expect(sample.positions.length).toBeGreaterThan(1);
    await ready(page);
    // The dock target is the anchor; the last sampled frame may lag it on a slow renderer.
    // 停靠目标是锚点；慢速渲染器上最后一次采样可能落后于它。
    const landed = await page.evaluate(() => {
      const terminal = document.querySelector(".xca-terminal-window");
      const anchor = document.querySelector(".xca-terminal-anchor");
      if (!terminal || !anchor) throw new Error("The docked terminal and its anchor are required");
      return Math.abs(terminal.getBoundingClientRect().top - anchor.getBoundingClientRect().top);
    });
    expect(landed).toBeLessThan(1);
    await expect(page.locator(".xca-terminal-window")).toHaveCount(1);
    await expect(page.locator(".xca-terminal-bootlog")).toHaveCount(0);
  });
}

test("skipping the CA drawing keeps the terminal's second screen", async ({ page }) => {
  // Record every printed stage; sampling frames would miss the staged rows.
  // 记录每一次分阶段输出；按帧采样会漏掉逐行打印。
  await page.addInitScript(() => {
    const stages: { rows: number; lines: number; stage: string; prompt: boolean }[] = [];
    Object.assign(window, { xcaWelcomeStages: stages });
    const read = () => {
      const screen = document.querySelector(".xca-terminal-screen");
      const banner = document.querySelector(".xca-terminal-history .xca-terminal-banner");
      const prompt = document.querySelector<HTMLElement>(".xca-terminal-prompt");
      const text = (banner?.textContent ?? "").trim();
      const stage = {
        rows: text ? text.split("\n").length : 0,
        lines: document.querySelectorAll(".xca-terminal-history .xca-terminal-line").length,
        stage:
          [...(screen?.classList ?? [])].find((name) => name.startsWith("xca-terminal-screen--")) ??
          "",
        prompt: prompt ? getComputedStyle(prompt).visibility === "visible" : false,
      };
      const last = stages.at(-1);
      if (
        !last ||
        last.rows !== stage.rows ||
        last.lines !== stage.lines ||
        last.stage !== stage.stage ||
        last.prompt !== stage.prompt
      )
        stages.push(stage);
    };
    const attach = () => {
      if (!document.documentElement) return requestAnimationFrame(attach);
      new MutationObserver(read).observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      read();
    };
    attach();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible({ timeout: SCENE_TIMEOUT });
  await page.keyboard.press("Escape");
  await ready(page);
  const stages = await page.evaluate(
    () =>
      (
        window as unknown as {
          xcaWelcomeStages: { rows: number; lines: number; stage: string; prompt: boolean }[];
        }
      ).xcaWelcomeStages,
  );
  const brand = stages.filter((stage) => stage.stage === "xca-terminal-screen--brand");
  expect(brand.length).toBeGreaterThan(2);
  expect(brand.some((stage) => stage.rows > 0 && stage.lines === 0)).toBe(true);
  expect(brand.some((stage) => stage.lines > 0)).toBe(true);
  // The second screen hides the command line until the welcome text has finished printing.
  // 第二屏在欢迎文字打印完成前隐藏命令行。
  expect(brand.every((stage) => !stage.prompt)).toBe(true);
  const final = stages.at(-1);
  expect(final?.stage).toBe("xca-terminal-screen--ready");
  expect(final?.lines).toBeGreaterThan(0);
  expect(final?.prompt).toBe(true);
});

test("skipping during the boot output never flashes the finished screen", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  // Frame sampling catches a prompt, artwork or idle progress bar that paints before the brand.
  // 逐帧采样可捕获在 brand 之前画出的命令行、字符画或空闲进度条。
  const frames = await page.evaluate(async () => {
    const read = () => {
      const screen = document.querySelector(".xca-terminal-screen");
      const transcript = document.querySelector(".xca-terminal-transcript");
      const prompt = document.querySelector(".xca-terminal-prompt");
      const history = document.querySelector(".xca-terminal-history");
      const stage =
        [...(screen?.classList ?? [])].find((name) => name.startsWith("xca-terminal-screen--")) ??
        "";
      return {
        stage,
        transcript: transcript ? getComputedStyle(transcript).visibility : "",
        prompt: prompt ? getComputedStyle(prompt).visibility : "",
        characters: (history?.textContent ?? "").trim().length,
        bootLines: document.querySelectorAll(".xca-terminal-bootlog__line").length,
        progress: !!document.querySelector(".xca-terminal-boot-progress"),
      };
    };
    const samples = [];
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (let frame = 0; frame < 400; frame++) {
      samples.push(read());
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    return samples;
  });
  const brandStart = frames.findIndex((frame) => frame.stage === "xca-terminal-screen--brand");
  expect(brandStart).toBeGreaterThan(0);
  const docking = frames.slice(0, brandStart);
  expect(docking.every((frame) => frame.transcript === "hidden")).toBe(true);
  expect(docking.every((frame) => frame.prompt === "hidden")).toBe(true);
  expect(docking.every((frame) => frame.characters === 0)).toBe(true);
  // An idle bar belongs to no screen; the boot stage or a printed line must justify it.
  // 空闲进度条不属于任何屏幕，只有 boot 阶段或已打印日志时才显示。
  expect(
    frames.every(
      (frame) => !frame.progress || frame.bootLines > 0 || frame.stage.endsWith("--boot"),
    ),
  ).toBe(true);
});

test("a touch screen taps the skip hint to leave the CA stage", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("The touch context needs the test origin");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-intro-skip-hint__tap")).toBeVisible({ timeout: SCENE_TIMEOUT });
  await expect(page.locator(".xca-intro-skip-hint__keys")).toBeHidden();
  await page.locator(".xca-intro-skip-hint__tap").tap();
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT,
  });
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  await context.close();
});
