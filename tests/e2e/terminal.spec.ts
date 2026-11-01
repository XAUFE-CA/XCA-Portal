import { expect, test } from "@playwright/test";
import zh from "../../app/i18n/locales/zh-CN.json" with { type: "json" };
import { setThemePreference } from "./preferences";
import { SCENE_TIMEOUT, SETTLE_TIMEOUT } from "./timing";

interface IntroFrame {
  phase: string;
  bannerLength: number;
  bootLineCount: number;
  headerOpacity: number;
  headingOpacity: number;
  width: number;
  top: number;
}

async function recordIntro(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const frames: IntroFrame[] = [];
    Object.assign(window, { xcaIntroFrames: frames });
    let started = false;
    function sample() {
      const hero = document.querySelector(".xca-terminal-hero");
      const screenStage = hero
        ?.querySelector(".xca-terminal-screen")
        ?.className.match(/xca-terminal-screen--(boot|brand|dock|reveal)\b/)?.[1];
      const phase =
        screenStage === "brand"
          ? "branding"
          : screenStage === "dock"
            ? "docking"
            : screenStage === "reveal"
              ? "revealing"
              : screenStage;
      const terminal = hero?.querySelector(".xca-terminal-window");
      const header = document.querySelector(".site-header-wrap");
      const heading = hero?.querySelector(".xca-terminal-hero__heading");
      if (phase && hero && terminal && header && heading) {
        started = true;
        frames.push({
          phase,
          bootLineCount: hero.querySelectorAll(".xca-terminal-bootlog__line").length,
          bannerLength:
            hero?.querySelector(".xca-terminal-history .xca-terminal-banner")?.textContent
              ?.length ?? 0,
          headerOpacity: Number(getComputedStyle(header).opacity),
          headingOpacity: Number(getComputedStyle(heading).opacity),
          width: terminal.getBoundingClientRect().width,
          top: terminal.getBoundingClientRect().top,
        });
      }
      if (!started || phase) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    // Mutation batches also feed the recorder; a slow frame must not drop a whole stage.
    // 变更批次同样写入记录器；慢帧不应丢掉整个阶段。
    const observe = () => {
      if (!document.body) return requestAnimationFrame(observe);
      new MutationObserver(sample).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    };
    observe();
  });
  return () =>
    page.evaluate(() => (window as unknown as { xcaIntroFrames: IntroFrame[] }).xcaIntroFrames);
}

async function skipAnimation(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator(".site-header-wrap")).toHaveCSS("transform", "none");
}
test("entrance can be skipped, home navigation preserves history, and refresh uses a short entry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await page.locator("#xca-command-input").fill("whoami");
  await page.locator("#xca-command-input").press("Enter");
  await expect(page.getByText("guest  /  访客模式")).toBeVisible();
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("guest  /  访客模式")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(page.locator(".xca-ca-intro")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("registered commands, virtual files, completion, and themes work", async ({ page }) => {
  await page.goto("/");
  await skipAnimation(page);
  const input = page.locator("#xca-command-input");
  await input.fill("hel");
  await input.press("Tab");
  await expect(input).toHaveValue("help ");
  await input.press("Enter");
  await expect(page.getByText(zh["command.available"], { exact: true })).toBeVisible();
  await input.fill("cat /etc/os-release");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toContainText("SIMULATED=true");
  await input.fill("xca theme dark");
  await input.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await input.fill("xca open home");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("mobile and reduced motion retain a real, usable terminal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  const input = page.locator("#xca-command-input");
  await input.fill("xca banner");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-banner")).toHaveCount(2);
  await expect(page.locator(".xca-terminal-banner").first()).toHaveAttribute(
    "aria-label",
    zh["terminal.welcomeLabel"],
  );
  const widths = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(widths[0]).toBe(widths[1]);
  await page.getByRole("button", { name: "展开终端" }).click();
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(0);
});

test("Linux-style boot lines and Welcome to XCA ASCII rows print progressively @cinematic", async ({
  page,
}) => {
  const recordedFrames = await recordIntro(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const window = page.locator(".xca-terminal-window");
  const lines = page.locator(".xca-terminal-bootlog__line");
  await expect(page.locator(".xca-terminal-hero--boot")).toHaveCount(1, { timeout: SCENE_TIMEOUT });
  await window.evaluate((element) => {
    element.dataset.xcaPersistent = "yes";
  });

  await expect(lines).toHaveCount(6, { timeout: SCENE_TIMEOUT });
  // The bar advances one tick per rendered frame; software renderers need the scene budget.
  // 进度条每渲染一帧推进一格；软件渲染器需要场景预算。
  await expect(page.locator(".xca-terminal-boot-progress")).toHaveAttribute(
    "aria-valuenow",
    "100",
    { timeout: SCENE_TIMEOUT },
  );
  await expect(page.locator(".xca-terminal-hero--branding")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });

  const introBanner = page.locator(".xca-terminal-history .xca-terminal-banner");
  await expect
    .poll(async () => (await introBanner.textContent())?.trim().length ?? 0)
    .toBeGreaterThan(0);
  await expect(introBanner).toHaveAttribute("aria-label", zh["terminal.welcomeLabel"]);

  await expect(page.locator(".xca-terminal-hero--docking")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  await expect(page.locator(".xca-terminal-hero--revealing")).toHaveCount(1);
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT,
  });
  await expect(window).toHaveAttribute("data-xca-persistent", "yes");
  const frames = await recordedFrames();
  const counts = frames
    .filter((frame) => frame.phase === "boot")
    .map((frame) => frame.bootLineCount);
  expect(counts).toContain(1);
  expect(counts).toContain(6);
  for (let index = 1; index < counts.length; index++)
    expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1] ?? 0);
  const bannerLengths = frames
    .filter((frame) => frame.phase === "branding" && frame.bannerLength > 0)
    .map((frame) => frame.bannerLength);
  expect(new Set(bannerLengths).size).toBeGreaterThan(1);
  const dockingPositions = frames
    .filter((frame) => frame.phase === "boot" && frame.headerOpacity > 0)
    .map((frame) => frame.top);
  expect(Math.max(...dockingPositions) - Math.min(...dockingPositions)).toBeGreaterThan(1);
  expect(await page.locator("html").getAttribute("data-xca-intro")).toBeNull();
  await expect(page.locator(".xca-terminal-bootlog")).toHaveCount(0);
});

test("resizing during the intro settles to the anchor without leaving an overlay", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--boot")).toHaveCount(1, { timeout: SCENE_TIMEOUT });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBe(390);
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SCENE_TIMEOUT,
  });
  await expect(page.locator(".xca-terminal-hero__intro-backdrop")).toHaveCount(0);
  const input = page.locator("#xca-command-input");
  await input.fill("help");
  await input.press("Enter");
  await expect(page.getByText(zh["command.available"], { exact: true })).toBeVisible();
});

test("saved theme applies before hydration and persists across homepage reloads", async ({
  page,
}) => {
  await page.goto("/");
  await skipAnimation(page);
  await setThemePreference(page, "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await skipAnimation(page);
  await expect(
    page.getByRole("radiogroup", { name: "主题" }).getByRole("radio", { name: "深色" }),
  ).toBeChecked();
  const darkSurface = await page
    .locator(".site-shell")
    .evaluate((shell) => getComputedStyle(shell).backgroundColor);
  await page.waitForTimeout(350);
  expect(
    await page.locator(".site-shell").evaluate((shell) => getComputedStyle(shell).backgroundColor),
  ).toBe(darkSurface);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await skipAnimation(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await setThemePreference(page, "light");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await skipAnimation(page);
  await expect(
    page.getByRole("radiogroup", { name: "主题" }).getByRole("radio", { name: "浅色" }),
  ).toBeChecked();
  await page.waitForTimeout(350);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("surrounding content reveals while boot and terminal arrival overlap @cinematic", async ({
  page,
}) => {
  const recordedFrames = await recordIntro(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const hero = page.locator(".xca-terminal-hero");
  await expect(page.locator(".xca-terminal-screen--boot")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  await expect(page.locator(".xca-ca-intro")).toHaveAttribute("data-journey", "retreat");
  await expect(hero).toHaveClass(/xca-terminal-hero--revealing/);
  await expect(page.locator(".xca-terminal-bootlog__line")).toHaveCount(5);
  const heading = page.locator(".xca-terminal-hero__heading");
  await expect(heading).toHaveCSS("opacity", "1");
  await expect(page.locator(".xca-terminal-screen--brand")).toHaveCount(1);
  await expect(page.locator("#xca-command-input")).toBeEnabled();
  const terminal = page.locator(".xca-terminal-window");
  expect(await terminal.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(
    await page
      .locator(".xca-terminal-anchor")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
  );
  await expect(hero).not.toHaveClass(/xca-terminal-hero--intro/, { timeout: SETTLE_TIMEOUT });
  const frames = await recordedFrames();
  expect(
    frames.some(
      (frame) => frame.phase === "boot" && frame.headerOpacity > frame.headingOpacity + 0.01,
    ),
  ).toBe(true);
  const printedWelcome = frames.filter(
    (frame) => frame.phase === "branding" || frame.phase === "docking",
  );
  expect(
    Math.max(...printedWelcome.map((frame) => frame.top)) -
      Math.min(...printedWelcome.map((frame) => frame.top)),
  ).toBeLessThan(1);
});

test("expanding and collapsing terminal morphs smoothly, including rapid reversal", async ({
  page,
}) => {
  await page.goto("/");
  await skipAnimation(page);
  const term = page.locator(".xca-terminal-window");
  await term.evaluate((element) => {
    element.dataset.persistentWindow = "yes";
  });
  const compact = await term.boundingBox();
  expect(compact).not.toBeNull();
  if (!compact) throw new Error("Compact terminal bounding box is missing");
  await page.getByRole("button", { name: "展开终端" }).click();
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(1);
  const intermediate = await term.boundingBox();
  expect(intermediate).not.toBeNull();
  if (!intermediate) throw new Error("Expanding terminal bounding box is missing");
  expect(intermediate.width).toBeGreaterThan(compact.width - 1);
  await page.waitForTimeout(130);
  const mid = await term.boundingBox();
  if (!mid) throw new Error("Mid-expansion terminal bounding box is missing");
  expect(mid.width).toBeGreaterThan(compact.width);
  expect(mid.width).toBeLessThan(1350);
  await expect
    .poll(async () => {
      const box = await term.boundingBox();
      if (!box) throw new Error("Expanded terminal bounding box is missing");
      return box.width;
    })
    .toBeGreaterThan(1300);
  await page.getByRole("button", { name: "还原终端大小" }).click();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "展开终端" }).click();
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "还原终端大小" }).click();
  await page.waitForTimeout(500);
  const restored = await term.boundingBox();
  if (!restored) throw new Error("Restored terminal bounding box is missing");
  expect(Math.round(restored.width)).toBe(Math.round(compact.width));
  await expect(term).toHaveAttribute("data-persistent-window", "yes");
  await expect(page.locator(".xca-terminal-hero__focus-backdrop")).toHaveCSS("opacity", "0");
});

test("changing viewport during ASCII printing safely settles the single terminal @cinematic", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--branding")).toHaveCount(1, {
    timeout: SCENE_TIMEOUT,
  });
  const terminal = page.locator(".xca-terminal-window");
  await terminal.evaluate((element) => {
    element.dataset.resizePersistence = "yes";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT,
  });
  await expect(terminal).toHaveAttribute("data-resize-persistence", "yes");
  await expect(page.locator(".xca-terminal-hero__intro-backdrop")).toHaveCount(0);
  const columns = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(columns).toEqual([390, 390]);
  await page.locator("#xca-command-input").fill("help");
  await page.locator("#xca-command-input").press("Enter");
  await expect(page.getByText(zh["command.available"], { exact: true })).toBeVisible();
});

test("ASCII wordmark remains aligned and unclipped on desktop, mobile and narrow screens", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(async () =>
        page
          .locator(".xca-terminal-banner")
          .first()
          .textContent()
          .then((value) => value?.split("\n").length ?? 0),
      )
      .toBeGreaterThan(1);
    const banner = await page
      .locator(".xca-terminal-banner")
      .first()
      .evaluate((element) => {
        // One equal-width cell is the smallest meaningful overflow unit for the banner.
        // 等宽字符画的最小有意义溢出单位是一个字符格。
        const probe = document.createElement("span");
        probe.textContent = "0";
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
        element.append(probe);
        const cell = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          text: element.textContent ?? "",
          overflow: element.scrollWidth - element.clientWidth,
          cell,
        };
      });
    const brandStyle = await page
      .locator(".xca-terminal-banner")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const accentProbe = document.createElement("span");
        accentProbe.style.color = "var(--neoverse-color-accent-primary)";
        document.body.append(accentProbe);
        const expectedAccent = getComputedStyle(accentProbe).color;
        accentProbe.remove();
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          color: style.color,
          expectedAccent,
          size: parseFloat(style.fontSize),
          lineRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
          expectedLineRatio: parseFloat(rootStyle.getPropertyValue("--neoverse-line-height-snug")),
          mobileSize:
            parseFloat(rootStyle.getPropertyValue("--neoverse-font-size-2xs")) *
            parseFloat(rootStyle.fontSize),
          whitespace: style.whiteSpace,
          ligatures: style.fontVariantLigatures,
        };
      });
    expect(brandStyle.color).toBe(brandStyle.expectedAccent);
    expect(brandStyle.lineRatio).toBeCloseTo(brandStyle.expectedLineRatio, 2);
    if (width < 608) expect(brandStyle.size).toBeCloseTo(brandStyle.mobileSize, 2);
    expect(brandStyle.whitespace).toBe("pre");
    expect(brandStyle.ligatures).toBe("none");
    expect(banner.text).not.toContain("#");
    expect(banner.text).toContain("█");
    expect(banner.text.split("\n").length).toBeGreaterThan(4);
    // Narrow layouts clip the banner on purpose (`overflow-x: clip`), so only the widest
    // layout must fit its columns; rasterizers may differ by under one cell there.
    // 窄屏按设计用 `overflow-x: clip` 裁切字符画，因此只有最宽布局必须容纳全部列；
    // 且不同光栅器在该布局下最多相差一个字符格。
    if (width >= 1440) expect(banner.overflow).toBeLessThanOrEqual(banner.cell);
    // Desktop reserves a stable scrollbar gutter; narrower document width is expected.
    // 桌面端预留稳定滚动条边槽，因此文档宽度变窄属预期。
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test("immersive scrollbars keep a permanent terminal gutter and never scroll the banner", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  const transcript = page.locator(".xca-terminal-transcript");
  const banner = page.locator(".xca-terminal-banner").first();
  await expect(page.locator(".ui-scrollbar")).toHaveCount(1);
  await expect(page.locator("html")).toHaveClass(/ui-scrollbar-target/);
  await expect(transcript).toHaveCSS("scrollbar-gutter", "stable");
  await expect(banner).toHaveCSS("overflow-x", "clip");

  for (const width of [1440, 1100, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    // The banner is clipped on purpose, so the gutter assertion is about the document only.
    // 字符画按设计裁切，因此这一项只检查文档不产生横向滚动。
    await expect
      .poll(() => banner.evaluate((node) => getComputedStyle(node).overflowX))
      .toBe("clip");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await transcript.evaluate((node) => node.clientWidth);
  const input = page.locator("#xca-command-input");
  for (let count = 0; count < 3; count++) {
    await input.fill("help");
    await input.press("Enter");
  }
  await expect
    .poll(async () => transcript.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  const after = await transcript.evaluate((node) => node.clientWidth);
  expect(after).toBe(before);
  // Same subpixel allowance as the layout loop above; this viewport is the widest one.
  // 与上方布局循环一致的亚像素容差；此处是最宽视口。
  expect(
    await banner.evaluate((node) => {
      const probe = document.createElement("span");
      probe.textContent = "0";
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
      node.append(probe);
      const cell = probe.getBoundingClientRect().width;
      probe.remove();
      return node.scrollWidth - node.clientWidth <= cell;
    }),
  ).toBe(true);
});
