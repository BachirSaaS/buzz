import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "workspace-performance.perf.ts",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: "python3 -m http.server 4187",
    cwd: process.env.BUZZ_PERF_DIST ?? "./dist",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
});
