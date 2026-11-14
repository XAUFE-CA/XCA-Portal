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

if (import.meta.main) {
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { stdout: "pipe" },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const failures: string[] = [];
  let count = 0;
  for (const path of new Set(tracked.stdout.toString().split("\0").filter(Boolean))) {
    if (!isEntryFile(path) || !existsSync(path)) continue;
    for (const { target, line } of scriptReferences(await Bun.file(path).text())) {
      count++;
      if (!existsSync(resolve(target))) failures.push(`${path}:${line}: 脚本入口不存在 ${target}`);
    }
  }
  console.log(`Script references: ${count} entry paths`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
