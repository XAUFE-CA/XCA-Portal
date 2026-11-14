import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const scripts = import.meta.dir;

function withFixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "xca-quality-cli-"));
  try {
    const git = Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
    expect(git.exitCode).toBe(0);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root: string, path: string, source: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function check(root: string, name: string) {
  const result = Bun.spawnSync(["bun", resolve(scripts, `check-${name}.ts`)], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

test("budget CLI includes untracked source and rejects growth beyond a reviewed ceiling", () => {
  withFixture((root) => {
    const config = {
      limits: { source: [300, 500], css: [400, 600], test: [400, 700], function: [60, 100] },
      exceptions: {},
    };
    write(root, "scripts/gates/quality-budgets.json", JSON.stringify(config));
    write(root, "app/example.ts", "// example\n".repeat(501));
    const failure = check(root, "budgets");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain("app/example.ts: 501 > 500");
    write(
      root,
      "scripts/gates/quality-budgets.json",
      JSON.stringify({
        ...config,
        exceptions: { "app/example.ts": { ceiling: 501, reason: "CLI regression fixture" } },
      }),
    );
    expect(check(root, "budgets").code).toBe(0);
    write(root, "app/example.ts", "// example\n".repeat(502));
    expect(check(root, "budgets").code).toBe(1);
  });
});

test("documentation CLI fails missing targets and succeeds after the target exists", () => {
  withFixture((root) => {
    write(root, "README.md", "# Example\n\n[Local](docs/example.md)\n");
    const failure = check(root, "docs");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain("README.md:3:");
    write(root, "docs/example.md", "# Example\n");
    expect(check(root, "docs").code).toBe(0);
  });
});

test("architecture CLI rejects missing imports and indirect cycles and accepts a valid graph", () => {
  withFixture((root) => {
    write(root, "app/entry.ts", 'import "~/lib";\n');
    expect(check(root, "architecture").output).toContain("unresolved import ~/lib");
    expect(check(root, "architecture").code).toBe(1);
    write(root, "app/lib/index.ts", 'export * from "../middle";\n');
    write(root, "app/middle.ts", 'export * from "./entry";\n');
    const cycle = check(root, "architecture");
    expect(cycle.code).toBe(1);
    expect(cycle.output).toContain(" -> ");
    write(root, "app/middle.ts", "export {};\n");
    const success = check(root, "architecture");
    expect(success.code).toBe(0);
    expect(success.output).toContain("Architecture passed (3 modules;");
  });
});

// Ten spawned CLI checks need more than the default five-second budget.
// 十次 CLI 子进程检查需要超过默认五秒的预算。
test("terminal UI CLI validates every component style block", () => {
  withFixture((root) => {
    write(root, "app/assets/css/terminal.css", "");
    write(
      root,
      "node_modules/@neoverse-ui/tokens/dist/fixture.css",
      ":root { --neoverse-color-text-primary: black; --neoverse-motion-duration-standard: 100ms; }",
    );
    const first = "app/features/terminal/components/First.vue";
    const second = "app/features/terminal/components/Second.vue";
    const valid = ".example { color: var(--neoverse-color-text-primary); transition-delay: 0ms; }";
    write(root, first, `<template><div /></template><style scoped>${valid}</style>`);
    write(root, second, `<template><div /></template><style>${valid}</style>`);
    expect(check(root, "terminal-boundary").code).toBe(0);

    for (const [css, message] of [
      [".example { color: #fff; }", "颜色应来自 Neoverse-UI tokens"],
      [".example { transition-duration: 100ms; }", "动画时长应来自 Neoverse-UI tokens"],
      [".ui-terminal-surface { display: grid; }", "不要通过共享组件内部选择器覆盖终端样式"],
      [".example { --neoverse-font-family-code: monospace; }", "终端字体角色由 Neoverse-UI 维护"],
      [".example { color: var(--neoverse-missing-token); }", "未定义的 token"],
      [
        ".xca-terminal-statusbar { color: var(--neoverse-color-text-primary); }",
        "不应重复定义共享终端材质或文字样式",
      ],
    ]) {
      write(root, second, `<style>${valid}</style><style scoped>${css}</style>`);
      const failure = check(root, "terminal-boundary");
      expect(failure.code).toBe(1);
      expect(failure.output.replaceAll("\\", "/")).toContain(second);
      expect(failure.output).toContain(message);
    }
    write(root, second, `<style>${valid}</style>`);
    expect(check(root, "terminal-boundary").code).toBe(0);
    write(root, "app/assets/css/terminal.css", ".example { color: #fff; }");
    expect(check(root, "terminal-boundary").code).toBe(1);
    write(root, "app/assets/css/terminal.css", "");
    write(root, "app/assets/css/terminal-intro.css", ".example { color: #fff; }");
    const split = check(root, "terminal-boundary");
    expect(split.code).toBe(1);
    expect(split.output.replaceAll("\\", "/")).toContain("terminal-intro.css");
  });
}, 15_000);

test("budget CLI rejects an exception that no longer matches a file or function", () => {
  withFixture((root) => {
    const config = {
      limits: { source: [300, 500], css: [400, 600], test: [400, 700], function: [60, 100] },
      exceptions: { "app/removed.ts": { ceiling: 501, reason: "stale fixture" } },
    };
    write(root, "scripts/gates/quality-budgets.json", JSON.stringify(config));
    write(root, "app/example.ts", "export {};\n");
    const failure = check(root, "budgets");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain("app/removed.ts: 例外未对应现存的文件或函数");
  });
});

test("budget CLI rejects an exception whose function key no longer matches", () => {
  withFixture((root) => {
    const config = {
      limits: { source: [300, 500], css: [400, 600], test: [400, 700], function: [60, 100] },
      exceptions: { "app/example.ts:renamed#1": { ceiling: 101, reason: "stale function key" } },
    };
    write(root, "scripts/gates/quality-budgets.json", JSON.stringify(config));
    write(root, "app/example.ts", "export function current() { return 1; }\n");
    const failure = check(root, "budgets");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain("app/example.ts:renamed#1: 例外未对应现存的文件或函数");
  });
});

test("reference CLI rejects a missing command entry and accepts the resolved path", () => {
  withFixture((root) => {
    const workflow = ".github/workflows/quality.yml";
    const entry = "scripts/tests/test-plan.ts";
    write(
      root,
      "package.json",
      '{"scripts":{"test":"bun scripts/tests/test-plan.ts run unit,module"}}\n',
    );
    write(root, workflow, "run: bun scripts/test-plan.ts run system\n");
    const failure = check(root, "references");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain(`${workflow}:1: 脚本入口不存在 scripts/test-plan.ts`);
    write(root, workflow, "run: bun scripts/tests/test-plan.ts run system\n");
    write(root, entry, "export {};\n");
    expect(check(root, "references").code).toBe(0);
  });
});

test("reference CLI rejects a workflow command missing from the manifest", () => {
  withFixture((root) => {
    const workflow = ".github/workflows/quality.yml";
    write(
      root,
      "package.json",
      '{"scripts":{"test:ci":"bun scripts/tests/test-plan.ts run system --no-snapshot"}}\n',
    );
    write(root, workflow, "run: bun run test:missing -- --shard=1/8\n");
    const failure = check(root, "references");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain(`${workflow}:1: 命令脚本未声明 test:missing`);
    write(root, workflow, "run: bun run test:ci -- --shard=1/8\n");
    write(root, "scripts/tests/test-plan.ts", "export {};\n");
    expect(check(root, "references").code).toBe(0);
  });
});
