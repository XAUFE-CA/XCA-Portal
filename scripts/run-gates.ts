type Gate = {
  name: string;
  cmd: string[];
  // Stream builds and review diagnostics; capture routine steps for the summary.
  // 构建与审查诊断实时输出，常规步骤捕获输出后汇总。
  streaming?: boolean;
};

export const GATES: Gate[] = [
  { name: "format:check", cmd: ["bun", "run", "format:check"] },
  { name: "lint", cmd: ["bun", "run", "lint"], streaming: true },
  { name: "check:budgets", cmd: ["bun", "scripts/check-budgets.ts"], streaming: true },
  { name: "check:docs", cmd: ["bun", "scripts/check-docs.ts"] },
  { name: "check:architecture", cmd: ["bun", "scripts/check-architecture.ts"] },
  { name: "check:terminal", cmd: ["bun", "scripts/check-terminal-boundary.ts"] },
  { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
  { name: "tsc quality", cmd: ["bunx", "tsc", "-p", "tsconfig.quality.json"] },
  { name: "unit tests", cmd: ["bun", "run", "test"] },
];

const BUILD: Gate = { name: "nuxt build", cmd: ["bunx", "nuxt", "build"], streaming: true };

export function tail(lines: string[], count: number): string[] {
  return lines.length <= count
    ? lines
    : [`… 输出较长，仅显示末 ${count} 行（共 ${lines.length} 行）`, ...lines.slice(-count)];
}

export function runGates(fast = false): number {
  const plan = fast ? GATES : [...GATES, BUILD];
  const failed: string[] = [];
  let passed = 0;
  let skipped = 0;
  for (const gate of plan) {
    if (gate === BUILD && failed.length) {
      skipped++;
      console.log(`- ${gate.name}（跳过：前置门禁未通过）`);
      continue;
    }
    const start = performance.now();
    const proc = Bun.spawnSync(gate.cmd, {
      stdout: gate.streaming ? "inherit" : "pipe",
      stderr: gate.streaming ? "inherit" : "pipe",
    });
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    const ok = proc.exitCode === 0;
    if (ok) {
      passed++;
      const lines = ((proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? ""))
        .split("\n")
        .filter(Boolean);
      const note = lines[0]?.slice(0, 64);
      console.log(`✓ ${gate.name} (${seconds}s)${note ? ` — ${note}` : ""}`);
      continue;
    }
    failed.push(gate.name);
    console.log(`✗ ${gate.name} (${seconds}s)`);
    if (!gate.streaming) {
      const lines = ((proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? ""))
        .split("\n")
        .filter(Boolean);
      for (const line of tail(lines, 40)) console.log(`  ${line}`);
    }
  }
  console.log(`\n门禁汇总: ${passed} 通过, ${failed.length} 失败, ${skipped} 跳过`);
  if (failed.length) {
    console.log(`失败项: ${failed.join(", ")}`);
  }
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exitCode = runGates(process.argv.includes("--fast"));
