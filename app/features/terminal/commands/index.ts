import type { CommandDefinition } from "../core/types";
import { commandDetails, completeHelp, line, listHelp, resolveCommand, usage } from "./helpers";
import { interactiveCommands } from "./interactive";
import { linuxCommands } from "./linux";
import { xcaCommand } from "./site";

export const terminalCommands: CommandDefinition[] = [
  {
    name: "help",
    summary: "",
    summaryKey: "summary.help",
    usage: "help [command...]",
    complete: (args, ctx) => completeHelp(args, ctx.listCommands()),
    execute: (args, ctx) => {
      if (!args.length) return listHelp(ctx.listCommands(), ctx);
      const command = resolveCommand(ctx.listCommands(), args);
      return command ? commandDetails(command, ctx) : [line(ctx.t("command.missing"), "error")];
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    summary: "",
    summaryKey: "summary.clear",
    usage: "clear",
    execute: (args, ctx) => {
      if (args.length) return usage("clear", ctx.t);
      ctx.clear();
    },
  },
  {
    name: "history",
    summary: "",
    summaryKey: "summary.history",
    usage: "history",
    execute: (args, ctx) =>
      args.length
        ? usage("history", ctx.t)
        : ctx
            .history()
            .map((item, i) => line(`${String(i + 1).padStart(2, "0")}  ${item}`, "muted")),
  },
  {
    name: "whoami",
    summary: "",
    summaryKey: "summary.whoami",
    usage: "whoami",
    execute: async (args, ctx, signal) => {
      if (args.length) return usage("whoami", ctx.t);
      const identity = await ctx.services.auth?.getSession(signal);
      ctx.setIdentity(identity ?? null);
      return identity
        ? [line(`${identity.user}  /  ${identity.label}`, "accent")]
        : [
            line(ctx.t("command.guestIdentity", { user: ctx.identity().user }), "accent"),
            line(ctx.t("command.membersUnavailable"), "muted"),
          ];
    },
  },
  ...linuxCommands,
  ...interactiveCommands,
  xcaCommand,
];
