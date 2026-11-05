import { expect, test } from "bun:test";
import { registerVirtualFiles } from "../client-session";
import { terminalCommands } from "../commands";
import { parseCommandLine } from "./parser";
import { CommandRegistry } from "./registry";
import { TerminalSession } from "./session";
import type { TerminalServices } from "./types";

test("parse quoted arguments and Chinese text safely", () => {
  expect(parseCommandLine('echo "quoted argument"')).toEqual(["echo", "quoted argument"]);
  expect(parseCommandLine("echo 中文")).toEqual(["echo", "中文"]);
  expect(parseCommandLine("  ")).toEqual([]);
  expect(() => parseCommandLine("echo first && echo hello")).toThrow();
  expect(() => parseCommandLine('open "unfinished')).toThrow();
});
test("registry rejects collisions and completes aliases", () => {
  const registry = new CommandRegistry();
  registry.register({
    name: "hello",
    aliases: ["hi"],
    summary: "",
    usage: "hello",
    execute: () => [],
  });
  expect(registry.resolve("hi")?.name).toBe("hello");
  expect(registry.complete("h")).toEqual(["hello", "hi"]);
  expect(() =>
    registry.register({ name: "hi", summary: "", usage: "hi", execute: () => [] }),
  ).toThrow();
});
const makeServices = (): TerminalServices => ({
  navigate: () => undefined,
  getTheme: () => "system",
  setTheme: () => undefined,
  replayIntro: () => undefined,
});
test("ghost suggestions reuse candidates and prefer the newest matching history", async () => {
  const session = new TerminalSession(makeServices());
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  expect(session.suggest("")).toBe("");
  expect(session.suggest("   ")).toBe("");
  expect(session.suggest("cle")).toBe("clear");
  expect(session.suggest("xca background c")).toBe("xca background canvas");
  expect(session.suggest("cd /c")).toBe("cd /community/");
  expect(session.suggest("no-such-command")).toBe("");
  await session.execute("echo older");
  await session.execute("echo 中文 new");
  expect(session.suggest("echo ")).toBe("echo 中文 new");
  expect(session.suggest("echo o")).toBe("echo older");
  expect(session.suggest("echo 中文 new")).toBe("");
  const previousEntries = [...session.entries];
  const previousHistory = [...session.history];
  session.suggest("echo");
  expect(session.entries).toEqual(previousEntries);
  expect(session.history).toEqual(previousHistory);
  session.running = true;
  expect(session.suggest("echo")).toBe("");
});
test("registered commands execute with virtual files and safe errors", async () => {
  const session = new TerminalSession(makeServices());
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  session.resetWelcome();
  await session.execute("cat /etc/os-release");
  expect(JSON.stringify(session.entries)).toContain("XCA Browser Terminal");
  await session.execute("unknown-cmd");
  expect(session.entries.at(-1)).toMatchObject({ type: "line", tone: "error" });
  await session.execute("clear");
  expect(session.entries.length).toBe(0);
  await session.execute("xca banner");
  expect(session.entries.at(-1)?.type).toBe("banner");
  await session.execute("history");
  expect(JSON.stringify(session.entries)).toContain("cat /etc/os-release");
});
test("cancelled commands do not append stale async output", async () => {
  const session = new TerminalSession(makeServices());
  session.registry.register({
    name: "slow",
    summary: "",
    usage: "slow",
    execute: async (_args, _ctx, signal) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      if (signal.aborted) return [];
      return [{ type: "line", tone: "success", text: "finished" }];
    },
  });
  const work = session.execute("slow");
  session.cancel();
  await work;
  expect(JSON.stringify(session.entries)).not.toContain("finished");
  expect(session.running).toBe(false);
});

test("navigation rejects inherited properties, external paths and extra arguments", async () => {
  const navigated: string[] = [];
  const session = new TerminalSession({
    ...makeServices(),
    navigate: (path) => {
      navigated.push(path);
    },
  });
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  for (const target of [
    "toString",
    "constructor",
    "__proto__",
    "/",
    "https://example.com",
    "home extra",
  ]) {
    await session.execute(`xca open ${target}`);
    expect(session.status).toBe(1);
  }
  expect(navigated).toEqual([]);
  await session.execute("xca open home");
  expect(navigated).toEqual(["/"]);
});

test("xca intro resets the transcript before replay while preserving history and appearance", async () => {
  const services = makeServices();
  const session = new TerminalSession(services);
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  session.resetWelcome();
  const welcome = session.entries.map(({ id, ...entry }) => entry);
  await session.execute("echo earlier-output");
  session.setAppearance({ background: "canvas" });
  let replayed = false;
  let atReplay: unknown;
  services.replayIntro = () => {
    replayed = true;
    atReplay = session.entries.map(({ id, ...entry }) => entry);
  };
  await session.execute("XCA INTRO");
  expect(replayed).toBe(true);
  expect(atReplay).toEqual(welcome);
  expect(session.entries.map(({ id, ...entry }) => entry)).toEqual(welcome);
  expect(session.history).toEqual(["echo earlier-output", "XCA INTRO"]);
  expect(session.appearance).toEqual({ background: "canvas" });
});

test("completed path arguments do not suggest the same file again", () => {
  const session = new TerminalSession(makeServices());
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  expect(session.suggest("cat README.md")).toBe("");
  expect(session.complete("cat README.md ")).toEqual([]);
  expect(session.suggest("cat README.md ")).toBe("");
  expect(session.suggest("cat ./README.md ")).toBe("");
  expect(session.complete("cat README.md /c")).toEqual(["cat README.md /community/"]);
  expect(session.complete("cd /community/ ")).toEqual([]);
  expect(session.complete("cd /community/")).toEqual([]);
  expect(session.complete("less README.md ")).toEqual([]);
});

test("site commands use the xca namespace and nested help without side effects", async () => {
  let replayed = false;
  const session = new TerminalSession({
    ...makeServices(),
    replayIntro: () => {
      replayed = true;
    },
  });
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  for (const name of [
    "intro",
    "about",
    "departments",
    "teams",
    "open",
    "theme",
    "banner",
    "background",
    "explore",
  ]) {
    expect(session.registry.resolve(name)).toBeUndefined();
    expect(session.complete(name)).toEqual([]);
  }
  expect(session.complete("xca in")).toEqual(["xca intro"]);
  expect(session.complete("xca theme d")).toEqual(["xca theme dark"]);
  expect(session.complete("xca theme dark ")).toEqual([]);
  expect(session.complete("xca background canvas ")).toEqual([]);
  expect(session.complete("xca open home ")).toEqual([]);
  expect(session.complete("help xca in")).toEqual([]);
  expect(session.complete("xca help in")).toEqual(["xca help intro"]);
  expect(session.complete("man xca in")).toEqual(["man xca intro"]);
  for (const source of ["man xca intro", "xca help intro", "xca intro --help"]) {
    session.clear();
    await session.execute(source);
    expect(JSON.stringify(session.entries)).toContain("xca intro");
    expect(replayed).toBe(false);
  }
  session.clear();
  await session.execute("xca");
  expect(JSON.stringify(session.entries)).toContain("xca explore");
  await session.execute("xca unknown");
  expect(session.status).toBe(1);
});
