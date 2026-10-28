import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function runFixture(fail: boolean) {
  const root = mkdtempSync(join(tmpdir(), "xca-gates-"));
  try {
    const runner = pathToFileURL(join(import.meta.dir, "run-gates.ts")).href;
    const fixture = join(root, "runner.ts");
    writeFileSync(
      fixture,
      `import { GATES, runGates } from ${JSON.stringify(runner)};
for (const gate of GATES) {
  const stdout = [gate.name + " summary"];
  const stderr = [];
  if (gate.name === "lint") stderr.push("warning: review-this-diagnostic");
  if (gate.name === "check:budgets") stdout.push("REVIEW: review-this-budget");
  if (gate.name === "unit tests") stdout[0] = "remaining-gates-executed";
  const code = ${fail} && ["lint", "typecheck"].includes(gate.name) ? 1 : 0;
  gate.cmd = [process.execPath, "-e", "console.log(" + JSON.stringify(stdout.join("\\n")) + "); console.error(" + JSON.stringify(stderr.join("\\n")) + "); process.exit(" + code + ");"];
}
process.exitCode = runGates(${!fail});
`,
    );
    const result = Bun.spawnSync([process.execPath, fixture], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("successful fast gates keep lint stderr and multiline budget review visible", () => {
  const result = runFixture(false);
  expect(result.code).toBe(0);
  expect(result.output).toContain("warning: review-this-diagnostic");
  expect(result.output).toContain("REVIEW: review-this-budget");
  expect(result.output).toContain("9 通过, 0 失败, 0 跳过");
  expect(result.output).not.toContain("nuxt build");
});

test("failed gates continue remaining checks, report every failure and skip the build", () => {
  const result = runFixture(true);
  expect(result.code).toBe(1);
  expect(result.output).toContain("remaining-gates-executed");
  expect(result.output).toContain("7 通过, 2 失败, 1 跳过");
  expect(result.output).toContain("失败项: lint, typecheck");
  expect(result.output).toContain("nuxt build（跳过：前置门禁未通过）");
});
