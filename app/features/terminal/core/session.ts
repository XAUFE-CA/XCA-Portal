import { createTranslator } from "../../../i18n";
import { TERMINAL } from "../config";
import { AppearanceRegistry, type TerminalAppearance } from "./appearance";
import { parseCommandLine } from "./parser";
import { CommandRegistry } from "./registry";
import type {
  AuthIdentity,
  CommandContext,
  EntryInput,
  PromptIdentity,
  TerminalApplication,
  TerminalEntry,
  TerminalInteraction,
  TerminalServices,
  TerminalSize,
} from "./types";
import { VirtualWorkspace } from "./workspace";

export class TerminalSession {
  readonly t = createTranslator(() => this.services.getLocale?.() ?? "zh-CN");
  readonly registry = new CommandRegistry(this.t);
  readonly appearanceRegistry = new AppearanceRegistry(this.t);
  readonly workspace = new VirtualWorkspace(() => this.services);
  appearance: TerminalAppearance = { background: "default" };
  entries: TerminalEntry[] = [];
  history: string[] = [];
  draft = "";
  running = false;
  status = 0;
  interaction: TerminalInteraction | null = null;
  application: TerminalApplication | null = null;
  size: TerminalSize = { ...TERMINAL.layout.initialSize };
  private sequence = 0;
  private listeners = new Set<() => void>();
  private aborter: AbortController | null = null;
  private authIdentity: AuthIdentity | null = null;
  constructor(private services: TerminalServices) {}
  setServices(services: TerminalServices): void {
    this.services = services;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  refresh(): void {
    for (const fn of this.listeners) fn();
  }
  identity(): PromptIdentity {
    const home = TERMINAL.identity.home;
    const cwd = this.workspace.cwd;
    return {
      user: this.authIdentity?.user ?? TERMINAL.identity.user,
      host: TERMINAL.identity.host,
      directory: cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd,
      status: this.status,
    };
  }
  setAppearance(value: Partial<TerminalAppearance>): void {
    const next = { ...this.appearance, ...value };
    if (!this.appearanceRegistry.backgrounds.has(next.background))
      throw new Error(this.t("error.appearance"));
    this.appearance = next;
    this.refresh();
  }
  resize(size: TerminalSize): void {
    if (size.columns === this.size.columns && size.rows === this.size.rows) return;
    this.size = size;
    this.application?.onResize?.(size);
    this.refresh();
  }
  openApplication(application: TerminalApplication): void {
    this.closeApplication();
    this.application = application;
    application.onResize?.(this.size);
    this.refresh();
  }
  closeApplication(): void {
    const previous = this.application;
    this.application = null;
    previous?.dispose?.();
    this.refresh();
  }
  append(...entries: EntryInput[]): void {
    for (const entry of entries)
      this.entries.push({ ...entry, id: ++this.sequence } as TerminalEntry);
    if (this.entries.length > TERMINAL.limits.output)
      this.entries.splice(0, this.entries.length - TERMINAL.limits.output);
    this.refresh();
  }
  resetWelcome(): void {
    this.entries = [];
    this.append(
      { type: "banner" },
      {
        type: "line",
        text: this.t("terminal.brand", { name: TERMINAL.brand.name }),
        tone: "normal",
        message: { key: "terminal.brand", params: { name: TERMINAL.brand.name } },
      },
      ...TERMINAL.welcome.map((key) => ({
        type: "line" as const,
        text: this.t(key),
        tone: "muted" as const,
        message: { key },
      })),
    );
  }

  clear(): void {
    this.entries = [];
    this.refresh();
  }
  cancel(): void {
    this.aborter?.abort();
    this.closeApplication();
  }
  private context(signal: AbortSignal): CommandContext {
    const waitForInput = <T>(
      create: (resolve: (value: T) => void) => TerminalInteraction,
    ): Promise<T> =>
      new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const cleanup = () => {
          signal.removeEventListener("abort", abort);
          this.interaction = null;
          this.refresh();
        };
        const abort = () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        this.interaction = create((value) => {
          cleanup();
          resolve(value);
        });
        signal.addEventListener("abort", abort, { once: true });
        this.refresh();
      });
    return {
      t: this.t,
      services: {
        ...this.services,
        navigate: (route) => {
          signal.throwIfAborted();
          return this.services.navigate(route);
        },
        setTheme: (value) => {
          signal.throwIfAborted();
          this.services.setTheme(value);
        },
        replayIntro: () => {
          signal.throwIfAborted();
          // Reset output before the intro replays, keeping history, identity, cwd and appearance.
          // 在入场动画重放前重置输出，同时保留历史、身份、cwd 与外观。
          this.resetWelcome();
          this.services.replayIntro();
        },
      },
      listCommands: () =>
        this.registry.list().map((command) => ({
          ...command,
          summary: command.summaryKey ? this.t(command.summaryKey) : command.summary,
          usage: command.usageKey ? this.t(command.usageKey) : command.usage,
        })),
      history: () => [...this.history],
      clear: () => {
        signal.throwIfAborted();
        this.clear();
      },
      workspace: this.workspace,
      appearance: this.appearanceRegistry,
      getAppearance: () => ({ ...this.appearance }),
      setAppearance: (value) => {
        signal.throwIfAborted();
        this.setAppearance(value);
      },
      identity: () => this.identity(),
      write: (...entries) => {
        if (!signal.aborted) this.append(...entries);
      },
      setIdentity: (identity) => {
        signal.throwIfAborted();
        this.authIdentity = identity;
        this.refresh();
      },
      ask: (request) => waitForInput<string>((submit) => ({ type: "prompt", ...request, submit })),
      choose: (title, items) =>
        waitForInput<string>((select) => ({ type: "menu", title, items, select })),
      openApplication: (application) => {
        signal.throwIfAborted();
        this.openApplication(application);
      },
      closeApplication: () => this.closeApplication(),
      refresh: () => this.refresh(),
    };
  }
  complete(source: string): string[] {
    if (!source.includes(" ")) return this.registry.complete(source);
    try {
      const [name = "", ...args] = parseCommandLine(source);
      if (source.endsWith(" ")) args.push("");
      const matches =
        this.registry.resolve(name)?.complete?.(args, this.context(new AbortController().signal)) ??
        [];
      const base = source.slice(0, source.length - (args.at(-1)?.length ?? 0));
      return matches.map((match) => base + match);
    } catch {
      return [];
    }
  }
  suggest(source: string): string {
    if (!source.trim() || this.running || this.interaction || this.application) return "";
    for (let index = this.history.length - 1; index >= 0; index--) {
      const previous = this.history[index];
      if (previous === undefined) throw new TypeError("Missing terminal history entry");
      if (previous.length > source.length && previous.startsWith(source)) return previous;
    }
    return (
      this.complete(source).find(
        (match) => match.length > source.length && match.startsWith(source),
      ) ?? ""
    );
  }
  private executionErrorMessage(
    error: unknown,
    cancelled: boolean,
    sensitive: boolean | undefined,
  ): string {
    if (cancelled) return this.t("error.cancelled");
    if (sensitive) return this.t("error.auth");
    return this.t("error.execution", {
      message: error instanceof Error ? error.message : this.t("error.unknown"),
    });
  }
  async execute(source: string): Promise<void> {
    const raw = source.trim();
    if (!raw || this.running || this.application) return;
    let tokens: string[];
    try {
      tokens = parseCommandLine(raw, this.t);
    } catch (error) {
      this.status = 2;
      this.append({
        type: "line",
        text: error instanceof Error ? error.message : this.t("error.commandFormat"),
        tone: "error",
      });
      return;
    }
    const [name = "", ...args] = tokens;
    const command = this.registry.resolve(name);
    if (!command?.sensitive) {
      if (this.history.at(-1) !== raw) this.history.push(raw);
      if (this.history.length > TERMINAL.limits.history) this.history.shift();
      this.append({ type: "command", source: raw, prompt: this.identity() });
    }
    if (!command) {
      this.status = 127;
      this.append({
        type: "line",
        text: this.t("error.notFound", { name }),
        tone: "error",
      });
      return;
    }
    const controller = new AbortController();
    this.aborter = controller;
    this.running = true;
    this.status = 0;
    this.refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new DOMException("Aborted", "AbortError"));
        controller.signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => controller.abort(), TERMINAL.limits.commandTimeout);
      });
      const result = await Promise.race([
        command.execute(args, this.context(controller.signal), controller.signal),
        interrupted,
      ]);
      if (!controller.signal.aborted && result?.length) {
        if (result.some((entry) => entry.type === "line" && entry.tone === "error"))
          this.status = 1;
        this.append(...result);
      }
    } catch (error) {
      this.status = controller.signal.aborted ? 130 : 1;
      this.append({
        type: "line",
        text: this.executionErrorMessage(error, controller.signal.aborted, command.sensitive),
        tone: "error",
      });
    } finally {
      clearTimeout(timer);
      if (abort) controller.signal.removeEventListener("abort", abort);
      controller.abort();
      this.interaction = null;
      this.running = false;
      if (this.aborter === controller) this.aborter = null;
      this.refresh();
    }
  }
}
