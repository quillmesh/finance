# Testkonzept

Ziel: Jede Funktion ist mit vernünftigem Aufwand zuverlässig getestet, und keine neue Version kann echte Daten beschädigen.
Alle Tests laufen bei jedem Push in GitHub Actions; schlägt einer fehl, wird nichts veröffentlicht.

## Ebenen

| Ebene | Was | Wo | Werkzeug |
| --- | --- | --- | --- |
| Unit | Jede Regel einzeln, tabellengetrieben (ein Fall pro Buchungstyp, pro Sicht, pro Validierungsregel) | `tests/unit/*.test.ts` | `bun test` |
| Invarianten | Regeln, die immer gelten, mit vielen zufälligen Abläufen | `tests/unit/invarianten.test.ts` | eigener Zufallsgenerator mit Startwert |
| Alte Daten | Ereignis-Log jeder freigegebenen Version → erwarteter Zustand | `tests/unit/alte-daten/` | `bun test` |
| End-to-End | Hauptabläufe im Browser, Computer und Handy (Touch) | `e2e/*.spec.mjs` | Playwright Test |

## Invarianten (müssen immer gelten)

- Zweimal importieren = einmal importieren; Reihenfolge der Importe egal.
- Summe der Kategorien = Total der Ausgaben, in jeder Sicht; immer ganze Rappen.
- Alle Konten = Persönlich ohne Einzahlungen + Gemeinsam (jeder Franken genau einmal).
- Gleiche Ereignisse in beliebiger Reihenfolge → gleicher Zustand.
- Zwei Geräte mit zufälligen Änderungen und Abgleichen landen beim selben Zustand.
- Nach jeder Folge gültiger Änderungen meldet die Datenprüfung keine Probleme.

Fehlschlag wiederholen: `ZUFALL_SEED=<Zahl> bun test tests/unit/invarianten.test.ts`.

## Schutz vor korrupten Daten

- Beträge als ganze Rappen (`money.ts`), Prüfung bei jedem Ereignis.
- `validate.ts` prüft jede lokale Änderung vor dem Speichern; ein ungültiges Ereignis in einem Paket → keines wird gespeichert.
- Importierte Buchungen sind unveränderlich (Betrag, Datum, Konto) – auch gegenüber Ereignissen anderer Geräte.
- Ereignis-Log statt überschriebener Datei: nichts wird je gelöscht, jeder Stand bleibt rekonstruierbar.
- Eingefrorene Daten jeder Version (`scripts/alte-daten-einfrieren.ts`).

## Regeln

- Testnamen tragen die Anforderungs-ID (z. B. `TEI-03: …`).
- Neue Funktion → zuerst Test, der ohne die Änderung fehlschlägt. Gefundener Fehler → zuerst als Test nachstellen.
- Nur erfundene Daten, relativ zu heute. Keine festen Wartezeiten in End-to-End-Tests.
- Ziel: rund 90 % Abdeckung der Logik (`bun test --coverage`), keine Vorgabe für die Oberfläche.
