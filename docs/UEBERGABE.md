# Übergabe

## Stand 0.6.0 (Test)
- 0.1.0: Import (Kreditkarten-CSV, Bank-CSV, camt.053), Taggen mit Vorschlägen, Sichten Persönlich/Gemeinsam/Alle Konten, Export, manuelle Einträge,
  Kategorien bearbeiten, verschlüsseltes Backup, Rappen, Ereignis-Log mit Validierung, Solarized, Sync (nur Live), Test-App.
- 0.2.0: geteilte Ausgaben (`Tx.share` in Basispunkten, `logic.amountIn`), Gutschriften «Nicht erfassen» (Regel `skip`),
  Bargeld-Topf (`logic.cashPool`/`ledger`, Variante A), Notiz und neue Unterkategorie beim Taggen, kompaktes Taggen auf dem Handy.
- 0.3.0: Test-App gezielt löschen (`store.purgeTestData`, Beispiel-Ereignisse in Meta `sampleEvents`); App und Repo nennen keine Bank/Karte mehr.
  Eingefrorene Daten neu ab 0.3.0 (0.1.0 war nie live).
- 0.4.0: Bank-CSV mit Sammelbuchungen (`parse/bankdetail.ts`), Stichwörter für Kartenabbuchungen pro Konto (`Account.cardWords`).
- 0.5.0: Kreditkarten-Abrechnung als PDF (`parse/pdf.ts` eigener Leser, `parse/cardpdf.ts`), IDs `<konto>:visa:pdf:<prüfsumme>-<n>`.
  Summenkontrolle pro Karte und Rechnungsbetrag (`check`), Rückfrage vor dem Import über `logic.importWarnings`
  (Summe IMP-10, Überschneidung CSV↔PDF nach Datum+Betrag IMP-11, Kartennummer pro Konto `Account.cards` IMP-12, nur maskiert).
  Test-PDFs: `tests/pdf-bauen.mjs` (erfunden). Fremdwährungen: bewusst nicht behandelt, es zählt der CHF-Betrag.
- 0.6.0: Import-Historie (`State.imports`/`importOf`, Ereignis `import.log` vor den `tx.create`; ältere Importe werden beim Abspielen
  rekonstruiert: gleiches Gerät + Konto, Abstand ≤ `AUTO_IMPORT_GAP_MS`), `logic.importHistory`. Löschen: Ereignis `tx.remove`
  (ganzer Import IMP-14 mit `imp`, alle ungetaggten IMP-15) entfernt Buchungen aus dem Zustand; erneuter Import legt sie wieder an.
- Git-Historie am 24.10. und 28.10.2026 bereinigt. GitHub Pages: Quelle «GitHub Actions».
- Live (`main`) zeigt noch den Platzhalter; erste Freigabe steht aus. Nach der Freigabe Daten einfrieren (`bun scripts/alte-daten-einfrieren.ts <version>`).
- Workflow startet nach Pushes bisher nicht automatisch; bei Bedarf `gh workflow run veroeffentlichen.yml --ref test`.

## Offen (siehe Feature-Liste im Anforderungsdokument)
- Import-Vorschau (IMP-06), Labels (LAB-01–03, AUS-04), Filter nach einzelnen Konten (BER-06), Backup vor Migrationen (TST-04),
  Leistung mit 10 Jahren Daten (NF-08), Sparquote, Budgets, Fixkosten, Aufteilen, Offline/Service Worker, Zusammenfassen alter Sync-Pakete.
