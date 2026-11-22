import type { components } from "../../../backend/api/openapi.generated";
import {
  type AuthIdentity,
  type AuthResult,
  acceptedFrom,
  type Fetcher,
  failure,
  type HttpResponse,
  type PasskeyAuthResult,
  passkeyFailure,
  send,
  sessionFrom,
} from "./http";

export type { AuthIdentity, AuthResult, PasskeyAuthResult } from "./http";
export type AuthSnapshot = {
  status: "unknown" | "checking" | "guest" | "authenticated" | "error";
  identity: AuthIdentity | null;
  needsReconciliation: boolean;
};

export interface AuthClient {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: (snapshot: AuthSnapshot) => void): () => void;
  start(): () => void;
  getSession(signal?: AbortSignal): Promise<AuthResult<AuthIdentity | null>>;
  requestCode(
    input: components["schemas"]["EmailCodeRequest"],
    signal?: AbortSignal,
  ): Promise<AuthResult<components["schemas"]["EmailCodeAccepted"]>>;
  verifyCode(
    input: components["schemas"]["EmailVerifyRequest"],
    signal?: AbortSignal,
  ): Promise<AuthResult<AuthIdentity>>;
  verifyPasskey(
    input: components["schemas"]["PasskeyAuthenticationRequest"],
    signal?: AbortSignal,
  ): Promise<PasskeyAuthResult<AuthIdentity>>;
  coordinateSensitive<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<AuthResult<T>>;
  logout(signal?: AbortSignal): Promise<AuthResult<null>>;
}

export interface AuthClientOptions {
  fetch?: Fetcher;
  timeoutMs?: number;
  window?: Pick<Window, "addEventListener" | "removeEventListener">;
  document?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  createChannel?: () => BroadcastChannel;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

class BrowserAuthClient implements AuthClient {
  private snapshot: AuthSnapshot = {
    status: "unknown",
    identity: null,
    needsReconciliation: false,
  };
  private readonly listeners = new Set<(snapshot: AuthSnapshot) => void>();
  private version = 0;
  private pendingWrite = false;
  // An interrupted write may commit after any single session query.
  // 中断的写入可能在任意一次会话查询后提交。
  private uncertainWrite = false;
  private uncertainOperationId: string | undefined;
  private readonly storage: AuthClientOptions["storage"];
  private users = 0;
  private lifecycle: AbortController | undefined;
  private suspended = false;
  private channel: BroadcastChannel | undefined;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly browserWindow: AuthClientOptions["window"];
  private readonly browserDocument: AuthClientOptions["document"];
  private readonly createChannel: (() => BroadcastChannel) | undefined;

  constructor(options: AuthClientOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.browserWindow = options.window ?? (typeof window === "undefined" ? undefined : window);
    this.browserDocument =
      options.document ?? (typeof document === "undefined" ? undefined : document);
    // Only a cancellation correlation ID is shared across tabs, never session credentials.
    // 跨标签仅共享取消操作 ID，不存放任何认证凭证。
    try {
      this.storage =
        options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    } catch {
      this.storage = undefined;
    }
    try {
      const pending = this.storage?.getItem("xca-auth-operation-v1");
      if (pending && /^[0-9a-f-]{36}$/.test(pending)) {
        this.uncertainOperationId = pending;
        this.uncertainWrite = true;
        this.snapshot.needsReconciliation = true;
      }
    } catch {
      // Storage is optional; the in-memory barrier still protects the active tab.
    }
    this.createChannel =
      options.createChannel ??
      (this.browserWindow && typeof BroadcastChannel !== "undefined"
        ? () => new BroadcastChannel("xca-auth")
        : undefined);
  }

  getSnapshot(): AuthSnapshot {
    return { ...this.snapshot, identity: this.snapshot.identity && { ...this.snapshot.identity } };
  }

  subscribe(listener: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<AuthSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }

  private refresh = (): void => {
    if (this.suspended) return;
    void this.getSession(this.lifecycle?.signal).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
  };
  private visible = (): void => {
    if (this.browserDocument?.visibilityState === "visible") this.refresh();
  };
  private invalidated = (event: MessageEvent): void => {
    if (typeof event.data !== "object" || event.data === null || event.data.type !== "invalidate")
      return;
    if (event.data.uncertain === true) this.uncertainWrite = true;
    this.update({ needsReconciliation: true });
    this.refresh();
  };

  start(): () => void {
    this.users += 1;
    if (this.users === 1) {
      this.suspended = false;
      this.lifecycle = new AbortController();
      this.browserWindow?.addEventListener("focus", this.refresh);
      this.browserDocument?.addEventListener("visibilitychange", this.visible);
      try {
        this.channel = this.createChannel?.();
        this.channel?.addEventListener("message", this.invalidated);
      } catch {
        this.channel = undefined;
      }
      this.refresh();
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.users -= 1;
      if (this.users === 0) {
        this.suspended = true;
        this.lifecycle?.abort();
        this.lifecycle = undefined;
        this.browserWindow?.removeEventListener("focus", this.refresh);
        this.browserDocument?.removeEventListener("visibilitychange", this.visible);
        this.channel?.removeEventListener("message", this.invalidated);
        this.channel?.close();
        this.channel = undefined;
      }
    };
  }

  private notify(uncertain: boolean): void {
    try {
      this.channel?.postMessage({ type: "invalidate", uncertain });
    } catch {
      return;
    }
  }

  async getSession(signal?: AbortSignal): Promise<AuthResult<AuthIdentity | null>> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const version = ++this.version;
    const previousStatus = this.snapshot.status;
    this.update({ status: "checking" });
    let response: HttpResponse;
    try {
      response = await send(
        this.fetcher,
        "/api/v1/auth/session",
        undefined,
        signal,
        this.timeoutMs,
      );
    } catch (error) {
      if (version === this.version)
        this.update({ status: previousStatus === "checking" ? "unknown" : previousStatus });
      throw error;
    }
    if (version !== this.version || this.pendingWrite)
      return { ok: false, code: "service_unavailable" };
    const identity = response?.response.status === 200 ? sessionFrom(response.body) : undefined;
    if (identity !== undefined) {
      this.update({
        status: identity ? "authenticated" : "guest",
        identity,
        needsReconciliation: this.uncertainWrite,
      });
      return { ok: true, value: identity };
    }
    this.update({ status: "error" });
    return failure(response, "session");
  }

  async requestCode(
    input: components["schemas"]["EmailCodeRequest"],
    signal?: AbortSignal,
  ): Promise<AuthResult<components["schemas"]["EmailCodeAccepted"]>> {
    if (this.snapshot.needsReconciliation) {
      const result = await this.settlePreviousWrite(signal);
      if (!result.ok) return result;
    }
    const response = await send(
      this.fetcher,
      "/api/v1/auth/email/code",
      input,
      signal,
      this.timeoutMs,
    );
    const accepted = response?.response.status === 202 ? acceptedFrom(response.body) : undefined;
    return accepted ? { ok: true, value: accepted } : failure(response, "request");
  }

  private async settlePreviousWrite(signal?: AbortSignal): Promise<AuthResult<null>> {
    if (this.pendingWrite) return { ok: false, code: "service_unavailable" };
    let stored: string | null = null;
    try {
      stored = this.storage?.getItem("xca-auth-operation-v1") ?? null;
    } catch {
      return { ok: false, code: "service_unavailable" };
    }
    const operation = this.uncertainOperationId ?? stored;
    if (operation) {
      const barrier = await send(
        this.fetcher,
        "/api/v1/auth/operations/abandon",
        { operation_id: operation },
        signal,
        this.timeoutMs,
      );
      if (barrier?.response.status !== 204) {
        return { ok: false, code: "service_unavailable" };
      }
      this.uncertainOperationId = undefined;
      this.uncertainWrite = false;
      this.persistOperation();
    }
    if (this.snapshot.needsReconciliation) {
      const result = await this.getSession(signal);
      if (!result.ok) return result;
    }
    return { ok: true, value: null };
  }

  private persistOperation(id?: string): boolean {
    try {
      if (id) this.storage?.setItem("xca-auth-operation-v1", id);
      else this.storage?.removeItem("xca-auth-operation-v1");
      return this.storage !== undefined || typeof window === "undefined";
    } catch {
      return false;
    }
  }

  private beginWrite(signal?: AbortSignal): string | undefined {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.pendingWrite) return undefined;
    this.pendingWrite = true;
    this.version += 1;
    const operation = crypto.randomUUID();
    if (!this.persistOperation(operation)) {
      this.pendingWrite = false;
      return undefined;
    }
    return operation;
  }

  private finishWrite(uncertain: boolean, operation: string, value?: AuthIdentity | null): void {
    this.pendingWrite = false;
    this.version += 1;
    if (uncertain) {
      this.uncertainWrite = true;
      this.uncertainOperationId = operation;
      this.update({ needsReconciliation: true });
      this.notify(true);
    } else {
      this.uncertainOperationId = undefined;
      this.persistOperation();
    }
    if (!uncertain && value !== undefined) {
      this.update({ status: value ? "authenticated" : "guest", identity: value });
      this.notify(this.uncertainWrite);
    } else if (this.snapshot.status === "checking") {
      this.update({ status: this.snapshot.identity ? "authenticated" : "unknown" });
    }
    if (this.snapshot.needsReconciliation) this.refresh();
  }

  private async serializeWrite<T>(task: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
    if (typeof window === "undefined") return task();
    const locks = window.navigator?.locks;
    if (!locks) return { ok: false, code: "service_unavailable" };
    return locks.request("xca-auth-identity-write-v1", task);
  }

  private async serializeLocked<T extends { ok: boolean }>(
    task: () => Promise<T>,
    unavailable: T,
  ): Promise<T> {
    if (typeof window === "undefined") return task();
    const locks = window.navigator?.locks;
    if (!locks) return unavailable;
    return locks.request("xca-auth-identity-write-v1", task);
  }

  async verifyCode(
    input: components["schemas"]["EmailVerifyRequest"],
    signal?: AbortSignal,
  ): Promise<AuthResult<AuthIdentity>> {
    return this.serializeWrite(async () => {
      const result = await this.settlePreviousWrite(signal);
      if (!result.ok) return result;
      const operation = this.beginWrite(signal);
      if (!operation) return { ok: false, code: "service_unavailable" };
      try {
        const response = await send(
          this.fetcher,
          "/api/v1/auth/email/verify",
          input,
          signal,
          this.timeoutMs,
          { "X-XCA-Auth-Operation": operation },
        );
        const identity = response?.response.status === 200 ? sessionFrom(response.body) : undefined;
        if (identity) {
          this.finishWrite(false, operation, identity);
          return { ok: true, value: identity };
        }
        const result = failure(response, "verify");
        this.finishWrite(result.code === "service_unavailable", operation);
        return result;
      } catch (error) {
        this.finishWrite(true, operation);
        throw error;
      }
    });
  }

  async verifyPasskey(
    input: components["schemas"]["PasskeyAuthenticationRequest"],
    signal?: AbortSignal,
  ): Promise<PasskeyAuthResult<AuthIdentity>> {
    return this.serializeLocked(
      async () => {
        const result = await this.settlePreviousWrite(signal);
        if (!result.ok) return result;
        const operation = this.beginWrite(signal);
        if (!operation) return { ok: false, code: "service_unavailable" };
        try {
          const response = await send(
            this.fetcher,
            "/api/v1/auth/passkeys/authentication/verify",
            input,
            signal,
            this.timeoutMs,
            { "X-XCA-Auth-Operation": operation },
          );
          const identity =
            response?.response.status === 200 ? sessionFrom(response.body) : undefined;
          if (identity) {
            this.finishWrite(false, operation, identity);
            return { ok: true, value: identity };
          }
          const failure = passkeyFailure(response);
          this.finishWrite(response === null || failure.code === "service_unavailable", operation);
          return failure;
        } catch (error) {
          this.finishWrite(true, operation);
          throw error;
        }
      },
      { ok: false, code: "service_unavailable" },
    );
  }

  async coordinateSensitive<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<AuthResult<T>> {
    return this.serializeLocked(
      async () => {
        const result = await this.settlePreviousWrite(signal);
        if (!result.ok) return result;
        return { ok: true, value: await task() };
      },
      { ok: false, code: "service_unavailable" },
    );
  }

  async logout(signal?: AbortSignal): Promise<AuthResult<null>> {
    return this.serializeWrite(async () => {
      const result = await this.settlePreviousWrite(signal);
      if (!result.ok) return result;
      const operation = this.beginWrite(signal);
      if (!operation) return { ok: false, code: "service_unavailable" };
      try {
        const response = await send(
          this.fetcher,
          "/api/v1/auth/logout",
          {},
          signal,
          this.timeoutMs,
          { "X-XCA-Auth-Operation": operation },
        );
        if (response?.response.status === 204) {
          this.finishWrite(false, operation, null);
          return { ok: true, value: null };
        }
        const result = failure(response, "logout");
        this.finishWrite(result.code === "service_unavailable", operation);
        return result;
      } catch (error) {
        this.finishWrite(true, operation);
        throw error;
      }
    });
  }
}

export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  return new BrowserAuthClient(options);
}

let browserClient: AuthClient | undefined;
export function getAuthClient(): AuthClient {
  if (typeof window === "undefined") return createAuthClient();
  browserClient ??= createAuthClient();
  return browserClient;
}
