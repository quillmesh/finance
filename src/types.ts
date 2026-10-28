// Datenmodell der Finanz-App.
// Alle Beträge sind GANZE RAPPEN (TST-01): 12.50 CHF = 1250. Nie Kommazahlen speichern.

/** Bereich eines Kontos: Persönlich oder Gemeinsam (BER-01) */
export type Area = 'privat' | 'gemeinsam';
/** Geltungsbereich einer Kategorie (BER-03) */
export type Scope = Area | 'beide';
/**
 * Art einer Kategorie:
 * - expense:  normale Ausgabe
 * - transfer: Einzahlung aufs gemeinsame Konto (Ausgabe nur in der Sicht Persönlich, BER-02)
 * - income:   Einnahme (Lohn, Einzahlungen ins gemeinsame Konto)
 * - saving:   Sparen & Vorsorge (keine Ausgabe, separat ausgewiesen)
 */
export type Kind = 'expense' | 'transfer' | 'income' | 'saving';

export interface Account {
  id: string;
  name: string;
  area: Area;
  /** Bezeichnung für manuelle Einträge, z. B. „Bargeld“ oder „Partnerin“ */
  manualLabel: string;
  /** Stichwörter, an denen Abbuchungen der Kreditkarte erkannt werden (IMP-05). Ab 0.4.0. */
  cardWords?: string[];
  /** Kreditkarten dieses Kontos, maskiert „123456XXXXXX7890“; Import warnt bei fremder Karte (IMP-12). Ab 0.5.0. */
  cards?: string[];
}

export interface Sub { id: string; name: string; deleted?: boolean }

export interface Category {
  id: string;
  name: string;
  color: string;
  scope: Scope;
  kind: Kind;
  /** Reihenfolge (Tasten 1–0 beim Taggen) */
  order: number;
  subs: Sub[];
  deleted?: boolean;
  /** Standard-Anteil bei geteilten Ausgaben in Basispunkten (5000 = 50 %), null = Nur ich (TEI-07). Ab 0.2.0. */
  defaultShare?: number | null;
}

/** Herkunft einer Buchung */
export type Source = 'visa' | 'bank' | 'manual';
/** open = noch zu taggen, tagged = zugeordnet, excluded = zählt nirgends (Transfer, ignoriert) */
export type TxStatus = 'open' | 'tagged' | 'excluded';

export interface Tx {
  /** Stabile ID aus der Quelle (TransactionId, Ref.-Nr. oder Prüfsumme), pro Konto: Duplikate fallen weg (IMP-04) */
  id: string;
  acc: string;
  src: Source;
  /** YYYY-MM-DD */
  date: string;
  /** Rappen. Positiv = Ausgabe/Belastung, negativ = Gutschrift */
  amount: number;
  cur: string;
  origCur: string;
  merchant: string;
  details: string;
  place: string;
  status: TxStatus;
  cat: string | null;
  sub: string | null;
  note: string;
  /** Nur manuelle Einträge können gelöscht werden; importierte nie (TST-05) */
  deleted?: boolean;
  /**
   * Geteilte Ausgabe (TEI): mein Anteil in Basispunkten (10000 = 100 %, 5000 = 50 %, 6667 = ⅔).
   * Fehlt oder null = Nur ich. Gilt nur für Ausgaben auf Konten im Bereich Persönlich. Ab 0.2.0.
   */
  share?: number | null;
}

/**
 * Gelernter Vorschlag pro Konto + Händler. Ab 0.2.0 zusätzlich:
 * share = gelernter Anteil (5000 oder 6667, null = Nur ich); skip = Gutschriften dieses Absenders nicht erfassen (TEI-10).
 */
export interface Rule { cat: string; sub: string | null; share?: number | null; skip?: boolean }

export interface State {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  tx: Map<string, Tx>;
  rules: Map<string, Rule>;
}

/**
 * Jede Änderung ist ein unveränderliches Ereignis. Der Zustand entsteht durch Abspielen aller
 * Ereignisse in Zeitreihenfolge. So lassen sich Geräte ohne Konflikte zusammenführen.
 */
export type EventType =
  | 'tx.create'      // { tx }            Import oder manueller Eintrag; vorhandene ID → ignoriert
  | 'tx.patch'       // { id, patch }
  | 'cat.create'     // { cat }
  | 'cat.patch'      // { id, patch }
  | 'sub.create'     // { cat, sub }
  | 'sub.patch'      // { cat, id, patch }
  | 'rule.set'       // { key, rule }     rule = null → entfernt
  | 'rules.clear'    // {}
  | 'acc.patch';     // { id, patch }

export interface FinEvent {
  id: string;
  ts: number;
  device: string;
  type: EventType | (string & {});
  data: any;
  /** Format-Version der Ereignisse */
  v: number;
}
