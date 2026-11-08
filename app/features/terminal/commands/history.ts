import type { CommandContext, CommandDefinition, EntryInput } from "../core/types";
import { line, matching, usageFor } from "./helpers";

const actions = ["clear"] as const;
const completeActions = (args: string[]) => (args.length > 1 ? [] : matching(actions, args.at(-1)));
/**
 * Lists history, clears all of it, or explains the accepted action.
 * 列出历史、清除全部历史，或说明可接受的操作。
 */
function resolveHistory(
  command: CommandDefinition,
  args: string[],
  ctx: CommandContext,
): EntryInput[] {
  const [action] = args;
  if (!action)
    return ctx
      .history()
      .map((item, index) => line(`${String(index + 1).padStart(2, "0")}  ${item}`, "muted"));
  if (args.length !== 1 || action !== "clear") return usageFor(command, ctx, command.usage);
  ctx.clearHistory();
  return [line(ctx.t("command.historyCleared"), "success")];
}

// History is a site subcommand only, so it keeps a single entry point and usage text.
// 历史只作为站点子命令，因此只保留一个入口与一份用法文本。
export const xcaHistoryCommand: CommandDefinition = {
  name: "history",
  summary: "",
  summaryKey: "summary.history",
  usage: "xca history [clear]",
  usageParams: actions,
  complete: completeActions,
  execute: (args, ctx) => resolveHistory(xcaHistoryCommand, args, ctx),
};
