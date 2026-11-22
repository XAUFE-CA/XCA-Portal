import { defineConfig } from "@playwright/test";

const port = Number(process.env.XCA_PASSKEY_PORT ?? 4112);

export default defineConfig({
  testDir: "./tests/e2e/passkey",
  // The harness owns the API, database and preview; never reuse an unrelated service.
  // 测试入口拥有 API、数据库与预览进程，不复用无关服务。
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "test-results/passkey",
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
