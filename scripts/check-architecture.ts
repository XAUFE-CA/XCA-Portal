import { resolve } from "node:path";
import { cycles, imports, resolveImport } from "./source-analysis";

const root = process.cwd();
const graph = new Map<string, string[]>();
const failures: string[] = [];
for await (const path of new Bun.Glob("app/**/*.{ts,vue}").scan(".")) {
  if (path.endsWith(".test.ts")) continue;
  const source = await Bun.file(path).text();
  const targets: string[] = [];
  for (const specifier of imports(path, source)) {
    const resolved = resolveImport(root, path, specifier);
    if (resolved) targets.push(resolve(resolved));
    else if (specifier.startsWith(".") || specifier.startsWith("~/") || specifier.startsWith("@/"))
      failures.push(`${path.replaceAll("\\", "/")}: unresolved import ${specifier}`);
  }
  graph.set(resolve(path), targets);
}
failures.push(...cycles(graph));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Architecture passed (${graph.size} modules; static imports, exports and literal dynamic imports)`,
  );
