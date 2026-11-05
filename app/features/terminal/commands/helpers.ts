import type { MessageKey } from "../../../i18n";
import type {
  CommandContext,
  CommandDefinition,
  CommandGroup,
  EntryInput,
  TerminalTone,
} from "../core/types";
export const line = (text: string, tone: TerminalTone = "normal"): EntryInput => ({
  type: "line",
  text,
  tone,
});
function findCommand(commands: CommandDefinition[], name: string): CommandDefinition | undefined {
  for (const command of commands) {
    if (command.name === name || command.aliases?.includes(name)) return command;
    const nested = findCommand(command.subcommands ?? [], name);
    if (nested) return nested;
  }
  return undefined;
}
/**
 * Lists accepted values under the syntax line so placeholders do not hide choices.
 * 在语法行下列出可接受值，避免占位符隐藏可选值。
 */
function usageParamLines(
  command: CommandDefinition | undefined,
  ctx: CommandContext,
  tone: TerminalTone,
): EntryInput[] {
  const params = command?.usageParams;
  const values = typeof params === "function" ? params(ctx) : params;
  return values?.length ? [line(ctx.t("command.params", { params: values.join(", ") }), tone)] : [];
}
/**
 * Reads usage from the registry so each command states its syntax once.
 * 从注册表读取用法，使每条命令只声明一次语法。
 */
export const usage = (ctx: CommandContext, name: string): EntryInput[] => {
  const command = findCommand(ctx.listCommands(), name);
  return [
    line(ctx.t("command.usage", { usage: command?.usage ?? name }), "error"),
    ...usageParamLines(command, ctx, "muted"),
  ];
};
/**
 * Turns a workspace failure into the Session execution error line without changing its wording.
 * 将工作区异常转换为与 Session 一致的执行错误行，不改变措辞。
 */
export const executionError = (ctx: CommandContext, error: unknown): EntryInput =>
  line(
    ctx.t("error.execution", {
      message: error instanceof Error ? error.message : ctx.t("error.unknown"),
    }),
    "error",
  );
export const matching = (values: readonly string[], prefix = "") =>
  values.filter((value) => value.startsWith(prefix));

// Shared caps keep bulk commands inside the transcript entry limit.
// 共享上限让批量命令保持在输出条目限制内。
export const OUTPUT_LINES = 200;
export const RESULT_NODES = 120;
/**
 * Splits text into logical lines, ignoring the trailing newline of a file body.
 * 将正文拆成逻辑行，忽略文件末尾换行产生的空行。
 */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

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
    ...usageParamLines(command, ctx, "muted"),
    line(command.summaryKey ? ctx.t(command.summaryKey) : command.summary, "muted"),
    ...(command.subcommands ? listHelp(command.subcommands, ctx, `${command.name} `) : []),
  ];
}

const groups: CommandGroup[] = ["session", "files", "system", "site"];
const groupKeys: Record<CommandGroup, MessageKey> = {
  session: "command.group.session",
  files: "command.group.files",
  system: "command.group.system",
  site: "command.group.site",
};
// East Asian wide and fullwidth glyphs occupy two terminal cells; box drawing stays one.
// 东亚宽字符与全宽字形占两个终端单元格，制表符仍占一个。
const WIDE_CELL =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;
export const cellWidth = (text: string): number => {
  let width = 0;
  for (const character of text) width += WIDE_CELL.test(character) ? 2 : 1;
  return width;
};
// Rules split command groups at the widest rendered line, capped one cell short of the edge.
// 分隔线按最宽的实际输出行划分命令分组，最多比终端边缘少一列。
export function listHelp(
  commands: CommandDefinition[],
  ctx: CommandContext,
  prefix = "",
): EntryInput[] {
  const nameWidth = Math.max(...commands.map((command) => command.name.length)) + 2;
  const entry = (command: CommandDefinition) =>
    line(
      prefix +
        command.name.padEnd(nameWidth) +
        " " +
        (command.summaryKey ? ctx.t(command.summaryKey) : command.summary),
      "muted",
    );
  const header = [
    line(ctx.t("command.available"), "accent"),
    line(ctx.t("command.helpHint"), "muted"),
  ];
  let blocks: EntryInput[][];
  if (commands.some((command) => command.group)) {
    blocks = groups.flatMap((group) => {
      const members = commands.filter((command) => command.group === group);
      return members.length
        ? [[line(ctx.t(groupKeys[group]), "accent"), ...members.map(entry)]]
        : [];
    });
    const ungrouped = commands.filter((command) => !command.group);
    if (ungrouped.length) blocks.push(ungrouped.map(entry));
  } else {
    blocks = [commands.map(entry)];
  }
  const widest = Math.max(
    ...[...header, ...blocks.flat()].map((row) => (row.type === "line" ? cellWidth(row.text) : 0)),
  );
  const ruleWidth = Math.max(4, Math.min(widest, ctx.columns() - 2));
  // The first group stays next to the hint; later groups get a rule above them.
  // 首组紧接提示，其余分组在标题前插入分隔线。
  const rows = blocks.flatMap((block, index) =>
    index ? [line("─".repeat(ruleWidth), "muted"), ...block] : block,
  );
  return [...header, ...rows];
}

export function completePath(
  args: string[],
  ctx: CommandContext,
  options: { multiple?: boolean; directoriesOnly?: boolean } = {},
): string[] {
  if (!options.multiple && args.length > 1) return [];
  // Tab ends a file token with a space; do not reoffer that file as the next argument.
  // Tab 会以空格结束文件标记。不要将同一文件再次作为下一个参数提供。
  const completed = new Set(args.slice(0, -1).map((path) => ctx.workspace.resolve(path)));
  return ctx.workspace
    .complete(args.at(-1) ?? "")
    .filter(
      (path) =>
        !completed.has(ctx.workspace.resolve(path)) &&
        (!options.directoriesOnly || ctx.workspace.node(path).kind === "directory"),
    );
}
