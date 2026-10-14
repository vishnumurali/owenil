import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real app (Vite dev server) and the real
 * Supabase project from .env.local. Global setup creates throwaway confirmed
 * accounts; teardown removes them and all their data.
 *   npm run test:e2e
 *   E2E_BASE_URL=https://vishnumurali.github.io/owenil/ npm run test:e2e   (against a deployment)
 */
const external = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: external ?? 'http://localhost:5173/owenil/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive.spec.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: external
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:5173/owenil/', reuseExistingServer: true, timeout: 120_000 },
});
