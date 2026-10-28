# Finanzen

Persönliche Web-App, um Ausgaben aus Kreditkarte (CSV, PDF-Abrechnung), Bankkonto (CSV, camt.053) und Bargeld zu taggen und auszuwerten.
Läuft komplett im Browser. Kontoauszüge werden nur lokal gelesen; zwischen Geräten wird ausschliesslich verschlüsselt synchronisiert.

- **Live:** https://quillmesh.github.io/finance/ – echte Daten, Sync mit einem privaten Repository
- **Test:** https://quillmesh.github.io/finance/test/ – erfundene Beispieldaten, kein Sync

## Aufbau

| Ordner/Datei | Inhalt |
| --- | --- |
| `src/parse/` | Import: Kreditkarten-CSV und -PDF (eigener PDF-Leser mit Summenkontrolle), Bank-CSV, camt.053 (eigener XML-Leser) |
| `src/money.ts` | Beträge in ganzen Rappen |
| `src/store.ts` | Ereignis-Log → Zustand, alle Änderungen |
| `src/validate.ts` | Prüfungen vor jedem Speichern und nach dem Laden |
| `src/logic.ts` | Sichten Persönlich / Gemeinsam / Alle Konten, Auswertung, Export |
| `src/sync.ts`, `src/crypto.ts` | Verschlüsselter Sync (AES-256-GCM, PBKDF2) über die GitHub-API |
| `src/sample.ts`, `src/seed.ts` | Erfundene Beispieldaten für die Test-App |
| `src/ui.ts` | Oberfläche (rechnet nichts selbst) |
| `tests/unit/` | Unit-Tests, Zufallstests, eingefrorene alte Daten |
| `e2e/` | End-to-End-Tests im Browser |

## Entwickeln

```
bun run build.mjs                 # Live-App nach dist/
FIN_ENV=test bun run build.mjs    # Test-App
scripts/build-site.sh             # beide nach site/ (wie GitHub Pages)
tests/run.sh                      # Typen, Unit-Tests, End-to-End
```

## Regeln für Erweiterungen

1. **Ereignisse werden nie geändert oder gelöscht**, nur neue angehängt. Der Zustand entsteht durch Abspielen aller Ereignisse.
2. **Neue Felder sind optional** und bekommen in `normalizeTx`/`normalizeCategory` einen Standardwert. Unbekannte Felder bleiben erhalten.
3. **Felder werden nie umbenannt** oder in ihrer Bedeutung geändert. Stattdessen ein neues Feld.
4. **Unbekannte Ereignistypen** werden übersprungen, aber gespeichert und weiter synchronisiert.
5. **IDs aus `src/defaults.ts` nie ändern** (Konten, Standard-Kategorien, Unterkategorien).
6. **Beträge immer in Rappen.**
7. **Importierte Buchungen bleiben wie im Auszug:** Betrag, Datum und Konto sind unveränderlich, löschen geht nicht.
8. Nach jeder freigegebenen Version die Daten einfrieren: `bun scripts/alte-daten-einfrieren.ts <version>`.

## Sync einrichten (Live)

1. Privates, leeres Repository anlegen, z. B. `finance-data`.
2. Fine-grained Personal Access Token: nur dieses Repository, Berechtigung „Contents: Read and write“, mit Ablaufdatum.
3. In der App unter Einstellungen → Synchronisation eintragen und eine Passphrase festlegen (mind. 12 Zeichen, im Passwortmanager aufbewahren).
   Ohne Passphrase sind die Daten im Repository nicht lesbar – auch nicht für dich.
