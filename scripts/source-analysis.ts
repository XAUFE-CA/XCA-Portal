import { statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export function parseSource(path: string, source: string) {
  // Vue templates are not TypeScript. Extract scripts rather than interpreting markup.
  // Vue 模板不是 TypeScript，应提取脚本而非解析标记。
  const script = path.endsWith(".vue")
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n")
    : source;
  return ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true);
}

export function lineCount(source: string): number {
  return source ? source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length : 0;
}

export function documentUnits(source: string): number {
  // One Han character or one contiguous non-Han letter/number word is one unit.
  // 一个汉字或一个连续的非汉字字母/数字词计为一个单位。
  return (source.match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}_])+/gu) ?? []).length;
}

export function functions(path: string, source: string) {
  const file = parseSource(path, source);
  const result: { name: string; lines: number }[] = [];
  const counts = new Map<string, number>();
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const name =
        node.name?.getText(file) ??
        (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(file) : "callback");
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      result.push({ name: `${name}#${count}`, lines: lineCount(node.getText(file)) });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

export function imports(path: string, source: string): string[] {
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText() === "require")
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) result.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parseSource(path, source));
  return result;
}

export function resolveImport(root: string, path: string, specifier: string): string | undefined {
  const base =
    specifier.startsWith("~/") || specifier.startsWith("@/")
      ? resolve(root, "app", specifier.slice(2).replace(/\?.*$/, ""))
      : specifier.startsWith(".")
        ? resolve(root, dirname(path), specifier.replace(/\?.*$/, ""))
        : undefined;
  if (!base) return;
  return [base, `${base}.ts`, `${base}.vue`, `${base}.js`, resolve(base, "index.ts")].find(
    (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
  );
}

export function cycles(graph: Map<string, string[]>): string[] {
  const done = new Set<string>();
  const stack: string[] = [];
  const failures: string[] = [];
  function visit(path: string) {
    const index = stack.indexOf(path);
    if (index >= 0) {
      failures.push([...stack.slice(index), path].join(" -> "));
      return;
    }
    if (done.has(path)) return;
    stack.push(path);
    for (const target of graph.get(path) ?? []) visit(target);
    stack.pop();
    done.add(path);
  }
  for (const path of graph.keys()) visit(path);
  return failures;
}

export function boundaryViolation(path: string, target: string): boolean {
  if (!path.startsWith("app/features/terminal/")) return false;
  if ((path.includes("/core/") || path.includes("/commands/")) && isBuiltin(target)) return true;
  if (path.includes("/core/")) {
    return (
      /^(vue|@vue\/|@neoverse-ui\/|#app|#imports|node:|bun)/.test(target) ||
      (target.startsWith("app/") &&
        !/^(app\/features\/terminal\/(core\/|branding\/|config\.ts)|app\/i18n\/|app\/config\/)/.test(
          target,
        ))
    );
  }
  return (
    path.includes("/commands/") &&
    /^(vue|@vue\/|@neoverse-ui\/|#app|#imports|node:|bun)|^app\/(pages|components|composables)\/|\/terminal\/(components|presentation)\//.test(
      target,
    )
  );
}
