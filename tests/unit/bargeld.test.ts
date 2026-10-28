// BAR-02 bis BAR-06: Bargeld-Topf (Variante A: Ausgabe zählt im Monat des Bezugs)
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { aggregate, cashPool, ledger, summary, viewTx } from '../../src/logic';
import { frisch, tx } from './hilfen';

/** Datum: Monat m Monate vor heute, Tag d */
const tag = (m: number, d: number) => { const now = new Date(); const x = new Date(now.getFullYear(), now.getMonth() - m, d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const bezug = (id: string, date: string, amount: number) => tx({ id, date, amount, merchant: 'Bargeldbezug Bancomat', status: 'tagged', cat: 'k-bargeld', sub: 'k-bargeld-1', note: 'Bargeldbezug' });
const bar = (date: string, amount: number, cat = 'k-einkaufen', sub: string | null = 'k-einkaufen-1') => S.addManual({ acc: 'privat', date, amount, merchant: 'Markt', cat, sub });

beforeEach(frisch);

describe('BAR-02/03: Bezug zählt als Ausgabe, manuelle Ausgaben werden abgezogen', () => {
  test('200 bezogen, 50 Markt + 30 Restaurant erfasst → 120 nicht zugeordnet, Total 200', () => {
    const m = tag(1, 1).slice(0, 7);
    S.importTx([bezug('w', tag(1, 5), 20000)]);
    expect(summary(S.state, 'privat', m).expense).toBe(20000);
    bar(tag(1, 8), 5000);
    bar(tag(1, 9), 3000, 'k-essen', 'k-essen-1');
    const items = aggregate(S.state, viewTx(S.state, 'privat', m), 'privat').map((x) => [x.id, x.value]);
    expect(items).toEqual([['k-bargeld', 12000], ['k-einkaufen', 5000], ['k-essen', 3000]]);
    expect(summary(S.state, 'privat', m).expense).toBe(20000);
    expect(cashPool(S.state).unassigned).toBe(12000);
  });
});

describe('BAR-04: ältester Bezug mit Rest; zählt im Monat des Bezugs', () => {
  test('Bezug im Vormonat, Ausgabe diesen Monat: zählt im Vormonat', () => {
    const vor = tag(1, 28).slice(0, 7), jetzt = tag(0, 1).slice(0, 7);
    S.importTx([bezug('w', tag(1, 28), 20000)]);
    bar(tag(0, 1), 5000);
    expect(aggregate(S.state, viewTx(S.state, 'privat', vor), 'privat').map((x) => [x.id, x.value])).toEqual([['k-bargeld', 15000], ['k-einkaufen', 5000]]);
    expect(summary(S.state, 'privat', jetzt).expense).toBe(0);
  });
  test('über zwei Bezüge verteilt, ältester zuerst', () => {
    S.importTx([bezug('w1', tag(2, 1), 5000), bezug('w2', tag(1, 1), 10000)]);
    const id = bar(tag(0, 1), 8000);
    const pool = cashPool(S.state);
    expect(pool.pieces.get(id)!.map((p) => [p.from, p.amount])).toEqual([['w1', 5000], ['w2', 3000]]);
    expect(pool.remaining.get('w1')).toBe(0);
    expect(pool.remaining.get('w2')).toBe(7000);
  });
  test('Bezug nach der Ausgabe wird nicht verwendet', () => {
    S.importTx([bezug('w', tag(0, 2), 10000)]);
    const id = bar(tag(0, 1), 3000);
    expect(cashPool(S.state).pieces.get(id)).toEqual([{ from: null, amount: 3000, date: tag(0, 1) }]);
  });
});

describe('BAR-05/06: Anzeige und Überschuss', () => {
  test('mehr erfasst als bezogen: Überschuss zählt im Monat der Ausgabe', () => {
    const jetzt = tag(0, 1).slice(0, 7);
    S.importTx([bezug('w', tag(0, 1), 5000)]);
    bar(tag(0, 1), 8000);
    const pool = cashPool(S.state);
    expect([pool.unassigned, pool.overflow]).toEqual([0, 3000]);
    expect(summary(S.state, 'privat', jetzt).expense).toBe(8000);
  });
  test('Partnerin-Einträge und gelöschte Einträge kommen nicht aus dem Topf', () => {
    S.importTx([bezug('w', tag(0, 1), 5000)]);
    S.addManual({ acc: 'gemeinsam', date: tag(0, 1), amount: 4000, merchant: 'Anna', cat: 'k-einkaufen', sub: null });
    const id = bar(tag(0, 1), 1000);
    S.deleteManual(id);
    expect(cashPool(S.state).unassigned).toBe(5000);
  });
  test('Bargeld zählt genau einmal: Total = Bezüge + Überschuss', () => {
    S.importTx([bezug('w1', tag(2, 3), 20000), bezug('w2', tag(1, 3), 10000)]);
    bar(tag(2, 4), 7000); bar(tag(1, 2), 30000); bar(tag(0, 1), 500);
    const pool = cashPool(S.state);
    expect(pool.overflow).toBe(17000); // Bezug w2 liegt nach der Ausgabe vom Tag 2
    expect(ledger(S.state).reduce((a, t) => a + t.amount, 0)).toBe(30000 + pool.overflow);
  });
});
