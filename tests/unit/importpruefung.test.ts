// Prüfungen vor dem Import: Summe (IMP-10), Überschneidung CSV ↔ PDF (IMP-11), Kartennummer pro Konto (IMP-12).
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { importWarnings } from '../../src/logic';
import { validateEvent } from '../../src/validate';
import { frisch, iso, tx } from './hilfen';

beforeEach(frisch);
const K1 = '541234XXXXXX9876', K2 = '400012XXXXXX3456';
const csvTx = (id: string, amount: number, date = iso(-3)) => tx({ id: `privat:visa:${id}`, src: 'visa', amount, date });
const pdfTx = (id: string, amount: number, date = iso(-3)) => tx({ id: `privat:visa:pdf:${id}-1`, src: 'visa', amount, date });

describe('IMP-10: Summenkontrolle', () => {
  test('Differenz wird als Warnung beschrieben', () => {
    const w = importWarnings(S.state, 'privat', { tx: [], cards: [], check: { ok: false, problems: [{ label: 'Karte 5412 34XX XXXX 9876', read: 95025, expected: 95225 }] } });
    expect(w).toEqual([{ kind: 'sum', text: 'Karte 5412 34XX XXXX 9876: gelesen 950.25, laut Abrechnung 952.25 – Differenz -2.00 CHF.' }]);
  });
  test('fehlendes Total wird gemeldet; stimmende Summe ergibt keine Warnung', () => {
    expect(importWarnings(S.state, 'privat', { tx: [], cards: [], check: { ok: false, problems: [{ label: 'Rechnungsbetrag', read: 100, expected: null }] } })[0].text).toContain('nicht gefunden');
    expect(importWarnings(S.state, 'privat', { tx: [pdfTx('a', 100)], cards: [], check: { ok: true, problems: [] } })).toEqual([]);
  });
});

describe('IMP-11: Überschneidung Kreditkarten-CSV und PDF', () => {
  test('PDF nach CSV: gleiche Buchungen (Datum + Betrag) werden gezählt', () => {
    S.importTx([csvTx('A', 1235), csvTx('B', 480), csvTx('C', 999, iso(-10))]);
    const w = importWarnings(S.state, 'privat', { tx: [pdfTx('a', 1235), pdfTx('b', 480), pdfTx('c', 999)], cards: [] });
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('overlap');
    expect(w[0].text).toStartWith('2 Buchungen gibt es im Konto');
    expect(w[0].text).toContain('Kreditkarten-CSV');
  });
  test('CSV nach PDF ebenso; zweimal derselbe Betrag am selben Tag wird einzeln gezählt', () => {
    S.importTx([pdfTx('a', 500)]);
    const w = importWarnings(S.state, 'privat', { tx: [csvTx('A', 500), csvTx('B', 500)], cards: [] });
    expect(w[0].text).toStartWith('1 Buchung gibt es');
    expect(w[0].text).toContain('Abrechnung (PDF)');
  });
  test('keine Warnung: anderes Konto, gleiche Quelle, bereits importierte ID, ausgeschlossene Zahlung', () => {
    S.importTx([tx({ id: 'gemeinsam:visa:X', acc: 'gemeinsam', src: 'visa', amount: 700, date: iso(-3) }), pdfTx('p', 800), csvTx('Z', -5000)]);
    S.patchTx('privat:visa:Z', { status: 'excluded' });
    expect(importWarnings(S.state, 'privat', { tx: [pdfTx('n', 700), pdfTx('p', 800), pdfTx('q', 800), pdfTx('z', -5000)], cards: [] })).toEqual([]);
  });
});

describe('IMP-12: Kartennummer pro Konto', () => {
  test('Karte gehört zu einem anderen Konto', () => {
    S.patchAccount('gemeinsam', { cards: [K1] });
    const w = importWarnings(S.state, 'privat', { tx: [], cards: [K1] });
    expect(w).toEqual([{ kind: 'card', text: 'Die Karte 5412 34XX XXXX 9876 ist beim Konto Gemeinsam hinterlegt, nicht bei Privat.' }]);
    expect(importWarnings(S.state, 'gemeinsam', { tx: [], cards: [K1] })).toEqual([]);
  });
  test('Konto hat andere Karten hinterlegt', () => {
    S.patchAccount('privat', { cards: [K2] });
    expect(importWarnings(S.state, 'privat', { tx: [], cards: [K1] })[0].text).toContain('bei keinem Konto hinterlegt');
  });
  test('ohne hinterlegte Karten keine Warnung (wie bisher)', () => {
    expect(importWarnings(S.state, 'privat', { tx: [], cards: [K1] })).toEqual([]);
  });
  test('nur maskierte Nummern werden gespeichert', () => {
    const ev = (cards: unknown) => ({ id: 'e', ts: 1, device: 'd', v: 1, type: 'acc.patch', data: { id: 'privat', patch: { cards } } });
    expect(validateEvent(ev([K1]), S.state)).toBeNull();
    expect(validateEvent(ev(['5412345678909876']), S.state)).not.toBeNull();
    expect(validateEvent(ev('x'), S.state)).not.toBeNull();
    expect(() => S.patchAccount('privat', { cards: ['1234'] })).toThrow();
    expect(S.state.accounts.get('privat')!.cards).toBeUndefined();
  });
});
