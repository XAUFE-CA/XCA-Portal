import { expect, test } from "@playwright/test";
import {
  account,
  dbScalar,
  expectSessionWithoutOTP,
  installVirtualAuthenticator,
  logout,
  openQa,
  otpLogin,
  passkeyLogin,
  registerPasskey,
  resetPasskeyState,
  sessionCookie,
  sessionDigest,
} from "./support";

test.beforeEach(async ({ context }) => {
  resetPasskeyState();
  await installVirtualAuthenticator(context);
});

test("@live-passkey real browser registration and discoverable sign-in", async ({
  page,
  request,
  context,
}) => {
  const member = account("primary");
  await openQa(page);
  await otpLogin(page, request, member, true);
  await registerPasskey(page);

  expect(
    dbScalar(
      `SELECT count(*) FROM passkey_credentials c JOIN users u ON u.id = c.user_id
       WHERE u.login_name = '${member.login}' AND c.revoked_at IS NULL`,
    ),
  ).toBe("1");
  const first = await sessionCookie(context);
  expect(
    dbScalar(
      `SELECT otp_verified_at IS NOT NULL FROM sessions WHERE encode(session_digest, 'hex') = '${sessionDigest(first)}'`,
    ),
  ).toBe("t");
  expect(
    (await context.cookies()).find((cookie) => cookie.name === "xca_session_dev"),
  ).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  });

  await logout(page);
  expect(await sessionCookie(context)).toBe("");

  const emailed = { count: 0 };
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/auth/email/")) emailed.count += 1;
  });
  await passkeyLogin(page);
  await expect(page.getByTestId("qa-identity")).toHaveText(member.login);
  expect(emailed.count).toBe(0);
  const second = await sessionCookie(context);
  await expectSessionWithoutOTP(second);
  expect(second).not.toBe(first);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  await expect(page.getByTestId("qa-identity")).toHaveText(member.login);
});

test("@live-passkey Passkey session cannot authorize sensitive management", async ({
  page,
  request,
  context,
}) => {
  const member = account("primary");
  await openQa(page);
  await otpLogin(page, request, member, true);
  await registerPasskey(page);
  await logout(page);
  await passkeyLogin(page);
  await expectSessionWithoutOTP(await sessionCookie(context));

  await page.getByTestId("qa-register").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "recent_otp_required");
  expect(dbScalar("SELECT count(*) FROM passkey_credentials")).toBe("1");

  await page.getByTestId("qa-revoke").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "recent_otp_required");
  expect(dbScalar("SELECT count(*) FROM passkey_credentials WHERE revoked_at IS NULL")).toBe("1");

  await otpLogin(page, request, member);
  await expect(page.getByTestId("qa-credential")).toHaveCount(1);
  await page.getByTestId("qa-revoke").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-tone", "success");
  await expect(page.getByTestId("qa-empty")).toBeVisible();
  expect(dbScalar("SELECT count(*) FROM passkey_credentials WHERE revoked_at IS NOT NULL")).toBe(
    "1",
  );
});

test("@live-passkey revocation blocks sign-in and preserves OTP recovery", async ({
  page,
  request,
  context,
}) => {
  const member = account("primary");
  await openQa(page);
  await otpLogin(page, request, member, true);
  await registerPasskey(page);
  await logout(page);
  await passkeyLogin(page);

  await otpLogin(page, request, member);
  await page.getByTestId("qa-revoke").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-tone", "success");
  await expect(page.getByTestId("qa-empty")).toBeVisible();
  expect(dbScalar("SELECT count(*) FROM passkey_credentials")).toBe("1");
  expect(dbScalar("SELECT revoked_at IS NOT NULL FROM passkey_credentials")).toBe("t");
  expect(dbScalar("SELECT octet_length(credential_id) > 0 FROM passkey_credentials")).toBe("t");

  await logout(page);
  expect(await sessionCookie(context)).toBe("");
  await page.getByTestId("qa-login").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute(
    "data-code",
    "invalid_or_expired_authentication",
  );
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
  expect(await sessionCookie(context)).toBe("");

  await otpLogin(page, request, member);
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
});
