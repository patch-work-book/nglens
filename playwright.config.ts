import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the ngLens END-TO-END accuracy harness.
 *
 * These tests run the REAL ngLens instrumentation (RenderTracker/FlowTracker)
 * against a real Angular app in headless Chromium, then diff ngLens's reported
 * render counts/causes against console.count ground truth. This measures the
 * instrumentation layer's real-world accuracy — the layer the pure vitest
 * harness cannot reach.
 *
 * The harness page is a static bundle served by Playwright's webServer.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    headless: true,
    baseURL: 'http://localhost:4321',
    // Angular dev global `ng` requires a dev build; the harness provides it.
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Serve the built e2e harness directory with a tiny dependency-free server.
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:4321/harness.html',
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
