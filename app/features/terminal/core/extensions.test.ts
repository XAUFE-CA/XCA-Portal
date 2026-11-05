import { expect, test } from "bun:test";
import { registerVirtualFiles } from "../client-session";
import { terminalCommands } from "../commands";
import { TerminalSession } from "./session";
import type { TerminalServices } from "./types";

function makeSession(overrides: Partial<TerminalServices> = {}) {
  const session = new TerminalSession({
    navigate: () => {},
    getTheme: () => "system",
    setTheme: () => {},
    replayIntro: () => {},
    ...overrides,
  });
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  return session;
}
test("virtual Linux commands share cwd, registered files and argument completion", async () => {
  const session = makeSession();
  session.workspace.register({
    path: "/community/guide.txt",
    kind: "file",
    read: () => "fixture guide",
  });
  session.workspace.register({
    path: "/community/notes.txt",
    kind: "file",
    read: () => "fixture notes",
  });
  await session.execute("cd /community");
  expect(session.identity().directory).toBe("/community");
  expect(session.complete("cat g")).toEqual(["cat guide.txt"]);
  await session.execute("cat guide.txt notes.txt");
  expect(JSON.stringify(session.entries)).toContain("fixture guide");
  expect(JSON.stringify(session.entries)).toContain("fixture notes");
  await session.execute("cd ../../../../etc");
  expect(session.workspace.cwd).toBe("/etc");
  await session.execute("cat os-release");
  expect(JSON.stringify(session.entries)).toContain("XCA Browser Terminal");
  await session.execute("cd os-release");
  expect(session.status).toBe(1);
  expect(session.workspace.cwd).toBe("/etc");
  await session.execute("cd");
  expect(session.identity().directory).toBe("~");
});
test("terminal background is configurable while its font is fixed", async () => {
  const session = makeSession();
  expect(session.registry.resolve("font")).toBeUndefined();
  expect(session.appearanceRegistry.resolve(session.appearance)).toEqual({});
  expect(session.appearanceRegistry.resolve(session.appearance)).not.toHaveProperty(
    "--xca-terminal-font",
  );
  session.appearanceRegistry.registerBackground({
    id: "custom",
    label: "Custom",
    color: "var(--neoverse-color-surface-canvas)",
    image: "/brand/background.webp",
  });
  await session.execute("xca background custom");
  expect(session.appearanceRegistry.resolve(session.appearance)).toMatchObject({
    "--neoverse-terminal-background": "var(--neoverse-color-surface-canvas)",
    "--xca-terminal-background-image": 'url("/brand/background.webp")',
  });
  await session.execute("xca background default");
  expect(session.appearanceRegistry.resolve(session.appearance)).toEqual({});
  expect(() => session.setAppearance({ background: "missing" })).toThrow();
  expect(() =>
    session.appearanceRegistry.registerBackground({
      id: "bad",
      label: "Bad",
      color: "",
      image: "javascript:alert(1)",
    }),
  ).toThrow();
});
test("secure multi-step input is isolated from transcript, history and drafts", async () => {
  const session = makeSession({
    auth: {
      getSession: async () => null,
      login: async (ctx) => {
        const secret = await ctx.ask({ label: "验证码", kind: "otp" });
        expect(secret).toBe("private-otp");
        return { user: "member", label: "测试成员" };
      },
      logout: async () => {},
    },
  });
  const execution = session.execute("login");
  expect(session.interaction?.type).toBe("prompt");
  if (session.interaction?.type === "prompt") session.interaction.submit("private-otp");
  await execution;
  expect(session.identity().user).toBe("member");
  expect(JSON.stringify(session.entries)).not.toContain("private-otp");
  expect(session.history).toEqual([]);
  expect(session.draft).toBe("");
  await session.execute("logout");
  expect(session.identity().user).toBe("guest");
});
test("interactive cancellation immediately releases session and rejects late effects", async () => {
  const session = makeSession();
  const menu = session.execute("xca explore");
  expect(session.interaction?.type).toBe("menu");
  session.cancel();
  await menu;
  expect(session.running).toBe(false);
  expect(session.interaction).toBeNull();
  let resolve!: () => void;
  let late = false;
  session.registry.register({
    name: "slow-test",
    summary: "",
    usage: "",
    execute: async (_, ctx) => {
      await new Promise<void>((done) => {
        resolve = done;
      });
      try {
        ctx.setAppearance({ background: "canvas" });
      } catch {
        late = true;
      }
      ctx.write({ type: "line", tone: "normal", text: "late output" });
    },
  });
  const slow = session.execute("slow-test");
  session.cancel();
  await slow;
  await session.execute("echo next-command");
  resolve();
  await Promise.resolve();
  expect(late).toBe(true);
  expect(session.appearance.background).toBe("default");
  expect(JSON.stringify(session.entries)).not.toContain("late output");
  expect(JSON.stringify(session.entries)).toContain("next-command");
});
test("authentication provider errors cannot echo private input", async () => {
  const session = makeSession({
    auth: {
      getSession: async () => null,
      logout: async () => {},
      login: async (ctx) => {
        const secret = await ctx.ask({ label: "验证", kind: "secret" });
        throw new Error(`Rejected credential ${secret}`);
      },
    },
  });
  const login = session.execute("login");
  if (session.interaction?.type === "prompt") session.interaction.submit("private-secret");
  await login;
  expect(JSON.stringify(session.entries)).not.toContain("private-secret");
  expect(session.history).toEqual([]);
  expect(session.running).toBe(false);
});
test("TUI receives dimensions and keys, then returns to the preserved transcript", async () => {
  const session = makeSession();
  await session.execute("echo kept");
  const entries = [...session.entries];
  await session.execute("less /etc/os-release");
  expect(session.application).not.toBeNull();
  session.resize({ columns: 35, rows: 5 });
  expect(session.application?.lines.length).toBeLessThanOrEqual(2);
  session.application?.onKey("End");
  expect(session.application?.lines.join("\n")).toContain("XCA Browser/Linux");
  session.application?.onKey("q");
  expect(session.application).toBeNull();
  expect(session.entries.slice(0, entries.length)).toEqual(entries);
});
