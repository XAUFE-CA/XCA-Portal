import type { CommandDefinition, EntryInput } from "../core/types";
import type { VirtualNode } from "../core/workspace";
import {
  completePath,
  executionError,
  line,
  OUTPUT_LINES,
  RESULT_NODES,
  splitLines,
  usage,
} from "./helpers";

const grepOptions = ["-i", "-n", "-v"];
const nodeName = (node: VirtualNode): string => node.path.slice(node.path.lastIndexOf("/") + 1);
const childPath = (child: VirtualNode): string =>
  nodeName(child) + (child.kind === "directory" ? "/" : "");
interface GrepRequest {
  flags: Set<string>;
  pattern: string | undefined;
  files: string[];
}
/**
 * Separates leading flags from the pattern so a pattern may start with a dash.
 * 先取出前置选项，使模式本身可以以连字符开头。
 */
function parseGrep(args: string[]): GrepRequest {
  const flags = new Set<string>();
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === undefined || !grepOptions.includes(value)) break;
    flags.add(value);
    index++;
  }
  return { flags, pattern: args[index], files: args.slice(index + 1) };
}
/**
 * Matches a glob-like name where only `*` is special and every other character is literal.
 * 匹配仅把 `*` 视为通配符的名称模式，其余字符一律按字面量处理。
 */
function nameMatcher(pattern: string): (name: string) => boolean {
  const collapsed = pattern.replace(/\*+/g, "*");
  const escaped = collapsed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", ".*");
  const source = new RegExp(`^${escaped}$`);
  return (name) => source.test(name);
}
const depthOf = (path: string, root: string): number =>
  (root === "/" ? path.slice(1) : path.slice(root.length + 1)).split("/").length;
interface FindRequest {
  path: string;
  pattern?: string;
}
/**
 * Parses an optional path followed by an optional `-name` pattern.
 * 解析可选路径与随后的可选 `-name` 模式。
 */
function parseFind(args: string[]): FindRequest | undefined {
  const [first, ...rest] = args;
  const path = first === undefined || first === "-name" ? "." : first;
  const options = first === "-name" ? args : rest;
  if (!options.length) return { path };
  const [flag, pattern] = options;
  return flag === "-name" && pattern !== undefined && options.length === 2
    ? { path, pattern }
    : undefined;
}

export const searchCommands: CommandDefinition[] = [
  {
    name: "grep",
    group: "files",
    summary: "",
    summaryKey: "summary.grep",
    usage: "grep [option...] <pattern> <file...>",
    usageParams: grepOptions,
    complete: (args, ctx) => {
      const index = args.findIndex((arg) => !grepOptions.includes(arg));
      return index < 0 || args.length <= index + 1
        ? []
        : completePath(args.slice(index + 1), ctx, { multiple: true });
    },
    execute: async (args, ctx, signal) => {
      const { flags, pattern, files } = parseGrep(args);
      if (pattern === undefined || !files.length) return usage(ctx, "grep");
      const insensitive = flags.has("-i");
      const numbered = flags.has("-n");
      const invert = flags.has("-v");
      const needle = insensitive ? pattern.toLowerCase() : pattern;
      const rows: string[] = [];
      const failures: EntryInput[] = [];
      for (const file of files) {
        try {
          const lines = splitLines(await ctx.workspace.read(file, signal));
          lines.forEach((text, index) => {
            const matched = (insensitive ? text.toLowerCase() : text).includes(needle);
            if (matched === invert) return;
            const prefix = files.length > 1 ? `${file}:` : "";
            rows.push(`${prefix}${numbered ? `${index + 1}:` : ""}${text}`);
          });
        } catch (error) {
          failures.push(executionError(ctx, error));
        }
      }
      if (rows.length > OUTPUT_LINES)
        return [line(ctx.t("error.outputLimit", { limit: OUTPUT_LINES }), "error"), ...failures];
      return [...(rows.length ? [line(rows.join("\n"))] : []), ...failures];
    },
  },
  {
    name: "tree",
    group: "files",
    summary: "",
    summaryKey: "summary.tree",
    usage: "tree [path]",
    complete: (args, ctx) => completePath(args, ctx, { directoriesOnly: true }),
    execute: (args, ctx, signal) => {
      const [path] = args;
      if (args.length > 1) return usage(ctx, "tree");
      signal.throwIfAborted();
      try {
        const node = ctx.workspace.node(path ?? ".");
        if (node.kind === "file") return [line(node.path)];
        const rows: EntryInput[] = [line(node.path === "/" ? "/" : `${node.path}/`, "accent")];
        let truncated = false;
        for (const child of ctx.workspace.walk(node.path)) {
          if (rows.length - 1 >= RESULT_NODES) {
            truncated = true;
            break;
          }
          const depth = depthOf(child.path, node.path);
          if (depth > 8) {
            truncated = true;
            continue;
          }
          rows.push(
            line(
              `${"  ".repeat(depth)}${childPath(child)}`,
              child.kind === "directory" ? "accent" : "normal",
            ),
          );
        }
        return truncated ? [...rows, line(ctx.t("command.truncated"), "muted")] : rows;
      } catch (error) {
        return [executionError(ctx, error)];
      }
    },
  },
  {
    name: "find",
    group: "files",
    summary: "",
    summaryKey: "summary.find",
    usage: "find [path] [-name <pattern>]",
    complete: (args, ctx) =>
      args.length > 1 || args.at(-1)?.startsWith("-") ? [] : completePath(args, ctx),
    execute: (args, ctx, signal) => {
      const request = parseFind(args);
      if (!request) return usage(ctx, "find");
      signal.throwIfAborted();
      try {
        const node = ctx.workspace.node(request.path);
        const candidates = node.kind === "file" ? [node] : ctx.workspace.walk(request.path);
        const matcher = request.pattern === undefined ? undefined : nameMatcher(request.pattern);
        const matches = matcher
          ? candidates.filter((child) => matcher(nodeName(child)))
          : candidates;
        const rows = matches
          .slice(0, RESULT_NODES)
          .map((child) => line(child.path, child.kind === "directory" ? "accent" : "normal"));
        return matches.length > RESULT_NODES
          ? [...rows, line(ctx.t("command.truncated"), "muted")]
          : rows;
      } catch (error) {
        return [executionError(ctx, error)];
      }
    },
  },
];
