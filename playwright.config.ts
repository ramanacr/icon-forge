import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/parity',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: process.env.ICONFORGE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.ICONFORGE_CHROMIUM_EXECUTABLE } : {} } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
