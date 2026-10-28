// Kreditkarten-Export als CSV, IMP-01.
// Spalten: TransactionId, CardId, Date (MM/DD/YYYY hh:mm:ss), ValutaDate, Amount, Currency,
//          OriginalAmount, OriginalCurrency, MerchantName, MerchantPlace, MerchantCountry, StateType, Details, Type
import { parseRappen } from '../money';
import type { Tx } from '../types';
import { newTx } from './common';

export function isVisaCSV(rows: string[][]): boolean {
  const h = rows[0] ?? [];
  return h.includes('TransactionId') && h.includes('MerchantName');
}

export function parseVisa(rows: string[][], acc: string): Tx[] {
  const h = rows[0];
  const I = (n: string) => h.indexOf(n);
  const iId = I('TransactionId'), iDate = I('Date'), iAmt = I('Amount'), iCur = I('Currency'), iOC = I('OriginalCurrency'),
    iMer = I('MerchantName'), iPl = I('MerchantPlace'), iCo = I('MerchantCountry'), iDet = I('Details'), iState = I('StateType');
  const out: Tx[] = [];
  for (const r of rows.slice(1)) {
    if (!r[iId]) continue;
    const d = (r[iDate] ?? '').split(' ')[0].split('/');
    if (d.length !== 3) continue;
    const date = `${d[2]}-${d[0].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
    const amount = parseRappen(r[iAmt]);
    if (isNaN(amount)) continue;
    const details = (r[iDet] ?? '').trim();
    const t = newTx({
      id: `${acc}:visa:${r[iId]}`, acc, src: 'visa', date, amount,
      cur: r[iCur] || 'CHF', origCur: r[iOC] || '',
      merchant: (r[iMer] ?? '').replace(/^-\s*/, '').trim() || details,
      details, place: [r[iPl], r[iCo]].filter(Boolean).join(', '),
    });
    if (iState >= 0 && r[iState] && r[iState] !== 'BOOKED') t.note = 'Status: ' + r[iState];
    // Zahlung an die Karte („Ihre Zahlung – Danke“): Transfer, zählt nicht (IMP-05)
    if (amount < 0 && /ihre zahlung/i.test(details)) {
      Object.assign(t, { status: 'excluded', note: 'Kartenzahlung (Transfer)', merchant: 'Zahlung an Kreditkarte' });
    }
    out.push(t);
  }
  return out;
}
