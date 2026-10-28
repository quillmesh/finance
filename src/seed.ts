// Test-App: beim ersten Start mit erfundenen Beispieldaten füllen.
// Importiert die Beispieldateien über denselben Weg wie echte Dateien und taggt rund drei Viertel davon.
import * as S from './store';
import { parseFile } from './parse';
import { ruleKey } from './logic';
import { SAMPLE_SEED, SAMPLE_TAGS, sampleBankGemeinsamCSV, sampleBankPrivatCSV, sampleCardCSV } from './sample';

export function sampleFiles(today = new Date()) {
  return [
    { name: 'beispiel-karte-privat.csv', acc: 'privat', text: sampleCardCSV(SAMPLE_SEED, today) },
    { name: 'beispiel-bank-privat.csv', acc: 'privat', text: sampleBankPrivatCSV(SAMPLE_SEED + 1, today) },
    { name: 'beispiel-bank-gemeinsam.csv', acc: 'gemeinsam', text: sampleBankGemeinsamCSV(SAMPLE_SEED + 2, today) },
  ];
}

export function seedSample(today = new Date()) {
  for (const f of sampleFiles(today)) { const r = parseFile(f.text, f.acc); S.importTx(r.tx, { name: f.name, format: r.format }); }
  // Alles ausser dem laufenden Monat taggen (der bleibt zum Ausprobieren offen)
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const groups = new Map<string, { ids: string[]; cat: string; sub: string; key: string }>();
  for (const t of S.state.tx.values()) {
    if (t.status !== 'open' || t.date.startsWith(month)) continue;
    const hit = SAMPLE_TAGS.find(([re]) => re.test(t.merchant));
    if (!hit) continue;
    const [, cat, n] = hit;
    const c = S.state.categories.get(cat);
    const scopeOk = c && (c.scope === 'beide' || c.scope === S.state.accounts.get(t.acc)?.area);
    if (!scopeOk) continue;
    const key = ruleKey(t);
    const g = groups.get(key + cat) ?? { ids: [], cat, sub: `${cat}-${n}`, key };
    g.ids.push(t.id);
    groups.set(key + cat, g);
  }
  for (const g of groups.values()) S.tagTx(g.ids, g.cat, g.sub, g.key);
  // Manuelle Einträge: Bargeld privat, Ausgabe der Partnerin gemeinsam
  const d = (back: number) => { const x = new Date(today.getFullYear(), today.getMonth() - 1, Math.max(1, Math.min(28, today.getDate() - back))); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  S.addManual({ acc: 'privat', date: d(3), amount: 2450, merchant: 'Wochenmarkt', cat: 'k-einkaufen', sub: 'k-einkaufen-1' });
  S.addManual({ acc: 'gemeinsam', date: d(6), amount: 7800, merchant: 'Tankstelle (Anna)', cat: 'k-auto', sub: 'k-auto-1' });
}
