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
// Process notes under .agents/ are dated archives; the quality rules keep them out of budgets.
// .agents/ 下的过程记录是带日期的存档，质量规则不会将其计入预算。
export function inBudgetScope(path: string): boolean {
  return (
    /\.(ts|vue|css|js|md)$/.test(path) &&
    !/(^|\/)(node_modules|dist|\.nuxt|\.output)\//.test(path) &&
    !path.startsWith(".agents/")
  );
}

if (import.meta.main) {
  const config: BudgetConfig = await Bun.file("scripts/quality-budgets.json").json();
  const tracked = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      stdout: "pipe",
    },
  );
  if (tracked.exitCode) throw new Error("Cannot enumerate repository files");
  const failures: string[] = [];
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
      if (value > soft) {
        console.log(`REVIEW ${key}: ${value} > ${soft}`);
        reviews++;
      }
      if (budgetFailure(value, hard, config.exceptions[key]))
        failures.push(
          `${key}: ${value} > ${hard}; add a reviewed reason and exact ceiling in scripts/quality-budgets.json`,
        );
    }
  }
  console.log(`Budget review: ${reviews} soft limits; ${failures.length} unapproved hard limits`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
