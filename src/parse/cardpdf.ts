// Kreditkarten-Abrechnung als PDF (IMP-09) mit Summenkontrolle (IMP-10).
// Aufbau (pro Zeile, Zellen von links nach rechts):
//   Datum Valuta Details … Betrag in CHF [-]      Buchung; „-“ = Gutschrift. Darunter oft eine Zeile mit der Branche.
//         Valuta Totalbetrag letzte Abrechnung  Betrag
//   1234 56XX XXXX 7890 <Kartenname>, <Inhaber>  Beginn eines Kartenblocks (wiederholt sich auf jeder Seite)
//   Total Karte …  Betrag                        Summe des Kartenblocks
//   Total Rechnungsbetrag …  Betrag              letzte Abrechnung − Zahlungen + alle Buchungen
// Übertrag, Zwischensumme, Adressen, Werbung und Kontonummern werden nicht gelesen.
import { parseRappen } from '../money';
import type { Tx } from '../types';
import { hash } from './csv';
import { newTx } from './common';
import type { PdfLine } from './pdf';

export interface SumProblem { label: string; read: number; expected: number | null }
export interface SumCheck { ok: boolean; problems: SumProblem[] }

const DATE = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;
const AMOUNT = /^[+-]?\d{1,3}(?:['’]?\d{3})*\.\d{2}$/;
const CARD = /^(\d{4}) ?(\d{2})XX XXXX (\d{4})\b/;

const texts = (l: PdfLine) => l.cells.map((c) => c.text.trim()).filter(Boolean);

export function isCardPdf(lines: PdfLine[]): boolean {
  return lines.some((l) => {
    const t = texts(l);
    return t[0] === 'Datum' && t.includes('Valuta') && t.includes('Details') && t.some((x) => /^Betrag in CHF$/.test(x));
  });
}

function isoDate(s: string): string {
  const m = s.match(DATE);
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2]}-${m[1]}`;
}

/** Betrag am Zeilenende: „1'732.20“ oder „1'732.20 -“ (Gutschrift). null, wenn keiner da ist. */
function lineAmount(t: string[]): { amount: number; rest: string[] } | null {
  let k = t.length - 1, neg = false;
  if (t[k] === '-') { neg = true; k--; }
  else if (/^\S+\s-$/.test(t[k] ?? '')) { neg = true; t = [...t.slice(0, k), t[k].slice(0, -2)]; }
  if (k < 0 || !AMOUNT.test(t[k])) return null;
  const a = parseRappen(t[k]);
  return Number.isNaN(a) ? null : { amount: neg ? -a : a, rest: t.slice(0, k) };
}

/** „Dorfladen-12 Musterdorf, Musterdorf CH“ → Händler „Dorfladen-12 Musterdorf“, Ort „Musterdorf, CH“ */
export function splitMerchant(text: string): { merchant: string; place: string } {
  let s = text.trim(), country = '';
  const cm = s.match(/^(.*\S)\s+([A-Z]{2})$/);
  if (cm && cm[1].includes(',')) { s = cm[1]; country = cm[2]; }
  const i = s.lastIndexOf(', ');
  if (i < 0) return { merchant: s, place: country };
  return { merchant: s.slice(0, i).trim(), place: [s.slice(i + 2).trim(), country].filter(Boolean).join(', ') };
}

/** Kartennummer wie im Auszug („1234 56XX XXXX 7890“) oder in der CSV („123456ABCDEF7890“) → „123456XXXXXX7890“ */
export function normalizeCardNo(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  const m = s.match(/^(\d{6})[0-9A-Z*]{6}(\d{4})$/);
  return m ? `${m[1]}XXXXXX${m[2]}` : null;
}
/** „123456XXXXXX7890“ → „1234 56XX XXXX 7890“ */
export const formatCardNo = (n: string) => n.replace(/^(\d{4})(\d{2})X{6}(\d{4})$/, '$1 $2XX XXXX $3');

export interface CardPdfResult { tx: Tx[]; cards: string[]; check: SumCheck }

export function parseCardPdf(lines: PdfLine[], acc: string): CardPdfResult {
  const tx: Tx[] = [];
  const cards: string[] = [];
  const cardSums = new Map<string, number>();
  const problems: SumProblem[] = [];
  let card: string | null = null;
  let previous = 0, all = 0, invoice: number | null = null;
  const seen = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const t = texts(lines[i]);
    if (!t.length) continue;
    const joined = t.join(' ');
    const cm = joined.match(CARD);
    if (cm) {
      card = normalizeCardNo(cm[1] + cm[2] + 'XXXXXX' + cm[3]);
      if (card && !cards.includes(card)) { cards.push(card); cardSums.set(card, 0); }
      continue;
    }
    if (/^Total Karte\b/.test(joined)) {
      const a = lineAmount(t);
      const c = card ?? '';
      if (a) problems.push({ label: `Karte ${formatCardNo(c)}`, read: cardSums.get(c) ?? 0, expected: a.amount });
      card = null;
      continue;
    }
    if (/^Total Rechnungsbetrag\b/.test(joined)) { invoice = lineAmount(t)?.amount ?? null; continue; }
    // Saldo der letzten Abrechnung: nur Valuta, kein Buchungsdatum
    if (DATE.test(t[0]) && /^Totalbetrag letzte Abrechnung/.test(t[1] ?? '')) { previous = lineAmount(t)?.amount ?? 0; continue; }
    if (!(DATE.test(t[0]) && DATE.test(t[1] ?? ''))) continue;
    const a = lineAmount(t);
    if (!a || a.rest.length < 3) continue;
    const date = isoDate(t[0]);
    const text = a.rest.slice(2).join(' ').trim();
    // Branche des Herausgebers: nächste Zeile ohne Datum und ohne Betrag
    const next = lines[i + 1] ? texts(lines[i + 1]) : [];
    const branch = next.length === 1 && !DATE.test(next[0]) && !AMOUNT.test(next[0]) && !CARD.test(next[0]) && !/^(Total|Zwischensumme|Übertrag|Seite)\b/.test(next[0]) ? next[0] : '';
    const key = `${date}|${t[1]}|${text}|${a.amount}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const { merchant, place } = splitMerchant(text);
    const pay = a.amount < 0 && /^ihre zahlung/i.test(text);
    const tr = newTx({
      id: `${acc}:visa:pdf:${hash(key)}-${n}`, acc, src: 'visa', date, amount: a.amount,
      merchant: pay ? 'Zahlung an Kreditkarte' : merchant, place: pay ? '' : place, details: branch || text,
    });
    // Zahlung an die Karte: Transfer, zählt nicht (IMP-05)
    if (pay) Object.assign(tr, { status: 'excluded', note: 'Kartenzahlung (Transfer)' });
    tx.push(tr);
    all += a.amount;
    if (card) cardSums.set(card, (cardSums.get(card) ?? 0) + a.amount);
  }
  if (!tx.length) problems.push({ label: 'Keine Buchungen gefunden', read: 0, expected: null });
  problems.push({ label: 'Rechnungsbetrag', read: previous + all, expected: invoice });
  const bad = problems.filter((p) => p.expected === null || p.read !== p.expected);
  return { tx, cards, check: { ok: bad.length === 0, problems: bad } };
}
