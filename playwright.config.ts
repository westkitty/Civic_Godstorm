import { defineConfig } from '@playwright/test';

// Browser journeys run against the production build served by `vite preview`.
// CG_OUT overrides the artifact directory (Section 19.1 output-directory argument).
// Projects: installed Google Chrome (desktop and narrow) plus Playwright's Firefox and WebKit
// builds. The full cross-browser release matrix with exact release versions is an M13 obligation.
const outputDir = process.env.CG_OUT ?? 'test-results';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: `${outputDir}/e2e-results.json` }]],
  use: {
    baseURL: 'http://localhost:4173/Civic_Godstorm/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chrome-desktop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'chrome-narrow', use: { channel: 'chrome', viewport: { width: 800, height: 1100 } } },
    { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/Civic_Godstorm/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
