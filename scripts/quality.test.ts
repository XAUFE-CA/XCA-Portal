import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetFailure, fileLimits, inBudgetScope } from "./check-budgets";
import { extractLinks, isExternalLink } from "./check-docs";
import { GATES, tail } from "./run-gates";
import {
  cycles,
  documentUnits,
  functions,
  imports,
  lineCount,
  resolveImport,
} from "./source-analysis";

test("line and bilingual document budgets handle LF, CRLF and Han text", () => {
  expect(lineCount("a\r\nb\r\n")).toBe(2);
  expect(lineCount("")).toBe(0);
  expect(documentUnits("中文 English mixed 123")).toBe(5);
  expect(documentUnits("中文English")).toBe(3);
});
test("hard limits require a reason and prevent baseline growth", () => {
  expect(budgetFailure(500, 500)).toBe(false);
  expect(budgetFailure(501, 500)).toBe(true);
  expect(budgetFailure(510, 500, { ceiling: 510, reason: "cohesive state machine" })).toBe(false);
  expect(budgetFailure(511, 500, { ceiling: 510, reason: "cohesive state machine" })).toBe(true);
  expect(budgetFailure(510, 500, { ceiling: 510, reason: "" })).toBe(true);
});
test("AST handles methods, arrow functions and Vue scripts without template noise", () => {
  expect(
    functions(
      "a.vue",
      '<script setup lang="ts">\nfunction run() {\n return 1;\n}\n</script><template>text</template>',
    )[0],
  ).toEqual({ name: "run#1", lines: 3 });
  expect(functions("a.ts", "const f = () => 1; class C { run() {} }")).toHaveLength(2);
  expect(
    imports("a.ts", 'import x from "./x"; export * from "./y"; import("./z"); // import("fake")'),
  ).toEqual(["./x", "./y", "./z"]);
});
test("architecture finds indirect cycles without rejecting an acyclic graph", () => {
  expect(
    cycles(
      new Map([
        ["a", ["b"]],
        ["b", ["c"]],
        ["c", ["a"]],
      ]),
    ),
  ).toHaveLength(1);
  expect(
    cycles(
      new Map([
        ["a", ["b"]],
        ["b", []],
      ]),
    ),
  ).toEqual([]);
});

test("documentation and code select their own budgets", () => {
  const config = {
    limits: { source: [300, 500], css: [400, 600], test: [400, 700], function: [60, 100] },
    exceptions: {},
  } as Parameters<typeof fileLimits>[1];
  expect(fileLimits("AGENTS.md", config)).toEqual([200, 250]);
  expect(fileLimits("app/AGENTS.md", config)).toEqual([100, 120]);
  expect(fileLimits("docs/design.md", config)).toEqual([500, Infinity]);
  expect(fileLimits("tests/example.spec.ts", config)).toEqual([400, 700]);
  expect(fileLimits("app/example.vue", config)).toEqual([300, 500]);
  expect(fileLimits("app/example.css", config)).toEqual([400, 600]);
  expect(documentUnits("English中文 mixed")).toBe(4);
});

test("budget scope includes code and docs but excludes archives and generated output", () => {
  expect(inBudgetScope("app/pages/index.vue")).toBe(true);
  expect(inBudgetScope("docs/architecture/engineering-quality.md")).toBe(true);
  expect(inBudgetScope(".agents/notes/audits/2026-10-23-audit.md")).toBe(false);
  expect(inBudgetScope(".agents/skills/example/SKILL.md")).toBe(false);
  expect(inBudgetScope("node_modules/pkg/index.js")).toBe(false);
  expect(inBudgetScope("app/assets/main.css")).toBe(true);
});

test("doc link extraction skips fences and inline code, keeps real targets", () => {
  const source = [
    '正文有 [真实链接](docs/readme.md) 和带标题的 [链接](a/b.md "title")。',
    "`[示例](never.md)` 不算链接。",
    "```text",
    "[围栏里](also-not.md) 也不算。",
    "```",
  ];
  expect(extractLinks(source)).toEqual([
    { target: "docs/readme.md", line: 1 },
    { target: "a/b.md", line: 1 },
  ]);
  expect(isExternalLink("https://x.dev")).toBe(true);
  expect(isExternalLink("mailto:a@b.dev")).toBe(true);
  expect(isExternalLink("docs/readme.md")).toBe(false);
});

test("gate runner covers every granular check script without gaps", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<
    string,
    string
  >;
  const granular = Object.keys(scripts).filter(
    (name) => /^check:/.test(name) && name !== "check:fast",
  );
  for (const name of granular)
    expect(GATES.some((gate) => gate.name === name || gate.name === `check:${name}`)).toBe(true);
  expect(tail(["a", "b"], 5)).toEqual(["a", "b"]);
  expect(tail(["1", "2", "3"], 2)[0]).toContain("仅显示末 2 行");
});

test("import resolution checks isolated aliases, directory indexes, queries and missing files", () => {
  const fixture = mkdtempSync(join(tmpdir(), "xca-imports-"));
  try {
    mkdirSync(join(fixture, "app/lib"), { recursive: true });
    mkdirSync(join(fixture, "app/assets"));
    writeFileSync(join(fixture, "app/lib/index.ts"), "export {};\n");
    writeFileSync(join(fixture, "app/assets/example.svg"), "<svg/>\n");
    expect(resolveImport(fixture, "app/example.ts", "./lib")).toBe(
      join(fixture, "app/lib/index.ts"),
    );
    for (const alias of ["~/", "@/"])
      expect(resolveImport(fixture, "app/example.ts", `${alias}assets/example.svg?url`)).toBe(
        join(fixture, "app/assets/example.svg"),
      );
    expect(resolveImport(fixture, "app/example.ts", "./missing")).toBeUndefined();
    expect(resolveImport(fixture, "app/example.ts", "vue")).toBeUndefined();
    expect(resolveImport(fixture, "app/example.ts", "./assets")).toBeUndefined();
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
