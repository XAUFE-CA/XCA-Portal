import type { CommandDefinition } from "../core/types";
import { fileCommands } from "./files";
import { commandDetails, completeHelp, line, listHelp, resolveCommand, usage } from "./helpers";
import { historyCommand } from "./history";
import { interactiveCommands } from "./interactive";
import { searchCommands } from "./search";
import { xcaCommand } from "./site";
import { systemCommands } from "./system";
import { textCommands } from "./text";

export const terminalCommands: CommandDefinition[] = [
  {
    name: "help",
    group: "session",
    summary: "",
    summaryKey: "summary.help",
    usage: "help",
    execute: (args, ctx) => (args.length ? usage(ctx, "help") : listHelp(ctx.listCommands(), ctx)),
  },
  {
    name: "man",
    group: "session",
    summary: "",
    summaryKey: "summary.man",
    usage: "man <command...>",
    complete: (args, ctx) => completeHelp(args, ctx.listCommands()),
    execute: (args, ctx) => {
      if (!args.length) return usage(ctx, "man");
      const command = resolveCommand(ctx.listCommands(), args);
      return command
        ? commandDetails(command, ctx)
        : [line(ctx.t("command.manMissing", { name: args.join(" ") }), "error")];
    },
  },
  {
    name: "clear",
    group: "session",
    summary: "",
    summaryKey: "summary.clear",
    usage: "clear",
    execute: (args, ctx) => {
      if (args.length) return usage(ctx, "clear");
      ctx.clear();
    },
  },
  historyCommand,
  {
    name: "whoami",
    group: "session",
    summary: "",
    summaryKey: "summary.whoami",
    usage: "whoami",
    execute: async (args, ctx, signal) => {
      if (args.length) return usage(ctx, "whoami");
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
  ...fileCommands,
  ...textCommands,
  ...searchCommands,
  ...systemCommands,
  ...interactiveCommands,
  xcaCommand,
];
