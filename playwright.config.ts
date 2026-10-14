import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'pnpm preview --port 4173 --strictPort', url: 'http://localhost:4173/gust/', reuseExistingServer: false },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /pwa\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /pwa\.spec/ },
    // Safari engine with iPhone emulation (closest automated stand-in for iOS).
    { name: 'iphone', use: { ...devices['iPhone 15'] }, testIgnore: /pwa\.spec/ },
    // Service worker enabled: catches precache/install failures and offline regressions.
    { name: 'pwa', use: { ...devices['Pixel 7'], serviceWorkers: 'allow' }, testMatch: /pwa\.spec/ },
  ],
});
