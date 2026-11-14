import { documentUnits, functions, lineCount } from "./source-analysis";

type Exception = { ceiling: number; reason: string };
type Limits = [number, number];
interface BudgetConfig {
  limits: Record<"source" | "css" | "test" | "function", Limits>;
  exceptions: Record<string, Exception>;
}
export function fileLimits(path: string, config: BudgetConfig): Limits {
  if (path === "AGENTS.md") return [200, 250];
  if (path.endsWith("/AGENTS.md")) return [100, 120];
  if (path.endsWith(".md")) return [500, Number.POSITIVE_INFINITY];
  if (/\.(test|spec)\.ts$/.test(path)) return config.limits.test;
  return path.endsWith(".css") ? config.limits.css : config.limits.source;
}
export function budgetFailure(value: number, hard: number, exception?: Exception): boolean {
  return value > hard && (!exception?.reason.trim() || value > exception.ceiling);
}
// A soft-limit item ten units from blocking needs attention before the next edit.
// 软超限项距硬限不足十个单位时，下一次改动前需要关注。
export function nearHardLimit(
  value: number,
  soft: number,
  hard: number,
  exception?: Exception,
): boolean {
  return value > soft && Number.isFinite(hard) && hard - value <= 10 && !exception?.reason.trim();
}
// Review keys identify a file, a function or a document content metric.
// REVIEW 键标识文件、函数或文档内容量。
export type ReviewCategory = "file" | "function" | "document";
export function reviewCategory(key: string): ReviewCategory {
  if (key.endsWith(":units")) return "document";
  return /:[^/]+#\d+$/.test(key) ? "function" : "file";
}
// Process notes under .agents/ are dated archives; the quality rules keep them out of budgets.
// .agents/ 下的过程记录是带日期的存档，质量规则不会将其计入阈值检查范围。
export function inBudgetScope(path: string): boolean {
  return (
    /\.(ts|vue|css|js|md)$/.test(path) &&
    !/(^|\/)(node_modules|dist|\.nuxt|\.output)\//.test(path) &&
    !path.startsWith(".agents/")
  );
}

if (import.meta.main) {
  const config: BudgetConfig = await Bun.file("scripts/gates/quality-budgets.json").json();
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      stdout: "pipe",
    },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const failures: string[] = [];
  const near: string[] = [];
  const seen = new Set<string>();
  const groups: Record<ReviewCategory, number> = { file: 0, function: 0, document: 0 };
  let reviews = 0;
  for (const path of new Set(tracked.stdout.toString().split("\0").filter(Boolean))) {
    if (!inBudgetScope(path)) continue;
    if (!(await Bun.file(path).exists())) continue;
    const source = await Bun.file(path).text();
    const kind = /\.(test|spec)\.ts$/.test(path)
      ? "test"
      : path.endsWith(".css")
        ? "css"
        : path.endsWith(".md")
          ? "doc"
          : "source";
    const limits = fileLimits(path, config);
    const metrics: [string, number, number, number][] = [
      [path, lineCount(source), limits[0], limits[1]],
    ];
    if (kind === "doc") metrics.push([`${path}:units`, documentUnits(source), 6000, 12000]);
    if (/\.(ts|vue|js)$/.test(path))
      for (const fn of functions(path, source))
        metrics.push([`${path}:${fn.name}`, fn.lines, ...config.limits.function] as [
          string,
          number,
          number,
          number,
        ]);
    for (const [key, value, soft, hard] of metrics) {
      seen.add(key);
      const exception = config.exceptions[key];
      if (value > soft) {
        console.log(`REVIEW ${key}: ${value} > ${soft}`);
        reviews++;
        groups[reviewCategory(key)]++;
      }
      if (nearHardLimit(value, soft, hard, exception)) near.push(`${key}: ${value}/${hard}`);
      if (budgetFailure(value, hard, exception))
        failures.push(
          `${key}: ${value} > ${hard}; add a reviewed reason and exact ceiling in scripts/gates/quality-budgets.json`,
        );
    }
  }
  for (const key of Object.keys(config.exceptions))
    if (!seen.has(key))
      failures.push(`${key}: 例外未对应现存的文件或函数，请从 quality-budgets.json 删除`);
  for (const item of near) console.log(`NEAR ${item}`);
  console.log(
    `Budget review: ${reviews} soft limits (${groups.function} functions, ${groups.file} files, ${groups.document} documents); ${near.length} near hard limits; ${failures.length} failures`,
  );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
