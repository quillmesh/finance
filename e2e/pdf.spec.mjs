// IMP-09–IMP-12: Kreditkarten-Abrechnung als PDF, Summenkontrolle, Überschneidung mit CSV, Kartennummer pro Konto.
// Die PDFs sind erfunden (tests/pdf-bauen.mjs), Daten relativ zu heute.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, importiere, tab, visaCSV, datei } from './hilfen.mjs';
import { bauePdf, vormonatTag } from '../tests/pdf-bauen.mjs';

const KARTE = '5412 34XX XXXX 9876';
const t = (d, text, amount, branch = 'Supermärkte, Lebensmittel') => ({ d: vormonatTag(d), v: vormonatTag(d), text, amount, branch });
const spec = (extra = {}) => ({
  previous: 20000, payment: { d: vormonatTag(2), v: vormonatTag(3) },
  cards: [{ no: KARTE, name: 'Visa Muster, Max Muster', tx: [
    t(5, 'Dorfladen Muster, Musterdorf CH', 1235),
    t(6, 'Bäckerei Beispiel, Musterstadt CH', 480, 'Bäckereien'),
    t(7, 'Tankstelle Blitz, Musterdorf CH', 6500, 'Tankstellen'),
  ] }],
  ...extra,
});
const pdf = (name, s) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bauePdf(s)) });
const anzahl = (page, konto) => page.locator('#view-import tbody tr', { hasText: konto }).locator('td.num').textContent();

async function waehle(page, konto, file) {
  await tab(page, 'import');
  await page.click(`[data-act=impAcc][data-id=${konto}]`);
  await page.setInputFiles('#fileIn', file);
}

test.describe('Computer', () => {
  test.use(COMPUTER);

  test('IMP-09/IMP-10: PDF importieren, Summe prüfen, bei Abweichung nachfragen', async ({ page }) => {
    await gehe(page, '');
    // IMP-09: stimmende Abrechnung → ohne Rückfrage
    await importiere(page, 'privat', pdf('abrechnung.pdf', spec()));
    await expect(page.locator('#toast')).toContainText('4 neu ins Konto Privat, davon 1 ausgeschlossen');
    await tab(page, 'tag');
    await expect(page.locator('#txcard .mer')).toHaveText('Dorfladen Muster');
    await tab(page, 'list');
    await expect(page.locator('#view-list')).toContainText('Bäckerei Beispiel');
    await expect(page.locator('#view-list')).not.toContainText('Totalbetrag');

    // IMP-10: falsches Total → Rückfrage mit Differenz; «Nicht importieren» lässt alles wie es war
    const falsch = pdf('falsch.pdf', spec({ previous: 0, payment: null, cards: [{ no: KARTE, name: 'Visa Muster, Max Muster', tx: [t(12, 'Kiosk Muster, Musterdorf CH', 350)] }], cardTotal: { [KARTE]: 550 }, invoice: 550 }));
    await waehle(page, 'privat', falsch);
    const dlg = page.locator('#dlg[open]');
    await expect(dlg.locator('.impwarn[data-kind=sum]').first()).toContainText('gelesen 3.50, laut Abrechnung 5.50 – Differenz -2.00 CHF');
    await dlg.locator('#impNo').click();
    await expect(page.locator('#toast')).toContainText('falsch.pdf: nicht importiert');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('4');
    // «Trotzdem importieren» übernimmt die gelesenen Buchungen
    await waehle(page, 'privat', falsch);
    await page.locator('#dlg[open] #impYes').click();
    await expect(page.locator('#toast')).toContainText('1 neu ins Konto Privat');
    await expect.poll(() => anzahl(page, 'Privat')).toBe('5');
  });

  test('IMP-12: Kartennummer pro Konto: Warnung beim falschen Konto', async ({ page }) => {
    await gehe(page, '');
    await tab(page, 'settings');
    // ungültige Eingabe wird nicht gespeichert
    await page.fill('#cards-privat', '1234');
    await page.press('#cards-privat', 'Tab');
    await expect(page.locator('#toast')).toContainText('Kartennummer nicht erkannt');
    await expect(page.locator('#cards-privat')).toHaveValue('');
    // volle Nummer wird maskiert gespeichert
    await page.fill('#cards-privat', '5412345678909876');
    await page.press('#cards-privat', 'Tab');
    await expect(page.locator('#cards-privat')).toHaveValue(KARTE);
    await page.reload();
    await tab(page, 'settings');
    await expect(page.locator('#cards-privat')).toHaveValue(KARTE);

    await waehle(page, 'gemeinsam', pdf('karte.pdf', spec()));
    await expect(page.locator('#dlg[open] .impwarn[data-kind=card]')).toContainText(`Die Karte ${KARTE} ist beim Konto Privat hinterlegt, nicht bei Gemeinsam.`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#toast')).toContainText('karte.pdf: nicht importiert');
    await expect.poll(() => anzahl(page, 'Gemeinsam')).toBe('0');
    // richtiges Konto: keine Rückfrage
    await importiere(page, 'privat', pdf('karte.pdf', spec()));
    await expect(page.locator('#toast')).toContainText('4 neu ins Konto Privat');
  });

  test('IMP-11: Monat schon aus der CSV importiert → Warnung vor doppelten Buchungen', async ({ page }) => {
    await gehe(page, '');
    await importiere(page, 'privat', datei('karte.csv', visaCSV([[5, 12.35, 'Dorfladen Muster', 'Musterdorf'], [6, 4.8, 'Bäckerei Beispiel', 'Musterstadt']])));
    await waehle(page, 'privat', pdf('abrechnung.pdf', spec()));
    await expect(page.locator('#dlg[open] .impwarn[data-kind=overlap]')).toContainText('2 Buchungen gibt es im Konto Privat schon aus einer Kreditkarten-CSV');
    await page.locator('#dlg[open] #impNo').click();
    await expect.poll(() => anzahl(page, 'Privat')).toBe('2');
  });
});

test.describe('Handy', () => {
  test.use(HANDY);
  test('IMP-09/IMP-10: PDF importieren und Rückfrage mit dem Finger beantworten', async ({ page }) => {
    await gehe(page, '');
    await page.locator('nav button[data-tab=import]').tap();
    await page.locator('[data-act=impAcc][data-id=privat]').tap();
    await page.setInputFiles('#fileIn', pdf('falsch.pdf', spec({ invoice: 1 })));
    await expect(page.locator('#dlg[open] .impwarn')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.locator('#dlg[open] #impYes').tap();
    await expect(page.locator('#toast')).toContainText('4 neu ins Konto Privat');
  });
});
