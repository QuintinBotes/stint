import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.STINT_E2E_PORT ?? 4319);
const flowsPort = Number(process.env.STINT_E2E_FLOWS_PORT ?? 4320);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // the charcoal theme by default, so colour assertions are stable; the light theme has its own test (look.spec.ts)
  use: { trace: 'retain-on-failure', colorScheme: 'dark' },
  projects: [
    // the demo recording played into a daemon: what the screens show
    { name: 'chromium', testIgnore: 'flows/**', use: { ...devices['Desktop Chrome'], colorScheme: 'dark', baseURL: `http://127.0.0.1:${port}` } },
    // a live daemon with fake agents and models: what a person does, end to end
    { name: 'flows', testMatch: 'flows/**/*.spec.ts', use: { ...devices['Desktop Chrome'], colorScheme: 'dark', baseURL: `http://127.0.0.1:${flowsPort}` } },
  ],
  webServer: [
    { command: 'bun e2e/serve.ts', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'bun e2e/flows/serve.ts', url: `http://127.0.0.1:${flowsPort}/api/health`, reuseExistingServer: !process.env.CI, timeout: 90_000 },
  ],
});
