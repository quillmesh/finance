// IMP-13–IMP-15: Import-Historie, ganzen Import löschen, alle ungetaggten löschen. Alle Daten erfunden, relativ zu heute.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { bankCSV, datei, gehe, importiere, keinQuerScrollen, tab, tagge, visaCSV } from './hilfen.mjs';

const KARTE = visaCSV([[3, 24.5, 'Pizzeria Sole', 'Musterdorf'], [5, 31, 'Kiosk Muster', 'Musterdorf'], [8, 89.9, 'Sportgeschäft Muster', 'Beispielwil']]);
const BANK = bankCSV([[20, 'Belastung e-banking / Ref.-Nr. 9001 Muster Immobilien AG Hauptstrasse 3 1234 Musterdorf', 1900, null]]);
const anzahl = (page, konto) => page.locator('#view-import tbody tr', { hasText: konto }).locator('td.num').textContent();

test.describe('Computer', () => {
  test.use(COMPUTER);

  test('IMP-13/IMP-14: Historie zeigt die Importe, ein ganzer Import lässt sich löschen und wieder importieren', async ({ page }) => {
    await gehe(page, '');
    await importiere(page, 'privat', datei('karte-falsch.csv', KARTE));
    await tab(page, 'tag');
    await tagge(page, 'Freizeit', 'Restaurant');
    await importiere(page, 'gemeinsam', datei('bank-gemeinsam.csv', BANK));
    await tab(page, 'import');
    await page.click('#impHistBtn');
    const items = page.locator('#impHistory .implist li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('bank-gemeinsam.csv');
    await expect(items.nth(0)).toContainText('Konto Gemeinsam');
    await expect(items.nth(1)).toContainText('karte-falsch.csv');
    await expect(items.nth(1)).toContainText('Kreditkarten-CSV');
    await expect(items.nth(1).locator('.impcount')).toHaveText('3 Buchungen: 1 getaggt · 2 ungetaggt');
    await expect(items.nth(1).locator('.area')).toHaveText('Persönlich');

    // Abbrechen lässt alles stehen
    await items.nth(1).locator('[data-act=impDel]').click();
    await expect(page.locator('#dlg[open]')).toContainText('1 davon sind schon getaggt');
    await page.click('#dangerNo');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('3');
    // Löschen
    await items.nth(1).locator('[data-act=impDel]').click();
    await page.click('#dangerYes');
    await expect(page.locator('#toast')).toContainText('Import gelöscht: 3 Buchungen entfernt');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('0');
    await expect(page.locator('#impHistory .implist li')).toHaveCount(1);
    // bleibt nach dem Neuladen gelöscht
    await page.reload();
    await tab(page, 'import');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('0');
    // dieselbe Datei nochmals: Buchungen kommen ungetaggt zurück
    await importiere(page, 'privat', datei('karte-richtig.csv', KARTE));
    await expect(page.locator('#toast')).toContainText('3 neu ins Konto Privat');
  });

  test('IMP-15: alle ungetaggten löschen in den Einstellungen; getaggte und manuelle bleiben', async ({ page }) => {
    await gehe(page, '');
    await importiere(page, 'privat', datei('karte.csv', KARTE));
    await importiere(page, 'gemeinsam', datei('bank.csv', BANK));
    await tab(page, 'tag');
    await tagge(page, 'Freizeit', 'Restaurant');
    await tab(page, 'settings');
    await expect(page.locator('#delData .implist li')).toHaveCount(2);
    await expect(page.locator('#delOpenBtn')).toHaveText('Alle ungetaggten Einträge löschen (3)');
    await page.click('#delOpenBtn');
    await expect(page.locator('#dlg[open]')).toContainText('Konto Privat: 2');
    await expect(page.locator('#dlg[open]')).toContainText('Konto Gemeinsam: 1');
    await page.keyboard.press('Escape');
    await expect(page.locator('#delOpenBtn')).toHaveText('Alle ungetaggten Einträge löschen (3)');
    await page.click('#delOpenBtn');
    await page.click('#dangerYes');
    await expect(page.locator('#toast')).toContainText('3 ungetaggte Buchungen gelöscht');
    await expect(page.locator('#delOpenBtn')).toHaveText('Alle ungetaggten Einträge löschen (0)');
    await tab(page, 'import');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('1');
    await expect.poll(() => anzahl(page, 'Gemeinsam')).toBe('0');
  });
});

test.describe('Handy', () => {
  test.use(HANDY);
  test('IMP-13/IMP-14: Historie und Löschen mit dem Finger, ohne seitliches Scrollen', async ({ page }) => {
    await gehe(page, '');
    await importiere(page, 'privat', datei('eine-ziemlich-lange-dateibezeichnung-der-abrechnung.csv', KARTE));
    await page.locator('nav button[data-tab=import]').tap();
    await page.locator('#impHistBtn').tap();
    await expect(page.locator('#impHistory .implist li')).toHaveCount(1);
    expect(await keinQuerScrollen(page)).toBe(true);
    await page.locator('#impHistory [data-act=impDel]').tap();
    await page.locator('#dangerYes').tap();
    await expect(page.locator('#toast')).toContainText('Import gelöscht');
    await expect(page.locator('#impHistory')).toContainText('Noch keine Importe');
  });
});
