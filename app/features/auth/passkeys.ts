import type { components } from "../../../backend/api/openapi.generated";
import { type AuthClient, getAuthClient } from "./client";
import { type Fetcher, type HttpResponse, send } from "./http";
import {
  createPasskeyBrowser,
  type PasskeyBrowser,
  type PasskeyBrowserFailure,
  type PasskeyRegistrationCredential,
} from "./passkey";

export type PasskeyOptions = components["schemas"]["PasskeyOptions"];
export type PasskeyAuthenticationOptions = components["schemas"]["PasskeyAuthenticationOptions"];
export type PasskeySummary = components["schemas"]["PasskeySummary"];
export type PasskeyManagementErrorCode =
  | PasskeyBrowserFailure
  | "authentication_required"
  | "recent_otp_required"
  | "invalid_request"
  | "invalid_or_expired_code"
  | "invalid_or_expired_registration"
  | "invalid_or_expired_authentication"
  | "credential_exists"
  | "credential_not_found"
  | "operation_abandoned"
  | "rate_limited"
  | "service_unavailable";
export type PasskeyManagementResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PasskeyManagementErrorCode; retryAfterSeconds?: number };
export type PasskeyOperationOutcome = "" | "registration_revoked" | "revocation_committed";

const OPERATION_KEY = "xca-passkey-operation-v1";
const REGISTRATION_PATH = "/api/v1/auth/passkeys/registration/";
const AUTHENTICATION_PATH = "/api/v1/auth/passkeys/authentication/";
const MANAGEMENT_PATH = "/api/v1/auth/passkeys";

interface SensitiveAccess {
  coordinateSensitive<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ ok: true; value: T } | { ok: false; code: string; retryAfterSeconds?: number }>;
  verifyPasskey(
    input: components["schemas"]["PasskeyAuthenticationRequest"],
    signal?: AbortSignal,
  ): Promise<PasskeyManagementResult<components["schemas"]["Identity"]>>;
}

export interface PasskeyWorkflowOptions {
  fetch?: Fetcher;
  timeoutMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  auth?: AuthClient;
  browser?: PasskeyBrowser;
}

export type PasskeyCeremonyPhase = "options" | "browser" | "submit";
export type PasskeyPhaseListener = (phase: PasskeyCeremonyPhase) => void;

export interface PasskeyWorkflow {
  supported(): boolean;
  registrationOptions(signal?: AbortSignal): Promise<PasskeyManagementResult<PasskeyOptions>>;
  register(
    signal?: AbortSignal,
    onPhase?: PasskeyPhaseListener,
  ): Promise<PasskeyManagementResult<PasskeySummary>>;
  authenticationOptions(
    signal?: AbortSignal,
  ): Promise<PasskeyManagementResult<PasskeyAuthenticationOptions>>;
  login(
    signal?: AbortSignal,
    onPhase?: PasskeyPhaseListener,
  ): Promise<PasskeyManagementResult<components["schemas"]["Identity"]>>;
  list(signal?: AbortSignal): Promise<PasskeyManagementResult<PasskeySummary[]>>;
  revoke(id: string, signal?: AbortSignal): Promise<PasskeyManagementResult<null>>;
  settle(signal?: AbortSignal): Promise<PasskeyOperationOutcome | "failed">;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function managementFailure(
  result: HttpResponse,
  operation: "options" | "verify" | "list" | "revoke",
): PasskeyManagementResult<never> {
  if (!result) return { ok: false, code: "service_unavailable" };
  const code =
    record(result.body) && record(result.body.error) && typeof result.body.error.code === "string"
      ? result.body.error.code
      : undefined;
  const { status, headers } = result.response;
  const mapped = [
    "authentication_required",
    "recent_otp_required",
    "invalid_request",
    "invalid_or_expired_registration",
    "credential_exists",
    "credential_not_found",
    "operation_abandoned",
    "service_unavailable",
  ].includes(code ?? "")
    ? (code as PasskeyManagementErrorCode)
    : "service_unavailable";
  if (status === 429 && code === "rate_limited") {
    const header = headers.get("Retry-After");
    const seconds = header && /^[1-9]\d*$/.test(header) ? Number(header) : undefined;
    return Number.isSafeInteger(seconds)
      ? { ok: false, code, retryAfterSeconds: seconds }
      : { ok: false, code };
  }
  if (status === 404 && operation === "revoke") return { ok: false, code: "credential_not_found" };
  if (status >= 500) return { ok: false, code: "service_unavailable" };
  return { ok: false, code: mapped };
}

function summary(value: unknown): PasskeySummary | undefined {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.id) ||
    !(value.label === null || typeof value.label === "string") ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    !(
      value.last_used_at === null ||
      (typeof value.last_used_at === "string" && Number.isFinite(Date.parse(value.last_used_at)))
    ) ||
    typeof value.backup_eligible !== "boolean" ||
    typeof value.backup_state !== "boolean"
  )
    return undefined;
  return value as unknown as PasskeySummary;
}

function summaries(value: unknown): PasskeySummary[] | undefined {
  if (!record(value) || !Array.isArray(value.credentials)) return undefined;
  const items = value.credentials.map(summary);
  return items.every((item) => item !== undefined) ? (items as PasskeySummary[]) : undefined;
}

class BrowserPasskeyWorkflow implements PasskeyWorkflow {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly storage: PasskeyWorkflowOptions["storage"];
  private readonly auth: SensitiveAccess;
  private readonly browser: PasskeyBrowser;

  constructor(options: PasskeyWorkflowOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    try {
      this.storage =
        options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    } catch {
      this.storage = undefined;
    }
    this.auth = (options.auth ?? getAuthClient()) as SensitiveAccess;
    this.browser = options.browser ?? createPasskeyBrowser();
  }

  supported(): boolean {
    return this.browser.supported();
  }

  private persist(operation?: string): boolean {
    try {
      if (operation) this.storage?.setItem(OPERATION_KEY, operation);
      else this.storage?.removeItem(OPERATION_KEY);
      return this.storage !== undefined || typeof window === "undefined";
    } catch {
      return false;
    }
  }

  private operation(): string | undefined {
    try {
      const stored = this.storage?.getItem(OPERATION_KEY);
      return stored && /^[0-9a-f-]{36}$/.test(stored) ? stored : undefined;
    } catch {
      return undefined;
    }
  }

  // Management reconciliation runs under the existing identity write lock, never a second mutex.
  // 管理写入核对在既有身份写入锁内执行，不引入第二套互斥锁。
  private async sensitive<T>(
    task: () => Promise<PasskeyManagementResult<T>>,
    signal?: AbortSignal,
  ): Promise<PasskeyManagementResult<T>> {
    const coordinated = await this.auth.coordinateSensitive(task, signal);
    if (!coordinated.ok) {
      const code = coordinated.code as PasskeyManagementErrorCode;
      return { ok: false, code };
    }
    return coordinated.value;
  }

  async settle(signal?: AbortSignal): Promise<PasskeyOperationOutcome | "failed"> {
    const coordinated = await this.auth.coordinateSensitive(
      async () => this.settleLocked(signal),
      signal,
    );
    return coordinated.ok ? coordinated.value : "failed";
  }

  private async settleLocked(signal?: AbortSignal): Promise<PasskeyOperationOutcome | "failed"> {
    const operation = this.operation();
    if (!operation) return "";
    const result = await send(
      this.fetcher,
      "/api/v1/auth/operations/abandon",
      { operation_id: operation },
      signal,
      this.timeoutMs,
    );
    if (result?.response.status !== 204) return "failed";
    this.persist();
    const outcome = result.response.headers.get("X-XCA-Passkey-Operation-Outcome");
    return outcome === "registration_revoked" || outcome === "revocation_committed" ? outcome : "";
  }

  async registrationOptions(signal?: AbortSignal) {
    const response = await send(
      this.fetcher,
      `${REGISTRATION_PATH}options`,
      {},
      signal,
      this.timeoutMs,
    );
    if (response?.response.status !== 200 || !record(response.body))
      return managementFailure(response, "options");
    const options = response.body;
    if (
      typeof options.flow_id !== "string" ||
      !record(options.publicKey) ||
      typeof options.publicKey.challenge !== "string"
    )
      return { ok: false, code: "service_unavailable" } as const;
    return { ok: true, value: options as unknown as PasskeyOptions } as const;
  }

  async register(signal?: AbortSignal, onPhase?: PasskeyPhaseListener) {
    onPhase?.("options");
    const options = await this.registrationOptions(signal);
    if (!options.ok) return options;
    onPhase?.("browser");
    const credential = await this.browser.create(options.value.publicKey, signal);
    if (!credential.ok) return credential;
    onPhase?.("submit");
    return this.verifyRegistration(options.value.flow_id, credential.value, signal);
  }

  private async verifyRegistration(
    flowId: string,
    credential: PasskeyRegistrationCredential,
    signal?: AbortSignal,
  ) {
    return this.sensitive(async () => {
      const settled = await this.settleLocked(signal);
      if (settled === "failed") return { ok: false, code: "service_unavailable" } as const;
      const operation = crypto.randomUUID();
      if (!this.persist(operation)) return { ok: false, code: "service_unavailable" } as const;
      const response = await send(
        this.fetcher,
        `${REGISTRATION_PATH}verify`,
        { flow_id: flowId, credential },
        signal,
        this.timeoutMs,
        { "X-XCA-Auth-Operation": operation },
      );
      if (response?.response.status === 201) {
        const value = summary(response.body);
        if (value) {
          this.persist();
          return { ok: true, value } as const;
        }
        return { ok: false, code: "service_unavailable" } as const;
      }
      if (!response || response.response.status >= 500) {
        return { ok: false, code: "service_unavailable" } as const;
      }
      this.persist();
      return managementFailure(response, "verify");
    });
  }

  async authenticationOptions(signal?: AbortSignal) {
    const response = await send(
      this.fetcher,
      `${AUTHENTICATION_PATH}options`,
      {},
      signal,
      this.timeoutMs,
    );
    if (response?.response.status !== 200 || !record(response.body))
      return managementFailure(response, "options");
    const options = response.body;
    if (
      typeof options.flow_id !== "string" ||
      !record(options.publicKey) ||
      typeof options.publicKey.challenge !== "string"
    )
      return { ok: false, code: "service_unavailable" } as const;
    return { ok: true, value: options as unknown as PasskeyAuthenticationOptions } as const;
  }

  async login(signal?: AbortSignal, onPhase?: PasskeyPhaseListener) {
    onPhase?.("options");
    const options = await this.authenticationOptions(signal);
    if (!options.ok) return options;
    onPhase?.("browser");
    const assertion = await this.browser.get(options.value.publicKey, signal);
    if (!assertion.ok) return assertion;
    onPhase?.("submit");
    return this.auth.verifyPasskey(
      { flow_id: options.value.flow_id, credential: assertion.value },
      signal,
    );
  }

  async list(signal?: AbortSignal) {
    const response = await send(this.fetcher, MANAGEMENT_PATH, undefined, signal, this.timeoutMs);
    if (response?.response.status !== 200) return managementFailure(response, "list");
    const value = summaries(response.body);
    return value
      ? ({ ok: true, value } as const)
      : ({ ok: false, code: "service_unavailable" } as const);
  }

  async revoke(id: string, signal?: AbortSignal) {
    return this.sensitive(async () => {
      const settled = await this.settleLocked(signal);
      if (settled === "failed") return { ok: false, code: "service_unavailable" } as const;
      const operation = crypto.randomUUID();
      if (!this.persist(operation)) return { ok: false, code: "service_unavailable" } as const;
      const response = await send(
        this.fetcher,
        `${MANAGEMENT_PATH}/revoke`,
        { credential_id: id },
        signal,
        this.timeoutMs,
        { "X-XCA-Auth-Operation": operation },
      );
      if (response?.response.status === 204) {
        this.persist();
        return { ok: true, value: null } as const;
      }
      if (!response || response.response.status >= 500) {
        return { ok: false, code: "service_unavailable" } as const;
      }
      this.persist();
      return managementFailure(response, "revoke");
    });
  }
}

export function createPasskeyWorkflow(options: PasskeyWorkflowOptions = {}): PasskeyWorkflow {
  return new BrowserPasskeyWorkflow(options);
}

let browserWorkflow: PasskeyWorkflow | undefined;
export function getPasskeyWorkflow(): PasskeyWorkflow {
  if (!browserWorkflow) browserWorkflow = createPasskeyWorkflow();
  return browserWorkflow;
}
