import type { CommandDefinition } from "../../core/types";
import { completePath, executionError, usage } from "../helpers";

export const lessCommand: CommandDefinition = {
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
};
