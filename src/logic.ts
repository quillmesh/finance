// Auswertung: reine Funktionen ohne Browser. Alle Beträge in Rappen.
import type { Area, Category, State, Tx } from './types';
import { AREA_LABEL, CASH_CAT, FULL } from './defaults';
import { fmt, plain, pct } from './money';
import { formatCardNo, type SumCheck } from './parse/cardpdf';

export type View = Area | 'alle';
export const VIEW_LABEL: Record<View, string> = { privat: 'Persönlich', gemeinsam: 'Gemeinsam', alle: 'Alle Konten' };
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ---------- Kategorien und Konten ----------

export const sortedCategories = (st: State): Category[] =>
  [...st.categories.values()].filter((c) => !c.deleted).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const areaOf = (st: State, accId: string): Area => st.accounts.get(accId)?.area ?? 'privat';

/**
 * Kategorien, die zum Bereich eines Kontos passen (BER-04).
 * Geteilte Ausgaben: zusätzlich die gemeinsamen (TEI-04).
 */
export const catsFor = (st: State, accId: string, shared = false): Category[] => {
  const area = areaOf(st, accId);
  return sortedCategories(st).filter((c) => c.scope === 'beide' || c.scope === area || (shared && c.scope === 'gemeinsam'));
};

export const liveSubs = (c: Category | undefined) => (c ? c.subs.filter((s) => !s.deleted) : []);
export const subName = (c: Category | undefined, id: string | null) => (c && id ? c.subs.find((s) => s.id === id)?.name ?? '' : '');
/** Unterkategorie nur, wenn es sie noch gibt (Vorschläge können auf gelöschte zeigen, KAT-05) */
export const liveSubId = (c: Category | undefined, id: string | null) => (c && id && c.subs.some((s) => s.id === id && !s.deleted) ? id : null);

export function catLabel(st: State, t: Tx): string {
  if (t.status === 'excluded') return 'Ignoriert' + (t.note ? ' · ' + t.note : '');
  if (t.status !== 'tagged') return 'Nicht getaggt';
  const c = t.cat ? st.categories.get(t.cat) : undefined;
  if (!c) return '(gelöschte Kategorie)';
  const s = subName(c, t.sub);
  return c.name + (s ? ' › ' + s : '');
}

// ---------- Händler-Vorschläge ----------

/** Händler vereinfacht: Zahlen, Satzzeichen und Gross/Klein spielen keine Rolle */
export const merchantKey = (t: Pick<Tx, 'merchant' | 'details'>) =>
  (t.merchant || t.details || '').toLowerCase().replace(/[0-9*#.,_\-()]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Vorschläge gelten pro Konto (gleicher Händler kann privat und gemeinsam anders sein) */
export const ruleKey = (t: Pick<Tx, 'acc' | 'merchant' | 'details'>) => `${t.acc}|${merchantKey(t)}`;

// ---------- Geteilte Ausgaben (TEI) ----------

/** Geteilt = Ausgabe auf einem Konto im Bereich Persönlich mit einem Anteil unter 100 % */
export const isShared = (st: State, t: Tx) =>
  t.amount > 0 && t.share != null && t.share > 0 && t.share < FULL && areaOf(st, t.acc) === 'privat';
/** Mein Anteil in Rappen (gerundet) */
export const myPart = (t: Pick<Tx, 'amount' | 'share'>) => (t.share != null && t.share > 0 && t.share < FULL ? Math.round((t.amount * t.share) / FULL) : t.amount);
/** Betrag in einer Sicht (TEI-03): Persönlich zählt nur meinen Anteil, die anderen Sichten den vollen Betrag */
export const amountIn = (st: State, t: Tx, view: View) => (view === 'privat' && isShared(st, t) ? myPart(t) : t.amount);
/** Anteil als Text, z. B. „50 %“ oder „⅔“ */
export function shareLabel(share: number | null | undefined): string {
  if (share == null || share >= FULL) return 'Nur ich';
  if (share === 6667) return '⅔ ich';
  return `${share % 100 ? (share / 100).toFixed(2) : String(share / 100)} %`;
}

// ---------- Bargeld-Topf (BAR-02 bis BAR-06) ----------
// Bargeldbezüge (Kategorie Bargeld) sind Ausgaben. Manuell erfasste Bargeldausgaben (Konto im Bereich Persönlich)
// werden dem ältesten Bezug mit Rest zugeordnet, der nicht nach der Ausgabe liegt, und zählen im Monat dieses
// Bezugs (Variante A). Was keinem Bezug zugeordnet werden kann, zählt im Monat der Ausgabe (Überschuss, BAR-06).

export interface CashPool {
  /** Nicht zugeordneter Rest pro Bezug */
  remaining: Map<string, number>;
  /** Teile pro manueller Ausgabe: Bezug (oder null = Überschuss), Betrag, Datum, in dem der Teil zählt */
  pieces: Map<string, { from: string | null; amount: number; date: string }[]>;
  unassigned: number;
  overflow: number;
}

const byDate = (a: Tx, b: Tx) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
export const isWithdrawal = (st: State, t: Tx) => !t.deleted && t.status === 'tagged' && t.cat === CASH_CAT && t.amount > 0 && t.src !== 'manual' && areaOf(st, t.acc) === 'privat';
export const isCashSpend = (st: State, t: Tx) => !t.deleted && t.status === 'tagged' && t.src === 'manual' && t.cat !== CASH_CAT && t.amount > 0 && areaOf(st, t.acc) === 'privat';

export function cashPool(st: State): CashPool {
  const all = [...st.tx.values()];
  const withdrawals = all.filter((t) => isWithdrawal(st, t)).sort(byDate);
  const spends = all.filter((t) => isCashSpend(st, t)).sort(byDate);
  const remaining = new Map(withdrawals.map((w) => [w.id, w.amount]));
  const pieces: CashPool['pieces'] = new Map();
  let overflow = 0;
  for (const s of spends) {
    let left = s.amount;
    const list: { from: string | null; amount: number; date: string }[] = [];
    for (const w of withdrawals) {
      if (!left) break;
      if (w.date > s.date) break;
      const r = remaining.get(w.id)!;
      if (!r) continue;
      const take = Math.min(r, left);
      remaining.set(w.id, r - take);
      left -= take;
      list.push({ from: w.id, amount: take, date: w.date });
    }
    if (left) { list.push({ from: null, amount: left, date: s.date }); overflow += left; }
    pieces.set(s.id, list);
  }
  return { remaining, pieces, unassigned: [...remaining.values()].reduce((a, b) => a + b, 0), overflow };
}

/**
 * Buchungen für die Auswertung: wie gespeichert, nur der Bargeld-Topf ist aufgelöst.
 * Bezüge zählen mit ihrem Rest, manuelle Bargeldausgaben in Teilen (ID „<id>~<n>“ ab dem zweiten Teil).
 * Invariante: Bargeld zählt genau einmal – Summe = Bezüge + Überschuss (nichts doppelt).
 */
export function ledger(st: State): Tx[] {
  const pool = cashPool(st);
  const out: Tx[] = [];
  for (const t of st.tx.values()) {
    if (t.deleted) continue;
    const rest = pool.remaining.get(t.id);
    const parts = pool.pieces.get(t.id);
    if (rest !== undefined) { if (rest > 0) out.push(rest === t.amount ? t : { ...t, amount: rest }); }
    else if (parts) parts.forEach((p, i) => out.push({ ...t, id: i ? `${t.id}~${i}` : t.id, amount: p.amount, date: p.date }));
    else out.push(t);
  }
  return out;
}

// ---------- Was zählt wo ----------
//   privat:    Konten im Bereich Persönlich; Einzahlungen aufs gemeinsame Konto sind Ausgaben (BER-02); geteilt: mein Anteil
//   gemeinsam: Konten im Bereich Gemeinsam + geteilte Ausgaben vom privaten Konto (voller Betrag); Einzahlungen sind Einnahmen
//   alle:      alle Konten, voller Betrag; Einzahlungen ausgeblendet, sonst doppelt gezählt (BER-08)

export const activeTx = (st: State): Tx[] => [...st.tx.values()].filter((t) => !t.deleted);
export const inView = (st: State, t: Tx, view: View) =>
  view === 'alle' || areaOf(st, t.acc) === view || (view === 'gemeinsam' && isShared(st, t));

const kindOf = (st: State, t: Tx) => (t.status === 'tagged' && t.cat ? st.categories.get(t.cat)?.kind : undefined);

export function countsAsExpense(st: State, t: Tx, view: View): boolean {
  const k = kindOf(st, t);
  if (!k || k === 'income' || k === 'saving') return false;
  if (k === 'transfer') return view === 'privat';
  return true;
}
export const isIncome = (st: State, t: Tx) => kindOf(st, t) === 'income';
export const isSaving = (st: State, t: Tx) => kindOf(st, t) === 'saving';
export const isTransfer = (st: State, t: Tx) => kindOf(st, t) === 'transfer';

/** Buchungen einer Sicht und eines Zeitraums ('2026-10', '2026' oder leer = alles), ohne ignorierte */
export const viewTx = (st: State, view: View, period = '') =>
  ledger(st).filter((t) => t.status !== 'excluded' && inView(st, t, view) && t.date.startsWith(period));

export interface Slice { id: string; label: string; color: string; value: number; shade: number }

/** Summe pro Kategorie (oder pro Unterkategorie von `drill`), absteigend (AUS-01, AUS-02) */
export function aggregate(st: State, txs: Tx[], view: View, drill: string | null = null): Slice[] {
  const list = txs.filter((t) => countsAsExpense(st, t, view) && (!drill || t.cat === drill));
  const groups = new Map<string, number>();
  for (const t of list) {
    const k = drill ? t.sub ?? '' : t.cat!;
    groups.set(k, (groups.get(k) ?? 0) + amountIn(st, t, view));
  }
  const dc = drill ? st.categories.get(drill) : undefined;
  const items = [...groups].map(([id, value]) => {
    if (drill) return { id, label: subName(dc, id) || 'Ohne Unterkategorie', color: dc?.color ?? '#93a1a1', value, shade: 1 };
    const c = st.categories.get(id);
    return { id, label: c?.name ?? '(gelöschte Kategorie)', color: c?.color ?? '#93a1a1', value, shade: 1 };
  }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (drill) items.forEach((it, i) => (it.shade = Math.max(0.3, 1 - i * 0.14)));
  return items;
}

/** Aufteilung einer Kategorie nach Konto; manuelle Einträge (Bargeld/Partnerin) separat (BER-07) */
export function byAccount(st: State, txs: Tx[], view: View, catId: string) {
  const m = new Map<string, number>();
  for (const t of txs) if (t.cat === catId && countsAsExpense(st, t, view)) {
    const k = `${t.acc}|${t.src === 'manual' ? 'manual' : 'import'}`;
    m.set(k, (m.get(k) ?? 0) + amountIn(st, t, view));
  }
  const out: { accId: string; area: Area; label: string; value: number }[] = [];
  for (const a of st.accounts.values()) for (const s of ['import', 'manual'] as const) {
    const v = m.get(`${a.id}|${s}`);
    if (v !== undefined) out.push({ accId: a.id, area: a.area, label: s === 'manual' ? a.manualLabel : a.name, value: v });
  }
  return out;
}

export interface Summary { expense: number; count: number; income: number; saving: number; saldo: number | null; open: number; openSum: number; hiddenTransfers: number; shared: number }

export function summary(st: State, view: View, period: string): Summary {
  const txs = viewTx(st, view, period);
  const exp = txs.filter((t) => countsAsExpense(st, t, view));
  const open = txs.filter((t) => t.status === 'open');
  const expense = exp.reduce((a, t) => a + amountIn(st, t, view), 0);
  const income = view === 'alle' ? 0 : -txs.filter((t) => isIncome(st, t)).reduce((a, t) => a + t.amount, 0) || 0;
  const saving = txs.filter((t) => isSaving(st, t)).reduce((a, t) => a + t.amount, 0);
  return {
    expense, count: exp.length, income, saving,
    saldo: view !== 'alle' && income ? income - expense - saving : null,
    open: open.length, openSum: open.reduce((a, t) => a + t.amount, 0),
    hiddenTransfers: view === 'alle' ? txs.filter((t) => isTransfer(st, t)).reduce((a, t) => a + t.amount, 0) : 0,
    shared: exp.filter((t) => isShared(st, t)).length,
  };
}

/** Verfügbare Zeiträume einer Sicht, neueste zuerst */
export function periods(st: State, view: View, mode: 'month' | 'year'): string[] {
  const set = new Set(viewTx(st, view).map((t) => (mode === 'month' ? t.date.slice(0, 7) : t.date.slice(0, 4))));
  return [...set].sort().reverse();
}
export const periodLabel = (p: string) => (p.length === 4 ? p : `${MONTHS[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`);

/** Ausgaben pro Monat eines Jahres (AUS-03). Ohne Kategorie: inkl. noch nicht getaggter Belastungen. */
export function monthly(st: State, view: View, year: string, area: Area | null, drill: string | null): number[] {
  const v = Array(12).fill(0) as number[];
  for (const t of viewTx(st, view, year)) {
    if (area && areaOf(st, t.acc) !== area) continue;
    const ok = drill ? t.cat === drill && countsAsExpense(st, t, view) : countsAsExpense(st, t, view) || (t.status === 'open' && t.amount > 0);
    if (ok) v[+t.date.slice(5, 7) - 1] += amountIn(st, t, view);
  }
  return v;
}

// ---------- Export (EXP-01, EXP-02, TEI-11) ----------

export function reportRows(st: State, view: View, period: string): string[][] {
  const txs = viewTx(st, view, period);
  const V = VIEW_LABEL[view], P = periodLabel(period);
  const rows = [['Sicht', 'Zeitraum', 'Kategorie', 'Unterkategorie', 'Betrag CHF', 'Anteil %']];
  const cats = aggregate(st, txs, view);
  const total = cats.reduce((a, c) => a + c.value, 0);
  for (const c of cats) for (const s of aggregate(st, txs, view, c.id)) rows.push([V, P, c.label, s.label, plain(s.value), pct(s.value, total)]);
  const s = summary(st, view, period);
  if (s.open) rows.push([V, P, 'Nicht getaggt', '', plain(s.openSum), '']);
  rows.push([V, P, 'Total getaggt', '', plain(total), '100.0']);
  if (s.income) rows.push([V, P, view === 'gemeinsam' ? 'Einzahlungen' : 'Einnahmen', '', plain(s.income), '']);
  if (s.saving) rows.push([V, P, 'Sparen & Vorsorge', '', plain(s.saving), '']);
  return rows;
}

const STATUS_LABEL = { open: 'offen', tagged: 'getaggt', excluded: 'ignoriert' } as const;
export function txRows(st: State, list: Tx[]): string[][] {
  return [['Datum', 'Konto', 'Bereich', 'Quelle', 'Händler', 'Details', 'Betrag', 'Währung', 'Mein Anteil %', 'Mein Betrag', 'Kategorie', 'Unterkategorie', 'Status', 'Notiz'],
    ...list.map((t) => {
      const a = st.accounts.get(t.acc);
      const c = t.cat ? st.categories.get(t.cat) : undefined;
      const tagged = t.status === 'tagged';
      const shared = isShared(st, t);
      return [t.date, a?.name ?? t.acc, a ? AREA_LABEL[a.area] : '', srcLabel(st, t), t.merchant, t.details, plain(t.amount), t.cur,
        shared ? (t.share! / 100).toFixed(2) : '100.00', plain(shared ? myPart(t) : t.amount),
        tagged && c ? c.name : '', tagged ? subName(c, t.sub) : '', STATUS_LABEL[t.status], t.note];
    })];
}

export function srcLabel(st: State, t: Tx): string {
  if (t.src === 'manual') return st.accounts.get(t.acc)?.manualLabel ?? 'Manuell';
  return t.src === 'visa' ? 'Karte' : 'Bank';
}

/** Offene Buchungen in Tagging-Reihenfolge (älteste zuerst) */
export const openTx = (st: State) => activeTx(st).filter((t) => t.status === 'open').sort(byDate);

// ---------- Prüfungen vor dem Import (IMP-10, IMP-11, IMP-12) ----------

export interface ImportWarning { kind: 'sum' | 'card' | 'overlap'; text: string }
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
/** Herkunft einer Kreditkarten-Buchung: aus der PDF-Abrechnung oder aus der CSV */
export const cardOrigin = (t: Pick<Tx, 'id'>) => (t.id.includes(':visa:pdf:') ? 'pdf' : 'csv');

/**
 * Warnungen, bevor eine Datei ins Konto `accId` importiert wird. Leer = ohne Rückfrage importieren.
 * - sum:     PDF-Summen stimmen nicht mit den Totals der Abrechnung überein (IMP-10)
 * - overlap: gleiche Kreditkarten-Buchungen (Datum + Betrag) gibt es schon aus der anderen Quelle, CSV ↔ PDF (IMP-11)
 * - card:    Karte in der Datei ist bei einem anderen Konto hinterlegt, oder das Konto hat andere Karten (IMP-12)
 */
export function importWarnings(st: State, accId: string, r: { tx: Tx[]; cards: string[]; check?: SumCheck }): ImportWarning[] {
  const w: ImportWarning[] = [];
  const accName = st.accounts.get(accId)?.name ?? accId;
  if (r.check && !r.check.ok) {
    for (const p of r.check.problems) {
      w.push({ kind: 'sum', text: p.expected === null
        ? (p.label === 'Rechnungsbetrag' ? `Das Total des Rechnungsbetrags wurde nicht gefunden (gelesen ${fmt(p.read)}).` : `${p.label}.`)
        : `${p.label}: gelesen ${fmt(p.read)}, laut Abrechnung ${fmt(p.expected)} – Differenz ${fmt(p.read - p.expected)} CHF.` });
    }
  }
  for (const c of r.cards) {
    const owners = [...st.accounts.values()].filter((a) => a.cards?.includes(c));
    const mine = st.accounts.get(accId)?.cards ?? [];
    if (owners.length && !owners.some((a) => a.id === accId)) w.push({ kind: 'card', text: `Die Karte ${formatCardNo(c)} ist beim Konto ${owners.map((a) => a.name).join(', ')} hinterlegt, nicht bei ${accName}.` });
    else if (!owners.length && mine.length) w.push({ kind: 'card', text: `Die Karte ${formatCardNo(c)} ist bei keinem Konto hinterlegt. Beim Konto ${accName} ist ${mine.length === 1 ? 'eine andere Karte' : 'sind andere Karten'} hinterlegt (${mine.map(formatCardNo).join(', ')}).` });
  }
  const fresh = r.tx.filter((t) => t.src === 'visa' && t.status !== 'excluded' && !st.tx.has(t.id));
  if (fresh.length) {
    const key = (t: Tx) => `${t.date}|${t.amount}`;
    const pool = new Map<string, Tx[]>();
    for (const t of st.tx.values()) {
      if (t.acc !== accId || t.src !== 'visa' || t.deleted || t.status === 'excluded') continue;
      const k = `${cardOrigin(t)}|${key(t)}`;
      pool.set(k, [...(pool.get(k) ?? []), t]);
    }
    const hits: Tx[] = [];
    let other = '';
    for (const t of fresh) {
      const o = cardOrigin(t) === 'pdf' ? 'csv' : 'pdf';
      const list = pool.get(`${o}|${key(t)}`);
      if (list?.length) { hits.push(list.shift()!); other = o; }
    }
    if (hits.length) {
      const e = hits[0];
      w.push({ kind: 'overlap', text: `${hits.length === 1 ? '1 Buchung gibt' : `${hits.length} Buchungen gibt`} es im Konto ${accName} schon aus einer Kreditkarten-${other === 'pdf' ? 'Abrechnung (PDF)' : 'CSV'} mit gleichem Datum und Betrag, z. B. ${dmy(e.date)} · ${e.merchant} · ${fmt(e.amount)}. Werden sie trotzdem importiert, zählen sie doppelt.` });
    }
  }
  return w;
}

// ---------- Import-Historie (IMP-13) ----------

export interface ImportInfo {
  id: string; ts: number; acc: string; accName: string; area: Area; name: string; format: string; auto: boolean;
  /** Zeitraum der Buchungen (YYYY-MM-DD) */
  from: string; to: string;
  total: number; tagged: number; open: number; excluded: number;
}
const FORMAT_LABEL: Record<string, string> = {
  visa: 'Kreditkarten-CSV', visapdf: 'Kreditkarten-PDF', bank: 'Bank-CSV', bankdetail: 'Bank-CSV', camt: 'camt.053',
};
export const formatLabel = (f: string) => FORMAT_LABEL[f] ?? f;

/** Importe mit noch vorhandenen Buchungen, neueste zuerst. `limit` = Anzahl (Standard alle). */
export function importHistory(st: State, limit = Infinity): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const r of st.imports.values()) {
    if (r.removed) continue;
    const txs = r.ids.filter((x) => st.importOf.get(x) === r.id).map((x) => st.tx.get(x)).filter((t): t is Tx => !!t && !t.deleted);
    if (!txs.length) continue;
    const dates = txs.map((t) => t.date).sort();
    const acc = st.accounts.get(r.acc);
    out.push({
      id: r.id, ts: r.ts, acc: r.acc, accName: acc?.name ?? r.acc, area: acc?.area ?? 'privat', name: r.name, format: r.format, auto: !!r.auto,
      from: dates[0], to: dates[dates.length - 1], total: txs.length,
      tagged: txs.filter((t) => t.status === 'tagged').length, open: txs.filter((t) => t.status === 'open').length, excluded: txs.filter((t) => t.status === 'excluded').length,
    });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// ---------- Transaktionen zu einem Stück im Kuchendiagramm (AUS-07) ----------

/**
 * Buchungen, die in der Übersicht (Sicht, Zeitraum) zur Kategorie `catId` zählen; mit `subId` nur diese
 * Unterkategorie ('' = ohne Unterkategorie). Bargeldbezüge, die teilweise zugeordnet sind, erscheinen als ganze Buchung;
 * `sum` ist der Betrag im Diagramm.
 */
export function sliceTx(st: State, view: View, period: string, catId: string, subId?: string): { tx: Tx[]; sum: number } {
  const parts = viewTx(st, view, period).filter((t) => countsAsExpense(st, t, view) && t.cat === catId && (subId === undefined || (t.sub ?? '') === subId));
  const ids = [...new Set(parts.map((t) => t.id.split('~')[0]))];
  const tx = ids.map((id) => st.tx.get(id)!).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { tx, sum: parts.reduce((a, t) => a + amountIn(st, t, view), 0) };
}

// ---------- Papierkorb (TAG-13, TAG-15) ----------

export const DAY_MS = 86_400_000;
/** Buchungen im Papierkorb, die noch wiederhergestellt werden können (jünger als `days`), neueste zuerst */
export function trashList(st: State, now = Date.now(), days = 30): { tx: Tx; daysLeft: number }[] {
  return [...st.tx.values()]
    .filter((t) => t.deleted && t.trashedAt !== undefined && now - t.trashedAt < days * DAY_MS)
    .sort((a, b) => b.trashedAt! - a.trashedAt!)
    .map((tx) => ({ tx, daysLeft: Math.min(days, Math.max(1, Math.ceil((tx.trashedAt! + days * DAY_MS - now) / DAY_MS))) }));
}
/** Buchungen einer Datei, die früher einzeln gelöscht wurden (Papierkorb oder endgültig): beim Import nachfragen (TAG-15) */
export const deletedInFile = (st: State, list: Pick<Tx, 'id'>[]): Tx[] =>
  list.map((t) => st.tx.get(t.id)).filter((t): t is Tx => !!t && !!t.deleted && t.trashedAt !== undefined && t.src !== 'manual');
