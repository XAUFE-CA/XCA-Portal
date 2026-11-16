import type { components, operations } from "./openapi.generated";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

export type ContractAssertions = [
  Assert<
    Equal<components["schemas"]["Session"]["identity"], components["schemas"]["Identity"] | null>
  >,
  Assert<
    Equal<
      components["schemas"]["AuthenticatedSession"]["identity"],
      components["schemas"]["Identity"]
    >
  >,
  Assert<
    Equal<
      operations["requestEmailCode"]["responses"][202]["content"]["application/json"],
      components["schemas"]["EmailCodeAccepted"]
    >
  >,
  Assert<Equal<operations["logout"]["responses"][204]["content"], undefined>>,
  Assert<
    Equal<
      components["schemas"]["VerifyError"]["error"]["code"],
      "invalid_request" | "invalid_or_expired_code"
    >
  >,
  Assert<Equal<components["schemas"]["RateLimitedError"]["error"]["code"], "rate_limited">>,
  Assert<Equal<components["schemas"]["UnavailableError"]["error"]["code"], "service_unavailable">>,
];
