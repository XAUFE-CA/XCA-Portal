import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `xca-integration-${randomBytes(16).toString("hex")}`;
const env = {
  ...process.env,
  APP_ENV: "test",
  XCA_TEST_DATABASE_URL:
    "postgres://xca_test:xca_test_disposable@127.0.0.1:15432/xca_test_admin?sslmode=disable",
  DATABASE_URL:
    "postgres://xca_test:xca_test_disposable@127.0.0.1:15432/xca_test_admin?sslmode=disable",
  XCA_TEST_SMTP_ADDR: "127.0.0.1:12526",
  XCA_TEST_MAILPIT_URL: "http://127.0.0.1:18026",
  MAIL_TRANSPORT: "mailpit",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "12526",
  SMTP_TLS_MODE: "none",
  SMTP_USERNAME: "",
  SMTP_PASSWORD: "",
  MAIL_FROM: "xca@example.invalid",
  COMPOSE_DISABLE_ENV_FILE: "1",
};
delete env.COMPOSE_FILE;
delete env.COMPOSE_PROFILES;
delete env.COMPOSE_ENV_FILES;

const compose = [
  "compose",
  "--project-name",
  project,
  "--file",
  resolve(backend, "compose.test.yaml"),
];
let child;
let interrupted;
let cleaning = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted ??= signal;
    if (!cleaning && child) child.kill();
  });
}

function run(command, args, capture = false) {
  if (interrupted && !cleaning) return Promise.reject(new Error(`Interrupted by ${interrupted}`));
  return new Promise((fulfill, reject) => {
    const current = spawn(command, args, {
      cwd: backend,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    child = current;
    let output = "";
    if (capture)
      current.stdout.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
    current.on("error", reject);
    current.on("close", (code, signal) => {
      if (child === current) child = undefined;
      if (code !== 0) reject(new Error(`${command} failed (${signal ?? code})`));
      else if (interrupted && !cleaning) reject(new Error(`Interrupted by ${interrupted}`));
      else fulfill(output);
    });
  });
}

async function checkPort(port) {
  const server = createServer();
  await new Promise((fulfill, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, fulfill);
  });
  await new Promise((fulfill, reject) =>
    server.close((error) => (error ? reject(error) : fulfill())),
  );
}

async function preflight() {
  for (const port of [15432, 12526, 18026]) {
    try {
      await checkPort(port);
    } catch (error) {
      throw new Error(`Required loopback port ${port} is unavailable: ${error.message}`);
    }
  }
  for (const resource of ["container", "network", "volume"]) {
    const args = [
      resource,
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ];
    if (resource === "container") args.push("--all");
    const output = await run("docker", args, true);
    if (output.trim())
      throw new Error(`Compose project ${project} already has ${resource} resources`);
  }
}

let started = false;
let failed = false;
try {
  await preflight();
  started = true;
  await run("docker", [...compose, "up", "--detach", "--wait"]);
  await run("go", ["test", "-tags=integration", "-race", "-count=1", "./..."]);
} catch (error) {
  console.error(error.message);
  failed = true;
} finally {
  if (started) {
    cleaning = true;
    try {
      await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
    } catch (error) {
      console.error(`Cleanup failed for compose project ${project}: ${error.message}`);
      failed = true;
    }
  }
}
if (failed || interrupted) process.exitCode = 1;
