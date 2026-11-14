import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
});

test("focused terminal editor has no outline box and retains the shared prompt focus marker", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" }).click();
    await input.focus();
    await input.press("ArrowLeft");
    await expect(input).toBeFocused();
    expect(await input.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("box-shadow", "none");
    await expect(input).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".xca-terminal-prompt .ui-terminal-prompt__symbol")).toHaveCSS(
      "text-decoration-line",
      "underline",
    );
    const themeControl = page.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" });
    await themeControl.focus();
    await expect(themeControl).toHaveCSS("outline-style", "solid");
  }
});

test("focused command line draws the shared breathing caret and yields to the native one", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  const prompt = page.locator(".ui-terminal-prompt");
  const glyph = page.locator(".ui-terminal-prompt__caret-glyph");

  await input.fill("echo caret");
  await input.focus();
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(5, 5));
  await input.press("Shift");
  await expect(prompt).toHaveAttribute("data-caret", "overlay");
  await expect(glyph).toHaveCount(1);
  // The overlay owns the caret while it is showing; only its opacity animates, so
  // the breath also runs under reduced motion, exactly like the native caret.
  // 自绘光标显示期间接管原生光标；它只改变透明度，因此减少动态效果下仍会呼吸。
  await expect(input).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  const caretLayer = page.locator(".ui-terminal-prompt__caret");
  await expect(caretLayer).not.toHaveClass(/caret--holding/u, { timeout: 5000 });
  await expect(glyph).toHaveCSS("animation-name", "ui-caret-breathe");
  await expect(glyph).toHaveCSS("animation-duration", "1s");
  await expect(glyph).toHaveCSS("border-radius", "9999px");
  // The bar takes the shared terminal cursor token; the light theme maps it to the deeper
  // accent step so the caret keeps 3:1 contrast over the pale canvas.
  // 竖条取共享终端光标变量；浅色主题在该变量里使用更深一档的强调色，使光标在浅底上保持 3:1 对比度。
  const cursor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--neoverse-terminal-cursor)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(glyph).toHaveCSS("background-color", cursor);
  // The slide is real motion, so it waits for a motion-tolerant preference.
  // 位移属于真实运动，只在允许动态效果时才启用。
  await expect(glyph).toHaveCSS("transition-property", "none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(glyph).toHaveCSS("animation-name", "ui-caret-breathe");
  await expect(glyph).toHaveCSS("transition-property", "transform, width");
  const glide = await glyph.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(glide).toBeGreaterThan(0);

  // A travelling bar stays solid; the blink resumes once it settles.
  // 滑动中的竖条保持常亮，落位后恢复闪烁。
  const travelling = await page.evaluate(async () => {
    const field = document.querySelector<HTMLInputElement>("#xca-command-input");
    const bar = document.querySelector<HTMLElement>(".ui-terminal-prompt__caret-glyph");
    if (!field || !bar) throw new Error("caret targets are missing");
    field.setSelectionRange(4, 4);
    field.dispatchEvent(new Event("select", { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    return getComputedStyle(bar).animationName;
  });
  expect(travelling).toBe("none");

  // Editing moves the bar with the text instead of sliding behind it.
  // 编辑时竖条随文本瞬时移动，不会滞后滑动。
  const editing = await page.evaluate(async () => {
    const field = document.querySelector<HTMLInputElement>("#xca-command-input");
    const bar = document.querySelector<HTMLElement>(".ui-terminal-prompt__caret-glyph");
    if (!field || !bar) throw new Error("caret targets are missing");
    field.setRangeText("x", 2, 2, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    return bar.getAnimations().filter((entry) => "transitionProperty" in entry).length;
  });
  expect(editing).toBe(0);

  // Typing holds the bar solid and the breath resumes after the pause.
  // 输入期间竖条保持常亮，停顿后恢复呼吸。
  await input.press("Backspace");
  await expect(caretLayer).toHaveClass(/caret--holding/u);
  await expect(glyph).toHaveCSS("animation-name", "none");
  await expect(caretLayer).not.toHaveClass(/caret--holding/u, { timeout: 5000 });

  await page.keyboard.press("Shift+ArrowLeft");
  await expect(prompt).toHaveAttribute("data-caret", "native");
  await expect(page.locator(".ui-terminal-prompt__caret")).toHaveCount(0);
  await expect(input).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
});

function compareTerminalStyles() {
  function createReference(actual: HTMLElement) {
    // The reference uses the same public component DOM, without portal-specific classes or styles.
    // 对照组使用相同的公开组件结构，但不包含门户自定义的类名和样式。
    const reference = actual.cloneNode(true) as HTMLElement;
    for (const node of [reference, ...reference.querySelectorAll<HTMLElement>("*")]) {
      for (const name of [...node.classList]) {
        if (name.startsWith("xca-")) node.classList.remove(name);
      }
      node.removeAttribute("style");
      node.removeAttribute("id");
    }
    reference.style.position = "absolute";
    reference.style.visibility = "hidden";
    reference.style.pointerEvents = "none";
    reference.setAttribute("aria-hidden", "true");
    const parent = actual.parentElement;
    if (!parent) throw new Error("The terminal must have a parent for the shared style reference");
    parent.append(reference);
    return reference;
  }
  function compareStyles(
    actual: HTMLElement,
    reference: HTMLElement,
    selector: string,
    properties: readonly string[],
    issues: string[],
  ) {
    const leftElement = selector ? actual.querySelector(selector) : actual;
    const rightElement = selector ? reference.querySelector(selector) : reference;
    if (!leftElement || !rightElement)
      throw new Error(`Shared terminal style comparison element is missing: ${selector}`);
    const left = getComputedStyle(leftElement);
    const right = getComputedStyle(rightElement);
    for (const property of properties) {
      if (left.getPropertyValue(property) !== right.getPropertyValue(property))
        issues.push(
          `${selector || "surface"} ${property}: ${left.getPropertyValue(property)} != ${right.getPropertyValue(property)}`,
        );
    }
  }
  const actual = document.querySelector<HTMLElement>(".xca-terminal-window");
  if (!actual) throw new Error("The terminal is required to compare shared styles");
  const reference = createReference(actual);
  try {
    const issues: string[] = [];
    const comparisons = [
      ["", ["border-radius", "background-color", "color", "font-family"]],
      [".ui-terminal-surface__header", ["padding", "gap"]],
      [".ui-terminal-surface__body", ["padding", "gap", "background-color"]],
      ["form .ui-terminal-prompt", ["font-family", "font-size", "line-height", "color"]],
      ["form .ui-terminal-prompt__segment", ["padding", "background-color", "color"]],
      [
        ".ui-terminal-prompt__editor",
        ["font-family", "font-size", "line-height", "color", "caret-color", "background-color"],
      ],
      // Recorded commands render through UiTerminalEcho with the same prompt chrome.
      // 已记录命令通过 UiTerminalEcho 渲染，并带相同提示符外框。
      [".ui-terminal-echo", ["font-family", "font-size", "line-height", "color"]],
      [".ui-terminal-echo .ui-terminal-prompt__segment", ["padding", "background-color", "color"]],
      [".ui-terminal-echo__text", ["font-family", "font-size", "line-height", "color"]],
      [
        ".ui-terminal-line[data-kind='status']",
        ["font-family", "font-size", "line-height", "color"],
      ],
    ] as const;
    for (const [selector, properties] of comparisons)
      compareStyles(actual, reference, selector, properties, issues);
    return issues;
  } finally {
    reference.remove();
  }
}
function compareTokenStyles() {
  // The portal window header may only deviate from the shared default through public tokens.
  // 门户窗口标题栏只能通过公开 token 偏离共享默认值，期望值随共享 token 解析，不硬编码结果。
  const root = document.querySelector<HTMLElement>(".xca-terminal-window");
  if (!root) throw new Error("The terminal is required to compare shared styles");
  const expectations = [
    [".ui-terminal-surface__header", "background-color", "--neoverse-terminal-header-background"],
    [".xca-terminal-chrome", "font-size", "--neoverse-typography-caption-size"],
    [".xca-terminal-chrome", "color", "--neoverse-color-text-secondary"],
    [".xca-terminal-chrome__session", "color", "--neoverse-color-text-primary"],
  ] as const;
  const issues: string[] = [];
  for (const [selector, property, token] of expectations) {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Shared style expectation element is missing: ${selector}`);
    const probe = root.appendChild(document.createElement("div"));
    probe.style.cssText = "position: absolute; visibility: hidden";
    probe.style.setProperty(property, `var(${token})`);
    const expected = getComputedStyle(probe).getPropertyValue(property);
    probe.remove();
    const value = getComputedStyle(element).getPropertyValue(property);
    if (value !== expected) issues.push(`${selector} ${property}: ${value} != var(${token})`);
  }
  return issues;
}
test("portal terminal chrome and text retain the unmodified shared styles in both themes and widths", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  await input.fill("echo shared-style");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("shared-style");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 608) await page.locator(".site-menu").getByRole("button").click();
    for (const theme of ["light", "dark"]) {
      await page.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const differences = [
        ...(await page.evaluate(compareTerminalStyles)),
        ...(await page.evaluate(compareTokenStyles)),
      ];
      expect(differences, `${theme}, ${width}px`).toEqual([]);
    }
  }
});

test("shared prompt preserves composition, native attributes and command error state", async ({
  page,
}) => {
  const input = page.getByRole("textbox", { name: "输入 XCA 命令" });
  await expect(input).toHaveAttribute("id", "xca-command-input");
  await expect(input).toHaveAttribute("enterkeyhint", "go");
  await input.fill("echo 中文输入");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  await expect(input).toHaveValue("echo 中文输入");
  await expect(page.locator(".xca-terminal-command")).toHaveCount(0);
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("中文输入");

  await input.fill("unknown-command");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("echo recovered");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("recovered");
  await expect(input).not.toHaveAttribute("aria-invalid");
});

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`recorded prompts preserve their snapshot, shared chrome and selectable text (${theme}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const menu = page.locator(".site-menu").getByRole("button");
      if (width <= 608) await menu.click();
      await page.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (width <= 608) await menu.click();
      const input = page.getByRole("textbox", { name: "输入 XCA 命令" });
      const live = page.locator(".xca-terminal-prompt");
      const echoes = page.locator(".xca-terminal-command");
      async function run(command: string) {
        await input.fill(command);
        await input.press("Enter");
        await expect(input).not.toHaveAttribute("readonly");
      }

      await run("cd /community");
      await expect(echoes.first().locator("[data-tone='host']")).toHaveText("guest@xca");
      await expect(echoes.first().locator("[data-tone='path']")).toHaveText("~");
      await expect(live.locator("[data-tone='path']")).toHaveText("/community");
      await run("echo selectable");
      const recorded = echoes.nth(1);
      await expect(recorded.locator("[data-tone='host']")).toHaveText("guest@xca");
      await expect(recorded.locator("[data-tone='path']")).toHaveText("/community");
      await expect(recorded.locator(".ui-terminal-echo__text")).toHaveText("echo selectable");
      expect(
        await page.evaluate(() => {
          const recorded = document.querySelectorAll(".xca-terminal-command")[1];
          const live = document.querySelector(".xca-terminal-prompt");
          if (!recorded || !live) throw new Error("Recorded and live prompts are required");
          const selectors = [
            ".ui-terminal-prompt__segment[data-tone='host']",
            ".ui-terminal-prompt__segment[data-tone='path']",
            ".ui-terminal-prompt__symbol",
          ];
          const properties = [
            "font-family",
            "font-size",
            "line-height",
            "color",
            "background-color",
            "padding",
            "border-radius",
            "clip-path",
          ];
          return selectors.flatMap((selector) => {
            const left = recorded.querySelector(selector);
            const right = live.querySelector(selector);
            if (!left || !right) throw new Error(`Prompt chrome is missing: ${selector}`);
            const recordedStyle = getComputedStyle(left);
            const liveStyle = getComputedStyle(right);
            return properties
              .filter(
                (property) =>
                  recordedStyle.getPropertyValue(property) !== liveStyle.getPropertyValue(property),
              )
              .map((property) => `${selector}: ${property}`);
          });
        }),
      ).toEqual([]);
      await expect(page.locator(".xca-terminal-transcript").getByRole("textbox")).toHaveCount(1);
      await expect(
        echoes.locator(
          "input, textarea, button, a[href], [contenteditable]:not([contenteditable='false']), [tabindex]",
        ),
      ).toHaveCount(0);
      await input.focus();
      await input.press("Shift+Tab");
      await expect(input).not.toBeFocused();
      await expect(
        page.locator(".xca-terminal-window").getByRole("button", { name: "展开终端" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(input).toBeFocused();

      const text = recorded.locator(".ui-terminal-echo__text");
      const box = await text.boundingBox();
      if (!box) throw new Error("Recorded command text must be visible for selection");
      await page.mouse.move(box.x + 1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toContain("selectable");
      await expect(input).not.toBeFocused();

      await run("cd ~");
      await expect(live.locator("[data-tone='path']")).toHaveText("~");
      await expect(echoes.first().locator("[data-tone='path']")).toHaveText("~");
      await expect(recorded.locator("[data-tone='path']")).toHaveText("/community");
      const longText = "selectable-中文-".repeat(12);
      await run(`echo ${longText}`);
      await expect(page.locator(".xca-terminal-line").last()).toHaveText(longText);
      expect(await echoes.last().evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
    });
  }
}

for (const width of [1440, 390]) {
  test(`new submissions resume transcript following after reading history (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const input = page.locator("#xca-command-input");
    const transcript = page.locator(".xca-terminal-transcript");
    const bottomDistance = () =>
      transcript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    async function run(command: string) {
      await input.fill(command);
      await input.press("Enter");
      await expect(input).not.toHaveAttribute("readonly");
    }
    await run("help");
    await run("help");
    await expect
      .poll(() => transcript.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(3);
    await expect.poll(bottomDistance).toBeLessThanOrEqual(3);
    await transcript.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(bottomDistance).toBeGreaterThan(3);
    await run("echo reading-history");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText("reading-history");
    await expect.poll(bottomDistance).toBeLessThanOrEqual(3);
    await transcript.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new Event("scroll"));
    });
    await run("echo following-tail");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText("following-tail");
    await expect.poll(bottomDistance).toBeLessThanOrEqual(3);
  });
}
