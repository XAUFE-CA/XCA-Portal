import type { CommandDefinition, EntryInput } from "../core/types";
import { completePath, executionError, line, OUTPUT_LINES, splitLines, usage } from "./helpers";

const stripTrailingSlashes = (path: string): string => path.replace(/\/+$/, "");
/**
 * Takes the last path component, ignoring trailing slashes except for the root.
 * 取路径的最后一段，除根目录外忽略结尾斜杠。
 */
function baseName(path: string): string {
  const trimmed = stripTrailingSlashes(path);
  if (!trimmed) return path ? "/" : "";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}
/**
 * Removes a suffix only when it is a proper tail, matching GNU basename.
 * 仅在后缀构成真后缀时剥离，与 GNU basename 一致。
 */
function removeSuffix(name: string, suffix: string | undefined): string {
  if (!suffix || name === suffix || !name.endsWith(suffix)) return name;
  return name.slice(0, -suffix.length);
}
/**
 * Takes the directory part of a path without resolving it in the virtual workspace.
 * 取路径的目录部分，不在虚拟工作区中解析路径。
 */
function dirName(path: string): string {
  const trimmed = stripTrailingSlashes(path);
  if (!trimmed) return path ? "/" : ".";
  const index = trimmed.lastIndexOf("/");
  if (index < 0) return ".";
  const parent = stripTrailingSlashes(trimmed.slice(0, index));
  return parent || "/";
}
type RangeRequest = { count: number; file: string } | "limit" | undefined;
/**
 * Parses `head` and `tail` arguments, separating an invalid call from an oversized count.
 * 解析 `head` 与 `tail` 的参数，区分非法调用与超限行数。
 */
function parseRange(args: string[]): RangeRequest {
  const [first, second, third] = args;
  if (first !== "-n")
    return args.length === 1 && first !== undefined ? { count: 10, file: first } : undefined;
  if (second === undefined || third === undefined || args.length !== 3) return undefined;
  const count = Number(second);
  if (!Number.isInteger(count) || count < 0) return undefined;
  return count > OUTPUT_LINES ? "limit" : { count, file: third };
}
/**
 * Builds `head` and `tail` from one parser and one reader.
 * 用同一套解析与读取逻辑构建 `head` 与 `tail`。
 */
function rangeCommand(
  name: "head" | "tail",
  pick: (lines: string[], count: number) => string[],
): CommandDefinition {
  return {
    name,
    group: "files",
    summary: "",
    summaryKey: name === "head" ? "summary.head" : "summary.tail",
    usage: `${name} [-n <count>] <file>`,
    complete: (args, ctx) =>
      args.at(-1)?.startsWith("-")
        ? []
        : completePath(
            args.filter((arg) => !arg.startsWith("-")),
            ctx,
          ),
    execute: async (args, ctx, signal) => {
      const request = parseRange(args);
      if (request === undefined) return usage(ctx, name);
      if (request === "limit")
        return [line(ctx.t("error.lineCount", { limit: OUTPUT_LINES }), "error")];
      try {
        const lines = splitLines(await ctx.workspace.read(request.file, signal));
        const selected = pick(lines, Math.min(request.count, lines.length));
        return selected.length ? [line(selected.join("\n"))] : [];
      } catch (error) {
        return [executionError(ctx, error)];
      }
    },
  };
}
interface Counts {
  lines: number;
  words: number;
  bytes: number;
}
const measure = (text: string): Counts => ({
  lines: splitLines(text).length,
  words: text.split(/\s+/).filter(Boolean).length,
  bytes: new TextEncoder().encode(text).length,
});
const columns = (counts: Counts, option: string | undefined): number[] => {
  if (option === "-l") return [counts.lines];
  if (option === "-w") return [counts.words];
  if (option === "-c") return [counts.bytes];
  return [counts.lines, counts.words, counts.bytes];
};
const row = (counts: Counts, option: string | undefined, name: string): string =>
  [...columns(counts, option), name].join(" ");
const wcOptions = ["-l", "-w", "-c"];
const sortOptions = ["-r"];

export const textCommands: CommandDefinition[] = [
  {
    name: "basename",
    group: "files",
    summary: "",
    summaryKey: "summary.basename",
    usage: "basename <path> [suffix]",
    execute: (args, ctx) => {
      const [path, suffix] = args;
      if (path === undefined || args.length > 2) return usage(ctx, "basename");
      return [line(removeSuffix(baseName(path), suffix))];
    },
  },
  {
    name: "dirname",
    group: "files",
    summary: "",
    summaryKey: "summary.dirname",
    usage: "dirname <path>",
    execute: (args, ctx) => {
      const [path] = args;
      if (path === undefined || args.length !== 1) return usage(ctx, "dirname");
      return [line(dirName(path))];
    },
  },
  rangeCommand("head", (lines, count) => lines.slice(0, count)),
  rangeCommand("tail", (lines, count) => lines.slice(lines.length - count)),
  {
    name: "wc",
    group: "files",
    summary: "",
    summaryKey: "summary.wc",
    usage: "wc [option] <file...>",
    usageParams: wcOptions,
    complete: (args, ctx) =>
      args.at(-1)?.startsWith("-")
        ? []
        : completePath(
            args.filter((arg) => !arg.startsWith("-")),
            ctx,
            { multiple: true },
          ),
    execute: async (args, ctx, signal) => {
      const options = args.filter((arg) => arg.startsWith("-"));
      const files = args.filter((arg) => !arg.startsWith("-"));
      if (
        !files.length ||
        options.length > 1 ||
        options.some((option) => !wcOptions.includes(option))
      )
        return usage(ctx, "wc");
      const option = options[0];
      const totals: Counts = { lines: 0, words: 0, bytes: 0 };
      const failures: EntryInput[] = [];
      for (const file of files) {
        try {
          const counts = measure(await ctx.workspace.read(file, signal));
          totals.lines += counts.lines;
          totals.words += counts.words;
          totals.bytes += counts.bytes;
          ctx.write(line(row(counts, option, file)));
        } catch (error) {
          failures.push(executionError(ctx, error));
        }
      }
      return files.length > 1 ? [line(row(totals, option, "total")), ...failures] : failures;
    },
  },
  {
    name: "sort",
    group: "files",
    summary: "",
    summaryKey: "summary.sort",
    usage: "sort [option] <file>",
    usageParams: sortOptions,
    complete: (args, ctx) =>
      args.at(-1)?.startsWith("-")
        ? []
        : completePath(
            args.filter((arg) => !arg.startsWith("-")),
            ctx,
          ),
    execute: async (args, ctx, signal) => {
      const options = args.filter((arg) => arg.startsWith("-"));
      const files = args.filter((arg) => !arg.startsWith("-"));
      const [file] = files;
      if (
        file === undefined ||
        files.length !== 1 ||
        options.some((option) => !sortOptions.includes(option))
      )
        return usage(ctx, "sort");
      try {
        const lines = splitLines(await ctx.workspace.read(file, signal));
        if (lines.length > OUTPUT_LINES)
          return [line(ctx.t("error.outputLimit", { limit: OUTPUT_LINES }), "error")];
        if (!lines.length) return [];
        const sorted = lines.sort();
        return [line((options.length ? sorted.reverse() : sorted).join("\n"))];
      } catch (error) {
        return [executionError(ctx, error)];
      }
    },
  },
];
