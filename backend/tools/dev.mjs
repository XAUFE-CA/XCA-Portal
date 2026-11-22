import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The Go processes read only the process environment, so load the file here.
// Go 进程只读取进程环境，因此在这里载入文件。
async function readEnv(path) {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      "缺少 backend/.env，请先复制 backend/.env.example 为 backend/.env 并填写配置。",
    );
  }
  const values = {};
  for (const raw of (await file.text()).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`backend/.env 行格式无效：${line}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function main() {
  const mode = process.argv[2] ?? "up";
  if (mode !== "up" && mode !== "down") {
    throw new Error("Usage: bun tools/dev.mjs [up|down]");
  }
  const env = { ...process.env, ...(await readEnv(resolve(backend, ".env"))) };
  const run = (command, args) => {
    console.log(`[backend] ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { cwd: backend, env, stdio: "inherit" });
    // Forward terminal interrupts so Compose and the API stop with this process.
    // 转发终端中断，使 Compose 与 API 随本进程停止。
    const stop = () => child.kill();
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
    return new Promise((fulfill, reject) => {
      const settle = () => {
        for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, stop);
      };
      child.on("error", (error) => {
        settle();
        reject(error);
      });
      child.on("close", (code) => {
        settle();
        if (code === 0) fulfill();
        else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      });
    });
  };

  if (mode === "down") {
    await run("docker", ["compose", "--env-file", ".env", "down"]);
    return;
  }
  await run("docker", ["compose", "--env-file", ".env", "up", "-d", "--wait"]);
  await run("go", ["run", "./cmd/migrate", "up"]);
  await run("go", ["run", "./cmd/api"]);
}

await main();
