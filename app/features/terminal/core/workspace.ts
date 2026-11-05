import { createTranslator } from "../../../i18n";
import { TERMINAL } from "../config";
import type { TerminalServices } from "./types";

export interface VirtualNode {
  path: string;
  kind: "file" | "directory";
  read?: (signal: AbortSignal) => Promise<string> | string;
}
/**
 * Read-only virtual files. Nothing here accesses the user's operating system.
 * 只读虚拟文件。此处任何操作都不会访问用户的操作系统。
 */
export class VirtualWorkspace {
  private readonly t = createTranslator(() => this.services().getLocale?.() ?? "zh-CN");
  cwd: string = TERMINAL.identity.home;
  private nodes = new Map<string, VirtualNode>();
  constructor(private services: () => TerminalServices) {}
  register(node: VirtualNode): void {
    if (!node.path.startsWith("/")) throw new Error(this.t("error.absolutePath"));
    const path = this.resolve(node.path);
    this.nodes.set(path, { ...node, path });
  }
  resolve(path = "."): string {
    const expanded =
      path === "~" || path.startsWith("~/") ? TERMINAL.identity.home + path.slice(1) : path;
    const parts: string[] = [];
    for (const part of (expanded.startsWith("/") ? expanded : `${this.cwd}/${expanded}`).split(
      "/",
    )) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return `/${parts.join("/")}`;
  }
  node(path: string): VirtualNode {
    const node = this.nodes.get(this.resolve(path));
    if (!node) throw new Error(this.t("error.missingPath", { path }));
    return node;
  }
  list(path = "."): VirtualNode[] {
    const node = this.node(path);
    if (node.kind === "file") return [node];
    const prefix = node.path === "/" ? "/" : `${node.path}/`;
    return [...this.nodes.values()].filter(
      (child) =>
        child.path.startsWith(prefix) &&
        child.path !== node.path &&
        !child.path.slice(prefix.length).includes("/"),
    );
  }
  /**
   * Lists every descendant of a directory in path order without touching the host.
   * 按路径顺序列出目录的全部后代节点，不访问宿主。
   */
  walk(root = "."): VirtualNode[] {
    const node = this.node(root);
    if (node.kind === "file") return [];
    const prefix = node.path === "/" ? "/" : `${node.path}/`;
    return [...this.nodes.values()]
      .filter((child) => child.path.startsWith(prefix) && child.path !== node.path)
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  }
  cd(path = "~"): void {
    const node = this.node(path);
    if (node.kind !== "directory") throw new Error(this.t("error.notDirectory", { path }));
    this.cwd = node.path;
  }
  async read(path: string, signal: AbortSignal): Promise<string> {
    const node = this.node(path);
    if (node.kind !== "file" || !node.read) throw new Error(this.t("error.isDirectory", { path }));
    signal.throwIfAborted();
    const text = await node.read(signal);
    signal.throwIfAborted();
    return text;
  }
  complete(prefix: string): string[] {
    const slash = prefix.lastIndexOf("/");
    const base = slash >= 0 ? prefix.slice(0, slash + 1) : "";
    const name = prefix.slice(slash + 1);
    // Dotfiles stay out of candidates until the typed name starts with a dot.
    // 在输入名以点开头前，补全候选不包含点开头的文件。
    const includeHidden = name.startsWith(".");
    try {
      return this.list(base || ".")
        .filter(
          (node) =>
            (includeHidden || !node.path.slice(node.path.lastIndexOf("/") + 1).startsWith(".")) &&
            node.path.slice(node.path.lastIndexOf("/") + 1).startsWith(name),
        )
        .map(
          (node) =>
            `${base}${node.path.slice(node.path.lastIndexOf("/") + 1)}${node.kind === "directory" ? "/" : ""}`,
        );
    } catch {
      return [];
    }
  }
}
