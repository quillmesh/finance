// TST-02: Daten jeder freigegebenen Version bleiben lesbar.
// Für jede eingefrorene Version (tests/unit/alte-daten/v<x.y.z>.json) muss die aktuelle App aus dem
// Ereignis-Log den damals gespeicherten Zustand bauen: Buchungen, Vorschläge und Konten genau gleich,
// jede damalige Kategorie unverändert. Neu hinzugekommene Standard-Kategorien sind erlaubt. Neue Version einfrieren:
//   bun scripts/alte-daten-einfrieren.ts <version>
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { buildState } from '../../src/store';
import { validateState } from '../../src/validate';
import { snapshot } from './snapshot';

const DIR = 'tests/unit/alte-daten';
const versions = readdirSync(DIR).filter((f) => /^v\d+\.\d+\.\d+\.json$/.test(f)).map((f) => f.slice(1, -5));

describe('Alte Daten', () => {
  test('mindestens eine Version eingefroren', () => { expect(versions.length).toBeGreaterThan(0); });
  test.each(versions)('v%s wird unverändert gelesen', (v) => {
    const events = JSON.parse(readFileSync(`${DIR}/v${v}.json`, 'utf8'));
    const want = JSON.parse(readFileSync(`${DIR}/v${v}.erwartet.json`, 'utf8'));
    const st = buildState(events);
    const now = JSON.parse(snapshot(st));
    expect(now.tx).toEqual(want.tx);
    expect(now.rules).toEqual(want.rules);
    expect(now.accounts).toEqual(want.accounts);
    for (const c of want.categories) expect(now.categories.find((x: { id: string }) => x.id === c.id), `Kategorie ${c.id}`).toEqual(c);
    expect(validateState(st)).toEqual([]);
  });
});
