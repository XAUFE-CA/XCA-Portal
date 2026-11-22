import { expect, test } from "bun:test";
import type { AuthClient } from "../../auth/client";
import { createTerminalAuth } from "../client-auth";
import { TerminalSession } from "../core/session";
import type { AuthGateway, TerminalServices } from "../core/types";
import { terminalCommands } from "./index";

function sessionWith(auth: AuthGateway): TerminalSession {
  const services: TerminalServices = {
    auth,
    getLocale: () => "en",
    navigate: () => undefined,
    getTheme: () => "system",
    setTheme: () => undefined,
    replayIntro: () => undefined,
  };
  const session = new TerminalSession(services);
  for (const command of terminalCommands) session.registry.register(command);
  return session;
}

const identity = { user: "member", label: "Member" };
const failure = { ok: false, code: "service_unavailable" } as const;

function client(): AuthClient {
  return {
    getSnapshot: () => ({ status: "guest", identity: null, needsReconciliation: false }),
    subscribe: () => () => undefined,
    start: () => () => undefined,
    getSession: async () => ({ ok: true, value: identity }),
    requestCode: async () => ({
      ok: true,
      value: { flow_id: "flow", expires_at: "2030-01-01T00:00:00Z" },
    }),
    verifyCode: async () => ({ ok: true, value: identity }),
    verifyPasskey: async () => ({ ok: false, code: "service_unavailable" }),
    coordinateSensitive: async <T>(task: () => Promise<T>) => ({
      ok: true,
      value: await task(),
    }),
    logout: async () => ({ ok: true, value: null }),
  };
}

async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function prompt(session: TerminalSession) {
  const interaction = session.interaction;
  if (interaction?.type !== "prompt") throw new Error("Expected prompt");
  return interaction;
}

function menu(session: TerminalSession) {
  const interaction = session.interaction;
  if (interaction?.type !== "menu") throw new Error("Expected menu");
  return interaction;
}

test("login keeps invitation and OTP out of transcript, history and completion", async () => {
  const api = client();
  let sentInvitation = "";
  let sentCode = "";
  api.requestCode = async (input) => {
    sentInvitation = input.invitation ?? "";
    return { ok: true, value: { flow_id: "flow", expires_at: "2030-01-01T00:00:00Z" } };
  };
  api.verifyCode = async (input) => {
    sentCode = input.code;
    return { ok: true, value: identity };
  };
  const session = sessionWith(createTerminalAuth(api));
  const work = session.execute("login");
  menu(session).select("invitation");
  await tick();
  prompt(session).submit("member@example.test");
  await tick();
  expect(prompt(session).kind).toBe("secret");
  prompt(session).submit("private-invitation");
  await tick();
  expect(prompt(session).kind).toBe("otp");
  prompt(session).submit("123456");
  await work;
  expect(sentInvitation).toBe("private-invitation");
  expect(sentCode).toBe("123456");
  expect(session.identity().user).toBe("member");
  const visible = JSON.stringify([session.entries, session.history]);
  expect(visible).not.toContain("private-invitation");
  expect(visible).not.toContain("123456");
  expect(visible).not.toContain("member@example.test");
  expect(session.complete("log")).not.toContain("login");
});

test("failed identity queries and logout preserve identity; confirmed guest clears it", async () => {
  const api = client();
  const session = sessionWith(createTerminalAuth(api));
  await session.execute("whoami");
  expect(session.identity().user).toBe("member");
  api.getSession = async () => failure;
  await session.execute("whoami");
  expect(session.identity().user).toBe("member");
  expect(JSON.stringify(session.entries)).toContain("Authentication service is unavailable");
  api.logout = async () => failure;
  await session.execute("logout");
  expect(session.identity().user).toBe("member");
  api.getSession = async () => ({ ok: true, value: null });
  await session.execute("whoami");
  expect(session.identity().user).toBe("guest");
});

test("verification errors stay public and a repeated login does not repeat the welcome", async () => {
  const api = client();
  api.verifyCode = async () => ({ ok: false, code: "invalid_or_expired_code" });
  const session = sessionWith(createTerminalAuth(api));
  async function login() {
    const work = session.execute("login");
    menu(session).select("existing");
    await tick();
    prompt(session).submit("member@example.test");
    await tick();
    prompt(session).submit("123456");
    await work;
  }
  await login();
  expect(session.identity().user).toBe("guest");
  expect(JSON.stringify(session.entries)).toContain("The code is invalid or expired.");
  api.verifyCode = async () => ({ ok: true, value: identity });
  await login();
  await login();
  expect(JSON.stringify(session.entries).match(/Welcome, Member/g)?.length).toBe(1);
  await session.execute("logout");
  expect(session.identity().user).toBe("guest");
});

test("a newer identity notification is not overwritten by an older query", async () => {
  const api = client();
  const pending = Promise.withResolvers<{ ok: true; value: typeof identity }>();
  api.getSession = () => pending.promise;
  const session = sessionWith(createTerminalAuth(api));
  const work = session.execute("whoami");
  session.syncIdentity({ user: "newer", label: "Newer" });
  pending.resolve({ ok: true, value: identity });
  await work;
  expect(session.identity().user).toBe("newer");
});

test("cancelling login prevents a late response from changing identity", async () => {
  const api = client();
  const pending = Promise.withResolvers<{ ok: true; value: typeof identity }>();
  api.verifyCode = () => pending.promise;
  const session = sessionWith(createTerminalAuth(api));
  const work = session.execute("login");
  menu(session).select("existing");
  await tick();
  prompt(session).submit("member@example.test");
  await tick();
  prompt(session).submit("123456");
  await tick();
  session.cancel();
  await work;
  pending.resolve({ ok: true, value: identity });
  await tick();
  expect(session.identity().user).toBe("guest");
  expect(JSON.stringify(session.entries)).not.toContain("Welcome, Member");
});

test("ordinary, login and OTP deadlines interrupt their respective work", async () => {
  const original = globalThis.setTimeout;
  const timers: { delay: number; fire: () => void }[] = [];
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    timers.push({ delay, fire: callback });
    return 0;
  }) as typeof setTimeout;
  try {
    const session = sessionWith(createTerminalAuth(client()));
    session.registry.register({
      name: "slow",
      summary: "",
      usage: "slow",
      execute: () => Promise.withResolvers<undefined>().promise,
    });
    const slow = session.execute("slow");
    expect(timers.at(-1)?.delay).toBe(30_000);
    timers.at(-1)?.fire();
    await slow;
    const login = session.execute("login");
    expect(timers.at(-1)?.delay).toBe(12 * 60_000);
    menu(session).select("existing");
    await tick();
    prompt(session).submit("member@example.test");
    await tick();
    expect(timers.at(-1)?.delay).toBe(8 * 60_000);
    timers.at(-1)?.fire();
    await login;
    expect(session.running).toBe(false);
    expect(session.interaction).toBeNull();
    const expiredLogin = session.execute("login");
    expect(timers.at(-1)?.delay).toBe(12 * 60_000);
    timers.at(-1)?.fire();
    await expiredLogin;
    expect(session.interaction).toBeNull();
  } finally {
    globalThis.setTimeout = original;
  }
});
