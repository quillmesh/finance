// UMG-04: Erfundene Beispieldaten – reproduzierbar, im echten Format, relativ zu heute
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { parseFile } from '../../src/parse';
import { sampleFiles, seedSample } from '../../src/seed';
import { openTx, summary } from '../../src/logic';
import { validateState } from '../../src/validate';
import { frisch } from './hilfen';

beforeEach(frisch);

describe('Beispieldaten', () => {
  test('gleicher Tag → gleiche Dateien; alle Formate werden erkannt', () => {
    const today = new Date();
    const a = sampleFiles(today), b = sampleFiles(today);
    expect(a.map((f) => f.text)).toEqual(b.map((f) => f.text));
    expect(a.map((f) => parseFile(f.text, f.acc).format)).toEqual(['visa', 'bank', 'bank']);
    for (const f of a) expect(parseFile(f.text, f.acc).tx.length).toBeGreaterThan(20);
  });
  test('nichts liegt in der Zukunft', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    for (const f of sampleFiles(today)) for (const t of parseFile(f.text, f.acc).tx) expect(t.date <= iso).toBe(true);
  });
  test('Test-App: Vormonate getaggt, laufender Monat offen, Zahlen stimmen', () => {
    seedSample();
    expect(validateState(S.state)).toEqual([]);
    expect(openTx(S.state).length).toBeGreaterThan(5);
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const p = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const s = summary(S.state, 'privat', p);
    expect(s.expense).toBeGreaterThan(150000);
    expect(s.income).toBe(650000);
    expect(summary(S.state, 'gemeinsam', p).income).toBe(300000);
    expect(summary(S.state, 'alle', p).hiddenTransfers).toBe(150000);
  });
});
