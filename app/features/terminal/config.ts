/**
 * Product configuration. Shared material and typography remain Neoverse-UI tokens.
 * 产品配置。共享材质与排版仍使用 Neoverse-UI 令牌。
 */
import { SITE } from "../../config/site";
import type { MessageKey } from "../../i18n";

export const TERMINAL = {
  brand: SITE.brand,
  identity: {
    user: "guest",
    host: "xca",
    home: "/home/guest",
    shell: "xca-sh",
    platform: "XCA Browser/Linux (simulated)",
  },
  limits: { history: 80, output: 300, commandTimeout: 30_000 },
  welcome: ["terminal.welcomeTagline", "terminal.welcomeHint"] satisfies MessageKey[],
  routes: SITE.routes,
  layout: {
    initialSize: { columns: 80, rows: 24 },
    minColumns: 8,
    minRows: 2,
  },
} as const;
