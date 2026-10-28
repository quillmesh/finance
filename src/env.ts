// Umgebung: „live“ (echte Daten, Sync) oder „test“ (Beispieldaten, kein Sync).
// Wird beim Bauen festgelegt (FIN_ENV=test bun run build.mjs). Beide Apps liegen auf derselben
// Domain und teilen sich den Browser-Speicher. Deshalb trennt diese Datei alles, was im Browser
// gespeichert wird. Änderungen nur zusammen mit e2e/umgebungen.spec.mjs.

declare const __APP_ENV__: string;

export type Env = 'live' | 'test';
export const ENV: Env = typeof __APP_ENV__ === 'string' && __APP_ENV__ === 'test' ? 'test' : 'live';
export const IS_TEST = ENV === 'test';

/** Name der lokalen Datenbank */
export const DB_NAME = IS_TEST ? 'finanzen-test' : 'finanzen';

/** Schlüssel für localStorage */
export const storageKey = (name: string) => (IS_TEST ? `test:${name}` : name);
