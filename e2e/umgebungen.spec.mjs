// UMG-01/02: Live und Test auf derselben Domain sind getrennt: Daten, Darstellung, Sync. Test-Backup in Live abgelehnt.
// Änderungen an src/env.ts nur zusammen mit diesem Test.
import { test, expect, COMPUTER } from './fixtures.mjs';
import { datei, gehe, importiere, tab, visaCSV } from './hilfen.mjs';

test.use(COMPUTER);

test('getrennte Daten und Einstellungen; Test ohne Sync; Test-Backup in Live abgelehnt', async ({ page }) => {
  await gehe(page, '');
  await expect(page).toHaveTitle('Finanzen');
  await expect(page.locator('.env-strip')).toHaveCount(0);
  await importiere(page, 'privat', datei('v.csv', visaCSV([[2, 11, 'LIVE-HÄNDLER', 'Musterhausen']])));
  await tab(page, 'settings');
  await page.click('[data-act=theme][data-value=dark]');
  await expect(page.locator('#sync')).toContainText('privates GitHub-Repository');

  await gehe(page, 'test/');
  await expect(page).toHaveTitle('Finanzen TEST');
  await expect(page.locator('.env-strip')).toContainText('TEST-UMGEBUNG');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await tab(page, 'list');
  await expect(page.locator('#txlist')).not.toContainText('LIVE-HÄNDLER');
  expect(await page.locator('.txrow').count(), 'Beispieldaten vorhanden').toBeGreaterThan(50);
  await tab(page, 'settings');
  await expect(page.locator('#sync')).toContainText('abgeschaltet');
  await expect(page.locator('#sToken')).toHaveCount(0);
  await page.fill('#bPass', 'test-passphrase');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=backupExport]')]);
  const pfad = await dl.path();

  await gehe(page, '');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await tab(page, 'list');
  await expect(page.locator('.txrow')).toHaveCount(1);
  await tab(page, 'settings');
  await page.fill('#bPass', 'test-passphrase');
  await page.setInputFiles('#bFile', pfad);
  await page.click('[data-act=backupImport]');
  await expect(page.locator('#toast')).toContainText('Test-App');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  expect(dbs).toEqual(['finanzen', 'finanzen-test']);
});
