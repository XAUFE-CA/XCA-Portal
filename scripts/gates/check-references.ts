import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Command entries must resolve to a file; documentation quotes paths as examples.
// 命令入口必须指向存在的文件，文档中的路径是叙述性引用。
const REFERENCE = /(?:^|[\s"'(=])(scripts\/[\w./-]+\.ts)\b/g;

// Only executable entry points are scanned, so quoted counterexamples stay out of scope.
// 只扫描实际执行的入口，避免把反例引用纳入范围。
export function isEntryFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized === "package.json" ||
    normalized === "scripts/gates/run-gates.ts" ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)
  );
}

// CI and gate commands must resolve to a script declared in the manifest.
// CI 与门禁命令必须指向清单中已声明的脚本。
const COMMAND = /(?:\bbun run ([\w:.-]+)|"bun",\s*"run",\s*"([\w:.-]+)")/g;

export function scriptReferences(source: string): { target: string; line: number }[] {
  const references: { target: string; line: number }[] = [];
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(REFERENCE)) {
      const target = match[1];
      if (target) references.push({ target, line: index + 1 });
    }
  });
  return references;
}

export function scriptCommands(source: string): { name: string; line: number }[] {
  const commands: { name: string; line: number }[] = [];
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(COMMAND)) {
      const name = match[1] ?? match[2];
      if (name) commands.push({ name, line: index + 1 });
    }
  });
  return commands;
}

if (import.meta.main) {
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { stdout: "pipe" },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const manifest = JSON.parse(await Bun.file("package.json").text()) as {
    scripts?: Record<string, string>;
  };
  const declared = new Set(Object.keys(manifest.scripts ?? {}));
  const failures: string[] = [];
  let paths = 0;
  let commands = 0;
  for (const path of new Set(tracked.stdout.toString().split("\0").filter(Boolean))) {
    if (!isEntryFile(path) || !existsSync(path)) continue;
    const source = await Bun.file(path).text();
    for (const { target, line } of scriptReferences(source)) {
      paths++;
      if (!existsSync(resolve(target))) failures.push(`${path}:${line}: 脚本入口不存在 ${target}`);
    }
    for (const { name, line } of scriptCommands(source)) {
      commands++;
      if (!declared.has(name)) failures.push(`${path}:${line}: 命令脚本未声明 ${name}`);
    }
  }
  console.log(`Script references: ${paths} entry paths; ${commands} declared commands`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
