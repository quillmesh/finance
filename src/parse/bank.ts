// Kontoauszug eines Bankkontos als CSV aus dem E-Banking, IMP-02.
// Spalten: Date, Value date, Booking text, Debit, Credit, Balance CHF (oder deutsch).
// Massgebend ist das Valutadatum. Händler werden aus dem Buchungstext gelesen.
import { parseRappen } from '../money';
import type { Tx } from '../types';
import { hash } from './csv';
import { CASH_CAT, CASH_SUB } from '../defaults';
import { chDate, isCardPayment, isCashWithdrawal, newTx, titleCase } from './common';

export function isBankCSV(rows: string[][]): boolean {
  const h = (rows[0] ?? []).map((x) => x.trim().toLowerCase());
  return (h.includes('booking text') || h.includes('buchungstext')) && (h.includes('debit') || h.includes('belastung'));
}

/** Empfängername ohne Adresse: stoppt bei Strasse, Postfach, PLZ oder Hausnummer */
export function partyName(head: string): string {
  const out: string[] = [];
  for (const w of head.split(' ').filter(Boolean)) {
    if (out.length && /^(postfach|case|avenue|av\.|rue|chemin|via|route|ch)$/i.test(w)) break;
    if (out.length && /(strasse|str\.|gasse|weg|platz|allee)$/i.test(w)) break;
    if (out.length && /^\d{4}$/.test(w)) break;
    if (out.length && /^\d{1,3}[a-z]?$/i.test(w)) { if (out.length > 1) out.pop(); break; }
    out.push(w);
  }
  return out.join(' ');
}

/** Zerlegt einen Buchungstext in Händler, Ort, Details und Referenz */
export function parseBookingText(text: string): { merchant: string; place: string; details: string; ref: string } {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^TWINT-Zahlung (.+?)(?:, ([^+]+?))? \+\d{6,}/))) {
    return { merchant: titleCase(m[1].trim()), place: m[2] ? titleCase(m[2].trim()) : '', details: 'TWINT', ref: '' };
  }
  if ((m = text.match(/^TWINT-(Belastung Geld gesendet an|Gutschrift Geld erhalten von) (.+?) \+\d{6,} ?(.*?) ?\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/))) {
    const dir = m[1].startsWith('Belastung') ? 'gesendet' : 'erhalten';
    return { merchant: m[2].trim(), place: '', details: `TWINT ${dir}${m[3] ? ' · ' + m[3] : ''}`, ref: '' };
  }
  if ((m = text.match(/^(.+?) \/ Ref\.-Nr\. (\d+) ?(.*)$/))) {
    const rest = m[3];
    const cut = rest.search(/ ?(Mitteilung|Referenz|Ursprünglicher Auftraggeber):/);
    const head = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/^[*\s]+/, '').trim();
    const mt = rest.match(/(?:Mitteilung|Referenz): (.+?)(?= Ursprünglicher Auftraggeber:|$)/);
    const msg = mt ? mt[1].replace(/\s*\d{15,}\s*$/, '').trim() : '';
    return { merchant: titleCase(partyName(head)), place: '', details: [m[1], msg].filter(Boolean).join(' · '), ref: m[2] };
  }
  // Ohne erkennbares Muster: Kartennummern und Zeiträume entfernen
  const merchant = text.replace(/\*{4,}\d*/g, '').replace(/\d{2}\.\d{2}\.\d{4}( - \d{2}\.\d{2}\.\d{4})?/g, '').replace(/\s+/g, ' ').trim();
  return { merchant, place: '', details: '', ref: '' };
}

export function parseBankCSV(rows: string[][], acc: string, cardWords: string[] = []): Tx[] {
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const I = (...n: string[]) => { for (const x of n) { const i = h.indexOf(x); if (i >= 0) return i; } return -1; };
  const iD = I('date', 'datum', 'buchungsdatum'), iV = I('value date', 'valuta', 'valutadatum'), iT = I('booking text', 'buchungstext'),
    iDe = I('debit', 'belastung'), iCr = I('credit', 'gutschrift');
  const out: Tx[] = [];
  for (const r of rows.slice(1)) {
    const text = (r[iT] ?? '').replace(/\s+/g, ' ').trim();
    const date = (iV >= 0 && chDate(r[iV])) || chDate(r[iD]);
    const de = parseRappen(r[iDe]), cr = parseRappen(r[iCr]);
    if (!date || !text || (isNaN(de) && isNaN(cr))) continue;
    const amount = !isNaN(de) ? de : -cr;
    const p = parseBookingText(text);
    const t = newTx({
      id: `${acc}:bank:${p.ref || hash(`${date}|${text}|${amount}`)}`, acc, src: 'bank', date, amount,
      merchant: p.merchant || text, details: p.details, place: p.place,
    });
    // Automatisch ausgeschlossen (IMP-05). Ausgehende Überträge bleiben offen: Sparen oder Einzahlung aufs gemeinsame Konto.
    // Bargeldbezüge zählen als Ausgabe «Bargeld › Nicht zugeordnet» (BAR-02).
    if (/^Übertrag von/i.test(text)) Object.assign(t, { status: 'excluded', note: 'Übertrag von eigenem Konto', merchant: 'Übertrag eigenes Konto' });
    else if (isCardPayment(text, cardWords)) Object.assign(t, { status: 'excluded', note: 'Kreditkartenzahlung (Transfer)' });
    else if (isCashWithdrawal(text)) Object.assign(t, { status: 'tagged', cat: CASH_CAT, sub: CASH_SUB, note: 'Bargeldbezug' });
    out.push(t);
  }
  return out;
}
