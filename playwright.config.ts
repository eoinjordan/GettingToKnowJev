import { defineConfig } from '@playwright/test';

const port = Number(process.env.TEST_PORT ?? 4198);
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: `http://127.0.0.1:${port}/__city_test__/`,
    viewport: { width: 1440, height: 980 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort --base=/__city_test__/`,
    url: `http://127.0.0.1:${port}/__city_test__/`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});