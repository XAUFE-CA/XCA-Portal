import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { type APIRequestContext, type BrowserContext, expect, type Page } from "@playwright/test";

export const origin = "http://localhost:4112";
const api = "/api/v1/auth/passkeys";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Passkey test fixture ${name}`);
  return value;
}

function postgres(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      env("XCA_PASSKEY_DB_CONTAINER"),
      "psql",
      "-U",
      "xca_test",
      "-d",
      env("XCA_PASSKEY_DB_NAME"),
      "-tA",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

export function dbScalar(sql: string): string {
  return postgres(sql).split("\n")[0]?.trim() ?? "";
}

export function dbExec(sql: string): void {
  postgres(sql);
}

export function resetPasskeyState(): void {
  postgres(
    "DELETE FROM passkey_operation_effects; DELETE FROM passkey_credentials; " +
      "DELETE FROM passkey_challenges; DELETE FROM auth_operations; DELETE FROM sessions; " +
      "DELETE FROM email_challenges; DELETE FROM auth_rate_limits; " +
      "UPDATE users SET status = 'active';",
  );
}

export function sessionDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function installVirtualAuthenticator(context: BrowserContext): Promise<void> {
  await context.credentials.install();
}

export async function openQa(page: Page): Promise<void> {
  await page.goto("/auth/passkey", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#passkey-qa-title")).toBeVisible();
}

type Account = { email: string; invitation?: string; login: string };

export function account(name: "primary" | "alternate" | "third"): Account {
  if (name === "primary")
    return {
      email: env("XCA_PASSKEY_EMAIL"),
      invitation: env("XCA_PASSKEY_INVITATION"),
      login: env("XCA_PASSKEY_LOGIN"),
    };
  if (name === "alternate")
    return {
      email: env("XCA_PASSKEY_ALTERNATE_EMAIL"),
      invitation: env("XCA_PASSKEY_ALTERNATE_INVITATION"),
      login: env("XCA_PASSKEY_ALTERNATE_LOGIN"),
    };
  return {
    email: env("XCA_PASSKEY_THIRD_EMAIL"),
    invitation: env("XCA_PASSKEY_THIRD_INVITATION"),
    login: env("XCA_PASSKEY_THIRD_LOGIN"),
  };
}

async function mailpitCode(request: APIRequestContext, email: string): Promise<string> {
  const mailpit = env("XCA_PASSKEY_MAILPIT_URL");
  let code = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(`${mailpit}/api/v1/messages`);
        if (!response.ok()) return "";
        const data = await response.json();
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const matching = messages
          .filter((item: unknown) => {
            if (typeof item !== "object" || item === null) return false;
            const record = item as Record<string, unknown>;
            return typeof record.ID === "string" && JSON.stringify(record.To).includes(email);
          })
          .sort((a: unknown, b: unknown) => {
            const first = (a as Record<string, unknown>).Created;
            const second = (b as Record<string, unknown>).Created;
            return String(second).localeCompare(String(first));
          });
        for (const item of matching) {
          const id = (item as Record<string, unknown>).ID as string;
          const detail = await request.get(`${mailpit}/api/v1/message/${encodeURIComponent(id)}`);
          if (!detail.ok()) continue;
          const message = await detail.json();
          const text = typeof message.Text === "string" ? message.Text : "";
          const match = text.match(/Your verification code:\s*(\d{6})/);
          if (match) {
            code = match[1];
            break;
          }
        }
        return code;
      },
      { timeout: 25_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

export async function otpLogin(
  page: Page,
  request: APIRequestContext,
  target: Account,
  invitation = false,
): Promise<void> {
  const active =
    dbScalar(`SELECT count(*) FROM users WHERE login_name = '${target.login}'`) === "1";
  postgres("DELETE FROM auth_rate_limits WHERE scope IN ('email', 'email_cooldown', 'ip')");
  await page.getByTestId("qa-email").fill(target.email);
  await page
    .getByTestId("qa-invitation")
    .fill(invitation && !active ? (target.invitation ?? "") : "");
  const accepted = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/email/code") && response.status() === 202,
  );
  await page.getByTestId("qa-request-code").click();
  await accepted;
  const code = await mailpitCode(request, target.email);
  await page.getByTestId("qa-code").fill(code);
  const verified = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/email/verify") && response.status() === 200,
  );
  await page.getByTestId("qa-verify-code").click();
  await verified;
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
}

export async function registerPasskey(page: Page, count = 1): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${api}/registration/verify`) && response.status() === 201,
  );
  await page.getByTestId("qa-register").click();
  await saved;
  await expect(page.getByTestId("qa-message")).toHaveAttribute("data-tone", "success");
  await expect(page.getByTestId("qa-credential")).toHaveCount(count);
}

export async function passkeyLogin(page: Page): Promise<void> {
  const verified = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${api}/authentication/verify`) && response.status() === 200,
  );
  await page.getByTestId("qa-login").click();
  await verified;
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "authenticated");
}

export async function logout(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (request) => request.url().endsWith("/api/v1/auth/logout") && request.status() === 204,
  );
  await page.getByTestId("qa-logout").click();
  await response;
  await expect(page.getByTestId("qa-status")).toHaveAttribute("data-status", "guest");
}

export async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies(origin)).find((item) => item.name === "xca_session_dev");
  return cookie?.value ?? "";
}

export async function expectSessionWithoutOTP(token: string): Promise<void> {
  expect(token).not.toBe("");
  expect(
    dbScalar(
      `SELECT otp_verified_at IS NULL FROM sessions WHERE encode(session_digest, 'hex') = '${sessionDigest(token)}'`,
    ),
  ).toBe("t");
}
