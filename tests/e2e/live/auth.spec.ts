import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const origin = "http://127.0.0.1:4102";

async function beginInvitationLogin(
  page: Page,
  email: string,
  invitation: string,
): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-hero--intro")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".xca-terminal-hero--intro")).toHaveCount(0);

  const command = page.locator("#xca-command-input");
  await command.fill("login");
  await command.press("Enter");
  const options = page.locator(".xca-terminal-menu [data-menu-item]");
  await expect(options).toHaveCount(2);
  await options.nth(1).click();

  const field = page.locator("#xca-interaction-input");
  const proceed = page.locator(".xca-terminal-interaction form button[type='submit']");
  await expect(field).toBeVisible();
  await field.fill(email);
  await proceed.click();
  await expect(field).toBeVisible();
  await field.fill(invitation);
  const acceptedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/email/code") && response.status() === 202,
  );
  await proceed.click();
  const accepted = await (await acceptedResponse).json();
  expect(accepted.flow_id).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  return accepted.flow_id;
}

async function mailpitCode(
  request: APIRequestContext,
  mailpit: string,
  email: string,
): Promise<string> {
  let code = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(`${mailpit}/api/v1/messages`);
        if (!response.ok()) return "";
        const data = await response.json();
        const messages = Array.isArray(data.messages) ? data.messages : data.Messages;
        if (!Array.isArray(messages)) return "";
        for (const item of messages) {
          if (typeof item.ID !== "string" || !JSON.stringify(item.To).includes(email)) continue;
          const detail = await request.get(
            `${mailpit}/api/v1/message/${encodeURIComponent(item.ID)}`,
          );
          if (!detail.ok()) continue;
          const message = await detail.json();
          const text = typeof message.Text === "string" ? message.Text : "";
          const match = text.match(/Your verification code:\s*(\d{6})/);
          if (match) code = match[1];
        }
        return code;
      },
      { timeout: 25_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

async function submitCode(page: Page, code: string): Promise<void> {
  const field = page.locator("#xca-interaction-input");
  await expect(field).toBeVisible();
  await field.fill(code);
  await page.locator(".xca-terminal-interaction form button[type='submit']").click();
}

test("@live-auth committed verification with a lost response does not create a browser session", async ({
  page,
  request,
}) => {
  test.skip(process.env.XCA_AUTH_LIVE !== "1", "Requires the isolated authentication runner");
  const email = process.env.XCA_AUTH_LOST_EMAIL;
  const invitation = process.env.XCA_AUTH_LOST_INVITATION;
  const mailpit = process.env.XCA_TEST_MAILPIT_URL;
  if (!email || !invitation || !mailpit) throw new Error("Missing isolated test fixture");

  const flow = await beginInvitationLogin(page, email, invitation);
  const otp = await mailpitCode(request, mailpit, email);
  let committed = false;
  let operationID = "";
  await page.route("**/api/v1/auth/email/verify", async (route) => {
    operationID = route.request().headers()["x-xca-auth-operation"] ?? "";
    // Deliver to Go, then drop the response and Set-Cookie.
    // 提交到 Go 后丢弃响应与 Set-Cookie。
    const response = await fetch(`${origin}/api/v1/auth/email/verify`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-XCA-Auth-Operation": route.request().headers()["x-xca-auth-operation"] ?? "",
      },
      body: route.request().postData(),
    });
    committed = response.status === 200;
    await route.abort("failed");
  });
  await submitCode(page, otp);
  await expect.poll(() => committed, { timeout: 20_000 }).toBe(true);

  // A committed database session does not imply the browser received the Cookie.
  // 数据库提交成功不代表浏览器收到了 Cookie。
  const queried = await page.request.get("/api/v1/auth/session");
  expect((await queried.json()).identity).toBeNull();
  expect((await page.context().cookies()).some((c) => c.name === "xca_session_dev")).toBe(false);
  expect(operationID).toMatch(/^[0-9a-f-]{36}$/);
  const barrier = await page.request.post("/api/v1/auth/operations/abandon", {
    headers: { Origin: origin },
    data: { operation_id: operationID },
  });
  expect(barrier.status()).toBe(204);
  const replay = await page.request.post("/api/v1/auth/email/verify", {
    headers: { Origin: origin, "X-XCA-Auth-Operation": crypto.randomUUID() },
    data: { flow_id: flow, code: otp },
  });
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error.code).toBe("invalid_or_expired_code");
});

test("@live-auth invitation activation, session restoration and logout through the real stack", async ({
  page,
  request,
}) => {
  test.skip(process.env.XCA_AUTH_LIVE !== "1", "Requires the isolated authentication runner");
  const email = process.env.XCA_AUTH_EMAIL;
  const invitation = process.env.XCA_AUTH_INVITATION;
  const login = process.env.XCA_AUTH_LOGIN;
  const mailpit = process.env.XCA_TEST_MAILPIT_URL;
  if (!email || !invitation || !login || !mailpit) throw new Error("Missing isolated test fixture");

  const denied = await request.post("/api/v1/auth/email/code", {
    headers: { Origin: "https://untrusted.invalid" },
    data: { email },
  });
  expect(denied.status()).toBe(403);

  await beginInvitationLogin(page, email, invitation);
  const otp = await mailpitCode(request, mailpit, email);
  await submitCode(page, otp);
  await expect(page.locator(".xca-terminal-prompt").last()).toContainText(login, {
    timeout: 20_000,
  });

  const issued = (await page.context().cookies()).find(
    (cookie) => cookie.name === "xca_session_dev",
  );
  expect(issued).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: false });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".xca-terminal-prompt").last()).toContainText(login, {
    timeout: 20_000,
  });
  const command = page.locator("#xca-command-input");
  await command.fill("logout");
  await command.press("Enter");
  await expect(page.locator(".xca-terminal-prompt").last()).toContainText("guest", {
    timeout: 20_000,
  });
  expect((await page.context().cookies()).some((cookie) => cookie.name === "xca_session_dev")).toBe(
    false,
  );
  expect((await (await page.request.get("/api/v1/auth/session")).json()).identity).toBeNull();
});

test("@live-auth a late verification cannot commit after a subsequent logout", async ({
  page,
  request,
}) => {
  test.skip(process.env.XCA_AUTH_LIVE !== "1", "Requires the isolated authentication runner");
  const email = process.env.XCA_AUTH_LATE_EMAIL;
  const invitation = process.env.XCA_AUTH_LATE_INVITATION;
  const mailpit = process.env.XCA_TEST_MAILPIT_URL;
  if (!email || !invitation || !mailpit) throw new Error("Missing isolated test fixture");

  const flow = await beginInvitationLogin(page, email, invitation);
  const otp = await mailpitCode(request, mailpit, email);
  let abandonedOperation = "";
  await page.route("**/api/v1/auth/email/verify", async (route) => {
    abandonedOperation = route.request().headers()["x-xca-auth-operation"] ?? "";
    // The original verification is intentionally delayed until after logout completes.
    // 故意让原验证在注销操作完成后才抵达服务器。
    await route.abort("failed");
  });
  await submitCode(page, otp);
  await expect.poll(() => abandonedOperation).toMatch(/^[0-9a-f-]{36}$/);

  const command = page.locator("#xca-command-input");
  await expect(command).toBeEditable();
  const barrier = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/auth/operations/abandon") && res.status() === 204,
  );
  const logout = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/auth/logout") && res.status() === 204,
  );
  await command.fill("logout");
  await command.press("Enter");
  await barrier;
  await logout;

  const late = await page.request.post("/api/v1/auth/email/verify", {
    headers: { Origin: origin, "X-XCA-Auth-Operation": abandonedOperation },
    data: { flow_id: flow, code: otp },
  });
  expect(late.status()).toBe(400);
  expect((await late.json()).error.code).toBe("invalid_request");
  expect((await (await page.request.get("/api/v1/auth/session")).json()).identity).toBeNull();
});

test("@live-auth Nuxt strips spoofed proxy headers before database IP rate limits", async ({
  request,
}) => {
  test.skip(process.env.XCA_AUTH_LIVE !== "1", "Requires the isolated authentication runner");
  let blocked = false;
  for (let i = 0; i <= 30; i += 1) {
    const response = await request.post("/api/v1/auth/email/code", {
      headers: { Origin: origin, "X-Forwarded-For": `198.51.100.${i + 1}` },
      data: { email: `unknown-${i}@example.invalid` },
    });
    if (response.status() === 429) {
      expect(response.headers()["retry-after"]).toBeTruthy();
      blocked = true;
      break;
    }
    expect(response.status()).toBe(202);
  }
  expect(blocked).toBe(true);
});

test("@live-auth Passkey management and sign-in routes stay closed by default", async ({
  request,
}) => {
  test.skip(process.env.XCA_AUTH_LIVE !== "1", "Requires the isolated authentication runner");
  for (const call of [
    { method: "post", path: "/api/v1/auth/passkeys/registration/options" },
    { method: "post", path: "/api/v1/auth/passkeys/registration/verify" },
    { method: "get", path: "/api/v1/auth/passkeys" },
    { method: "post", path: "/api/v1/auth/passkeys/revoke" },
    { method: "post", path: "/api/v1/auth/passkeys/authentication/options" },
    { method: "post", path: "/api/v1/auth/passkeys/authentication/verify" },
  ] as const) {
    const response =
      call.method === "post"
        ? await request.post(call.path, { headers: { Origin: origin }, data: {} })
        : await request.get(call.path);
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe("invalid_request");
  }
});
