// Sichten Persönlich / Gemeinsam / Alle Konten und die Auswertung (BER-*, AUS-*, EXP-*)
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { aggregate, byAccount, catsFor, monthly, periods, reportRows, summary, txRows, viewTx } from '../../src/logic';
import { frisch, iso, tx } from './hilfen';

const month = iso(0).slice(0, 7);
const year = iso(0).slice(0, 4);
// Zwei Tage im laufenden Monat (am Monatsersten: heute)
const d1 = `${month}-01`;

beforeEach(async () => {
  await frisch();
  S.importTx([
    tx({ id: 'p-einz', acc: 'privat', date: d1, amount: 150000, merchant: 'Gemeinschaftskonto' }),
    tx({ id: 'p-lohn', acc: 'privat', date: d1, amount: -650000, merchant: 'Arbeitgeber' }),
    tx({ id: 'p-benzin', acc: 'privat', date: d1, amount: 8000, merchant: 'Tankstelle Blitz' }),
    tx({ id: 'p-bar', acc: 'privat', date: d1, amount: 4500, merchant: 'Bar Zentral' }),
    tx({ id: 'p-3a', acc: 'privat', date: d1, amount: 60000, merchant: 'Vorsorgestiftung' }),
    tx({ id: 'p-offen', acc: 'privat', date: d1, amount: 1200, merchant: 'Kiosk' }),
    tx({ id: 'p-ign', acc: 'privat', date: d1, amount: 99900, merchant: 'Transfer', status: 'excluded' }),
    tx({ id: 'g-ich', acc: 'gemeinsam', date: d1, amount: -150000, merchant: 'Max Muster' }),
    tx({ id: 'g-sie', acc: 'gemeinsam', date: d1, amount: -150000, merchant: 'Anna Beispiel' }),
    tx({ id: 'g-miete', acc: 'gemeinsam', date: d1, amount: 190000, merchant: 'Vermieter' }),
    tx({ id: 'g-coop', acc: 'gemeinsam', date: d1, amount: 13245, merchant: 'Frischmarkt' }),
    tx({ id: 'g-shell', acc: 'gemeinsam', date: d1, amount: 9210, merchant: 'Tankstelle Blitz' }),
  ]);
  S.tagTx(['p-einz'], 'k-haushalt', 'k-haushalt-1');
  S.tagTx(['p-lohn'], 'k-einnahmen', 'k-einnahmen-1');
  S.tagTx(['p-benzin', 'g-shell'], 'k-auto', 'k-auto-1');
  S.tagTx(['p-bar'], 'k-essen', 'k-essen-3');
  S.tagTx(['p-3a'], 'k-sparen', 'k-sparen-1');
  S.tagTx(['g-ich'], 'k-einzahlungen', 'k-einzahlungen-1');
  S.tagTx(['g-sie'], 'k-einzahlungen', 'k-einzahlungen-2');
  S.tagTx(['g-miete'], 'k-wohnen', 'k-wohnen-1');
  S.tagTx(['g-coop'], 'k-einkaufen', 'k-einkaufen-1');
  S.addManual({ acc: 'gemeinsam', date: d1, amount: 7000, merchant: 'Tankstelle (Partnerin)', cat: 'k-auto', sub: 'k-auto-1' });
});

describe('BER-02: Persönlich', () => {
  test('Einzahlung aufs gemeinsame Konto zählt als Ausgabe; Sparen und Einnahmen nicht', () => {
    const s = summary(S.state, 'privat', month);
    expect(s.expense).toBe(150000 + 8000 + 4500);
    expect(s.income).toBe(650000);
    expect(s.saving).toBe(60000);
    expect(s.saldo).toBe(650000 - 162500 - 60000);
    expect(s.open).toBe(1);
    expect(s.openSum).toBe(1200);
  });
  test('ignorierte Buchungen zählen nirgends', () => {
    expect(viewTx(S.state, 'privat', month).some((t) => t.id === 'p-ign')).toBe(false);
  });
});

describe('Gemeinsam', () => {
  test('Einzahlungen sind Einnahmen, Ausgaben inkl. Einträge der Partnerin', () => {
    const s = summary(S.state, 'gemeinsam', month);
    expect(s.expense).toBe(190000 + 13245 + 9210 + 7000);
    expect(s.income).toBe(300000);
    expect(s.saldo).toBe(300000 - 219455);
  });
});

describe('BER-08: Alle Konten', () => {
  test('Einzahlungen ausgeblendet, jeder Franken genau einmal', () => {
    const s = summary(S.state, 'alle', month);
    expect(s.expense).toBe(8000 + 4500 + 190000 + 13245 + 9210 + 7000);
    expect(s.hiddenTransfers).toBe(150000);
    expect(s.income).toBe(0);
    expect(s.saldo).toBeNull();
  });
});

describe('AUS-01/02, BER-07: Kategorien, Unterkategorien, nach Konto', () => {
  test('Auto über alle Konten: Privat, Gemeinsam und Partnerin getrennt', () => {
    const txs = viewTx(S.state, 'alle', month);
    const auto = aggregate(S.state, txs, 'alle').find((x) => x.id === 'k-auto')!;
    expect(auto.value).toBe(8000 + 9210 + 7000);
    expect(byAccount(S.state, txs, 'alle', 'k-auto').map((x) => [x.label, x.value])).toEqual([['Privat', 8000], ['Gemeinsam', 9210], ['Partnerin', 7000]]);
    expect(aggregate(S.state, txs, 'alle', 'k-auto').map((x) => [x.label, x.value])).toEqual([['Benzin', 24210]]);
  });
  test('absteigend sortiert, Summe = Total der Ausgaben', () => {
    const txs = viewTx(S.state, 'privat', month);
    const items = aggregate(S.state, txs, 'privat');
    expect(items.map((i) => i.value)).toEqual([...items.map((i) => i.value)].sort((a, b) => b - a));
    expect(items.reduce((a, i) => a + i.value, 0)).toBe(summary(S.state, 'privat', month).expense);
  });
});

describe('BER-04: Kategorien passend zum Konto', () => {
  test('privat ohne Wohnen, gemeinsam ohne Ferien privat; Auto in beiden', () => {
    const p = catsFor(S.state, 'privat').map((c) => c.id), g = catsFor(S.state, 'gemeinsam').map((c) => c.id);
    expect(p).toContain('k-ferien'); expect(p).not.toContain('k-wohnen');
    expect(g).toContain('k-wohnen'); expect(g).not.toContain('k-ferien');
    expect(p).toContain('k-auto'); expect(g).toContain('k-auto');
  });
});

describe('AUS-03 und Zeiträume', () => {
  test('Monatsverlauf enthält offene Belastungen, nach Kategorie nur diese', () => {
    const m = +month.slice(5) - 1;
    expect(monthly(S.state, 'privat', year, null, null)[m]).toBe(162500 + 1200);
    expect(monthly(S.state, 'alle', year, null, 'k-auto')[m]).toBe(24210);
    expect(monthly(S.state, 'alle', year, 'gemeinsam', null)[m]).toBe(219455);
  });
  test('Zeiträume neueste zuerst', () => {
    expect(periods(S.state, 'privat', 'month')).toEqual([month]);
    expect(periods(S.state, 'privat', 'year')).toEqual([year]);
  });
});

describe('EXP-01/02: CSV-Export', () => {
  test('Report: Zeilen pro Unterkategorie, offene, Total, Einnahmen, Sparen', () => {
    const rows = reportRows(S.state, 'privat', month);
    expect(rows[0]).toEqual(['Sicht', 'Zeitraum', 'Kategorie', 'Unterkategorie', 'Betrag CHF', 'Anteil %']);
    expect(rows.find((r) => r[2] === 'Gemeinsamer Haushalt')?.[4]).toBe('1500.00');
    expect(rows.find((r) => r[2] === 'Nicht getaggt')?.[4]).toBe('12.00');
    expect(rows.find((r) => r[2] === 'Total getaggt')?.[4]).toBe('1625.00');
    expect(rows.find((r) => r[2] === 'Einnahmen')?.[4]).toBe('6500.00');
    expect(rows.find((r) => r[2] === 'Sparen & Vorsorge')?.[4]).toBe('600.00');
  });
  test('Transaktionen: Konto, Bereich, Kategorie, Status', () => {
    const rows = txRows(S.state, viewTx(S.state, 'gemeinsam', month));
    const coop = rows.find((r) => r[4] === 'Frischmarkt')!;
    expect(coop.slice(1, 4)).toEqual(['Gemeinsam', 'Gemeinsam', 'Bank']);
    expect(coop.slice(6)).toEqual(['132.45', 'CHF', '100.00', '132.45', 'Einkaufen', 'Lebensmittel', 'getaggt', '']);
    expect(rows.find((r) => r[4] === 'Tankstelle (Partnerin)')?.[3]).toBe('Partnerin');
  });
});
