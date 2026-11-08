import { expect, type Locator, type Page, test } from "@playwright/test";
import { setThemePreference } from "./preferences";

async function expectTerminalScreenshot(terminal: Locator, name: string): Promise<void> {
  // The shared prompt draws its own caret; snapshots cover layout and material only.
  // 共享命令行自绘光标；截图只关注布局与材质，因此隐藏它。
  await terminal.page().addStyleTag({
    content: ".ui-terminal-prompt__caret { display: none !important; }",
  });
  await expect(terminal).toHaveScreenshot(name, { animations: "disabled", caret: "hide" });
}

function readTerminalColors(terminal: Locator) {
  return terminal.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, border: style.borderTopColor };
  });
}

async function setMobileTheme(page: Page, theme: "light" | "dark", label: string): Promise<void> {
  const toggle = page.locator(".site-menu").getByRole("button");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("radio", { name: label, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}

test("real terminal stays readable across themes and a narrow viewport", async function verifyTerminalThemes({
  page,
}) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await setThemePreference(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const terminal = page.locator(".xca-terminal-window");
  const transcript = page.locator(".xca-terminal-transcript");
  const input = page.locator("#xca-command-input");
  await expect(terminal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);
  await expect(input).not.toHaveAttribute("readonly", "");
  await page.evaluate(async () => {
    await document.fonts.load('400 14px "Maple Mono NF CN"', "计算机学社 Explore");
    await document.fonts.ready;
  });

  for (let index = 0; index < 16; index += 1) {
    const output = `visual-scroll-${index + 1}`;
    await input.fill(`echo ${output}`);
    await input.press("Enter");
    await expect(page.locator(".xca-terminal-line").last()).toHaveText(output);
  }
  await expect
    .poll(() =>
      transcript.evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
      ),
    )
    .toBeLessThan(4);
  await input.fill("cd /community");
  await input.press("Enter");
  await expect(
    page.locator(".xca-terminal-prompt .ui-terminal-prompt__segment[data-tone='path']"),
  ).toHaveText("/community");
  await input.fill("echo prompt-snapshot");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("prompt-snapshot");
  await input.fill("cd ~");
  await input.press("Enter");
  await expect(
    page.locator(".xca-terminal-prompt .ui-terminal-prompt__segment[data-tone='path']"),
  ).toHaveText("~");
  await expect(
    page.locator(".xca-terminal-command").last().locator("[data-tone='path']"),
  ).toHaveText("/community");

  await input.fill("echo 保留的输入草稿");
  await input.focus();
  await input.press("ArrowLeft");
  await expect(input).toHaveValue("echo 保留的输入草稿");
  await expect(input).toBeFocused();
  const draft = "echo 保留的输入草稿";
  const lightColors = await readTerminalColors(terminal);
  await expectTerminalScreenshot(terminal, "xca-terminal-desktop-light.png");

  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(input).toHaveValue(draft);
  const darkColors = await readTerminalColors(terminal);
  expect(darkColors.color).not.toBe(lightColors.color);
  await expectTerminalScreenshot(terminal, "xca-terminal-desktop-dark.png");

  await page.getByRole("radio", { name: "系统", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect.poll(async () => (await readTerminalColors(terminal)).color).toBe(darkColors.color);
  await expect(input).toHaveValue(draft);
  await expectTerminalScreenshot(terminal, "xca-terminal-desktop-system.png");

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect.poll(async () => (await readTerminalColors(terminal)).color).toBe(lightColors.color);
  await input.fill(draft);
  const bottomDistance = () =>
    transcript.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    );
  await expect.poll(bottomDistance).toBeLessThan(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".site-menu").getByRole("button")).toBeVisible();
  await expect.poll(bottomDistance).toBeLessThan(4);
  await input.fill("echo mobile-follow");
  await input.press("Enter");
  await expect(page.locator(".xca-terminal-line").last()).toHaveText("mobile-follow");
  await expect
    .poll(() =>
      transcript.evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
      ),
    )
    .toBeLessThan(4);
  await input.fill(draft);
  await input.focus();
  await expect(input).toHaveValue(draft);
  expect(await terminal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expectTerminalScreenshot(terminal, "xca-terminal-mobile-system-light.png");

  await setMobileTheme(page, "dark", "深色");
  await expect(input).toHaveValue(draft);
  await expectTerminalScreenshot(terminal, "xca-terminal-mobile-dark.png");
});
