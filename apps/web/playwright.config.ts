import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a PRODUCTION build.
 *
 * `3.C2` is explicit and the reason is measured: `next dev` runs React StrictMode, which
 * double-invokes effects and therefore mounts two frame loops on one canvas. Every frame-time
 * number taken against it is a number about two renderers, and every pixel assertion is racing
 * a second painter. The web server command below builds first, so there is no way to run this
 * suite against a dev server by accident.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,

  use: {
    baseURL: 'http://127.0.0.1:3000',
    // The frame-time measurement states its dpr, and the projection test's pixel arithmetic
    // assumes device pixels equal CSS pixels. Both are pinned here rather than inherited from
    // whatever machine happens to run the suite.
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'pnpm build && pnpm start --port 3000 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
