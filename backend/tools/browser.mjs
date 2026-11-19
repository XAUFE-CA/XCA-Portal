import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backend = resolve(root, "backend");
const project = `xca-auth-browser-${randomBytes(8).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "xca-auth-browser-"));
const binary = join(directory, process.platform === "win32" ? "api.exe" : "api");
const encodeKey = () => randomBytes(32).toString("base64");
const label = randomBytes(5).toString("hex");
const email = `pilot-${label}@example.invalid`;
const env = {
  ...process.env,
  APP_ENV: "test",
  API_LISTEN_ADDR: "127.0.0.1:8080",
  DATABASE_URL:
    "postgres://xca_test:xca_test_disposable@127.0.0.1:15432/xca_test_admin?sslmode=disable",
  MAIL_TRANSPORT: "mailpit",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "12526",
  SMTP_TLS_MODE: "none",
  SMTP_USERNAME: "",
  SMTP_PASSWORD: "",
  MAIL_FROM: "xca@example.invalid",
  OTP_HMAC_KEY: encodeKey(),
  RATE_LIMIT_HMAC_KEY: encodeKey(),
  PUBLIC_ORIGIN: "http://127.0.0.1:4102",
  TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
  NUXT_BACKEND_API: "http://127.0.0.1:8080",
  XCA_AUTH_LIVE: "1",
  XCA_AUTH_EMAIL: email,
  XCA_AUTH_LOGIN: `pilot-${label}`,
  XCA_AUTH_LOST_EMAIL: `lost-${label}@example.invalid`,
  XCA_AUTH_LOST_LOGIN: `lost-${label}`,
  XCA_AUTH_LATE_EMAIL: `late-${label}@example.invalid`,
  XCA_AUTH_LATE_LOGIN: `late-${label}`,
  XCA_TEST_MAILPIT_URL: "http://127.0.0.1:18026",
  COMPOSE_DISABLE_ENV_FILE: "1",
};
for (const key of ["COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_ENV_FILES"]) delete env[key];

const compose = ["compose", "-p", project, "-f", resolve(backend, "compose.test.yaml")];
let api;
let started = false;
let interrupted = false;
let cleaning = false;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function checkPort(port) {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, done);
  });
  await new Promise((done) => server.close(done));
}

function run(command, args, cwd = backend, capture = false) {
  if (interrupted && !cleaning) throw new Error("Interrupted");
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    encoding: capture ? "utf8" : undefined,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.error?.code ?? "unknown"})`);
  return capture ? result.stdout : "";
}

async function preflight() {
  for (const port of [15432, 12526, 18026, 8080, 4102]) {
    try {
      await checkPort(port);
    } catch (error) {
      throw new Error(`Required loopback port ${port} unavailable: ${error.message}`);
    }
  }
  for (const type of ["container", "network", "volume"]) {
    const args = [type, "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`];
    if (type === "container") args.push("--all");
    if (run("docker", args, backend, true).trim())
      throw new Error(`Project already owns ${type} resources`);
  }
}

async function awaitReady() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (api?.exitCode !== null) throw new Error("Go API terminated before readiness");
    try {
      const response = await fetch("http://127.0.0.1:8080/readyz", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) return;
    } catch {}
    await delay(300);
  }
  throw new Error("Go API readiness timeout");
}

function stopAPI() {
  if (api && api.exitCode === null) api.kill();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    stopAPI();
  });
}

let failed = false;
try {
  await preflight();
  started = true;
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "90"]);
  run("go", ["run", "./cmd/migrate", "up"]);
  const invitation = run(
    "go",
    [
      "run",
      "./cmd/xcactl",
      "create",
      "--email",
      email,
      "--login",
      env.XCA_AUTH_LOGIN,
      "--display-name",
      "XCA Pilot",
    ],
    backend,
    true,
  );
  const match = invitation.match(/^token \(shown once\): (.+)$/m);
  if (!match) throw new Error("Invitation CLI output missing token");
  env.XCA_AUTH_INVITATION = match[1].trim();
  const lostInvitation = run(
    "go",
    [
      "run",
      "./cmd/xcactl",
      "create",
      "--email",
      env.XCA_AUTH_LOST_EMAIL,
      "--login",
      env.XCA_AUTH_LOST_LOGIN,
      "--display-name",
      "XCA Interrupted",
    ],
    backend,
    true,
  );
  const lostMatch = lostInvitation.match(/^token \(shown once\): (.+)$/m);
  if (!lostMatch) throw new Error("Second invitation CLI output missing token");
  env.XCA_AUTH_LOST_INVITATION = lostMatch[1].trim();
  const lateInvitation = run(
    "go",
    [
      "run",
      "./cmd/xcactl",
      "create",
      "--email",
      env.XCA_AUTH_LATE_EMAIL,
      "--login",
      env.XCA_AUTH_LATE_LOGIN,
      "--display-name",
      "XCA Late Request",
    ],
    backend,
    true,
  );
  const lateMatch = lateInvitation.match(/^token \(shown once\): (.+)$/m);
  if (!lateMatch) throw new Error("Third invitation CLI output missing token");
  env.XCA_AUTH_LATE_INVITATION = lateMatch[1].trim();
  run("go", ["build", "-o", binary, "./cmd/api"]);
  api = spawn(binary, [], { cwd: backend, env, stdio: "ignore", windowsHide: true });
  api.on("error", () => {
    interrupted = true;
  });
  await awaitReady();
  run("bun", ["run", "build"], root);
  run("bun", ["scripts/tests/test-plan.ts", "run", "system", "--live"], root);
  console.log("Real browser auth chain: PASS");
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : "Unknown integration failure");
} finally {
  cleaning = true;
  stopAPI();
  if (started) {
    try {
      run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
    } catch {
      console.error("Audit Compose cleanup failed; inspect isolated project resources");
      failed = true;
    }
  }
  rmSync(directory, { recursive: true, force: true });
  delete env.XCA_AUTH_INVITATION;
  delete env.XCA_AUTH_LOST_INVITATION;
  delete env.XCA_AUTH_LATE_INVITATION;
}
if (failed || interrupted) process.exitCode = 1;
