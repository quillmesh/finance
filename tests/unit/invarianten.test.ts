// Zufallstests: Regeln, die IMMER gelten müssen, geprüft mit vielen zufällig erzeugten Abläufen.
// Schlägt eine Regel fehl, steht der Startwert (Seed) in der Meldung. Wiederholen mit
//   ZUFALL_SEED=<Zahl> bun test tests/unit/invarianten.test.ts
// ZUFALL_RUNS=<Anzahl> ändert die Anzahl Abläufe.
import { describe, expect, setSystemTime, test, afterAll } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { rng } from '../../src/sample';
import { aggregate, cashPool, catsFor, isShared, isTransfer, ledger, liveSubs, myPart, ruleKey, summary, viewTx, type View } from '../../src/logic';
import { validateState } from '../../src/validate';
import { newTx } from '../../src/parse/common';
import type { FinEvent, State, Tx } from '../../src/types';
import { parseUpload } from '../../src/parse';
// @ts-ignore – Hilfsskript in JavaScript, auch von den End-to-End-Tests genutzt
import { bauePdf } from '../pdf-bauen.mjs';

const RUNS = Number(process.env.ZUFALL_RUNS) || 60;
const SEEDS = process.env.ZUFALL_SEED ? [Number(process.env.ZUFALL_SEED)] : Array.from({ length: RUNS }, (_, i) => 1000 + i * 7919);
const VIEWS: View[] = ['privat', 'gemeinsam', 'alle'];
afterAll(() => setSystemTime());

function randomTx(r: () => number, n: number): Tx[] {
  const out: Tx[] = [];
  for (let i = 0; i < n; i++) {
    const acc = r() < 0.6 ? 'privat' : 'gemeinsam';
    const m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 28);
    out.push(newTx({
      id: `${acc}:z:${Math.floor(r() * n * 1.5)}`, // absichtlich Wiederholungen → Duplikate
      acc, src: r() < 0.5 ? 'visa' : 'bank', date: `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      amount: Math.round((r() < 0.85 ? 1 : -1) * r() * 500000), merchant: ['Frischmarkt', 'Tankstelle', 'Miete', 'Lohn', 'Bar'][Math.floor(r() * 5)],
      status: r() < 0.1 ? 'excluded' : 'open',
    }));
    // Bargeldbezüge (BAR-02)
    if (acc === 'privat' && r() < 0.15) Object.assign(out[out.length - 1], { amount: 10000 + Math.floor(r() * 30) * 1000, merchant: 'Bargeldbezug', status: 'tagged', cat: 'k-bargeld', sub: 'k-bargeld-1' });
  }
  return out;
}

/** Zufällige gültige Änderungen: taggen (auch geteilt), ignorieren, Gutschrift nicht erfassen, wieder öffnen, Bargeld erfassen */
const SHARES = [null, null, 5000, 6667, 3333, 1, 9999];
function randomOps(r: () => number, count: number) {
  for (let i = 0; i < count; i++) {
    const all = [...S.state.tx.values()].filter((t) => !t.deleted);
    if (!all.length) return;
    const t = all[Math.floor(r() * all.length)];
    const x = r();
    if (x < 0.6) {
      const share = SHARES[Math.floor(r() * SHARES.length)];
      const cats = catsFor(S.state, t.acc, share !== null);
      const c = cats[Math.floor(r() * cats.length)];
      const subs = liveSubs(c);
      S.tagTx([t.id], c.id, r() < 0.2 || !subs.length ? null : subs[Math.floor(r() * subs.length)].id, r() < 0.5 ? ruleKey(t) : null, share);
    } else if (x < 0.7) S.patchTx(t.id, { status: 'excluded', note: 'ignoriert' });
    else if (x < 0.75 && t.amount < 0) S.skipCredit([t.id], r() < 0.5 ? ruleKey(t) : null);
    else if (x < 0.9) {
      const m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 28);
      S.addManual({ acc: r() < 0.8 ? 'privat' : 'gemeinsam', date: `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, amount: 100 + Math.floor(r() * 9000), merchant: 'Bar', cat: 'k-einkaufen', sub: null, share: r() < 0.2 ? 5000 : null });
    } else if (t.src === 'manual' && r() < 0.5) S.deleteManual(t.id);
    else S.patchTx(t.id, { status: 'open', cat: null, sub: null, note: '' });
  }
}

const snapshot = (st: State) => JSON.stringify({
  tx: [...st.tx.values()].sort((a, b) => a.id.localeCompare(b.id)),
  cats: [...st.categories.values()].sort((a, b) => a.id.localeCompare(b.id)),
  rules: [...st.rules].sort(),
});

async function fresh() { db.resetMemoryForTests(); S.resetForTests(); await S.init(); }

describe('Invarianten mit Zufallsdaten', () => {
  test('Import ist idempotent und unabhängig von der Reihenfolge (IMP-04)', async () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const list = randomTx(r, 40);
      await fresh(); S.importTx(list); S.importTx(list);
      const once = snapshot(S.state);
      const shuffled = [...list].sort(() => r() - 0.5);
      await fresh(); S.importTx(shuffled.slice(0, 20)); S.importTx(shuffled); S.importTx(list.slice(5, 15));
      // Gleiche ID mit anderem Inhalt in einer Zufallsliste: die zuerst importierte gilt. Ohne solche Fälle muss alles gleich sein.
      const unique = new Map<string, string>();
      const consistent = list.every((t) => { const k = JSON.stringify(t); const prev = unique.get(t.id); unique.set(t.id, prev ?? k); return !prev || prev === k; });
      if (consistent) expect(snapshot(S.state), `Seed ${seed}`).toBe(once);
      expect(S.state.tx.size, `Seed ${seed}`).toBe(new Set(list.map((t) => t.id)).size);
    }
  });

  test('Summen: Kategorien ergeben das Total; Alle Konten zählt jeden Franken genau einmal (BER-08)', async () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      await fresh(); S.importTx(randomTx(r, 50)); randomOps(r, 80);
      for (const v of VIEWS) {
        const s = summary(S.state, v, '2026');
        const slices = aggregate(S.state, viewTx(S.state, v, '2026'), v);
        expect(slices.reduce((a, x) => a + x.value, 0), `Seed ${seed} ${v}`).toBe(s.expense);
        expect(Number.isInteger(s.expense) && Number.isInteger(s.income), `Seed ${seed}: ganze Rappen`).toBe(true);
      }
      const p = summary(S.state, 'privat', '2026'), g = summary(S.state, 'gemeinsam', '2026'), a = summary(S.state, 'alle', '2026');
      const pv = viewTx(S.state, 'privat', '2026');
      const transfersPrivat = pv.filter((t) => isTransfer(S.state, t)).reduce((x, t) => x + (isShared(S.state, t) ? myPart(t) : t.amount), 0);
      const sharedMine = pv.filter((t) => isShared(S.state, t) && !isTransfer(S.state, t)).filter((t) => aggregate(S.state, [t], 'privat').length).reduce((x, t) => x + myPart(t), 0);
      // TEI-03 / BER-08: Alle = Persönlich ohne Einzahlungen und ohne meine Anteile + Gemeinsam (dort geteilte voll)
      expect(a.expense, `Seed ${seed}`).toBe(p.expense - transfersPrivat - sharedMine + g.expense);
      // Mein Anteil liegt nie über dem Betrag
      for (const t of pv) if (isShared(S.state, t)) expect(myPart(t) <= t.amount && myPart(t) >= 0, `Seed ${seed}`).toBe(true);
      // BAR: Bargeld zählt genau einmal (Bezüge + Überschuss); kein negativer Rest
      const pool = cashPool(S.state);
      const raw = [...S.state.tx.values()].filter((t) => !t.deleted).reduce((x, t) => x + t.amount, 0);
      const withdrawn = [...pool.remaining.keys()].reduce((x, id) => x + S.state.tx.get(id)!.amount, 0);
      expect(ledger(S.state).reduce((x, t) => x + t.amount, 0), `Seed ${seed}`).toBe(raw - (withdrawn - pool.unassigned));
      expect([...pool.remaining.values()].every((v) => v >= 0), `Seed ${seed}`).toBe(true);
      expect(validateState(S.state), `Seed ${seed}`).toEqual([]);
    }
  });

  test('Zustand ist eindeutig: gleiche Ereignisse in beliebiger Reihenfolge → gleicher Zustand', async () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const r = rng(seed);
      await fresh(); S.importTx(randomTx(r, 30)); randomOps(r, 50);
      await S.whenSaved();
      const evs = await db.allEvents();
      const shuffled = [...evs].sort(() => r() - 0.5);
      expect(snapshot(S.buildState(shuffled)), `Seed ${seed}`).toBe(snapshot(S.state));
    }
  });

  test('Zwei Geräte gleichen sich in beliebiger Reihenfolge ab und landen beim selben Zustand', async () => {
    let now = Date.UTC(2026, 9, 1, 8);
    for (const seed of SEEDS.slice(0, 30)) {
      const r = rng(seed);
      const shared = randomTx(r, 20);
      const logs: Record<'A' | 'B', FinEvent[]> = { A: [], B: [] };
      const use = async (dev: 'A' | 'B') => {
        setSystemTime(new Date((now += 1 + Math.floor(r() * 60_000))));
        db.resetMemoryForTests(); S.resetForTests();
        await db.setMeta('device', dev);
        if (logs[dev].length) await db.putEvents(logs[dev]);
        await S.init();
      };
      const save = async (dev: 'A' | 'B') => { await S.whenSaved(); logs[dev] = await db.allEvents(); };
      for (let round = 0; round < 4; round++) {
        for (const dev of ['A', 'B'] as const) {
          await use(dev);
          if (round === 0) S.importTx(dev === 'A' ? shared : [...shared].reverse());
          randomOps(r, 10);
          await save(dev);
        }
        if (r() < 0.5) { await use('B'); await S.mergeEvents(logs.A); await save('B'); }
      }
      await use('A'); await S.mergeEvents(logs.B); await save('A'); const a = snapshot(S.state);
      await use('B'); await S.mergeEvents(logs.A); await save('B'); const b = snapshot(S.state);
      expect(a, `Seed ${seed}`).toBe(b);
    }
  });

  test('IMP-09/IMP-10: zufällige PDF-Abrechnungen werden vollständig gelesen, Summen stimmen, IDs sind eindeutig und stabil', async () => {
    const WORDS = ['Laden', 'Bäckerei', 'Café (Bahnhof)', 'Muster AG', 'Kiosk', 'Tankstelle', 'Ümlaut & Co', 'Back\\slash'];
    for (const seed of SEEDS.slice(0, 25)) {
      const r = rng(seed);
      const day = () => `${String(1 + Math.floor(r() * 28)).padStart(2, '0')}.${String(1 + Math.floor(r() * 12)).padStart(2, '0')}.26`;
      const cards = Array.from({ length: 1 + Math.floor(r() * 2) }, (_, c) => ({
        no: `${4000 + c} ${10 + c}XX XXXX ${1000 + Math.floor(r() * 9000)}`, name: `Visa Zufall${c}, Max Muster`,
        tx: Array.from({ length: Math.floor(r() * 60) }, () => {
          const d = day();
          const amount = (r() < 0.1 ? -1 : 1) * (1 + Math.floor(r() * (r() < 0.1 ? 2_000_000 : 20_000)));
          return { d, v: d, text: `${WORDS[Math.floor(r() * WORDS.length)]} ${Math.floor(r() * 5)}, Musterort CH`, amount, branch: r() < 0.8 ? 'Branche Muster' : undefined };
        }),
      }));
      const previous = Math.floor(r() * 300000);
      const spec = { previous, payment: r() < 0.8 ? { d: day(), v: day() } : null, fees: r() < 0.3 ? [{ d: day(), v: day(), text: 'Rechnungsgebühr', amount: 200 }] : [],
        cards, perPage: 5 + Math.floor(r() * 20), compress: r() < 0.8, objStm: r() < 0.3 };
      const res = await parseUpload(bauePdf(spec), 'privat');
      const expected = cards.reduce((a, c) => a + c.tx.length, 0) + spec.fees.length + (spec.payment ? 1 : 0);
      expect(res.tx.length, `Seed ${seed}`).toBe(expected);
      expect(res.check?.ok, `Seed ${seed}: ${JSON.stringify(res.check)}`).toBe(true);
      expect(new Set(res.tx.map((t) => t.id)).size, `Seed ${seed}`).toBe(res.tx.length);
      expect((await parseUpload(bauePdf(spec), 'privat')).tx.map((t) => t.id), `Seed ${seed}`).toEqual(res.tx.map((t) => t.id));
      expect(res.tx.every((t) => Number.isInteger(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date)), `Seed ${seed}`).toBe(true);
      expect(res.cards.length, `Seed ${seed}`).toBe(new Set(cards.map((c) => c.no)).size);
    }
  });
});
