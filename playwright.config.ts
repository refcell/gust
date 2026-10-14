import { defineConfig, devices } from '@playwright/test';

/** Override with PW_PORT to run several e2e suites side by side (e.g. parallel worktrees). */
const PORT = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: { command: `pnpm preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/gust/`, reuseExistingServer: false },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /pwa\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /pwa\.spec/ },
    // Safari engine with iPhone emulation (closest automated stand-in for iOS).
    { name: 'iphone', use: { ...devices['iPhone 15'] }, testIgnore: /pwa\.spec/ },
    // Service worker enabled: catches precache/install failures and offline regressions.
    { name: 'pwa', use: { ...devices['Pixel 7'], serviceWorkers: 'allow' }, testMatch: /pwa\.spec/ },
  ],
});
