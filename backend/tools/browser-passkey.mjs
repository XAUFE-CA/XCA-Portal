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
if (args.length && !useArtifacts)
  throw new Error("Usage: bun tools/browser-passkey.mjs [--artifacts]");
const project = `xca-passkey-browser-${randomBytes(8).toString("hex")}`;
const directory = mkdtempSync(join(tmpdir(), "xca-passkey-browser-"));
const binDir = useArtifacts ? resolve(backend, "bin") : directory;
const binary = (name) => join(binDir, process.platform === "win32" ? `${name}.exe` : name);
const encodeKey = () => randomBytes(32).toString("base64");
const label = randomBytes(5).toString("hex");
const apiPort = 18080;
const previewPort = 4112;
const probePort = 4113;
const origin = `http://localhost:${previewPort}`;
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
  PUBLIC_ORIGIN: origin,
  TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
  PASSKEY_MANAGEMENT_ENABLED: "true",
  PASSKEY_AUTHENTICATION_ENABLED: "true",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_RP_NAME: "XCA Passkey QA",
  SESSION_TTL: "24h",
  NUXT_BACKEND_API: `http://127.0.0.1:${apiPort}`,
  XCA_PASSKEY_PORT: String(previewPort),
  XCA_TEST_MAILPIT_URL: "http://127.0.0.1:18026",
  COMPOSE_DISABLE_ENV_FILE: "1",
};
for (const key of ["COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_ENV_FILES"]) delete env[key];

const compose = ["compose", "-p", project, "-f", resolve(backend, "compose.test.yaml")];
let api;
let preview;
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
  for (const port of [15432, 12526, 18026, apiPort, previewPort, probePort]) {
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

async function awaitURL(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
    } catch {}
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startPreview(port, qa) {
  return spawn("node", [resolve(root, ".output/server/index.mjs")], {
    cwd: root,
    env: {
      ...env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
      NUXT_PASSKEY_QA: qa ? "true" : "false",
    },
    stdio: "inherit",
    windowsHide: true,
  });
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

function invitation(email, login) {
  const output = run(
    binary("xcactl"),
    ["create", "--email", email, "--login", login, "--display-name", "Passkey QA"],
    backend,
    true,
  );
  const match = output.match(/^token \(shown once\): (.+)$/m);
  if (!match) throw new Error("Invitation CLI output missing token");
  return match[1].trim();
}

async function postgresContainer() {
  const id = run(
    "docker",
    [
      "ps",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "label=com.docker.compose.service=postgres",
    ],
    backend,
    true,
  ).trim();
  if (!id) throw new Error("Isolated PostgreSQL container was not found");
  return id;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    if (api && api.exitCode === null) api.kill();
    if (preview && preview.exitCode === null) preview.kill();
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
  const email = `passkey-${label}@example.invalid`;
  const alternateEmail = `passkey-alt-${label}@example.invalid`;
  const thirdEmail = `passkey-third-${label}@example.invalid`;
  env.XCA_PASSKEY_EMAIL = email;
  env.XCA_PASSKEY_LOGIN = `passkey-${label}`;
  env.XCA_PASSKEY_INVITATION = invitation(email, env.XCA_PASSKEY_LOGIN);
  env.XCA_PASSKEY_ALTERNATE_EMAIL = alternateEmail;
  env.XCA_PASSKEY_ALTERNATE_LOGIN = `passkey-alt-${label}`;
  env.XCA_PASSKEY_ALTERNATE_INVITATION = invitation(
    alternateEmail,
    env.XCA_PASSKEY_ALTERNATE_LOGIN,
  );
  env.XCA_PASSKEY_THIRD_EMAIL = thirdEmail;
  env.XCA_PASSKEY_THIRD_LOGIN = `passkey-third-${label}`;
  env.XCA_PASSKEY_THIRD_INVITATION = invitation(thirdEmail, env.XCA_PASSKEY_THIRD_LOGIN);
  env.XCA_PASSKEY_MAILPIT_URL = "http://127.0.0.1:18026";
  env.XCA_PASSKEY_ORIGIN = origin;
  env.XCA_PASSKEY_LIVE = "1";
  env.XCA_PASSKEY_DB_CONTAINER = await postgresContainer();
  env.XCA_PASSKEY_DB_NAME = "xca_test_admin";

  api = spawn(binary("api"), [], { cwd: backend, env, stdio: "inherit", windowsHide: true });
  api.on("error", () => {
    interrupted = true;
  });
  await awaitURL(`http://127.0.0.1:${apiPort}/readyz`);

  preview = startPreview(probePort, false);
  const denied = await awaitURL(`http://localhost:${probePort}/`);
  denied.body?.cancel();
  const pageDenied = await fetch(`http://localhost:${probePort}/auth/passkey`);
  const probeDenied = await fetch(`http://localhost:${probePort}/api/passkey-qa`);
  if (pageDenied.status !== 404 || probeDenied.status !== 404)
    throw new Error("Passkey QA route leaked without the server flag");
  await stopProcess(preview);

  preview = startPreview(previewPort, true);
  await awaitURL(origin);
  run("bun", ["scripts/tests/test-plan.ts", "run", "system", "--passkey"], root, false, 900_000);
  console.log("Isolated Passkey browser chain: PASS");
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : "Unknown Passkey browser failure");
} finally {
  cleaning = true;
  await stopProcess(preview);
  await stopProcess(api);
  if (started) {
    try {
      run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
    } catch {
      console.error("Passkey Compose cleanup failed; inspect isolated project resources");
      failed = true;
    }
  }
  rmSync(directory, { recursive: true, force: true });
  for (const key of Object.keys(env)) if (key.startsWith("XCA_PASSKEY_")) delete env[key];
}
if (failed || interrupted) process.exitCode = 1;
