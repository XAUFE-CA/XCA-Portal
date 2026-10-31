import { defineConfig } from "@playwright/test";

const port = Number(process.env.XCA_TEST_PORT ?? 4102);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    // Windows development machines already have Microsoft Edge.
    // Windows 开发机已自带 Microsoft Edge。
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    // Isolated test preview avoids colliding with the developer server on 4100.
    // 隔离的测试预览避免与 4100 的开发服务器冲突。
    command: `bunx nuxt preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // Never trust a server the run did not start; a stale build can pass silently.
    // 不复用本次未启动的服务，陈旧构建可能静默通过。
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
