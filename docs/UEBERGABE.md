# Übergabe

Zu Beginn jeder neuen Unterhaltung lesen, zusammen mit `CLAUDE.md`, `README.md` und `docs/TESTKONZEPT.md`.
Anforderungen und Feature-Liste: Dokument «Finanzapp – Anforderungen» im Claude-Projekt «Finanzapp» (Tabs «Anforderungen» und «Feature-Liste»).

## Stand (1.11.2026)

| | Branch | Version | Hinweis |
| --- | --- | --- | --- |
| Live | `main` | 0.7.0 | freigegeben 1.11.2026; Sync mit dem privaten Daten-Repo ist eingerichtet; der Nutzer importiert seine echten Daten selbst |
| Test | `test` | 0.9.0 | enthält 0.8.0 und 0.9.0, wartet auf «freigeben» |

Eingefrorene Daten: `tests/unit/alte-daten/v0.3.0*`, `v0.7.0*`. Nach der nächsten Freigabe: `bun scripts/alte-daten-einfrieren.ts <version>`
(das Skript erzeugt alle Ereignistypen; neue Ereignistypen dort ergänzen).

## Nächste Aufgaben

Keine offenen Aufträge. GUI-01, TAG-16 und KAT-07 sind in 0.9.0 umgesetzt (Entscheide unten), warten auf Prüfung und «freigeben».

Nicht weiterverfolgen (Entscheid des Nutzers): Textfeld bereits beim Tippen speichern; Kartenabbuchung auf dem gemeinsamen
Konto per Stichwort ausschliessen; Sicherheits-Ausbau (eigene Domain, App-Sperre, kurze Token-Laufzeit); Fremdwährungen.

## Versionen

- 0.1.0: Import (Kreditkarten-CSV, Bank-CSV, camt.053), Taggen mit Vorschlägen, Sichten Persönlich/Gemeinsam/Alle Konten, Export, manuelle Einträge,
  Kategorien bearbeiten, verschlüsseltes Backup, Rappen, Ereignis-Log mit Validierung, Solarized, Sync (nur Live), Test-App.
- 0.2.0: geteilte Ausgaben (`Tx.share` in Basispunkten, `logic.amountIn`), Gutschriften «Nicht erfassen» (Regel `skip`),
  Bargeld-Topf (`logic.cashPool`/`ledger`, Variante A), Notiz und neue Unterkategorie beim Taggen, kompaktes Taggen auf dem Handy.
- 0.3.0: Test-App gezielt löschen (`store.purgeTestData`, Beispiel-Ereignisse in Meta `sampleEvents`); App und Repo nennen keine Bank/Karte mehr.
- 0.4.0: Bank-CSV mit Sammelbuchungen (`parse/bankdetail.ts`), Stichwörter für Kartenabbuchungen pro Konto (`Account.cardWords`).
- 0.5.0: Kreditkarten-Abrechnung als PDF (`parse/pdf.ts` eigener Leser, `parse/cardpdf.ts`), IDs `<konto>:visa:pdf:<prüfsumme>-<n>`.
  Summenkontrolle pro Karte und Rechnungsbetrag, Rückfrage vor dem Import über `logic.importWarnings`
  (Summe IMP-10, Überschneidung CSV↔PDF nach Datum+Betrag IMP-11, Kartennummer pro Konto `Account.cards` IMP-12, nur maskiert).
  Test-PDFs: `tests/pdf-bauen.mjs` (erfunden). Fremdwährungen: es zählt der CHF-Betrag.
- 0.6.0: Import-Historie (`State.imports`/`importOf`, Ereignis `import.log` vor den `tx.create`; ältere Importe werden beim Abspielen
  rekonstruiert: gleiches Gerät + Konto, Abstand ≤ `AUTO_IMPORT_GAP_MS`), `logic.importHistory`. Ereignis `tx.remove`
  (ganzer Import IMP-14, alle ungetaggten IMP-15) entfernt Buchungen aus dem Zustand; erneuter Import legt sie wieder an.
- 0.7.0: Papierkorb (`tx.trash`/`tx.restore`, `Tx.trashedAt`, `logic.trashList`; 30 Tage nur über die Uhr, keine Ereignisse beim Ablauf);
  gelöschte Buchungen in einem neuen Import → Rückfrage (`logic.deletedInFile`). Untaggen `store.untagTx`. Wischen: `ui.swipeRows`.
  Diagramm → Liste: `logic.sliceTx`. Unterkategorien: eindeutige Namen (validate), Verweise auf gelöschte werden im Reducer zu
  «ohne» (KAT-05); Vorschläge bleiben unverändert (alte Daten!), UI nutzt `liveSubId`.
- 0.8.0: Unterkategorie löschen mit Auswahl «Neu taggen» / «Ohne Unterkategorie lassen» (`store.deleteSub(cat, id, retag)`, KAT-06).
- 0.9.0: TAG-16 festes Raster `logic.tagGrid` (alle Kategorien nach `order`, `enabled` = `catsFor`, Tasten 1–0 an Platz 1–10, Plätze 11+
  ohne Taste – Entscheid des Nutzers). Aufteilungs-Zeile mit fester Höhe (`.shareline`); ohne Aufteilung (gemeinsames Konto) dieselben
  Elemente unsichtbar und `inert` (`.sharebox.ghost`), damit die Kategorien überall gleich hoch stehen; Vorschlagsplatz `.suggestslot`
  fest, ohne Vorschlag leer (Entscheid). Gutschriften haben zusätzlich die Box «Nicht erfassen» und stehen daher tiefer.
  KAT-07: Kategorien-Karte zu, «Kategorien bearbeiten» öffnet alle (Entscheid: nicht einzeln aufklappbar), «Fertig» schliesst.
  GUI-01: Raster `.cehead`/`.cefields`, `--ctl` 40 px für Felder in Formularen und Dialogen; Prüfung `layoutProbleme` in
  `e2e/hilfen.mjs` (Überlappung, Mindestabstand 4 px, abgeschnittener Text in Auswahl/Knöpfen, gleiche Höhe pro Zeile, kein
  Querscrollen) in `e2e/layout.spec.mjs` für Handy 360/390, Android 412, Tablet hoch/quer, Computer, alle Tabs und Dialoge.
  Überlappungen waren in Chrome auf Tablet-Grösse und auf Android sichtbar.

## Anforderungs-IDs

Belegt: IMP-01–15, TAG-01–15, KAT-01–06, AUS-01–07, BER-01–08, TEI-01–11, BAR-01–06, EXP-01–02, EIN-01–02, DAT-01–02, NF-01–08,
UMG-01–05, TST-01–08, LAB-01–03, BUD-01–02, FIX-01–02, MUL-01–02, BEL-01. Neu in 0.9.0: GUI-01, TAG-16, KAT-07 (TAG-01–16, KAT-01–07).
Im Anforderungsdokument nachführen (Tab Anforderungen + Zeile in der Feature-Liste mit Status «Offen/Im Test/Live» und Version).

## Arbeitsumgebung (für Claude)

- Repo lokal: `/home/claude/finance`, immer auf Branch `test` arbeiten.
- Tests: `PATH=/opt/npm-tools/node_modules/.bin:$PATH PLAYWRIGHT_MODULE=/opt/npm-tools/node_modules/playwright/package.json tests/run.sh` (Typen, Unit, End-to-End); einzeln `tests/run.sh --nur-e2e <name>`.
  Playwright liegt unter `/opt/npm-tools/node_modules/playwright` (Symlink in `node_modules`), Chromium ist vorinstalliert.
- Pushes starten den Workflow nicht von selbst: `gh workflow run -R quillmesh/finance veroeffentlichen.yml --ref test`
  (bzw. `--ref main` nach einer Freigabe), dann `gh run list` abwarten. GitHub Pages: Quelle «GitHub Actions».
- Die veröffentlichten Seiten (github.io) sind aus der Arbeitsumgebung meist nicht abrufbar; Prüfung über den Workflow-Erfolg
  und lokal mit `scripts/build-site.sh` + `python3 -m http.server`.
- Screenshots für Gestaltungsvorschläge: Playwright gegen die lokal gebaute Test-App (erfundene Beispieldaten), an den Nutzer senden.
- Datenschutz: echte Dateien des Nutzers nur lokal lesen, nie ins Repo, nie in Tests. Vor jedem Commit Repo nach Namen,
  Orten, Karten- und Kontonummern aus echten Dateien durchsuchen; Testorte erfinden (keine realen Orte aus der Region des Nutzers).
