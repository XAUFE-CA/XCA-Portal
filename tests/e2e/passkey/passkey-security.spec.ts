import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  account,
  dbExec,
  dbScalar,
  installVirtualAuthenticator,
  logout,
  openQa,
  origin,
  otpLogin,
  passkeyLogin,
  registerPasskey,
  resetPasskeyState,
} from "./support";

const optionsPath = "/api/v1/auth/passkeys/authentication/options";
const verifyPath = "/api/v1/auth/passkeys/authentication/verify";

test.beforeEach(async ({ context }) => {
  resetPasskeyState();
  await installVirtualAuthenticator(context);
});

test("@live-passkey rejects invalid origin, malformed JSON and a closed browser", async ({
  browser,
  request,
}) => {
  const wrongOrigin = await request.post(optionsPath, {
    headers: { Origin: "https://untrusted.invalid" },
    data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  expect((await wrongOrigin.json()).error.code).toBe("invalid_request");

  const malformed = await request.post(optionsPath, {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: "{",
  });
  expect(malformed.status()).toBe(400);

  const closed = await browser.newContext({ baseURL: origin });
  try {
    await closed.addInitScript(() => {
      Object.defineProperty(globalThis, "PublicKeyCredential", {
        value: undefined,
        configurable: true,
      });
    });
    const closedPage = await closed.newPage();
    await closedPage.goto("/auth/passkey", { waitUntil: "domcontentloaded" });
    await expect(closedPage.locator(".passkey-qa")).toHaveAttribute(
      "data-web-authn",
      "unsupported",
    );
    await expect(closedPage.locator(".passkey-qa__unsupported")).toBeVisible();
    await expect(closedPage.getByTestId("qa-register")).toBeDisabled();
  } finally {
    await closed.close();
  }
});

test("@live-passkey limits anonymous challenge issuance per source", async ({ request }) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request.post(optionsPath, {
      headers: { Origin: origin },
      data: {},
    });
    expect(response.status()).toBe(200);
  }
  const limited = await request.post(optionsPath, { headers: { Origin: origin }, data: {} });
  expect(limited.status()).toBe(429);
  const seconds = Number(limited.headers()["retry-after"]);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(60);
});

test("@live-passkey rejects disabled accounts and expired or consumed challenges", async ({
  page,
  request,
  context,
}) => {
  const third = account("third");
  await openQa(page);
  await otpLogin(page, request, third, true);
  await registerPasskey(page);
  await logout(page);

  dbExec(`UPDATE users SET status = 'disabled' WHERE login_name = '${third.login}'`);
  await page.getByTestId("qa-login").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute(
    "data-code",
    "invalid_or_expired_authentication",
  );
  expect(dbScalar("SELECT count(*) FROM sessions WHERE otp_verified_at IS NULL")).toBe("0");
  dbExec(`UPDATE users SET status = 'active' WHERE login_name = '${third.login}'`);

  await page.route(`**${optionsPath}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const flow = Buffer.from(body.flow_id, "base64url").toString("hex");
    dbExec(
      `UPDATE passkey_challenges SET created_at = clock_timestamp() - interval '3 minutes',
       expires_at = clock_timestamp() - interval '1 minute' WHERE flow_id = decode('${flow}', 'hex')`,
    );
    await route.fulfill({ response, json: body });
  });
  await page.getByTestId("qa-login").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute(
    "data-code",
    "invalid_or_expired_authentication",
  );
  await page.unroute(`**${optionsPath}`);
  expect(dbScalar("SELECT count(*) FROM sessions WHERE otp_verified_at IS NULL")).toBe("0");

  let assertion = "";
  await page.route(`**${verifyPath}`, async (route) => {
    assertion = route.request().postData() ?? "";
    await route.continue();
  });
  await passkeyLogin(page);
  await page.unroute(`**${verifyPath}`);
  const replay = await page.request.post(verifyPath, {
    headers: { Origin: origin, "X-XCA-Auth-Operation": randomUUID() },
    data: JSON.parse(assertion),
  });
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error.code).toBe("invalid_or_expired_authentication");
  expect(await context.cookies()).not.toHaveLength(0);
});
