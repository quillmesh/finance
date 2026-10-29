// Prüfungen gegen korrupte Daten (TST-03).
// validateEvent: vor dem Speichern jeder lokalen Änderung. Ungültig → wird nicht gespeichert.
// validateState: nach dem Laden. Meldet Probleme, ändert nichts.
import type { FinEvent, State, Tx } from './types';
import { validDate } from './parse/common';

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => Number.isInteger(v);
const STATUS = ['open', 'tagged', 'excluded'];
const SRC = ['visa', 'bank', 'manual'];
const SCOPES = ['privat', 'gemeinsam', 'beide'];
const KINDS = ['expense', 'transfer', 'income', 'saving'];
const sameName = (subs: { name: string; deleted?: boolean }[], name: string) =>
  subs.some((s) => !s.deleted && s.name.trim().toLowerCase() === name.trim().toLowerCase());

export function txProblems(t: Partial<Tx>, st: State): string[] {
  const p: string[] = [];
  if (!isStr(t.id) || !t.id) p.push('Buchung ohne ID');
  if (!isStr(t.acc) || !st.accounts.has(t.acc)) p.push(`Buchung ${t.id}: unbekanntes Konto`);
  if (!isStr(t.date) || !validDate(t.date)) p.push(`Buchung ${t.id}: ungültiges Datum`);
  if (!isInt(t.amount)) p.push(`Buchung ${t.id}: Betrag ist keine ganze Zahl in Rappen`);
  if (!SRC.includes(t.src as string)) p.push(`Buchung ${t.id}: unbekannte Quelle`);
  if (!STATUS.includes(t.status as string)) p.push(`Buchung ${t.id}: unbekannter Status`);
  if (t.share != null && (!isInt(t.share) || t.share < 1 || t.share > 10000)) p.push(`Buchung ${t.id}: Anteil muss zwischen 0.01 % und 100 % liegen`);
  if (t.status === 'tagged') {
    const c = t.cat ? st.categories.get(t.cat) : undefined;
    if (!c) p.push(`Buchung ${t.id}: Kategorie fehlt`);
    else if (t.sub && !c.subs.some((s) => s.id === t.sub && !s.deleted)) p.push(`Buchung ${t.id}: Unterkategorie gehört nicht zur Kategorie oder ist gelöscht`);
  }
  return p;
}

/** Prüft ein lokales Ereignis gegen den aktuellen Zustand. Rückgabe: Fehlertext oder null. */
export function validateEvent(e: FinEvent, st: State): string | null {
  const d = e.data;
  if (!d || typeof d !== 'object') return 'Ereignis ohne Daten';
  switch (e.type) {
    case 'tx.create': {
      const p = txProblems(d.tx ?? {}, st);
      return p.length ? p.join('; ') : null;
    }
    case 'tx.patch': {
      const t = st.tx.get(d.id);
      if (!t) return `Buchung ${d.id} existiert nicht`;
      const next = { ...t, ...d.patch };
      if (t.src !== 'manual' && d.patch && ('amount' in d.patch || 'date' in d.patch || 'acc' in d.patch)) return 'Importierte Buchungen: Betrag, Datum und Konto bleiben wie im Auszug';
      if (t.src !== 'manual' && d.patch?.deleted) return 'Importierte Buchungen werden nie gelöscht';
      const p = txProblems(next, st);
      return p.length ? p.join('; ') : null;
    }
    case 'cat.create': {
      const c = d.cat;
      if (!c || !isStr(c.id) || !isStr(c.name) || !c.name.trim()) return 'Kategorie ohne Namen';
      if (st.categories.has(c.id)) return 'Kategorie existiert schon';
      if (!SCOPES.includes(c.scope) || !KINDS.includes(c.kind)) return 'Kategorie: ungültiger Bereich oder Art';
      return null;
    }
    case 'cat.patch': {
      const c = st.categories.get(d.id);
      if (!c) return 'Kategorie existiert nicht';
      const n = { ...c, ...d.patch };
      if (!isStr(n.name) || !n.name.trim()) return 'Kategorie ohne Namen';
      if (!SCOPES.includes(n.scope) || !KINDS.includes(n.kind)) return 'Kategorie: ungültiger Bereich oder Art';
      if (d.patch?.deleted && [...st.tx.values()].some((t) => !t.deleted && t.status === 'tagged' && t.cat === c.id)) return 'Kategorie hat noch Buchungen';
      return null;
    }
    case 'sub.create': {
      const c = st.categories.get(d.cat);
      if (!c) return 'Kategorie existiert nicht';
      if (!isStr(d.sub?.id) || !isStr(d.sub?.name) || !d.sub.name.trim()) return 'Unterkategorie ohne Namen';
      if (c.subs.some((s) => s.id === d.sub.id)) return 'Unterkategorie existiert schon';
      if (sameName(c.subs, d.sub.name)) return `Unterkategorie «${d.sub.name.trim()}» gibt es schon`;
      return null;
    }
    case 'sub.patch': {
      const c = st.categories.get(d.cat);
      if (!c || !c.subs.some((s) => s.id === d.id)) return 'Unterkategorie existiert nicht';
      if (d.patch && 'name' in d.patch && (!isStr(d.patch.name) || !d.patch.name.trim())) return 'Unterkategorie ohne Namen';
      // Eindeutige Namen pro Kategorie, sonst lassen sich Unterkategorien nicht mehr unterscheiden (KAT-04)
      if (d.patch && 'name' in d.patch && sameName(c.subs.filter((s) => s.id !== d.id), d.patch.name)) return `Unterkategorie «${d.patch.name.trim()}» gibt es schon`;
      if (d.patch?.deleted === false && sameName(c.subs.filter((s) => s.id !== d.id), c.subs.find((s) => s.id === d.id)!.name)) return 'Eine Unterkategorie mit diesem Namen gibt es schon';
      return null;
    }
    case 'acc.patch': {
      if (!st.accounts.has(d.id)) return 'Konto existiert nicht';
      if (d.patch && 'area' in d.patch) return 'Der Bereich eines Kontos ist fest';
      if (d.patch && 'cardWords' in d.patch && !(Array.isArray(d.patch.cardWords) && d.patch.cardWords.every(isStr))) return 'Stichwörter ungültig';
      if (d.patch && 'cards' in d.patch && !(Array.isArray(d.patch.cards) && d.patch.cards.every((c: unknown) => isStr(c) && /^\d{6}X{6}\d{4}$/.test(c)))) return 'Kartennummer ungültig (Format 123456XXXXXX7890)';
      return null;
    }
    case 'rule.set': {
      if (!isStr(d.key)) return 'Regel ohne Schlüssel';
      const r = d.rule;
      if (r === null) return null;
      if (!r || typeof r !== 'object') return 'Regel ungültig';
      if (r.skip) return null;
      if (!st.categories.has(r.cat)) return 'Regel: Kategorie existiert nicht';
      if (r.share != null && (!isInt(r.share) || r.share < 1 || r.share > 10000)) return 'Regel: Anteil ungültig';
      return null;
    }
    case 'rules.clear': return null;
    case 'tx.trash': case 'tx.restore': {
      if (!Array.isArray(d.ids) || !d.ids.length || !d.ids.every(isStr)) return 'Buchungen ungültig';
      for (const id of d.ids) {
        const t = st.tx.get(id);
        if (!t) return `Buchung ${id} existiert nicht`;
        if (e.type === 'tx.trash' && t.deleted) return 'Buchung ist schon gelöscht';
        if (e.type === 'tx.restore' && (!t.deleted || t.trashedAt === undefined)) return 'Buchung ist nicht im Papierkorb';
      }
      return null;
    }
    case 'import.log': {
      if (!isStr(d.imp?.id) || !d.imp.id) return 'Import ohne ID';
      if (st.imports.has(d.imp.id)) return 'Import existiert schon';
      if (!st.accounts.has(d.imp.acc)) return 'Import: unbekanntes Konto';
      if (!Array.isArray(d.ids) || !d.ids.every(isStr)) return 'Import: Buchungen ungültig';
      return null;
    }
    case 'tx.remove': {
      if (!Array.isArray(d.ids) || !d.ids.every(isStr)) return 'Löschen: Buchungen ungültig';
      if (d.imp !== undefined && !st.imports.has(d.imp)) return 'Import existiert nicht';
      if (!d.ids.length && d.imp === undefined) return 'Nichts zu löschen';
      for (const id of d.ids) {
        const t = st.tx.get(id);
        if (!t) return `Buchung ${id} existiert nicht`;
        if (t.src === 'manual') return 'Manuelle Einträge werden einzeln gelöscht';
      }
      return null;
    }
    default: return `Unbekannter Ereignistyp ${e.type}`;
  }
}

/** Gesamtprüfung nach dem Laden (eindeutige IDs sind durch die Maps garantiert) */
export function validateState(st: State): string[] {
  const p: string[] = [];
  for (const t of st.tx.values()) if (!t.deleted) p.push(...txProblems(t, st));
  for (const c of st.categories.values()) {
    const ids = new Set<string>();
    for (const s of c.subs) { if (ids.has(s.id)) p.push(`Kategorie ${c.name}: doppelte Unterkategorie`); ids.add(s.id); }
  }
  return p;
}
