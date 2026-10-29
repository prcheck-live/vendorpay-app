import { defineConfig, devices } from '@playwright/test';

// The VendorPay team's own tests (producer-side evidence). Test titles start with the
// Jira key they cover, and the JUnit report can be imported into Jira Xray.
// QIVVRA's independent verifiers live in a separate repository the team cannot see.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'ui', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
  ],
  // Starts the app locally when no BASE_URL is given; CI and QE runs point BASE_URL at a deployed build.
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run build && npm start', url: `${baseURL}/health`, reuseExistingServer: true, timeout: 120_000 },
});
