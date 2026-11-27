import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 2,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'off',
    // Use a preinstalled Chromium when one is provided (CI / cloud containers).
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: `npx vite build && npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120_000 },
});
