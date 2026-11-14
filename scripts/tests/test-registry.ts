import { existsSync, readdirSync } from "node:fs";
import ts from "typescript";

export const REGISTRY_PATH = "docs/testing/README.md";
export const LEVELS = ["unit", "module", "system"] as const;
export const RUNNERS = ["bun-test", "playwright"] as const;
export const METADATA = ["browser", "isolated", "scene", "snapshot"] as const;

export type TestLevel = (typeof LEVELS)[number];
export type TestRunner = (typeof RUNNERS)[number];
export type TestMetadata = (typeof METADATA)[number];

export interface TestScope {
  scope: string;
  level: TestLevel;
  runner: TestRunner;
  args: string[];
  metadata: TestMetadata[];
  files: string[];
}

export interface RegistryReport {
  scopes: TestScope[];
  files: string[];
  issues: string[];
}

const HEADER = ["Scope", "Level", "Runner", "Args", "Metadata"];
// Every test source in the repository must be covered by exactly one scope.
// 仓库中的每个测试文件必须恰好由一个范围覆盖。
const TEST_SOURCES = ["app/**/*.test.ts", "scripts/**/*.test.ts", "tests/e2e/**/*.spec.ts"];

// Markdown tables use padded cells; splitting trims them back to values.
// Markdown 表格会补齐单元格，拆分后统一去掉两侧空白。
export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isLevel(value: string): value is TestLevel {
  return (LEVELS as readonly string[]).includes(value);
}

function isRunner(value: string): value is TestRunner {
  return (RUNNERS as readonly string[]).includes(value);
}

function isMetadata(value: string): value is TestMetadata {
  return (METADATA as readonly string[]).includes(value);
}

function parseList(cell: string): string[] {
  return cell === "—" ? [] : cell.split(",").map((value) => value.trim());
}

function parseRow(cells: string[], where: string): { row?: TestScope; issues: string[] } {
  if (cells.length !== HEADER.length)
    return { issues: [`${where}: expected ${HEADER.length} cells, found ${cells.length}`] };
  const [scope = "", level = "", runner = "", args = "", metadata = ""] = cells;
  const issues: string[] = [];
  const flags = parseList(args);
  for (const flag of flags)
    if (!flag.startsWith("--")) issues.push(`${where}: runner argument ${flag} must start with --`);
  const metadataValues = parseList(metadata);
  for (const value of metadataValues)
    if (!isMetadata(value)) issues.push(`${where}: unknown metadata ${value}`);
  if (new Set(metadataValues).size !== metadataValues.length)
    issues.push(`${where}: duplicate metadata`);
  if (!isLevel(level)) issues.push(`${where}: unknown level ${level}`);
  if (!isRunner(runner)) issues.push(`${where}: unknown runner ${runner}`);
  if (isRunner(runner) && isLevel(level)) {
    if (runner === "playwright" && level !== "system")
      issues.push(`${where}: playwright scopes must use the system level`);
    if (runner === "bun-test" && level === "system")
      issues.push(`${where}: bun-test scopes cannot use the system level`);
  }
  if (issues.length || !isRunner(runner) || !isLevel(level)) return { issues };
  return {
    row: {
      scope,
      level,
      runner,
      args: flags,
      metadata: metadataValues.filter(isMetadata),
      files: [],
    },
    issues,
  };
}

// The registry table is both the human-readable strategy and the executor input.
// 注册表表格同时是人类可读策略与执行器输入。
export function parseRegistry(source: string): { scopes: TestScope[]; issues: string[] } {
  const lines = source.split("\n");
  const headerIndex = lines.findIndex(
    (line) => line.trim().startsWith("|") && splitRow(line).join("|") === HEADER.join("|"),
  );
  if (headerIndex < 0) return { scopes: [], issues: [`${REGISTRY_PATH}: registry table missing`] };
  const scopes: TestScope[] = [];
  const issues: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) break;
    const cells = splitRow(line);
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const parsed = parseRow(cells, `${REGISTRY_PATH}:${index + 1}`);
    issues.push(...parsed.issues);
    if (parsed.row) scopes.push(parsed.row);
  }
  return { scopes, issues };
}

async function expandScope(scope: string): Promise<string[]> {
  if (!/[*?[{]/.test(scope)) return existsSync(scope) ? [scope] : [];
  const files: string[] = [];
  for await (const path of new Bun.Glob(scope).scan(".")) files.push(path.replaceAll("\\", "/"));
  return files.sort();
}

export async function discoverTests(): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of TEST_SOURCES)
    for await (const path of new Bun.Glob(pattern).scan(".")) files.add(path.replaceAll("\\", "/"));
  return [...files].sort();
}

// Evidence is read from calls and test titles, so fixture strings stay inert data.
// 证据取自调用与测试标题，夹具中的字符串不会被当成证据。
function hasCall(file: string, source: string, name: string): boolean {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        name === "toHaveScreenshot" &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === name
      )
        found = true;
      if (name !== "toHaveScreenshot" && ts.isIdentifier(callee) && callee.text === name)
        found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

function hasCinematicTitle(file: string, source: string): boolean {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    const text =
      ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) ? node.getText() : "";
    if (text.includes("@cinematic")) {
      let parent = node.parent;
      if (parent && ts.isTemplateExpression(parent)) parent = parent.parent;
      if (
        parent &&
        ts.isCallExpression(parent) &&
        /^(test|it|describe)(\.|$)/.test(parent.expression.getText())
      )
        found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

// Verified metadata keeps the table from claiming properties the files do not have.
// 元数据由文件内容核对，避免表格声明文件并不具备的属性。
export function metadataIssues(scope: TestScope, sources: Map<string, string>): string[] {
  const issues: string[] = [];
  const evidence: [TestMetadata, boolean, string][] = [
    ["browser", scope.runner === "playwright", "playwright runner"],
    ["scene", [...sources].some(([file, text]) => hasCinematicTitle(file, text)), "@cinematic tag"],
    [
      "snapshot",
      [...sources].some(([file, text]) => hasCall(file, text, "toHaveScreenshot")),
      "toHaveScreenshot()",
    ],
    [
      "isolated",
      [...sources].some(([file, text]) => hasCall(file, text, "mkdtempSync")),
      "mkdtempSync()",
    ],
  ];
  for (const [name, present, label] of evidence) {
    const declared = scope.metadata.includes(name);
    if (declared && !present) issues.push(`${scope.scope}: metadata ${name} needs ${label}`);
    if (!declared && present) issues.push(`${scope.scope}: ${label} needs metadata ${name}`);
  }
  for (const file of scope.files) {
    if (scope.runner === "playwright" && !file.endsWith(".spec.ts"))
      issues.push(`${scope.scope}: playwright scope matched non-spec file ${file}`);
    if (scope.runner === "bun-test" && !file.endsWith(".test.ts"))
      issues.push(`${scope.scope}: bun-test scope matched non-test file ${file}`);
  }
  return issues;
}

export function coverageIssues(scopes: TestScope[], files: string[]): string[] {
  const owners = new Map<string, string[]>();
  for (const scope of scopes)
    for (const file of scope.files) owners.set(file, [...(owners.get(file) ?? []), scope.scope]);
  const issues: string[] = [];
  for (const file of files) {
    const matching = owners.get(file) ?? [];
    if (matching.length === 0)
      issues.push(`${file}: test file is not registered in ${REGISTRY_PATH}`);
    if (matching.length > 1) issues.push(`${file}: registered by ${matching.join(", ")}`);
  }
  return issues;
}

export async function checkRegistry(): Promise<RegistryReport> {
  const { scopes, issues } = parseRegistry(await Bun.file(REGISTRY_PATH).text());
  for (const scope of scopes) {
    scope.files = await expandScope(scope.scope);
    if (scope.files.length === 0) issues.push(`${scope.scope}: scope matches no test file`);
  }
  const sources = new Map<string, string>();
  for (const scope of scopes) {
    const contents = new Map<string, string>();
    for (const file of scope.files) {
      const text = await Bun.file(file).text();
      sources.set(file, text);
      contents.set(file, text);
    }
    issues.push(...metadataIssues(scope, contents));
    if (!scope.metadata.includes("snapshot")) continue;
    for (const [file, text] of contents) {
      if (!hasCall(file, text, "toHaveScreenshot")) continue;
      const baseline = `${file}-snapshots`;
      const names = existsSync(baseline) ? readdirSync(baseline) : [];
      if (!names.some((name) => name.endsWith(".png")))
        issues.push(`${file}: snapshot metadata needs baselines in ${baseline}`);
    }
  }
  const files = await discoverTests();
  issues.push(...coverageIssues(scopes, files));
  return { scopes, files, issues };
}

export function countsByLevel(scopes: TestScope[]): Record<TestLevel, number> {
  const counts: Record<TestLevel, number> = { unit: 0, module: 0, system: 0 };
  for (const scope of scopes) counts[scope.level] += scope.files.length;
  return counts;
}
