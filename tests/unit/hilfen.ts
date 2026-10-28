// Gemeinsame Hilfen für Unit-Tests
import * as S from '../../src/store';
import * as db from '../../src/db';
import { newTx } from '../../src/parse/common';
import type { Tx } from '../../src/types';

/** Datum in n Tagen als YYYY-MM-DD (Tests nie mit festen Kalenderdaten, ausser Parser-Beispiele) */
export const iso = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Frischer, leerer Speicher */
export async function frisch() {
  db.resetMemoryForTests();
  S.resetForTests();
  await S.init();
}

let n = 0;
/** Testbuchung; Betrag in Rappen */
export const tx = (p: Partial<Tx> = {}): Tx => newTx({ id: `t${++n}`, acc: 'privat', src: 'bank', date: iso(-1), amount: 1000, merchant: 'Händler ' + n, ...p });
