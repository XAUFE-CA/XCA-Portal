import type { CommandContext, CommandDefinition, EntryInput } from "../core/types";
import type { VirtualNode } from "../core/workspace";
import { completePath, executionError, line, usage } from "./helpers";

const lsOptions = ["-a", "-l", "-la", "-al"];
const entryName = (node: VirtualNode) =>
  node.path.slice(node.path.lastIndexOf("/") + 1) + (node.kind === "directory" ? "/" : "");
/**
 * Reads a file body only for the detailed listing so directories stay untouched.
 * 仅在详细列表时读取文件正文，目录不读取。
 */
async function listEntry(
  node: VirtualNode,
  detailed: boolean,
  ctx: CommandContext,
  signal: AbortSignal,
): Promise<EntryInput> {
  const name = entryName(node);
  if (!detailed) return line(name, node.kind === "directory" ? "accent" : "normal");
  const text = node.kind === "file" && node.read ? await ctx.workspace.read(node.path, signal) : "";
  const size = new TextEncoder().encode(text).length;
  return line(
    `${node.kind === "directory" ? "d" : "-"} ${String(size).padStart(5)}  ${name}`,
    node.kind === "directory" ? "accent" : "normal",
  );
}

export const fileCommands: CommandDefinition[] = [
  {
    name: "pwd",
    group: "files",
    summary: "",
    summaryKey: "summary.pwd",
    usage: "pwd",
    execute: (args, ctx) => (args.length ? usage(ctx, "pwd") : [line(ctx.workspace.cwd)]),
  },
  {
    name: "ls",
    group: "files",
    summary: "",
    summaryKey: "summary.ls",
    usage: "ls [option] [path]",
    usageParams: lsOptions,
    complete: (args, ctx) =>
      args.at(-1)?.startsWith("-")
        ? []
        : completePath(
            args.filter((arg) => !arg.startsWith("-")),
            ctx,
          ),
    execute: async (args, ctx, signal) => {
      const options = args.filter((arg) => arg.startsWith("-"));
      const paths = args.filter((arg) => !arg.startsWith("-"));
      if (
        options.length > 1 ||
        options.some((option) => !lsOptions.includes(option)) ||
        paths.length > 1
      )
        return usage(ctx, "ls");
      const detailed = options.some((option) => option.includes("l"));
      const all = options.some((option) => option.includes("a"));
      const nodes = ctx.workspace
        .list(paths[0])
        .filter((node) => all || !entryName(node).startsWith("."));
      const entries: EntryInput[] = [];
      for (const node of nodes) entries.push(await listEntry(node, detailed, ctx, signal));
      return entries;
    },
  },
  {
    name: "cd",
    group: "files",
    summary: "",
    summaryKey: "summary.cd",
    usage: "cd [path]",
    complete: (args, ctx) => completePath(args, ctx, { directoriesOnly: true }),
    execute: (args, ctx) => {
      if (args.length > 1) return usage(ctx, "cd");
      try {
        ctx.workspace.cd(args[0]);
      } catch (error) {
        return [executionError(ctx, error)];
      }
    },
  },
  {
    name: "cat",
    group: "files",
    summary: "",
    summaryKey: "summary.cat",
    usage: "cat <file...>",
    complete: (args, ctx) => completePath(args, ctx, { multiple: true }),
    execute: async (args, ctx, signal) => {
      if (!args.length) return usage(ctx, "cat");
      const failures: EntryInput[] = [];
      for (const path of args) {
        try {
          const text = await ctx.workspace.read(path, signal);
          // Write each body as soon as it is read so later failures keep earlier output.
          // 读取成功即输出，后续失败不影响已读内容。
          ctx.write(line(text));
        } catch (error) {
          failures.push(executionError(ctx, error));
        }
      }
      return failures;
    },
  },
];
