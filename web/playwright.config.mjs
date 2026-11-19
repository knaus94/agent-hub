import { defineConfig, devices } from '@playwright/test';
import { PORT } from './e2e/scratch.mjs';

// The tests share one scratch hub and run one at a time; `make e2e` builds the hub first.
export default defineConfig({
   testDir: 'e2e',
   workers: 1,
   timeout: 30_000,
   expect: { timeout: 10_000 },
   reporter: 'list',
   outputDir: 'test-results',
   use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
   webServer: { command: 'node e2e/hub.mjs', url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: false, timeout: 20_000 },
   projects: [
      { name: 'desktop', testIgnore: /phone/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
      { name: 'phone', testMatch: /phone/, use: devices['iPhone 15'] },
   ],
});
