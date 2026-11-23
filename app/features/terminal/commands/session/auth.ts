import { TERMINAL } from "../../config";
import type { CommandDefinition } from "../../core/types";
import { authError, line, usage } from "../helpers";

export const authCommands: CommandDefinition[] = [
  {
    name: "login",
    group: "session",
    summary: "",
    summaryKey: "summary.login",
    usage: "login",
    sensitive: true,
    timeoutMs: TERMINAL.limits.loginTimeout,
    execute: async (args, ctx, signal) => {
      if (args.length) return usage(ctx, "login");
      if (!ctx.services.auth) return [line(ctx.t("auth.unavailable"), "error")];
      const previous = ctx.identity().user;
      const result = await ctx.services.auth.login(ctx, signal);
      if (!result.ok) return [authError(result, ctx)];
      if (!ctx.setIdentity(result.value)) return [];
      return previous === result.value.user
        ? []
        : [line(ctx.t("command.welcomeMember", { name: result.value.label }), "success")];
    },
  },
  {
    name: "logout",
    group: "session",
    summary: "",
    summaryKey: "summary.logout",
    usage: "logout",
    execute: async (args, ctx, signal) => {
      if (args.length) return usage(ctx, "logout");
      if (!ctx.services.auth) return [line(ctx.t("command.guest"), "muted")];
      const result = await ctx.services.auth.logout(signal);
      if (!result.ok) return [authError(result, ctx)];
      if (!ctx.setIdentity(null)) return [];
      ctx.clear();
      return [line(ctx.t("command.loggedOut"), "success")];
    },
  },
];
