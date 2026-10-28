// Ausgangszustand: Konten und Standard-Kategorien mit FESTEN IDs.
// Feste IDs sind wichtig: Jedes Gerät startet mit denselben Kategorien, ohne dass Ereignisse
// nötig sind. Änderungen daran sind normale Ereignisse (cat.patch, sub.create …).
// Bestehende IDs hier NIE ändern oder entfernen – sonst zeigen alte Buchungen ins Leere.
import type { Account, Category, Kind, Scope } from './types';

/** Solarized-Akzentfarben (gut lesbar auf hellem und dunklem Grund) */
export const SOLARIZED = {
  yellow: '#b58900', orange: '#cb4b16', red: '#dc322f', magenta: '#d33682',
  violet: '#6c71c4', blue: '#268bd2', cyan: '#2aa198', green: '#859900',
  base01: '#586e75', base0: '#839496', base1: '#93a1a1',
} as const;
export const PALETTE = Object.values(SOLARIZED);

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'privat', name: 'Privat', area: 'privat', manualLabel: 'Bargeld' },
  { id: 'gemeinsam', name: 'Gemeinsam', area: 'gemeinsam', manualLabel: 'Partnerin' },
];

type Def = [id: string, name: string, scope: Scope, kind: Kind, color: string, subs: string[]];
const C = SOLARIZED;
const DEFS: Def[] = [
  ['k-haushalt', 'Gemeinsamer Haushalt', 'privat', 'transfer', C.cyan, ['Einzahlung gemeinsames Konto']],
  ['k-essen', 'Essen & Ausgang', 'privat', 'expense', C.orange, ['Restaurant', 'Kantine & Take-away', 'Bar', 'Café & Bäckerei']],
  ['k-ferien', 'Ferien privat', 'privat', 'expense', C.violet, ['Unterkunft', 'Flug & Transport', 'Essen & Trinken', 'Aktivitäten']],
  ['k-hobby', 'Hobby', 'privat', 'expense', C.base1, ['Gleitschirmfliegen', 'Sport', 'Ausrüstung']],
  ['k-persoenlich', 'Persönliches', 'privat', 'expense', C.magenta, ['Kleidung', 'Coiffeur', 'Gesundheit']],
  ['k-abos', 'Abos & Kommunikation', 'privat', 'expense', C.blue, ['Handy', 'Streaming', 'Software']],
  ['k-steuern', 'Steuern & Versicherungen', 'privat', 'expense', C.red, ['Steuern', 'Versicherungen', 'Krankenkasse']],
  ['k-sparen', 'Sparen & Vorsorge', 'privat', 'saving', C.green, ['Säule 3a', 'Sparkonto']],
  ['k-einnahmen', 'Einnahmen', 'privat', 'income', C.base01, ['Lohn', 'Rückerstattung', 'Diverses']],
  ['k-wohnen', 'Wohnen', 'gemeinsam', 'expense', C.magenta, ['Miete', 'Nebenkosten', 'Einrichtung', 'Abgaben & Versicherung']],
  ['k-einzahlungen', 'Einzahlungen', 'gemeinsam', 'income', C.base01, ['Ich', 'Partnerin']],
  ['k-auto', 'Auto', 'beide', 'expense', C.yellow, ['Benzin', 'Service & Reparatur', 'Parkieren', 'Versicherung & Steuern']],
  ['k-einkaufen', 'Einkaufen', 'beide', 'expense', C.green, ['Lebensmittel', 'Drogerie', 'Haushalt']],
  ['k-freizeit', 'Freizeit & Ausflüge', 'beide', 'expense', C.base0, ['Ausflüge', 'Restaurant', 'Kultur']],
  ['k-sonstiges', 'Sonstiges', 'beide', 'expense', C.base01, ['Gebühren', 'Spenden & Mitgliedschaften', 'Diverses']],
  // 0.2.0: Bargeldbezüge (BAR-02). Manuelle Bargeldausgaben werden davon abgezogen.
  ['k-bargeld', 'Bargeld', 'beide', 'expense', C.base1, ['Nicht zugeordnet']],
];

/** Kategorie und Unterkategorie für Bargeldbezüge (BAR-02) */
export const CASH_CAT = 'k-bargeld';
export const CASH_SUB = 'k-bargeld-1';
/** Anteile in Basispunkten (TEI-02) */
export const FULL = 10000;
export const SHARE_PRESETS = [5000, 6667];

export function defaultCategories(): Category[] {
  return DEFS.map(([id, name, scope, kind, color, subs], i) => ({
    id, name, scope, kind, color, order: (i + 1) * 10,
    subs: subs.map((s, j) => ({ id: `${id}-${j + 1}`, name: s })),
  }));
}

export const AREA_LABEL: Record<Scope, string> = { privat: 'Persönlich', gemeinsam: 'Gemeinsam', beide: 'Beide' };
export const KIND_LABEL: Record<Kind, string> = {
  expense: 'Ausgabe', transfer: 'Einzahlung aufs gemeinsame Konto', income: 'Einnahme', saving: 'Sparen (keine Ausgabe)',
};
