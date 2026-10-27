import type { CommandDefinition } from "../core/types";
import { line, matching, usage } from "./helpers";

/**
 * Background settings remain; terminal typography is permanently Maple Mono NF CN.
 * 背景设置可调整；终端字体固定为 Maple Mono NF CN。
 */
export const appearanceCommands: CommandDefinition[] = [
  {
    name: "background",
    summary: "",
    summaryKey: "summary.background",
    usage: "xca background [preset]",
    complete: (args, ctx) =>
      args.length > 1 ? [] : matching([...ctx.appearance.backgrounds.keys()], args.at(-1)),
    execute: (args, ctx) => {
      const profiles = ctx.appearance.backgrounds;
      if (!args.length)
        return [...profiles.values()].map((profile) =>
          line(
            `${profile.id === ctx.getAppearance().background ? "*" : " "} ${profile.id}  ${profile.labelKey ? ctx.t(profile.labelKey) : profile.label}`,
            "muted",
          ),
        );
      const [preset] = args;
      if (args.length !== 1 || preset === undefined || !profiles.has(preset))
        return usage(`xca background ${[...profiles.keys()].join(" | ")}`, ctx.t);
      ctx.setAppearance({ background: preset });
      return [line(ctx.t("background.changed", { preset }), "success")];
    },
  },
];
