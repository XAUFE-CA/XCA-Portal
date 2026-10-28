import { expect, test } from "@playwright/test";

test("document scrollbar uses the viewport, not the clipped XCA layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const rail = page.locator("body > .ui-scrollbar");
  await expect(rail).toHaveCount(1);
  await expect(page.locator("html")).toHaveClass(/ui-scrollbar-target/);

  for (const width of [1440, 1100, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    const metrics = await page.evaluate(() => {
      function requiredElement(selector: string) {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Scrollbar layout element is missing: ${selector}`);
        return element;
      }
      const rail = requiredElement(".ui-scrollbar");
      const shell = requiredElement(".site-shell");
      const header = requiredElement(".site-header");
      const themeControl = requiredElement(".site-theme-control");
      return {
        railParent: rail.parentElement?.tagName,
        railTop: rail.getBoundingClientRect().top,
        themeControlBottom: themeControl.getBoundingClientRect().bottom,
        railLeft: rail.getBoundingClientRect().left,
        railRight: rail.getBoundingClientRect().right,
        rootGutter: getComputedStyle(document.documentElement).scrollbarGutter,
        rootPadding: parseFloat(getComputedStyle(document.documentElement).paddingRight),
        shellRight: shell.getBoundingClientRect().right,
        shellPadding: parseFloat(getComputedStyle(shell).paddingRight),
        headerRight: header.getBoundingClientRect().right,
        themeControlRight: themeControl.getBoundingClientRect().right,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    expect(metrics.railParent).toBe("BODY");
    expect(metrics.rootPadding).toBe(0);
    expect(metrics.rootGutter).toBe("auto");
    expect(metrics.shellRight).toBeCloseTo(width, 0);
    expect(metrics.shellPadding).toBe(0);
    // Header surface reaches the viewport edge; only its content clears the overlay rail.
    // 头部表面抵达视口边缘，仅其内容避开覆盖式滚动条。预留空间会裁掉极光玻璃。
    expect(metrics.headerRight).toBeCloseTo(width, 0);
    expect(metrics.railRight).toBeGreaterThan(width - 20);
    expect(metrics.railRight).toBeLessThan(width);
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(
      metrics.themeControlRight < metrics.railLeft || metrics.themeControlBottom <= metrics.railTop,
    ).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  // The home page has only a hero. Inject temporary content to test the document rail.
  // 当前首页只有主视觉区，注入临时内容以测试文档滚动条，且不改动生产布局。
  await page.locator(".site-main").evaluate((element) => {
    const fixture = document.createElement("div");
    fixture.dataset.scrollFixture = "true";
    fixture.style.height = "1600px";
    element.appendChild(fixture);
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(1800);
  // The page no longer overflows here; reveal the rail after injecting the fixture.
  // 页面在此视口已不再溢出，注入夹具后唤出沉浸式滚动条。
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(rail).toHaveAttribute("data-visible", "true");
  const beforeWidth = await page.locator(".site-main").evaluate((node) => node.clientWidth);

  // Scroll the document, not the nested terminal transcript under the pointer.
  // 滚动文档，而非指针下嵌套的终端记录区。
  await page.mouse.move(24, 680);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  const firstScroll = await page.evaluate(() => scrollY);
  await rail.click({ position: { x: 5, y: 630 } });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(firstScroll + 100);

  const beforeDrag = await page.evaluate(() => scrollY);
  const thumb = page.locator(".ui-scrollbar__thumb");
  const thumbRect = await thumb.boundingBox();
  expect(thumbRect).not.toBeNull();
  if (!thumbRect) throw new Error("The scrollbar thumb must have a bounding box before dragging");
  await page.mouse.move(thumbRect.x + thumbRect.width / 2, thumbRect.y + thumbRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumbRect.x + thumbRect.width / 2, thumbRect.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(beforeDrag - 100);
  expect(await page.locator(".site-main").evaluate((node) => node.clientWidth)).toBe(beforeWidth);

  await page.reload();
  await expect(page.locator("body > .ui-scrollbar")).toHaveCount(1);
  await expect(page.locator("html")).toHaveClass(/ui-scrollbar-target/);
  await page.goto("/");
  await expect(page.locator("body > .ui-scrollbar")).toHaveCount(1);
});

test("document scrollbar is hidden behind boot and full-screen terminal", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const rail = page.locator("body > .ui-scrollbar");
  await expect(rail).toHaveCount(1);
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1);
  await expect(rail).toHaveCSS("visibility", "hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(rail).toHaveCSS("visibility", "visible");
  await page.getByRole("button", { name: "展开终端" }).click();
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(1);
  await expect(rail).toHaveCSS("visibility", "hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--focused")).toHaveCount(0);
  await expect(rail).toHaveCSS("visibility", "visible");
});
