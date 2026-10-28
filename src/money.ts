// Geldbeträge als ganze Rappen (TST-01). Umrechnung ohne Kommazahlen-Arithmetik.

/**
 * Liest einen Betrag aus Text in Rappen: „1'500.00“ → 150000, „12“ → 1200, „-4.6“ → -460,
 * „105.800“ → 10580. Mehr als zwei Nachkommastellen werden kaufmännisch gerundet.
 * Leer oder ungültig → NaN.
 */
export function parseRappen(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return NaN;
  let s = String(input).trim().replace(/['’\s]/g, '');
  if (!s) return NaN;
  // Komma als Dezimaltrenner nur, wenn kein Punkt vorkommt („12,50“)
  if (!s.includes('.') && /,\d{1,3}$/.test(s)) s = s.replace(',', '.');
  s = s.replace(/,/g, '');
  const m = s.match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] ? parseInt(m[2], 10) : 0;
  const frac = (m[3] ?? '').padEnd(3, '0');
  let total = whole * 100 + parseInt(frac.slice(0, 2), 10);
  if (parseInt(frac[2], 10) >= 5) total += 1;
  return total === 0 ? 0 : sign * total;
}

/** Rappen als Text mit Schweizer Tausendertrenner: 150000 → „1’500.00“ */
export function fmt(rappen: number): string {
  const neg = rappen < 0;
  const abs = Math.abs(Math.round(rappen));
  const fr = String(abs % 100).padStart(2, '0');
  const ch = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${neg ? '-' : ''}${ch}.${fr}`;
}

/** Rappen als Text für CSV (ohne Tausendertrenner): 150000 → „1500.00“ */
export function plain(rappen: number): string {
  const neg = rappen < 0;
  const abs = Math.abs(Math.round(rappen));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Anteil in Prozent mit einer Nachkommastelle, ohne Rundungsfehler bei der Anzeige */
export function pct(part: number, total: number): string {
  if (!total) return '0.0';
  return (Math.round((part / total) * 1000) / 10).toFixed(1);
}

export const sum = (list: { amount: number }[]) => list.reduce((a, t) => a + t.amount, 0);
