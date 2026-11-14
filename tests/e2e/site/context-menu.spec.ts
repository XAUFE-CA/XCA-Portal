import { expect, type Locator, type Page, test } from "@playwright/test";
import { useBriefEntry } from "../support/entry";

// Four regions mount a panel; only the open one is visible.
// 四个区域各挂载一个面板，只有打开的那个可见。
const panel = (page: Page): Locator => page.locator(".ui-context-menu:visible");

/**
 * Open the menu for a region at a viewport point, so the assertion is about the panel
 * rather than about how the pointer reached it.
 * 在视口坐标打开区域菜单，使断言针对面板本身，而不是指针如何到达那里。
 */
async function openAt(page: Page, region: Locator, offset = { x: 8, y: 8 }) {
  const box = await region.boundingBox();
  if (!box) throw new Error("Region must be laid out before opening its menu");
  await page.mouse.click(box.x + offset.x, box.y + offset.y, { button: "right" });
  await expect(panel(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await useBriefEntry(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
});

test("terminal menu runs the registered commands instead of a second state path", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  await input.click();
  await input.fill("echo context menu");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-history")).toContainText("context menu");

  await openAt(page, page.locator(".xca-terminal-anchor"));
  await expect(panel(page)).toHaveAttribute("aria-label", "终端操作");
  await expect(panel(page).getByRole("menuitem", { name: "复制最后一条命令" })).toBeEnabled();

  await panel(page).getByRole("menuitem", { name: "清屏" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".xca-terminal-history")).not.toContainText("context menu");
});

test("terminal menu switches the background through the appearance command", async ({ page }) => {
  await openAt(page, page.locator(".xca-terminal-anchor"));
  const radio = panel(page).getByRole("menuitemradio", { name: "纯净" });
  await expect(radio).toHaveAttribute("aria-checked", "false");
  await radio.click();

  await openAt(page, page.locator(".xca-terminal-anchor"));
  await expect(panel(page).getByRole("menuitemradio", { name: "纯净" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("title menu copies the heading and reports the clipboard result", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openAt(page, page.locator(".xca-terminal-hero__heading"));

  await expect(panel(page)).toHaveAttribute("aria-label", "标题操作");
  await panel(page).getByRole("menuitem", { name: "复制标题" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("已复制到剪贴板");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.length).toBeGreaterThan(0);
});

test("keyboard opens the menu at the focused element and restores focus on Escape", async ({
  page,
}) => {
  const link = page.locator(".site-navigation a").first();
  await link.focus();
  await page.keyboard.press("Shift+F10");

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(panel(page).getByRole("menuitem").nth(1)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(link).toBeFocused();
});

test("native menu option passes the next right-click to the browser across regions", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.addEventListener("contextmenu", (event) => {
      document.documentElement.dataset.contextMenuPrevented = String(event.defaultPrevented);
    });
  });
  await openAt(page, page.locator(".xca-terminal-hero__heading"));
  await expect(page.locator("html")).toHaveAttribute("data-context-menu-prevented", "true");
  await panel(page).getByRole("menuitem", { name: "显示原生菜单" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".xca-context-menu-status")).toHaveText(
    "再次右键、长按或按 Shift+F10 打开浏览器菜单",
  );

  await page.locator("#xca-command-input").click({ button: "right" });
  await expect(page.locator("html")).toHaveAttribute("data-context-menu-prevented", "false");
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".xca-context-menu-status")).toBeHidden();

  await openAt(page, page.locator(".xca-terminal-anchor"));
  await expect(page.locator("html")).toHaveAttribute("data-context-menu-prevented", "true");
  await expect(panel(page)).toHaveAttribute("aria-label", "终端操作");
});

test("native menu option supports the keyboard and follows the selected language", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.addEventListener("contextmenu", (event) => {
      document.documentElement.dataset.contextMenuPrevented = String(event.defaultPrevented);
    });
  });
  await openAt(page, page.locator(".xca-terminal-hero__heading"));
  await panel(page).getByRole("menuitem", { name: "切换语言" }).click();
  await page
    .locator(".ui-context-menu__submenu:visible")
    .getByRole("menuitemradio", {
      name: "English",
    })
    .click();
  // A selection closes the panel; the next open must not race that exit transition.
  // 选择后父面板关闭，下一次打开不能与它的退场过渡竞争。
  await expect(panel(page)).toBeHidden();

  const link = page.locator(".site-navigation a").first();
  await link.focus();
  await page.keyboard.press("Shift+F10");
  const nativeMenuOption = panel(page).getByRole("menuitem", { name: "Show native menu" });
  await nativeMenuOption.focus();
  await page.keyboard.press("Enter");
  await expect(link).toBeFocused();
  await expect(page.locator(".xca-context-menu-status")).toHaveText(
    "Right-click, touch and hold, or press Shift+F10 to open the browser menu",
  );
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("html")).toHaveAttribute("data-context-menu-prevented", "false");
  await expect(panel(page)).toBeHidden();
});

test("the command line opens the terminal menu and pastes at the caret", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("pasted"));

  const input = page.locator("#xca-command-input");
  await input.click();
  await input.type("echo ");
  // A pointer open moves the caret to the click point, so the keyboard path proves the
  // insert lands at the caret the visitor was editing.
  // 指针打开会把光标移到点击位置，因此用键盘路径验证插入落在访客正在编辑的光标处。
  await page.keyboard.press("Shift+F10");

  await expect(panel(page)).toHaveAttribute("aria-label", "终端操作");
  await panel(page).getByRole("menuitem", { name: "粘贴" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(input).toHaveValue("echo pasted");
});

test("copying a command-line selection reads the editor range, not the page selection", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const input = page.locator("#xca-command-input");
  await input.click();
  await input.type("echo selected words");
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(5, 13));

  await page.keyboard.press("Shift+F10");
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("menuitem", { name: "复制选中内容" }).click();

  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("已复制到剪贴板");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("selected");
});

test("copying a transcript selection reads the page selection", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const point = await page.evaluate(() => {
    const line = document.querySelector(".xca-terminal-history .ui-terminal-line");
    if (!line) throw new Error("Transcript line is required");
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection();
    if (!selection) throw new Error("Selection API is required");
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = line.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("menuitem", { name: "复制选中内容" }).click();

  await expect(panel(page)).toBeHidden();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(0);
  expect(copied).toContain("█");
});

test("theme and language open a submenu column inside the panel", async ({ page }) => {
  const heading = page.locator(".xca-terminal-hero__heading");
  await openAt(page, heading);

  const topWidth = await panel(page).evaluate((element) => element.getBoundingClientRect().width);
  const themeRow = panel(page).getByRole("menuitem", { name: "切换主题" });
  await expect(themeRow).toHaveAttribute("aria-haspopup", "menu");
  await themeRow.click();

  // The submenu is its own manual popover teleported to the body.
  // 二级菜单是传送到 body 的独立 manual 浮层。
  const submenu = page.locator(".ui-context-menu__submenu");
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(submenu.getByRole("menuitemradio", { name: "系统" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The column overlaps the panel edge by one rim width so its own glass rim covers the
  // parent's, which is what the shared component's own browser check specifies; it stays
  // aligned to the row that opened it, and the panel never widens.
  // 二级菜单与面板边缘重叠一个边缘宽度，用自身玻璃边缘盖住父面板边缘，与共享组件自己的
  // 浏览器用例口径一致；首行与父项对齐，面板不会加宽。
  const readGeometry = () =>
    page.evaluate(() => {
      const panelEl = [...document.querySelectorAll<HTMLElement>(".ui-context-menu")].find((el) =>
        el.matches(":popover-open"),
      );
      const column = document.querySelector<HTMLElement>(".ui-context-menu__submenu");
      const opener = column?.ownerDocument.querySelector<HTMLElement>(
        '.ui-context-menu__item[data-open="true"]',
      );
      const firstRow = column?.querySelector<HTMLElement>(".ui-context-menu__item") ?? null;
      if (!panelEl || !column || !opener || !firstRow) return null;
      const panelRect = panelEl.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      return {
        overlap: panelRect.right - columnRect.left,
        align: Math.abs(firstRow.getBoundingClientRect().top - opener.getBoundingClientRect().top),
        width: panelEl.offsetWidth,
        backdrop: getComputedStyle(column).backdropFilter,
      };
    });
  await expect
    .poll(async () => {
      const first = await readGeometry();
      await page.waitForTimeout(120);
      const second = await readGeometry();
      if (!first || !second) return null;
      // The overlap covers one rim width instead of leaving a seam, and stays inside that
      // band once the entrance settles.
      // 重叠恰好盖住一个边缘宽度而不是留出缝隙，入场稳定后仍在该范围内。
      return [first, second].every(
        (sample) => sample.overlap >= 3 && sample.overlap <= 6 && sample.align < 2,
      );
    })
    .toBe(true);
  const settled = await readGeometry();
  if (settled === null) throw new Error("Panel, column and opener must be laid out");
  expect(settled.backdrop).not.toBe("none");
  expect(settled.width).toBeLessThanOrEqual(topWidth + 1);
  await expect(themeRow).toHaveAttribute("aria-expanded", "true");
  await expect(themeRow).toHaveAttribute("aria-controls", (await submenu.getAttribute("id")) ?? "");

  await submenu.getByRole("menuitemradio", { name: "深色" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

/**
 * Open the menu on an element's centre through a synthetic contextmenu event, so a case can
 * target an image or a link without depending on where the pointer can reach.
 * 通过合成的 contextmenu 事件在元素中心打开菜单，使用例可以直接针对图片或链接，而不依赖指针可达位置。
 */
async function openAtElement(page: Page, element: Locator) {
  await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  });
  await expect(panel(page)).toBeVisible();
}

test("image rows copy the address and the image itself", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const logo = page.locator(".site-footer__mark");
  await logo.scrollIntoViewIfNeeded();

  await openAtElement(page, logo);
  await panel(page).getByRole("menuitem", { name: "复制图片链接" }).click();
  await expect(panel(page)).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("ca-mark.svg");

  await openAtElement(page, logo);
  await panel(page).getByRole("menuitem", { name: "复制图片", exact: true }).click();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("图片已复制");

  // The about card's banner is the other region that shows an image.
  // 关于学社卡片的横幅是另一个显示图片的区域。
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const banner = page.locator(".about-card__banner img:visible");
  await expect(banner).toBeVisible();
  await openAtElement(page, banner);
  await expect(panel(page)).toHaveAttribute("aria-label", "关于学社操作");
  await panel(page).getByRole("menuitem", { name: "复制图片链接" }).click();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("已复制到剪贴板");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("xca-banner");

  // The banner is WebP, which the clipboard rejects, so the row re-encodes it as PNG.
  // 横幅是 WebP，剪贴板不接受该格式，因此该行会重新编码为 PNG。
  await openAtElement(page, banner);
  await panel(page).getByRole("menuitem", { name: "复制图片", exact: true }).click();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("图片已复制");
  expect(
    await page.evaluate(async () => (await navigator.clipboard.read())[0]?.types ?? []),
  ).toContain("image/png");
});

test("footer and about regions keep their own rows", async ({ page }) => {
  const footerLink = page.locator(".site-footer a").first();
  await footerLink.scrollIntoViewIfNeeded();
  await openAt(page, footerLink, { x: 2, y: 2 });
  await expect(panel(page).getByRole("menuitem", { name: "复制链接地址" })).toBeEnabled();
  await page.keyboard.press("Escape");

  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".about-card")).toBeVisible();
  await openAt(page, page.locator(".about-page"));
  await expect(panel(page)).toHaveAttribute("aria-label", "关于学社操作");
  await expect(panel(page).getByRole("menuitem", { name: "复制选中内容" })).toBeDisabled();
});

test("a failed paste reports a toast fixed in the lower viewport center", async ({ page }) => {
  const status = page.locator(".xca-context-menu-status");
  const geometry = () =>
    status.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        centerX: (box.left + box.right) / 2,
        centerY: (box.top + box.bottom) / 2,
        width: window.innerWidth,
        height: window.innerHeight,
        position: style.position,
        border: style.borderTopWidth,
        radius: Number.parseFloat(style.borderRadius),
        filter: style.backdropFilter,
      };
    });

  await openAt(page, page.locator(".xca-terminal-anchor"), { x: 8, y: 8 });
  const panelBackdrop = await panel(page).evaluate((node) => getComputedStyle(node).backdropFilter);
  await panel(page).getByRole("menuitem", { name: "粘贴" }).click();
  await expect(status).toHaveText("剪贴板为空或无权读取");

  // The toast borrows the panel's shared glass surface instead of repainting an overlay recipe.
  // 提示条复用面板的共享玻璃表面，不再另绘一套浮层配方。
  const material = await status.evaluate((node) => ({
    surface: node.getAttribute("data-surface"),
    occluder: node.getAttribute("data-neoverse-glass-occluder"),
    parentIsBody: node.parentElement === document.body,
    zIndex: getComputedStyle(node).zIndex,
    toastLayer: getComputedStyle(document.documentElement)
      .getPropertyValue("--neoverse-layout-layer-toast")
      .trim(),
    backdrop: getComputedStyle(node).backdropFilter,
    isolation: getComputedStyle(node).isolation,
  }));
  expect(material.surface).toBe("glass-immersive");
  expect(material.backdrop).toBe(panelBackdrop);
  expect(material.isolation).toBe("isolate");
  expect(material.occluder).toBe("topmost");
  expect(material.parentIsBody).toBe(true);
  expect(material.zIndex).toBe(material.toastLayer);

  const first = await geometry();
  await expect(status).toHaveCount(0, { timeout: 5000 });
  await openAt(page, page.locator(".xca-terminal-anchor"), { x: 220, y: 140 });
  await panel(page).getByRole("menuitem", { name: "粘贴" }).click();
  const second = await geometry();

  expect(first.position).toBe("fixed");
  expect(Math.abs(first.centerX - first.width / 2)).toBeLessThan(1);
  expect(first.centerY / first.height).toBeGreaterThan(0.8);
  expect(first.centerY / first.height).toBeLessThan(0.95);
  expect(first.border).not.toBe("0px");
  expect(first.radius).toBeGreaterThan(0);
  expect(first.filter).not.toBe("none");
  expect(Math.abs(second.centerX - first.centerX)).toBeLessThan(1);
  expect(Math.abs(second.centerY - first.centerY)).toBeLessThan(1);

  // Both directions resolve a blur; the toast must not pop in or out.
  // 两个方向都让模糊收敛，提示不能突现突消。
  const motion = await page.evaluate(() => {
    const rules: string[] = [];
    const walk = (list: CSSRuleList, media = "") => {
      for (const rule of list) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes("xca-context-menu-status"))
          rules.push(`${media} ${rule.cssText}`);
        else if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        // Cross-origin sheets are not readable.
      }
    }
    return rules.join("\n");
  });
  expect(motion).toContain("enter-active");
  expect(motion).toContain("leave-active");
  expect(motion).toContain("blur(");
  expect(motion).toContain("prefers-reduced-motion");
});

test("a header region toast stays above the header glass stacking context", async ({ page }) => {
  const status = page.locator(".xca-context-menu-status");
  await openAt(page, page.locator(".site-navigation a").first(), { x: 4, y: 4 });
  await panel(page).getByRole("menuitem", { name: "复制链接地址" }).click();
  await expect(status).toBeVisible();

  // A pointer-transparent viewport surface must not inherit the region's glass rim or layer.
  // 不吃指针事件的视口表面不能继承区域的玻璃边缘与层叠层级。
  const layering = await status.evaluate((node) => ({
    parentIsBody: node.parentElement === document.body,
    insideHeaderGlass: node.closest(".site-header") !== null,
    zIndex: getComputedStyle(node).zIndex,
    toastLayer: getComputedStyle(document.documentElement)
      .getPropertyValue("--neoverse-layout-layer-toast")
      .trim(),
    occluder: node.getAttribute("data-neoverse-glass-occluder"),
  }));
  expect(layering.parentIsBody).toBe(true);
  expect(layering.insideHeaderGlass).toBe(false);
  expect(layering.zIndex).toBe(layering.toastLayer);
  expect(layering.occluder).toBe("topmost");
});

test("replaying the intro clears the menu popover before the scene starts", async ({ page }) => {
  // Reduced motion collapses the panel's discrete exit to 1ms; stretch it so the painted
  // window is observable while the replay stays on the readable text path.
  // 减少动效把面板的离散退出压缩到 1ms；拉长它以观察绘制窗口，重播仍走可读文字路径。
  await page.addStyleTag({ content: ".nv-presence { transition-duration: 400ms !important; }" });
  // The panel closes in the same tick as the replay request. The shared edge canvas must not
  // start the intro while that panel is still painted, even after it leaves the top layer.
  // 面板与重播请求在同一 tick 关闭。即使浮层已离开顶层，共享边缘画布仍不能在其可见时启动入场。
  await page.evaluate(() => {
    const state: { topLayer: boolean; paintedPanels: number }[] = [];
    Object.assign(window, { xcaIntroTopLayer: state });
    const read = () => {
      if (document.documentElement.dataset.xcaIntro !== "running" || state.length) return;
      state.push({
        topLayer: document.querySelector(":popover-open, dialog[open]") !== null,
        paintedPanels: Array.from(document.querySelectorAll<HTMLElement>("[popover]")).filter(
          (element) =>
            !element.matches(":popover-open") && getComputedStyle(element).display !== "none",
        ).length,
      });
    };
    new MutationObserver(read).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-xca-intro"],
    });
    read();
  });
  await openAt(page, page.locator(".xca-terminal-anchor"));
  await panel(page).getByRole("menuitem", { name: "重播入场动画" }).click();
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(1, { timeout: 10000 });
  const state = await page.evaluate(
    () =>
      (window as unknown as { xcaIntroTopLayer: { topLayer: boolean; paintedPanels: number }[] })
        .xcaIntroTopLayer,
  );
  expect(state.length).toBeGreaterThan(0);
  expect(state[0]?.topLayer).toBe(false);
  expect(state[0]?.paintedPanels).toBe(0);
});

test("dark theme keeps the shared glass material and token colours", async ({ page }) => {
  await page.getByRole("radio", { name: "深色" }).click();
  await openAt(page, page.locator(".xca-terminal-anchor"));

  const styles = await panel(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      display: style.display,
    };
  });
  expect(styles.display).toBe("grid");
  expect(styles.radius).not.toBe("0px");
  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("light theme keeps the shared glass material", async ({ page }) => {
  await page.getByRole("radio", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await openAt(page, page.locator(".xca-terminal-anchor"));

  const styles = await panel(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: style.borderRadius };
  });
  expect(styles.radius).not.toBe("0px");
  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("reduced motion removes the row transitions", async ({ page }) => {
  await openAt(page, page.locator(".xca-terminal-anchor"));

  const durations = await panel(page).evaluate((element) =>
    [...element.querySelectorAll(".ui-context-menu__item")].map(
      (row) => getComputedStyle(row).transitionDuration,
    ),
  );
  expect(durations.length).toBeGreaterThan(0);
  expect(durations.every((value) => value === "0s")).toBe(true);
});

test("forced colors keeps the system separator and focus ring", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const link = page.locator(".site-navigation a").first();
  await link.focus();
  await page.keyboard.press("Shift+F10");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("menuitem").first()).toBeFocused();

  const styles = await panel(page).evaluate((element) => {
    // System colors resolve to real values in every mode, so probing them proves the
    // forced palette replaced the tokens instead of assuming a specific browser palette.
    // 系统色在各模式下都会解析为实际值，用探针读出它们即可证明强制调色板替换了样式变量。
    const probe = document.createElement("span");
    probe.style.cssText = "position: absolute; visibility: hidden";
    document.body.append(probe);
    const systemColor = (value: string) => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const colors = {
      canvas: systemColor("Canvas"),
      canvasText: systemColor("CanvasText"),
      highlight: systemColor("Highlight"),
    };
    probe.remove();

    const focused = document.activeElement;
    const separator = element.querySelector(".ui-context-menu__separator");
    const row = element.querySelector(".ui-context-menu__item");
    return {
      colors,
      outlineStyle: focused ? getComputedStyle(focused).outlineStyle : null,
      outlineWidth: focused ? getComputedStyle(focused).outlineWidth : null,
      outlineColor: focused ? getComputedStyle(focused).outlineColor : null,
      separatorColor: separator ? getComputedStyle(separator).borderTopColor : null,
      rowColor: row ? getComputedStyle(row).color : null,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  expect(styles.outlineStyle).toBe("solid");
  expect(Number.parseFloat(styles.outlineWidth ?? "0")).toBeGreaterThan(0);
  expect(styles.outlineColor).toBe(styles.colors.highlight);
  expect(styles.separatorColor).toBe(styles.colors.canvasText);
  // The glass surface keeps its transparency under forced colors, so only the colour
  // channels are comparable with the Canvas probe.
  // 玻璃表面在强制配色下保留透明度，因此只能把颜色通道与 Canvas 探针比较。
  const rgb = (value: string) =>
    value
      .replace(/^rgba?\(([^)]+)\)$/, "$1")
      .split(",")
      .slice(0, 3)
      .join(",")
      .trim();
  expect(rgb(styles.background)).toBe(rgb(styles.colors.canvas));
  expect(styles.rowColor).toBe(styles.colors.canvasText);
});

test("only the build commit offers its own copy row", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const commit = page.locator(".site-footer__build-commit");
  // The stamp prints the short SHA first, so the displayed value is the expected clipboard.
  // 时间戳先打印短 SHA，因此页脚显示的值就是剪贴板应有的内容。
  const expected = (await commit.textContent())?.match(/\(([0-9a-f]+)/)?.[1];
  expect(expected).toBeTruthy();

  await openAt(page, page.locator(".site-navigation a").first());
  await expect(panel(page).getByRole("menuitem", { name: "复制构建提交" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  // The rest of the footer is ordinary links; the commit row must not follow them there.
  // 页脚其余部分是普通链接，提交行不应跟到那里。
  const credit = page.locator(".site-footer__shared-ui a").first();
  await credit.scrollIntoViewIfNeeded();
  await openAt(page, credit, { x: 2, y: 2 });
  await expect(panel(page).getByRole("menuitem", { name: "复制构建提交" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  await commit.scrollIntoViewIfNeeded();
  await openAt(page, commit, { x: 2, y: 2 });
  await panel(page).getByRole("menuitem", { name: "复制构建提交" }).click();
  await expect(page.locator(".xca-context-menu-status")).toHaveText("已复制到剪贴板");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
});
