import * as S from './store';
import * as db from './db';
import { applyTheme, mount, render, setResetTestApp, setTestActions } from './ui';
import { initSync, syncNow } from './sync';
import { IS_TEST } from './env';
import { seedSample } from './seed';

declare global {
  interface Window { finanzen?: { whenSaved: () => Promise<void>; eventCount: () => number; problems: () => string[]; sync: () => Promise<unknown> } }
}

// Für Tests und Fehlersuche
window.finanzen = { whenSaved: S.whenSaved, eventCount: () => S.info.eventCount, problems: () => S.info.problems, sync: () => syncNow() };

async function start() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  db.setOnBlocked(() => {
    document.getElementById('main')!.innerHTML = '<div class="card empty"><h2>Update wartet</h2><p>Die App ist noch in einem anderen Fenster offen. Schliess die anderen Fenster, dann geht es hier weiter.</p></div>';
  });
  await S.init();
  // Test-App: Beispieldaten laden und merken, welche Ereignisse dazu gehören (zum gezielten Löschen)
  const seed = async () => {
    const before = new Set((await db.allEvents()).map((e) => e.id));
    seedSample();
    await S.whenSaved();
    const known = new Set((await db.getMeta<string[]>('sampleEvents')) ?? []);
    for (const e of await db.allEvents()) if (!before.has(e.id)) known.add(e.id);
    await db.setMeta('sampleEvents', [...known]);
    await db.setMeta('sampleSeeded', true);
  };
  if (IS_TEST && !(await db.getMeta('sampleSeeded')) && S.state.tx.size === 0) await seed();
  setResetTestApp(async () => { await db.destroy(); location.reload(); });
  setTestActions({
    purge: async (o) => {
      const sample = new Set((await db.getMeta<string[]>('sampleEvents')) ?? []);
      const r = await S.purgeTestData(o, sample);
      if (o.sample) await db.setMeta('sampleEvents', []);
      return r;
    },
    reseed: seed,
    hasSample: async () => ((await db.getMeta<string[]>('sampleEvents')) ?? []).length > 0,
  });
  mount();
  try { await initSync(); } catch (err) { console.error(err); }
  render();
  void db.requestPersistence();
}

void start();
