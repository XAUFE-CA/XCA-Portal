import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  account,
  dbScalar,
  installVirtualAuthenticator,
  logout,
  openQa,
  origin,
  otpLogin,
  passkeyLogin,
  registerPasskey,
  resetPasskeyState,
  sessionCookie,
} from "./support";

const verifyPath = "/api/v1/auth/passkeys/authentication/verify";
const abandonPath = "/api/v1/auth/operations/abandon";

test.beforeEach(async ({ context }) => {
  resetPasskeyState();
  await installVirtualAuthenticator(context);
});

async function prepareCredential(
  page: Parameters<typeof otpLogin>[0],
  request: Parameters<typeof otpLogin>[1],
) {
  const member = account("primary");
  await openQa(page);
  await otpLogin(page, request, member, true);
  await registerPasskey(page);
  await logout(page);
  return member;
}

test("@live-passkey a committed verification with a lost response is revoked by the barrier", async ({
  page,
  request,
  context,
}) => {
  const member = await prepareCredential(page, request);
  let operation = "";
  let assertion = "";
  let forwarded = 0;
  await page.route(`**${verifyPath}`, async (route) => {
    const call = route.request();
    operation = call.headers()["x-xca-auth-operation"] ?? "";
    assertion = call.postData() ?? "";
    const response = await fetch(`${origin}${verifyPath}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-XCA-Auth-Operation": operation,
      },
      body: assertion,
    });
    forwarded = response.status;
    await route.abort("failed");
  });
  await page.getByTestId("qa-login").click();
  await expect.poll(() => forwarded).toBe(200);
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "service_unavailable");
  expect(await sessionCookie(context)).toBe("");
  expect(
    dbScalar(
      `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.login_name = '${member.login}' AND s.otp_verified_at IS NULL`,
    ),
  ).toBe("1");
  expect(
    dbScalar(
      `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.login_name = '${member.login}' AND s.revoked_at IS NULL AND s.otp_verified_at IS NULL`,
    ),
  ).toBe("1");

  const barrier = await page.request.post(abandonPath, {
    headers: { Origin: origin },
    data: { operation_id: operation },
  });
  expect(barrier.status()).toBe(204);
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
  expect(
    dbScalar(
      `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.login_name = '${member.login}' AND s.revoked_at IS NULL AND s.otp_verified_at IS NULL`,
    ),
  ).toBe("0");

  const replay = await page.request.post(verifyPath, {
    headers: { Origin: origin, "X-XCA-Auth-Operation": randomUUID() },
    data: JSON.parse(assertion),
  });
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error.code).toBe("invalid_or_expired_authentication");

  await page.unroute(`**${verifyPath}`);
  await passkeyLogin(page);
  expect(await sessionCookie(context)).not.toBe("");
});

test("@live-passkey a barrier before submission blocks a late assertion", async ({
  page,
  request,
  context,
}) => {
  await prepareCredential(page, request);
  let operation = "";
  let assertion = "";
  let reached = false;
  await page.route(`**${verifyPath}`, async (route) => {
    const call = route.request();
    operation = call.headers()["x-xca-auth-operation"] ?? "";
    assertion = call.postData() ?? "";
    reached = true;
    await route.abort("failed");
  });
  await page.getByTestId("qa-login").click();
  await expect.poll(() => reached).toBe(true);
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "service_unavailable");
  expect(await sessionCookie(context)).toBe("");
  expect(dbScalar("SELECT count(*) FROM sessions WHERE otp_verified_at IS NULL")).toBe("0");

  const barrier = await page.request.post(abandonPath, {
    headers: { Origin: origin },
    data: { operation_id: operation },
  });
  expect(barrier.status()).toBe(204);
  const late = await page.request.post(verifyPath, {
    headers: { Origin: origin, "X-XCA-Auth-Operation": operation },
    data: JSON.parse(assertion),
  });
  expect(late.status()).toBe(409);
  expect((await late.json()).error.code).toBe("operation_abandoned");
  expect(dbScalar("SELECT count(*) FROM sessions WHERE otp_verified_at IS NULL")).toBe("0");
  expect(
    dbScalar(
      `SELECT count(*) FROM passkey_challenges WHERE kind = 'authentication' AND consumed_at IS NOT NULL`,
    ),
  ).toBe("0");
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
});
