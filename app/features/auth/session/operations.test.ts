import { expect, it } from "bun:test";
import { createAuthClient } from "./client";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}

it("blocks later writes until a durable cancel barrier succeeds across a client restart", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const first = createAuthClient({
    storage,
    fetch: async (url) => {
      if (url.endsWith("/verify")) throw new TypeError("lost response");
      return json({ identity: null });
    },
  });
  expect(await first.verifyCode({ flow_id: "flow", code: "012345" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  const pending = values.get("xca-auth-operation-v1");
  expect(pending).toMatch(/^[0-9a-f-]{36}$/);

  const barrier = deferred<Response>();
  const paths: string[] = [];
  const restored = createAuthClient({
    storage,
    fetch: async (path, init) => {
      paths.push(path);
      if (path.endsWith("/abandon")) {
        expect(JSON.parse(String(init?.body)).operation_id).toBe(pending);
        return barrier.promise;
      }
      if (path.endsWith("/session")) return json({ identity: null });
      if (path.endsWith("/logout")) return new Response(null, { status: 204 });
      throw new Error("Unexpected request");
    },
  });
  expect(restored.getSnapshot().needsReconciliation).toBe(true);
  const operation = restored.logout();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(paths).toEqual(["/api/v1/auth/operations/abandon"]);
  barrier.resolve(new Response(null, { status: 204 }));
  expect(await operation).toEqual({ ok: true, value: null });
  expect(paths).toEqual([
    "/api/v1/auth/operations/abandon",
    "/api/v1/auth/session",
    "/api/v1/auth/logout",
  ]);
  expect(values.has("xca-auth-operation-v1")).toBe(false);
  expect(restored.getSnapshot().needsReconciliation).toBe(false);
});

it("does not perform a newer write if the cancellation barrier fails", async () => {
  const storage = new Map<string, string>([
    ["xca-auth-operation-v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  ]);
  const calls: string[] = [];
  const client = createAuthClient({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    },
    fetch: async (path) => {
      calls.push(path);
      return json({ error: { code: "service_unavailable" } }, 503);
    },
  });
  expect(await client.verifyCode({ flow_id: "new", code: "123456" })).toEqual({
    ok: false,
    code: "service_unavailable",
  });
  expect(calls).toEqual(["/api/v1/auth/operations/abandon"]);
  expect(storage.has("xca-auth-operation-v1")).toBe(true);
});

it("serializes two browser tabs and fences an aborted earlier verification", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  let previous = Promise.resolve();
  const locks = {
    request: (_name: string, task: () => Promise<unknown>) => {
      const before = previous;
      const freed = deferred<void>();
      previous = freed.promise;
      return before.then(async () => {
        try {
          return await task();
        } finally {
          freed.resolve();
        }
      });
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { navigator: { locks }, localStorage: storage },
    configurable: true,
  });
  try {
    const dispatched = deferred<void>();
    const first = createAuthClient({
      fetch: async (url, init) => {
        if (url.endsWith("/verify")) {
          dispatched.resolve();
          return await new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        }
        return json({ identity: null });
      },
    });
    const controller = new AbortController();
    const earlier = first.verifyCode({ flow_id: "first", code: "012345" }, controller.signal);
    await dispatched.promise;
    const barrier = deferred<Response>();
    const arrived = deferred<void>();
    const calls: string[] = [];
    const second = createAuthClient({
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith("/abandon")) {
          arrived.resolve();
          return barrier.promise;
        }
        if (url.endsWith("/session")) return json({ identity: null });
        if (url.endsWith("/logout")) return new Response(null, { status: 204 });
        throw new Error("Unexpected URL");
      },
    });
    const later = second.logout();
    await Promise.resolve();
    expect(calls).toEqual([]);
    controller.abort();
    await expect(earlier).rejects.toMatchObject({ name: "AbortError" });
    await arrived.promise;
    expect(calls).toEqual(["/api/v1/auth/operations/abandon"]);
    barrier.resolve(new Response(null, { status: 204 }));
    expect(await later).toEqual({ ok: true, value: null });
    expect(calls).toEqual([
      "/api/v1/auth/operations/abandon",
      "/api/v1/auth/session",
      "/api/v1/auth/logout",
    ]);
    expect(values.has("xca-auth-operation-v1")).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
