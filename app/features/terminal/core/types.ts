import type { MessageKey, MessageParams, SiteLocale, Translator } from "../../../i18n";

export type TerminalTone = "normal" | "muted" | "success" | "error" | "accent";
export type TerminalEntry =
  | {
      id: number;
      type: "line";
      text: string;
      tone: TerminalTone;
      message?: { key: MessageKey; params?: MessageParams };
    }
  | { id: number; type: "command"; source: string; prompt: PromptIdentity }
  | { id: number; type: "banner" }
  | { id: number; type: "links"; items: { label: string; route: string }[] };
export type EntryInput = TerminalEntry extends infer T
  ? T extends { id: number }
    ? Omit<T, "id">
    : never
  : never;
export type ThemeChoice = "light" | "dark" | "system";
export type CommandGroup = "session" | "files" | "system" | "site";
export interface PromptIdentity {
  user: string;
  host: string;
  directory: string;
  status: number;
}
export interface TerminalSize {
  columns: number;
  rows: number;
}
export interface TerminalMenuItem {
  id: string;
  label: string;
  description?: string;
}
export type TerminalInteraction =
  | { type: "prompt"; label: string; kind: "text" | "secret" | "otp"; submit(value: string): void }
  | { type: "menu"; title: string; items: readonly TerminalMenuItem[]; select(id: string): void };
/**
 * Framework-neutral TUI surface; keyboard and resize events reach only the active app.
 * 与框架无关的 TUI 界面。键盘和尺寸事件仅传递给当前活动的应用。
 */
export interface TerminalApplication {
  title: string;
  lines: readonly string[];
  onKey(key: string): void;
  onResize?(size: TerminalSize): void;
  dispose?(): void;
}
export interface AuthIdentity {
  user: string;
  label: string;
}
export interface AuthGateway {
  getSession(signal: AbortSignal): Promise<AuthIdentity | null>;
  login(context: Pick<CommandContext, "ask" | "write">, signal: AbortSignal): Promise<AuthIdentity>;
  logout(signal: AbortSignal): Promise<void>;
}
export interface TerminalServices {
  getLocale?(): SiteLocale;
  navigate(route: string): Promise<void> | void;
  getTheme(): ThemeChoice;
  setTheme(value: ThemeChoice): void;
  replayIntro(): void;
  auth?: AuthGateway;
  now?: () => Date;
}
export interface CommandContext {
  t: Translator;
  services: TerminalServices;
  // Current terminal width in character cells, so output can fit the measured screen.
  // 当前终端列数，使输出能够适配实测屏幕宽度。
  columns(): number;
  listCommands(): CommandDefinition[];
  history(): string[];
  clear(): void;
  workspace: import("./workspace").VirtualWorkspace;
  appearance: import("./appearance").AppearanceRegistry;
  getAppearance(): import("./appearance").TerminalAppearance;
  setAppearance(value: Partial<import("./appearance").TerminalAppearance>): void;
  identity(): PromptIdentity;
  setIdentity(identity: AuthIdentity | null): void;
  write(...entries: EntryInput[]): void;
  ask(request: { label: string; kind: "text" | "secret" | "otp" }): Promise<string>;
  choose(title: string, items: readonly TerminalMenuItem[]): Promise<string>;
  openApplication(application: TerminalApplication): void;
  closeApplication(): void;
  refresh(): void;
}
export interface CommandDefinition {
  name: string;
  summary: string;
  summaryKey?: MessageKey;
  usage: string;
  usageKey?: MessageKey;
  // Accepted values shown beneath the usage line; functions can read runtime registries.
  // 显示在用法行下方的可接受值。函数形式用于读取运行时注册表。
  usageParams?: readonly string[] | ((context: CommandContext) => readonly string[]);
  group?: CommandGroup;
  aliases?: string[];
  subcommands?: CommandDefinition[];
  complete?(args: string[], context: CommandContext): string[];
  sensitive?: boolean;
  execute(
    args: string[],
    context: CommandContext,
    signal: AbortSignal,
  ): Promise<EntryInput[] | void> | EntryInput[] | void;
}
