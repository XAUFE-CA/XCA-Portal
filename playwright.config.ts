import { defineConfig } from "@playwright/test";

const port = Number(process.env.XCA_TEST_PORT ?? 4102);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // The cinematic intro advances one cue per frame, so a software-rendered runner needs
  // several times the wall clock of a GPU machine; stage waits use SCENE_TIMEOUT from ./tests/e2e/timing.
  // 影院式入场每个提示都要等一帧，软件渲染运行器需要数倍于 GPU 机器的墙钟时间；
  // 阶段等待使用 ./tests/e2e/timing 中的 SCENE_TIMEOUT。
  timeout: 300_000,
  expect: { timeout: 20_000 },
  // A shared runner occasionally skips a stage inside one frame; one retry separates that
  // from a real failure without hiding it (a retry that also fails still blocks).
  // 共享运行器偶尔会在单帧内跳过某个阶段；一次重试可将其与真实失败区分开，
  // 且重试后仍失败时依旧阻断。
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  // Full-scene cases are on demand only; the cinematic workflow opts in with XCA_CINEMATIC.
  // 完整场景用例仅按需运行；cinematic 工作流用 XCA_CINEMATIC 显式开启。
  grepInvert: process.env.XCA_CINEMATIC ? undefined : /@cinematic/,
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
