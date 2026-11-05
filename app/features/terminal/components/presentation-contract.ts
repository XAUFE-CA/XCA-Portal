import type { MessageParams } from "~/i18n";

/**
 * Presentation stages a host reports while the terminal settles into the page.
 * 终端进入页面时宿主上报的展示阶段。
 */
export type TerminalPresentationStage =
  | "logo"
  | "handoff"
  | "boot"
  | "brand"
  | "dock"
  | "reveal"
  | "ready";

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
