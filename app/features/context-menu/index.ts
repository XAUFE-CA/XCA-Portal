export { default as ContextMenuHost } from "./components/ContextMenuHost.vue";
export { centerOf, copyFeedbackKey, type MenuPoint, resolveOpenPoint } from "./core/menu-model";
export {
  copyImage,
  copyText,
  readClipboard,
  selectionWithin,
} from "./presentation/actions/clipboard";
export { copyLinkResult, copyResult } from "./presentation/actions/copy-result";
export { anchorWithin, linkMenuEntries } from "./presentation/actions/entries";
export {
  applyPreferenceRow,
  type PreferenceActions,
  preferenceMenuEntries,
} from "./presentation/actions/preferences";
export {
  type ContextMenuState,
  useAboutMenu,
  useLinkMenu,
  useTitleMenu,
} from "./presentation/regions/regions";
export {
  lastCommandOf,
  runTerminalMenuAction,
  type TerminalMenuActions,
  terminalMenuEntries,
} from "./presentation/regions/terminal-menu";
export type { ContextMenuConfig, RegionRef } from "./presentation/useContextMenu";
export { useContextMenu } from "./presentation/useContextMenu";
