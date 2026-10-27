import { expect, test } from "bun:test";
import { terminalCommands } from "../features/terminal/commands";
import { TerminalSession } from "../features/terminal/core/session";
import { createTranslator, isSiteLocale, type SiteLocale } from "./index";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

test("catalogs contain identical keys and interpolation parameters", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  const parameters = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    expect(en[key].trim().length).toBeGreaterThan(0);
    expect(parameters(en[key])).toEqual(parameters(zh[key]));
  }
});

test("translation follows a changing locale and does not interpret interpolation values", () => {
  let locale: SiteLocale = "zh-CN";
  const t = createTranslator(() => locale);
  expect(t("nav.home")).toBe("首页");
  locale = "en";
  expect(t("nav.home")).toBe("Home");
  expect(t("error.notFound", { name: "<script>{unknown}</script>" })).toContain(
    "<script>{unknown}</script>",
  );
  expect(isSiteLocale("en")).toBe(true);
  expect(isSiteLocale("unsupported")).toBe(false);
});

test("terminal localizes help, errors and virtual content without resetting the session", async () => {
  let locale: SiteLocale = "zh-CN";
  const session = new TerminalSession({
    getLocale: () => locale,
    navigate: () => {},
    getTheme: () => "system",
    setTheme: () => {},
    replayIntro: () => {},
  });
  for (const command of terminalCommands) session.registry.register(command);
  session.resetWelcome();
  await session.execute("cd /community");
  session.draft = "echo unfinished";
  const originalEntries = [...session.entries];
  locale = "en";
  expect(session.entries).toEqual(originalEntries);
  expect(session.draft).toBe("echo unfinished");
  expect(session.workspace.cwd).toBe("/community");
  await session.execute("help");
  expect(
    session.entries
      .filter((entry) => entry.type === "line")
      .map((entry) => entry.text)
      .join("\n"),
  ).toContain("List available commands");
  await session.execute("unknown-command");
  expect(session.entries.at(-1)).toMatchObject({
    text: "unknown-command: command not found. Type help for available commands.",
  });
  await session.execute("cat /missing");
  expect(session.entries.at(-1)).toMatchObject({
    text: "Execution failed: /missing: no such virtual file or directory",
  });
  await session.execute("cat ~/README.md");
  expect(session.entries.at(-1)).toMatchObject({
    text: expect.stringContaining("read-only virtual workspace"),
  });
  await session.execute("xca open");
  expect(session.entries.at(-1)).toMatchObject({ text: expect.stringContaining("Usage:") });
  locale = "zh-CN";
  await session.execute("help clear");
  expect(session.entries.at(-1)).toMatchObject({ text: "清除终端输出" });
  expect(session.history).toContain("cd /community");
});
