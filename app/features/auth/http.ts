import type { components } from "../../../backend/api/openapi.generated";

export type AuthIdentity = components["schemas"]["Identity"];
export type AuthErrorCode =
  | "invalid_request"
  | "invalid_or_expired_code"
  | "rate_limited"
  | "service_unavailable";
export type AuthFailure = { ok: false; code: AuthErrorCode; retryAfterSeconds?: number };
export type AuthResult<T> = { ok: true; value: T } | AuthFailure;
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpResponse = { response: Response; body: unknown } | null;

export async function send(
  fetcher: Fetcher,
  path: string,
  body: object | undefined,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
): Promise<HttpResponse> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const { promise: interrupted, reject } = Promise.withResolvers<never>();
  const cancel = () => {
    controller.abort();
    reject(new DOMException("Aborted", "AbortError"));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    reject(new Error("Request timed out"));
  }, timeoutMs);
  try {
    const request = async () => {
      const response = await fetcher(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json", ...extraHeaders },
              body: JSON.stringify(body),
            }),
      });
      const parsed: unknown = response.status === 204 ? null : await response.json();
      return { response, body: parsed };
    };
    return await Promise.race([request(), interrupted]);
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function identityFrom(value: unknown): AuthIdentity | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    typeof value.user !== "string" ||
    !value.user ||
    value.user.length > 128 ||
    typeof value.label !== "string" ||
    !value.label
  )
    return undefined;
  let codePoints = 0;
  for (const _character of value.label) {
    if (++codePoints > 128) return undefined;
  }
  return { user: value.user, label: value.label };
}

export function sessionFrom(value: unknown): AuthIdentity | null | undefined {
  return record(value) ? identityFrom(value.identity) : undefined;
}

export function acceptedFrom(
  value: unknown,
): components["schemas"]["EmailCodeAccepted"] | undefined {
  if (
    !record(value) ||
    typeof value.flow_id !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.flow_id) ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  )
    return undefined;
  return { flow_id: value.flow_id, expires_at: value.expires_at };
}

export function failure(
  result: HttpResponse,
  operation: "request" | "verify" | "session" | "logout",
): AuthFailure {
  if (!result || !record(result.body) || !record(result.body.error))
    return { ok: false, code: "service_unavailable" };
  const { status, headers } = result.response;
  const code = result.body.error.code;
  const invalidStatuses = operation === "session" ? [413] : [400, 403, 413, 415];
  if (invalidStatuses.includes(status) && code === "invalid_request") return { ok: false, code };
  if (operation === "verify" && status === 400 && code === "invalid_or_expired_code")
    return { ok: false, code };
  if (
    (operation === "request" || operation === "verify") &&
    status === 429 &&
    code === "rate_limited"
  ) {
    const header = headers.get("Retry-After");
    const seconds = header && /^[1-9]\d*$/.test(header) ? Number(header) : undefined;
    return seconds && Number.isSafeInteger(seconds)
      ? { ok: false, code, retryAfterSeconds: seconds }
      : { ok: false, code };
  }
  return { ok: false, code: "service_unavailable" };
}
