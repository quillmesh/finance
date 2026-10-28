// PDF-Abrechnung der Kreditkarte (IMP-09, IMP-10, IMP-12). Alle PDFs sind erfunden (tests/pdf-bauen.mjs).
import { describe, expect, test } from 'bun:test';
// @ts-ignore – Hilfsskript in JavaScript, auch von den End-to-End-Tests genutzt
import { bauePdf } from '../pdf-bauen.mjs';
import { parseFile, parseUpload } from '../../src/parse';
import { formatCardNo, normalizeCardNo, splitMerchant } from '../../src/parse/cardpdf';

const KARTE = '5412 34XX XXXX 9876';
const tx = (d: string, text: string, amount: number, branch = 'Supermärkte, Lebensmittel') => ({ d, v: d, text, amount, branch });
const SPEC = {
  previous: 50000, payment: { d: '24.01.26', v: '25.01.26' },
  fees: [{ d: '20.02.26', v: '20.02.26', text: 'Rechnungsgebühr', amount: 200 }],
  cards: [{ no: KARTE, name: 'Visa Muster, Max Muster', tx: [
    tx('22.01.26', 'Dorfladen-12 Musterdorf, Musterdorf CH', 1235),
    tx('23.01.26', 'Bäckerei Müller (Filiale), Beispielstadt CH', 480, 'Bäckereien'),
    tx('24.01.26', 'Streamingdienst Muster, Amsterdam NL', 1290, 'Fernsehen und Radio'),
    tx('25.01.26', 'Sportgeschäft Muster, Musterstadt CH', -3990, 'Fachgeschäfte Diverses'),
    tx('26.01.26', 'Tankstelle Muster, Musterdorf CH', 812345, 'Tankstellen'),
  ] }],
};
const lies = (spec: object, acc = 'privat') => parseUpload(bauePdf(spec), acc);

describe('IMP-09: Kreditkarten-Abrechnung als PDF', () => {
  test('liest Datum, Händler, Ort, Branche und Betrag in Rappen', async () => {
    const r = await lies(SPEC);
    expect(r.format).toBe('visapdf');
    const t = r.tx.filter((x) => x.status !== 'excluded');
    expect(t).toHaveLength(6);
    expect(t[0]).toMatchObject({ date: '2026-02-20', amount: 200, merchant: 'Rechnungsgebühr', place: '', src: 'visa', acc: 'privat', status: 'open' });
    expect(t[1]).toMatchObject({ date: '2026-01-22', amount: 1235, merchant: 'Dorfladen-12 Musterdorf', place: 'Musterdorf, CH', details: 'Supermärkte, Lebensmittel' });
    expect(t[2]).toMatchObject({ merchant: 'Bäckerei Müller (Filiale)', place: 'Beispielstadt, CH', details: 'Bäckereien' });
    expect(t[4]).toMatchObject({ amount: -3990, merchant: 'Sportgeschäft Muster' });
    expect(t[5]).toMatchObject({ amount: 812345 });
    expect(r.check).toEqual({ ok: true, problems: [] });
  });
  test('IMP-05: «Ihre Zahlung» wird als Transfer ausgeschlossen, der Saldo der letzten Abrechnung nicht gelesen', async () => {
    const r = await lies(SPEC);
    const pay = r.tx.filter((x) => x.status === 'excluded');
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ amount: -50000, merchant: 'Zahlung an Kreditkarte', date: '2026-01-24' });
    expect(r.tx.some((x) => x.merchant.includes('Totalbetrag'))).toBe(false);
  });
  test('komprimiert, unkomprimiert und mit Objekt-Strom ergibt dasselbe', async () => {
    const a = await lies(SPEC), b = await lies({ ...SPEC, compress: false }), c = await lies({ ...SPEC, objStm: true });
    expect(b.tx).toEqual(a.tx);
    expect(c.tx).toEqual(a.tx);
  });
  test('mehrere Seiten: Kartenkopf und Übertrag wiederholen sich, die Kartensumme läuft weiter', async () => {
    const many = Array.from({ length: 40 }, (_, i) => tx(`${String(1 + (i % 28)).padStart(2, '0')}.01.26`, `Laden ${i}, Musterstadt CH`, 100 + i));
    const r = await lies({ previous: 0, payment: null, cards: [{ no: KARTE, name: 'Visa Muster, Max Muster', tx: many }], perPage: 9 });
    expect(r.tx).toHaveLength(40);
    expect(r.cards).toEqual(['541234XXXXXX9876']);
    expect(r.check?.ok).toBe(true);
    expect(r.tx.some((x) => /Übertrag|Zwischensumme/.test(x.merchant))).toBe(false);
  });
  test('zwei Karten auf einer Abrechnung, jede mit eigenem Total', async () => {
    const r = await lies({ ...SPEC, cards: [...SPEC.cards, { no: '4000 12XX XXXX 3456', name: 'Visa Zweit, Max Muster', tx: [tx('02.02.26', 'Kiosk Muster, Musterdorf CH', 350)] }] });
    expect(r.cards).toEqual(['541234XXXXXX9876', '400012XXXXXX3456']);
    expect(r.check?.ok).toBe(true);
    expect(r.tx).toHaveLength(8);
  });
  test('IMP-04: gleiche Buchung zweimal am selben Tag zählt zweimal; dieselbe Datei ergibt dieselben IDs', async () => {
    const twice = { ...SPEC, cards: [{ ...SPEC.cards[0], tx: [...SPEC.cards[0].tx, tx('22.01.26', 'Dorfladen-12 Musterdorf, Musterdorf CH', 1235)] }] };
    const a = await lies(twice), b = await lies(twice);
    const ids = a.tx.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.tx.filter((x) => x.merchant === 'Dorfladen-12 Musterdorf')).toHaveLength(2);
    expect(b.tx.map((x) => x.id)).toEqual(ids);
    expect(ids.every((id) => id.startsWith('privat:visa:pdf:'))).toBe(true);
  });
  test('Adresse, Kontonummer und Werbung werden nicht übernommen', async () => {
    const r = await lies(SPEC);
    const all = JSON.stringify(r.tx);
    expect(all).not.toContain('CH00');
    expect(all).not.toContain('Herausgegeben');
    expect(all).not.toContain('Angebot');
  });
  test('unbekanntes oder kaputtes PDF: verständlicher Fehler', async () => {
    const fremd = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 30 >>\nstream\nBT 9 0 0 9 10 10 Tm (Hallo)Tj ET\nendstream\nendobj\n');
    await expect(parseUpload(fremd, 'privat')).rejects.toThrow('PDF nicht erkannt');
    await expect(parseUpload(new TextEncoder().encode('%PDF-1.4 kaputt'), 'privat')).rejects.toThrow();
  });
  test('Textdateien gehen weiter über parseUpload (CSV)', async () => {
    const csv = 'Date,Value date,Booking text,Debit,Credit,Balance CHF\n03.02.2026,03.02.2026," Einkauf Musterladen ",12.50,,';
    expect((await parseUpload(new TextEncoder().encode(csv), 'privat')).format).toBe('bank');
  });
});

describe('IMP-10: Summenkontrolle', () => {
  test('falsches Kartentotal: Differenz wird gemeldet', async () => {
    const r = await lies({ ...SPEC, cardTotal: { [KARTE]: 820000 } });
    expect(r.check?.ok).toBe(false);
    expect(r.check?.problems).toEqual([{ label: 'Karte 5412 34XX XXXX 9876', read: 811360, expected: 820000 }]);
  });
  test('falscher Rechnungsbetrag: Differenz wird gemeldet', async () => {
    const r = await lies({ ...SPEC, invoice: 1000 });
    expect(r.check?.problems).toEqual([{ label: 'Rechnungsbetrag', read: 811560, expected: 1000 }]);
  });
  test('fehlende Buchungszeile wird erkannt (Total stimmt dann nicht)', async () => {
    const real = SPEC.cards[0].tx.reduce((a, t) => a + t.amount, 0);
    const r = await lies({ ...SPEC, cards: [{ ...SPEC.cards[0], tx: SPEC.cards[0].tx.slice(1) }], cardTotal: { [KARTE]: real }, invoice: 200 + real });
    expect(r.check?.ok).toBe(false);
    expect(r.check?.problems.map((p) => p.label)).toEqual(['Karte 5412 34XX XXXX 9876', 'Rechnungsbetrag']);
  });
});

describe('IMP-12: Kartennummern', () => {
  test('Schreibweisen werden vereinheitlicht, volle Nummern maskiert', () => {
    for (const s of ['5412 34XX XXXX 9876', '541234xxxxxx9876', '541234ABCDEF9876', '5412-34**-****-9876', '5412345678909876'])
      expect(normalizeCardNo(s)).toBe('541234XXXXXX9876');
    expect(normalizeCardNo('1234')).toBeNull();
    expect(normalizeCardNo('5412 34XX XXXX 987')).toBeNull();
    expect(formatCardNo('541234XXXXXX9876')).toBe(KARTE);
  });
  test('Kreditkarten-CSV: Kartennummern aus der Spalte CardId', () => {
    const csv = ['TransactionId,CardId,Date,ValutaDate,Amount,Currency,OriginalAmount,OriginalCurrency,MerchantName,MerchantPlace,MerchantCountry,StateType,Details,Type',
      'T1,541234ABCDEF9876,01/05/2026 10:00:00,01/06/2026 00:00:00,5.00,CHF,5.00,CHF,Kiosk,Musterdorf,CHE,BOOKED,Kiosk,merchant',
      'T2,KARTE,01/05/2026 10:00:00,01/06/2026 00:00:00,5.00,CHF,5.00,CHF,Kiosk,Musterdorf,CHE,BOOKED,Kiosk,merchant'].join('\n');
    expect(parseFile(csv, 'privat').cards).toEqual(['541234XXXXXX9876']);
  });
  test('Händler und Ort trennen', () => {
    expect(splitMerchant('Muster AG, Musterstadt CH')).toEqual({ merchant: 'Muster AG', place: 'Musterstadt, CH' });
    expect(splitMerchant('Bahn Muster, Bern, 65 CH')).toEqual({ merchant: 'Bahn Muster, Bern', place: '65, CH' });
    expect(splitMerchant('Rechnungsgebühr')).toEqual({ merchant: 'Rechnungsgebühr', place: '' });
  });
});
