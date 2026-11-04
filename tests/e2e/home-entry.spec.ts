import { expect, type Page, test } from "@playwright/test";
import { setThemePreference } from "./preferences";
import { SETTLE_TIMEOUT } from "./timing";

async function ready(page: Page) {
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-xca-intro");
  // An inert host silently drops keys after skipping; toBeEnabled does not check inert.
  // 跳过后仍为 inert 的宿主会静默丢弃按键；toBeEnabled 不检查 inert。
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

test("three separate spaces smoothly skip the scene and retain the real terminal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page
    .locator(".xca-terminal-window")
    .evaluate((node) => node.setAttribute("data-host", "original"));
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(page.locator(".xca-terminal-screen--reveal")).toHaveCount(0);
  // Hold the skip fade at its midpoint: a slow renderer can drop the whole fade in one frame.
  // 把跳过淡出冻结在中点：慢速渲染器可能一帧就走完整个淡出。
  const faded = await page.evaluate(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }),
    );
    const scene = document.querySelector(".xca-ca-intro");
    if (!scene) return null;
    const own = () =>
      scene.getAnimations().filter((animation) => animation.constructor.name === "Animation");
    let animations = own();
    if (!animations.length) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      animations = own();
    }
    if (!animations.length) return null;
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

test("explicit replay still works after refresh and can be skipped repeatedly", async ({
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
  await page.getByRole("link", { name: "首页", exact: true }).click();
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
    await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, { timeout: 15000 });
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
