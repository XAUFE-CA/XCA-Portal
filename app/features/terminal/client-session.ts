import { terminalCommands } from "./commands";
import { TerminalSession } from "./core/session";
import type { TerminalServices } from "./core/types";

// Browser-tab session survives client-side route changes. SSR never shares mutable state.
// 浏览器标签页会话在客户端路由切换后依旧存活。SSR 从不共享可变状态。
let clientSession: TerminalSession | null = null;
export function useTerminalSession(services: TerminalServices): TerminalSession {
  if (import.meta.client && clientSession) {
    clientSession.setServices(services);
    return clientSession;
  }
  const session = new TerminalSession(services);
  for (const command of terminalCommands) session.registry.register(command);
  session.resetWelcome();
  if (import.meta.client) clientSession = session;
  return session;
}
