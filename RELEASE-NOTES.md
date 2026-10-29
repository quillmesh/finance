# Release-Notes

## 0.7.0
- Übersicht: Nach dem Klick auf eine Kategorie (Tabelle oder Kuchendiagramm) zeigt «Transaktionen anzeigen» alle Buchungen dazu, für die gewählte Sicht und den Zeitraum. Ein Tipp auf eine Unterkategorie zeigt nur deren Buchungen.
- Transaktionen: einzelne Buchungen wieder ungetaggt machen oder in den Papierkorb legen – auf dem Handy nach links wischen und bestätigen, am Computer im Bearbeiten-Dialog.
- Papierkorb unter Einstellungen: gelöschte Buchungen 30 Tage lang zurückholen, danach endgültig gelöscht. Kommt eine gelöschte Buchung in einem späteren Import wieder vor, fragt die App, ob sie weggelassen oder wieder aufgenommen werden soll.
- Unterkategorien: Umbenennen auf einen Namen, den es in der Kategorie schon gibt, wird abgelehnt. Wird eine Unterkategorie auf einem Gerät gelöscht und auf einem anderen gleichzeitig noch verwendet, landen die Buchungen nach dem Sync sauber «ohne Unterkategorie».

## 0.6.0
- Import-Historie: Im Import-Tab zeigt «Import-Historie anzeigen» die letzten 5 Importe mit Datei, Konto, Bereich, Zeitraum und wie viele Buchungen getaggt und ungetaggt sind. Frühere Importe werden aus den gespeicherten Daten erkannt.
- Einen ganzen Import löschen, z. B. eine falsch hochgeladene Abrechnung – auch aus der Historie. Sind Buchungen daraus schon getaggt, warnt die App vorher. Wird dieselbe Datei später wieder importiert, kommen die Buchungen ungetaggt zurück.
- Einstellungen → Daten löschen: alle Importe mit Löschen-Knopf und «Alle ungetaggten Einträge löschen». Getaggte, ausgeschlossene und manuelle Einträge bleiben.
- Gilt in Live und Test; über den Sync auch auf den anderen Geräten.

## 0.5.0
- Kreditkarten-Abrechnung als PDF importieren. Die App liest das PDF selbst, ohne fremde Bibliothek; es wird nirgends hochgeladen. Übernommen werden Datum, Händler, Ort, Branche und Betrag, auch Gebühren und mehrere Karten pro Abrechnung. Die Zahlung der letzten Rechnung wird ausgeschlossen.
- Summenkontrolle: Die gelesenen Buchungen werden mit «Total Karte» und dem Rechnungsbetrag verglichen. Stimmt etwas nicht, zeigt die App die Differenz und fragt, ob trotzdem importiert werden soll.
- Warnung, wenn ein Monat schon aus der Kreditkarten-CSV da ist und dieselben Buchungen (Datum und Betrag) nochmals aus dem PDF kommen – und umgekehrt.
- Kreditkarten pro Konto hinterlegen (Einstellungen → Konten, z. B. 1234 56XX XXXX 7890). Gehört die Karte einer Datei zu einem anderen Konto, fragt die App vor dem Import nach. Gespeichert werden nur die ersten sechs und die letzten vier Ziffern.

## 0.4.0
- Import für Bank-CSV mit Sammelbuchungen (Semikolon): Daueraufträge mit mehreren Posten werden in einzelne Buchungen aufgeteilt, Einkäufe mit der Debitkarte zeigen den Händler.
- Pro Konto lassen sich Stichwörter festlegen, an denen Abbuchungen der Kreditkarte erkannt und ausgeschlossen werden (Einstellungen → Konten).

## 0.3.0
- Test-App: unter Einstellungen auswählen, was gelöscht wird – Beispieldaten, eigene Importe, manuelle Einträge, Vorschläge, Kategorien. Beispieldaten lassen sich wieder laden.
- Die App nennt keine Bank und keinen Kartenherausgeber mehr; Formate heissen neutral «Kreditkarten-CSV» und «Bank-CSV».

## 0.2.0
- Geteilte Ausgaben: Beim Taggen «Nur ich», «50 %», «⅔ ich» oder «Individuell» wählen (Taste T). Persönlich zählt nur dein Anteil, Gemeinsam und Alle Konten den vollen Betrag. Der Anteil wird pro Händler gelernt; pro Kategorie lässt sich ein Standard festlegen.
- Gutschriften wie Rückzahlungen mit einem Tipp «Nicht erfassen», auf Wunsch immer für diesen Absender.
- Bargeld: Bezüge zählen als «Bargeld › Nicht zugeordnet». Erfasste Bargeldausgaben werden davon abgezogen und zählen im Monat des Bezugs. Unter «Manuell» siehst du, wie viel Bargeld noch nicht zugeordnet ist.
- Beim Taggen eine Notiz hinzufügen (Taste N) und direkt eine neue Unterkategorie anlegen (Taste +).
- Auf dem Handy sind beim Taggen alle Kategorien ohne Scrollen sichtbar.
- Export: Spalten «Mein Anteil %» und «Mein Betrag».

## 0.1.0
- Erste Version: Kreditkarten- und Bank-CSV sowie camt.053 importieren, Ausgaben taggen, Übersicht pro Monat und Jahr, CSV-Export.
- Zwei Konten: Privat (Bereich Persönlich) und Gemeinsam. Kategorien gelten pro Bereich oder in beiden, z. B. Auto über alle Konten.
- Bargeld und Ausgaben der Partnerin manuell erfassen.
- Farben Solarized, hell oder dunkel.
- Live mit verschlüsseltem Sync ins private Daten-Repo, Test mit Beispieldaten und ohne Sync.
