// Zustand der App: entsteht aus dem Ereignis-Log.
// Jede Änderung = ein Ereignis → geprüft, angewendet und in IndexedDB gespeichert.
//
// KOMPATIBILITÄT (bei jeder Erweiterung einhalten, siehe README „Regeln für Erweiterungen“):
// 1. Ereignisse werden nie geändert oder gelöscht, nur neue angehängt.
// 2. Neue Felder sind optional. Fehlt ein Feld (ältere Daten), setzt normalize*() den Standardwert.
// 3. Unbekannte Felder bleiben erhalten, damit ältere App-Versionen neuere Daten nicht beschädigen.
// 4. Unbekannte Ereignistypen werden übersprungen, aber gespeichert und weiter synchronisiert.
// 5. Felder werden nie umbenannt oder in ihrer Bedeutung geändert. Stattdessen: neues Feld.
// 6. IDs aus defaults.ts nie ändern.

import * as db from './db';
import { ENV, IS_TEST } from './env';
import { decryptJSON, encryptJSON, type EncryptedFile } from './crypto';
import { CASH_CAT, DEFAULT_ACCOUNTS, defaultCategories, PALETTE } from './defaults';
import { ruleKey } from './logic';
import type { Category, EventType, FinEvent, ImportRec, Rule, State, Sub, Tx } from './types';
import { validateEvent, validateState } from './validate';
import { newTx } from './parse/common';

/** Format der Ereignisse. Nur erhöhen, wenn alte Apps neue Ereignisse nicht mehr verstehen dürften. */
export const EVENT_FORMAT = 1;

export function emptyState(): State {
  return {
    accounts: new Map(DEFAULT_ACCOUNTS.map((a) => [a.id, { ...a }])),
    categories: new Map(defaultCategories().map((c) => [c.id, c])),
    tx: new Map(),
    rules: new Map(),
    imports: new Map(),
    importOf: new Map(),
  };
}

/** Ältere Importe ohne `import.log`: Buchungen desselben Geräts und Kontos, höchstens so weit auseinander, gelten als ein Import */
export const AUTO_IMPORT_GAP_MS = 2000;

export let state: State = emptyState();
export const info = { device: '', eventCount: 0, problems: [] as string[], persistent: true };

let lastTs = 0;
const listeners = new Set<() => void>();
const localListeners = new Set<() => void>();
let onErr: (msg: string) => void = (m) => console.error(m);
export const onChange = (fn: () => void) => { listeners.add(fn); };
/** Nach jeder lokalen Änderung (z. B. um den Sync anzustossen) */
export const onLocalChange = (fn: () => void) => { localListeners.add(fn); };
export const onError = (fn: (msg: string) => void) => { onErr = fn; };
export const refresh = () => listeners.forEach((fn) => fn());

export function uid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Reducer: Ereignis → Zustand (rein, ohne Browser) ----------

export function normalizeTx(d: Partial<Tx> & { id: string }): Tx {
  return newTx({ acc: 'privat', src: 'bank', date: '', amount: 0, ...d } as Tx);
}
export function normalizeCategory(d: Partial<Category> & { id: string }): Category {
  return { name: '', color: PALETTE[0], scope: 'beide', kind: 'expense', order: 1000, ...d, subs: (d.subs ?? []).map((s) => ({ ...s })) };
}

const IMMUTABLE_IMPORT = ['id', 'acc', 'date', 'amount', 'src', 'cur', 'origCur'];

export function applyEvent(st: State, e: FinEvent): void {
  try { applyUnsafe(st, e); } catch (err) { console.warn('Ereignis übersprungen', e?.id, err); }
}

function applyUnsafe(st: State, e: FinEvent) {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  switch (e.type as EventType) {
    case 'tx.create': {
      // Schon vorhanden (zweiter Import, zweites Gerät): die erste gilt (IMP-04)
      if (typeof d.tx?.id !== 'string' || st.tx.has(d.tx.id)) break;
      const t = normalizeTx(d.tx);
      st.tx.set(t.id, t);
      if (t.src === 'manual' || st.importOf.has(t.id)) break;
      // Import ohne Protokoll (vor 0.6.0, Beispieldaten): an den letzten passenden Import anhängen oder neuen beginnen
      const last = [...st.imports.values()].pop();
      if (last?.auto && !last.removed && last.device === e.device && last.acc === t.acc && e.ts - last.lastTs <= AUTO_IMPORT_GAP_MS) {
        last.ids.push(t.id); last.lastTs = e.ts;
        st.importOf.set(t.id, last.id);
      } else {
        const rec: ImportRec = { id: `auto:${e.id}`, ts: e.ts, device: e.device, acc: t.acc, name: '', format: t.src, ids: [t.id], auto: true, lastTs: e.ts };
        st.imports.set(rec.id, rec);
        st.importOf.set(t.id, rec.id);
      }
      break;
    }
    case 'import.log': {
      const imp = d.imp;
      if (typeof imp?.id !== 'string' || st.imports.has(imp.id) || !Array.isArray(d.ids)) break;
      const ids = d.ids.filter((x: unknown) => typeof x === 'string' && !st.tx.has(x as string)) as string[];
      st.imports.set(imp.id, { id: imp.id, ts: e.ts, device: e.device, acc: String(imp.acc ?? ''), name: String(imp.name ?? ''), format: String(imp.format ?? ''), ids, lastTs: e.ts });
      for (const x of ids) st.importOf.set(x, imp.id);
      break;
    }
    case 'tx.remove': {
      // Importierte Buchungen ganz entfernen; ein erneuter Import derselben Datei legt sie wieder an
      if (Array.isArray(d.ids)) for (const x of d.ids) {
        const t = st.tx.get(x);
        if (t && t.src !== 'manual') { st.tx.delete(x); st.importOf.delete(x); }
      }
      const rec = typeof d.imp === 'string' ? st.imports.get(d.imp) : undefined;
      if (rec) rec.removed = true;
      break;
    }
    case 'tx.patch': {
      const t = st.tx.get(d.id);
      if (!t || !d.patch) break;
      if (t.deleted && d.patch.deleted !== false) break;
      const patch = { ...d.patch };
      delete patch.id;
      // Importierte Buchungen bleiben wie im Auszug (TST-05), auch bei Daten von anderen Geräten
      if (t.src !== 'manual') { for (const k of IMMUTABLE_IMPORT) delete patch[k]; delete patch.deleted; }
      Object.assign(t, patch);
      // Verweis auf eine gelöschte Unterkategorie (z. B. gleichzeitig auf einem anderen Gerät gelöscht): ohne Unterkategorie (KAT-05)
      if (t.sub && st.categories.get(t.cat ?? '')?.subs.find((s) => s.id === t.sub)?.deleted) t.sub = null;
      break;
    }
    case 'tx.trash': {
      if (Array.isArray(d.ids)) for (const x of d.ids) {
        const t = st.tx.get(x);
        if (t && !t.deleted) { t.deleted = true; t.trashedAt = e.ts; }
      }
      break;
    }
    case 'tx.restore': {
      if (Array.isArray(d.ids)) for (const x of d.ids) {
        const t = st.tx.get(x);
        if (!t || !t.deleted || t.trashedAt === undefined) continue;
        t.deleted = false;
        delete t.trashedAt;
        if (d.reset) Object.assign(t, { status: 'open', cat: null, sub: null, share: null });
      }
      break;
    }
    case 'cat.create':
      if (typeof d.cat?.id === 'string' && !st.categories.has(d.cat.id)) st.categories.set(d.cat.id, normalizeCategory(d.cat));
      break;
    case 'cat.patch': {
      const c = st.categories.get(d.id);
      if (c && d.patch) { const { id: _i, subs: _s, ...p } = d.patch; Object.assign(c, p); }
      break;
    }
    case 'sub.create': {
      const c = st.categories.get(d.cat);
      if (c && typeof d.sub?.id === 'string' && !c.subs.some((s) => s.id === d.sub.id)) c.subs.push({ ...d.sub });
      break;
    }
    case 'sub.patch': {
      const s = st.categories.get(d.cat)?.subs.find((x) => x.id === d.id);
      if (s && d.patch) { const { id: _i, ...p } = d.patch; Object.assign(s, p); }
      // Gelöscht: alle Verweise entfernen, auch solche, die von anderen Geräten nach dem Löschen kamen (KAT-05)
      if (s?.deleted) {
        for (const t of st.tx.values()) if (t.cat === d.cat && t.sub === s.id) t.sub = null;
      }
      break;
    }
    case 'rule.set':
      if (typeof d.key === 'string') { if (d.rule) st.rules.set(d.key, { ...d.rule, sub: d.rule.sub ?? null }); else st.rules.delete(d.key); }
      break;
    case 'rules.clear':
      st.rules.clear();
      break;
    case 'acc.patch': {
      const a = st.accounts.get(d.id);
      if (a && d.patch) { const { id: _i, area: _a, ...p } = d.patch; Object.assign(a, p); }
      break;
    }
    default:
      // Unbekannter Typ (neuere App-Version): überspringen, aber behalten
      break;
  }
}

export function sortEvents(evs: FinEvent[]): FinEvent[] {
  return evs.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Zustand aus allen Ereignissen. Gleiche Ereignisse → gleicher Zustand, auf jedem Gerät. */
export function buildState(events: FinEvent[]): State {
  const st = emptyState();
  for (const e of sortEvents([...events])) applyEvent(st, e);
  return st;
}

// ---------- Speichern ----------

const saving = new Set<Promise<unknown>>();
function track(p: Promise<unknown>) { saving.add(p); p.finally(() => saving.delete(p)); }
/** Wartet, bis alle Änderungen gespeichert sind */
export async function whenSaved(): Promise<void> { while (saving.size) await Promise.all([...saving]); }

/**
 * Wendet Ereignisse an und speichert sie. Jedes wird vorher geprüft (TST-03):
 * Ist eines ungültig, wird KEINES gespeichert und ein Fehler geworfen.
 */
function emitMany(items: { type: EventType; data: unknown }[]): FinEvent[] {
  if (!items.length) return [];
  const evs: FinEvent[] = [];
  // Zuerst auf einer Kopie prüfen, damit ein Fehler in der Mitte nichts halb anwendet
  const probe = cloneState(state);
  for (const it of items) {
    let ts = Date.now();
    if (ts <= lastTs) ts = lastTs + 1; // streng monoton
    lastTs = ts;
    const e: FinEvent = { id: uid(), ts, device: info.device, type: it.type, data: it.data, v: EVENT_FORMAT };
    const err = validateEvent(e, probe);
    if (err) throw new Error(err);
    applyEvent(probe, e);
    evs.push(e);
  }
  for (const e of evs) applyEvent(state, e);
  info.eventCount += evs.length;
  track(db.putEvents(evs).catch((err) => onErr('Speichern fehlgeschlagen: ' + (err?.message ?? err))));
  refresh();
  localListeners.forEach((fn) => fn());
  return evs;
}
const emit = (type: EventType, data: unknown) => emitMany([{ type, data }])[0];

export function cloneState(st: State): State {
  return {
    accounts: new Map([...st.accounts].map(([k, v]) => [k, { ...v }])),
    categories: new Map([...st.categories].map(([k, v]) => [k, { ...v, subs: v.subs.map((s) => ({ ...s })) }])),
    tx: new Map([...st.tx].map(([k, v]) => [k, { ...v }])),
    rules: new Map([...st.rules].map(([k, v]) => [k, { ...v }])),
    imports: new Map([...st.imports].map(([k, v]) => [k, { ...v, ids: [...v.ids] }])),
    importOf: new Map(st.importOf),
  };
}

export async function init() {
  let device = await db.getMeta<string>('device');
  if (!device) { device = uid(); await db.setMeta('device', device); }
  info.device = device;
  const evs = await db.allEvents();
  state = buildState(evs);
  info.eventCount = evs.length;
  lastTs = evs.length ? evs[evs.length - 1].ts : 0;
  info.problems = validateState(state);
  info.persistent = db.persistent;
}

/** Ereignisse anderer Geräte oder aus einem Backup übernehmen (idempotent) */
export async function mergeEvents(incoming: FinEvent[]): Promise<number> {
  const current = await db.allEvents();
  const known = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number' && typeof e.type === 'string' && !known.has(e.id));
  if (!fresh.length) return 0;
  await db.putEvents(fresh);
  const all = sortEvents([...current, ...fresh]);
  state = buildState(all);
  info.eventCount = all.length;
  lastTs = Math.max(lastTs, all[all.length - 1].ts);
  info.problems = validateState(state);
  refresh();
  return fresh.length;
}

// ---------- Buchungen ----------

export interface ImportResult { added: number; duplicates: number; excluded: number; importId?: string }

/**
 * Übernimmt gelesene Buchungen. Bereits bekannte IDs werden übersprungen (IMP-04).
 * Mit `meta` wird der Import protokolliert (IMP-13): Dateiname und Format erscheinen in der Import-Historie.
 */
export function importTx(list: Tx[], meta?: { name: string; format: string }): ImportResult {
  const seen = new Set<string>();
  const fresh = list.filter((t) => { if (state.tx.has(t.id) || seen.has(t.id)) return false; seen.add(t.id); return true; }).map((t) => {
    // Gutschriften eines Absenders, die nie erfasst werden sollen (TEI-10)
    if (t.amount < 0 && t.status === 'open' && state.rules.get(ruleKey(t))?.skip) return { ...t, status: 'excluded' as const, note: 'Automatisch nicht erfasst' };
    // Bargeld-Kategorie entfernt: Bezug bleibt zum Taggen offen
    const c = t.cat ? state.categories.get(t.cat) : undefined;
    if (t.cat === CASH_CAT && (!c || c.deleted)) return { ...t, status: 'open' as const, cat: null, sub: null };
    return t;
  });
  const importId = meta && fresh.length ? uid() : undefined;
  emitMany([
    ...(importId ? [{ type: 'import.log' as const, data: { imp: { id: importId, acc: fresh[0].acc, name: meta!.name, format: meta!.format }, ids: fresh.map((t) => t.id) } }] : []),
    ...fresh.map((tx) => ({ type: 'tx.create' as const, data: { tx } })),
  ]);
  return { added: fresh.length, duplicates: list.length - fresh.length, excluded: fresh.filter((t) => t.status === 'excluded').length, importId };
}

/** Buchungen, die noch zu diesem Import gehören (nicht entfernt) */
export const importTxIds = (st: State, impId: string) => (st.imports.get(impId)?.ids ?? []).filter((x) => st.tx.has(x) && st.importOf.get(x) === impId);

/** Ganzen Import löschen, auch getaggte Buchungen (IMP-14). Gibt die Anzahl entfernter Buchungen zurück. */
export function removeImport(impId: string): number {
  if (!state.imports.has(impId)) throw new Error('Import existiert nicht');
  const ids = importTxIds(state, impId);
  emit('tx.remove', { ids, imp: impId });
  return ids.length;
}

/** Alle offenen (noch nicht getaggten) importierten Buchungen löschen (IMP-15); ausgeschlossene bleiben */
export const openImportedIds = (st: State, accId?: string) =>
  [...st.tx.values()].filter((t) => t.src !== 'manual' && !t.deleted && t.status === 'open' && (!accId || t.acc === accId)).map((t) => t.id);
export function removeOpen(accId?: string): number {
  const ids = openImportedIds(state, accId);
  if (ids.length) emit('tx.remove', { ids });
  return ids.length;
}

export function patchTx(id: string, patch: Partial<Tx>) { emit('tx.patch', { id, patch }); }
export function patchMany(patches: { id: string; patch: Partial<Tx> }[]) {
  emitMany(patches.map((p) => ({ type: 'tx.patch' as const, data: p })));
}

/**
 * Buchungen taggen; mit `rememberKey` wird der Vorschlag für diesen Händler gespeichert (TAG-02).
 * `share` (TEI-02): Anteil in Basispunkten, null = Nur ich, undefined = unverändert.
 * `rememberShare`: gelernter Anteil (nur Vorschläge 50 % / ⅔ oder Nur ich, TEI-06); undefined = bisherigen behalten.
 */
export function tagTx(ids: string[], cat: string, sub: string | null, rememberKey: string | null = null, share?: number | null, rememberShare?: number | null) {
  const patch: Partial<Tx> = { status: 'tagged', cat, sub };
  if (share !== undefined) patch.share = share;
  const prev = rememberKey ? state.rules.get(rememberKey) : undefined;
  const ruleShare = rememberShare !== undefined ? rememberShare : prev?.share ?? null;
  emitMany([
    ...ids.map((id) => ({ type: 'tx.patch' as const, data: { id, patch } })),
    ...(rememberKey ? [{ type: 'rule.set' as const, data: { key: rememberKey, rule: { cat, sub, ...(ruleShare != null ? { share: ruleShare } : {}) } } }] : []),
  ]);
}

/** Gutschrift nicht erfassen (TEI-08); mit `always` auch künftige dieses Absenders (TEI-10) */
export function skipCredit(ids: string[], alwaysKey: string | null = null) {
  emitMany([
    ...ids.map((id) => ({ type: 'tx.patch' as const, data: { id, patch: { status: 'excluded', note: 'Nicht erfasst', cat: null, sub: null } } })),
    ...(alwaysKey ? [{ type: 'rule.set' as const, data: { key: alwaysKey, rule: { cat: '', sub: null, skip: true } } }] : []),
  ]);
}

export function addManual(p: { acc: string; date: string; amount: number; merchant: string; cat: string; sub: string | null; note?: string; share?: number | null }): string {
  const id = 'manual:' + uid();
  const tx = newTx({ id, acc: p.acc, src: 'manual', date: p.date, amount: p.amount, merchant: p.merchant, status: 'tagged', cat: p.cat, sub: p.sub, note: p.note ?? '' });
  if (p.share != null) tx.share = p.share;
  emit('tx.create', { tx });
  return id;
}

/** Manuelle Einträge kommen wie importierte Buchungen in den Papierkorb (TAG-13) */
export function deleteManual(id: string) { trashTx([id]); }

/** Tage, die eine Buchung im Papierkorb bleibt; danach ist sie endgültig gelöscht (TAG-13) */
export const TRASH_DAYS = 30;
export function trashTx(ids: string[]) { emit('tx.trash', { ids }); }
/** Aus dem Papierkorb zurückholen. `reset`: wieder ungetaggt (beim erneuten Import nach Ablauf, TAG-15) */
export function restoreTx(ids: string[], reset = false) { if (ids.length) emit('tx.restore', reset ? { ids, reset } : { ids }); }
/** Einzelne Buchungen wieder ungetaggt machen (TAG-12); die Notiz bleibt */
export function untagTx(ids: string[]) { patchMany(ids.map((id) => ({ id, patch: { status: 'open' as const, cat: null, sub: null, share: null } }))); }

// ---------- Vorschläge ----------

export function setRule(key: string, rule: Rule | null) { emit('rule.set', { key, rule }); }
export function clearRules() { emit('rules.clear', {}); }

// ---------- Kategorien und Konten ----------

export function createCategory(p: Partial<Category> & { name: string }): string {
  const id = 'c-' + uid().slice(0, 8);
  const maxOrder = Math.max(0, ...[...state.categories.values()].map((c) => c.order));
  emit('cat.create', { cat: { scope: 'beide', kind: 'expense', color: PALETTE[state.categories.size % PALETTE.length], ...p, id, order: maxOrder + 10, subs: [] } });
  return id;
}
export function patchCategory(id: string, patch: Partial<Omit<Category, 'id' | 'subs'>>) { emit('cat.patch', { id, patch }); }
export function deleteCategory(id: string) { emit('cat.patch', { id, patch: { deleted: true } }); }

/** Kategorie in der Reihenfolge nach oben/unten schieben */
export function moveCategory(id: string, dir: -1 | 1) {
  const list = [...state.categories.values()].filter((c) => !c.deleted).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  emitMany([
    { type: 'cat.patch', data: { id: list[i].id, patch: { order: list[j].order } } },
    { type: 'cat.patch', data: { id: list[j].id, patch: { order: list[i].order } } },
  ]);
}

/** Neue Unterkategorie. Gibt es den Namen schon (Gross/Klein egal), wird die bestehende verwendet. */
export function addSub(catId: string, name: string): string {
  const c = state.categories.get(catId);
  const clean = name.trim();
  const existing = c?.subs.find((s) => !s.deleted && s.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const sub: Sub = { id: `${catId}-${uid().slice(0, 8)}`, name: clean };
  emit('sub.create', { cat: catId, sub });
  return sub.id;
}
export function renameSub(catId: string, id: string, name: string) { emit('sub.patch', { cat: catId, id, patch: { name } }); }

/** Unterkategorie entfernen: Buchungen bleiben in der Kategorie, ohne Unterkategorie */
export function deleteSub(catId: string, id: string) {
  const affected = [...state.tx.values()].filter((t) => t.sub === id);
  emitMany([
    ...affected.map((t) => ({ type: 'tx.patch' as const, data: { id: t.id, patch: { sub: null } } })),
    { type: 'sub.patch', data: { cat: catId, id, patch: { deleted: true } } },
  ]);
}

export function patchAccount(id: string, patch: { name?: string; manualLabel?: string; cardWords?: string[]; cards?: string[] }) { emit('acc.patch', { id, patch }); }

// ---------- Backup (verschlüsselt) ----------

interface BackupContent { app: 'finanzen'; env: string; created: number; events: FinEvent[] }

export async function exportBackup(pass: string): Promise<string> {
  await whenSaved();
  const content: BackupContent = { app: 'finanzen', env: ENV, created: Date.now(), events: await db.allEvents() };
  return JSON.stringify(await encryptJSON(content, pass));
}

export async function importBackup(text: string, pass: string): Promise<{ added: number }> {
  let file: EncryptedFile;
  try { file = JSON.parse(text); } catch { throw new Error('Das ist keine Backup-Datei.'); }
  const content = await decryptJSON<BackupContent>(file, pass);
  if (content?.app !== 'finanzen' || !Array.isArray(content.events)) throw new Error('Das ist keine Backup-Datei dieser App.');
  if (content.env !== ENV) throw new Error(content.env === 'test' ? 'Das Backup stammt aus der Test-App und kann hier nicht eingespielt werden.' : 'Das Backup stammt aus der Live-App und kann hier nicht eingespielt werden.');
  return { added: await mergeEvents(content.events) };
}

// ---------- Test-App: gezielt löschen ----------

export interface PurgeOptions {
  /** Erfundene Beispieldaten (Buchungen, Tags und Vorschläge aus dem Beispiel-Import) */
  sample: boolean;
  /** Eigene importierte Buchungen */
  imports: boolean;
  /** Eigene manuelle Einträge (Bargeld, Partnerin) */
  manual: boolean;
  /** Gelernte Händler-Vorschläge */
  rules: boolean;
  /** Kategorien und Konten auf den Standard zurücksetzen */
  categories: boolean;
}

/**
 * Nur in der Test-App: löscht die gewählten Daten, indem das Ereignis-Log ohne sie neu geschrieben wird.
 * `sampleEvents` = IDs der Ereignisse aus dem Beispiel-Import. In der Live-App wird nie etwas gelöscht (TST-05).
 */
export async function purgeTestData(o: PurgeOptions, sampleEvents: Set<string>, allowLive = false): Promise<{ removedTx: number }> {
  if (!IS_TEST && !allowLive) throw new Error('Löschen ist nur in der Test-App möglich.');
  await whenSaved();
  const evs = await db.allEvents();
  const drop = new Set<string>();
  for (const e of evs) {
    if (e.type !== 'tx.create' || typeof e.data?.tx?.id !== 'string') continue;
    const t = e.data.tx as Tx;
    const sample = sampleEvents.has(e.id);
    if ((o.sample && sample) || (o.imports && !sample && t.src !== 'manual') || (o.manual && !sample && t.src === 'manual')) drop.add(t.id);
  }
  const keep = evs.filter((e) => {
    if (o.sample && sampleEvents.has(e.id)) return false;
    if ((e.type === 'tx.create' && drop.has(e.data?.tx?.id)) || (e.type === 'tx.patch' && drop.has(e.data?.id))) return false;
    if (e.type === 'import.log' && Array.isArray(e.data?.ids) && e.data.ids.length && e.data.ids.every((x: string) => drop.has(x))) return false;
    if (o.rules && (e.type === 'rule.set' || e.type === 'rules.clear')) return false;
    if (o.categories && /^(cat|sub|acc)\./.test(e.type)) return false;
    return true;
  });
  await db.replaceEvents(keep);
  state = buildState(keep);
  info.eventCount = keep.length;
  // Verweise auf entfernte Kategorien: Buchung wieder offen bzw. ohne Unterkategorie
  const fix = [...state.tx.values()].filter((t) => !t.deleted && t.status === 'tagged').flatMap((t) => {
    const c = t.cat ? state.categories.get(t.cat) : undefined;
    if (!c || c.deleted) return [{ id: t.id, patch: { status: 'open' as const, cat: null, sub: null } }];
    if (t.sub && !c.subs.some((s) => s.id === t.sub && !s.deleted)) return [{ id: t.id, patch: { sub: null } }];
    return [];
  });
  if (fix.length) patchMany(fix);
  info.problems = validateState(state);
  refresh();
  return { removedTx: drop.size };
}

/** Nur für Tests: Zustand zurücksetzen */
export function resetForTests() {
  state = emptyState();
  Object.assign(info, { device: '', eventCount: 0, problems: [] });
  lastTs = 0;
  listeners.clear();
  localListeners.clear();
}
