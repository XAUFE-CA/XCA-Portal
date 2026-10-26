import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inBudgetScope } from "./check-budgets";

// Verifies repository-internal Markdown links resolve to existing files, skipping code examples.
// 校验仓库内部 Markdown 链接指向已存在文件，并跳过代码示例。
export function extractLinks(lines: string[]): { target: string; line: number }[] {
  const links: { target: string; line: number }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const withoutCode = line.replace(/`[^`]*`/g, "");
    for (const match of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (target === undefined) throw new Error("Link pattern must capture a target");
      links.push({ target, line: index + 1 });
    }
  });
  return links;
}

export function isExternalLink(target: string): boolean {
  return /^[a-z][\w+.-]*:/i.test(target);
}

if (import.meta.main) {
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { stdout: "pipe" },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const failures: string[] = [];
  for (const file of new Set(tracked.stdout.toString().split("\0").filter(Boolean))) {
    if (!file.endsWith(".md") || !inBudgetScope(file)) continue;
    if (!existsSync(file)) continue;
    const source = await Bun.file(file).text();
    for (const link of extractLinks(source.split("\n"))) {
      if (isExternalLink(link.target) || link.target.startsWith("#")) continue;
      const path = link.target.split("#")[0];
      if (!path) continue;
      let decoded = path;
      try {
        decoded = decodeURI(path);
      } catch {
        // Keep the raw path when the target is not valid percent-encoding.
        // 目标不是合法百分号编码时，保留原始路径。
      }
      if (!existsSync(resolve(dirname(file), decoded)))
        failures.push(`${file}:${link.line}: 链接目标不存在 ${link.target}`);
    }
  }
  console.log(`Doc links: ${failures.length} broken targets`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
