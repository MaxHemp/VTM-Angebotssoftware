# VTM Präsentationsvorlage · Design System 5.0 „Signal“

Dieser Ordner enthält die PowerPoint-Umsetzung des VTM Design Systems 5.0 „Signal“:

| Datei | Zweck |
|---|---|
| `VTM-Vorlage.potx` | PowerPoint-**Vorlage** (Template-Content-Type), 16:9, mit allen 15 VTM-Layouts, Theme-Farben und Fußzeilen auf den Mastern |
| `VTM-Beispieldeck.pptx` | Beispieldeck: jeder Folientyp genau einmal, mit Sprechernotizen (Einsatzhinweise, Übergänge, Hinweise für das Versand-PDF) |
| `README.md` | Diese Datei |

## 1. Schriften installieren (vor dem ersten Öffnen)

Die Vorlage verwendet drei Google-Fonts. Ohne Installation ersetzt PowerPoint sie durch
Systemschriften – als dokumentierter Fallback gilt **Arial** (Layouts brechen dadurch nicht,
verlieren aber den redaktionellen Charakter).

| Rolle | Schrift | Download |
|---|---|---|
| Überschriften, Kennzahlen | **Schibsted Grotesk** | <https://fonts.google.com/specimen/Schibsted+Grotesk> |
| Fließtext, UI, Tabellen | **Inter** | <https://fonts.google.com/specimen/Inter> |
| Meta, Quellen, Zahlenspalten (11 pt bzw. kleiner) | **IBM Plex Mono** | <https://fonts.google.com/specimen/IBM+Plex+Mono> |

Installation: auf der Specimen-Seite „Get font“ → „Download all“, ZIP entpacken, die
`.ttf`-Dateien markieren → Rechtsklick → „Installieren“ (Windows) bzw. Doppelklick →
„Schrift installieren“ (macOS). Danach PowerPoint neu starten.

Zitat-Folien nutzen **Georgia** (auf Windows und macOS vorinstalliert) als Serif-Ersatz für
die redaktionelle Newsreader-Anmutung des Web-Designsystems.

## 2. Vorlage nutzen

- **Neue Präsentation:** Doppelklick auf `VTM-Vorlage.potx` erzeugt eine neue, unbenannte
  Präsentation aus der Vorlage. (Alternativ: Datei nach
  `Dokumente/Benutzerdefinierte Office-Vorlagen` legen und über „Neu → Persönlich“ wählen.)
- **Folientyp wählen:** Start → Neue Folie → Layoutliste. Die 15 Layouts heißen
  `VTM Cover`, `VTM Agenda`, `VTM Kapiteltrenner`, `VTM Statement`, `VTM Team`,
  `VTM Tabelle` (Leistungsübersicht), `VTM Prozess`, `VTM Stufenmodell`, `VTM Diagramm`,
  `VTM Kennzahlen`, `VTM Vergleich`, `VTM Fallbeispiel`, `VTM Zitat`, `VTM Vollbildfoto`,
  `VTM Kontakt`.
- **Logo und Fußzeile** (Foliennummer · „VersicherungsTech Magazin“ · Datumszeile
  „Stand: MM/JJJJ“) liegen auf den Mastern/Layouts – auf einzelnen Folien nichts davon
  duplizieren oder verschieben. Den Stand vor jedem Versand im Master aktualisieren
  (Ansicht → Folienmaster).
- **Vollbildfoto:** Foto und Nachtblau-Schleier (42 % Transparenz) liegen als Objekte auf der
  Folie (nicht im Layout), damit der Schleier über dem Foto bleibt. Beispielfolie 6 des
  Beispieldecks kopieren und nur das Foto austauschen.
- **Diagramme:** Das Balkendiagramm im Beispieldeck ist ein natives PowerPoint-Diagramm
  (Rechtsklick → „Daten bearbeiten“). Datenreihen in Electric `#1F4EFF`; genau **ein**
  belegter, entscheidender Wert darf Gold `#C9A035` tragen.

## 3. Gestaltungsregeln (Kurzfassung aus tokens.json)

**Farben**

- Weiß und Eisblau (`#F7FAFE`, `#EFF4FC`) tragen die Fläche. Nachtblau `#0D1C3C` ist
  Textfarbe und kompakter dunkler Anker – nur Cover, Kapiteltrenner, Abschluss.
- Electric `#1F4EFF` nur für Aktionen, aktive Zustände und Datenreihen.
- Gold `#C9A035` ausschließlich für Beleg, Quelle und den einen verifizierten Wert
  (Belegmarke: kurze goldene Linie über der Mono-Quellenzeile). Nie dekorativ.
- Coral `#C24B33` nur Fehler/Risiko, Mint `#128760` nur Erfolg/Zusage.
- Kein Verlauf, kein Glow, keine Deko-Icons.
- Die Theme-Palette ist entsprechend belegt: Text/Hintergrund = Nachtblau/Weiß,
  Akzent 1 = Electric, Akzent 2 = Gold, Akzent 3 = Mint, Akzent 4 = Coral,
  Akzent 5 = Electric-400 (`#7C96FF`, für Flächen auf Nachtblau), Akzent 6 = Nachtblau.

**Layout und Sprache**

- Asymmetrisch-redaktionell: 7/5-Teilungen, große ruhige Weißräume, ein dominantes Motiv
  pro Folie. Keine drei identischen Karten, keine Nummern ohne echte Reihenfolge.
- **Eine Aussage pro Folie** – der Folientitel ist ein Aussage-Titel („35.000
  Podcast-Downloads im Monat sind der stärkste Kanal.“), kein Themen-Titel („Reichweite“).
- Deutsch, journalistisch, ohne Werbefloskeln; deutsche Zahlenformate (1.234,5 · 50 %).
- Keine erfundenen Zahlen. Nicht belegte Demo-Inhalte sichtbar kennzeichnen
  (Mono-Label „Demonstrationsinhalt des Design Systems“, siehe Zitat-Folie).
- VTM verspricht fachliche Sichtbarkeit – niemals Leads, Abschlüsse oder Vertriebserfolge.

**Versand als PDF**

- Datei → Exportieren → PDF; vorher Datumszeile und Preisstand prüfen (Sprechernotizen der
  jeweiligen Folie enthalten die folienspezifischen Versandhinweise).
- Keine Animationen verwenden, damit Vortrag und Export identisch sind.
- Kennzeichnungen (Quellenzeilen, „Illustration“, Sponsored-Hinweise) dürfen im PDF nicht
  entfernt werden.

## 4. Technische Hinweise

- `VTM-Vorlage.potx` ist als echtes Template gespeichert (Content-Type
  `application/vnd.openxmlformats-officedocument.presentationml.template.main+xml`).
- Foliengröße: 16:9 (13,33″ × 7,5″).
- Team-Fotos, Logos und Motive stammen aus `../assets/`; beim Austausch das
  Seitenverhältnis beibehalten (Team 4:5, Motive 16:9-nah).
- Zahlen in Diagramm-Datenbeschriftungen formatiert PowerPoint locale-abhängig
  (`#,##0` → „35.000“ auf deutschen Systemen).
