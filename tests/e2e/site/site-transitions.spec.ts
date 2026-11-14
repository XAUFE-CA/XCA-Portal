import { expect, type Page, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";
import { setThemePreference } from "../support/preferences";

/**
 * Record every View Transition the document starts, including the shared timing that
 * the portal applies to it.
 * 记录文档发起的每次视图过渡，以及门户为它套用的共享节奏。
 */
function recordViewTransitions(page: Page) {
  return page.addInitScript(() => {
    const native = document.startViewTransition?.bind(document);
    const observations: {
      duration: string;
      shared: boolean;
      groupAnimations: number;
      animationDuration: number;
      headerLive: boolean;
      documentCaptured: boolean;
      captured: boolean;
      glassPaused: boolean;
      headerBackdrop: string;
      headerBackground: string;
    }[] = [];
    Object.assign(window, { transitions: observations });
    if (!native) return;
    document.startViewTransition = (update) => {
      const transition = native(update);
      const record = {
        duration: "",
        shared: false,
        groupAnimations: 0,
        animationDuration: 0,
        headerLive: false,
        documentCaptured: false,
        captured: false,
        glassPaused: false,
        headerBackdrop: "",
        headerBackground: "",
      };
      observations.push(record);
      void transition.ready.then(
        () => {
          const root = document.documentElement;
          record.duration = getComputedStyle(root, "::view-transition-new(root)").animationDuration;
          record.shared = root.hasAttribute("data-neoverse-view-transitioning");
          const header = document.querySelector(".site-header-wrap");
          const content = document.querySelector(".site-main");
          record.headerLive =
            !!header &&
            !!content &&
            getComputedStyle(root).viewTransitionName === "none" &&
            getComputedStyle(header).viewTransitionName === "none" &&
            getComputedStyle(content).viewTransitionName === "root" &&
            getComputedStyle(root, "::view-transition").clipPath !== "none";
          // A theme change repaints the canvas and the chrome, so the document is the snapshot
          // instead of the page body; the overlay is no longer clipped below the header.
          // 主题切换会同时改写画布与页头，因此快照是整个文档而不是正文，快照层也不再裁剪到页头下方。
          record.documentCaptured =
            getComputedStyle(root).viewTransitionName === "root" &&
            !!content &&
            getComputedStyle(content).viewTransitionName === "none" &&
            getComputedStyle(root, "::view-transition").clipPath === "none";
          // The root group carries the crossfade; its animation proves the page blends.
          // 根分组承载交叉淡化，该动画证明页面确实在混合。
          const groups = document.getAnimations().filter((animation) => {
            const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
            return typeof pseudo === "string" && pseudo.startsWith("::view-transition");
          });
          record.groupAnimations = groups.length;
          record.animationDuration = Math.max(
            0,
            ...groups.map((animation) =>
              Number(animation.effect?.getComputedTiming().duration ?? 0),
            ),
          );
          record.glassPaused = root.hasAttribute("data-xca-route-glass-pause");
          const surface = document.querySelector(".site-header");
          record.headerBackdrop = surface ? getComputedStyle(surface).backdropFilter : "";
          record.headerBackground = surface ? getComputedStyle(surface).backgroundColor : "";
          record.captured = true;
        },
        () => {
          record.captured = true;
        },
      );
      return transition;
    };
  });
}

async function latestTransition(page: Page) {
  // The record fills once the snapshots exist; a caller that reads on the language change
  // alone would sample an empty duration on a slow renderer.
  // 记录在快照就绪后才填充；仅在语言变更后读取会在慢速渲染器上拿到空时长。
  await page.waitForFunction(() => {
    const observed = window as unknown as { transitions: { captured: boolean }[] };
    return observed.transitions.at(-1)?.captured === true;
  });
  return page.evaluate(() => {
    const observed = window as unknown as {
      transitions: {
        duration: string;
        shared: boolean;
        groupAnimations: number;
        animationDuration: number;
        headerLive: boolean;
        documentCaptured: boolean;
        glassPaused: boolean;
        headerBackdrop: string;
        headerBackground: string;
      }[];
    };
    const latest = observed.transitions.at(-1);
    if (!latest) throw new Error("The page did not start a View Transition");
    return latest;
  });
}

async function skipIntro(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await setThemePreference(page, "light");
});

test("switching the language swaps the copy in place and keeps every material sampling", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/");
  await skipIntro(page);
  const materials = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".site-main .material-glass-elevated")].map((element) => {
        const style = getComputedStyle(element);
        return [style.backdropFilter, style.backgroundColor, style.borderColor].join("|");
      }),
    );
  const before = await materials();
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((material) => material.includes("blur"))).toBe(true);

  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  // The copy swaps immediately: no capture and no crossfade, so nothing can flash.
  // 文案立即替换：既没有快照也没有交叉淡化，不会产生闪烁。
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    await page.evaluate(() => (window as unknown as { transitions: unknown[] }).transitions.length),
  ).toBe(0);
  expect(await materials()).toEqual(before);
});

test("navigating between the pages crossfades instead of swapping the content", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.waitForTimeout(500);

  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  const transition = await latestTransition(page);
  expect(parseFloat(transition.duration)).toBeGreaterThan(0);
  expect(transition.shared).toBe(true);
  expect(transition.groupAnimations).toBeGreaterThan(0);
  expect(transition.animationDuration).toBeGreaterThan(0);
  expect(transition.headerLive).toBe(true);
  // Ordinary routes keep sampling the live header; only an in-flight header resize pauses it.
  // 普通路由保持实时页头采样；只有进行中的页头尺寸动画才会暂停。
  expect(transition.glassPaused).toBe(false);
  expect(transition.headerBackdrop).toContain("blur");
});

/**
 * Hold the first route capture just after its snapshots are created, before any fade is
 * visible, and record the source and target boxes for geometry assertions.
 * 在快照创建后、淡出开始前暂停首个路由截取，并记录来源与目标盒模型供几何断言使用。
 */
async function pauseRouteCapture(page: Page) {
  await page.evaluate(() => {
    const observations = { paused: false, targetTop: 0, sourceTop: 0, sourceHeight: 0 };
    Object.assign(window, { routeSnapshots: observations });
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      // The capture box is read at the same moment the portal records it.
      // 在与门户记录相同的一刻读取截取盒模型。
      const source = document.querySelector(".site-main");
      if (source) {
        const rect = source.getBoundingClientRect();
        observations.sourceTop = rect.top;
        observations.sourceHeight = rect.height;
      }
      const transition = native(update);
      void transition.ready.then(
        () => {
          const target = document.querySelector(".site-main");
          if (target) observations.targetTop = target.getBoundingClientRect().top;
          for (const animation of document.getAnimations()) {
            const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
            if (!pseudo?.startsWith("::view-transition")) continue;
            animation.pause();
            animation.currentTime = 220;
          }
          observations.paused = true;
        },
        () => undefined,
      );
      return transition;
    };
  });
}

async function recordGlassPauseWindows(page: Page) {
  await page.addInitScript(() => {
    const events: { at: number; paused: boolean; path: string }[] = [];
    Object.assign(window, { glassPauses: events });
    new MutationObserver(() => {
      events.push({
        at: performance.now(),
        paused: document.documentElement.hasAttribute("data-xca-route-glass-pause"),
        path: location.pathname,
      });
    }).observe(document, {
      attributes: true,
      attributeFilter: ["data-xca-route-glass-pause"],
      subtree: true,
    });
  });
}

/**
 * Keep the header's width animations alive for the whole route so the sampling pause is
 * deterministic on slow renderers instead of depending on the 420ms spatial window.
 * 让页头宽度动画在整个路由期间保持运行，使采样暂停在慢速运行器上也可确定，
 * 而不是依赖 420ms 的空间动画窗口。
 */
async function stretchHeaderWidthAnimations(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (
        this.closest(".site-header") &&
        Array.isArray(keyframes) &&
        keyframes.some((frame) => "width" in frame)
      ) {
        const settings = typeof options === "object" && options !== null ? options : {};
        return animate.call(this, keyframes, { ...settings, duration: 10_000 });
      }
      return animate.call(this, keyframes, options);
    };
  });
}

test("a header width animation pauses glass sampling only for the route capture", async ({
  page,
}) => {
  await stretchHeaderWidthAnimations(page);
  await recordViewTransitions(page);
  await recordGlassPauseWindows(page);
  await page.goto("/about");
  await expect(page.locator(".about-card")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  // Start the resize and leave in the same turn, as a reader does after a language tap.
  // 启动尺寸过渡后立刻离开，对应读者点击语言后的快速导航。
  await page.evaluate(() => {
    const radios = [
      ...document.querySelectorAll(
        '.site-controls [role="radiogroup"]:first-of-type [role="radio"]',
      ),
    ];
    (
      radios.find((radio) => radio.textContent?.trim() === "English") as HTMLElement | undefined
    )?.click();
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (document.querySelector(".site-header__brand")?.getAnimations() ?? []).some(
          (animation) =>
            (animation.effect as KeyframeEffect | null)
              ?.getKeyframes()
              .some((frame) => "width" in frame) ?? false,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (document.querySelector('.site-navigation a[href="/"]') as HTMLElement | null)?.click(),
  );
  await expect(page).toHaveURL(/\/$/);

  const transition = await latestTransition(page);
  expect(transition.headerLive).toBe(true);
  expect(transition.glassPaused).toBe(true);
  expect(transition.headerBackdrop).toBe("none");
  // The paused plane stays opaque instead of letting the page text show through.
  // 暂停期间底面保持不透明，页面文字不会透出。
  expect(transition.headerBackground).not.toMatch(/\/\s*0?\.\d+\)/);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.hasAttribute("data-xca-route-glass-pause")),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document.querySelector(".site-header");
        return header ? getComputedStyle(header).backdropFilter : "";
      }),
    )
    .toContain("blur");
  // Only the incoming snapshot pauses; the outgoing capture and the navigation load keep
  // sampling the live glass, so the header never turns into a long-lived opaque bar.
  // 只有进入快照暂停；退出快照与导航加载保持实时采样，页头不会长时间变成不透明条。
  const pauses = await page.evaluate(() => {
    const events = (window as unknown as { glassPauses: { paused: boolean; path: string }[] })
      .glassPauses;
    return events.filter((event) => event.paused).map((event) => event.path);
  });
  expect(pauses.length).toBeGreaterThanOrEqual(1);
  expect(pauses.every((path) => path === "/")).toBe(true);
});

test("a scrolled source page keeps both route snapshots at their own viewport tops", async ({
  page,
}) => {
  await page.goto("/about");
  await expect(page.locator(".about-card")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  await pauseRouteCapture(page);
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observed = window as unknown as { routeSnapshots: { paused: boolean } };
        return observed.routeSnapshots.paused;
      }),
    )
    .toBe(true);

  const snapshots = await page.evaluate(() => {
    const root = document.documentElement;
    const observed = window as unknown as {
      routeSnapshots: { targetTop: number; sourceTop: number; sourceHeight: number };
    };
    const style = (pseudo: string) => getComputedStyle(root, pseudo);
    const translate = (value: string) => (value === "none" ? 0 : new DOMMatrixReadOnly(value).m42);
    const group = style("::view-transition-group(root)");
    const oldSnapshot = style("::view-transition-old(root)");
    const newSnapshot = style("::view-transition-new(root)");
    return {
      groupTop: translate(group.transform),
      groupHeight: Number.parseFloat(group.height),
      oldTop: translate(oldSnapshot.transform),
      oldHeight: Number.parseFloat(oldSnapshot.height),
      newOffset: translate(newSnapshot.transform),
      targetTop: observed.routeSnapshots.targetTop,
      sourceTop: observed.routeSnapshots.sourceTop,
      sourceHeight: observed.routeSnapshots.sourceHeight,
    };
  });

  // The group stays on the source page's capture box instead of sliding to the new one.
  // 分组停留在来源页的截取盒模型上，不再滑向新页。
  expect(snapshots.sourceTop).toBeLessThan(-400);
  expect(snapshots.groupTop).toBeCloseTo(snapshots.sourceTop, 0);
  expect(snapshots.groupHeight).toBeCloseTo(snapshots.sourceHeight, 0);
  expect(snapshots.oldTop).toBeCloseTo(0, 0);
  expect(snapshots.oldHeight).toBeCloseTo(snapshots.sourceHeight, 0);
  // The footer extends the home document, so scroll position and header shape settle across
  // frames after the capture; compare the final geometry rather than one early sample.
  // 首页页脚加长了文档，截取后滚动位置与页头形态会跨帧落定；比较最终几何而不是早期单帧。
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        const translate = (value: string) =>
          value === "none" ? 0 : new DOMMatrixReadOnly(value).m42;
        const groupTop = translate(
          getComputedStyle(root, "::view-transition-group(root)").transform,
        );
        const newOffset = translate(
          getComputedStyle(root, "::view-transition-new(root)").transform,
        );
        const target = document.querySelector(".site-main");
        return Math.abs(groupTop + newOffset - (target?.getBoundingClientRect().top ?? 0));
      }),
    )
    .toBeLessThanOrEqual(1);

  const end = await page.evaluate(() => {
    const root = document.documentElement;
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      if (
        !(effect instanceof KeyframeEffect) ||
        !effect.pseudoElement?.startsWith("::view-transition")
      )
        continue;
      animation.pause();
      animation.currentTime = Number(effect.getComputedTiming().duration);
    }
    return {
      oldOpacity: Number.parseFloat(getComputedStyle(root, "::view-transition-old(root)").opacity),
      newOpacity: Number.parseFloat(getComputedStyle(root, "::view-transition-new(root)").opacity),
    };
  });
  // The outgoing snapshot must not return to full opacity in its final frame.
  // 旧快照不得在结束帧恢复为完全不透明。
  expect(end.oldOpacity).toBe(0);
  expect(end.newOpacity).toBe(1);
});

test("reduced motion switches the language without a View Transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.waitForTimeout(500);

  await page
    .getByRole("radiogroup", { name: "语言" })
    .getByRole("radio", { name: "English" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const started = await page.evaluate(
    () => (window as unknown as { transitions: unknown[] }).transitions.length,
  );
  expect(started).toBe(0);
});

for (const choice of [
  {
    name: "language",
    selector: ".site-preference-group:first-child .ui-segmented-control__slider",
    label: "English",
  },
  { name: "theme", selector: ".site-theme-control .ui-segmented-control__slider", label: "深色" },
  {
    name: "navigation",
    selector: ".site-navigation .ui-control-surface__indicator",
    label: "首页",
  },
] as const) {
  test(`${choice.name} selection moves continuously while the page updates`, async ({ page }) => {
    await recordViewTransitions(page);
    await page.goto("/about");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(choice.selector)).toHaveAttribute("data-ready", "true");
    let previousLabel: string | undefined;
    for (const label of choice.name === "navigation" ? ["首页", "关于学社"] : [choice.label]) {
      if (previousLabel !== undefined && choice.name === "navigation") {
        // Rapid reversals commit without a snapshot; let the reversal window expire first.
        // 快速反向导航直接提交、不截取快照；先让反向窗口过期。
        await page.waitForTimeout(1100);
      }
      previousLabel = label;
      const result = await sampleSelectionMotion(page, { selector: choice.selector, label });
      expect(result.end).not.toBeCloseTo(result.start, 0);
      expect(result.middle).toBeGreaterThan(Math.min(result.start, result.end));
      expect(result.middle).toBeLessThan(Math.max(result.start, result.end));
      if (choice.name === "language") {
        // A capture would strip the shared glass rim for the whole fade, so the language change
        // commits in place and starts none; the selection still travels on its own animation.
        // 快照会让共享玻璃边缘在整段淡化中消失，因此语言切换就地提交、不启动快照；
        // 选中背景仍按自身动画移动。
        expect(
          await page.evaluate(
            () => (window as unknown as { transitions: unknown[] }).transitions.length,
          ),
        ).toBe(0);
      } else {
        // Theme changes capture the document so the chrome fades with the canvas; routes keep
        // the header live and capture only the page body.
        // 主题切换以整个文档为快照，页头与画布一同淡化；路由保留实时页头，只截取正文。
        await expect
          .poll(async () =>
            choice.name === "theme"
              ? (await latestTransition(page)).documentCaptured
              : (await latestTransition(page)).headerLive,
          )
          .toBe(true);
      }
      await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
    }
  });
}

test("language changes resize the brand shell without rebounding and keep the navigation centred", async ({
  page,
}) => {
  await recordViewTransitions(page);
  await page.goto("/about");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const observed = window as unknown as { headerWidths: Animation[] };
    observed.headerWidths = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (
        this.closest(".site-header") &&
        Array.isArray(keyframes) &&
        keyframes.some((frame) => "width" in frame)
      ) {
        animation.pause();
        animation.currentTime = 0;
        observed.headerWidths.push(animation);
      }
      return animation;
    };
  });
  const shell = page.locator(".site-header__brand");
  for (const label of ["English", "中文"]) {
    const before = await shell.boundingBox();
    if (!before) throw new Error("The brand shell is required");
    await page.getByRole("radio", { name: label, exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const observed = window as unknown as { headerWidths: Animation[] };
          return observed.headerWidths.length;
        }),
      )
      .toBeGreaterThan(0);
    const samples = await page.evaluate(async () => {
      const observed = window as unknown as { headerWidths: Animation[] };
      const brand = () => {
        const element = document.querySelector(".site-header__brand");
        if (!element) throw new Error("The brand shell is required");
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      };
      const navigationCentre = () => {
        const element = document.querySelector(".site-navigation > [data-surface]");
        if (!element) throw new Error("The navigation shell is required");
        const rect = element.getBoundingClientRect();
        return rect.x + rect.width / 2;
      };
      const positions = [0, 0.1, 0.25, 0.5, 0.75, 1].map((progress) => {
        for (const animation of observed.headerWidths) {
          animation.currentTime = Number(animation.effect?.getComputedTiming().duration) * progress;
        }
        return { ...brand(), centre: navigationCentre() };
      });
      const finished = observed.headerWidths.map((animation) => animation.finished);
      for (const animation of observed.headerWidths) animation.finish();
      await Promise.all(finished);
      observed.headerWidths = [];
      const header = document.querySelector(".site-header");
      if (!header) throw new Error("The header is required to read its midline");
      const bar = header.getBoundingClientRect();
      return { positions, after: brand(), barCentre: bar.x + bar.width / 2 };
    });
    const first = samples.positions[0];
    const last = samples.positions.at(-1);
    if (!first || !last) throw new Error("The complete geometry trajectory is required");
    expect(first.x).toBeCloseTo(before.x, 0);
    expect(first.width).toBeCloseTo(before.width, 0);
    expect(last.x).toBeCloseTo(samples.after.x, 0);
    expect(last.width).toBeCloseTo(samples.after.width, 0);
    // The brand shell only travels towards the other language's width, and the navigation keeps
    // its place on the bar's midline for the whole resize instead of being pushed sideways.
    // 标识外壳只朝另一语言的宽度单向变化，导航在整段伸缩中停在顶栏中线上，不被推向一侧。
    expect(Math.abs(last.width - first.width)).toBeGreaterThan(1);
    const direction = Math.sign(last.width - first.width);
    for (const index of samples.positions.keys()) {
      const current = samples.positions[index];
      const previous = samples.positions[index - 1];
      if (!current) throw new Error("A sampled position is required");
      expect(current.centre).toBeCloseTo(first.centre, 0);
      if (!previous) continue;
      expect((current.width - previous.width) * direction).toBeGreaterThanOrEqual(-0.1);
      expect(current.width).toBeGreaterThanOrEqual(Math.min(first.width, last.width) - 0.1);
      expect(current.width).toBeLessThanOrEqual(Math.max(first.width, last.width) + 0.1);
    }
    expect(last.centre).toBeCloseTo(samples.barCentre, 0);
    await expect(page.locator("html")).not.toHaveAttribute("data-neoverse-view-transitioning");
  }
});

async function sampleSelectionMotion(page: Page, choice: { selector: string; label: string }) {
  return page.evaluate(async ({ selector, label }) => {
    const indicator = document.querySelector<HTMLElement>(selector);
    const option = [
      ...document.querySelectorAll<HTMLElement>(".site-header a, .site-header [role=radio]"),
    ].find((element) => element.textContent?.trim() === label);
    if (!indicator || !option) throw new Error("The selection indicator and option are required");
    const position = () =>
      Number.parseFloat(getComputedStyle(indicator).left) ||
      new DOMMatrixReadOnly(getComputedStyle(indicator).transform).m41;
    const before = position();
    option.click();
    const deadline = performance.now() + 5000;
    let motion: Animation[] = [];
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      // The language fade also runs a text-fill transition on the indicator; only animations that
      // move its geometry describe the selection travelling.
      // 语言淡化同时会在选中背景上跑一条文字填充色过渡；只有改变其几何的动画才表示选中在移动。
      motion = indicator.getAnimations().filter((animation) => {
        const effect = animation.effect;
        return (
          effect instanceof KeyframeEffect &&
          effect
            .getKeyframes()
            .some((frame) => "left" in frame || "transform" in frame || "width" in frame)
        );
      });
      if (motion.length > 0) break;
    }
    if (motion.length === 0) throw new Error("Selection must travel instead of swapping endpoints");
    for (const animation of motion) animation.pause();
    const sample = (progress: number) => {
      for (const animation of motion) {
        animation.currentTime = Number(animation.effect?.getComputedTiming().duration) * progress;
      }
      return position();
    };
    const start = sample(0);
    const middle = sample(0.5);
    const end = sample(1);
    for (const animation of motion) animation.finish();
    await Promise.all(motion.map((animation) => animation.finished));
    if (Math.abs(start - before) > 1)
      throw new Error("Selection must start at its visible position");
    return { start, middle, end };
  }, choice);
}

test("the sticky header stays above the docked terminal card on short viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/");
  await skipIntro(page);

  const result = await page.evaluate(async () => {
    const scroller = document.scrollingElement;
    if (!scroller) throw new Error("The document scroller is required");
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector<HTMLElement>(".site-header");
    const card = document.querySelector<HTMLElement>(".xca-terminal-window");
    if (!header || !card) throw new Error("The header and the terminal card are required");
    const headerRect = header.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const x = Math.round(Math.max(headerRect.left + 30, cardRect.left + 40));
    const y = Math.round(headerRect.top + headerRect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      overlapped: cardRect.top < headerRect.bottom,
      headerOnTop: !!hit?.closest(".site-header"),
      cardOnTop: !!hit?.closest(".xca-terminal-window"),
    };
  });

  expect(result.overlapped).toBe(true);
  expect(result.headerOnTop).toBe(true);
  expect(result.cardOnTop).toBe(false);
});
