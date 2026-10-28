// Import-Historie (IMP-13), ganzen Import löschen (IMP-14), alle offenen löschen (IMP-15). Alle Daten erfunden.
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { importHistory, ledger } from '../../src/logic';
import { validateEvent, validateState } from '../../src/validate';
import type { FinEvent } from '../../src/types';
import { frisch, iso, tx } from './hilfen';

beforeEach(frisch);
const datei = (prefix: string, n: number, acc = 'privat', days = 0) =>
  Array.from({ length: n }, (_, i) => tx({ id: `${acc}:visa:${prefix}${i}`, acc, src: 'visa', amount: 1000 + i, date: iso(-(days + i)) }));

describe('IMP-13: Import-Historie', () => {
  test('Import wird mit Datei, Konto, Bereich, Zeitraum und Zählern protokolliert', () => {
    const r = S.importTx(datei('a', 4, 'privat', 3), { name: 'abrechnung.pdf', format: 'visapdf' });
    expect(r.importId).toBeTruthy();
    S.tagTx(['privat:visa:a0'], 'k-einkaufen', null);
    S.patchTx('privat:visa:a1', { status: 'excluded' });
    expect(importHistory(S.state)).toEqual([{
      id: r.importId!, ts: expect.any(Number), acc: 'privat', accName: 'Privat', area: 'privat', name: 'abrechnung.pdf', format: 'visapdf', auto: false,
      from: iso(-6), to: iso(-3), total: 4, tagged: 1, open: 2, excluded: 1,
    }]);
  });
  test('neueste zuerst, Begrenzung auf 5; Duplikate zählen beim ersten Import', () => {
    for (let i = 0; i < 7; i++) S.importTx(datei(`f${i}-`, 2, i % 2 ? 'gemeinsam' : 'privat'), { name: `datei${i}.csv`, format: 'visa' });
    S.importTx(datei('f0-', 2), { name: 'nochmals.csv', format: 'visa' }); // nur Duplikate → kein Eintrag
    const h = importHistory(S.state, 5);
    expect(h.map((x) => x.name)).toEqual(['datei6.csv', 'datei5.csv', 'datei4.csv', 'datei3.csv', 'datei2.csv']);
    expect(h[0]).toMatchObject({ accName: 'Privat', area: 'privat' });
    expect(h[1]).toMatchObject({ accName: 'Gemeinsam', area: 'gemeinsam' });
  });
  test('ältere Importe ohne Protokoll werden rekonstruiert: zusammenhängend gespeichert = ein Import', () => {
    const ev = (n: number, ts: number, t: object, device = 'A'): FinEvent => ({ id: `e${n}`, ts, device, type: 'tx.create', data: { tx: t }, v: 1 });
    const T = 1_800_000_000_000;
    const st = S.buildState([
      ev(1, T, tx({ id: 'p1', date: iso(-9) })), ev(2, T + 1, tx({ id: 'p2', date: iso(-2) })), ev(3, T + 2, tx({ id: 'p3' })),
      ev(4, T + 3, tx({ id: 'g1', acc: 'gemeinsam' })),                       // anderes Konto → eigener Import
      ev(5, T + 60_000, tx({ id: 'p4' })),                                    // eine Minute später → eigener Import
      ev(6, T + 60_001, tx({ id: 'p5' }), 'B'),                               // anderes Gerät → eigener Import
      ev(7, T + 60_002, tx({ id: 'm1', src: 'manual' }), 'B'),                // manuell → kein Import
    ]);
    const h = importHistory(st);
    expect(h.map((x) => x.total).sort()).toEqual([1, 1, 1, 3]);
    const big = h.find((x) => x.total === 3)!;
    expect(big).toMatchObject({ auto: true, name: '', acc: 'privat', from: iso(-9), to: iso(-1) });
  });
});

describe('IMP-14: ganzen Import löschen', () => {
  test('löscht alle Buchungen des Imports, auch getaggte; andere Importe bleiben', () => {
    const a = S.importTx(datei('a', 3), { name: 'falsch.pdf', format: 'visapdf' });
    const b = S.importTx(datei('b', 2), { name: 'richtig.pdf', format: 'visapdf' });
    S.tagTx(['privat:visa:a0', 'privat:visa:b0'], 'k-einkaufen', null);
    expect(S.removeImport(a.importId!)).toBe(3);
    expect([...S.state.tx.keys()].sort()).toEqual(['privat:visa:b0', 'privat:visa:b1']);
    expect(importHistory(S.state).map((x) => x.id)).toEqual([b.importId]);
    expect(validateState(S.state)).toEqual([]);
  });
  test('derselbe Import danach nochmals: Buchungen kommen wieder, offen', () => {
    const a = S.importTx(datei('a', 2), { name: 'x.csv', format: 'visa' });
    S.tagTx(['privat:visa:a0'], 'k-einkaufen', null);
    S.removeImport(a.importId!);
    const again = S.importTx(datei('a', 2), { name: 'x.csv', format: 'visa' });
    expect(again.added).toBe(2);
    expect(S.state.tx.get('privat:visa:a0')!.status).toBe('open');
    expect(importHistory(S.state)).toHaveLength(1);
  });
  test('Buchung, die schon aus einem früheren Import stammt, bleibt beim Löschen des späteren', () => {
    S.importTx(datei('a', 2), { name: 'alt.csv', format: 'visa' });
    const b = S.importTx([...datei('a', 2), ...datei('n', 1)], { name: 'neu.csv', format: 'visa' });
    expect(S.removeImport(b.importId!)).toBe(1);
    expect(S.state.tx.has('privat:visa:a0')).toBe(true);
  });
  test('Abspielen und anderes Gerät: Änderungen an entfernten Buchungen werden ignoriert, gleicher Zustand', async () => {
    const a = S.importTx(datei('a', 2), { name: 'x.csv', format: 'visa' });
    S.removeImport(a.importId!);
    await S.whenSaved();
    const late: FinEvent = { id: 'spaet', ts: Date.now() + 10, device: 'B', type: 'tx.patch', data: { id: 'privat:visa:a0', patch: { status: 'excluded' } }, v: 1 };
    await S.mergeEvents([late]);
    expect(S.state.tx.size).toBe(0);
    expect(validateState(S.state)).toEqual([]);
  });
  test('Bargeld: gelöschter Bezug verschwindet aus dem Bargeld-Topf', () => {
    const a = S.importTx([tx({ id: 'privat:bank:bar', amount: 20000, status: 'tagged', cat: 'k-bargeld', sub: 'k-bargeld-1' })], { name: 'bank.csv', format: 'bank' });
    S.removeImport(a.importId!);
    expect(ledger(S.state)).toEqual([]);
  });
});

describe('IMP-15: alle offenen Einträge löschen', () => {
  test('löscht nur offene importierte; getaggte, ausgeschlossene und manuelle bleiben; optional pro Konto', () => {
    S.importTx([...datei('a', 3), ...datei('g', 2, 'gemeinsam')]);
    S.tagTx(['privat:visa:a0'], 'k-einkaufen', null);
    S.patchTx('privat:visa:a1', { status: 'excluded' });
    S.addManual({ acc: 'privat', date: iso(-1), amount: 500, merchant: 'Bar', cat: 'k-einkaufen', sub: null });
    expect(S.removeOpen('gemeinsam')).toBe(2);
    expect(S.removeOpen()).toBe(1);
    expect(S.removeOpen()).toBe(0);
    expect([...S.state.tx.values()].map((t) => t.status).sort()).toEqual(['excluded', 'tagged', 'tagged']);
  });
  test('Prüfung: manuelle Einträge und unbekannte Buchungen lassen sich so nicht löschen', () => {
    const m = S.addManual({ acc: 'privat', date: iso(-1), amount: 500, merchant: 'Bar', cat: 'k-einkaufen', sub: null });
    const ev = (data: object): FinEvent => ({ id: 'e', ts: 1, device: 'd', type: 'tx.remove', data, v: 1 });
    expect(validateEvent(ev({ ids: [m] }), S.state)).not.toBeNull();
    expect(validateEvent(ev({ ids: ['gibtsnicht'] }), S.state)).not.toBeNull();
    expect(validateEvent(ev({ ids: [] }), S.state)).not.toBeNull();
    expect(validateEvent(ev({ ids: [], imp: 'gibtsnicht' }), S.state)).not.toBeNull();
  });
});
