import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteLocale } from "../../i18n";
import { readVirtualFile, virtualFiles } from "./manifest";
import { baselineIssues, readBaseline, readPairs, structuralIssues } from "./text-sync";

const LOCALES = ["zh-CN", "en"] as const satisfies readonly SiteLocale[];

test("paired texts keep one translated line per source line", () => {
  const pairs = readPairs();
  expect(pairs.length).toBeGreaterThan(0);
  for (const pair of pairs) {
    const issues = structuralIssues(pair);
    expect(issues, `${pair.stem}\n${issues.join("\n")}`).toEqual([]);
  }
});

test("translations match the stamped baseline", () => {
  const baseline = readBaseline();
  expect(baseline.version).toBe(1);
  for (const pair of readPairs()) {
    const issues = baselineIssues(pair, baseline.files[pair.stem]);
    expect(
      issues,
      `${pair.stem}\n${issues.join("\n")}\n翻译完成后运行 bun run texts:stamp 登记`,
    ).toEqual([]);
  }
});

test("virtual files resolve both locales without unresolved placeholders", () => {
  for (const file of virtualFiles) {
    if (typeof file.content === "string") continue;
    for (const locale of LOCALES) {
      const text = readVirtualFile(file, () => locale);
      expect(text.trim().length, `${file.path}: ${locale}`).toBeGreaterThan(0);
      expect(text, `${file.path}: ${locale} placeholder`).not.toMatch(/\{\w+\}/);
    }
  }
});

test("terminal text files are paired and keep one formatting convention", () => {
  const files = join(import.meta.dir, "files");
  const names = readdirSync(files).filter((name) => name.endsWith(".txt"));
  const stems = (suffix: string) =>
    names
      .filter((name) => name.endsWith(suffix))
      .map((name) => name.slice(0, -suffix.length))
      .sort();
  const zh = stems(".zh-CN.txt");
  expect(zh.length).toBeGreaterThan(0);
  expect(stems(".en.txt")).toEqual(zh);
  for (const name of names) {
    const source = readFileSync(join(files, name), "utf8");
    expect(source.includes("\r"), `${name}: CRLF`).toBe(false);
    expect(source.includes("\t"), `${name}: tabs`).toBe(false);
    expect(source.endsWith("\n"), `${name}: final newline`).toBe(true);
    const lines = source.slice(0, -1).split("\n");
    expect(
      lines.some((value) => value !== value.trimEnd()),
      `${name}: trailing whitespace`,
    ).toBe(false);
  }
});
