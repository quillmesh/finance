// IMP-01/04, TAG-01–05, AUS-01/02, EXP-01: Visa importieren, taggen mit Tastatur und Knöpfen, auswerten, exportieren
import { test, expect, COMPUTER } from './fixtures.mjs';
import { datei, gehe, importiere, monatWert, tab, tagge, visaCSV } from './hilfen.mjs';

test.use(COMPUTER);

const VISA = visaCSV([[3, 24.5, 'Pizzeria Sole', 'Musterhausen'], [5, 31, 'Pizzeria Sole', 'Musterhausen'], [8, 89.9, 'Sportgeschäft Muster', 'Beispielwil'], [12, -500], [15, 12, 'Kiosk Muster', 'Mustermoos']]);

test('Import, Duplikate, Taggen mit Vorschlag und Rückgängig, Übersicht, Export, nach Neuladen gleich', async ({ page }) => {
  await gehe(page, '');
  await expect(page.locator('#view-import')).toBeVisible();
  await importiere(page, 'privat', datei('visa.csv', VISA));
  await expect(page.locator('#toast')).toContainText('5 neu ins Konto Privat, davon 1 ausgeschlossen');

  // älteste zuerst; Tastatur: 2 = Essen & Ausgang, 1 = Restaurant
  const card = page.locator('#txcard');
  await expect(card.locator('.mer')).toHaveText('Pizzeria Sole');
  await expect(card.locator('.amt')).toContainText('24.50');
  await page.keyboard.press('2'); await page.keyboard.press('1');
  // gleicher Händler: Vorschlag, mit Enter übernehmen
  await expect(card.locator('.amt')).toContainText('31.00');
  await expect(page.locator('[data-act=accept]')).toContainText('Essen & Ausgang › Restaurant');
  await page.keyboard.press('Enter');
  await expect(card.locator('.mer')).toHaveText('Sportgeschäft Muster');
  // Rückgängig bringt die letzte Buchung zurück
  await page.keyboard.press('z');
  await expect(card.locator('.amt')).toContainText('31.00');
  await page.keyboard.press('Enter');
  await tagge(page, 'Hobby', 'Sport');
  await expect(card.locator('.mer')).toHaveText('Kiosk Muster');
  await page.click('[data-act=exclude]');
  await expect(page.locator('#view-tag')).toContainText('Alles getaggt');

  // Übersicht Vormonat
  await tab(page, 'overview');
  await page.selectOption('#ovPeriod', monatWert());
  await expect(page.locator('#ovExpense')).toHaveText('145.40');
  await expect(page.locator('#ovTable')).toContainText('Essen & Ausgang');
  await expect(page.locator('#ovTable tr', { hasText: 'Hobby' })).toContainText('89.90');
  await page.click('#ovTable tr.click:has-text("Essen")');
  await expect(page.locator('#ovTitle')).toHaveText('Essen & Ausgang');
  await expect(page.locator('#ovTable tr', { hasText: 'Restaurant' })).toContainText('55.50');
  await expect(page.locator('#byAccount')).toContainText('Privat');

  // Export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=exportReport]')]);
  const csv = (await (await dl.createReadStream()).toArray()).join('');
  expect(csv).toContain('Essen & Ausgang;Restaurant;55.50');
  expect(csv).toContain('Total getaggt;;145.40;100.0');

  // Duplikate
  await importiere(page, 'privat', datei('visa.csv', VISA));
  await expect(page.locator('#toast')).toContainText('0 neu ins Konto Privat · 5 Duplikate übersprungen');

  // Nach Neuladen gleich
  await page.reload();
  await tab(page, 'overview');
  await page.selectOption('#ovPeriod', monatWert());
  await expect(page.locator('#ovExpense')).toHaveText('145.40');

  // Liste: Suche und Bearbeiten
  await tab(page, 'list');
  await page.fill('#lfQ', 'Kiosk');
  await expect(page.locator('.txrow')).toHaveCount(1);
  await expect(page.locator('.txrow')).toContainText('Ignoriert');
  await page.click('.txrow');
  await page.selectOption('#eCat', { label: 'Essen & Ausgang' });
  await page.selectOption('#eSub', { label: 'Café & Bäckerei' });
  await page.fill('#eNote', 'Zeitung');
  await page.click('[data-act=dlgSave]');
  await expect(page.locator('.txrow')).toContainText('Essen & Ausgang › Café & Bäckerei · Zeitung');
});

test('Unbekanntes Format wird verständlich abgelehnt', async ({ page }) => {
  await gehe(page, '');
  await importiere(page, 'privat', datei('irgendwas.csv', 'a,b\n1,2'));
  await expect(page.locator('#toast')).toContainText('Format nicht erkannt');
});
