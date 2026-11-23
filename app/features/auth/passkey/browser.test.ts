import { expect, it } from "bun:test";
import {
  assertionCredential,
  createPasskeyBrowser,
  decodeBase64URL,
  encodeBase64URL,
  type PasskeyBrowserSource,
  registrationCredential,
} from "./browser";

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function registrationOptions() {
  return {
    rp: { id: "localhost", name: "XCA Test" },
    user: { id: "dXNlci1oYW5kbGU", name: "member", displayName: "Member" },
    challenge: "Y2hhbGxlbmdl",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 120000,
    excludeCredentials: [{ type: "public-key", id: "b2xk", transports: ["internal"] }],
    authenticatorSelection: {
      requireResidentKey: true,
      residentKey: "required",
      userVerification: "required",
    },
    attestation: "none",
  };
}

function registrationCredentialJSON() {
  return {
    id: "Y3JlZGVudGlhbA",
    rawId: bytes("credential"),
    type: "public-key",
    authenticatorAttachment: null,
    response: {
      clientDataJSON: bytes("client"),
      attestationObject: bytes("attestation"),
      authenticatorData: bytes("auth"),
      publicKey: bytes("key"),
      publicKeyAlgorithm: -7,
      getTransports: () => ["internal", "hybrid"],
    },
    getClientExtensionResults: () => ({}),
  };
}

function assertionCredentialJSON() {
  return {
    id: "Y3JlZGVudGlhbA",
    rawId: bytes("credential"),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes("client"),
      authenticatorData: bytes("authenticator"),
      signature: bytes("signature"),
      userHandle: bytes("user-handle"),
    },
    getClientExtensionResults: () => ({}),
  };
}

it("encodes and decodes unpadded base64url without losing bytes", () => {
  const source = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = encodeBase64URL(source);
  expect(encoded).toBe("AAEC-vv8_f7_");
  expect([...new Uint8Array(decodeBase64URL(encoded))]).toEqual([...source]);
});

it("converts browser registration and assertion credentials to the HTTP contract", () => {
  expect(registrationCredential(registrationCredentialJSON())).toEqual({
    id: "Y3JlZGVudGlhbA",
    rawId: "Y3JlZGVudGlhbA",
    type: "public-key",
    authenticatorAttachment: null,
    clientExtensionResults: {},
    response: {
      clientDataJSON: "Y2xpZW50",
      attestationObject: "YXR0ZXN0YXRpb24",
      authenticatorData: "YXV0aA",
      publicKey: "a2V5",
      publicKeyAlgorithm: -7,
      transports: ["internal", "hybrid"],
    },
  });
  expect(assertionCredential(assertionCredentialJSON())).toEqual({
    id: "Y3JlZGVudGlhbA",
    rawId: "Y3JlZGVudGlhbA",
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: "Y2xpZW50",
      authenticatorData: "YXV0aGVudGljYXRvcg",
      signature: "c2lnbmF0dXJl",
      userHandle: "dXNlci1oYW5kbGU",
    },
  });
});

it("passes JSON options through the standard parser when the browser provides it", async () => {
  let parsed: unknown;
  let sent: CredentialCreationOptions | undefined;
  const browser = createPasskeyBrowser({
    PublicKeyCredential: {
      parseCreationOptionsFromJSON: (options: unknown) => {
        parsed = options;
        return {
          challenge: bytes("parsed"),
          pubKeyCredParams: [],
        } as unknown as PublicKeyCredentialCreationOptions;
      },
    },
    navigator: {
      credentials: {
        create: async (options) => {
          sent = options;
          return registrationCredentialJSON() as unknown as Credential;
        },
        get: async () => null,
      },
    },
  } satisfies PasskeyBrowserSource);
  const result = await browser.create(registrationOptions());
  expect(result.ok).toBe(true);
  expect(parsed).toMatchObject({ challenge: "Y2hhbGxlbmdl", rp: { id: "localhost" } });
  expect(sent?.publicKey?.challenge).toEqual(bytes("parsed"));
});

it("converts legacy options when the JSON parser is absent", async () => {
  let creationSent: CredentialCreationOptions | undefined;
  let requestSent: CredentialRequestOptions | undefined;
  const browser = createPasskeyBrowser({
    PublicKeyCredential: {},
    navigator: {
      credentials: {
        create: async (options) => {
          creationSent = options;
          return registrationCredentialJSON() as unknown as Credential;
        },
        get: async (options) => {
          requestSent = options;
          return assertionCredentialJSON() as unknown as Credential;
        },
      },
    },
  } satisfies PasskeyBrowserSource);
  expect((await browser.create(registrationOptions())).ok).toBe(true);
  const publicKey = creationSent?.publicKey;
  expect([...new Uint8Array(publicKey?.challenge as ArrayBuffer)]).toEqual([
    ...new Uint8Array(decodeBase64URL("Y2hhbGxlbmdl")),
  ]);
  expect(publicKey?.user.id).toEqual(decodeBase64URL("dXNlci1oYW5kbGU"));
  expect(publicKey?.excludeCredentials?.[0]?.id).toEqual(decodeBase64URL("b2xk"));
  expect(publicKey?.authenticatorSelection?.residentKey).toBe("required");

  const request = await browser.get({
    challenge: "Y2hhbGxlbmdl",
    rpId: "localhost",
    userVerification: "required",
    timeout: 120000,
  });
  expect(request.ok).toBe(true);
  expect(requestSent?.publicKey?.challenge).toEqual(decodeBase64URL("Y2hhbGxlbmdl"));
  expect(requestSent?.publicKey?.userVerification).toBe("required");
});

it("preserves the browser cancellation and configuration distinctions", async () => {
  const browser = createPasskeyBrowser({
    PublicKeyCredential: {},
    navigator: {
      credentials: {
        create: async () => {
          throw new DOMException("user cancelled", "NotAllowedError");
        },
        get: async () => {
          throw new DOMException("origin mismatch", "SecurityError");
        },
      },
    },
  } satisfies PasskeyBrowserSource);
  expect(await browser.create(registrationOptions())).toEqual({ ok: false, code: "cancelled" });
  expect(await browser.get({ challenge: "Y2hhbGxlbmdl", rpId: "localhost" })).toEqual({
    ok: false,
    code: "security",
  });
  const unsupported = createPasskeyBrowser({});
  expect(unsupported.supported()).toBe(false);
  expect(await unsupported.get({ challenge: "Yw" })).toEqual({ ok: false, code: "unsupported" });
});

it("rejects mismatched IDs, unfiltered extension output and malformed responses", () => {
  const mismatch = { ...registrationCredentialJSON(), id: "b3RoZXI" };
  expect(() => registrationCredential(mismatch)).toThrow();
  const extension = {
    ...registrationCredentialJSON(),
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
  };
  expect(() => registrationCredential(extension)).toThrow();
  const missing = { ...assertionCredentialJSON(), response: { clientDataJSON: bytes("client") } };
  expect(() => assertionCredential(missing)).toThrow();
  expect(() => decodeBase64URL("not base64!")).toThrow();
});
