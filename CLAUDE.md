# Hinweise für Claude

Persönliche Finanz-App „Finanzen“ des Nutzers: Ausgaben aus Kreditkarte, Bankkonten und Bargeld taggen und auswerten.
Sprache: Deutsch (Schweiz, „ss“ statt „ß“ in UI-Texten). Anforderungen: Dokument „Finanzapp – Anforderungen“ im Claude-Projekt „Finanzapp“.

Zu Beginn einer neuen Unterhaltung auch `docs/UEBERGABE.md` lesen (Stand, offene Punkte, Entscheidungen).

## Zusammenarbeit (Wunsch des Nutzers, gilt immer)
- **Nichts annehmen und umsetzen, ohne zu fragen.** Ist etwas unklar oder gibt es mehrere sinnvolle Lösungen, zuerst nachfragen.
- Sagt der Nutzer „nur auflisten“ oder „aufschreiben“: nur als Anforderung formulieren, **nicht umsetzen**.
- Bei Gestaltungsfragen zuerst Vorschläge als Screenshots zeigen; umsetzen erst nach OK.
- **Privacy:** Echte Auszüge, Namen, Kontonummern, Beträge des Nutzers nie ins Repo (es ist öffentlich), nie in Tests, nie in Logs.
  Testdaten immer erfinden (`src/sample.ts`, Hilfen in `tests/unit/hilfen.ts` und `e2e/hilfen.mjs`).
- **Anonym:** Im Repo, in Commit-Nachrichten und in der App nie die Bank, den Kartenherausgeber, Wohnort/Region, Arbeitgeber
  oder andere Hinweise auf den Nutzer nennen. Formate neutral benennen («Kreditkarten-CSV», «Bank-CSV»), Orte und Namen in Testdaten erfinden.

## Vor jeder Änderung
- README-Abschnitt „Regeln für Erweiterungen“ einhalten. Der Nutzer arbeitet mit echten Daten weiter; **jede Änderung muss alte Daten lesen können**.
- Beträge immer in ganzen Rappen (`src/money.ts`), nie Kommazahlen speichern.
- Neue Felder: optional + Standardwert in `normalizeTx`/`normalizeCategory`. Nie Felder umbenennen, nie Ereignisse ändern. IDs in `src/defaults.ts` nie ändern.
- Jede lokale Änderung läuft über `store.ts` und wird von `validate.ts` geprüft; neue Ereignistypen dort ergänzen.
- Keine externen Abhängigkeiten zur Laufzeit; CSP in `build.mjs` nicht lockern (keine Inline-Styles: `data-bg`/`data-w` + `paint()`).

## Tests (Pflicht) – Aufbau und Begründung in `docs/TESTKONZEPT.md`
- Logik in `src/logic.ts`, `store.ts`, `parse/*` usw., nicht in `ui.ts`, damit sie ohne Browser testbar ist.
- Jede Anforderung hat Tests mit ihrer ID im Namen (z. B. `BER-08: …`). Neue Funktion → zuerst Test, der ohne die Änderung fehlschlägt.
- Unit: `tests/unit/*.test.ts` (`bun test`). Zufallsregeln: `tests/unit/invarianten.test.ts` – neue Regel dort ergänzen.
- End-to-End: `e2e/*.spec.mjs` (Playwright Test), Handy mit `tap()` und Gerät `HANDY`. Daten relativ zu heute, keine festen Wartezeiten.
- Alte Daten: nach jeder freigegebenen Version `bun scripts/alte-daten-einfrieren.ts <version>` und die Dateien einchecken.
- Jeder gefundene Fehler: zuerst als Test nachstellen, dann beheben.

## Umgebungen
- **Live** = Branch `main` → https://quillmesh.github.io/finance/ (echte Daten, Sync mit privatem Repo `finance-data`)
- **Test** = Branch `test` → https://quillmesh.github.io/finance/test/ (eigene Datenbank, Beispieldaten, **kein Sync**)
- Alles im Browser Gespeicherte ist über `src/env.ts` getrennt. Daran nichts ändern, ohne `e2e/umgebungen.spec.mjs` zu erweitern.

## Ablauf
1. Ändern **auf Branch `test`**, dann `tests/run.sh` (Typen + Unit + End-to-End; alle müssen bestehen).
2. Version in `package.json` erhöhen (Patch für Korrekturen, Minor für Funktionen) und in `RELEASE-NOTES.md` einen Abschnitt `## <Version>` in Worten des Nutzers (Unit-Test prüft es).
3. Commit und `git push origin test` → GitHub testet und veröffentlicht nur die **Test-App**.
4. Nutzer prüft in der Test-App. **Erst wenn er „freigeben“ schreibt:** `git checkout main && git merge --ff-only test && git push origin main`.
5. Nie direkt auf `main` entwickeln.

## Nie
- Nutzerdaten, Tokens oder Passphrasen ins Repo oder in Logs.
- Das Daten-Repo `finance-data` anfassen (gehört nur der App).
