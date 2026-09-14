import { defineConfig, devices } from '@playwright/test';

/** The server spec's access token (spatt-server requires one to answer network host names). */
export const SERVER_TOKEN = 'e2e-access-token-0123456789';
const SERVER_PORT = 8788;

// End-to-end checks of the web UI. `chromium` runs against the Vite dev server (browser host:
// IndexedDB storage, download export). `server` runs against a real spatt-server serving `dist/`
// (so `npm run e2e` builds first), reached as http://spatt.test, a name Chromium maps to
// 127.0.0.1: the server treats it like another device on the network. The first run needs
// `npx playwright install chromium`.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /server\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 }, baseURL: 'http://localhost:5173' },
    },
    {
      name: 'server',
      testMatch: /server\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        baseURL: `http://spatt.test:${SERVER_PORT}`,
        launchOptions: { args: ['--host-resolver-rules=MAP spatt.test 127.0.0.1'] },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `cargo run -p spatt-server -- --bind 127.0.0.1 --port ${SERVER_PORT} --dist dist --data target/e2e-server-data --token ${SERVER_TOKEN}`,
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
  ],
});
