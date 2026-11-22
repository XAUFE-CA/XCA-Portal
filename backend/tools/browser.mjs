import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backend = resolve(root, "backend");
const args = process.argv.slice(2);
const useArtifacts = args.length === 1 && args[0] === "--artifacts";
if (args.length && !useArtifacts) throw new Error("Usage: bun tools/browser.mjs [--artifacts]");
const project = `xca-auth-browser-${randomBytes(8).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "xca-auth-browser-"));
const binDir = useArtifacts ? resolve(backend, "bin") : directory;
const binary = (name) => join(binDir, process.platform === "win32" ? `${name}.exe` : name);
const apiPort = 18081;
const encodeKey = () => randomBytes(32).toString("base64");
const label = randomBytes(5).toString("hex");
const email = `pilot-${label}@example.invalid`;
const env = {
  ...process.env,
  APP_ENV: "test",
  API_LISTEN_ADDR: `127.0.0.1:${apiPort}`,
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
  PASSKEY_MANAGEMENT_ENABLED: "false",
  PASSKEY_AUTHENTICATION_ENABLED: "false",
  WEBAUTHN_RP_ID: "",
  WEBAUTHN_RP_NAME: "",
  NUXT_BACKEND_API: `http://127.0.0.1:${apiPort}`,
  NUXT_PASSKEY_QA: "false",
  XCA_TEST_PORT: "4102",
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

function run(command, args, cwd = backend, capture = false, timeout = 180_000) {
  if (interrupted && !cleaning) throw new Error("Interrupted");
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    encoding: capture ? "utf8" : undefined,
    timeout,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.error?.code ?? "unknown"})`);
  return capture ? result.stdout : "";
}

async function preflight() {
  for (const port of [15432, 12526, 18026, apiPort, 4102]) {
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
      const response = await fetch(`http://127.0.0.1:${apiPort}/readyz`, {
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

function invite(address, login, display) {
  const output = run(
    binary("xcactl"),
    ["create", "--email", address, "--login", login, "--display-name", display],
    backend,
    true,
  );
  const match = output.match(/^token \(shown once\): (.+)$/m);
  if (!match) throw new Error("Invitation CLI output missing token");
  return match[1].trim();
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
  if (!useArtifacts) {
    run("go", ["build", "-mod=readonly", "-trimpath", "-o", `${binDir}/`, "./cmd/..."]);
    run("bun", ["run", "build"], root);
  }
  started = true;
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "90"]);
  run(binary("migrate"), ["up"]);
  env.XCA_AUTH_INVITATION = invite(email, env.XCA_AUTH_LOGIN, "XCA Pilot");
  env.XCA_AUTH_LOST_INVITATION = invite(
    env.XCA_AUTH_LOST_EMAIL,
    env.XCA_AUTH_LOST_LOGIN,
    "XCA Interrupted",
  );
  env.XCA_AUTH_LATE_INVITATION = invite(
    env.XCA_AUTH_LATE_EMAIL,
    env.XCA_AUTH_LATE_LOGIN,
    "XCA Late Request",
  );
  api = spawn(binary("api"), [], { cwd: backend, env, stdio: "inherit", windowsHide: true });
  api.on("error", () => {
    interrupted = true;
  });
  await awaitReady();
  run("bun", ["scripts/tests/test-plan.ts", "run", "system", "--live"], root, false, 900_000);
  console.log("Real browser auth chain: PASS");
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : "Unknown integration failure");
} finally {
  cleaning = true;
  if (api?.pid && api.exitCode === null && api.signalCode === null) {
    const exited = once(api, "exit");
    stopAPI();
    await exited;
  }
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
