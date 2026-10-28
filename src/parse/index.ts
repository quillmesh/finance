// Erkennt das Dateiformat und liest die Buchungen.
import type { Tx } from '../types';
import { parseCSV } from './csv';
import { isVisaCSV, parseVisa } from './visa';
import { isBankCSV, parseBankCSV } from './bank';
import { isCamt, parseCamt } from './camt';
import { isDetailBankCSV, parseDetailBankCSV } from './bankdetail';
import { isPdf, pdfLines } from './pdf';
import { isCardPdf, normalizeCardNo, parseCardPdf, type SumCheck } from './cardpdf';
import { validDate } from './common';

export type Format = 'visa' | 'bank' | 'bankdetail' | 'camt' | 'visapdf';

export function detect(text: string): Exclude<Format, 'visapdf'> | null {
  if (isCamt(text)) return 'camt';
  const rows = parseCSV(text.split(/\r?\n/, 2).join('\n'));
  if (isVisaCSV(rows)) return 'visa';
  if (isBankCSV(rows)) return 'bank';
  if (isDetailBankCSV(rows)) return 'bankdetail';
  return null;
}

export interface ParseResult {
  format: Format;
  tx: Tx[];
  /** Kartennummern in der Datei, maskiert „123456XXXXXX7890“ (IMP-12) */
  cards: string[];
  /** Nur PDF: Vergleich der gelesenen Buchungen mit den Totals der Abrechnung (IMP-10) */
  check?: SumCheck;
}

const clean = (tx: Tx[]) => tx.filter((t) => validDate(t.date) && Number.isInteger(t.amount));

/**
 * Liest eine Textdatei ins Konto `acc`. Wirft einen Fehler, wenn das Format unbekannt ist.
 * `cardWords`: Stichwörter für Kreditkarten-Abbuchungen dieses Kontos (Einstellung des Nutzers).
 */
export function parseFile(text: string, acc: string, cardWords: string[] = []): ParseResult {
  const format = detect(text);
  if (!format) throw new Error('Format nicht erkannt. Unterstützt: Kreditkarten-CSV und -PDF, Bank-CSV, camt.053.');
  let cards: string[] = [];
  const tx = format === 'camt' ? parseCamt(text, acc, cardWords)
    : format === 'visa' ? (() => { const rows = parseCSV(text); cards = visaCards(rows); return parseVisa(rows, acc); })()
      : format === 'bankdetail' ? parseDetailBankCSV(parseCSV(text), acc, cardWords)
        : parseBankCSV(parseCSV(text), acc, cardWords);
  return { format, tx: clean(tx), cards };
}

/** Kartennummern aus der Spalte CardId der Kreditkarten-CSV */
function visaCards(rows: string[][]): string[] {
  const i = rows[0]?.indexOf('CardId') ?? -1;
  if (i < 0) return [];
  const set = new Set<string>();
  for (const r of rows.slice(1)) { const n = normalizeCardNo(r[i] ?? ''); if (n) set.add(n); }
  return [...set];
}

/** Liest eine hochgeladene Datei (PDF oder Text) ins Konto `acc` (IMP-09). */
export async function parseUpload(bytes: Uint8Array, acc: string, cardWords: string[] = []): Promise<ParseResult> {
  if (!isPdf(bytes)) return parseFile(new TextDecoder().decode(bytes), acc, cardWords);
  const lines = await pdfLines(bytes);
  if (!isCardPdf(lines)) throw new Error('PDF nicht erkannt. Unterstützt wird die Abrechnung der Kreditkarte.');
  const r = parseCardPdf(lines, acc);
  return { format: 'visapdf', tx: clean(r.tx), cards: r.cards, check: r.check };
}

export { parseCSV, toCSV, hash } from './csv';
