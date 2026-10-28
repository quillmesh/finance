// TEI-01 bis TEI-11: geteilte Ausgaben und Gutschriften «Nicht erfassen»
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { aggregate, amountIn, byAccount, catsFor, myPart, openTx, ruleKey, shareLabel, summary, txRows, viewTx } from '../../src/logic';
import { frisch, iso, tx } from './hilfen';

const month = iso(0).slice(0, 7);
const d1 = `${month}-01`;

beforeEach(frisch);

describe('TEI-03: Persönlich zählt den Anteil, Gemeinsam und Alle den vollen Betrag', () => {
  test('Benzin 80.00 privat bezahlt, 50 % geteilt', () => {
    S.importTx([tx({ id: 'b', date: d1, amount: 8000, merchant: 'Tankstelle' }), tx({ id: 'g', acc: 'gemeinsam', date: d1, amount: 6000, merchant: 'Tankstelle' })]);
    S.tagTx(['b'], 'k-auto', 'k-auto-1', null, 5000);
    S.tagTx(['g'], 'k-auto', 'k-auto-1');
    expect(summary(S.state, 'privat', month).expense).toBe(4000);
    expect(summary(S.state, 'gemeinsam', month).expense).toBe(14000);
    expect(summary(S.state, 'alle', month).expense).toBe(14000);
    expect(summary(S.state, 'privat', month).shared).toBe(1);
    const all = viewTx(S.state, 'alle', month);
    expect(byAccount(S.state, all, 'alle', 'k-auto').map((x) => [x.label, x.value])).toEqual([['Privat', 8000], ['Gemeinsam', 6000]]);
    expect(byAccount(S.state, viewTx(S.state, 'privat', month), 'privat', 'k-auto').map((x) => x.value)).toEqual([4000]);
  });
  test('⅔ ich: Rundung auf ganze Rappen', () => {
    S.importTx([tx({ id: 'a', date: d1, amount: 1000 })]);
    S.tagTx(['a'], 'k-essen', null, null, 6667);
    expect(myPart(S.state.tx.get('a')!)).toBe(667);
    expect(amountIn(S.state, S.state.tx.get('a')!, 'gemeinsam')).toBe(1000);
  });
  test('Anteil auf dem gemeinsamen Konto oder bei Gutschriften hat keine Wirkung', () => {
    S.importTx([tx({ id: 'g', acc: 'gemeinsam', date: d1, amount: 1000 }), tx({ id: 'r', date: d1, amount: -500 })]);
    S.tagTx(['g'], 'k-auto', null, null, 5000);
    S.tagTx(['r'], 'k-essen', null, null, 5000);
    expect(summary(S.state, 'gemeinsam', month).expense).toBe(1000);
    expect(summary(S.state, 'privat', month).expense).toBe(-500);
  });
  test('Nur ich (null) hebt die Teilung wieder auf', () => {
    S.importTx([tx({ id: 'a', date: d1, amount: 1000 })]);
    S.tagTx(['a'], 'k-essen', null, null, 5000);
    S.tagTx(['a'], 'k-essen', null, null, null);
    expect(summary(S.state, 'privat', month).expense).toBe(1000);
    expect(viewTx(S.state, 'gemeinsam', month)).toHaveLength(0);
  });
});

describe('TEI-02: Anteile', () => {
  test.each([[null, 'Nur ich'], [5000, '50 %'], [6667, '⅔ ich'], [3000, '30 %'], [2550, '25.50 %'], [10000, 'Nur ich']])('%p → %p', (s, label) => {
    expect(shareLabel(s as number | null)).toBe(label);
  });
  test.each([0, 10001, 12.5, -1])('ungültiger Anteil %p wird abgelehnt', (s) => {
    S.importTx([tx({ id: 'a' })]);
    expect(() => S.tagTx(['a'], 'k-essen', null, null, s)).toThrow(/Anteil/);
  });
});

describe('TEI-04: bei geteilten Ausgaben auch die gemeinsamen Kategorien', () => {
  test('Wohnen nur wenn geteilt', () => {
    expect(catsFor(S.state, 'privat').some((c) => c.id === 'k-wohnen')).toBe(false);
    expect(catsFor(S.state, 'privat', true).some((c) => c.id === 'k-wohnen')).toBe(true);
    expect(catsFor(S.state, 'privat', true).some((c) => c.id === 'k-ferien')).toBe(true);
  });
  test('geteilte Miete vom privaten Konto erscheint in Gemeinsam unter Wohnen', () => {
    S.importTx([tx({ id: 'm', date: d1, amount: 190000 })]);
    S.tagTx(['m'], 'k-wohnen', 'k-wohnen-1', null, 5000);
    expect(aggregate(S.state, viewTx(S.state, 'gemeinsam', month), 'gemeinsam').map((x) => [x.id, x.value])).toEqual([['k-wohnen', 190000]]);
    expect(aggregate(S.state, viewTx(S.state, 'privat', month), 'privat').map((x) => [x.id, x.value])).toEqual([['k-wohnen', 95000]]);
  });
});

describe('TEI-06: Anteil pro Händler lernen', () => {
  test('Vorschlag 50 % wird gelernt; individueller Anteil ändert den gelernten nicht', () => {
    S.importTx([tx({ id: 'a', merchant: 'Tankstelle Blitz' }), tx({ id: 'b', merchant: 'Tankstelle Blitz' })]);
    const key = ruleKey(S.state.tx.get('a')!);
    S.tagTx(['a'], 'k-auto', null, key, 5000, 5000);
    expect(S.state.rules.get(key)).toEqual({ cat: 'k-auto', sub: null, share: 5000 });
    S.tagTx(['b'], 'k-auto', null, key, 3000);
    expect(S.state.rules.get(key)!.share).toBe(5000);
    S.tagTx(['b'], 'k-auto', null, key, null, null);
    expect(S.state.rules.get(key)!.share).toBeUndefined();
  });
});

describe('TEI-07: Standard-Anteil pro Kategorie', () => {
  test('wird gespeichert und geprüft', () => {
    S.patchCategory('k-auto', { defaultShare: 5000 });
    expect(S.state.categories.get('k-auto')!.defaultShare).toBe(5000);
  });
});

describe('TEI-08 bis TEI-10: Gutschriften nicht erfassen', () => {
  test('Nicht erfassen zählt nirgends', () => {
    S.importTx([tx({ id: 'r', date: d1, amount: -150000, merchant: 'Anna Beispiel' })]);
    S.skipCredit(['r']);
    expect(openTx(S.state)).toHaveLength(0);
    for (const v of ['privat', 'gemeinsam', 'alle'] as const) {
      const s = summary(S.state, v, month);
      expect([s.expense, s.income]).toEqual([0, 0]);
    }
  });
  test('Immer für diesen Absender: künftige Gutschriften automatisch, Belastungen nicht', () => {
    S.importTx([tx({ id: 'r1', date: d1, amount: -150000, merchant: 'Anna Beispiel' })]);
    S.skipCredit(['r1'], ruleKey(S.state.tx.get('r1')!));
    const r = S.importTx([tx({ id: 'r2', amount: -20000, merchant: 'ANNA BEISPIEL' }), tx({ id: 'd', amount: 5000, merchant: 'Anna Beispiel' })]);
    expect(r.excluded).toBe(1);
    expect(S.state.tx.get('r2')).toMatchObject({ status: 'excluded', note: 'Automatisch nicht erfasst' });
    expect(S.state.tx.get('d')!.status).toBe('open');
  });
});

describe('TEI-05/11: Liste und Export', () => {
  test('Export: voller Betrag, Anteil in Prozent, mein Betrag', () => {
    S.importTx([tx({ id: 'a', date: d1, amount: 8000, merchant: 'Tankstelle' })]);
    S.tagTx(['a'], 'k-auto', 'k-auto-1', null, 6667);
    const row = txRows(S.state, [S.state.tx.get('a')!])[1];
    expect(row.slice(6, 10)).toEqual(['80.00', 'CHF', '66.67', '53.34']);
  });
});
