import { TERMINAL } from "../config";
import type { CommandDefinition } from "../core/types";
import { commandDetails, completeHelp, completePath, line, resolveCommand, usage } from "./helpers";

export const linuxCommands: CommandDefinition[] = [
  {
    name: "pwd",
    summary: "",
    summaryKey: "summary.pwd",
    usage: "pwd",
    execute: (args, ctx) => (args.length ? usage("pwd", ctx.t) : [line(ctx.workspace.cwd)]),
  },
  {
    name: "ls",
    summary: "",
    summaryKey: "summary.ls",
    usage: "ls [-a|-l|-la] [path]",
    complete: (args, ctx) =>
      args.at(-1)?.startsWith("-")
        ? []
        : completePath(
            args.filter((arg) => !arg.startsWith("-")),
            ctx,
          ),
    execute: (args, ctx) => {
      if (args.some((arg) => arg.startsWith("-") && !/^-[al]+$/.test(arg)))
        return usage("ls [-a|-l|-la] [path]", ctx.t);
      const paths = args.filter((arg) => !arg.startsWith("-"));
      if (paths.length > 1) return usage("ls [-a|-l|-la] [path]", ctx.t);
      const detailed = args.some((arg) => arg.startsWith("-") && arg.includes("l"));
      return ctx.workspace
        .list(paths[0])
        .map((node) =>
          line(
            (detailed ? `${node.kind === "directory" ? "dr-xr-xr-x" : "-r--r--r--"}  ` : "") +
              node.path.split("/").at(-1) +
              (node.kind === "directory" ? "/" : ""),
            node.kind === "directory" ? "accent" : "normal",
          ),
        );
    },
  },
  {
    name: "cd",
    summary: "",
    summaryKey: "summary.cd",
    usage: "cd [path]",
    complete: (args, ctx) => completePath(args, ctx, { directoriesOnly: true }),
    execute: (args, ctx) => {
      if (args.length > 1) return usage("cd [path]", ctx.t);
      ctx.workspace.cd(args[0]);
    },
  },
  {
    name: "cat",
    summary: "",
    summaryKey: "summary.cat",
    usage: "cat <file...>",
    complete: (args, ctx) => completePath(args, ctx, { multiple: true }),
    execute: async (args, ctx, signal) => {
      if (!args.length) return usage("cat <file...>", ctx.t);
      const output = [];
      for (const path of args) output.push(line(await ctx.workspace.read(path, signal)));
      return output;
    },
  },
  {
    name: "echo",
    summary: "",
    summaryKey: "summary.echo",
    usage: "echo [-n] [text...]",
    execute: (args) => [line((args[0] === "-n" ? args.slice(1) : args).join(" "))],
  },
  {
    name: "date",
    summary: "",
    summaryKey: "summary.date",
    usage: "date [-u|--iso]",
    execute: (args, ctx) => {
      if (args.length > 1 || (args[0] && !["-u", "--iso"].includes(args[0])))
        return usage("date [-u|--iso]", ctx.t);
      const now = ctx.services.now?.() ?? new Date();
      return [
        line(
          args[0] === "-u"
            ? now.toUTCString()
            : args[0] === "--iso"
              ? now.toISOString()
              : now.toLocaleString(ctx.services.getLocale?.() ?? "zh-CN"),
        ),
      ];
    },
  },
  {
    name: "uname",
    summary: "",
    summaryKey: "summary.uname",
    usage: "uname [-a]",
    execute: (args, ctx) =>
      args.length > 1 || (args[0] && args[0] !== "-a")
        ? usage("uname [-a]", ctx.t)
        : [
            line(
              args[0]
                ? `${TERMINAL.identity.platform} ${TERMINAL.identity.host} ${TERMINAL.identity.shell}`
                : TERMINAL.identity.platform,
            ),
          ],
  },
  {
    name: "hostname",
    summary: "",
    summaryKey: "summary.hostname",
    usage: "hostname",
    execute: (args, ctx) =>
      args.length ? usage("hostname", ctx.t) : [line(TERMINAL.identity.host)],
  },
  {
    name: "env",
    aliases: ["printenv"],
    summary: "",
    summaryKey: "summary.env",
    usage: "env",
    execute: (args, ctx) =>
      args.length
        ? usage("env", ctx.t)
        : [
            line(
              `USER=${ctx.identity().user}\nHOME=${TERMINAL.identity.home}\nPWD=${ctx.workspace.cwd}\nSHELL=${TERMINAL.identity.shell}\nTERM=xca-browser\nSIMULATED=true`,
            ),
          ],
  },
  {
    name: "man",
    summary: "",
    summaryKey: "summary.man",
    usage: "man <command...>",
    complete: (args, ctx) => completeHelp(args, ctx.listCommands()),
    execute: (args, ctx) => {
      if (!args.length) return usage("man <command...>", ctx.t);
      const command = resolveCommand(ctx.listCommands(), args);
      return command
        ? [line(args.join(" ").toUpperCase(), "accent"), ...commandDetails(command, ctx)]
        : [line(ctx.t("command.manualMissing", { name: args.join(" ") }), "error")];
    },
  },
];
