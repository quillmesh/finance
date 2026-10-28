// Kontoauszug als CSV mit Sammelbuchungen (Semikolon), IMP-02.
// Spalten: Datum; Buchungstext; Whg; Betrag Detail; <…>-Referenz; Referenznummer; Belastung CHF; Gutschrift CHF; Valuta; Saldo CHF; Zahlungszweck; Details
// Sammelbuchungen (z. B. «Belastungen Dauerauftrag (2)») stehen mit ihren Einzelposten in den Folgezeilen ohne Datum.
// Die Einzelposten werden als eigene Buchungen übernommen, die Sammelbuchung selbst nicht (sonst doppelt).
import { parseRappen } from '../money';
import type { Tx } from '../types';
import { CASH_CAT, CASH_SUB } from '../defaults';
import { hash } from './csv';
import { chDate, isCardPayment, isCashWithdrawal, newTx, titleCase } from './common';

const norm = (s: string) => s.trim().toLowerCase();

export function isDetailBankCSV(rows: string[][]): boolean {
  const h = (rows[0] ?? []).map(norm);
  return h.includes('buchungstext') && h.includes('belastung chf') && h.includes('gutschrift chf') && h.includes('valuta') && h.includes('betrag detail');
}

/** Händler aus dem Buchungstext */
export function detailParty(text: string): { merchant: string; details: string } {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^Einkauf .*?Card Nr\.?\s*[x\d ]+,\s*(.+)$/i))) return { merchant: titleCase(m[1].trim()), details: 'Debitkarte' };
  if ((m = text.match(/^Gutschrift Auftraggeber:\s*([^,]+)/i))) return { merchant: m[1].trim(), details: 'Gutschrift' };
  if ((m = text.match(/^(Belastung[^:]*):\s*(.+)$/i))) return { merchant: m[2].trim(), details: m[1].trim() };
  if ((m = text.match(/^(Gutschrift[^:]*):\s*(.+)$/i))) return { merchant: m[2].trim(), details: m[1].trim() };
  return { merchant: text.trim(), details: '' };
}

export function parseDetailBankCSV(rows: string[][], acc: string, cardWords: string[] = []): Tx[] {
  const h = rows[0].map(norm);
  const I = (n: string | RegExp) => h.findIndex((x) => (typeof n === 'string' ? x === n : n.test(x)));
  const iD = I('datum'), iT = I('buchungstext'), iDet = I('betrag detail'), iRef = I(/referenz$/), iRef2 = I('referenznummer'),
    iDe = I('belastung chf'), iCr = I('gutschrift chf'), iV = I('valuta'), iZ = I('zahlungszweck'), iX = I('details');
  const out: Tx[] = [];
  const mark = (t: Tx, text: string) => {
    if (/^Übertrag von/i.test(text)) Object.assign(t, { status: 'excluded', note: 'Übertrag von eigenem Konto' });
    else if (isCardPayment(text, cardWords)) Object.assign(t, { status: 'excluded', note: 'Kreditkartenzahlung (Transfer)' });
    else if (isCashWithdrawal(text)) Object.assign(t, { status: 'tagged', cat: CASH_CAT, sub: CASH_SUB, note: 'Bargeldbezug' });
    return t;
  };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = chDate(r[iV]) || chDate(r[iD]);
    if (!date) continue; // Detailzeile ohne Sammelbuchung davor
    const text = (r[iT] ?? '').replace(/\s+/g, ' ').trim();
    const de = parseRappen(r[iDe]), cr = parseRappen(r[iCr]);
    if (!text || (isNaN(de) && isNaN(cr))) continue;
    const amount = !isNaN(de) ? de : -cr;
    const ref = (r[iRef] ?? '').trim() || (r[iRef2] ?? '').trim() || hash(`${date}|${text}|${amount}`);
    // Einzelposten einer Sammelbuchung
    const details: { text: string; amount: number; purpose: string }[] = [];
    while (i + 1 < rows.length && !(rows[i + 1][iD] ?? '').trim() && (rows[i + 1][iT] ?? '').trim()) {
      const d = rows[++i];
      const a = parseRappen(d[iDet]);
      if (!isNaN(a)) details.push({ text: (d[iT] ?? '').trim(), amount: amount < 0 ? -Math.abs(a) : Math.abs(a), purpose: (d[iZ] ?? '').trim() });
    }
    const sum = details.reduce((s, d) => s + d.amount, 0);
    if (details.length && sum === amount) {
      details.forEach((d, n) => out.push(mark(newTx({
        id: `${acc}:bank:${ref}-${n + 1}`, acc, src: 'bank', date, amount: d.amount,
        merchant: d.text, details: [text, d.purpose].filter(Boolean).join(' · '),
      }), `${text} ${d.text} ${d.purpose}`)));
      continue;
    }
    const p = detailParty(text);
    const purpose = [(r[iZ] ?? '').trim(), (r[iX] ?? '').trim()].filter(Boolean).join(' · ');
    out.push(mark(newTx({
      id: `${acc}:bank:${ref}`, acc, src: 'bank', date, amount, merchant: p.merchant || text,
      details: [p.details, purpose].filter(Boolean).join(' · '),
      note: details.length ? 'Sammelbuchung: Einzelposten ergeben nicht den Betrag' : '',
    }), text));
  }
  return out;
}
