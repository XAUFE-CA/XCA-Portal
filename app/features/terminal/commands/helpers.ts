import { defaultTranslator, type Translator } from "../../../i18n";
import type { CommandContext, CommandDefinition, EntryInput, TerminalTone } from "../core/types";
export const line = (text: string, tone: TerminalTone = "normal"): EntryInput => ({
  type: "line",
  text,
  tone,
});
export const usage = (value: string, t: Translator = defaultTranslator): EntryInput[] => [
  line(t("command.usage", { usage: value }), "error"),
];
export const matching = (values: string[], prefix = "") =>
  values.filter((value) => value.startsWith(prefix));

export function resolveCommand(
  commands: CommandDefinition[],
  path: string[],
): CommandDefinition | undefined {
  let command: CommandDefinition | undefined;
  for (const name of path) {
    command = commands.find(
      (item) => item.name === name.toLowerCase() || item.aliases?.includes(name.toLowerCase()),
    );
    if (!command) return undefined;
    commands = command.subcommands ?? [];
  }
  return command;
}

export function completeHelp(args: string[], commands: CommandDefinition[]): string[] {
  if (args.length > 1) commands = resolveCommand(commands, args.slice(0, -1))?.subcommands ?? [];
  return matching(
    commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
    args.at(-1)?.toLowerCase(),
  );
}

export function commandDetails(command: CommandDefinition, ctx: CommandContext): EntryInput[] {
  return [
    line(command.usageKey ? ctx.t(command.usageKey) : command.usage, "accent"),
    line(command.summaryKey ? ctx.t(command.summaryKey) : command.summary, "muted"),
    ...(command.subcommands ? listHelp(command.subcommands, ctx, `${command.name} `) : []),
  ];
}

export function listHelp(
  commands: CommandDefinition[],
  ctx: CommandContext,
  prefix = "",
): EntryInput[] {
  const width = Math.max(...commands.map((command) => command.name.length)) + 2;
  return [
    line(ctx.t("command.available"), "accent"),
    line(ctx.t("command.helpHint"), "muted"),
    ...commands.map((command) =>
      line(
        prefix +
          command.name.padEnd(width) +
          " " +
          (command.summaryKey ? ctx.t(command.summaryKey) : command.summary),
        "muted",
      ),
    ),
  ];
}

export function completePath(
  args: string[],
  ctx: CommandContext,
  options: { multiple?: boolean; directoriesOnly?: boolean } = {},
): string[] {
  if (!options.multiple && args.length > 1) return [];
  // Tab ends a file token with a space; do not reoffer that file as the next argument.
  // Tab 会以空格结束文件标记；不要将同一文件再次作为下一个参数提供。
  const completed = new Set(args.slice(0, -1).map((path) => ctx.workspace.resolve(path)));
  return ctx.workspace
    .complete(args.at(-1) ?? "")
    .filter(
      (path) =>
        !completed.has(ctx.workspace.resolve(path)) &&
        (!options.directoriesOnly || ctx.workspace.node(path).kind === "directory"),
    );
}
