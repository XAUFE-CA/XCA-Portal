import { expect, type Page, test } from "@playwright/test";
import {
  account,
  dbScalar,
  installVirtualAuthenticator,
  openQa,
  otpLogin,
  resetPasskeyState,
} from "./support";

test.beforeEach(async ({ context }) => {
  resetPasskeyState();
  await installVirtualAuthenticator(context);
});

// The browser intentionally reports cancellation and an unavailable credential with the same
// DOMException, so the test helper cancels the in-flight request through the AbortSignal the
// production adapter passes to WebAuthn.
// 浏览器对取消与无可用凭据使用同一异常，因此测试辅助代码通过生产适配器传入的 AbortSignal 取消请求。
async function holdCredentialCeremonies(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pending = (options?: CredentialCreationOptions | CredentialRequestOptions) => {
      const { promise, reject } = Promise.withResolvers<never>();
      const fail = () => reject(new DOMException("ceremony cancelled", "AbortError"));
      if (options?.signal?.aborted) fail();
      else options?.signal?.addEventListener("abort", fail, { once: true });
      return promise;
    };
    navigator.credentials.create = (options) => pending(options);
    navigator.credentials.get = (options) => pending(options);
  });
}

test("@live-passkey cancelling registration and sign-in submits no verification", async ({
  page,
  request,
}) => {
  const member = account("primary");
  await openQa(page);
  await otpLogin(page, request, member, true);
  await holdCredentialCeremonies(page);

  const requests: string[] = [];
  page.on("request", (event) => requests.push(new URL(event.url()).pathname));
  const registrationOptions = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/auth/passkeys/registration/options") &&
      response.status() === 200,
  );
  await page.getByTestId("qa-register").click();
  await registrationOptions;
  await expect(page.getByTestId("qa-cancel")).toBeEnabled();
  await page.getByTestId("qa-cancel").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "cancelled");
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  expect(requests.some((path) => path.endsWith("/registration/verify"))).toBe(false);
  expect(dbScalar("SELECT count(*) FROM passkey_credentials")).toBe("0");

  const authenticationOptions = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/auth/passkeys/authentication/options") &&
      response.status() === 200,
  );
  await page.getByTestId("qa-login").click();
  await authenticationOptions;
  await expect(page.getByTestId("qa-cancel")).toBeEnabled();
  await page.getByTestId("qa-cancel").click();
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-code", "cancelled");
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
  expect(requests.some((path) => path.endsWith("/authentication/verify"))).toBe(false);
  expect(dbScalar("SELECT count(*) FROM passkey_challenges WHERE consumed_at IS NOT NULL")).toBe(
    "0",
  );
});
