import { relative, resolve } from "node:path";
import ts from "typescript";
import { boundaryViolation, cycles, imports, parseSource, resolveImport } from "./source-analysis";

const root = process.cwd();
const graph = new Map<string, string[]>();
const failures: string[] = [];
for await (const path of new Bun.Glob("app/**/*.{ts,vue}").scan(".")) {
  if (path.endsWith(".test.ts")) continue;
  const normalized = path.replaceAll("\\", "/");
  const source = await Bun.file(path).text();
  const targets: string[] = [];
  for (const specifier of imports(path, source)) {
    const resolved = resolveImport(root, path, specifier);
    const target = resolved ? relative(root, resolved).replaceAll("\\", "/") : specifier;
    if (boundaryViolation(normalized, target))
      failures.push(`${normalized} -> ${target}: forbidden layer dependency`);
    if (resolved) targets.push(resolve(resolved));
    else if (specifier.startsWith(".") || specifier.startsWith("~/") || specifier.startsWith("@/"))
      failures.push(`${normalized}: unresolved import ${specifier}`);
  }
  graph.set(resolve(path), targets);
  if (
    !normalized.startsWith("app/features/terminal/core/") &&
    !normalized.startsWith("app/features/terminal/commands/")
  )
    continue;
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && /^(window|document|eval|Function|Bun|process)$/.test(node.text))
      failures.push(`${normalized}: forbidden host capability ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(parseSource(path, source));
}
failures.push(...cycles(graph));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Architecture passed (${graph.size} modules; static imports, exports and literal dynamic imports)`,
  );
