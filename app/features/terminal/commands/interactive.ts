import { TERMINAL } from "../config";
import type { CommandDefinition } from "../core/types";
import { authError, completePath, executionError, line, listHelp, usage } from "./helpers";

export const exploreCommand: CommandDefinition = {
  name: "explore",
  summary: "",
  summaryKey: "summary.explore",
  usage: "xca explore",
  execute: async (args, ctx, signal) => {
    if (args.length) return usage(ctx, "explore");
    const id = await ctx.choose(ctx.t("command.exploreTitle"), [
      { id: "help", label: ctx.t("summary.help") },
      { id: "theme", label: ctx.t("theme.label") },
    ]);
    signal.throwIfAborted();
    return id === "help"
      ? listHelp(ctx.listCommands(), ctx)
      : [
          line(
            ctx.t("command.themeCurrent", { theme: ctx.t(`theme.${ctx.services.getTheme()}`) }),
            "accent",
          ),
        ];
  },
};

export const interactiveCommands: CommandDefinition[] = [
  {
    name: "less",
    group: "files",
    summary: "",
    summaryKey: "summary.less",
    usage: "less <file>",
    usageKey: "command.lessUsage",
    complete: (args, ctx) => completePath(args, ctx),
    execute: async (args, ctx, signal) => {
      const [file] = args;
      if (args.length !== 1 || file === undefined) return usage(ctx, "less");
      let text: string;
      try {
        text = await ctx.workspace.read(file, signal);
      } catch (error) {
        return [executionError(ctx, error)];
      }
      const rows = text.split("\n");
      let offset = 0;
      let pageSize = 10;
      const application = {
        title: ctx.t("command.lessTitle", { file }),
        lines: [] as string[],
        onResize(size: { rows: number }) {
          pageSize = Math.max(1, size.rows - 3);
          render();
        },
        onKey(key: string) {
          if (["q", "Escape"].includes(key)) {
            ctx.closeApplication();
            return;
          }
          if (["ArrowDown", "j"].includes(key)) offset++;
          if (["ArrowUp", "k"].includes(key)) offset--;
          if (["PageDown", " "].includes(key)) offset += pageSize;
          if (key === "PageUp") offset -= pageSize;
          if (key === "Home") offset = 0;
          if (key === "End") offset = rows.length;
          render();
        },
      };
      function render() {
        offset = Math.max(0, Math.min(offset, Math.max(0, rows.length - pageSize)));
        application.lines = rows.slice(offset, offset + pageSize);
        ctx.refresh();
      }
      ctx.openApplication(application);
    },
  },
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
