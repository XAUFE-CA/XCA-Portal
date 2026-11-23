import type { BootLine, BootStep } from "~/features/terminal/components/presentation-contract";

export const BOOT_CUES: readonly BootStep[] = [
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
];

export const BOOT_CONTENT: BootStep = {
  line: () => ({ status: "OK", message: { key: "boot.content" }, tone: "ok" }),
  delayUnits: 0.51,
};

export const BOOT_READY: BootLine = { status: "OK", message: { key: "boot.ready" }, tone: "ok" };
