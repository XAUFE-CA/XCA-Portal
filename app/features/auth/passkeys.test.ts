import { expect, it } from "bun:test";
import type { AuthClient } from "./client";
import type { PasskeyBrowser } from "./passkey";
import { createPasskeyWorkflow } from "./passkeys";

const summary = {
  id: "11111111-1111-4111-8111-111111111111",
  label: null,
  created_at: "2026-11-22T00:00:00Z",
  last_used_at: null,
  backup_eligible: true,
  backup_state: false,
};
const credential = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: {
    clientDataJSON: "Y2xpZW50",
    attestationObject: "YXR0ZXN0YXRpb24",
  },
};
const assertion = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: {
    clientDataJSON: "Y2xpZW50",
    authenticatorData: "YXV0aA",
    signature: "c2lnbmF0dXJl",
    userHandle: "dXNlci1oYW5kbGU",
  },
};

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers });
}

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    read: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
}

function auth(
  verifyPasskey: AuthClient["verifyPasskey"] = async () => ({
    ok: true,
    value: { user: "member", label: "Member" },
  }),
) {
  return {
    verifyPasskey,
    coordinateSensitive: async <T>(task: () => Promise<T>) => ({
      ok: true as const,
      value: await task(),
    }),
  } as unknown as AuthClient;
}

it("registers through browser creation and a fresh management operation", async () => {
  const calls: { url: string; body: unknown; operation?: string }[] = [];
  const store = storage();
  const browser: PasskeyBrowser = {
    supported: () => true,
    create: async () => ({ ok: true, value: credential }),
    get: async () => ({ ok: false, code: "cancelled" }),
  };
  const workflow = createPasskeyWorkflow({
    storage: store.read,
    browser,
    fetch: async (url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        operation: new Headers(init?.headers).get("x-xca-auth-operation") ?? undefined,
      });
      if (url.endsWith("/registration/options"))
        return json({ flow_id: "A".repeat(43), publicKey: { challenge: "Y2hhbGxlbmdl" } });
      if (url.endsWith("/registration/verify")) return json(summary, 201);
      throw new Error("Unexpected request");
    },
  });
  expect(await workflow.register()).toEqual({ ok: true, value: summary });
  expect(calls.map((call) => call.url)).toEqual([
    "/api/v1/auth/passkeys/registration/options",
    "/api/v1/auth/passkeys/registration/verify",
  ]);
  expect(calls[1]?.body).toEqual({ flow_id: "A".repeat(43), credential });
  expect(calls[1]?.operation).toMatch(/^[0-9a-f-]{36}$/);
  expect(store.values.size).toBe(0);
});

it("does not submit when the browser ceremony is cancelled", async () => {
  let submitted = false;
  const workflow = createPasskeyWorkflow({
    storage: storage().read,
    browser: {
      supported: () => true,
      create: async () => ({ ok: false, code: "cancelled" }),
      get: async () => ({ ok: false, code: "cancelled" }),
    },
    fetch: async (url) => {
      if (url.endsWith("/options"))
        return json({ flow_id: "A".repeat(43), publicKey: { challenge: "Y2hhbGxlbmdl" } });
      submitted = true;
      return json(summary, 201);
    },
  });
  expect(await workflow.register()).toEqual({ ok: false, code: "cancelled" });
  expect(submitted).toBe(false);
});

it("submits a discoverable assertion through AuthClient and maps login failures", async () => {
  const sends: unknown[] = [];
  const workflow = createPasskeyWorkflow({
    storage: storage().read,
    browser: {
      supported: () => true,
      create: async () => ({ ok: false, code: "unsupported" }),
      get: async () => ({ ok: true, value: assertion }),
    },
    fetch: async () => json({ flow_id: "A".repeat(43), publicKey: { challenge: "Y2hhbGxlbmdl" } }),
    auth: auth(async (input) => {
      sends.push(input);
      return { ok: false, code: "invalid_or_expired_authentication" };
    }),
  });
  expect(await workflow.login()).toEqual({ ok: false, code: "invalid_or_expired_authentication" });
  expect(sends).toEqual([{ flow_id: "A".repeat(43), credential: assertion }]);
});

it("retains a management operation after a lost response and reconciles it once", async () => {
  const store = storage();
  let verification = 0;
  const workflow = createPasskeyWorkflow({
    storage: store.read,
    browser: {
      supported: () => true,
      create: async () => ({ ok: true, value: credential }),
      get: async () => ({ ok: false, code: "cancelled" }),
    },
    fetch: async (url) => {
      if (url.endsWith("/registration/options"))
        return json({ flow_id: "A".repeat(43), publicKey: { challenge: "Y2hhbGxlbmdl" } });
      verification += 1;
      throw new TypeError("lost response");
    },
  });
  expect(await workflow.register()).toEqual({ ok: false, code: "service_unavailable" });
  expect(verification).toBe(1);
  expect(store.values.get("xca-passkey-operation-v1")).toMatch(/^[0-9a-f-]{36}$/);

  const settle = createPasskeyWorkflow({
    storage: store.read,
    fetch: async () =>
      new Response(null, {
        status: 204,
        headers: { "X-XCA-Passkey-Operation-Outcome": "registration_revoked" },
      }),
  });
  expect(await settle.settle()).toBe("registration_revoked");
  expect(store.values.size).toBe(0);
  expect(await settle.settle()).toBe("");
});

it("lists only contract-shaped credentials and reports recent OTP denial", async () => {
  const workflow = createPasskeyWorkflow({
    storage: storage().read,
    fetch: async (url) =>
      url.endsWith("/passkeys")
        ? json({ credentials: [summary] })
        : json({ error: { code: "recent_otp_required" } }, 403),
  });
  expect(await workflow.list()).toEqual({ ok: true, value: [summary] });
  expect(await workflow.revoke(summary.id)).toEqual({ ok: false, code: "recent_otp_required" });
  const missing = createPasskeyWorkflow({
    storage: storage().read,
    fetch: async () => json({ error: { code: "credential_not_found" } }, 404),
  });
  expect(await missing.revoke(summary.id)).toEqual({
    ok: false,
    code: "credential_not_found",
  });
});
