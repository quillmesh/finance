// BER-01–08: Persönlich, Gemeinsam, Alle Konten; Kategorien je Bereich; Auto über alle Konten; Partnerin manuell
import { test, expect, COMPUTER } from './fixtures.mjs';
import { bankCSV, datei, gehe, importiere, monatWert, tab, tagge, vormonat } from './hilfen.mjs';

test.use(COMPUTER);

const PRIVAT = bankCSV([
  [1, 'Belastung Dauerauftrag / Ref.-Nr. 7001 Gemeinschaftskonto Muster Dorfstrasse 1 1234 Musterdorf Mitteilung: Haushalt', 1500, null],
  [6, 'TWINT-Zahlung TANKSTELLE BLITZ, MUSTERDORF +41790000000 06.01.2026 10:00', 80, null],
  [25, 'Zahlungseingang / Ref.-Nr. 7002 MUSTER ARBEITGEBER AG BAHNHOFSTRASSE 1 CH-1000 MUSTERSTADT Referenz: LOHN', null, 6500],
]);
const GEMEINSAM = bankCSV([
  [1, 'Zahlungseingang / Ref.-Nr. 8001 MAX MUSTER DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: HAUSHALT', null, 1500],
  [1, 'Zahlungseingang / Ref.-Nr. 8002 ANNA BEISPIEL DORFSTRASSE 1 CH 1234 MUSTERDORF Referenz: HAUSHALT', null, 1500],
  [2, 'Belastung e-banking / Ref.-Nr. 8003 Muster Immobilien AG Hauptstrasse 3 1234 Musterdorf', 1900, null],
  [9, 'TWINT-Zahlung TANKSTELLE BLITZ, BEISPIELSTADT +41790000000 09.01.2026 18:00', 92.1, null],
]);
const TAGS = {
  'Max Muster': ['Einzahlungen', 'Ich'], 'Anna Beispiel': ['Einzahlungen', 'Partnerin'],
  'Gemeinschaftskonto Muster': ['Gemeinsamer Haushalt', 'Einzahlung gemeinsames Konto'],
  'Muster Immobilien AG': ['Wohnen', 'Miete'], 'Tankstelle Blitz': ['Auto', 'Benzin'], 'Muster Arbeitgeber AG': ['Einnahmen', 'Lohn'],
};

test('zwei Konten taggen und in drei Sichten auswerten', async ({ page }) => {
  await gehe(page, '');
  await importiere(page, 'privat', datei('privat.csv', PRIVAT));
  await importiere(page, 'gemeinsam', datei('gemeinsam.csv', GEMEINSAM));
  await tab(page, 'tag');
  for (let i = 0; i < 7; i++) {
    const mer = await page.locator('#txcard .mer').textContent();
    const area = await page.locator('#txcard .area').textContent();
    // BER-04: nur passende Kategorien
    const cats = page.locator('.catbtn[data-act=pickCat]');
    if (area === 'Persönlich') { await expect(cats.filter({ hasText: 'Wohnen' })).toHaveCount(0); await expect(cats.filter({ hasText: 'Ferien privat' })).toHaveCount(1); }
    else { await expect(cats.filter({ hasText: 'Ferien privat' })).toHaveCount(0); await expect(cats.filter({ hasText: 'Wohnen' })).toHaveCount(1); }
    const [c, s] = TAGS[mer];
    await tagge(page, c, s);
  }
  await expect(page.locator('#view-tag')).toContainText('Alles getaggt');

  // BER-05: Ausgabe der Partnerin manuell
  await tab(page, 'manual');
  await page.click('[data-act=manAcc][data-id=gemeinsam]');
  const v = vormonat(15);
  await page.fill('#cDate', `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`);
  await page.fill('#cAmt', '70');
  await page.fill('#cMer', 'Tankstelle');
  await page.selectOption('#cCat', { label: 'Auto' });
  await page.selectOption('#cSub', { label: 'Benzin' });
  await page.click('[data-act=addManual]');
  await expect(page.locator('#toast')).toContainText('Partnerin · Gemeinsam');

  await tab(page, 'overview');
  const sicht = async (v, want) => {
    await page.click(`[data-act=ovView][data-view=${v}]`);
    await page.selectOption('#ovPeriod', monatWert());
    for (const [label, wert] of want) await expect(page.locator('.tile', { hasText: label }).locator('.v')).toHaveText(wert);
  };
  await sicht('privat', [['Ausgaben', '1’580.00'], ['Einnahmen', '6’500.00'], ['Saldo', '4’920.00']]);
  await sicht('gemeinsam', [['Ausgaben', '2’062.10'], ['Einzahlungen', '3’000.00'], ['Saldo', '937.90']]);
  await sicht('alle', [['Ausgaben', '2’142.10']]);
  await expect(page.locator('#view-overview .note')).toContainText('CHF 1’500.00');

  // BER-07: Auto aus der Sicht Persönlich über alle Konten
  await sicht('privat', []);
  await page.click('#ovTable tr.click:has-text("Auto")');
  await expect(page.locator('#byAccount tr')).toHaveCount(2);
  await page.click('[data-act=ovAll]');
  await expect(page.locator('#ovViews .on')).toHaveText('Alle Konten');
  const rows = page.locator('#byAccount tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Privat'); await expect(rows.nth(0)).toContainText('80.00');
  await expect(rows.nth(1)).toContainText('Gemeinsam'); await expect(rows.nth(1)).toContainText('92.10');
  await expect(rows.nth(2)).toContainText('Partnerin'); await expect(rows.nth(2)).toContainText('70.00');
  await expect(rows.nth(3)).toContainText('242.10');
});

test('Bank-CSV mit Sammelbuchungen ins gemeinsame Konto; Kreditkarten-Abbuchung per Stichwort ausgeschlossen', async ({ page }) => {
  const v = vormonat(20); const dt = `${String(v.d).padStart(2, '0')}.${String(v.m).padStart(2, '0')}.${v.y}`;
  const csv = ['Datum;Buchungstext;Whg;Betrag Detail;Bank-Referenz;Referenznummer;Belastung CHF;Gutschrift CHF;Valuta;Saldo CHF;Zahlungszweck;Details',
    `${dt};Belastungen Dauerauftrag (2);;;E1;;2073;;${dt};0;;`, ';Miete;CHF;1953;;;;;;;;', ';Parkplatz;CHF;120;;;;;;;;',
    `${dt};Belastung aus Lastschrift mit Widerspruch: Kartenherausgeber Muster AG;;;E2;;300;;${dt};0;;`].join('\n');
  await gehe(page, '');
  await tab(page, 'settings');
  await page.fill('#cardWords-gemeinsam', 'Kartenherausgeber Muster');
  await page.locator('#cardWords-gemeinsam').press('Tab');
  await importiere(page, 'gemeinsam', datei('gemeinsam.csv', csv));
  await expect(page.locator('#toast')).toContainText('3 neu ins Konto Gemeinsam, davon 1 ausgeschlossen');
  await tab(page, 'tag');
  await expect(page.locator('#txcard .mer')).toHaveText('Miete');
  await tagge(page, 'Wohnen', 'Miete');
  await expect(page.locator('#txcard .mer')).toHaveText('Parkplatz');
});
