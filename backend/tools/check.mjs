import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "-race")) {
  throw new Error("Usage: bun tools/check.mjs [-race]");
}

const formatted = spawnSync("gofmt", ["-l", "."], { encoding: "utf8" });
if (formatted.error || formatted.status !== 0) {
  throw new Error(`gofmt failed: ${formatted.error ?? formatted.stderr}`);
}
if (formatted.stdout.trim()) {
  throw new Error(`gofmt required for:\n${formatted.stdout}`);
}

const commands = [
  ["vet", "./..."],
  ["test", "./..."],
  ["build", "./..."],
];
for (const command of commands) {
  console.log(`go ${command.join(" ")}`);
  const result = spawnSync("go", command, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`go ${command[0]} failed: ${result.error ?? result.status}`);
  }
}

const binDir = mkdtempSync(join(tmpdir(), "xca-staticcheck-"));
const staticcheck = join(binDir, process.platform === "win32" ? "staticcheck.exe" : "staticcheck");
try {
  console.log("Installing staticcheck v0.8.2 in a temporary directory");
  const installed = spawnSync("go", ["install", "honnef.co/go/tools/cmd/staticcheck@v0.8.2"], {
    env: { ...process.env, GOBIN: binDir },
    stdio: "inherit",
  });
  if (installed.error || installed.status !== 0) {
    throw new Error(`staticcheck installation failed: ${installed.error ?? installed.status}`);
  }
  const checked = spawnSync(staticcheck, ["./..."], { encoding: "utf8" });
  process.stdout.write(checked.stdout ?? "");
  process.stderr.write(checked.stderr ?? "");
  if (checked.error || checked.status !== 0 || /matched no packages/.test(checked.stderr ?? "")) {
    throw new Error(`staticcheck failed: ${checked.error ?? checked.status}`);
  }
} finally {
  if (existsSync(staticcheck)) unlinkSync(staticcheck);
  rmdirSync(binDir);
}

if (args.length === 1) {
  console.log("go test -race ./...");
  const result = spawnSync("go", ["test", "-race", "./..."], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`go test -race failed: ${result.error ?? result.status}`);
  }
}
