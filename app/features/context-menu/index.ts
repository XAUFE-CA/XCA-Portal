export { default as ContextMenuHost } from "./components/ContextMenuHost.vue";
export { centerOf, copyFeedbackKey, type MenuPoint, resolveOpenPoint } from "./core/menu-model";
export { copyImage, copyText, readClipboard, selectionWithin } from "./presentation/clipboard";
export { copyLinkResult, copyResult } from "./presentation/copy-result";
export { anchorWithin, linkMenuEntries } from "./presentation/entries";
export {
  type ContextMenuState,
  useAboutMenu,
  useLinkMenu,
  useTitleMenu,
} from "./presentation/regions";
export {
  lastCommandOf,
  runTerminalMenuAction,
  type TerminalMenuActions,
  terminalMenuEntries,
} from "./presentation/terminal-menu";
export type { ContextMenuConfig, RegionRef } from "./presentation/useContextMenu";
export { useContextMenu } from "./presentation/useContextMenu";
