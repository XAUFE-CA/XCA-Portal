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

export const historyCommand: CommandDefinition = {
  name: "history",
  group: "session",
  summary: "",
  summaryKey: "summary.history",
  usage: "history [clear]",
  usageParams: actions,
  complete: completeActions,
  execute: (args, ctx) => resolveHistory(historyCommand, args, ctx),
};

// Both entry points need their own usage text, so they share the listing and clearing logic.
// 两个入口需要各自的用法文本，因此列表与清除逻辑共用同一实现。
export const xcaHistoryCommand: CommandDefinition = {
  name: "history",
  summary: "",
  summaryKey: "summary.history",
  usage: "xca history [clear]",
  usageParams: actions,
  complete: completeActions,
  execute: (args, ctx) => resolveHistory(xcaHistoryCommand, args, ctx),
};
