// UMG-05: In der Test-App gezielt löschen (Beispieldaten, eigene Importe, manuelle Einträge, Vorschläge, Kategorien)
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { seedSample } from '../../src/seed';
import { validateState } from '../../src/validate';
import { frisch, iso, tx } from './hilfen';

const NONE = { sample: false, imports: false, manual: false, rules: false, categories: false };
let sample = new Set<string>();

beforeEach(async () => {
  await frisch();
  seedSample();
  await S.whenSaved();
  sample = new Set((await db.allEvents()).map((e) => e.id));
  // eigene Daten nach den Beispieldaten
  S.importTx([tx({ id: 'eigen-1', merchant: 'Eigener Händler' }), tx({ id: 'eigen-2', merchant: 'Eigener Händler' })]);
  S.tagTx(['eigen-1'], 'k-essen', S.addSub('k-essen', 'Eigene Unterkategorie'), 'privat|eigener händler');
  S.addManual({ acc: 'privat', date: iso(-1), amount: 1000, merchant: 'Eigener Bargeldeintrag', cat: 'k-einkaufen', sub: null });
  S.patchCategory('k-hobby', { name: 'Hobbys' });
});

const own = () => [...S.state.tx.values()].filter((t) => t.id.startsWith('eigen') || t.merchant === 'Eigener Bargeldeintrag');

describe('UMG-05: gezielt löschen', () => {
  test('nur in der Test-App', async () => {
    await expect(S.purgeTestData({ ...NONE, sample: true }, sample)).rejects.toThrow('nur in der Test-App');
  });
  test('Beispieldaten löschen: eigene Daten bleiben vollständig', async () => {
    const before = JSON.stringify(own());
    await S.purgeTestData({ ...NONE, sample: true }, sample, true);
    expect(S.state.tx.size).toBe(3);
    expect(JSON.stringify(own())).toBe(before);
    expect(S.state.categories.get('k-hobby')!.name).toBe('Hobbys');
    expect(validateState(S.state)).toEqual([]);
  });
  test('eigene Importe löschen, Beispieldaten und manuelle Einträge bleiben', async () => {
    const n = S.state.tx.size;
    const r = await S.purgeTestData({ ...NONE, imports: true }, sample, true);
    expect(r.removedTx).toBe(2);
    expect(S.state.tx.size).toBe(n - 2);
    expect(S.state.tx.has('eigen-1')).toBe(false);
    expect(own().map((t) => t.merchant)).toEqual(['Eigener Bargeldeintrag']);
  });
  test('Kategorien zurücksetzen: Buchungen mit entfernter Unterkategorie behalten die Kategorie', async () => {
    await S.purgeTestData({ ...NONE, categories: true }, sample, true);
    expect(S.state.categories.get('k-hobby')!.name).toBe('Hobby');
    expect(S.state.tx.get('eigen-1')).toMatchObject({ status: 'tagged', cat: 'k-essen', sub: null });
    expect(validateState(S.state)).toEqual([]);
  });
  test('alles löschen ergibt einen leeren, gültigen Stand; bleibt nach Neustart leer', async () => {
    await S.purgeTestData({ sample: true, imports: true, manual: true, rules: true, categories: true }, sample, true);
    expect([S.state.tx.size, S.state.rules.size]).toEqual([0, 0]);
    S.resetForTests(); await S.init();
    expect(S.state.tx.size).toBe(0);
  });
});
