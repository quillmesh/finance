// Friert die Daten einer freigegebenen Version ein (TST-02): Ereignis-Log + erwarteter Zustand.
// Aufruf nach jeder Freigabe:  bun scripts/alte-daten-einfrieren.ts <version>
// Die Dateien landen in tests/unit/alte-daten/ und werden eingecheckt. Der Test alte-daten.test.ts
// prüft danach bei jedem Lauf, dass die aktuelle App diese Daten unverändert lesen kann.
// Die Daten sind erfundene Beispieldaten (Generator), nie echte.
import { writeFileSync } from 'node:fs';
import * as S from '../src/store';
import * as db from '../src/db';
import { seedSample } from '../src/seed';
import { snapshot } from '../tests/unit/snapshot';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('Aufruf: bun scripts/alte-daten-einfrieren.ts <version>'); process.exit(1); }

db.resetMemoryForTests(); S.resetForTests(); await S.init();
seedSample(new Date(2026, 9, 23));
// Möglichst viele Ereignistypen abdecken
const open = [...S.state.tx.values()].filter((t) => t.status === 'open');
S.patchTx(open[0].id, { status: 'excluded', note: 'Manuell ignoriert' });
S.patchCategory('k-hobby', { name: 'Hobbys', color: '#6c71c4' });
S.moveCategory('k-ferien', -1);
const cat = S.createCategory({ name: 'Kinder', scope: 'beide' });
const sub = S.addSub(cat, 'Kleider');
S.renameSub(cat, sub, 'Kleidung');
S.deleteSub('k-essen', 'k-essen-4');
S.patchAccount('gemeinsam', { manualLabel: 'Anna' });
const m = S.addManual({ acc: 'privat', date: '2026-10-20', amount: 990, merchant: 'Kiosk', cat: 'k-essen', sub: null });
S.deleteManual(m);
S.setRule('privat|test', { cat: 'k-essen', sub: null });
S.setRule('privat|test', null);
await S.whenSaved();
const events = await db.allEvents();
writeFileSync(`tests/unit/alte-daten/v${version}.json`, JSON.stringify(events, null, 1) + '\n');
writeFileSync(`tests/unit/alte-daten/v${version}.erwartet.json`, snapshot(S.state) + '\n');
console.log(`Eingefroren: v${version} (${events.length} Ereignisse)`);
