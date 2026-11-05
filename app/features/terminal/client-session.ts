import { readVirtualFile, virtualDirectories, virtualFiles } from "../../data/terminal/manifest";
import { terminalCommands } from "./commands";
import { TerminalSession } from "./core/session";
import type { TerminalServices } from "./core/types";

// Browser-tab session survives client-side route changes. SSR never shares mutable state.
// 浏览器标签页会话在客户端路由切换后依旧存活。SSR 从不共享可变状态。
let clientSession: TerminalSession | null = null;
/**
 * Registers the data-driven virtual tree; bodies resolve with the current locale on every read.
 * 注册由数据驱动的虚拟目录树，正文在每次读取时按当前语言解析。
 */
export function registerVirtualFiles(session: TerminalSession): void {
  for (const path of virtualDirectories) session.workspace.register({ path, kind: "directory" });
  for (const file of virtualFiles)
    session.workspace.register({
      path: file.path,
      kind: file.kind,
      read: (signal) => {
        signal.throwIfAborted();
        return readVirtualFile(file, session.locale);
      },
    });
}
export function useTerminalSession(services: TerminalServices): TerminalSession {
  if (import.meta.client && clientSession) {
    clientSession.setServices(services);
    return clientSession;
  }
  const session = new TerminalSession(services);
  for (const command of terminalCommands) session.registry.register(command);
  registerVirtualFiles(session);
  session.resetWelcome();
  if (import.meta.client) clientSession = session;
  return session;
}
