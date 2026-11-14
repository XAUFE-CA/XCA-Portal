import { expect, type Page, test } from "@playwright/test";
import zh from "../../../app/i18n/locales/zh-CN.json" with { type: "json" };
import { setThemePreference } from "../support/preferences";

/**
 * Record every theme capture together with the snapshot scope it chose.
 * 记录每次主题截取以及它选用的快照范围。
 */
function recordThemeTransitions(page: Page) {
  return page.addInitScript(() => {
    const native = document.startViewTransition.bind(document);
    const observations: {
      duration: string;
      opacity: number[];
      finished: boolean;
      rootName: string;
      contentName: string;
      clip: string;
    }[] = [];
    Object.assign(window, { themeTransitions: observations });
    document.startViewTransition = (update) => {
      const transition = native(update);
      const record = {
        duration: "",
        opacity: [] as number[],
        finished: false,
        rootName: "",
        contentName: "",
        clip: "",
      };
      observations.push(record);
      void transition.ready.then(
        () => {
          record.duration = getComputedStyle(
            document.documentElement,
            "::view-transition-new(root)",
          ).animationDuration;
          // A theme change alters the canvas and the chrome too, so the document itself has to
          // be the snapshot instead of the page body alone.
          // 主题切换同时改写画布与页头，因此快照必须是整个文档而不是单独正文。
          record.rootName = getComputedStyle(document.documentElement).viewTransitionName;
          const content = document.querySelector(".site-main");
          record.contentName = content ? getComputedStyle(content).viewTransitionName : "";
          record.clip = getComputedStyle(document.documentElement, "::view-transition").clipPath;
          const sample = () => {
            if (record.finished) return;
            record.opacity.push(
              Number(
                getComputedStyle(document.documentElement, "::view-transition-new(root)").opacity,
              ),
            );
            requestAnimationFrame(sample);
          };
          sample();
        },
        () => undefined,
      );
      void transition.finished.then(
        () => {
          record.finished = true;
        },
        () => {
          record.finished = true;
        },
      );
      return transition;
    };
  });
}

/** How many theme captures the page has started since it loaded. */
function transitionCount(page: Page) {
  return page.evaluate(
    () => (window as unknown as { themeTransitions: unknown[] }).themeTransitions.length,
  );
}

/** The most recent capture, recorded by the init script on the page's window. */
async function latestTransition(page: Page) {
  const latest = await page.evaluate(() => {
    const observedWindow = window as unknown as {
      themeTransitions: {
        duration: string;
        opacity: number[];
        rootName: string;
        contentName: string;
        clip: string;
      }[];
    };
    return observedWindow.themeTransitions.at(-1) ?? null;
  });
  if (latest === null) throw new Error("Theme transition observation is missing");
  return latest;
}

async function openLightPage(page: Page, path = "/") {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setThemePreference(page, "light");
  await recordThemeTransitions(page);
  await page.goto(path);
  await expect(page.locator(".site-theme-control .ui-segmented-control__slider")).toHaveAttribute(
    "data-ready",
    "true",
  );
  if (path === "/") {
    await page.keyboard.press("Escape");
    await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  }
  await expect(page.getByRole("radio", { name: "浅色", exact: true })).toBeChecked();
}

async function settled(page: Page, theme: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-theme-view-transitioning");
  await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-theme-transitioning");
  expect(
    (await page.context().cookies()).find((cookie) => cookie.name === "xca-theme")?.value,
  ).toBe(theme);
}

test("header theme changes crossfade the whole page using shared motion", async ({ page }) => {
  await openLightPage(page);
  expect(await transitionCount(page)).toBe(0);
  for (const [label, theme] of [
    ["深色", "dark"],
    ["浅色", "light"],
  ] as const) {
    await page.getByRole("radio", { name: label, exact: true }).click();
    await settled(page, theme);
    const transition = await latestTransition(page);
    expect(parseFloat(transition.duration)).toBeGreaterThan(0);
    expect(transition.opacity.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
    // Capturing the document is what makes the canvas, the header and the footer fade with the
    // page instead of hard-cutting around the captured body.
    // 以整个文档作为快照，画布、页头与页脚才会与正文一同淡化，而不是在正文之外硬切。
    expect(transition.rootName).toBe("root");
    expect(transition.contentName).toBe("none");
    expect(transition.clip).toBe("none");
  }
});

test("theme chosen from the context menu crossfades after its panel closes", async ({ page }) => {
  await openLightPage(page);
  await page.locator(".xca-terminal-hero__heading").click({ button: "right" });
  const panel = page.locator(".ui-context-menu:visible");
  await expect(panel).toBeVisible();
  await panel.getByRole("menuitem", { name: "切换主题" }).click();
  const submenu = page.locator(".ui-context-menu__submenu");
  await expect(submenu).toBeVisible();
  await submenu.getByRole("menuitemradio", { name: "深色" }).click();
  await settled(page, "dark");
  // The row closes its own panel before the palette changes, so the capture no longer has to
  // skip the top layer: the page crossfades exactly like a header switch.
  // 该行先关闭自身面板再更换配色，截取因此不必跳过顶层，页面与页头切换一样淡化。
  expect(await transitionCount(page)).toBe(1);
  const transition = await latestTransition(page);
  expect(parseFloat(transition.duration)).toBeGreaterThan(0);
  expect(transition.opacity.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  expect(transition.rootName).toBe("root");
});

test("rapid switches settle on the latest choice and preserve terminal input", async ({ page }) => {
  await openLightPage(page, "/");
  const input = page.locator("#xca-command-input");
  await input.fill("echo keep this draft");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    for (const label of ["深色", "浅色", "深色"]) {
      const control = [
        ...document.querySelectorAll<HTMLElement>(".site-theme-control [role=radio]"),
      ].find((el) => el.textContent?.trim() === label);
      if (!control) throw new Error(`Theme control is missing: ${label}`);
      control.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
  });
  await settled(page, "dark");
  await expect(page.getByRole("radio", { name: "深色", exact: true })).toBeChecked();
  await expect(input).toHaveValue("echo keep this draft");
  await input.fill("xca theme light");
  await input.press("Enter");
  await settled(page, "light");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText(
    zh["command.themeChanged"].replace("{theme}", zh["theme.light"]),
  );
  expect(errors).toEqual([]);
});

test("reduced motion switches immediately without a view transition", async ({ page }) => {
  await openLightPage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await settled(page, "dark");
  expect(await transitionCount(page)).toBe(0);
});

test("without View Transitions the shared semantic colors interpolate", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "startViewTransition", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setThemePreference(page, "light");
  await page.goto("/");
  await expect(page.locator(".site-theme-control .ui-segmented-control__slider")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "浅色", exact: true })).toBeChecked();
  // Step the shared color transitions by time instead of sampling frames: a software-rendered
  // runner delivers too few frames to observe the interpolation window. The transition runs on
  // the semantic tokens, so measure the token the page canvas resolves.
  // 按时间推进共享颜色过渡，而不是逐帧采样：软件渲染运行器给出的帧不足以观察插值窗口。
  // 过渡发生在语义 token 上，因此测量页面画布所使用的那个 token。
  const colors = await page.evaluate(async () => {
    const canvas = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--neoverse-color-surface-canvas")
        .trim();
    const result = [canvas()];
    const dark = [
      ...document.querySelectorAll<HTMLElement>(".site-theme-control [role=radio]"),
    ].find((el) => el.textContent?.trim() === "深色");
    if (!dark) throw new Error("Dark theme control is missing");
    dark.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // Only token transitions take part in the stepping: ambient animations such as the
    // shared caret breathe would otherwise stretch the span past the colour window.
    // 只有 token 过渡参与步进：否则共享光标呼吸等环境动画会把采样式跨度拉长到颜色窗口之外。
    const animations = document
      .getAnimations()
      .filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
    if (!animations.length) throw new Error("The theme change must animate its colors");
    const span = Math.max(
      ...animations.map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0)),
    );
    if (!(span > 0)) throw new Error("Theme color transitions need a finite duration");
    for (const animation of animations) animation.pause();
    for (const share of [0.2, 0.4, 0.6, 0.8, 1]) {
      for (const animation of animations) animation.currentTime = span * share;
      result.push(canvas());
    }
    for (const animation of animations) animation.play();
    return result;
  });
  expect(colors.at(-1)).not.toBe(colors[0]);
  expect(new Set(colors).size).toBeGreaterThan(3);
  await settled(page, "dark");
});

test("system mode resolves correctly and restoration does not animate", async ({ page }) => {
  await openLightPage(page);
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await settled(page, "dark");
  await page.getByRole("radio", { name: "系统", exact: true }).click();
  await settled(page, "system");
  const background = await page
    .locator(".site-shell")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  expect(await transitionCount(page)).toBe(0);
  expect(
    await page.locator(".site-shell").evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(background);
});
