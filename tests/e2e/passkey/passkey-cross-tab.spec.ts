import { expect, test } from "@playwright/test";
import {
  account,
  dbScalar,
  installVirtualAuthenticator,
  logout,
  openQa,
  otpLogin,
  passkeyLogin,
  registerPasskey,
  resetPasskeyState,
} from "./support";

test.beforeEach(async ({ context }) => {
  resetPasskeyState();
  await installVirtualAuthenticator(context);
});

test("@live-passkey two tabs converge after OTP, Passkey sign-in and logout", async ({
  context,
  page,
  request,
}) => {
  const member = account("primary");
  const peer = await context.newPage();
  await openQa(page);
  await openQa(peer);

  await otpLogin(page, request, member, true);
  await expect(peer.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  await expect(peer.getByTestId("qa-identity")).toHaveText(member.login);

  await registerPasskey(page);
  await logout(page);
  await expect(peer.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
  await expect(peer.getByTestId("qa-empty")).toBeVisible();

  await passkeyLogin(peer);
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  await expect(page.getByTestId("qa-identity")).toHaveText(member.login);

  await otpLogin(page, request, member);
  await page.getByTestId("qa-revoke").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-tone", "success");
  await expect(peer.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  expect(dbScalar("SELECT count(*) FROM passkey_credentials WHERE revoked_at IS NOT NULL")).toBe(
    "1",
  );
  expect(dbScalar("SELECT count(*) FROM passkey_credentials WHERE revoked_at IS NULL")).toBe("0");
  await peer.getByTestId("qa-refresh").click();
  await expect(peer.getByTestId("qa-empty")).toBeVisible();

  await logout(peer);
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
});
