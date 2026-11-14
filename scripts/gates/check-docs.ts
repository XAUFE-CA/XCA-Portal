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

// Vague wording returns through translation; a mechanical list keeps it out of shipped text.
// 空泛表述会随翻译重新出现。用固定清单阻止它进入交付文本。
const BANNED_PHRASES = [
  "权威",
  "品牌",
  "工程质量契约",
  "架构契约",
  "公共契约",
  "包契约",
  "私有契约",
  "共享契约",
  "事实来源",
  "内容归属",
  "治理脚本",
  "叙事节奏",
  "空间编排",
  "表现力时长单位",
  "共享材质",
  "共享令牌",
  "世界单位",
  "语义色",
  "消费方",
  "版本漂移",
  "常规流",
  "终态矩形",
  "空间缓动",
  "重栅格化",
  "呈现层",
  "钩子",
];

// Rule files and this list quote banned phrases as counterexamples, so review covers them.
// 规则文件与本清单把禁用表述当反例引用，因此只由人工审查。
const WORDING_RULE_FILES = new Set([
  "docs/AGENTS.md",
  "docs/terminology/terms.md",
  "scripts/gates/check-docs.ts",
  "scripts/gates/quality.test.ts",
]);

export function bannedPhrases(source: string): { line: number; phrase: string }[] {
  const hits: { line: number; phrase: string }[] = [];
  source.split("\n").forEach((line, index) => {
    for (const phrase of BANNED_PHRASES)
      if (line.includes(phrase)) hits.push({ line: index + 1, phrase });
  });
  return hits;
}

export function isWordingRuleFile(path: string): boolean {
  return WORDING_RULE_FILES.has(path);
}

if (import.meta.main) {
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { stdout: "pipe" },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const failures: string[] = [];
  const wording: string[] = [];
  for (const file of new Set(tracked.stdout.toString().split("\0").filter(Boolean))) {
    if (!inBudgetScope(file) || !existsSync(file)) continue;
    const source = await Bun.file(file).text();
    if (!isWordingRuleFile(file))
      for (const hit of bannedPhrases(source))
        wording.push(`${file}:${hit.line}: 禁用表述 ${hit.phrase}`);
    if (!file.endsWith(".md")) continue;
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
  console.log(`Wording: ${wording.length} banned phrases`);
  const problems = [...failures, ...wording];
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
