import { defineConfig, devices } from '@playwright/test';

// The judge copy (R-069): apps/web/dist-judge, served the way GitHub Pages serves it. bun run test:judge builds it first.
const port = Number(process.env.STINT_JUDGE_PORT ?? 4321);

export default defineConfig({
  testDir: '.',
  testMatch: /\.judge\.ts$/,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], colorScheme: 'dark', baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: { command: 'bun scripts/serve-judge.ts', cwd: '../..', url: `http://127.0.0.1:${port}/stint/`, reuseExistingServer: !process.env.CI, env: { STINT_JUDGE_PORT: String(port) } },
});
