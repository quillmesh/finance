// End-to-End-Tests mit Playwright Test.
// Lokal:   tests/run.sh            (baut, startet den Server, führt alles aus)
// Bei einem Fehler legt Playwright einen Trace ab (test-results/…/trace.zip); ansehen auf https://trace.playwright.dev
import { defineConfig } from 'playwright/test';
import { cpus } from 'node:os';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  workers: Number(process.env.E2E_WORKERS) || Math.max(2, cpus().length),
  retries: CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://localhost:4173/', trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true },
  webServer: {
    command: 'scripts/build-site.sh >/dev/null && exec python3 -m http.server 4173 --directory site',
    url: 'http://localhost:4173/',
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
