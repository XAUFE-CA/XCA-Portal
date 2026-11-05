import type { BootStep } from "~/features/terminal/components/presentation-contract";
import { INTRO_PACING } from "../core/timing";

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
