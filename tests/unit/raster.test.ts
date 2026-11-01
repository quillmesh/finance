// TAG-16: Kategorien beim Taggen immer am selben Ort, nicht gültige ausgegraut
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import { catsFor, sortedCategories, tagGrid } from '../../src/logic';
import { frisch } from './hilfen';

beforeEach(frisch);

const ids = (g: ReturnType<typeof tagGrid>) => g.map((x) => x.cat.id);

describe('TAG-16: festes Raster', () => {
  test('alle Kategorien in fester Reihenfolge, unabhängig von Konto und Aufteilung', () => {
    const alle = sortedCategories(S.state).map((c) => c.id);
    expect(ids(tagGrid(S.state, 'privat'))).toEqual(alle);
    expect(ids(tagGrid(S.state, 'privat', true))).toEqual(alle);
    expect(ids(tagGrid(S.state, 'gemeinsam'))).toEqual(alle);
  });
  test.each([['privat', false], ['privat', true], ['gemeinsam', false]] as const)('wählbar genau wie bisher (%s, geteilt %p)', (acc, shared) => {
    const ok = catsFor(S.state, acc, shared).map((c) => c.id);
    expect(tagGrid(S.state, acc, shared).filter((x) => x.enabled).map((x) => x.cat.id)).toEqual(ok);
  });
  test('Wohnen: ausgegraut bei «Nur ich», wählbar wenn geteilt, gleicher Platz', () => {
    const a = tagGrid(S.state, 'privat'), b = tagGrid(S.state, 'privat', true);
    const i = a.findIndex((x) => x.cat.id === 'k-wohnen');
    expect(a[i].enabled).toBe(false);
    expect(b[i].cat.id).toBe('k-wohnen');
    expect(b[i].enabled).toBe(true);
  });
  test('Tasten 1–0 gehören zu den Plätzen 1–10, auch wenn ausgegraut', () => {
    const g = tagGrid(S.state, 'gemeinsam');
    expect(g.map((x) => x.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ...Array(g.length - 10).fill(null)]);
    expect(g[0].enabled).toBe(false);
  });
  test('gelöschte Kategorien fehlen, neue kommen nach ihrer Reihenfolge dazu', () => {
    S.deleteCategory('k-hobby');
    const id = S.createCategory({ name: 'Velo', scope: 'gemeinsam' });
    const g = ids(tagGrid(S.state, 'privat'));
    expect(g).not.toContain('k-hobby');
    expect(g.at(-1)).toBe(id);
    expect(tagGrid(S.state, 'privat').at(-1)!.enabled).toBe(false);
  });
});
