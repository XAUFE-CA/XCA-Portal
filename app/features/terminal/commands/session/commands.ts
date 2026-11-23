import type { CommandDefinition } from "../../core/types";
import {
  authError,
  commandDetails,
  completeHelp,
  line,
  listHelp,
  resolveCommand,
  usage,
} from "../helpers";

export const sessionCommands: CommandDefinition[] = [
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
  {
    name: "whoami",
    group: "session",
    summary: "",
    summaryKey: "summary.whoami",
    usage: "whoami",
    execute: async (args, ctx, signal) => {
      if (args.length) return usage(ctx, "whoami");
      if (!ctx.services.auth)
        return [line(ctx.t("command.guestIdentity", { user: ctx.identity().user }), "accent")];
      const result = await ctx.services.auth.getSession(signal);
      if (!result.ok) return [authError(result, ctx)];
      const identity = result.value;
      if (!ctx.setIdentity(identity)) return [];
      return identity
        ? [line(`${identity.user}  /  ${identity.label}`, "accent")]
        : [line(ctx.t("command.guestIdentity", { user: ctx.identity().user }), "accent")];
    },
  },
];
