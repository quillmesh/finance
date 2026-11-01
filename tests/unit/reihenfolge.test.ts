// TAG-17: Reihenfolge der Kategorien und Unterkategorien beim Taggen ändern (zwei Plätze tauschen)
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { liveSubs, sortedCategories, tagGrid } from '../../src/logic';
import { validateEvent, validateState } from '../../src/validate';
import type { FinEvent } from '../../src/types';
import { frisch } from './hilfen';

beforeEach(frisch);

const catIds = () => sortedCategories(S.state).map((c) => c.id);
const subIds = (cat: string) => liveSubs(S.state.categories.get(cat)).map((s) => s.id);

describe('TAG-17: Kategorien tauschen', () => {
  test('zwei Kategorien tauschen die Plätze, alle anderen bleiben', () => {
    const vorher = catIds();
    const a = vorher.indexOf('k-hobby'), b = vorher.indexOf('k-einkaufen');
    S.swapCategories('k-hobby', 'k-einkaufen');
    const nachher = catIds();
    expect(nachher[a]).toBe('k-einkaufen');
    expect(nachher[b]).toBe('k-hobby');
    expect(nachher.filter((_, i) => i !== a && i !== b)).toEqual(vorher.filter((_, i) => i !== a && i !== b));
  });
  test('die Taste folgt dem Platz', () => {
    S.swapCategories('k-haushalt', 'k-bargeld');
    const g = tagGrid(S.state, 'privat');
    expect(g[0].cat.id).toBe('k-bargeld');
    expect(g[0].key).toBe('1');
  });
  test('dieselbe oder eine unbekannte Kategorie ändert nichts', () => {
    const vorher = catIds(), n = S.info.eventCount;
    S.swapCategories('k-hobby', 'k-hobby');
    S.swapCategories('k-hobby', 'gibt-es-nicht');
    expect(catIds()).toEqual(vorher);
    expect(S.info.eventCount).toBe(n);
  });
});

describe('TAG-17: Unterkategorien tauschen', () => {
  test('ohne gespeicherte Reihenfolge bleibt sie wie bisher (alte Daten)', () => {
    expect(subIds('k-essen')).toEqual(['k-essen-1', 'k-essen-2', 'k-essen-3', 'k-essen-4']);
  });
  test('zwei Unterkategorien tauschen, die anderen bleiben', () => {
    S.swapSubs('k-essen', 'k-essen-1', 'k-essen-3');
    expect(subIds('k-essen')).toEqual(['k-essen-3', 'k-essen-2', 'k-essen-1', 'k-essen-4']);
    expect(validateState(S.state)).toEqual([]);
  });
  test('neue Unterkategorie kommt ans Ende, auch nach einem Tausch', () => {
    S.swapSubs('k-essen', 'k-essen-1', 'k-essen-4');
    const id = S.addSub('k-essen', 'Pizza');
    expect(subIds('k-essen').at(-1)).toBe(id);
  });
  test('gelöschte Unterkategorien zählen nicht mit', () => {
    S.deleteSub('k-essen', 'k-essen-2');
    S.swapSubs('k-essen', 'k-essen-1', 'k-essen-4');
    expect(subIds('k-essen')).toEqual(['k-essen-4', 'k-essen-3', 'k-essen-1']);
  });
  test('bleibt nach dem Neuladen gleich (Ereignisse werden neu abgespielt)', async () => {
    S.swapSubs('k-auto', 'k-auto-1', 'k-auto-2');
    S.swapCategories('k-auto', 'k-essen');
    const subs = subIds('k-auto'), cats = catIds();
    await S.whenSaved();
    S.resetForTests(); await S.init();
    expect(subIds('k-auto')).toEqual(subs);
    expect(catIds()).toEqual(cats);
  });
  test('ungültige Reihenfolge wird abgelehnt', () => {
    const ev = (order: unknown): FinEvent => ({ id: 'e', ts: 1, device: 'd', type: 'sub.patch', data: { cat: 'k-essen', id: 'k-essen-1', patch: { order } }, v: 1 });
    for (const bad of [Number.NaN, Infinity, '10', null, 1.5]) expect(validateEvent(ev(bad), S.state)).toMatch(/Reihenfolge/);
    expect(validateEvent(ev(30), S.state)).toBeNull();
  });
});
