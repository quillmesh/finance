// UMG-05: In der Test-App auswählen, was gelöscht wird; Beispieldaten entfernen und wieder laden
import { test, expect, COMPUTER } from './fixtures.mjs';
import { datei, gehe, importiere, tab, visaCSV } from './hilfen.mjs';

test.use(COMPUTER);

test('Beispieldaten löschen, eigene Daten importieren, Beispieldaten wieder laden und gezielt löschen', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await gehe(page, 'test/');
  await tab(page, 'list');
  expect(await page.locator('.txrow').count()).toBeGreaterThan(50);

  await tab(page, 'settings');
  await page.click('#purgeBtn');
  await expect(page.locator('#toast')).toContainText('Bitte auswählen');
  await page.check('[data-purge=sample]');
  await page.click('#purgeBtn');
  await expect(page.locator('#toast')).toContainText('Gelöscht');
  await tab(page, 'list');
  await expect(page.locator('.txrow')).toHaveCount(0);

  // eigene Datei; nach Neuladen kommen keine Beispieldaten zurück
  await importiere(page, 'privat', datei('eigen.csv', visaCSV([[2, 12, 'Eigener Händler', 'Musterhausen']])));
  await page.reload();
  await tab(page, 'list');
  await expect(page.locator('.txrow')).toHaveCount(1);

  // Beispieldaten wieder laden, dann nur diese löschen
  await tab(page, 'settings');
  await page.click('[data-act=reseed]');
  await expect(page.locator('#toast')).toContainText('Beispieldaten geladen');
  await tab(page, 'list');
  expect(await page.locator('.txrow').count()).toBeGreaterThan(50);
  await tab(page, 'settings');
  await page.check('[data-purge=sample]');
  await page.click('#purgeBtn');
  await tab(page, 'list');
  await expect(page.locator('.txrow')).toHaveCount(1);
  await expect(page.locator('.txrow')).toContainText('Eigener Händler');

  // eigene Importe löschen
  await tab(page, 'settings');
  await page.check('[data-purge=imports]');
  await page.click('#purgeBtn');
  await tab(page, 'list');
  await expect(page.locator('.txrow')).toHaveCount(0);
});

test('Live-App hat keine Löschfunktion', async ({ page }) => {
  await gehe(page, '');
  await tab(page, 'settings');
  await expect(page.locator('#testData')).toHaveCount(0);
});
