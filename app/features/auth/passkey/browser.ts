import type { components } from "../../../../backend/api/openapi.generated";

export type PasskeyRegistrationCredential =
  components["schemas"]["PasskeyRegistrationRequest"]["credential"];
export type PasskeyAssertionCredential =
  components["schemas"]["PasskeyAuthenticationRequest"]["credential"];
export type PasskeyBrowserFailure =
  | "unsupported"
  | "cancelled"
  | "invalid"
  | "security"
  | "network";
export type PasskeyBrowserResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: PasskeyBrowserFailure };

type RecordValue = Record<string, unknown>;
type Json = components["schemas"]["PasskeyOptions"]["publicKey"];
type RequestJson = components["schemas"]["PasskeyAuthenticationOptions"]["publicKey"];

interface PublicKeyCredentialStatics {
  parseCreationOptionsFromJSON?: (options: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (options: unknown) => PublicKeyCredentialRequestOptions;
}

interface CredentialContainer {
  create?: (options: CredentialCreationOptions) => Promise<Credential | null>;
  get?: (options?: CredentialRequestOptions) => Promise<Credential | null>;
}

export interface PasskeyBrowserSource {
  PublicKeyCredential?: unknown;
  navigator?: { credentials?: CredentialContainer };
}

export interface PasskeyBrowser {
  supported(): boolean;
  create(
    options: unknown,
    signal?: AbortSignal,
  ): Promise<PasskeyBrowserResult<PasskeyRegistrationCredential>>;
  get(
    options: unknown,
    signal?: AbortSignal,
  ): Promise<PasskeyBrowserResult<PasskeyAssertionCredential>>;
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function encodedBytes(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

export function decodeBase64URL(value: string): ArrayBuffer {
  if (!encodedBytes(value)) throw new Error("invalid base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function encodeBase64URL(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bufferBytes(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  return undefined;
}

function creationOptions(
  statics: PublicKeyCredentialStatics | undefined,
  value: unknown,
): PublicKeyCredentialCreationOptions {
  if (
    !record(value) ||
    !record(value.rp) ||
    !record(value.user) ||
    !Array.isArray(value.pubKeyCredParams)
  ) {
    throw new Error("invalid registration options");
  }
  const parameters: PublicKeyCredentialParameters[] = value.pubKeyCredParams.map((item) => {
    if (!record(item) || item.type !== "public-key" || typeof item.alg !== "number")
      throw new Error("invalid credential parameter");
    return { type: "public-key", alg: item.alg as COSEAlgorithmIdentifier };
  });
  const user = value.user;
  if (
    !encodedBytes(value.challenge) ||
    !encodedBytes(user.id) ||
    !text(user.name) ||
    !text(user.displayName)
  )
    throw new Error("invalid registration options");
  if (typeof statics?.parseCreationOptionsFromJSON === "function") {
    const parsed = statics.parseCreationOptionsFromJSON({
      ...value,
      challenge: value.challenge,
      user: { ...user, id: user.id as string },
      pubKeyCredParams: parameters,
    } as unknown as PublicKeyCredentialCreationOptionsJSON);
    if (parsed) return parsed;
  }
  return {
    rp: {
      id: typeof value.rp.id === "string" ? value.rp.id : undefined,
      name: String(value.rp.name),
    },
    user: {
      id: decodeBase64URL(user.id),
      name: user.name,
      displayName: user.displayName,
    },
    challenge: decodeBase64URL(value.challenge),
    pubKeyCredParams: parameters,
    ...(typeof value.timeout === "number" ? { timeout: value.timeout } : {}),
    ...(Array.isArray(value.excludeCredentials)
      ? {
          excludeCredentials: value.excludeCredentials.map((item) => {
            if (!record(item) || !encodedBytes(item.id)) throw new Error("invalid exclusion");
            return {
              type: "public-key" as PublicKeyCredentialType,
              id: decodeBase64URL(item.id),
              ...(Array.isArray(item.transports)
                ? {
                    transports: item.transports.filter(text) as AuthenticatorTransport[],
                  }
                : {}),
            };
          }),
        }
      : {}),
    ...(record(value.authenticatorSelection)
      ? { authenticatorSelection: value.authenticatorSelection as AuthenticatorSelectionCriteria }
      : {}),
    ...(value.attestation === "none"
      ? { attestation: "none" as AttestationConveyancePreference }
      : {}),
  };
}

function requestOptions(
  statics: PublicKeyCredentialStatics | undefined,
  value: unknown,
): PublicKeyCredentialRequestOptions {
  if (!record(value) || !encodedBytes(value.challenge))
    throw new Error("invalid authentication options");
  if (value.rpId !== undefined && !text(value.rpId))
    throw new Error("invalid authentication options");
  if (value.userVerification !== undefined && value.userVerification !== "required")
    throw new Error("unsupported user verification");
  if (typeof statics?.parseRequestOptionsFromJSON === "function") {
    const parsed = statics.parseRequestOptionsFromJSON(
      value as unknown as PublicKeyCredentialRequestOptionsJSON,
    );
    if (parsed) return parsed;
  }
  return {
    challenge: decodeBase64URL(value.challenge),
    ...(typeof value.rpId === "string" ? { rpId: value.rpId } : {}),
    ...(typeof value.timeout === "number" ? { timeout: value.timeout } : {}),
    ...(value.userVerification === "required"
      ? { userVerification: "required" as UserVerificationRequirement }
      : {}),
  };
}

function attachment(value: unknown): PasskeyRegistrationCredential["authenticatorAttachment"] {
  if (value === undefined || value === null || value === "platform" || value === "cross-platform")
    return value;
  throw new Error("unexpected authenticator attachment");
}

function extensions(value: unknown): Record<string, never> {
  if (record(value) && typeof value.getClientExtensionResults === "function") {
    value = (value.getClientExtensionResults as () => unknown)();
  }
  if (value === undefined) return {};
  if (!record(value) || Object.keys(value).length !== 0)
    throw new Error("unexpected extension output");
  return {};
}

export function registrationCredential(credential: unknown): PasskeyRegistrationCredential {
  if (!record(credential) || credential.type !== "public-key" || !encodedBytes(credential.id))
    throw new Error("invalid registration credential");
  const raw = bufferBytes(credential.rawId);
  if (!raw || encodeBase64URL(raw) !== credential.id) throw new Error("credential ID mismatch");
  if (!record(credential.response)) throw new Error("missing registration response");
  const response = credential.response;
  const clientData = bufferBytes(response.clientDataJSON);
  const attestation = bufferBytes(response.attestationObject);
  if (!clientData || !attestation) throw new Error("incomplete registration response");
  return {
    id: credential.id,
    rawId: credential.id,
    type: "public-key",
    ...(credential.authenticatorAttachment !== undefined
      ? { authenticatorAttachment: attachment(credential.authenticatorAttachment) }
      : {}),
    clientExtensionResults: extensions(credential),
    response: {
      clientDataJSON: encodeBase64URL(clientData),
      attestationObject: encodeBase64URL(attestation),
      ...(bufferBytes(response.authenticatorData)
        ? {
            authenticatorData: encodeBase64URL(
              bufferBytes(response.authenticatorData) as ArrayBuffer,
            ),
          }
        : {}),
      ...(bufferBytes(response.publicKey)
        ? { publicKey: encodeBase64URL(bufferBytes(response.publicKey) as ArrayBuffer) }
        : {}),
      ...(typeof response.publicKeyAlgorithm === "number"
        ? { publicKeyAlgorithm: response.publicKeyAlgorithm }
        : {}),
      ...(typeof response.getTransports === "function"
        ? { transports: (response.getTransports() as unknown[]).filter(text) }
        : {}),
    },
  };
}

export function assertionCredential(credential: unknown): PasskeyAssertionCredential {
  if (!record(credential) || credential.type !== "public-key" || !encodedBytes(credential.id))
    throw new Error("invalid assertion credential");
  const raw = bufferBytes(credential.rawId);
  if (!raw || encodeBase64URL(raw) !== credential.id) throw new Error("credential ID mismatch");
  if (!record(credential.response)) throw new Error("missing assertion response");
  const response = credential.response;
  const clientData = bufferBytes(response.clientDataJSON);
  const authenticatorData = bufferBytes(response.authenticatorData);
  const signature = bufferBytes(response.signature);
  if (!clientData || !authenticatorData || !signature)
    throw new Error("incomplete assertion response");
  const userHandle = bufferBytes(response.userHandle);
  return {
    id: credential.id,
    rawId: credential.id,
    type: "public-key",
    ...(credential.authenticatorAttachment !== undefined
      ? { authenticatorAttachment: attachment(credential.authenticatorAttachment) }
      : {}),
    clientExtensionResults: extensions(credential),
    response: {
      clientDataJSON: encodeBase64URL(clientData),
      authenticatorData: encodeBase64URL(authenticatorData),
      signature: encodeBase64URL(signature),
      ...(userHandle ? { userHandle: encodeBase64URL(userHandle) } : {}),
    },
  };
}

// Standard toJSON() already emits JSON, but legacy browsers need the same explicit conversion.
// 标准 toJSON() 已输出 JSON，旧浏览器需要相同的显式转换。
function registrationJSON(credential: PublicKeyCredential): PasskeyRegistrationCredential {
  if (typeof credential.toJSON === "function") {
    const value: unknown = credential.toJSON();
    if (!record(value) || !record(value.response))
      throw new Error("invalid registration serialization");
    if (Array.isArray(value.response.transports) && !value.response.transports.every(text))
      throw new Error("invalid transport list");
  }
  return registrationCredential(credential);
}

function assertionJSON(credential: PublicKeyCredential): PasskeyAssertionCredential {
  if (typeof credential.toJSON === "function") {
    const value: unknown = credential.toJSON();
    if (!record(value) || !record(value.response))
      throw new Error("invalid assertion serialization");
  }
  return assertionCredential(credential);
}

function failure(error: unknown): PasskeyBrowserResult<never> {
  if (error instanceof DOMException) {
    if (error.name === "AbortError" || error.name === "NotAllowedError")
      return { ok: false, code: "cancelled" };
    if (error.name === "SecurityError") return { ok: false, code: "security" };
    if (error.name === "NotSupportedError") return { ok: false, code: "unsupported" };
    if (error.name === "InvalidStateError") return { ok: false, code: "invalid" };
    return { ok: false, code: "invalid" };
  }
  if (error instanceof TypeError) return { ok: false, code: "unsupported" };
  return { ok: false, code: "invalid" };
}

export function createPasskeyBrowser(source: PasskeyBrowserSource = globalThis): PasskeyBrowser {
  const statics = source.PublicKeyCredential as PublicKeyCredentialStatics | undefined;
  const container = source.navigator?.credentials;
  const supported =
    (typeof statics === "object" || typeof statics === "function") &&
    statics !== null &&
    typeof container?.get === "function" &&
    typeof container.create === "function";
  return {
    supported: () => supported,
    async create(options, signal) {
      if (!supported || !container?.create) return { ok: false, code: "unsupported" };
      try {
        const publicKey = creationOptions(statics, options);
        const credential = await container.create({ publicKey, signal });
        if (!record(credential) || credential.type !== "public-key")
          return { ok: false, code: "invalid" };
        return { ok: true, value: registrationJSON(credential as unknown as PublicKeyCredential) };
      } catch (error) {
        return failure(error);
      }
    },
    async get(options, signal) {
      if (!supported || !container?.get) return { ok: false, code: "unsupported" };
      try {
        const publicKey = requestOptions(statics, options);
        const credential = await container.get({ publicKey, signal });
        if (!record(credential) || credential.type !== "public-key")
          return { ok: false, code: "invalid" };
        return { ok: true, value: assertionJSON(credential as unknown as PublicKeyCredential) };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function isPasskeyBrowserSupported(): boolean {
  return createPasskeyBrowser().supported();
}

export type {
  Json as PasskeyRegistrationOptionsJSON,
  RequestJson as PasskeyAuthenticationOptionsJSON,
};
