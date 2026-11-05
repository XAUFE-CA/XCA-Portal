import { TERMINAL } from "../config";
import { CommandRegistry } from "../core/registry";
import type { CommandDefinition } from "../core/types";
import { appearanceCommands } from "./appearance";
import {
  commandDetails,
  completeHelp,
  line,
  listHelp,
  matching,
  resolveCommand,
  usage,
} from "./helpers";
import { exploreCommand } from "./interactive";

const pages = Object.keys(TERMINAL.routes);
const themes = ["light", "dark", "system"] as const;
const isTheme = (value: string | undefined): value is (typeof themes)[number] =>
  value !== undefined && themes.some((theme) => theme === value);

const subcommands: CommandDefinition[] = [
  {
    name: "open",
    summary: "",
    summaryKey: "summary.open",
    usage: "xca open <page>",
    usageParams: pages,
    complete: (args) => (args.length > 1 ? [] : matching(pages, args.at(-1))),
    execute: async (args, ctx) => {
      const paths: Record<string, string> = TERMINAL.routes;
      const [page] = args;
      const route = page !== undefined && Object.hasOwn(paths, page) ? paths[page] : undefined;
      if (args.length !== 1 || page === undefined || !route) return usage(ctx, "open");
      await ctx.services.navigate(route);
      return [line(ctx.t("command.opening", { page }), "success")];
    },
  },
  {
    name: "theme",
    summary: "",
    summaryKey: "summary.theme",
    usage: "xca theme [theme]",
    usageParams: themes,
    complete: (args) => (args.length > 1 ? [] : matching(themes, args.at(-1))),
    execute: (args, ctx) => {
      if (!args.length)
        return [
          line(
            ctx.t("command.themeCurrent", { theme: ctx.t(`theme.${ctx.services.getTheme()}`) }),
            "accent",
          ),
        ];
      const [theme] = args;
      if (args.length !== 1 || !isTheme(theme)) return usage(ctx, "theme");
      ctx.services.setTheme(theme);
      return [
        line(
          ctx.t("command.themeChanged", { theme: ctx.t(`theme.${ctx.services.getTheme()}`) }),
          "success",
        ),
      ];
    },
  },
  {
    name: "banner",
    summary: "",
    summaryKey: "summary.banner",
    usage: "xca banner",
    execute: (args, ctx) => (args.length ? usage(ctx, "banner") : [{ type: "banner" }]),
  },
  {
    name: "intro",
    summary: "",
    summaryKey: "summary.intro",
    usage: "xca intro",
    execute: (args, ctx) => {
      if (args.length) return usage(ctx, "intro");
      ctx.services.replayIntro();
    },
  },
  ...appearanceCommands,
  exploreCommand,
];
const registry = new CommandRegistry();
for (const command of subcommands) registry.register(command);

export const xcaCommand: CommandDefinition = {
  name: "xca",
  group: "site",
  summary: "",
  summaryKey: "summary.xca",
  usage: "xca <command> [args]",
  subcommands,
  complete: (args, ctx) => {
    const [name = "", ...rest] = args;
    if (args.length <= 1) return matching(["help", ...registry.complete(name)], name.toLowerCase());
    if (name.toLowerCase() === "help") return completeHelp(rest, subcommands);
    return registry.resolve(name)?.complete?.(rest, ctx) ?? [];
  },
  execute: (args, ctx, signal) => {
    const [name, ...rest] = args;
    if (!name || ["help", "--help", "-h"].includes(name.toLowerCase())) {
      if (!rest.length) return listHelp(subcommands, ctx, "xca ");
      const command = resolveCommand(subcommands, rest);
      return command ? commandDetails(command, ctx) : usage(ctx, "help");
    }
    const command = registry.resolve(name);
    if (!command) throw new Error(ctx.t("error.notFound", { name: `xca ${name}` }));
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h"))
      return commandDetails(command, ctx);
    return command.execute(rest, ctx, signal);
  },
};
