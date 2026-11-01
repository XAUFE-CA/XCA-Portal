import { expect, test } from "@playwright/test";

for (const profile of [
  { client: "macOS", legacy: "MacIntel", expected: "macos" },
  { client: "Windows", legacy: "Win32", expected: "windows" },
  { client: "Linux", legacy: "Linux x86_64", expected: "other" },
  { client: "iOS", legacy: "iPhone", expected: "macos" },
  { client: "iOS", legacy: "iPad", expected: "macos" },
  { client: "", legacy: "MacIntel", expected: "macos" },
]) {
  test(`${profile.client || "iPadOS desktop"} / ${profile.legacy} window chrome preserves terminal commands and expansion`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (profile.legacy === "iPhone") await page.setViewportSize({ width: 390, height: 844 });
    else if (profile.legacy === "iPad" || !profile.client)
      await page.setViewportSize({ width: 820, height: 1180 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((hints) => {
      sessionStorage.setItem("xca-intro-session", "1");
      Object.defineProperty(navigator, "userAgentData", {
        configurable: true,
        value: { platform: hints.client },
      });
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: hints.legacy,
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: hints.client === "iOS" || !hints.client ? 5 : 0,
      });
    }, profile);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const terminal = page.locator(".xca-terminal-window");
    const chrome = terminal.locator(".xca-terminal-chrome");
    const input = page.locator("#xca-command-input");
    await expect(chrome).toHaveAttribute("data-platform", profile.expected);
    await expect(chrome.locator(".xca-terminal-chrome__lights")).toHaveCount(
      profile.expected === "macos" ? 1 : 0,
    );
    await expect(chrome.getByRole("button")).toHaveCount(1);
    await input.fill("cd /community");
    await input.press("Enter");
    await expect(chrome.locator(".xca-terminal-chrome__directory")).toHaveText("/community");
    await input.fill("echo platform-output");
    await input.press("Enter");
    await expect(terminal.locator(".xca-terminal-line").last()).toHaveText("platform-output");
    await input.fill("preserved draft");
    const expand = chrome.getByRole("button", { name: "展开终端", exact: true });
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(terminal).toHaveClass(/xca-terminal-window--expanded/);
    await expect(chrome.getByRole("button", { name: "还原终端大小", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(terminal).not.toHaveClass(/xca-terminal-window--expanded/);
    await expect(input).toHaveValue("preserved draft");
    await expect(chrome).toHaveAttribute("data-platform", profile.expected);
    expect(errors).toEqual([]);
  });
}
