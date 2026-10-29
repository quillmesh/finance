// Untaggen (TAG-12), Papierkorb (TAG-13), gelöschte Buchungen beim erneuten Import (TAG-15),
// Transaktionen zu einem Stück im Diagramm (AUS-07), Unterkategorien ohne Konflikte (KAT-04, KAT-05). Alle Daten erfunden.
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { aggregate, deletedInFile, DAY_MS, openTx, sliceTx, summary, trashList, viewTx, type View } from '../../src/logic';
import { validateEvent, validateState } from '../../src/validate';
import type { FinEvent } from '../../src/types';
import { frisch, iso, tx } from './hilfen';

beforeEach(frisch);
const month = iso(-1).slice(0, 7);

describe('TAG-12: einzelne Buchung wieder ungetaggt', () => {
  test('Kategorie, Unterkategorie und Anteil fallen weg, die Notiz bleibt', () => {
    S.importTx([tx({ id: 'a', note: 'Geburtstag' })]);
    S.tagTx(['a'], 'k-einkaufen', 'k-einkaufen-1', null, 5000);
    S.untagTx(['a']);
    expect(S.state.tx.get('a')).toMatchObject({ status: 'open', cat: null, sub: null, share: null, note: 'Geburtstag' });
    expect(openTx(S.state).map((t) => t.id)).toEqual(['a']);
  });
});

describe('TAG-13: Papierkorb', () => {
  test('gelöschte Buchung zählt nirgends mehr, steht im Papierkorb und lässt sich mit Tags zurückholen', () => {
    S.importTx([tx({ id: 'a', amount: 4000 }), tx({ id: 'b', amount: 1000 })]);
    S.tagTx(['a', 'b'], 'k-einkaufen', null);
    const before = summary(S.state, 'privat', month).expense;
    S.trashTx(['a']);
    expect(summary(S.state, 'privat', month).expense).toBe(before - 4000);
    expect(trashList(S.state).map((x) => x.tx.id)).toEqual(['a']);
    expect(trashList(S.state)[0].daysLeft).toBe(30);
    S.restoreTx(['a']);
    expect(S.state.tx.get('a')).toMatchObject({ deleted: false, status: 'tagged', cat: 'k-einkaufen' });
    expect(S.state.tx.get('a')!.trashedAt).toBeUndefined();
    expect(summary(S.state, 'privat', month).expense).toBe(before);
  });
  test('nach 30 Tagen nicht mehr im Papierkorb; manuelle Einträge kommen auch in den Papierkorb', () => {
    S.importTx([tx({ id: 'a' })]);
    const m = S.addManual({ acc: 'privat', date: iso(-1), amount: 500, merchant: 'Bar', cat: 'k-einkaufen', sub: null });
    S.trashTx(['a']);
    S.deleteManual(m);
    const now = Date.now();
    expect(trashList(S.state, now).map((x) => x.tx.id).sort()).toEqual(['a', m].sort());
    expect(trashList(S.state, now + 29 * DAY_MS)).toHaveLength(2);
    expect(trashList(S.state, now + 30 * DAY_MS + 1000)).toEqual([]);
  });
  test('Prüfung: nur vorhandene, nicht gelöschte Buchungen in den Papierkorb; nur Papierkorb-Buchungen zurück', () => {
    S.importTx([tx({ id: 'a' })]);
    const ev = (type: string, data: object): FinEvent => ({ id: 'e', ts: 1, device: 'd', type, data, v: 1 });
    expect(validateEvent(ev('tx.restore', { ids: ['a'] }), S.state)).not.toBeNull();
    expect(validateEvent(ev('tx.trash', { ids: ['x'] }), S.state)).not.toBeNull();
    expect(validateEvent(ev('tx.trash', { ids: [] }), S.state)).not.toBeNull();
    S.trashTx(['a']);
    expect(validateEvent(ev('tx.trash', { ids: ['a'] }), S.state)).not.toBeNull();
    expect(validateState(S.state)).toEqual([]);
  });
});

describe('TAG-15: gelöschte Buchung kommt in einem Import wieder vor', () => {
  test('wird erkannt und nicht still übernommen; auf Wunsch ungetaggt zurück', () => {
    S.importTx([tx({ id: 'a' }), tx({ id: 'b' })]);
    S.tagTx(['a'], 'k-einkaufen', null);
    S.trashTx(['a']);
    const file = [tx({ id: 'a' }), tx({ id: 'b' }), tx({ id: 'c' })];
    expect(deletedInFile(S.state, file).map((t) => t.id)).toEqual(['a']);
    expect(S.importTx(file).added).toBe(1);
    expect(S.state.tx.get('a')!.deleted).toBe(true);
    S.restoreTx(['a'], true);
    expect(S.state.tx.get('a')).toMatchObject({ deleted: false, status: 'open', cat: null });
    expect(deletedInFile(S.state, file)).toEqual([]);
  });
});

describe('AUS-07: Transaktionen zu einer Kategorie im Diagramm', () => {
  test('Summe der Buchungen = Betrag im Diagramm, auch mit Unterkategorie, Anteilen und Bargeld', () => {
    S.importTx([
      tx({ id: 'a', amount: 4000 }), tx({ id: 'b', amount: 1000 }), tx({ id: 'c', amount: 3000 }), tx({ id: 'g', acc: 'gemeinsam', amount: 9000 }),
      tx({ id: 'bar', amount: 20000, status: 'tagged', cat: 'k-bargeld', sub: 'k-bargeld-1' }),
    ]);
    S.tagTx(['a'], 'k-einkaufen', 'k-einkaufen-1');
    S.tagTx(['b'], 'k-einkaufen', null, null, 5000);
    S.tagTx(['c'], 'k-auto', null);
    S.tagTx(['g'], 'k-einkaufen', null);
    S.addManual({ acc: 'privat', date: iso(-1), amount: 2500, merchant: 'Markt', cat: 'k-einkaufen', sub: null });
    for (const v of ['privat', 'gemeinsam', 'alle'] as View[]) {
      for (const sl of aggregate(S.state, viewTx(S.state, v, month), v)) {
        expect(sliceTx(S.state, v, month, sl.id).sum, `${v} ${sl.id}`).toBe(sl.value);
        for (const sub of aggregate(S.state, viewTx(S.state, v, month), v, sl.id)) expect(sliceTx(S.state, v, month, sl.id, sub.id).sum).toBe(sub.value);
      }
    }
    const ids = sliceTx(S.state, 'privat', month, 'k-einkaufen').tx.map((t) => t.id);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', expect.stringMatching(/^manual:/)]));
    expect(sliceTx(S.state, 'privat', month, 'k-einkaufen', '').tx).toHaveLength(2);
    expect(sliceTx(S.state, 'privat', month, 'k-bargeld').tx.map((t) => t.id)).toEqual(['bar']);
  });
});

describe('KAT-04/KAT-05: Unterkategorien ohne Konflikte', () => {
  test('Umbenennen ändert nur den Namen; Buchungen, Vorschläge und Auswertung bleiben', () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-einkaufen', 'k-einkaufen-1', 'privat|händler');
    S.renameSub('k-einkaufen', 'k-einkaufen-1', 'Supermarkt');
    expect(S.state.tx.get('a')!.sub).toBe('k-einkaufen-1');
    expect(S.state.rules.get('privat|händler')!.sub).toBe('k-einkaufen-1');
    expect(aggregate(S.state, viewTx(S.state, 'privat', month), 'privat', 'k-einkaufen')[0].label).toBe('Supermarkt');
  });
  test('gleicher Name wie eine andere Unterkategorie derselben Kategorie wird abgelehnt', () => {
    expect(() => S.renameSub('k-einkaufen', 'k-einkaufen-1', ' drogerie ')).toThrow('gibt es schon');
    S.renameSub('k-einkaufen', 'k-einkaufen-1', 'LEBENSMITTEL'); // nur Gross/Klein am eigenen Namen: erlaubt
    expect(S.addSub('k-einkaufen', 'Drogerie')).toBe('k-einkaufen-2');
    // Name einer gelöschten Unterkategorie ist wieder frei
    S.deleteSub('k-einkaufen', 'k-einkaufen-3');
    expect(S.addSub('k-einkaufen', 'Haushalt')).not.toBe('k-einkaufen-3');
  });
  test('gleichzeitig auf zwei Geräten: gelöscht und neu damit getaggt → ohne Unterkategorie, in jeder Reihenfolge', () => {
    const t0 = Date.now() + 1000;
    const base: FinEvent[] = [{ id: 'c1', ts: t0, device: 'A', type: 'tx.create', data: { tx: tx({ id: 'a' }) }, v: 1 }];
    const del: FinEvent = { id: 'd1', ts: t0 + 10, device: 'A', type: 'sub.patch', data: { cat: 'k-einkaufen', id: 'k-einkaufen-2', patch: { deleted: true } }, v: 1 };
    const tagEarly: FinEvent = { id: 't1', ts: t0 + 5, device: 'B', type: 'tx.patch', data: { id: 'a', patch: { status: 'tagged', cat: 'k-einkaufen', sub: 'k-einkaufen-2' } }, v: 1 };
    const tagLate: FinEvent = { ...tagEarly, id: 't2', ts: t0 + 20 };
    for (const evs of [[...base, del, tagEarly], [...base, tagLate, del], [del, ...base, tagEarly].reverse()]) {
      const st = S.buildState(evs);
      expect(st.tx.get('a')).toMatchObject({ status: 'tagged', cat: 'k-einkaufen', sub: null });
      expect(validateState(st)).toEqual([]);
    }
  });
  test('Vorschlag mit gelöschter Unterkategorie: lokal taggen damit wird abgelehnt (UI nimmt dann ohne)', () => {
    S.importTx([tx({ id: 'a' })]);
    S.deleteSub('k-einkaufen', 'k-einkaufen-2');
    expect(() => S.tagTx(['a'], 'k-einkaufen', 'k-einkaufen-2')).toThrow();
  });
});
