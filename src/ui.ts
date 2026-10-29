// Oberfläche. Rechnet selbst nichts: alle Zahlen kommen aus logic.ts, alle Änderungen gehen über store.ts.
// Keine Inline-Styles (CSP): Farben/Breiten stehen als data-bg / data-w / data-op und werden in paint() gesetzt.
import * as S from './store';
import * as Sync from './sync';
import { IS_TEST, storageKey } from './env';
import { AREA_LABEL, CASH_CAT, KIND_LABEL, SHARE_PRESETS } from './defaults';
import { fmt, pct } from './money';
import { parseUpload, toCSV } from './parse';
import { formatCardNo, normalizeCardNo } from './parse/cardpdf';
import {
  MONTHS, VIEW_LABEL, aggregate, liveSubId, sliceTx, trashList, deletedInFile, DAY_MS, formatLabel, importHistory, importWarnings, type ImportInfo, type ImportWarning, areaOf, byAccount, cashPool, catLabel, catsFor, isShared, liveSubs, monthly, myPart, openTx, periodLabel, periods,
  reportRows, ruleKey, shareLabel, sortedCategories, srcLabel, subName, summary, txRows, viewTx, type Slice, type View,
} from './logic';
import { sampleFiles } from './seed';
import type { Area, Category, Kind, Rule, Scope, Tx } from './types';

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const $ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const st = () => S.state;

// ---------- Zustand der Oberfläche ----------
type Tab = 'import' | 'tag' | 'overview' | 'list' | 'manual' | 'settings';
let tab: Tab = 'import';
interface Undo { prev: { id: string; patch: Partial<Tx> }[]; rule?: { key: string; prev: Rule | null } }
const tg = {
  cat: null as string | null, skipped: new Set<string>(), history: [] as Undo[], remember: true, applyAll: false,
  /** Karte, für die die folgenden Werte gelten */
  forId: '', share: null as number | null, shareTouched: false, indOpen: false, noteOpen: false, newSubOpen: false, skipAlways: false,
};
const ov = { view: 'privat' as View, mode: 'month' as 'month' | 'year', period: '', drill: null as string | null };
const lf = { acc: '', period: '', status: '', q: '' };
/** Liste gefiltert auf ein Stück im Diagramm (AUS-07); sub '' = ohne Unterkategorie, undefined = ganze Kategorie */
let lfSlice: { view: View; period: string; cat: string; sub?: string } | null = null;
let impAcc = 'privat';
/** Import-Historie im Import-Tab aufgeklappt (IMP-13) */
let impHist = false;
let manAcc = 'privat';

// ---------- Hilfen ----------
let toastT = 0;
export function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => { t.hidden = true; }, 3800);
}
function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
/** Farben, Breiten und Deckkraft aus data-Attributen setzen (statt Inline-Styles) */
function paint(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-bg]').forEach((el) => { el.style.background = el.dataset.bg!; });
  root.querySelectorAll<HTMLElement>('[data-w]').forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, +el.dataset.w!))}%`; });
  root.querySelectorAll<HTMLElement>('[data-op]').forEach((el) => { el.style.opacity = el.dataset.op!; });
}
/** Aktion ausführen; abgelehnte Änderungen (Validierung) als Meldung zeigen */
function safe(fn: () => void): boolean {
  try { fn(); return true; } catch (err) { toast((err as Error).message || String(err)); return false; }
}
const areaChip = (a: Area | Scope) => `<span class="area ${a}">${AREA_LABEL[a]}</span>`;
const acc = (id: string) => st().accounts.get(id)!;
const cat = (id: string | null) => (id ? st().categories.get(id) : undefined);
const money = (r: number) => (r < 0 ? '+' + fmt(-r) : fmt(r));

// ---------- Darstellung hell/dunkel ----------
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = storageKey('fin-theme');
export function getTheme(): Theme {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = dark ? '#002b36' : '#fdf6e3'; m.removeAttribute('media'); });
}
function setTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* nur diese Sitzung */ }
  applyTheme(t);
  render();
}

// ---------- Rahmen ----------
export function mount() {
  if (IS_TEST) {
    const strip = document.createElement('div');
    strip.className = 'env-strip';
    strip.textContent = 'TEST-UMGEBUNG · Beispieldaten · kein Sync';
    document.body.prepend(strip);
    $('.brand').innerHTML = 'Finanzen<span class="tag">TEST</span>';
  }
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('change', onChangeEvt);
  S.onChange(() => render());
  S.onError((m) => toast(m));
  show(S.state.tx.size ? (openTx(st()).length ? 'tag' : 'overview') : 'import');
}

function show(t: Tab) {
  tab = t;
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll<HTMLElement>('main section').forEach((s) => { s.hidden = s.id !== 'view-' + t; });
  render();
}

export function render() {
  const n = openTx(st()).length;
  $('#openBadge').innerHTML = n ? `<span class="badge">${n}</span>` : '';
  renderStatus();
  const el = $(`#view-${tab}`);
  ({ import: renderImport, tag: renderTag, overview: renderOverview, list: renderList, manual: renderManual, settings: renderSettings })[tab](el);
  paint(el);
}

function renderStatus() {
  const el = $('#status');
  el.classList.remove('err');
  if (IS_TEST) { el.textContent = 'Lokal · kein Sync'; return; }
  const s = Sync.status;
  if (s.state === 'off') el.textContent = S.info.persistent ? 'Nur auf diesem Gerät' : '⚠ Nicht gespeichert';
  else if (s.state === 'syncing') el.textContent = 'Synchronisiert …';
  else if (s.state === 'idle') el.textContent = s.last ? `Synchronisiert ${new Date(s.last).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : 'Sync bereit';
  else if (s.state === 'locked') { el.textContent = 'Sync gesperrt – Passphrase nötig'; el.classList.add('err'); }
  else if (s.state === 'offline') el.textContent = 'Offline – wird nachgeholt';
  else { el.textContent = 'Sync-Fehler'; el.classList.add('err'); el.title = s.error; }
}

// ---------- Import ----------
function renderImport(el: HTMLElement) {
  const count = (id: string) => [...st().tx.values()].filter((t) => t.acc === id && !t.deleted).length;
  el.innerHTML = `
  <div class="card">
    <h2>Dateien importieren</h2>
    <p class="muted small">Die Dateien werden nur hier im Browser gelesen und nirgends hochgeladen.</p>
    <label class="field"><span>Konto für diesen Import</span>
      <div class="seg full">${[...st().accounts.values()].map((a) => `<button type="button" data-act="impAcc" data-id="${a.id}" class="${impAcc === a.id ? 'on' : ''}">${esc(a.name)}</button>`).join('')}</div></label>
    <label class="drop" id="drop">
      <input type="file" id="fileIn" multiple accept=".csv,.xml,.txt,.pdf" hidden>
      <strong>Datei wählen oder hierher ziehen</strong><br>
      <span class="muted small">Import ins Konto <strong>${esc(acc(impAcc).name)}</strong> · Kreditkarten-CSV und -PDF · Bank-CSV (auch mit Sammelbuchungen) · camt.053</span>
    </label>
    <div class="row"><button type="button" class="ghost small" data-act="impHist" id="impHistBtn" aria-expanded="${impHist}">${impHist ? 'Import-Historie ausblenden' : 'Import-Historie anzeigen'}</button></div>
    <p class="muted small" id="impHint">Bereits importierte Buchungen werden erkannt und nicht doppelt übernommen. Zahlungen an die Kreditkarte und Überträge von eigenen Konten werden automatisch ausgeschlossen. Bargeldbezüge zählen als «Bargeld › Nicht zugeordnet». Bei einer Kreditkarten-Abrechnung als PDF prüft die App die Summe; stimmt etwas nicht, fragt sie vor dem Import nach.</p>
  </div>
  <div class="card">
    <h2>Konten</h2>
    <table><thead><tr><th>Konto</th><th>Bereich</th><th class="num">Buchungen</th></tr></thead><tbody>
    ${[...st().accounts.values()].map((a) => `<tr><td>${esc(a.name)}<div class="muted small">manuell: ${esc(a.manualLabel)}${a.cards?.length ? ` · Karte ${a.cards.map(formatCardNo).map(esc).join(', ')}` : ''}</div></td><td>${areaChip(a.area)}</td><td class="num">${count(a.id)}</td></tr>`).join('')}
    </tbody></table>
  </div>
  ${impHist ? `<div class="card" id="impHistory"><h2>Letzte Importe</h2>${importList(5)}
    <p class="muted small">Ältere Importe und «Alle ungetaggten Einträge löschen» unter Einstellungen → Daten löschen.</p></div>` : ''}`;
  const drop = $('#drop', el);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); void importFiles((e as DragEvent).dataTransfer?.files ?? null); });
  $<HTMLInputElement>('#fileIn', el).addEventListener('change', (e) => void importFiles((e.target as HTMLInputElement).files));
}

async function importFiles(files: FileList | null) {
  if (!files?.length) return;
  let added = 0, dup = 0, excl = 0;
  const errors: string[] = [], skipped: string[] = [];
  for (const f of files) {
    try {
      const r = await parseUpload(new Uint8Array(await f.arrayBuffer()), impAcc, acc(impAcc).cardWords ?? []);
      // Summe, Überschneidung, Kartennummer: bei Warnungen zuerst nachfragen (IMP-10 bis IMP-12)
      const warnings = importWarnings(st(), impAcc, r);
      if (warnings.length && !(await askImport(f.name, warnings))) { skipped.push(f.name); continue; }
      // TAG-15: früher einzeln gelöschte Buchungen nicht still übernehmen
      const gone = deletedInFile(st(), r.tx);
      let back = false;
      if (gone.length) {
        const old = gone.filter((t) => Date.now() - t.trashedAt! >= S.TRASH_DAYS * DAY_MS).length;
        back = await confirmDanger(`${gone.length === 1 ? '1 Buchung' : `${gone.length} Buchungen`} hattest du gelöscht`,
          `<p class="muted small">${esc(f.name)}</p><ul class="small">${gone.slice(0, 5).map((t) => `<li>${fmtDate(t.date)} · ${esc(t.merchant)} · ${money(t.amount)}</li>`).join('')}${gone.length > 5 ? `<li>… und ${gone.length - 5} weitere</li>` : ''}</ul>
          <p class="small">Sie kommen in dieser Datei wieder vor. Weglassen = sie bleiben gelöscht, der Rest wird importiert.${old ? ' Endgültig gelöschte kommen ungetaggt zurück.' : ''}</p>`,
          'Wieder aufnehmen', 'Weglassen', 'primary');
      }
      const res = S.importTx(r.tx, { name: f.name, format: r.format });
      if (back) {
        const cut = Date.now() - S.TRASH_DAYS * DAY_MS;
        S.restoreTx(gone.filter((t) => t.trashedAt! > cut).map((t) => t.id));
        S.restoreTx(gone.filter((t) => t.trashedAt! <= cut).map((t) => t.id), true);
        added += gone.length;
      }
      added += res.added; dup += res.duplicates - (back ? gone.length : 0); excl += res.excluded;
    } catch (err) { errors.push(`${f.name}: ${(err as Error).message}`); }
  }
  const msg = `${added} neu ins Konto ${acc(impAcc).name}${excl ? `, davon ${excl} ausgeschlossen` : ''}${dup ? ` · ${dup} Duplikate übersprungen` : ''}`;
  const parts = [...errors, ...skipped.map((n) => `${n}: nicht importiert`)];
  toast(parts.length ? `${parts.join(' · ')}${added ? ' · ' + msg : ''}` : msg);
  if (added - excl > 0) show('tag'); else render();
}

/** Rückfrage vor dem Import. true = trotzdem importieren. Abbrechen/Escape = nicht importieren. */
let impAnswer: ((ok: boolean) => void) | null = null;
async function askImport(name: string, warnings: ImportWarning[]): Promise<boolean> {
  const d = $<HTMLDialogElement>('#dlg');
  await closeDialog(d);
  const title: Record<ImportWarning['kind'], string> = { sum: 'Summe stimmt nicht', overlap: 'Schon importiert?', card: 'Falsches Konto?' };
  d.innerHTML = `<form method="dialog" id="impAsk">
    <h2>Bitte prüfen</h2>
    <p class="muted small">${esc(name)} · Import ins Konto <strong>${esc(acc(impAcc).name)}</strong></p>
    ${warnings.map((w) => `<div class="impwarn" data-kind="${w.kind}"><strong>${title[w.kind]}</strong><br><span class="small">${esc(w.text)}</span></div>`).join('')}
    <div class="row"><span class="spacer"></span><button type="button" data-act="impNo" id="impNo">Nicht importieren</button><button type="button" class="primary" data-act="impYes" id="impYes">Trotzdem importieren</button></div></form>`;
  return new Promise((resolve) => {
    impAnswer = resolve;
    d.addEventListener('close', () => { if (impAnswer === resolve) { impAnswer = null; resolve(false); } }, { once: true });
    d.showModal();
    $<HTMLButtonElement>('#impNo').focus();
  });
}
/** Liste der Importe mit Konto, Bereich, Zeitraum, Zählern und Löschen-Knopf (IMP-13, IMP-14) */
function importList(limit = Infinity): string {
  const list = importHistory(st(), limit);
  if (!list.length) return '<p class="muted small">Noch keine Importe.</p>';
  return `<ul class="implist">${list.map((h) => `<li data-imp="${esc(h.id)}">
    <div class="imphead"><strong>${esc(h.name || (h.auto ? 'Früherer Import' : 'Import'))}</strong><span class="muted small">${esc(importWhen(h))} · ${esc(formatLabel(h.format))}</span></div>
    <div class="small">Konto ${esc(h.accName)} ${areaChip(h.area)} · ${fmtDate(h.from)}${h.to !== h.from ? ` – ${fmtDate(h.to)}` : ''}</div>
    <div class="row nowrap"><span class="small impcount">${h.total} Buchungen: ${h.tagged} getaggt · ${h.open} ungetaggt${h.excluded ? ` · ${h.excluded} ausgeschlossen` : ''}</span><span class="spacer"></span>
    <button type="button" class="ghost small danger" data-act="impDel" data-id="${esc(h.id)}">Löschen</button></div></li>`).join('')}</ul>`;
}
const importWhen = (h: ImportInfo) => { const d = new Date(h.ts); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Rückfrage für endgültiges Löschen. true = löschen. */
const closeDialog = (d: HTMLDialogElement) => new Promise<void>((res) => { if (!d.open) return res(); d.addEventListener('close', () => res(), { once: true }); d.close(); });
async function confirmDanger(title: string, body: string, ok: string, cancel = 'Abbrechen', okClass = 'danger'): Promise<boolean> {
  const d = $<HTMLDialogElement>('#dlg');
  // Offenen Dialog zuerst schliessen und warten: sonst beendet sein «close»-Ereignis gleich die neue Rückfrage
  await closeDialog(d);
  d.innerHTML = `<form method="dialog" id="dangerAsk"><h2>${esc(title)}</h2>${body}
    <div class="row"><span class="spacer"></span><button type="button" data-act="impNo" id="dangerNo">${esc(cancel)}</button><button type="button" class="${okClass}" data-act="impYes" id="dangerYes">${esc(ok)}</button></div></form>`;
  return new Promise((resolve) => {
    impAnswer = resolve;
    d.addEventListener('close', () => { if (impAnswer === resolve) { impAnswer = null; resolve(false); } }, { once: true });
    d.showModal();
    $<HTMLButtonElement>('#dangerNo').focus();
  });
}

async function deleteImport(id: string) {
  const h = importHistory(st()).find((x) => x.id === id);
  if (!h) return;
  const body = `<p><strong>${esc(h.name || 'Früherer Import')}</strong><br><span class="muted small">Konto ${esc(h.accName)} · ${fmtDate(h.from)}${h.to !== h.from ? ` – ${fmtDate(h.to)}` : ''}</span></p>
    <p>${h.total} Buchungen werden gelöscht.</p>
    ${h.tagged ? `<div class="impwarn" data-kind="sum"><strong>${h.tagged} davon sind schon getaggt.</strong><br><span class="small">Ihre Kategorien, Anteile und Notizen gehen verloren.</span></div>` : ''}
    <p class="muted small">Importierst du dieselbe Datei später wieder, kommen die Buchungen ungetaggt zurück.</p>`;
  if (!(await confirmDanger('Import löschen?', body, 'Löschen'))) return;
  if (safe(() => S.removeImport(id))) { tg.history = []; toast(`Import gelöscht: ${h.total} Buchungen entfernt`); render(); }
}

/** Einzelne Buchung wieder ungetaggt (TAG-12) oder in den Papierkorb (TAG-13), jeweils mit Rückfrage */
async function untagOne(id: string) {
  const t = st().tx.get(id);
  if (!t) return;
  const body = `<p><strong>${esc(t.merchant)}</strong><br><span class="muted small">${fmtDate(t.date)} · ${money(t.amount)} · ${esc(catLabel(st(), t))}</span></p>
    <p class="small">Kategorie${t.share != null ? ', Anteil' : ''} und Unterkategorie fallen weg; die Buchung erscheint wieder unter «Taggen». Die Notiz bleibt.</p>`;
  if (!(await confirmDanger('Wieder ungetaggt?', body, 'Untaggen', 'Abbrechen', 'primary'))) return;
  if (safe(() => S.untagTx([id]))) { tg.history = []; toast('Buchung ist wieder ungetaggt'); render(); }
}
async function trashOne(id: string) {
  const t = st().tx.get(id);
  if (!t) return;
  const body = `<p><strong>${esc(t.merchant)}</strong><br><span class="muted small">${fmtDate(t.date)} · ${money(t.amount)} · Konto ${esc(acc(t.acc).name)}</span></p>
    <p class="small">Die Buchung zählt nirgends mehr. Unter Einstellungen → Papierkorb kannst du sie ${S.TRASH_DAYS} Tage lang zurückholen, danach ist sie endgültig gelöscht.</p>`;
  if (!(await confirmDanger('In den Papierkorb?', body, 'Löschen'))) return;
  if (safe(() => S.trashTx([id]))) { tg.history = []; toast('In den Papierkorb verschoben'); render(); }
}

/** Wischen nach links auf dem Handy zeigt «Untaggen» und «Löschen» (TAG-14) */
function swipeRows(list: HTMLElement | null) {
  if (!list) return;
  let row: HTMLElement | null = null, x0 = 0, y0 = 0, done = false;
  list.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    row = (e.target as HTMLElement).closest<HTMLElement>('.swipe');
    x0 = t.clientX; y0 = t.clientY; done = false;
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!row || done) return;
    const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    done = true;
    list.querySelectorAll('.swipe.open').forEach((r) => { if (r !== row) r.classList.remove('open'); });
    row.classList.toggle('open', dx < 0);
  }, { passive: true });
}

async function deleteOpen() {
  const per = [...st().accounts.values()].map((a) => ({ a, n: S.openImportedIds(st(), a.id).length })).filter((x) => x.n);
  const total = per.reduce((x, p) => x + p.n, 0);
  if (!total) { toast('Keine ungetaggten Einträge.'); return; }
  const body = `<p>${total} ungetaggte Buchungen werden gelöscht:</p><ul class="small">${per.map((p) => `<li>Konto ${esc(p.a.name)}: ${p.n}</li>`).join('')}</ul>
    <p class="muted small">Getaggte, ausgeschlossene (z. B. Kartenzahlungen) und manuelle Einträge bleiben. Ein erneuter Import bringt die Buchungen wieder.</p>`;
  if (!(await confirmDanger('Alle ungetaggten Einträge löschen?', body, 'Löschen'))) return;
  if (safe(() => S.removeOpen())) { tg.history = []; toast(`${total} ungetaggte Buchungen gelöscht`); render(); }
}

function answerImport(ok: boolean) {
  const r = impAnswer;
  impAnswer = null;
  $<HTMLDialogElement>('#dlg').close();
  r?.(ok);
}

// ---------- Taggen ----------
const currentTx = () => openTx(st()).find((t) => !tg.skipped.has(t.id));
/** Für diese Buchung ist «Nur ich / Geteilt» möglich: Ausgabe auf einem Konto im Bereich Persönlich (TEI-01) */
const canShare = (t: Tx) => t.amount > 0 && areaOf(st(), t.acc) === 'privat';

/** Beim Wechsel zur nächsten Buchung: Anteil aus dem gelernten Vorschlag vorbelegen (TEI-06) */
function prepareCard(t: Tx) {
  if (tg.forId === t.id) return;
  const rule = st().rules.get(ruleKey(t));
  Object.assign(tg, { forId: t.id, cat: null, share: canShare(t) ? rule?.share ?? null : null, shareTouched: false, indOpen: false, noteOpen: false, newSubOpen: false, skipAlways: false });
}

function shareRow(t: Tx): string {
  if (!canShare(t)) return '';
  const s = tg.share;
  const preset = s === 5000 || s === 6667;
  const ind = s != null && !preset;
  const on = (x: boolean) => (x ? 'on' : '');
  return `<div class="sharebox" id="shareBox">
    <div class="seg full share" role="group" aria-label="Aufteilung">
      <button type="button" data-act="share" data-v="me" class="${on(s == null)}">Nur ich</button>
      <button type="button" data-act="share" data-v="5000" class="${on(s === 5000 && !tg.indOpen)}">50 %</button>
      <button type="button" data-act="share" data-v="6667" class="${on(s === 6667 && !tg.indOpen)}">⅔ ich</button>
      <button type="button" data-act="shareInd" class="ind ${on(ind || tg.indOpen)}">${ind ? shareLabel(s) : 'Individuell'}</button></div>
    ${ind || tg.indOpen ? `<label class="indrow">Mein Anteil <input id="shareInd" type="number" inputmode="decimal" min="1" max="99" step="0.5" value="${ind ? s! / 100 : ''}" placeholder="%"> %${s != null ? `<span class="sharehint">· Persönlich CHF ${fmt(myPart({ amount: t.amount, share: s }))}</span>` : ''}</label>`
      : s != null ? `<p class="sharehint">Geteilt: Persönlich zählt CHF ${fmt(myPart({ amount: t.amount, share: s }))}, Gemeinsam CHF ${fmt(t.amount)}.</p>` : ''}
  </div>`;
}

function renderTag(el: HTMLElement) {
  const all = openTx(st());
  const queue = all.filter((t) => !tg.skipped.has(t.id));
  const done = [...st().tx.values()].filter((t) => t.status === 'tagged' && !t.deleted).length;
  if (!queue.length) {
    el.innerHTML = `<div class="card empty">
      <h2>${all.length ? 'Nur noch übersprungene übrig' : 'Alles getaggt'}</h2>
      ${all.length ? `<p>${all.length} Buchung(en) übersprungen.</p><button type="button" class="primary" data-act="unskip">Nochmals anzeigen</button>`
        : '<p>Importiere neue Dateien oder schau dir die Übersicht an.</p><div class="row center"><button type="button" data-act="tab" data-tab="import">Import</button><button type="button" class="primary" data-act="tab" data-tab="overview">Übersicht</button></div>'}
      ${tg.history.length ? '<p><button type="button" class="ghost" data-act="undo">↶ Letzte Aktion rückgängig</button></p>' : ''}
    </div>`;
    return;
  }
  const t = queue[0];
  prepareCard(t);
  const a = acc(t.acc);
  const shared = canShare(t) && tg.share != null;
  const cats = catsFor(st(), t.acc, shared);
  const rule = st().rules.get(ruleKey(t));
  const ruleCat = rule && !rule.skip ? cats.find((c) => c.id === rule.cat) : undefined;
  const others = all.filter((o) => o.id !== t.id && ruleKey(o) === ruleKey(t)).length;
  const total = done + all.length;
  const credit = t.amount < 0;
  if (tg.cat && !cats.some((c) => c.id === tg.cat)) tg.cat = null;
  let step: string;
  if (!tg.cat) {
    step = `${ruleCat ? `<button type="button" class="primary suggest" data-act="accept">Vorschlag: ${esc(ruleCat.name)}${liveSubId(ruleCat, rule!.sub) ? ' › ' + esc(subName(ruleCat, rule!.sub)) : ''}${canShare(t) && rule!.share ? ` · ${shareLabel(rule!.share)}` : ''} <span class="k">↵</span></button>` : ''}
      <div class="catgrid" id="catgrid">${cats.map((c, i) => `<button type="button" class="catbtn${rule?.cat === c.id ? ' sug' : ''}" data-act="pickCat" data-id="${c.id}"><span class="dot" data-bg="${c.color}"></span><span class="cn">${esc(c.name)}${c.kind !== 'expense' ? `<span class="kind">${KIND_LABEL[c.kind]}</span>` : ''}</span>${i < 10 ? `<span class="k">${(i + 1) % 10}</span>` : ''}</button>`).join('')}</div>`;
  } else {
    const c = cat(tg.cat)!;
    step = `<div class="row nowrap stephead"><button type="button" class="ghost" data-act="backCat">← Zurück</button><span class="dot" data-bg="${c.color}"></span><strong>${esc(c.name)}</strong></div>
      <div class="catgrid" id="catgrid">${liveSubs(c).map((s, i) => `<button type="button" class="catbtn${rule?.sub === s.id ? ' sug' : ''}" data-act="pickSub" data-id="${s.id}"><span class="cn">${esc(s.name)}</span>${i < 9 ? `<span class="k">${i + 1}</span>` : ''}</button>`).join('')}
      <button type="button" class="catbtn" data-act="pickSub" data-id=""><span class="cn muted">Ohne Unterkategorie</span><span class="k">0</span></button>
      ${tg.newSubOpen ? `<span class="newsub"><input id="newSubIn" placeholder="Neue Unterkategorie" maxlength="40" aria-label="Neue Unterkategorie"><button type="button" class="primary" data-act="newSubSave">OK</button></span>`
        : '<button type="button" class="catbtn add" data-act="newSub"><span class="cn">+ Neue Unterkategorie</span><span class="k">+</span></button>'}</div>`;
  }
  const fx = t.origCur && t.origCur !== t.cur;
  const chips = [t.details && t.details !== t.merchant ? esc(t.details) : '', fx ? `Fremdwährung ${esc(t.origCur)}` : ''].filter(Boolean);
  el.innerHTML = `
    <div class="row small muted tagstat"><span>${done} von ${total} getaggt</span><span class="spacer"></span><span>${queue.length} offen</span></div>
    <div class="progress"><div data-w="${total ? Math.round((done / total) * 100) : 0}"></div></div>
    <div class="card txcard" id="txcard" data-id="${esc(t.id)}">
      <div class="txhead">${areaChip(a.area)} <span class="chip">${esc(a.name)} · ${esc(srcLabel(st(), t))}</span>${credit ? '<span class="chip warn">Gutschrift</span>' : ''}</div>
      <div class="amt${credit ? ' credit' : ''}">${credit ? '+ ' : ''}${esc(t.cur)} ${fmt(Math.abs(t.amount))}</div>
      <div class="mer">${esc(t.merchant)}</div>
      <div class="meta">${fmtDate(t.date)}${t.place ? ' · ' + esc(t.place) : ''}${chips.length ? ' · ' + chips.join(' · ') : ''}</div>
      <div class="noterow">${tg.noteOpen ? `<input id="noteIn" class="notein" value="${esc(t.note)}" placeholder="Notiz, z. B. Geschenk für Lea" maxlength="200" aria-label="Notiz">`
        : `<button type="button" class="notebtn" data-act="noteOpen" id="noteBtn">${t.note ? '✎ ' + esc(t.note) : '+ Notiz'}</button>`}</div>
    </div>
    <div class="card tagbox">
      ${credit ? `<div class="creditbox"><button type="button" class="primary wide" data-act="skipCredit" id="skipCredit">Nicht erfassen</button>
        <label class="opt"><input type="checkbox" data-opt="skipAlways" ${tg.skipAlways ? 'checked' : ''}> Immer für diesen Absender</label>
        <p class="muted small">Oder einer Kategorie zuordnen, z. B. als Rückerstattung:</p></div>` : ''}
      ${shareRow(t)}
      ${step}
      <div class="opts">
        <label class="opt"><input type="checkbox" data-opt="remember" ${tg.remember ? 'checked' : ''}> Händler merken</label>
        ${others ? `<label class="opt"><input type="checkbox" data-opt="applyAll" ${tg.applyAll ? 'checked' : ''}> Auch auf ${others} weitere anwenden</label>` : ''}
      </div>
    </div>
    <div class="actions">
      <button type="button" data-act="undo" ${tg.history.length ? '' : 'disabled'}>↶ Zurück</button>
      <button type="button" data-act="skip">Überspringen</button>
      <button type="button" class="danger" data-act="exclude">Ignorieren</button>
    </div>
    <div class="keys"><kbd>1</kbd>–<kbd>0</kbd> Kategorie · <kbd>↵</kbd> Vorschlag · <kbd>T</kbd> geteilt · <kbd>N</kbd> Notiz · <kbd>+</kbd> neue Unterkategorie · <kbd>Esc</kbd> zurück · <kbd>S</kbd> überspringen · <kbd>X</kbd> ignorieren · <kbd>Z</kbd> rückgängig</div>`;
  const ni = el.querySelector<HTMLInputElement>('#noteIn');
  if (ni) {
    ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length);
    ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(); } else if (e.key === 'Escape') { tg.noteOpen = false; render(); } });
  }
  const si = el.querySelector<HTMLInputElement>('#newSubIn');
  if (si) {
    si.focus();
    si.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNewSub(); } else if (e.key === 'Escape') { tg.newSubOpen = false; render(); } });
  }
  const ii = el.querySelector<HTMLInputElement>('#shareInd');
  if (ii && tg.indOpen && !ii.value) ii.focus();
}

/** Anteil, der beim Taggen gespeichert wird; Kategorie-Standard, wenn nichts gewählt (TEI-07) */
function shareFor(t: Tx, catId: string): number | null | undefined {
  if (!canShare(t)) return undefined;
  if (!tg.shareTouched && tg.share == null) { const d = cat(catId)?.defaultShare; if (d) return d; }
  return tg.share;
}

function applyTag(catId: string, subId: string | null) {
  const t = currentTx();
  if (!t) return;
  const key = ruleKey(t);
  const targets = [t, ...(tg.applyAll ? openTx(st()).filter((o) => o.id !== t.id && ruleKey(o) === key) : [])];
  const share = shareFor(t, catId);
  const learn = share === undefined ? undefined : share == null || SHARE_PRESETS.includes(share) ? share : undefined;
  const undo: Undo = { prev: targets.map((x) => ({ id: x.id, patch: { status: x.status, cat: x.cat, sub: x.sub, note: x.note, share: x.share ?? null } })) };
  if (tg.remember) undo.rule = { key, prev: st().rules.get(key) ?? null };
  if (!safe(() => S.tagTx(targets.map((x) => x.id), catId, subId || null, tg.remember ? key : null, share, learn))) return;
  tg.history.push(undo);
  tg.cat = null; tg.applyAll = false;
}
function excludeCurrent() {
  const t = currentTx();
  if (!t) return;
  const undo: Undo = { prev: [{ id: t.id, patch: { status: t.status, cat: t.cat, sub: t.sub, note: t.note } }] };
  if (safe(() => S.patchTx(t.id, { status: 'excluded', note: 'Manuell ignoriert' }))) { tg.history.push(undo); tg.cat = null; }
}
function skipCredit() {
  const t = currentTx();
  if (!t || t.amount >= 0) return;
  const key = ruleKey(t);
  const undo: Undo = { prev: [{ id: t.id, patch: { status: t.status, cat: t.cat, sub: t.sub, note: t.note } }] };
  if (tg.skipAlways) undo.rule = { key, prev: st().rules.get(key) ?? null };
  if (safe(() => S.skipCredit([t.id], tg.skipAlways ? key : null))) { tg.history.push(undo); tg.cat = null; }
}
function saveNote() {
  const t = currentTx();
  const ni = document.querySelector<HTMLInputElement>('#noteIn');
  if (!t || !ni) return;
  const v = ni.value.trim();
  tg.noteOpen = false;
  if (v !== t.note) safe(() => S.patchTx(t.id, { note: v })); else render();
}
function saveNewSub() {
  const si = document.querySelector<HTMLInputElement>('#newSubIn');
  const name = si?.value.trim();
  if (!tg.cat || !name) { tg.newSubOpen = false; render(); return; }
  const catId = tg.cat;
  let id = '';
  if (!safe(() => { id = S.addSub(catId, name); })) return;
  tg.newSubOpen = false;
  applyTag(catId, id);
  render();
}
function setShare(v: string) {
  const t = currentTx();
  if (!t) return;
  tg.shareTouched = true;
  tg.indOpen = false;
  tg.share = v === 'me' ? null : +v;
}
function undo() {
  const h = tg.history.pop();
  if (!h) return;
  safe(() => {
    S.patchMany(h.prev);
    if (h.rule) S.setRule(h.rule.key, h.rule.prev);
  });
  h.prev.forEach((p) => tg.skipped.delete(p.id));
  tg.cat = null; tg.forId = '';
  render();
}

// ---------- Diagramme (SVG) ----------
function donutSVG(items: Slice[], top: string, bottom: string, act = ''): string {
  const pos = items.filter((i) => i.value > 0);
  const total = pos.reduce((a, i) => a + i.value, 0);
  const R = 90, r = 58, cx = 100, cy = 100, mid = (R + r) / 2;
  let svg = '';
  if (total <= 0) svg = `<circle class="ring" cx="${cx}" cy="${cy}" r="${mid}" stroke-width="${R - r}"/>`;
  else if (pos.length === 1) svg = `<circle cx="${cx}" cy="${cy}" r="${mid}" fill="none" stroke="${pos[0].color}" stroke-opacity="${pos[0].shade}" stroke-width="${R - r}"><title>${esc(pos[0].label)}</title></circle>`;
  else {
    let a = -Math.PI / 2;
    const P = (rad: number, ang: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    for (const it of pos) {
      const f = it.value / total, a2 = a + f * 2 * Math.PI, L = f > 0.5 ? 1 : 0;
      svg += `<path class="seg-gap${act ? ' click' : ''}" ${act ? `data-act="${act}" data-id="${esc(it.id)}"` : ''} d="M${P(R, a)} A${R} ${R} 0 ${L} 1 ${P(R, a2)} L${P(r, a2)} A${r} ${r} 0 ${L} 0 ${P(r, a)} Z" fill="${it.color}" fill-opacity="${it.shade}" stroke-width="2"><title>${esc(it.label)}: ${fmt(it.value)} (${pct(it.value, total)} %)</title></path>`;
      a = a2;
    }
  }
  return `<svg class="donut" viewBox="0 0 200 200" width="100%" role="img" aria-label="${esc(top)} ${esc(bottom)}">${svg}
    <text x="100" y="96" text-anchor="middle" font-size="12">${esc(top)}</text>
    <text class="strong" x="100" y="116" text-anchor="middle" font-size="17" font-weight="700">${esc(bottom)}</text></svg>`;
}
function barsSVG(series: { cls: string; label: string; values: number[] }[], labels: string[]): string {
  const W = 360, H = 160, pad = 18, n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const max = Math.max(...totals, 1), bw = (W - pad * 2) / n;
  let s = '';
  labels.forEach((lab, i) => {
    let y = H - 20;
    const x = pad + i * bw + bw * 0.15;
    for (const se of series) {
      const v = Math.max(0, se.values[i]);
      if (!v) continue;
      const h = (v / max) * (H - 44);
      y -= h;
      s += `<rect class="${se.cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}"><title>${lab} · ${esc(se.label)}: CHF ${fmt(v)}</title></rect>`;
    }
    s += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10">${lab}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - 20}" y2="${H - 20}"/>${s}</svg>`;
}

// ---------- Übersicht ----------
function renderOverview(el: HTMLElement) {
  const ps = periods(st(), ov.view, ov.mode);
  const head = `<div class="seg full" id="ovViews">${(['privat', 'gemeinsam', 'alle'] as View[]).map((v) => `<button type="button" data-act="ovView" data-view="${v}" class="${ov.view === v ? 'on' : ''}">${VIEW_LABEL[v]}</button>`).join('')}</div>`;
  if (!ps.length) {
    el.innerHTML = `<div class="card">${head}<div class="empty"><h2>Noch keine Daten</h2><p>Für diese Sicht gibt es noch keine Buchungen.</p><button type="button" class="primary" data-act="tab" data-tab="import">Zum Import</button></div></div>`;
    return;
  }
  if (!ps.includes(ov.period)) ov.period = ps[0];
  if (ov.drill && !cat(ov.drill)) ov.drill = null;
  const txs = viewTx(st(), ov.view, ov.period);
  const s = summary(st(), ov.view, ov.period);
  const items = aggregate(st(), txs, ov.view, ov.drill);
  const base = items.reduce((a, i) => a + i.value, 0);
  const dc = cat(ov.drill);
  let tiles = `<div class="tile"><div class="v" id="ovExpense">${fmt(s.expense)}</div><div class="l">Ausgaben CHF</div></div>
    <div class="tile"><div class="v">${s.count}</div><div class="l">Buchungen</div></div>`;
  if (s.income) tiles += `<div class="tile"><div class="v">${fmt(s.income)}</div><div class="l">${ov.view === 'gemeinsam' ? 'Einzahlungen' : 'Einnahmen'} CHF</div></div>`;
  if (s.saving) tiles += `<div class="tile"><div class="v">${fmt(s.saving)}</div><div class="l">Sparen & Vorsorge CHF</div></div>`;
  if (s.saldo !== null) tiles += `<div class="tile"><div class="v ${s.saldo < 0 ? 'neg' : 'pos'}">${fmt(s.saldo)}</div><div class="l">Saldo CHF</div></div>`;
  let accSplit = '';
  if (dc) {
    const accs = byAccount(st(), txs, ov.view, dc.id);
    if (accs.length) {
      const tot = accs.reduce((a, x) => a + x.value, 0);
      accSplit = `<h3>Nach Konto</h3><table id="byAccount"><tbody>${accs.map((x) => `<tr><td><div class="row nowrap">${areaChip(x.area)} ${esc(x.label)}</div></td><td class="num">${fmt(x.value)}</td><td class="num">${pct(x.value, tot)}</td></tr>`).join('')}
        <tr><td><strong>Total</strong></td><td class="num"><strong>${fmt(tot)}</strong></td><td class="num">100.0</td></tr></tbody></table>
        ${ov.view !== 'alle' && dc.scope === 'beide' ? `<p class="small"><button type="button" class="link" data-act="ovAll">${esc(dc.name)} über alle Konten ansehen →</button></p>` : ''}`;
    }
  }
  let yearChart = '';
  if (ov.mode === 'year') {
    const series = ov.view === 'alle' && !dc
      ? [{ cls: 'b-privat', label: 'Persönlich', values: monthly(st(), 'alle', ov.period, 'privat', null) }, { cls: 'b-gemeinsam', label: 'Gemeinsam', values: monthly(st(), 'alle', ov.period, 'gemeinsam', null) }]
      : [{ cls: `b-${ov.view}`, label: VIEW_LABEL[ov.view], values: monthly(st(), ov.view, ov.period, null, ov.drill) }];
    yearChart = `<div class="card"><h2>${dc ? esc(dc.name) : 'Ausgaben'} pro Monat</h2>${barsSVG(series, MONTHS.map((m) => m.slice(0, 3)))}
      ${series.length > 1 ? `<div class="legend"><span><i class="privat"></i>Persönlich</span><span><i class="gemeinsam"></i>Gemeinsam</span></div>` : ''}
      ${dc ? '' : '<p class="muted small">Inkl. noch nicht getaggter Belastungen.</p>'}</div>`;
  }
  const notes: Record<View, string> = {
    privat: 'Alle Ausgaben deiner privaten Konten, inkl. Einzahlungen aufs gemeinsame Konto. Sparen & Vorsorge zählt nicht als Ausgabe.',
    gemeinsam: 'Wofür das gemeinsame Geld ausgegeben wurde. Einzahlungen sind Einnahmen.',
    alle: `Kategorien über alle Konten. Einzahlungen aufs gemeinsame Konto${s.hiddenTransfers ? ` (CHF ${fmt(s.hiddenTransfers)})` : ''} sind ausgeblendet, sonst würden sie doppelt zählen.`,
  };
  el.innerHTML = `
  <div class="card">
    ${head}
    <div class="row">
      <div class="seg"><button type="button" class="${ov.mode === 'month' ? 'on' : ''}" data-act="ovMode" data-mode="month">Monat</button><button type="button" class="${ov.mode === 'year' ? 'on' : ''}" data-act="ovMode" data-mode="year">Jahr</button></div>
      <select id="ovPeriod" class="auto">${ps.map((p) => `<option value="${p}" ${p === ov.period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select>
    </div>
    <div class="tiles">${tiles}</div>
    <p class="note">${notes[ov.view]}</p>
    ${s.open ? `<p class="small warn">${s.open} Buchungen (CHF ${fmt(s.openSum)}) noch nicht getaggt und nicht in der Aufteilung. <button type="button" class="link" data-act="tab" data-tab="tag">Jetzt taggen →</button></p>` : ''}
  </div>
  <div class="card">
    <div class="row">${dc ? `<button type="button" class="ghost" data-act="ovBack">← Alle</button><span class="dot" data-bg="${dc.color}"></span><h2 id="ovTitle">${esc(dc.name)}</h2><span class="spacer"></span>
      <button type="button" class="primary small" data-act="ovTx" id="ovTxBtn">Transaktionen anzeigen (${sliceTx(st(), ov.view, ov.period, dc.id).tx.length})</button>` : '<h2 id="ovTitle">Nach Kategorie</h2>'}</div>
    ${items.length ? `<div class="split">
      ${donutSVG(items, dc ? dc.name.slice(0, 18) : VIEW_LABEL[ov.view], 'CHF ' + fmt(base), dc ? 'ovTx' : 'ovDrill')}
      <div><table id="ovTable"><thead><tr><th>${dc ? 'Unterkategorie' : 'Kategorie'}</th><th class="num">CHF</th><th class="num">%</th></tr></thead><tbody>
      ${items.map((it) => `<tr class="click" data-act="${dc ? 'ovTx' : 'ovDrill'}" data-id="${esc(it.id)}">
        <td><div class="row nowrap"><span class="dot" data-bg="${it.color}" data-op="${it.shade}"></span>${esc(it.label)}</div>
        <div class="pctbar"><div data-bg="${it.color}" data-op="${it.shade}" data-w="${base ? (it.value / base) * 100 : 0}"></div></div></td>
        <td class="num">${fmt(it.value)}</td><td class="num">${pct(it.value, base)}</td></tr>`).join('')}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${fmt(base)}</strong></td><td class="num">100.0</td></tr>
      </tbody></table>${accSplit}</div></div>
      ${dc ? '<p class="muted small">Tippe auf eine Unterkategorie für ihre Transaktionen.</p>' : '<p class="muted small">Tippe auf eine Kategorie für Unterkategorien und Aufteilung nach Konto.</p>'}`
      : '<p class="empty">In diesem Zeitraum ist noch nichts getaggt.</p>'}
  </div>
  ${yearChart}
  <div class="card"><h2>Export</h2>
    <div class="row"><button type="button" data-act="exportReport">Report als CSV</button><button type="button" data-act="exportTx">Transaktionen als CSV</button></div>
    <p class="muted small">Exportiert die aktuelle Sicht (${VIEW_LABEL[ov.view]}, ${periodLabel(ov.period)}). Semikolon-getrennt für Excel.</p>
  </div>`;
}

// ---------- Transaktionsliste ----------
function renderList(el: HTMLElement) {
  const all = [...st().tx.values()].filter((t) => !t.deleted);
  const months = [...new Set(all.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const q = lf.q.toLowerCase();
  const sl = lfSlice ? sliceTx(st(), lfSlice.view, lfSlice.period, lfSlice.cat, lfSlice.sub) : null;
  const slc = lfSlice ? cat(lfSlice.cat) : undefined;
  const list = sl ? sl.tx : all.filter((t) => (!lf.acc || t.acc === lf.acc) && (!lf.period || t.date.startsWith(lf.period)) && (!lf.status || t.status === lf.status)
    && (!q || `${t.merchant} ${t.details} ${t.note} ${catLabel(st(), t)}`.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const shown = list.slice(0, 400);
  el.innerHTML = `<div class="card">
    ${sl && lfSlice ? `<div class="slicechip" id="lfSlice"><span class="dot" data-bg="${slc?.color ?? '#93a1a1'}"></span><span><strong>${esc(slc?.name ?? '')}${lfSlice.sub !== undefined ? ` › ${esc(subName(slc, lfSlice.sub) || 'Ohne Unterkategorie')}` : ''}</strong><br>
      <span class="muted small">${esc(periodLabel(lfSlice.period))} · ${VIEW_LABEL[lfSlice.view]} · CHF ${fmt(sl.sum)}</span></span><span class="spacer"></span>
      <button type="button" class="ghost small" data-act="lfBack">← Übersicht</button><button type="button" class="ghost iconbtn" data-act="lfSliceOff" title="Filter entfernen" aria-label="Filter entfernen">✕</button></div>` : `
    <div class="grid2">
      <select id="lfA"><option value="">Alle Konten</option>${[...st().accounts.values()].map((a) => `<option value="${a.id}" ${a.id === lf.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <select id="lfP"><option value="">Alle Monate</option>${months.map((m) => `<option value="${m}" ${m === lf.period ? 'selected' : ''}>${periodLabel(m)}</option>`).join('')}</select>
      <select id="lfS">${[['', 'Alle Status'], ['open', 'Nicht getaggt'], ['tagged', 'Getaggt'], ['excluded', 'Ignoriert']].map(([v, l]) => `<option value="${v}" ${v === lf.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input id="lfQ" type="search" placeholder="Händler, Notiz oder Kategorie suchen …" value="${esc(lf.q)}">
    </div>`}
    <p class="muted small">${list.length} Einträge</p>
  </div>
  <div class="card flush" id="txlist">${shown.length ? shown.map(txRow).join('') : '<p class="empty">Keine Einträge.</p>'}
    ${list.length > shown.length ? `<p class="muted small">Nur die ersten ${shown.length} angezeigt – Filter verwenden.</p>` : ''}
  </div>`;
  swipeRows($('#txlist', el));
  const qi = $<HTMLInputElement>('#lfQ', el);
  if (!qi) return;
  let t = 0;
  qi.addEventListener('input', () => {
    lf.q = qi.value;
    clearTimeout(t);
    t = window.setTimeout(() => { render(); const n = $<HTMLInputElement>('#lfQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
  });
}
function txRow(t: Tx): string {
  const a = acc(t.acc);
  return `<div class="swipe${t.status === 'open' ? ' one' : ''}" data-row="${esc(t.id)}"><div class="swipeact">${t.status !== 'open' ? `<button type="button" data-act="rowUntag" data-id="${esc(t.id)}">Untaggen</button>` : ''}<button type="button" class="danger" data-act="rowTrash" data-id="${esc(t.id)}">Löschen</button></div>
  <div class="txrow${t.status === 'excluded' ? ' ex' : ''}" data-act="editTx" data-id="${esc(t.id)}">
    <div class="d">${fmtDate(t.date).slice(0, 6)}</div><div class="m">${esc(t.merchant)}</div>
    <div class="a${t.amount < 0 ? ' credit' : ''}">${money(t.amount)}${isShared(st(), t) ? `<span class="mine">dein Anteil ${fmt(myPart(t))}</span>` : ''}</div>
    <div class="c"><span class="area ${a.area}">${esc(t.src === 'manual' ? a.manualLabel : a.name)}</span> <span class="${t.status === 'open' ? 'warn' : ''}">${esc(catLabel(st(), t))}</span>${t.note && t.status !== 'excluded' ? ` · ${esc(t.note)}` : ''}</div>
  </div></div>`;
}

const catOptions = (accId: string, sel: string | null, shared = false) => '<option value="">– Kategorie wählen –</option>' + catsFor(st(), accId, shared).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.kind !== 'expense' ? ` (${KIND_LABEL[c.kind]})` : ''}</option>`).join('');
/** Auswahl «Nur ich / 50 % / ⅔ ich / Individuell» für Formulare */
function shareSelect(id: string, share: number | null | undefined, hidden: boolean): string {
  const s = share ?? null;
  const ind = s != null && !SHARE_PRESETS.includes(s);
  return `<div class="grid2 sharefields" id="${id}Box" ${hidden ? 'hidden' : ''}><label class="field"><span>Aufteilung</span><select id="${id}">
    <option value="" ${s == null ? 'selected' : ''}>Nur ich</option><option value="5000" ${s === 5000 ? 'selected' : ''}>Geteilt 50 %</option><option value="6667" ${s === 6667 ? 'selected' : ''}>Geteilt, ⅔ ich</option><option value="ind" ${ind ? 'selected' : ''}>Geteilt, individuell</option></select></label>
    <label class="field" id="${id}IndBox" ${ind ? '' : 'hidden'}><span>Mein Anteil %</span><input id="${id}Ind" type="number" min="1" max="99" step="0.5" value="${ind ? s! / 100 : ''}"></label></div>`;
}
/** Gewählter Anteil aus einem Formular; NaN = ungültig */
function readShare(id: string): number | null {
  const v = (document.getElementById(id) as HTMLSelectElement | null)?.value ?? '';
  if (!v) return null;
  if (v !== 'ind') return +v;
  const p = parseFloat((document.getElementById(id + 'Ind') as HTMLInputElement).value);
  return p > 0 && p < 100 ? Math.round(p * 100) : NaN;
}
const subOptions = (catId: string | null, sel: string | null) => '<option value="">Ohne Unterkategorie</option>' + liveSubs(cat(catId)).map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

function editTx(id: string) {
  const t = st().tx.get(id);
  if (!t) return;
  const man = t.src === 'manual';
  const a = acc(t.acc);
  const d = $<HTMLDialogElement>('#dlg');
  d.innerHTML = `<form method="dialog" id="editForm" data-id="${esc(t.id)}">
    <h2>${man ? 'Manuellen Eintrag' : 'Buchung'} bearbeiten</h2>
    ${man ? `<label class="field"><span>Konto</span><select id="eAcc">${[...st().accounts.values()].map((x) => `<option value="${x.id}" ${x.id === t.acc ? 'selected' : ''}>${esc(x.manualLabel)} · ${esc(x.name)}</option>`).join('')}</select></label>
      <div class="grid2"><label class="field"><span>Datum</span><input type="date" id="eDate" value="${t.date}" required></label>
      <label class="field"><span>Betrag CHF</span><input type="number" step="0.05" min="0.05" id="eAmt" value="${(t.amount / 100).toFixed(2)}" required></label></div>
      <label class="field"><span>Beschreibung</span><input id="eMer" value="${esc(t.merchant)}"></label>`
    : `<p><strong>${esc(t.merchant)}</strong><br><span class="muted small">${fmtDate(t.date)} · Konto ${esc(a.name)} · ${esc(t.cur)} ${money(t.amount)}${t.details && t.details !== t.merchant ? ' · ' + esc(t.details) : ''}</span></p>`}
    <label class="field"><span>Status</span><select id="eStatus">${[['tagged', 'Getaggt'], ['open', 'Nicht getaggt'], ['excluded', 'Ignorieren (zählt nirgends)']].map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${t.amount > 0 && a.area === 'privat' ? shareSelect('eShare', t.share, false) : ''}
    <div class="grid2"><label class="field"><span>Kategorie</span><select id="eCat">${catOptions(t.acc, t.cat, isShared(st(), t))}</select></label>
    <label class="field"><span>Unterkategorie</span><select id="eSub">${subOptions(t.cat, t.sub)}</select></label></div>
    <label class="field"><span>Notiz</span><input id="eNote" value="${esc(t.note)}"></label>
    <div class="row"><button type="button" class="ghost danger" data-act="rowTrash" data-id="${esc(t.id)}" id="dlgTrash">In den Papierkorb</button>${t.status !== 'open' ? `<button type="button" class="ghost" data-act="rowUntag" data-id="${esc(t.id)}" id="dlgUntag">Untaggen</button>` : ''}</div>
    <div class="row"><span class="spacer"></span>
    <button type="button" data-act="dlgClose">Abbrechen</button><button type="button" class="primary" data-act="dlgSave" data-id="${esc(t.id)}">Speichern</button></div></form>`;
  d.showModal();
}
function dlgSave(id: string) {
  const t = st().tx.get(id);
  if (!t) return;
  const v = (s: string) => $<HTMLInputElement>(s).value;
  const status = v('#eStatus') as Tx['status'];
  const c = v('#eCat') || null;
  if (status === 'tagged' && !c) { toast('Bitte eine Kategorie wählen.'); return; }
  const patch: Partial<Tx> = { status, cat: status === 'tagged' ? c : null, sub: status === 'tagged' ? v('#eSub') || null : null, note: v('#eNote').trim() };
  if (status === 'excluded' && !patch.note) patch.note = 'Manuell ignoriert';
  if (document.getElementById('eShare')) {
    const sh = readShare('eShare');
    if (Number.isNaN(sh)) { toast('Mein Anteil: zwischen 1 und 99 %.'); return; }
    patch.share = sh;
  }
  if (t.src === 'manual') {
    const amount = Math.round(parseFloat(v('#eAmt')) * 100);
    if (!v('#eDate') || !(amount > 0)) { toast('Datum und Betrag prüfen.'); return; }
    Object.assign(patch, { acc: v('#eAcc'), date: v('#eDate'), amount, merchant: v('#eMer').trim() || acc(v('#eAcc')).manualLabel });
  }
  if (safe(() => S.patchTx(id, patch))) $<HTMLDialogElement>('#dlg').close();
}

// ---------- Manuelle Einträge ----------
function renderManual(el: HTMLElement) {
  const recent = [...st().tx.values()].filter((t) => t.src === 'manual' && !t.deleted).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const a = acc(manAcc);
  el.innerHTML = `<div class="card"><h2>Ausgabe manuell erfassen</h2>
    <label class="field"><span>Wer hat bezahlt?</span>
      <div class="seg full">${[...st().accounts.values()].map((x) => `<button type="button" data-act="manAcc" data-id="${x.id}" class="${manAcc === x.id ? 'on' : ''}">${esc(x.manualLabel)} · ${esc(x.name)}</button>`).join('')}</div></label>
    <p class="note">${a.area === 'gemeinsam' ? 'Zählt im Bereich Gemeinsam, z. B. Einkäufe oder Benzin, die deine Partnerin bezahlt hat.' : 'Zählt im Bereich Persönlich, z. B. Bargeld am Markt oder Trinkgeld.'}</p>
    <div class="grid2"><label class="field"><span>Datum</span><input type="date" id="cDate" value="${todayISO()}"></label>
    <label class="field"><span>Betrag CHF</span><input type="number" inputmode="decimal" step="0.05" min="0" id="cAmt" placeholder="0.00"></label></div>
    <label class="field"><span>Beschreibung</span><input id="cMer" placeholder="${a.area === 'gemeinsam' ? 'z. B. Einkauf, Tankstelle' : 'z. B. Markt, Kiosk'}"></label>
    ${a.area === 'privat' ? shareSelect('cShare', null, false) : ''}
    <div class="grid2"><label class="field"><span>Kategorie</span><select id="cCat">${catOptions(manAcc, null, true).replace(new RegExp(`<option value="${CASH_CAT}"[^<]*</option>`), '')}</select></label>
    <label class="field"><span>Unterkategorie</span><select id="cSub">${subOptions(null, null)}</select></label></div>
    <button type="button" class="primary" data-act="addManual">Hinzufügen</button></div>
  ${a.area === 'privat' ? cashCard() : ''}
  <div class="card flush"><h3>Letzte manuelle Einträge</h3>${recent.length ? recent.map(txRow).join('') : '<p class="empty">Noch keine Einträge.</p>'}</div>`;
}
function addManual() {
  const v = (s: string) => $<HTMLInputElement>(s).value;
  const amount = Math.round(parseFloat(v('#cAmt')) * 100);
  if (!v('#cDate') || !(amount > 0)) { toast('Bitte Datum und Betrag angeben.'); return; }
  if (!v('#cCat')) { toast('Bitte eine Kategorie wählen.'); return; }
  const a = acc(manAcc);
  const share = document.getElementById('cShare') ? readShare('cShare') : null;
  if (Number.isNaN(share)) { toast('Mein Anteil: zwischen 1 und 99 %.'); return; }
  if (safe(() => S.addManual({ acc: manAcc, date: v('#cDate'), amount, merchant: v('#cMer').trim() || a.manualLabel, cat: v('#cCat'), sub: v('#cSub') || null, share }))) {
    toast(`Gespeichert (${a.manualLabel} · ${AREA_LABEL[a.area]})`);
  }
}

/** Bargeld-Topf (BAR-05, BAR-06) */
function cashCard(): string {
  const p = cashPool(st());
  return `<div class="card" id="cashCard"><h2>Bargeld</h2>
    <div class="tiles"><div class="tile"><div class="v" id="cashOpen">${fmt(p.unassigned)}</div><div class="l">noch nicht zugeordnet CHF</div></div>
    ${p.overflow ? `<div class="tile"><div class="v warn" id="cashOver">${fmt(p.overflow)}</div><div class="l">mehr erfasst als bezogen CHF</div></div>` : ''}</div>
    <p class="muted small">Bargeldbezüge zählen als «Bargeld › Nicht zugeordnet». Erfasste Bargeldausgaben werden davon abgezogen und zählen im Monat des Bezugs.${p.overflow ? ' <span class="warn">Der Überschuss zählt im Monat der Ausgabe.</span>' : ''}</p></div>`;
}

// ---------- Einstellungen ----------
function renderSettings(el: HTMLElement) {
  const used = (id: string) => [...st().tx.values()].filter((t) => !t.deleted && t.status === 'tagged' && t.cat === id).length;
  const cats = sortedCategories(st());
  const theme = getTheme();
  el.innerHTML = `
  ${S.info.problems.length ? `<div class="card warnbox"><h2 class="danger">Datenprüfung</h2><p class="small">Beim Laden sind ${S.info.problems.length} Probleme aufgefallen. Es wurde nichts verändert.</p><ul class="small">${S.info.problems.slice(0, 10).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><h2>Darstellung</h2>
    <div class="seg" id="themeSeg">${([['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']] as [Theme, string][]).map(([v, l]) => `<button type="button" data-act="theme" data-value="${v}" class="${theme === v ? 'on' : ''}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div>
    <p class="muted small">Farben: Solarized.</p></div>
  ${renderSyncCard()}
  <div class="card"><h2>Kategorien</h2>
    <p class="muted small">Der Bereich bestimmt, bei welchen Konten eine Kategorie zur Wahl steht. «Beide» lässt sich über alle Konten auswerten, z. B. Auto gesamt. Die Reihenfolge bestimmt die Tasten 1–0 beim Taggen.</p>
    ${cats.map((c, i) => `<div class="catedit" data-cat="${c.id}">
      <div class="row nowrap"><input type="color" value="${c.color}" data-set="color" data-cat="${c.id}" aria-label="Farbe">
      <input value="${esc(c.name)}" data-set="name" data-cat="${c.id}" aria-label="Name">
      <button type="button" class="ghost iconbtn" data-act="moveCat" data-id="${c.id}" ${i ? '' : 'disabled'} title="Nach oben">↑</button>
      <button type="button" class="ghost iconbtn danger" data-act="delCat" data-id="${c.id}" title="Löschen">✕</button></div>
      <div class="row">
        <select data-set="scope" data-cat="${c.id}" aria-label="Bereich">${(['privat', 'gemeinsam', 'beide'] as Scope[]).map((s) => `<option value="${s}" ${c.scope === s ? 'selected' : ''}>${AREA_LABEL[s]}</option>`).join('')}</select>
        <select data-set="kind" data-cat="${c.id}" aria-label="Art">${(Object.keys(KIND_LABEL) as Kind[]).map((k) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select>
        <select data-set="defaultShare" data-cat="${c.id}" aria-label="Standard bei geteilt">${[['', 'Standard: Nur ich'], ['5000', 'Standard: geteilt 50 %'], ['6667', 'Standard: geteilt ⅔ ich']].map(([v, l]) => `<option value="${v}" ${String(c.defaultShare ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="muted small">${used(c.id)} Buchungen</span></div>
      <div class="subs">${liveSubs(c).map((s) => `<span class="subtag"><input value="${esc(s.name)}" data-set="sub" data-cat="${c.id}" data-sub="${s.id}" aria-label="Unterkategorie"><button type="button" data-act="delSub" data-cat="${c.id}" data-id="${s.id}" title="Entfernen">✕</button></span>`).join('')}
      <button type="button" class="ghost small" data-act="addSub" data-cat="${c.id}">+ Unterkategorie</button></div></div>`).join('')}
    <button type="button" data-act="addCat">+ Kategorie</button></div>
  <div class="card"><h2>Konten</h2>
    ${[...st().accounts.values()].map((a) => `<div class="grid2"><label class="field"><span>Name (${AREA_LABEL[a.area]})</span><input value="${esc(a.name)}" data-acc="${a.id}" data-k="name"></label>
    <label class="field"><span>Bezeichnung für manuelle Einträge</span><input value="${esc(a.manualLabel)}" data-acc="${a.id}" data-k="manualLabel"></label></div>
    <label class="field"><span>Abbuchungen der Kreditkarte erkennen an (Stichwörter, mit Komma getrennt)</span><input value="${esc((a.cardWords ?? []).join(', '))}" data-acc="${a.id}" data-k="cardWords" placeholder="z. B. Name des Kartenherausgebers" id="cardWords-${a.id}"></label>`).join('')}
    <p class="muted small">Solche Abbuchungen werden beim Import ausgeschlossen, damit die Einkäufe der Karte nicht doppelt zählen. Gilt für künftige Importe.</p>
    ${[...st().accounts.values()].map((a) => `<label class="field"><span>Kreditkarten von ${esc(a.name)} (wie in der Abrechnung, z. B. 1234 56XX XXXX 7890; mehrere mit Komma)</span><input value="${esc((a.cards ?? []).map(formatCardNo).join(', '))}" data-acc="${a.id}" data-k="cards" id="cards-${a.id}" inputmode="text" autocomplete="off" placeholder="1234 56XX XXXX 7890"></label>`).join('')}
    <p class="muted small">Gespeichert werden nur die ersten sechs und die letzten vier Ziffern. Gehört die Karte einer Datei zu einem anderen Konto, fragt die App vor dem Import nach.</p></div>
  <div class="card" id="delData"><h2>Daten löschen</h2>
    <p class="muted small">Eine falsche Datei importiert? Hier lässt sich ein ganzer Import löschen. Einzelne importierte Buchungen bleiben wie im Auszug; bei Bedarf «Ignorieren».</p>
    ${importList()}
    <div class="row"><button type="button" class="danger" data-act="delOpen" id="delOpenBtn">Alle ungetaggten Einträge löschen (${S.openImportedIds(st()).length})</button></div></div>
  <div class="card" id="trash"><h2>Papierkorb</h2>
    ${(() => { const tr = trashList(st(), Date.now(), S.TRASH_DAYS); return tr.length
      ? `<p class="muted small">Gelöschte Buchungen bleiben ${S.TRASH_DAYS} Tage hier und zählen nirgends. Danach sind sie endgültig gelöscht.</p><ul class="implist">${tr.map(({ tx: t, daysLeft }) => `<li data-trash="${esc(t.id)}">
        <div class="imphead"><strong>${esc(t.merchant)}</strong><span class="muted small">${fmtDate(t.date)} · ${money(t.amount)} · Konto ${esc(acc(t.acc).name)}</span></div>
        <div class="row nowrap"><span class="small muted">${esc(t.status === 'tagged' ? catLabel(st(), t) : t.status === 'excluded' ? 'Ignoriert' : 'Ungetaggt')} · noch ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}</span><span class="spacer"></span>
        <button type="button" class="ghost small" data-act="restore" data-id="${esc(t.id)}">Zurückholen</button></div></li>`).join('')}</ul>`
      : '<p class="muted small">Leer. Gelöschte Buchungen bleiben hier 30 Tage, bevor sie endgültig gelöscht sind.</p>'; })()}</div>
  <div class="card"><h2>Gelernte Händler</h2><p class="muted small">${st().rules.size} Händler mit gespeichertem Vorschlag.</p>
    <button type="button" data-act="clearRules">Vorschläge zurücksetzen</button></div>
  <div class="card"><h2>Backup</h2>
    <p class="muted small">Verschlüsselt mit einer Passphrase. ${IS_TEST ? '' : 'Lade regelmässig ein Backup herunter, auch wenn der Sync eingerichtet ist.'}</p>
    <div class="grid2"><label class="field"><span>Passphrase</span><input type="password" id="bPass" autocomplete="new-password"></label>
    <label class="field"><span>Datei zum Einspielen</span><input type="file" id="bFile" accept=".json"></label></div>
    <div class="row"><button type="button" class="primary" data-act="backupExport">Backup herunterladen</button><button type="button" data-act="backupImport">Backup einspielen</button></div></div>
  ${IS_TEST ? `<div class="card" id="testData"><h2>Test-App: Daten löschen</h2>
    <p class="muted small">Wähle, was gelöscht werden soll. Die Daten liegen nur in diesem Browser; in der Live-App gibt es diese Funktion nicht.</p>
    <div class="purge">${([['sample', 'Beispieldaten (erfundene Buchungen, Tags und Vorschläge)'], ['imports', 'Eigene importierte Buchungen'], ['manual', 'Eigene manuelle Einträge (Bargeld, Partnerin)'], ['rules', 'Gelernte Händler-Vorschläge'], ['categories', 'Kategorien und Konten auf Standard zurücksetzen']] as [string, string][])
      .map(([k, l]) => `<label class="opt"><input type="checkbox" data-purge="${k}"> ${l}</label>`).join('')}</div>
    <div class="row"><button type="button" class="danger" data-act="purge" id="purgeBtn">Ausgewähltes löschen</button></div>
    <h3>Beispieldaten</h3>
    <p class="muted small">Erfundene Beispieldateien im Format der echten Exporte, zum Ausprobieren des Imports.</p>
    <div class="row">${sampleFiles().map((f, i) => `<button type="button" data-act="sampleFile" data-i="${i}">${esc(f.name)}</button>`).join('')}</div>
    <p></p><div class="row"><button type="button" data-act="reseed">Beispieldaten laden</button><button type="button" class="danger" data-act="resetTest">Alles löschen und neu beginnen</button></div></div>` : ''}
  <p class="muted small center">Version ${esc(APP_VERSION)}</p>`;
}

function renderSyncCard(): string {
  if (IS_TEST) return '<div class="card" id="sync"><h2>Synchronisation</h2><p class="muted small">In der Test-App ist die Synchronisation abgeschaltet. Testdaten können so nie ins Daten-Repo gelangen.</p></div>';
  const s = Sync.status;
  if (s.state === 'off') return `<div class="card" id="sync"><h2>Synchronisation</h2>
    <p class="muted small">Verschlüsselt über ein privates GitHub-Repository. Im Repo liegen nur verschlüsselte Pakete; die Passphrase wird nie gespeichert.</p>
    <form id="syncForm" data-step="probe">
      <div class="grid2"><label class="field"><span>Besitzer</span><input id="sOwner" value="quillmesh" autocomplete="off"></label>
      <label class="field"><span>Repository (privat)</span><input id="sRepo" value="finance-data" autocomplete="off"></label></div>
      <label class="field"><span>Token (Fine-grained, nur dieses Repo, «Contents: Read and write»)</span><input id="sToken" type="password" autocomplete="off"></label>
      <div id="sPassBox" hidden><label class="field"><span id="sPassLabel">Passphrase</span><input id="sPass" type="password" autocomplete="new-password"></label>
      <label class="field" id="sPass2Box"><span>Passphrase wiederholen</span><input id="sPass2" type="password" autocomplete="new-password"></label></div>
      <button type="button" class="primary" data-act="syncProbe" id="sGo">Prüfen</button>
    </form></div>`;
  return `<div class="card" id="sync"><h2>Synchronisation</h2>
    <p class="small">Verbunden mit <strong>${esc(s.repo)}</strong>. ${s.state === 'error' ? `<span class="danger">${esc(s.error)}</span>` : ''}</p>
    ${s.state === 'locked' ? '<label class="field"><span>Passphrase</span><input id="sUnlock" type="password"></label><button type="button" class="primary" data-act="syncUnlock">Entsperren</button>'
      : '<div class="row"><button type="button" class="primary" data-act="syncNow">Jetzt synchronisieren</button><button type="button" class="danger" data-act="syncOff">Auf diesem Gerät trennen</button></div>'}</div>`;
}

let probeResult: Sync.Probe | null = null;
async function syncProbe() {
  const v = (s: string) => $<HTMLInputElement>(s).value.trim();
  const btn = $<HTMLButtonElement>('#sGo');
  btn.disabled = true;
  try {
    if (!probeResult) {
      probeResult = await Sync.probe(v('#sOwner'), v('#sRepo'), v('#sToken'));
      $('#sPassBox').hidden = false;
      const fresh = !probeResult.header;
      $('#sPass2Box').hidden = !fresh;
      $('#sPassLabel').textContent = fresh ? 'Neue Passphrase festlegen (mind. 12 Zeichen, im Passwortmanager aufbewahren)' : 'Passphrase der bestehenden Daten';
      btn.textContent = 'Verbinden';
    } else {
      const pass = $<HTMLInputElement>('#sPass').value;
      if (!probeResult.header && (pass.length < 12 || pass !== $<HTMLInputElement>('#sPass2').value)) { toast('Passphrase: mindestens 12 Zeichen, beide gleich.'); return; }
      await Sync.connect(v('#sOwner'), v('#sRepo'), v('#sToken'), pass, probeResult);
      probeResult = null;
      toast('Sync eingerichtet');
      render();
    }
  } catch (err) { toast((err as Error).message); } finally { if (document.body.contains(btn)) btn.disabled = false; }
}

// ---------- Ereignisse ----------
async function backupExport() {
  const pass = $<HTMLInputElement>('#bPass').value;
  if (pass.length < 8) { toast('Passphrase: mindestens 8 Zeichen.'); return; }
  const text = await S.exportBackup(pass);
  download(`finanzen-${IS_TEST ? 'test-' : ''}backup-${todayISO()}.json`, text, 'application/json');
}
async function backupImport() {
  const f = $<HTMLInputElement>('#bFile').files?.[0];
  if (!f) { toast('Bitte zuerst eine Backup-Datei wählen.'); return; }
  try { const r = await S.importBackup(await f.text(), $<HTMLInputElement>('#bPass').value); toast(`Backup eingespielt: ${r.added} Änderungen übernommen`); }
  catch (err) { toast((err as Error).message); }
}

type Handler = (el: HTMLElement) => void | Promise<void>;
const ACT: Record<string, Handler> = {
  tab: (b) => show(b.dataset.tab as Tab),
  impAcc: (b) => { impAcc = b.dataset.id!; render(); },
  manAcc: (b) => { manAcc = b.dataset.id!; render(); },
  pickCat: (b) => {
    tg.cat = b.dataset.id!;
    const t = currentTx(); const d = cat(tg.cat)?.defaultShare;
    if (t && canShare(t) && !tg.shareTouched && tg.share == null && d) tg.share = d; // TEI-07
    render();
  },
  share: (b) => { setShare(b.dataset.v!); render(); },
  shareInd: () => { tg.indOpen = true; tg.shareTouched = true; render(); },
  noteOpen: () => { tg.noteOpen = true; render(); },
  newSub: () => { tg.newSubOpen = true; render(); },
  newSubSave: () => saveNewSub(),
  skipCredit: () => { skipCredit(); render(); },
  pickSub: (b) => { if (tg.cat) applyTag(tg.cat, b.dataset.id || null); render(); },
  backCat: () => { tg.cat = null; render(); },
  accept: () => {
    const t = currentTx(); const r = t && st().rules.get(ruleKey(t));
    if (t && r && !r.skip && catsFor(st(), t.acc, tg.share != null).some((c) => c.id === r.cat)) applyTag(r.cat, liveSubId(cat(r.cat), r.sub));
    render();
  },
  skip: () => { const t = currentTx(); if (t) { tg.skipped.add(t.id); tg.cat = null; render(); } },
  unskip: () => { tg.skipped.clear(); render(); },
  exclude: () => { excludeCurrent(); render(); },
  undo: () => undo(),
  ovView: (b) => { ov.view = b.dataset.view as View; ov.period = ''; const c = cat(ov.drill); if (c && ov.view !== 'alle' && c.scope !== 'beide' && c.scope !== ov.view) ov.drill = null; render(); },
  ovAll: () => { const keep = ov.period; ov.view = 'alle'; ov.period = keep; render(); },
  ovMode: (b) => { ov.mode = b.dataset.mode as 'month' | 'year'; ov.period = ''; render(); },
  ovDrill: (b) => { ov.drill = b.dataset.id!; render(); },
  ovBack: () => { ov.drill = null; render(); },
  exportReport: () => download(`finanzen-report-${ov.view}-${ov.period}.csv`, toCSV(reportRows(st(), ov.view, ov.period)), 'text/csv;charset=utf-8'),
  exportTx: () => {
    const list = [...st().tx.values()].filter((t) => !t.deleted && (ov.view === 'alle' || areaOf(st(), t.acc) === ov.view) && t.date.startsWith(ov.period)).sort((a, b) => a.date.localeCompare(b.date));
    download(`finanzen-transaktionen-${ov.view}-${ov.period}.csv`, toCSV(txRows(st(), list)), 'text/csv;charset=utf-8');
  },
  editTx: (b) => {
    // Nach dem Wischen: Tippen schliesst die Aktionen, statt zu bearbeiten
    const sw = b.closest('.swipe');
    if (sw?.classList.contains('open')) { sw.classList.remove('open'); return; }
    editTx(b.dataset.id!);
  },
  dlgClose: () => $<HTMLDialogElement>('#dlg').close(),
  impYes: () => answerImport(true),
  impHist: () => { impHist = !impHist; render(); },
  impDel: (b) => deleteImport(b.dataset.id!),
  delOpen: () => deleteOpen(),
  impNo: () => answerImport(false),
  dlgSave: (b) => dlgSave(b.dataset.id!),
  rowUntag: (b) => untagOne(b.dataset.id!),
  rowTrash: (b) => trashOne(b.dataset.id!),
  restore: (b) => { if (safe(() => S.restoreTx([b.dataset.id!]))) { toast('Buchung zurückgeholt'); render(); } },
  // AUS-07: Knopf = ganze Kategorie, Unterkategorie in Tabelle oder Diagramm = nur diese
  ovTx: (b) => {
    if (!ov.drill) return;
    lfSlice = { view: ov.view, period: ov.period, cat: ov.drill, sub: b.id === 'ovTxBtn' ? undefined : b.dataset.id ?? '' };
    show('list');
  },
  lfSliceOff: () => { lfSlice = null; render(); },
  lfBack: () => { lfSlice = null; show('overview'); },
  addManual: () => addManual(),
  theme: (b) => setTheme(b.dataset.value as Theme),
  addCat: () => { safe(() => S.createCategory({ name: 'Neue Kategorie', scope: 'beide' })); },
  delCat: (b) => { const c = cat(b.dataset.id!); if (c && confirm(`Kategorie «${c.name}» löschen?`)) safe(() => S.deleteCategory(c.id)); },
  moveCat: (b) => { safe(() => S.moveCategory(b.dataset.id!, -1)); },
  addSub: (b) => { const name = prompt('Name der Unterkategorie'); if (name?.trim()) safe(() => S.addSub(b.dataset.cat!, name)); },
  delSub: (b) => {
    const n = [...st().tx.values()].filter((t) => t.sub === b.dataset.id).length;
    if (!n || confirm(`${n} Buchungen verlieren diese Unterkategorie (bleiben in der Kategorie). Fortfahren?`)) safe(() => S.deleteSub(b.dataset.cat!, b.dataset.id!));
  },
  clearRules: () => { if (confirm('Alle gelernten Händler-Vorschläge löschen?')) safe(() => S.clearRules()); },
  backupExport: () => backupExport(),
  backupImport: () => backupImport(),
  sampleFile: (b) => { const f = sampleFiles()[+b.dataset.i!]; download(f.name, f.text, 'text/csv;charset=utf-8'); },
  resetTest: async () => { if (IS_TEST && confirm('Alle Daten der Test-App löschen und neue Beispieldaten laden?')) { await S.whenSaved(); await resetTestApp(); } },
  purge: () => purgeSelected(),
  reseed: async () => { if (testActions) { await testActions.reseed(); toast('Beispieldaten geladen'); render(); } },
  syncProbe: () => syncProbe(),
  syncNow: async () => { await Sync.syncNow(); render(); },
  syncOff: async () => { if (confirm('Sync auf diesem Gerät trennen? Die Daten bleiben hier und im Repository.')) { await Sync.disconnect(); render(); } },
  syncUnlock: async () => { try { await Sync.unlock($<HTMLInputElement>('#sUnlock').value); render(); } catch (err) { toast((err as Error).message); } },
};
let resetTestApp: () => Promise<void> = async () => {};
export function setResetTestApp(fn: () => Promise<void>) { resetTestApp = fn; }
interface TestActions { purge: (o: S.PurgeOptions) => Promise<{ removedTx: number }>; reseed: () => Promise<void>; hasSample: () => Promise<boolean> }
let testActions: TestActions | null = null;
export function setTestActions(a: TestActions) { testActions = a; }
async function purgeSelected() {
  if (!testActions) return;
  const o: S.PurgeOptions = { sample: false, imports: false, manual: false, rules: false, categories: false };
  document.querySelectorAll<HTMLInputElement>('[data-purge]').forEach((c) => { (o as any)[c.dataset.purge!] = c.checked; });
  if (!Object.values(o).some(Boolean)) { toast('Bitte auswählen, was gelöscht werden soll.'); return; }
  if (!confirm('Die gewählten Daten der Test-App endgültig löschen?')) return;
  const r = await testActions.purge(o);
  toast(`Gelöscht: ${r.removedTx} Buchungen${o.rules ? ', Vorschläge' : ''}${o.categories ? ', Kategorien auf Standard' : ''}`);
  tg.history = []; tg.skipped.clear(); tg.forId = '';
  render();
}

function onClick(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b || (b as HTMLButtonElement).disabled) return;
  const f = ACT[b.dataset.act!];
  if (!f) return;
  e.preventDefault();
  // Offene Notiz nicht verlieren: vor jeder anderen Aktion speichern (TAG-10)
  if (tg.noteOpen && b.dataset.act !== 'noteOpen') flushNote();
  void f(b);
}
function flushNote() {
  const t = currentTx();
  const ni = document.querySelector<HTMLInputElement>('#noteIn');
  tg.noteOpen = false;
  if (t && ni && ni.value.trim() !== t.note) safe(() => S.patchTx(t.id, { note: ni.value.trim() }));
}

function onChangeEvt(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.opt) { (tg as any)[el.dataset.opt] = el.checked; return; }
  if (el.id === 'shareInd') { const p = parseFloat(el.value); if (p > 0 && p < 100) { tg.share = Math.round(p * 100); tg.shareTouched = true; } render(); return; }
  if (el.id === 'eShare' || el.id === 'cShare') {
    $(`#${el.id}IndBox`).hidden = el.value !== 'ind';
    if (el.id === 'eShare') { const t = st().tx.get($('#editForm').dataset.id!); if (t) { const keep = $<HTMLSelectElement>('#eCat').value; $('#eCat').innerHTML = catOptions(t.acc, keep || null, el.value !== ''); } }
    return;
  }
  if (el.id === 'ovPeriod') { ov.period = el.value; render(); return; }
  if (el.id === 'lfA') { lf.acc = el.value; render(); return; }
  if (el.id === 'lfP') { lf.period = el.value; render(); return; }
  if (el.id === 'lfS') { lf.status = el.value; render(); return; }
  if (el.id === 'eCat') { $('#eSub').innerHTML = subOptions(el.value || null, null); if (el.value) $<HTMLSelectElement>('#eStatus').value = 'tagged'; return; }
  if (el.id === 'eAcc') { $('#eCat').innerHTML = catOptions(el.value, null); $('#eSub').innerHTML = subOptions(null, null); return; }
  if (el.id === 'cCat') { $('#cSub').innerHTML = subOptions(el.value || null, null); return; }
  if (el.dataset.set) {
    const c = cat(el.dataset.cat!) as Category;
    const v = el.value.trim();
    const k = el.dataset.set;
    if (k === 'sub') { if (v) safe(() => S.renameSub(c.id, el.dataset.sub!, v)); else render(); return; }
    if (k === 'name' && !v) { render(); return; }
    if (k === 'defaultShare') { safe(() => S.patchCategory(c.id, { defaultShare: v ? +v : null })); return; }
    safe(() => S.patchCategory(c.id, { [k]: k === 'color' ? el.value : v }));
    return;
  }
  if (el.dataset.acc) {
    const v = el.value.trim();
    if (el.dataset.k === 'cards') {
      const parts = v.split(/[,;]/).map((w) => w.trim()).filter(Boolean);
      const cards = parts.map(normalizeCardNo);
      const bad = parts.filter((_, i) => !cards[i]);
      if (bad.length) { toast(`Kartennummer nicht erkannt: ${bad.join(', ')}. Format: 1234 56XX XXXX 7890`); render(); return; }
      safe(() => S.patchAccount(el.dataset.acc!, { cards: [...new Set(cards as string[])] }));
      return;
    }
    if (el.dataset.k === 'cardWords') { safe(() => S.patchAccount(el.dataset.acc!, { cardWords: v.split(',').map((w) => w.trim()).filter(Boolean) })); return; }
    if (v) safe(() => S.patchAccount(el.dataset.acc!, { [el.dataset.k!]: v })); else render();
  }
}

function onKey(e: KeyboardEvent) {
  if (tab !== 'tag' || e.metaKey || e.ctrlKey || e.altKey) return;
  const ae = document.activeElement as HTMLElement | null;
  if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && (ae as HTMLInputElement).type !== 'checkbox') return;
  if ($<HTMLDialogElement>('#dlg').open) return;
  const t = currentTx();
  if (!t) return;
  const k = e.key.toLowerCase();
  if (k === 't' && canShare(t)) { setShare(tg.share == null ? '5000' : 'me'); render(); e.preventDefault(); return; }
  if (k === 'n') { tg.noteOpen = true; render(); e.preventDefault(); return; }
  if (k === '+' && tg.cat) { tg.newSubOpen = true; render(); e.preventDefault(); return; }
  if (/^[0-9]$/.test(k)) {
    const n = +k;
    if (!tg.cat) { const c = catsFor(st(), t.acc, canShare(t) && tg.share != null)[(n + 9) % 10]; if (c) { const b = document.createElement('button'); b.dataset.id = c.id; void ACT.pickCat(b); } }
    else { const subs = liveSubs(cat(tg.cat)); if (n === 0) applyTag(tg.cat, null); else if (subs[n - 1]) applyTag(tg.cat, subs[n - 1].id); render(); }
    e.preventDefault();
  } else if (k === 'enter' && !tg.cat) { void ACT.accept(document.body); e.preventDefault(); }
  else if (k === 'escape' || k === 'backspace') { if (tg.cat) { tg.cat = null; render(); e.preventDefault(); } }
  else if (k === 's') void ACT.skip(document.body);
  else if (k === 'x') void ACT.exclude(document.body);
  else if (k === 'z') undo();
}
