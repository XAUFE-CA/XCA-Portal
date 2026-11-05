import { expect, test } from "@playwright/test";
import { useBriefEntry } from "./entry";

test.beforeEach(async ({ page }) => {
  await useBriefEntry(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("ghost completion previews a suffix and accepts with Right without executing", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  const ghost = page.locator(".ui-terminal-prompt__ghost-suffix");
  await input.fill("cle");
  await expect(ghost).toHaveText("ar");
  await expect(input).toHaveValue("cle");
  await input.press("ArrowRight");
  await expect(input).toHaveValue("clear");
  await expect(ghost).toHaveCount(0);
  await expect(page.locator(".xca-terminal-command")).toHaveCount(0);
  await input.fill("xca background c");
  await expect(ghost).toHaveText("anvas");
  await input.press("ArrowLeft");
  await expect(ghost).toHaveCount(0);
  await input.press("ArrowRight");
  await expect(input).toHaveValue("xca background c");
  await expect(ghost).toHaveText("anvas");
  await input.press("Escape");
  await expect(ghost).toHaveCount(0);
  await input.press("ArrowRight");
  await expect(input).toHaveValue("xca background c");
  await input.fill("cd /c");
  await expect(ghost).toHaveText("ommunity/");
  await input.press("ArrowRight");
  await expect(input).toHaveValue("cd /community/");
});

test("history ghost completion hides during selection, composition and blur", async ({ page }) => {
  const input = page.locator("#xca-command-input");
  const ghost = page.locator(".ui-terminal-prompt__ghost-suffix");
  await input.fill("echo 中文 history");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("中文 history");
  await input.fill("echo ");
  await expect(ghost).toHaveText("中文 history");
  await input.press("ControlOrMeta+A");
  await expect(ghost).toHaveCount(0);
  await input.press("ArrowRight");
  await expect(input).toHaveValue("echo ");
  await expect(ghost).toHaveText("中文 history");
  await input.dispatchEvent("compositionstart");
  await expect(ghost).toHaveCount(0);
  await input.press("ArrowRight");
  await expect(input).toHaveValue("echo ");
  await input.dispatchEvent("compositionend");
  await expect(ghost).toHaveText("中文 history");
  await input.evaluate((node) => node.blur());
  await expect(ghost).toHaveCount(0);
  await input.focus();
  await expect(ghost).toHaveText("中文 history");
  await input.press("ArrowRight");
  await expect(input).toHaveValue("echo 中文 history");
  await input.fill("no-such-command");
  await expect(ghost).toHaveCount(0);
});

test("long history suggestions follow native horizontal scrolling in both themes", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  const prefix = `echo ${"x".repeat(200)}`;
  await input.fill(`${prefix} tail`);
  await input.press("Enter");
  await expect(input).not.toHaveAttribute("readonly");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      // Mobile theme controls sit in the collapsed menu; type via the public terminal command.
      // 移动端主题控件位于折叠菜单中，此处通过终端公开命令输入。
      await input.fill(`xca theme ${theme}`);
      await input.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await input.fill(prefix);
      await input.press("End");
      await expect(page.locator(".ui-terminal-prompt__ghost-suffix")).toHaveText(" tail");
      await expect.poll(() => input.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      await expect
        .poll(() =>
          input.evaluate((node) => {
            const parent = node.parentElement;
            if (!parent) throw new Error("Terminal input parent is missing");
            const layer = parent.querySelector<HTMLElement>(".ui-terminal-prompt__ghost > span");
            if (!layer) throw new Error("Terminal ghost layer is missing");
            return Math.abs(new DOMMatrix(getComputedStyle(layer).transform).m41 + node.scrollLeft);
          }),
        )
        .toBeLessThan(1);
      await input.press("ArrowRight");
      await expect(input).toHaveValue(`${prefix} tail`);
    }
  }
});

test("Tab cycles background presets but font switching is no longer registered", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  await input.fill("xca background");
  await input.press("Tab");
  await expect(input).toHaveValue("xca background ");
  await input.press("Tab");
  await expect(input).toHaveValue("xca background default ");
  const candidates = page.locator(".xca-terminal-line").filter({ hasText: /^default\s+canvas$/ });
  await expect(candidates).toHaveCount(1);
  for (const value of ["xca background canvas ", "xca background default "]) {
    await input.press("Tab");
    await expect(input).toHaveValue(value);
  }
  await expect(candidates).toHaveCount(1);
  await input.fill("font");
  await input.press("Tab");
  await expect(input).toHaveValue("font");
  await expect(input).toBeFocused();
});

test("Tab cycles command names and restarts after editing or Escape", async ({ page }) => {
  const input = page.locator("#xca-command-input");
  await input.fill("c");
  await input.press("Tab");
  await expect(input).toHaveValue("cat ");
  await input.press("Tab");
  await expect(input).toHaveValue("cd ");
  await input.fill("xca background c");
  await input.press("Tab");
  await expect(input).toHaveValue("xca background canvas ");
  await input.press("Escape");
  await expect(input).toHaveValue("xca background canvas ");
});

test("argument cycles execute the selected value and directory completion keeps its slash", async ({
  page,
}) => {
  const input = page.locator("#xca-command-input");
  await input.fill("xca theme ");
  for (const value of [
    "xca theme light ",
    "xca theme dark ",
    "xca theme system ",
    "xca theme light ",
  ]) {
    await input.press("Tab");
    await expect(input).toHaveValue(value);
  }
  await input.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await input.fill("xca background ");
  for (const value of [
    "xca background default ",
    "xca background canvas ",
    "xca background default ",
  ]) {
    await input.press("Tab");
    await expect(input).toHaveValue(value);
  }
  await input.fill("cd /c");
  await input.press("Tab");
  await expect(input).toHaveValue("cd /community/");
  await input.fill("cat /etc/o");
  await input.press("Tab");
  await expect(input).toHaveValue("cat /etc/os-release ");
});

test("a completed file is not repeated by the ghost or the next Tab", async ({ page }) => {
  const input = page.locator("#xca-command-input");
  const ghost = page.locator(".ui-terminal-prompt__ghost-suffix");
  await input.fill("cat R");
  await expect(ghost).toHaveText("EADME.md");
  await input.press("Tab");
  await expect(input).toHaveValue("cat README.md ");
  await expect(ghost).toHaveCount(0);
  await input.press("ArrowRight");
  await input.press("Tab");
  await expect(input).toHaveValue("cat README.md ");
  await expect(ghost).toHaveCount(0);
  await input.fill("cat ./README.md ");
  await expect(ghost).toHaveCount(0);
  await input.fill("cat README.md /etc/o");
  await expect(ghost).toHaveText("s-release");
  await input.press("ArrowRight");
  await expect(input).toHaveValue("cat README.md /etc/os-release");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toContainText(
    'NAME="XCA Browser Terminal"',
  );
});
