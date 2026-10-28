// Ereignis-Speicher: Import, Taggen, Kategorien, Validierung, Backup
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { openTx, ruleKey } from '../../src/logic';
import { validateState } from '../../src/validate';
import { frisch, iso, tx } from './hilfen';

beforeEach(frisch);

describe('IMP-04: Duplikate', () => {
  test('zweimal importieren: zweites Mal nichts neu; Duplikate in derselben Datei zählen einmal', () => {
    const list = [tx({ id: 'a' }), tx({ id: 'b', status: 'excluded' }), tx({ id: 'a' })];
    expect(S.importTx(list)).toEqual({ added: 2, duplicates: 1, excluded: 1 });
    expect(S.importTx(list)).toEqual({ added: 0, duplicates: 3, excluded: 0 });
    expect(S.state.tx.size).toBe(2);
  });
  test('bereits getaggte Buchung wird durch erneuten Import nicht zurückgesetzt', () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-essen', null);
    S.importTx([tx({ id: 'a' })]);
    expect(S.state.tx.get('a')!.status).toBe('tagged');
  });
});

describe('TAG-01 bis TAG-05: Taggen', () => {
  test('Taggen mit Vorschlag merken; Vorschlag gilt pro Konto und Händler', () => {
    S.importTx([tx({ id: 'a', merchant: 'Frischmarkt-1234' }), tx({ id: 'b', merchant: 'FRISCHMARKT 99' }), tx({ id: 'c', acc: 'gemeinsam', merchant: 'Frischmarkt' })]);
    const a = S.state.tx.get('a')!;
    S.tagTx(['a'], 'k-einkaufen', 'k-einkaufen-1', ruleKey(a));
    expect(S.state.rules.get(ruleKey(S.state.tx.get('b')!))).toEqual({ cat: 'k-einkaufen', sub: 'k-einkaufen-1' });
    expect(S.state.rules.get(ruleKey(S.state.tx.get('c')!))).toBeUndefined();
  });
  test('TAG-03: alle eines Händlers in einem Schritt', () => {
    S.importTx([tx({ id: 'a' }), tx({ id: 'b' })]);
    S.tagTx(['a', 'b'], 'k-essen', 'k-essen-1');
    expect(openTx(S.state)).toHaveLength(0);
  });
  test('TAG-04: Ignorieren und Rückgängig (vorheriger Stand wird wiederhergestellt)', () => {
    S.importTx([tx({ id: 'a' })]);
    S.patchTx('a', { status: 'excluded', note: 'Manuell ignoriert' });
    expect(openTx(S.state)).toHaveLength(0);
    S.patchTx('a', { status: 'open', cat: null, sub: null, note: '' });
    expect(openTx(S.state).map((t) => t.id)).toEqual(['a']);
  });
  test('offene Buchungen: älteste zuerst', () => {
    S.importTx([tx({ id: 'neu', date: iso(-1) }), tx({ id: 'alt', date: iso(-20) })]);
    expect(openTx(S.state).map((t) => t.id)).toEqual(['alt', 'neu']);
  });
});

describe('TST-03: Ungültiges wird nicht gespeichert', () => {
  test.each([
    ['Betrag als Kommazahl', { amount: 12.5 }],
    ['ungültiges Datum', { date: '2026-13-45' }],
    ['unbekanntes Konto', { acc: 'fremd' }],
    ['getaggt ohne Kategorie', { status: 'tagged' as const, cat: null }],
    ['Unterkategorie einer anderen Kategorie', { status: 'tagged' as const, cat: 'k-essen', sub: 'k-auto-1' }],
  ])('%s', async (_name, patch) => {
    const before = S.info.eventCount;
    expect(() => S.importTx([tx({ id: 'x', ...patch })])).toThrow();
    expect(S.state.tx.has('x')).toBe(false);
    expect(S.info.eventCount).toBe(before);
    await S.whenSaved();
    expect((await db.allEvents()).length).toBe(before);
  });
  test('ein ungültiges Ereignis in einem Paket: keines wird angewendet', () => {
    expect(() => S.importTx([tx({ id: 'ok' }), tx({ id: 'kaputt', amount: 0.5 })])).toThrow();
    expect(S.state.tx.size).toBe(0);
  });
  test('Kategorie mit Buchungen kann nicht gelöscht werden', () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-essen', null);
    expect(() => S.deleteCategory('k-essen')).toThrow(/Buchungen/);
    expect(S.state.categories.get('k-essen')!.deleted).toBeUndefined();
  });
});

describe('TST-05: Importierte Buchungen bleiben wie im Auszug', () => {
  test('Betrag/Datum ändern und Löschen werden abgelehnt', () => {
    S.importTx([tx({ id: 'a', amount: 1000 })]);
    expect(() => S.patchTx('a', { amount: 1 })).toThrow();
    expect(() => S.patchTx('a', { deleted: true })).toThrow();
    expect(S.state.tx.get('a')!.amount).toBe(1000);
  });
  test('auch Ereignisse von anderen Geräten können Importe nicht verändern', async () => {
    S.importTx([tx({ id: 'a', amount: 1000 })]);
    await S.mergeEvents([{ id: 'fremd1', ts: Date.now() + 10, device: 'x', type: 'tx.patch', v: 1, data: { id: 'a', patch: { amount: 5, deleted: true, note: 'ok' } } }]);
    expect(S.state.tx.get('a')).toMatchObject({ amount: 1000, note: 'ok' });
    expect(S.state.tx.get('a')!.deleted).toBeUndefined();
  });
});

describe('BAR-01: Manuelle Einträge', () => {
  test('erfassen, ändern, löschen', () => {
    const id = S.addManual({ acc: 'privat', date: iso(0), amount: 1250, merchant: 'Markt', cat: 'k-einkaufen', sub: 'k-einkaufen-1' });
    S.patchTx(id, { amount: 1300, date: iso(-1) });
    expect(S.state.tx.get(id)).toMatchObject({ amount: 1300, src: 'manual', status: 'tagged' });
    S.deleteManual(id);
    expect(S.state.tx.get(id)!.deleted).toBe(true);
  });
  test('Kategorie muss zum Konto passen ist Sache der Oberfläche; ungültige Kategorie wird abgelehnt', () => {
    expect(() => S.addManual({ acc: 'privat', date: iso(0), amount: 100, merchant: 'x', cat: 'gibt-es-nicht', sub: null })).toThrow();
  });
});

describe('KAT-02: Kategorien ändern ohne Zuordnungen zu verlieren', () => {
  test('umbenennen, verschieben, neue Kategorie und Unterkategorie', () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-essen', 'k-essen-1');
    S.patchCategory('k-essen', { name: 'Essen' });
    expect(S.state.tx.get('a')!.cat).toBe('k-essen');
    const before = S.state.categories.get('k-ferien')!.order;
    S.moveCategory('k-ferien', -1);
    expect(S.state.categories.get('k-ferien')!.order).toBeLessThan(before);
    const id = S.createCategory({ name: 'Kinder', scope: 'beide' });
    const sub = S.addSub(id, 'Kleider');
    expect(S.addSub(id, ' kleider ')).toBe(sub);
    expect(S.state.categories.get(id)!.subs).toHaveLength(1);
  });
  test('Unterkategorie entfernen: Buchungen bleiben in der Kategorie', () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-essen', 'k-essen-1');
    S.deleteSub('k-essen', 'k-essen-1');
    expect(S.state.tx.get('a')).toMatchObject({ cat: 'k-essen', sub: null, status: 'tagged' });
    expect(validateState(S.state)).toEqual([]);
  });
});

describe('DAT-02: Backup', () => {
  test('verschlüsselt exportieren und in leerem Gerät einspielen ergibt denselben Zustand', async () => {
    S.importTx([tx({ id: 'a' }), tx({ id: 'b' })]);
    S.tagTx(['a'], 'k-essen', null);
    const backup = await S.exportBackup('geheim-1234');
    expect(backup).not.toContain('k-essen');
    const before = JSON.stringify([...S.state.tx.values()]);
    await frisch();
    expect(S.state.tx.size).toBe(0);
    await expect(S.importBackup(backup, 'falsch')).rejects.toThrow();
    expect((await S.importBackup(backup, 'geheim-1234')).added).toBeGreaterThan(0);
    expect(JSON.stringify([...S.state.tx.values()])).toBe(before);
    expect((await S.importBackup(backup, 'geheim-1234')).added).toBe(0);
  });
});

describe('Laden', () => {
  test('nach Neustart derselbe Zustand', async () => {
    S.importTx([tx({ id: 'a' })]);
    S.tagTx(['a'], 'k-essen', 'k-essen-2');
    await S.whenSaved();
    const before = JSON.stringify([...S.state.tx.values()]);
    S.resetForTests();
    await S.init();
    expect(JSON.stringify([...S.state.tx.values()])).toBe(before);
    expect(S.info.problems).toEqual([]);
  });
  test('unbekannte Ereignistypen (neuere Version) werden übersprungen, aber behalten', async () => {
    await S.mergeEvents([{ id: 'zukunft', ts: 1, device: 'x', type: 'budget.set', v: 2, data: { cat: 'k-essen', limit: 50000 } }]);
    expect((await db.allEvents()).some((e) => e.id === 'zukunft')).toBe(true);
  });
});

describe('TAG-09: neue Unterkategorie beim Taggen', () => {
  test('anlegen und gleich zuweisen; gleicher Name (Gross/Klein) verwendet die bestehende', () => {
    S.importTx([tx({ id: 'a' }), tx({ id: 'b' })]);
    const sub = S.addSub('k-essen', 'Pizza');
    S.tagTx(['a'], 'k-essen', sub);
    expect(S.state.tx.get('a')!.sub).toBe(sub);
    expect(S.addSub('k-essen', 'pizza ')).toBe(sub);
    expect(S.addSub('k-essen', 'Restaurant')).toBe('k-essen-1');
  });
});

describe('TAG-10: Notiz beim Taggen', () => {
  test('Notiz bleibt beim Überspringen erhalten und beim Taggen bestehen', () => {
    S.importTx([tx({ id: 'a' })]);
    S.patchTx('a', { note: 'Geschenk für Lea' });
    expect(openTx(S.state)[0].note).toBe('Geschenk für Lea');
    S.tagTx(['a'], 'k-persoenlich', null);
    expect(S.state.tx.get('a')!.note).toBe('Geschenk für Lea');
  });
});

describe('KAT-03: eindeutige IDs, Namen frei umbenennbar', () => {
  test('gleicher Unterkategorie-Name in zwei Kategorien bleibt getrennt; Umbenennen ändert keine Zuordnung', () => {
    S.importTx([tx({ id: 'a' }), tx({ id: 'b' })]);
    const s1 = S.addSub('k-essen', 'Diverses');
    S.tagTx(['a'], 'k-essen', s1);
    S.tagTx(['b'], 'k-sonstiges', 'k-sonstiges-3');
    expect(s1).not.toBe('k-sonstiges-3');
    S.renameSub('k-essen', s1, 'Kleinkram');
    S.patchCategory('k-essen', { name: 'Essen' });
    expect(S.state.tx.get('a')).toMatchObject({ cat: 'k-essen', sub: s1 });
    expect(S.state.tx.get('b')).toMatchObject({ cat: 'k-sonstiges', sub: 'k-sonstiges-3' });
  });
});
