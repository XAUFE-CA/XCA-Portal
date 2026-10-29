import { expect, type Page, test } from "@playwright/test";

async function ready(page: Page) {
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-xca-intro");
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

test("brief entry moves the title and terminal while preferences stay stationary", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("xca-intro-seen", "1");
    localStorage.setItem("xca-theme", "light");
    const tracks: { target: string; transforms: string[]; delay: number; duration: number }[] = [];
    const preferenceTransitions: string[] = [];
    Object.assign(window, { entryTracks: tracks, preferenceTransitions });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (
        this.matches(
          ".xca-terminal-window, .xca-terminal-hero__heading, .site-header-wrap, .site-controls",
        )
      ) {
        const effect = animation.effect;
        if (effect instanceof KeyframeEffect)
          tracks.push({
            target: this.className,
            transforms: effect.getKeyframes().map((frame) => String(frame.transform)),
            delay: effect.getTiming().delay ?? 0,
            duration: Number(effect.getTiming().duration),
          });
      }
      return animation;
    };
    document.addEventListener(
      "transitionrun",
      (event) => {
        if (
          event instanceof TransitionEvent &&
          event.target instanceof Element &&
          event.target.closest(".site-controls") &&
          event.propertyName === "transform"
        )
          preferenceTransitions.push(event.propertyName);
      },
      true,
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  const { tracks, transitions } = await page.evaluate(() => {
    const state = window as unknown as {
      entryTracks: { target: string; transforms: string[]; delay: number; duration: number }[];
      preferenceTransitions: string[];
    };
    return { tracks: state.entryTracks, transitions: state.preferenceTransitions };
  });
  const terminal = tracks.find((track) => track.target.includes("xca-terminal-window"));
  const heading = tracks.find((track) => track.target.includes("xca-terminal-hero__heading"));
  expect(terminal?.transforms[0]).toContain("scale(0.98)");
  expect(terminal?.transforms.at(-1)).toBe("translateZ(0px)");
  expect(heading?.transforms[0]).toContain("translate3d");
  expect(terminal?.delay).toBeGreaterThan(heading?.delay ?? 0);
  expect(terminal?.duration).toBeLessThan(1000);
  expect(
    tracks.some(
      (track) =>
        track.target.includes("site-header-wrap") || track.target.includes("site-controls"),
    ),
  ).toBe(false);
  expect(transitions).toEqual([]);
  await expect(page.locator(".site-header-wrap")).toHaveCSS("transform", "none");
  await expect(page.getByRole("radio", { name: "浅色", exact: true })).toBeChecked();
});

test("saved theme keeps its text and selection background aligned through reload and switching", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("xca-intro-seen", "1"));
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
  const opacities = await page.evaluate(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }),
    );
    const scene = document.querySelector(".xca-ca-intro");
    const values: number[] = [];
    while (scene?.isConnected) {
      values.push(Number(getComputedStyle(scene).opacity));
      await new Promise(requestAnimationFrame);
    }
    return values;
  });
  expect(opacities.some((value) => value > 0 && value < 1)).toBe(true);
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

test("refresh and a new tab use a short entry without ever mounting the long scene", async ({
  page,
  context,
}) => {
  await watchScenes(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await ready(page);
  expect(await page.evaluate(() => localStorage.getItem("xca-intro-seen"))).toBe("1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { entrySeen: { scene: boolean; boot: boolean } }).entrySeen,
    ),
  ).toEqual({ scene: false, boot: false });
  const other = await context.newPage();
  await watchScenes(other);
  await other.goto("/", { waitUntil: "domcontentloaded" });
  await ready(other);
  expect(
    await other.evaluate(
      () => (window as unknown as { entrySeen: { scene: boolean; boot: boolean } }).entrySeen,
    ),
  ).toEqual({ scene: false, boot: false });
  await other.close();
});

test("visiting another route first preserves the first home intro and returning keeps session state", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => localStorage.getItem("xca-intro-seen"))).toBeNull();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.locator(".xca-ca-intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await ready(page);
  const input = page.locator("#xca-command-input");
  await input.fill("echo retained");
  await input.press("Enter");
  await input.fill("draft text");
  await page.getByRole("link", { name: "关于学社", exact: true }).click();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await ready(page);
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  await expect(input).toHaveValue("draft text");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("retained");
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
    await page.addInitScript((theme) => localStorage.setItem("xca-theme", theme), mode.theme);
    if (!baseURL) throw new Error("The locale cookie needs the test origin");
    await page.context().addCookies([{ name: "xca-locale", value: mode.locale, url: baseURL }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, { timeout: 15000 });
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
    expect(sample.positions.length).toBeGreaterThan(3);
    expect(Math.abs((sample.positions.at(-1) ?? sample.end) - sample.end)).toBeLessThan(1);
    await ready(page);
    await expect(page.locator(".xca-terminal-window")).toHaveCount(1);
    await expect(page.locator(".xca-terminal-bootlog")).toHaveCount(0);
  });
}
