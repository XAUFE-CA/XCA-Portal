import { expect, it } from "bun:test";
import { type AuthClient, type AuthSnapshot, createAuthClient, getAuthClient } from "./client";

const identity = { user: "member", label: "Member" };
const accepted = {
  flow_id: "abcdefghijklmnopqrstuvwxyz012345",
  expires_at: "2030-01-01T00:10:00Z",
};

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers });
}

function nextResponse<T>(responses: T[]): T {
  const response = responses.shift();
  if (response === undefined) throw new Error("Unexpected authentication request");
  return response;
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function waitFor(client: AuthClient, predicate: (snapshot: AuthSnapshot) => boolean) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const unsubscribe = client.subscribe((snapshot) => {
    if (predicate(snapshot)) {
      unsubscribe();
      resolve();
    }
  });
  return promise;
}

it("uses the OpenAPI endpoints and only changes identity after verification or logout", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const responses = [
    json({ identity: null }),
    json(accepted, 202),
    json({ identity }),
    new Response(null, { status: 204 }),
  ];
  const client = createAuthClient({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return nextResponse(responses);
    },
  });
  expect(await client.getSession()).toEqual({ ok: true, value: null });
  expect(
    await client.requestCode({ email: "member@example.invalid", invitation: "secret" }),
  ).toEqual({ ok: true, value: accepted });
  expect(client.getSnapshot().status).toBe("guest");
  expect(await client.verifyCode({ flow_id: accepted.flow_id, code: "012345" })).toEqual({
    ok: true,
    value: identity,
  });
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: false,
  });
  expect(await client.logout()).toEqual({ ok: true, value: null });
  expect(client.getSnapshot().status).toBe("guest");
  expect(calls.map((call) => call.url)).toEqual([
    "/api/v1/auth/session",
    "/api/v1/auth/email/code",
    "/api/v1/auth/email/verify",
    "/api/v1/auth/logout",
  ]);
  expect(calls.every((call) => call.init.credentials === "same-origin")).toBe(true);
  expect(calls[3]?.init.body).toBe("{}");
  expect(new Headers(calls[1]?.init.headers).get("content-type")).toBe("application/json");
});

it("maps documented errors and retains identity on service failure", async () => {
  const responses = [
    json({ identity }),
    json({ error: { code: "invalid_request" } }, 403),
    json({ error: { code: "invalid_or_expired_code" } }, 400),
    json({ error: { code: "rate_limited" } }, 429, { "Retry-After": "12" }),
    json({ error: { code: "service_unavailable" } }, 503),
    json({ identity: null }),
  ];
  const client = createAuthClient({ fetch: async () => nextResponse(responses) });
  await client.getSession();
  expect(await client.requestCode({ email: "x" })).toEqual({
    ok: false,
    code: "invalid_request",
  });
  expect(await client.verifyCode({ flow_id: "x", code: "0" })).toEqual({
    ok: false,
    code: "invalid_or_expired_code",
  });
  expect(await client.requestCode({ email: "x" })).toEqual({
    ok: false,
    code: "rate_limited",
    retryAfterSeconds: 12,
  });
  expect(await client.getSession()).toEqual({ ok: false, code: "service_unavailable" });
  expect(client.getSnapshot()).toEqual({ status: "error", identity, needsReconciliation: false });
  expect(await client.getSession()).toEqual({ ok: true, value: null });
  expect(client.getSnapshot().status).toBe("guest");
});

it("accepts display names up to 128 Unicode code points", async () => {
  const label = String.fromCodePoint(0x20bb7).repeat(128);
  const responses = [
    json({ identity: { user: "member", label } }),
    json({ identity: { user: "member", label: `${label}x` } }),
  ];
  const client = createAuthClient({ fetch: async () => nextResponse(responses) });
  expect(await client.getSession()).toEqual({ ok: true, value: { user: "member", label } });
  expect(await client.getSession()).toEqual({ ok: false, code: "service_unavailable" });
});

it("rejects mismatched statuses and malformed successful bodies", async () => {
  const responses = [
    json(accepted, 200),
    json({ error: { code: "invalid_or_expired_code" } }, 429),
    json({ identity: { user: "member" } }),
    json({ identity: null }),
  ];
  const client = createAuthClient({ fetch: async () => nextResponse(responses) });
  expect(await client.requestCode({ email: "member@example.invalid" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  expect(await client.requestCode({ email: "member@example.invalid" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  const recovered = waitFor(client, (snapshot) => snapshot.status === "guest");
  expect(await client.verifyCode({ flow_id: "flow", code: "012345" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  await recovered;
  expect(client.getSnapshot()).toEqual({
    status: "guest",
    identity: null,
    needsReconciliation: true,
  });
});

it("does not return an invalidated session result to a consumer", async () => {
  const old = deferred<Response>();
  const current = deferred<Response>();
  const responses = [old.promise, current.promise];
  const client = createAuthClient({ fetch: async () => nextResponse(responses) });
  const obsolete = client.getSession();
  const active = client.getSession();
  old.resolve(json({ identity: null }));
  expect(await obsolete).toEqual({ ok: false, code: "service_unavailable" });
  current.resolve(json({ identity }));
  expect(await active).toEqual({ ok: true, value: identity });
});

it("does not let an older session response overwrite a successful verification", async () => {
  const old = deferred<Response>();
  const client = createAuthClient({
    fetch: async (url) => (String(url).endsWith("session") ? old.promise : json({ identity })),
  });
  const session = client.getSession();
  await client.verifyCode({ flow_id: "flow", code: "012345" });
  old.resolve(json({ identity: null }));
  await session;
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: false,
  });
});

it("reconciles an uncertain verification without replaying the code", async () => {
  const session = deferred<Response>();
  const paths: string[] = [];
  const client = createAuthClient({
    fetch: async (url) => {
      paths.push(String(url));
      if (String(url).endsWith("verify")) throw new TypeError("network");
      return session.promise;
    },
  });
  expect(await client.verifyCode({ flow_id: "flow", code: "012345" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  expect(client.getSnapshot().needsReconciliation).toBe(true);
  expect(paths).toEqual(["/api/v1/auth/email/verify", "/api/v1/auth/session"]);
  const confirmed = waitFor(client, (snapshot) => snapshot.status === "authenticated");
  session.resolve(json({ identity }));
  await confirmed;
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: true,
  });
});

it("reconciles cancellation after dispatch and never retries logout", async () => {
  const session = deferred<Response>();
  const dispatched = deferred<void>();
  const paths: string[] = [];
  const client = createAuthClient({
    fetch: async (url, init) => {
      paths.push(String(url));
      if (String(url).endsWith("logout")) {
        dispatched.resolve();
        const { promise, reject } = Promise.withResolvers<Response>();
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        return promise;
      }
      return session.promise;
    },
  });
  const controller = new AbortController();
  const operation = client.logout(controller.signal);
  await dispatched.promise;
  controller.abort();
  await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  expect(client.getSnapshot().needsReconciliation).toBe(true);
  expect(paths).toEqual(["/api/v1/auth/logout", "/api/v1/auth/session"]);
  const confirmed = waitFor(client, (snapshot) => snapshot.status === "guest");
  session.resolve(json({ identity: null }));
  await confirmed;
  expect(client.getSnapshot().status).toBe("guest");
});

it("treats timeouts as failures and preserves reconciliation when recovery fails", async () => {
  // Exercise the real timeout and its cleanup at the HTTP boundary.
  // 在 HTTP 边界验证真实超时及其清理。
  const client = createAuthClient({
    timeoutMs: 5,
    fetch: async () => Promise.withResolvers<Response>().promise,
  });
  const failed = waitFor(client, (snapshot) => snapshot.status === "error");
  expect(await client.logout()).toEqual({ ok: false, code: "service_unavailable" });
  expect(client.getSnapshot().needsReconciliation).toBe(true);
  await failed;
  expect(client.getSnapshot()).toEqual({
    status: "error",
    identity: null,
    needsReconciliation: true,
  });
});

it("aborts automatic session checks when the last consumer stops", () => {
  const pending = deferred<Response>();
  let signal: AbortSignal | undefined;
  const client = createAuthClient({
    fetch: async (_, init) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    },
  });
  const first = client.start();
  const second = client.start();
  expect(signal?.aborted).toBe(false);
  first();
  expect(signal?.aborted).toBe(false);
  second();
  expect(signal?.aborted).toBe(true);
});

it("rechecks invalidation and focus against the server, and releases lifecycle listeners", async () => {
  const focus = new EventTarget();
  const visibility = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const channel = Object.assign(new EventTarget(), {
    messages: [] as unknown[],
    closed: false,
    postMessage(value: unknown) {
      this.messages.push(value);
    },
    close() {
      this.closed = true;
    },
  });
  const invalidatedSession = deferred<Response>();
  const focusSession = deferred<Response>();
  const visibleSession = deferred<Response>();
  const responses = [
    json({ identity }),
    invalidatedSession.promise,
    focusSession.promise,
    visibleSession.promise,
    json({ identity }),
  ];
  let calls = 0;
  const client = createAuthClient({
    fetch: async () => {
      calls += 1;
      return nextResponse(responses);
    },
    window: focus as unknown as Window,
    document: visibility as unknown as Document,
    createChannel: () => channel as unknown as BroadcastChannel,
  });
  const started = waitFor(client, (snapshot) => snapshot.status === "authenticated");
  const stop = client.start();
  const stopSecond = client.start();
  await started;
  channel.dispatchEvent(new MessageEvent("message", { data: { identity: null } }));
  expect(calls).toBe(1);
  channel.dispatchEvent(
    new MessageEvent("message", { data: { type: "invalidate", uncertain: false } }),
  );
  expect(client.getSnapshot()).toEqual({
    status: "checking",
    identity,
    needsReconciliation: true,
  });
  const confirmed = waitFor(client, (snapshot) => snapshot.status === "guest");
  invalidatedSession.resolve(json({ identity: null }));
  await confirmed;
  focus.dispatchEvent(new Event("focus"));
  const restored = waitFor(client, (snapshot) => snapshot.status === "authenticated");
  focusSession.resolve(json({ identity }));
  await restored;
  visibility.visibilityState = "hidden";
  visibility.dispatchEvent(new Event("visibilitychange"));
  expect(calls).toBe(3);
  visibility.visibilityState = "visible";
  visibility.dispatchEvent(new Event("visibilitychange"));
  const visible = waitFor(client, (snapshot) => snapshot.status === "authenticated");
  visibleSession.resolve(json({ identity }));
  await visible;
  await client.verifyCode({ flow_id: "flow", code: "012345" });
  expect(channel.messages).toEqual([{ type: "invalidate", uncertain: false }]);
  stop();
  expect(channel.closed).toBe(false);
  stopSecond();
  stopSecond();
  expect(channel.closed).toBe(true);
  focus.dispatchEvent(new Event("focus"));
  visibility.dispatchEvent(new Event("visibilitychange"));
  expect(calls).toBe(5);
  expect(client.getSnapshot().identity).toEqual(identity);
});

it("propagates uncertain invalidation without sharing credentials and retains it after stop", async () => {
  const channel = Object.assign(new EventTarget(), {
    messages: [] as unknown[],
    postMessage(value: unknown) {
      this.messages.push(value);
    },
    close() {},
  });
  const cancelledRecovery = deferred<Response>();
  const resumedRecovery = deferred<Response>();
  let sessions = 0;
  const client = createAuthClient({
    createChannel: () => channel as unknown as BroadcastChannel,
    fetch: async (url) => {
      if (url.endsWith("verify")) throw new TypeError("network");
      sessions += 1;
      return sessions === 1
        ? json({ identity: null })
        : sessions === 2
          ? cancelledRecovery.promise
          : resumedRecovery.promise;
    },
  });
  const initial = waitFor(client, (snapshot) => snapshot.status === "guest");
  const stop = client.start();
  await initial;
  await client.verifyCode({ flow_id: "flow", code: "012345" });
  expect(channel.messages).toEqual([{ type: "invalidate", uncertain: true }]);
  stop();
  expect(client.getSnapshot().needsReconciliation).toBe(true);
  const confirmed = waitFor(client, (snapshot) => snapshot.status === "authenticated");
  const stopAgain = client.start();
  cancelledRecovery.resolve(json({ identity: null }));
  resumedRecovery.resolve(json({ identity }));
  await confirmed;
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: true,
  });
  stopAgain();

  const peerChannel = Object.assign(new EventTarget(), { close() {}, postMessage() {} });
  const peer = createAuthClient({
    createChannel: () => peerChannel as unknown as BroadcastChannel,
    fetch: async () => json({ identity: null }),
  });
  const peerInitial = waitFor(peer, (snapshot) => snapshot.status === "guest");
  const stopPeer = peer.start();
  await peerInitial;
  peerChannel.dispatchEvent(new MessageEvent("message", { data: channel.messages[0] }));
  const peerConfirmed = waitFor(
    peer,
    (snapshot) => snapshot.status === "guest" && snapshot.needsReconciliation,
  );
  await peerConfirmed;
  expect(peer.getSnapshot().needsReconciliation).toBe(true);
  stopPeer();
});

it("rejects overlapping identity writes before they reach the server", async () => {
  const verification = deferred<Response>();
  const paths: string[] = [];
  const client = createAuthClient({
    fetch: async (url) => {
      paths.push(url);
      return verification.promise;
    },
  });
  const writing = client.verifyCode({ flow_id: "flow", code: "012345" });
  expect(await client.logout()).toEqual({ ok: false, code: "service_unavailable" });
  expect(paths).toEqual(["/api/v1/auth/email/verify"]);
  verification.resolve(json({ identity }));
  await writing;
  expect(client.getSnapshot().identity).toEqual(identity);
});

it("retains uncertain state after a recovery and checks again before another operation", async () => {
  const paths: string[] = [];
  const responses = [
    json({ identity: null }),
    new Response(null, { status: 204 }),
    json({ identity }),
    json(accepted, 202),
  ];
  const client = createAuthClient({
    fetch: async (url) => {
      paths.push(url);
      if (url.endsWith("verify")) throw new TypeError("network");
      return nextResponse(responses);
    },
  });
  const recovered = waitFor(client, (snapshot) => snapshot.status === "guest");
  await client.verifyCode({ flow_id: "flow", code: "012345" });
  await recovered;
  expect(client.getSnapshot().needsReconciliation).toBe(true);
  expect(await client.requestCode({ email: "member@example.invalid" })).toEqual({
    ok: true,
    value: accepted,
  });
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: false,
  });
  expect(paths).toEqual([
    "/api/v1/auth/email/verify",
    "/api/v1/auth/session",
    "/api/v1/auth/operations/abandon",
    "/api/v1/auth/session",
    "/api/v1/auth/email/code",
  ]);
});

it("lets newer writes supersede overlapping session checks", async () => {
  const verification = deferred<Response>();
  const session = deferred<Response>();
  const client = createAuthClient({
    fetch: async (url) => (String(url).endsWith("verify") ? verification.promise : session.promise),
  });
  const writing = client.verifyCode({ flow_id: "flow", code: "012345" });
  const checking = client.getSession();
  verification.resolve(json({ identity }));
  await writing;
  session.resolve(json({ identity: null }));
  await checking;
  expect(client.getSnapshot()).toEqual({
    status: "authenticated",
    identity,
    needsReconciliation: false,
  });
});

it("does not send or reconcile a write canceled before dispatch", async () => {
  let calls = 0;
  const client = createAuthClient({
    fetch: async () => {
      calls += 1;
      throw new Error();
    },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.verifyCode({ flow_id: "flow", code: "012345" }, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
  expect(client.getSnapshot()).toEqual({
    status: "unknown",
    identity: null,
    needsReconciliation: false,
  });
});

it("does not share server-side state between client requests", () => {
  expect(getAuthClient()).not.toBe(getAuthClient());
});

it("reuses the application client in one browser tab", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  try {
    expect(getAuthClient()).toBe(getAuthClient());
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
