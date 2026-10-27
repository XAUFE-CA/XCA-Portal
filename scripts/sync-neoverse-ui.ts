import { resolve } from "node:path";
import { uiDependencyState } from "./ui-dependencies";

const portalRoot = resolve(import.meta.dir, "..");
const uiRoot = resolve(portalRoot, "../Neoverse-UI");
const syncScript = resolve(uiRoot, "scripts/sync-consumer.ts");

async function run(args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`Neoverse-UI 同步失败：${args.join(" ")}`);
}

// Local file: dependencies are early-development only; published packages need no sync.
// 本地 file: 依赖仅用于早期开发；发布版本无需同步。
const manifest = await Bun.file(resolve(portalRoot, "package.json")).json();
const uiState = uiDependencyState(manifest);
if (uiState === "mixed") throw new Error("Neoverse-UI 依赖不能混用 file: 与发布版本。");
if (uiState === "published") {
  console.log("[ui:sync] Neoverse-UI uses published versions; local sync skipped.");
} else {
  if (!(await Bun.file(syncScript).exists()))
    throw new Error(`找不到共享同步脚本，请更新同级 Neoverse-UI 仓库：${syncScript}`);

  // Dependency contract changes must update bun.lock with bun install first.
  // 依赖契约变更必须先执行 bun install 更新 bun.lock。
  await run(["install", "--frozen-lockfile", "--ignore-scripts"], portalRoot);
  // The library owns package order, nested copies, hard links and byte verification.
  // 包顺序、嵌套拷贝、硬链接与字节校验由该库负责。
  await run([syncScript, "--consumer", portalRoot], uiRoot);
}
