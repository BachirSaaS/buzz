import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/widgets",
  outputDir: "./test-results/widget-gallery-tests",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1426", ...devices["Desktop Chrome"] },
  webServer: {
    command:
      "pnpm exec vite preview --config widget-gallery.vite.config.ts --port 1426",
    url: "http://127.0.0.1:1426/widgets.html",
    reuseExistingServer: false,
  },
});
