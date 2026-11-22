import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const [output] = process.argv.slice(2);
if (!output || process.argv.length !== 3) throw new Error("Usage: node smoke-nitro.mjs <.output>");

const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(NUXT_|NITRO_|NODE_OPTIONS$)/i.test(name)),
);
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: resolve(output),
  env: {
    ...env,
    NODE_ENV: "production",
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: "0",
    NUXT_BACKEND_API: "disabled:",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
const exited = once(server, "close");
const lines = createInterface({ input: server.stdout });
const timer = setTimeout(() => server.kill(), 30_000);
try {
  const origin = await new Promise((ready, reject) => {
    lines.on("line", (line) => {
      console.log(line);
      const match = /^Listening on (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
      if (match) ready(match[1]);
    });
    exited.then(([code, signal]) => reject(new Error(`Nitro exited: ${code ?? signal}`)), reject);
  }).finally(() => clearTimeout(timer));

  const get = (path) => fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
  const about = await get("/about");
  assert.equal(about.status, 200, "/about");
  const html = await about.text();
  assert.match(html, /<article\b/, "SSR must render content from the bundled database");
  const asset = /href="(\/_nuxt\/[^"<>]+\.css)"/.exec(html)?.[1];
  assert.ok(asset, "SSR must reference a built stylesheet");
  const style = await get(asset);
  assert.equal(style.status, 200, asset);
  assert.match(style.headers.get("content-type") ?? "", /^text\/css\b/);
  await style.body?.cancel();

  for (const path of ["/auth/passkey", "/api/passkey-qa"]) {
    const denied = await get(path);
    assert.equal(denied.status, 404, path);
    await denied.body?.cancel();
  }
  const offline = await get("/api/v1/auth/session");
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get("cache-control"), "no-store");
  assert.deepEqual(await offline.json(), { error: { code: "service_unavailable" } });
  console.log("Nitro artifact: content, stylesheet, QA disabled and upstream failure verified");
} finally {
  lines.close();
  server.kill();
  await exited;
}
