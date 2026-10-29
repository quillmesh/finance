// AUS-07: Transaktionen aus dem Diagramm; TAG-12–TAG-15: untaggen, Papierkorb, Wischen, gelöschte beim erneuten Import.
// Alle Daten erfunden, relativ zu heute.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { datei, gehe, importiere, keinQuerScrollen, monatWert, tab, tagge, visaCSV } from './hilfen.mjs';

const KARTE = visaCSV([[3, 24.5, 'Pizzeria Sole', 'Musterdorf'], [5, 31, 'Café Lago', 'Musterdorf'], [8, 12, 'Kiosk Muster', 'Beispielwil']]);
const zeilen = (page) => page.locator('#txlist .txrow');

async function vorbereiten(page) {
  await gehe(page, '');
  await importiere(page, 'privat', datei('karte.csv', KARTE));
  await tab(page, 'tag');
  await tagge(page, 'Freizeit', 'Restaurant');   // Pizzeria
  await tagge(page, 'Freizeit', 'Kultur');       // Café
  await tagge(page, 'Einkaufen', 'Lebensmittel'); // Kiosk
}

test.describe('Computer', () => {
  test.use(COMPUTER);

  test('AUS-07: Kategorie im Diagramm → Transaktionen anzeigen; Unterkategorie antippen → nur diese', async ({ page }) => {
    await vorbereiten(page);
    await tab(page, 'overview');
    await page.selectOption('#ovPeriod', monatWert());
    await page.locator('#ovTable tr[data-act=ovDrill]', { hasText: 'Freizeit' }).click();
    await expect(page.locator('#ovTxBtn')).toHaveText('Transaktionen anzeigen (2)');
    await page.click('#ovTxBtn');
    await expect(page.locator('#lfSlice')).toContainText('Freizeit');
    await expect(page.locator('#lfSlice')).toContainText('CHF 55.50');
    await expect(zeilen(page)).toHaveCount(2);
    await page.click('[data-act=lfBack]');
    // im Drilldown: Unterkategorie
    await page.locator('#ovTable tr[data-act=ovTx]', { hasText: 'Kultur' }).click();
    await expect(page.locator('#lfSlice')).toContainText('Freizeit & Ausflüge › Kultur');
    await expect(zeilen(page)).toHaveCount(1);
    await expect(zeilen(page).first()).toContainText('Café Lago');
    await page.click('[data-act=lfSliceOff]');
    await expect(zeilen(page)).toHaveCount(3);
  });

  test('TAG-12/TAG-13: im Dialog untaggen und in den Papierkorb, aus dem Papierkorb zurückholen', async ({ page }) => {
    await vorbereiten(page);
    await tab(page, 'list');
    await zeilen(page).filter({ hasText: 'Pizzeria Sole' }).click();
    await page.click('#dlgUntag');
    await expect(page.locator('#dlg[open]')).toContainText('Wieder ungetaggt?');
    await page.click('#dangerYes');
    await expect(page.locator('#toast')).toContainText('wieder ungetaggt');
    await expect(zeilen(page).filter({ hasText: 'Pizzeria Sole' })).toContainText('Nicht getaggt');
    await expect(page.locator('nav button[data-tab=tag]')).toContainText('1');

    await zeilen(page).filter({ hasText: 'Café Lago' }).click();
    await page.click('#dlgTrash');
    await expect(page.locator('#dlg[open]')).toContainText('30 Tage');
    await page.click('#dangerYes');
    await expect(zeilen(page)).toHaveCount(2);
    await page.reload();
    await tab(page, 'settings');
    const item = page.locator('#trash li', { hasText: 'Café Lago' });
    await expect(item).toContainText('noch 30 Tage');
    await expect(item).toContainText('Freizeit');
    await item.locator('[data-act=restore]').click();
    await expect(page.locator('#trash')).toContainText('Leer');
    await tab(page, 'list');
    await expect(zeilen(page).filter({ hasText: 'Café Lago' })).toContainText('Freizeit & Ausflüge › Kultur');
  });

  test('TAG-15: gelöschte Buchung kommt im erneuten Import vor → weglassen oder wieder aufnehmen', async ({ page }) => {
    await vorbereiten(page);
    await tab(page, 'list');
    await zeilen(page).filter({ hasText: 'Kiosk Muster' }).click();
    await page.click('#dlgTrash');
    await page.click('#dangerYes');
    await tab(page, 'import');
    await page.click('[data-act=impAcc][data-id=privat]');
    await page.setInputFiles('#fileIn', datei('karte.csv', KARTE));
    await expect(page.locator('#dlg[open]')).toContainText('1 Buchung hattest du gelöscht');
    await expect(page.locator('#dlg[open]')).toContainText('Kiosk Muster');
    await page.click('#dangerNo');
    await expect(page.locator('#toast')).toContainText('0 neu');
    await tab(page, 'list');
    await expect(zeilen(page)).toHaveCount(2);
    await tab(page, 'import');
    await page.setInputFiles('#fileIn', datei('karte.csv', KARTE));
    await page.click('#dangerYes');
    await expect(page.locator('#toast')).toContainText('1 neu');
    await tab(page, 'list');
    await expect(zeilen(page)).toHaveCount(3);
  });
});

test.describe('Handy', () => {
  test.use(HANDY);
  test('TAG-14: nach links wischen, Löschen tippen und bestätigen', async ({ page }) => {
    await vorbereiten(page);
    await page.locator('nav button[data-tab=list]').tap();
    const row = page.locator('#txlist .swipe', { hasText: 'Pizzeria Sole' });
    const box = await row.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2, x = box.x + box.width - 30;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 30, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(row).toHaveClass(/open/);
    await expect(row.locator('[data-act=rowTrash]')).toBeVisible();
    expect(await keinQuerScrollen(page)).toBe(true);
    await row.locator('[data-act=rowTrash]').tap();
    await expect(page.locator('#dlg[open]')).toContainText('In den Papierkorb?');
    await page.locator('#dangerYes').tap();
    await expect(page.locator('#txlist .txrow')).toHaveCount(2);
    // Wischen und dann auf die Zeile tippen schliesst nur die Aktionen
    const r2 = page.locator('#txlist .swipe').first();
    const b2 = await r2.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b2.x + b2.width - 30, y: b2.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b2.x + b2.width - 150, y: b2.y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(r2).toHaveClass(/open/);
    await page.touchscreen.tap(b2.x + 40, b2.y + b2.height / 2);
    await expect(r2).not.toHaveClass(/open/);
    await expect(page.locator('#dlg[open]')).toHaveCount(0);
  });
});
