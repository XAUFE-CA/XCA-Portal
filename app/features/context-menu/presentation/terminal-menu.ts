import type { ContextMenuEntry } from "@neoverse-ui/vue";
import type { Translator } from "~/i18n";
import type { TerminalSession } from "../../terminal/core/session";
import { selectionWithin } from "./clipboard";

export interface TerminalMenuActions {
  toggleExpanded: () => void;
  expanded: () => boolean;
  /** Inserts pasted text at the command-line caret. */
  insertText: (text: string) => void;
}

/**
 * The last non-empty command, which is the only history row the menu offers to copy.
 * 最后一条非空命令，也是菜单唯一提供复制的历史行。
 */
export function lastCommandOf(session: TerminalSession): string | undefined {
  for (let index = session.history.length - 1; index >= 0; index--) {
    const entry = session.history[index];
    if (entry !== undefined && entry.trim().length > 0) return entry;
  }
  return undefined;
}

/**
 * Terminal rows run through the registered commands, so the menu cannot become a
 * second writer of output, history or appearance.
 * 终端菜单项通过已注册命令执行，菜单因此不会成为输出、历史或外观的第二个写入方。
 */
export function terminalMenuEntries(
  session: TerminalSession,
  actions: TerminalMenuActions,
  t: Translator,
  root: Element | null,
): ContextMenuEntry[] {
  const background = session.appearanceRegistry.backgrounds;
  const selected = session.appearance.background;
  const selection = selectionWithin(root);
  const hasCommand = lastCommandOf(session) !== undefined;

  return [
    { id: "copy-selection", label: t("contextMenu.copySelection"), disabled: !selection },
    { id: "paste", label: t("contextMenu.paste"), shortcut: "Ctrl+V", disabled: session.running },
    {
      id: "copy-last-command",
      label: t("contextMenu.copyLastCommand"),
      disabled: !hasCommand,
    },
    { type: "separator", id: "sep-history" },
    { id: "clear-screen", label: t("contextMenu.clearScreen"), shortcut: "Ctrl+L" },
    { id: "clear-history", label: t("contextMenu.clearHistory") },
    { type: "separator", id: "sep-appearance" },
    ...[...background.values()].map((profile) => ({
      id: `background:${profile.id}`,
      label: profile.labelKey ? t(profile.labelKey) : profile.label,
      group: "background",
      selection: "single" as const,
      checked: profile.id === selected,
    })),
    { type: "separator", id: "sep-window" },
    {
      id: "toggle-expanded",
      label: actions.expanded() ? t("contextMenu.restore") : t("contextMenu.expand"),
    },
    { id: "replay-intro", label: t("contextMenu.replayIntro") },
  ];
}

/**
 * Runs a chosen row and returns the text to copy when the row copies; every other row
 * acts through the session and returns nothing. Clipboard access stays with the region.
 * 执行选中的行；该行复制文本时返回待复制内容，其余行通过会话执行且不返回值。剪贴板访问留给区域。
 */
export function runTerminalMenuAction(
  id: string,
  session: TerminalSession,
  actions: TerminalMenuActions,
  root: Element | null,
): string | undefined {
  if (id === "copy-selection") return selectionWithin(root);
  if (id === "copy-last-command") return lastCommandOf(session);
  if (id === "clear-screen") void session.execute("clear");
  else if (id === "clear-history") void session.execute("xca history clear");
  else if (id.startsWith("background:")) void session.execute(`xca background ${id.slice(11)}`);
  else if (id === "toggle-expanded") actions.toggleExpanded();
  else if (id === "replay-intro") void session.execute("xca intro");
  return undefined;
}
