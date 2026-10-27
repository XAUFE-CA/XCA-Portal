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

function compareTerminalStyles() {
  function createReference(actual: HTMLElement) {
    // The reference uses the same public component DOM, without consumer classes/styles.
    // 参照实现使用相同的公开组件 DOM，但不含消费方类名与样式。
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
      [".ui-terminal-surface__header", ["padding", "gap", "background-color"]],
      [".ui-terminal-surface__body", ["padding", "gap", "background-color"]],
      [".ui-terminal-surface__title", ["font-family", "font-size", "color"]],
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
      const differences = await page.evaluate(compareTerminalStyles);
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
