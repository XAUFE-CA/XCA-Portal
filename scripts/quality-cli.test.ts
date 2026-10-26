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
    write(root, "scripts/quality-budgets.json", JSON.stringify(config));
    write(root, "app/example.ts", "// example\n".repeat(501));
    const failure = check(root, "budgets");
    expect(failure.code).toBe(1);
    expect(failure.output).toContain("app/example.ts: 501 > 500");
    write(
      root,
      "scripts/quality-budgets.json",
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
