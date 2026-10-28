// TEI-01–10, TAG-09, TAG-10, BAR-02–05: geteilte Ausgaben, Gutschriften, Notiz, neue Unterkategorie, Bargeld-Topf
import { test, expect, COMPUTER } from './fixtures.mjs';
import { bankCSV, datei, gehe, importiere, monatWert, tab, tagge, visaCSV, vormonat } from './hilfen.mjs';

test.use(COMPUTER);

const iso = (v) => `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`;
const tile = (page, label) => page.locator('.tile', { hasText: label }).locator('.v');
async function sicht(page, v) { await tab(page, 'overview'); await page.click(`[data-act=ovView][data-view=${v}]`); await page.selectOption('#ovPeriod', monatWert()); }

test('geteilt: 50 % gelernt, individuell, Taste T; Persönlich zählt den Anteil, Gemeinsam den vollen Betrag', async ({ page }) => {
  await gehe(page, '');
  await importiere(page, 'privat', datei('v.csv', visaCSV([[3, 80, 'Tankstelle Blitz', 'Musterdorf'], [10, 60, 'Tankstelle Blitz', 'Musterdorf'], [12, 30, 'Möbelhaus Muster', 'Beispielstadt'], [14, 100, 'Restaurant Sonne', 'Musterhausen']])));
  const card = page.locator('#txcard');
  await expect(page.locator('#shareBox .on')).toHaveText('Nur ich');
  await page.click('[data-act=share][data-v="5000"]');
  await expect(page.locator('#shareBox')).toContainText('Persönlich zählt CHF 40.00, Gemeinsam CHF 80.00');
  await tagge(page, 'Auto', 'Benzin');
  // TEI-06: zweite Tankstelle mit gelerntem Anteil
  await expect(card.locator('.amt')).toContainText('60.00');
  await expect(page.locator('#shareBox .on')).toHaveText('50 %');
  await expect(page.locator('[data-act=accept]')).toContainText('Auto › Benzin · 50 %');
  await page.keyboard.press('Enter');
  // TEI-04: geteilt → Wohnen wählbar; Taste T schaltet
  await expect(card.locator('.mer')).toHaveText('Möbelhaus Muster');
  await expect(page.locator('.catbtn[data-act=pickCat]', { hasText: 'Wohnen' })).toHaveCount(0);
  await page.keyboard.press('t');
  await expect(page.locator('#shareBox .on')).toHaveText('50 %');
  await page.click('[data-act=share][data-v="6667"]');
  await tagge(page, 'Wohnen', 'Einrichtung');
  // Individuell 30 %
  await page.click('[data-act=shareInd]');
  await page.fill('#shareInd', '30'); await page.locator('#shareInd').press('Tab');
  await expect(page.locator('#shareBox .on')).toHaveText('30 %');
  await tagge(page, 'Essen & Ausgang', 'Restaurant');

  await sicht(page, 'privat');
  await expect(tile(page, 'Ausgaben')).toHaveText('120.00'); // 40 + 30 + 20 + 30
  await sicht(page, 'gemeinsam');
  await expect(tile(page, 'Ausgaben')).toHaveText('270.00');
  await expect(page.locator('#ovTable')).toContainText('Wohnen');
  await sicht(page, 'alle');
  await expect(tile(page, 'Ausgaben')).toHaveText('270.00');
  // TEI-05: Liste zeigt den Anteil
  await tab(page, 'list');
  await expect(page.locator('.txrow', { hasText: 'Restaurant Sonne' })).toContainText('dein Anteil 30.00');
  // Bearbeiten: wieder Nur ich
  await page.click('.txrow:has-text("Restaurant Sonne")');
  await page.selectOption('#eShare', '');
  await page.click('[data-act=dlgSave]');
  await expect(page.locator('.txrow', { hasText: 'Restaurant Sonne' })).not.toContainText('dein Anteil');
  // TEI-11: Export
  await sicht(page, 'privat');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=exportTx]')]);
  const csv = (await (await dl.createReadStream()).toArray()).join('');
  expect(csv).toContain('Mein Anteil %;Mein Betrag');
  expect(csv).toMatch(/Möbelhaus Muster;[^\n]*;30\.00;CHF;66\.67;20\.00;Wohnen;Einrichtung/);
});

test('Gutschriften: nicht erfassen, immer für diesen Absender', async ({ page }) => {
  await gehe(page, '');
  const rueck = (ref, betrag) => [5, `Zahlungseingang / Ref.-Nr. ${ref} ANNA BEISPIEL DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: RUECKZAHLUNG`, null, betrag];
  await importiere(page, 'privat', datei('a.csv', bankCSV([rueck(9101, 1500)])));
  await expect(page.locator('#txcard .chip.warn')).toHaveText('Gutschrift');
  await expect(page.locator('#shareBox')).toHaveCount(0);
  await page.check('[data-opt=skipAlways]');
  await page.click('#skipCredit');
  await expect(page.locator('#view-tag')).toContainText('Alles getaggt');
  await importiere(page, 'privat', datei('b.csv', bankCSV([rueck(9102, 200)])));
  await expect(page.locator('#toast')).toContainText('1 neu ins Konto Privat, davon 1 ausgeschlossen');
  await tab(page, 'list');
  await expect(page.locator('.txrow.ex')).toHaveCount(2);
  await expect(page.locator('.txrow', { hasText: '200.00' })).toContainText('Automatisch nicht erfasst');
  await tab(page, 'overview');
  await expect(page.locator('#view-overview')).toContainText('Noch keine Daten');
});

test('Notiz und neue Unterkategorie beim Taggen', async ({ page }) => {
  await gehe(page, '');
  await importiere(page, 'privat', datei('v.csv', visaCSV([[3, 25, 'Pizzeria Sole', 'Musterhausen'], [4, 18, 'Pizza Kurier', 'Musterhausen']])));
  await page.click('#noteBtn');
  await page.fill('#noteIn', 'Geburtstag Lea');
  await page.keyboard.press('Enter');
  await expect(page.locator('#noteBtn')).toContainText('Geburtstag Lea');
  await page.locator('.catbtn[data-act=pickCat]', { hasText: 'Essen & Ausgang' }).click();
  await page.click('[data-act=newSub]');
  await page.fill('#newSubIn', 'Pizza');
  await page.keyboard.press('Enter');
  await expect(page.locator('#txcard .mer')).toHaveText('Pizza Kurier');
  // Taste N öffnet die Notiz; Notiz bleibt beim Klick auf eine Kategorie erhalten
  await page.keyboard.press('n');
  await page.fill('#noteIn', 'mit Team');
  await page.locator('.catbtn[data-act=pickCat]', { hasText: 'Essen & Ausgang' }).click();
  await page.keyboard.press('+');
  await page.fill('#newSubIn', 'pizza');
  await page.keyboard.press('Enter');
  await tab(page, 'list');
  await expect(page.locator('.txrow', { hasText: 'Pizzeria Sole' })).toContainText('Essen & Ausgang › Pizza · Geburtstag Lea');
  await expect(page.locator('.txrow', { hasText: 'Pizza Kurier' })).toContainText('Essen & Ausgang › Pizza · mit Team');
  await tab(page, 'settings');
  await expect(page.locator('.catedit[data-cat=k-essen] .subtag input[value=Pizza]')).toHaveCount(1);
});

test('Bargeld-Topf: Bezug zählt, manuelle Ausgaben werden abgezogen und zählen im Monat des Bezugs', async ({ page }) => {
  await gehe(page, '');
  await importiere(page, 'privat', datei('a.csv', bankCSV([[2, 'Bargeldbezug Bancomat Musterdorf', 200, null], [3, 'TWINT-Zahlung FRISCHMARKT, MUSTERDORF +41790000000 03.01.2026 10:00', 30, null]])));
  await tab(page, 'tag');
  await expect(page.locator('#txcard .mer')).toHaveText('Frischmarkt');
  await tagge(page, 'Einkaufen', 'Lebensmittel');
  await sicht(page, 'privat');
  await expect(page.locator('#ovTable tr', { hasText: 'Bargeld' })).toContainText('200.00');
  await tab(page, 'manual');
  await expect(page.locator('#cashOpen')).toHaveText('200.00');
  await page.fill('#cDate', iso(vormonat(4)));
  await page.fill('#cAmt', '50');
  await page.fill('#cMer', 'Wochenmarkt');
  await page.selectOption('#cCat', { label: 'Einkaufen' });
  await expect(page.locator('#cCat option', { hasText: 'Bargeld' })).toHaveCount(0);
  await page.click('[data-act=addManual]');
  await expect(page.locator('#cashOpen')).toHaveText('150.00');
  await sicht(page, 'privat');
  await expect(tile(page, 'Ausgaben')).toHaveText('230.00');
  await expect(page.locator('#ovTable tr', { hasText: 'Bargeld' })).toContainText('150.00');
  await expect(page.locator('#ovTable tr', { hasText: 'Einkaufen' })).toContainText('80.00');
});
