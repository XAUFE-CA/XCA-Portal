import type { MessageParams } from "../../../i18n";
import { INTRO_PACING } from "./timing";

export type BootCue =
  | "boot.start"
  | "boot.initializing"
  | "boot.commands"
  | "boot.theme"
  | "boot.content"
  | "boot.ready";
/**
 * Linux-inspired presentation sequence; no shell or kernel calls are executed.
 * 仿 Linux 的展示序列，不执行任何 Shell 或内核调用。
 */
export type BootLine = {
  status: "0.000" | "...." | "OK";
  message: { key: BootCue; params?: MessageParams };
  tone: "info" | "ok";
};
export type BootStep = {
  line: (registeredCommands: number) => BootLine;
  delayUnits: number;
};
export const BOOT_SEQUENCE: readonly BootStep[] = [
  {
    line: () => ({ status: "0.000", message: { key: "boot.start" }, tone: "info" }),
    delayUnits: 0.32,
  },
  {
    line: () => ({ status: "....", message: { key: "boot.initializing" }, tone: "info" }),
    delayUnits: 0.65,
  },
  {
    line: (count) => ({
      status: "OK",
      message: { key: "boot.commands", params: { count } },
      tone: "ok",
    }),
    delayUnits: 0.54,
  },
  { line: () => ({ status: "OK", message: { key: "boot.theme" }, tone: "ok" }), delayUnits: 0.42 },
  {
    line: () => ({ status: "OK", message: { key: "boot.content" }, tone: "ok" }),
    delayUnits: 0.51,
  },
  {
    line: () => ({ status: "OK", message: { key: "boot.ready" }, tone: "ok" }),
    delayUnits: INTRO_PACING.arrival,
  },
];
