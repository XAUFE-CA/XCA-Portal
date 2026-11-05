import { TERMINAL } from "../config";
import type { CommandContext, CommandDefinition } from "../core/types";
import { line, OUTPUT_LINES, usage } from "./helpers";

const USER_ID = 1000;
const SLEEP_LIMIT = 5;
const dateOptions = ["-u", "--iso"];
const unameOptions = ["-a"];
const toNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const formatValue = (value: number): string => String(Number(value.toFixed(10)));
const environment = (ctx: CommandContext): Record<string, string> => ({
  USER: ctx.identity().user,
  HOME: TERMINAL.identity.home,
  PWD: ctx.workspace.cwd,
  SHELL: TERMINAL.identity.shell,
  TERM: "xca-browser",
});
const formatEnvironment = (variables: Record<string, string>) =>
  Object.entries(variables)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
/**
 * Waits for a delay and clears the timer as soon as the signal aborts.
 * 等待指定时长，并在信号中止时立即清理定时器。
 */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
interface Sequence {
  start: number;
  step: number;
  last: number;
}
/**
 * Reads 1, 2 or 3 numbers into the start, step and last positions of `seq`.
 * 将 1、2 或 3 个数字分别读入 `seq` 的起点、步长与终点。
 */
function parseSequence(values: number[]): Sequence {
  const [first = 1, second = 1, third = 1] = values;
  if (values.length === 1) return { start: 1, step: 1, last: first };
  if (values.length === 2) return { start: first, step: 1, last: second };
  return { start: first, step: second, last: third };
}

export const systemCommands: CommandDefinition[] = [
  {
    name: "echo",
    group: "system",
    summary: "",
    summaryKey: "summary.echo",
    usage: "echo [text...]",
    execute: (args) => [line(args.join(" "))],
  },
  {
    name: "date",
    group: "system",
    summary: "",
    summaryKey: "summary.date",
    usage: "date [option]",
    usageParams: dateOptions,
    execute: (args, ctx) => {
      const [option] = args;
      if (args.length > 1 || (option !== undefined && !dateOptions.includes(option)))
        return usage(ctx, "date");
      const now = ctx.services.now?.() ?? new Date();
      return [
        line(
          option === "-u"
            ? now.toUTCString()
            : option === "--iso"
              ? now.toISOString()
              : now.toLocaleString(ctx.services.getLocale?.() ?? "zh-CN"),
        ),
      ];
    },
  },
  {
    name: "uname",
    group: "system",
    summary: "",
    summaryKey: "summary.uname",
    usage: "uname [option]",
    usageParams: unameOptions,
    execute: (args, ctx) => {
      const [option] = args;
      return args.length > 1 || (option !== undefined && !unameOptions.includes(option))
        ? usage(ctx, "uname")
        : [
            line(
              option
                ? `${TERMINAL.identity.platform} ${TERMINAL.identity.host} ${TERMINAL.identity.shell}`
                : TERMINAL.identity.platform,
            ),
          ];
    },
  },
  {
    name: "hostname",
    group: "system",
    summary: "",
    summaryKey: "summary.hostname",
    usage: "hostname",
    execute: (args, ctx) => (args.length ? usage(ctx, "hostname") : [line(TERMINAL.identity.host)]),
  },
  {
    name: "env",
    group: "system",
    summary: "",
    summaryKey: "summary.env",
    usage: "env",
    execute: (args, ctx) =>
      args.length ? usage(ctx, "env") : [line(formatEnvironment(environment(ctx)))],
  },
  {
    name: "printenv",
    group: "system",
    summary: "",
    summaryKey: "summary.printenv",
    usage: "printenv [variable]",
    execute: (args, ctx) => {
      if (args.length > 1) return usage(ctx, "printenv");
      const variables = environment(ctx);
      const [name] = args;
      if (name === undefined) return [line(formatEnvironment(variables))];
      const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
      return value === undefined
        ? [line(ctx.t("command.envUndefined", { name }), "error")]
        : [line(value)];
    },
  },
  {
    name: "id",
    group: "system",
    summary: "",
    summaryKey: "summary.id",
    usage: "id",
    execute: (args, ctx) => {
      if (args.length) return usage(ctx, "id");
      const user = ctx.identity().user;
      return [line(`uid=${USER_ID}(${user}) gid=${USER_ID}(${user}) groups=${USER_ID}(${user})`)];
    },
  },
  {
    name: "seq",
    group: "system",
    summary: "",
    summaryKey: "summary.seq",
    usage: "seq [first] [step] <last>",
    execute: (args, ctx) => {
      const values = args.map(toNumber);
      if (!values.length || values.length > 3 || values.some((value) => value === undefined))
        return usage(ctx, "seq");
      const { start, step, last } = parseSequence(values.map((value) => value ?? 0));
      if (!step) return usage(ctx, "seq");
      const span = (last - start) / step;
      const count = span < 0 ? 0 : Math.floor(span + 1e-9) + 1;
      if (count > OUTPUT_LINES)
        return [line(ctx.t("error.outputLimit", { limit: OUTPUT_LINES }), "error")];
      if (!count) return [];
      const rows = Array.from({ length: count }, (_, index) => formatValue(start + index * step));
      return [line(rows.join("\n"))];
    },
  },
  {
    name: "sleep",
    group: "system",
    summary: "",
    summaryKey: "summary.sleep",
    usage: "sleep <seconds>",
    execute: async (args, ctx, signal) => {
      const [value] = args;
      if (args.length !== 1 || value === undefined) return usage(ctx, "sleep");
      const seconds = toNumber(value);
      if (seconds === undefined) return usage(ctx, "sleep");
      if (seconds < 0 || seconds > SLEEP_LIMIT)
        return [line(ctx.t("error.sleepRange", { min: 0, max: SLEEP_LIMIT }), "error")];
      signal.throwIfAborted();
      if (seconds > 0) await wait(seconds * 1000, signal);
    },
  },
];
