import type { Tx } from '../types';

/** Neue Buchung mit Standardwerten */
export function newTx(p: Pick<Tx, 'id' | 'acc' | 'src' | 'date' | 'amount'> & Partial<Tx>): Tx {
  return {
    cur: 'CHF', origCur: '', merchant: '', details: '', place: '',
    status: 'open', cat: null, sub: null, note: '',
    ...p,
  };
}

/** Grossbuchstaben-Text lesbar machen: „ELEKTRO MUSTER“ → „Elektro Muster“, Rechtsformen bleiben (AG, SA, GmbH) */
const LEGAL: Record<string, string> = { ag: 'AG', sa: 'SA', gmbh: 'GmbH', kg: 'KG' };
export function titleCase(s: string): string {
  if (/[a-zäöüéèà]/.test(s)) return s;
  return s.toLowerCase()
    .replace(/(^|[\s\-(/&])([a-zäöüéèà])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Ag|Sa|Gmbh|Kg)\b/g, (w) => LEGAL[w.toLowerCase()]);
}

/**
 * Erkennt Zahlungen an die Kreditkarte (Transfer, zählt sonst doppelt). Kartengebühren sind echte Ausgaben.
 * `words`: zusätzliche Stichwörter, die der Nutzer pro Konto festlegt (z. B. der Name des Kartenherausgebers).
 * Diese stehen nur in seinen Daten, nie im Code.
 */
export const isCardPayment = (text: string, words: string[] = []) => {
  if (/geb(ü|ue)hr/i.test(text)) return false;
  if (/kreditkart|kartenkonto/i.test(text)) return true;
  const t = text.toLowerCase();
  return words.some((w) => w.trim() && t.includes(w.trim().toLowerCase()));
};
export const isCashWithdrawal = (text: string) => /bancomat|geldautomat|bargeldbezug|\batm\b/i.test(text);

/** TT.MM.JJJJ → JJJJ-MM-TT, sonst '' */
export function chDate(s: string | undefined): string {
  const m = (s ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'));
