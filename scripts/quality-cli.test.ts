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
  });
});
