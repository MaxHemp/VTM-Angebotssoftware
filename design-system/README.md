# VTM Design System 5.0 · Signal

Das verbindliche, kanalübergreifende Marken-, Redaktions- und Produktsystem des
**VersicherungsTech Magazins** (VTM). Leitidee: *Aus Marktgeräusch ein belastbares
Signal.* Dieses System ersetzt die Arbeitsfassung „Master-Next 4.2".

**Einstieg:** [`index.html`](index.html) — das vollständige Handbuch mit 24 Kapiteln
(Strategie, Prinzipien, Logo, Farbe, Typografie, Bildwelt, Piktogramme, Layout,
Tokens, Komponenten, Bewegung, alle Kanalsysteme, Sprache, Barrierefreiheit,
Technik, Abnahme-Checklisten).

## Dateien

| Pfad | Inhalt |
|---|---|
| `index.html` | Master-Handbuch: alle Regeln, live gerenderte Komponenten, Do's/Don'ts, Checklisten |
| `tokens.css` | Design Tokens als CSS Custom Properties — drei Ebenen (primitiv / semantisch / Komponente), inkl. Reduced-Motion- und Print-Regeln. **Einzige Wertequelle für Web und SaaS.** |
| `tokens.json` | Maschinenlesbarer Spiegel der Tokens für Office-, E-Mail- und Grafikvorlagen |
| `beispiele/ueber-uns.html` | Referenz „Über uns" mit der verbindlichen Dramaturgie (Menschen zuerst) |
| `beispiele/artikel.html` | Redaktionelles Artikelsystem: Kopf, Lead, Lesetext, Datenbox, Diagramm, Quellen, Kennzeichnung, Newsletter-Einladung |
| `beispiele/saas-ui.html` | SaaS-Arbeitsoberfläche (Angebotsdesk): Tabellen, Formulare, Zustände, KI-Transparenz |
| `beispiele/newsletter.html` | E-Mail-sicheres „VTM Briefing" (Tabellenlayout, Outlook-tauglich, bildlos lesbar) |
| `beispiele/geschaeftsbrief.html` | Druckfähiges A4-Angebot (2 Seiten, `@page`-Print-CSS, Graustufen-tauglich) |
| `beispiele/social.html` | LinkedIn-/Social-Formate in Originalmaßen (1080×1350 / 1080×1080) mit Kurzregeln |
| `praesentation/VTM-Vorlage.potx` | PowerPoint-Vorlage: Master + 15 Layouts, Logo/Fußzeile auf den Mastern |
| `praesentation/VTM-Beispieldeck.pptx` | Beispieldeck mit jedem Folientyp und deutschen Sprechernotizen |
| `praesentation/README.md` | Schriften-Installation und Nutzungsregeln für die Office-Vorlagen |
| `assets/` | Logos (farbig/weiß, beschnitten), freigegebene Teamfotos, Partnerlogos, deklarierte Illustrationsmotive |

## Grundregeln in einem Absatz

Weiß und Eisblau tragen die Fläche. Nachtblau `#0D1C3C` ist Textfarbe und kompakter
Anker — nie langer Seitenhintergrund. Electric `#1F4EFF` markiert ausschließlich
Aktivität, Auswahl, Daten und Interaktion. Gold ist **ausschließlich** Beleg-,
Quellen- und Verifizierungsfarbe. Coral nur Fehler/Risiko, Mint nur Erfolg/Zusage.
Typografie: Schibsted Grotesk (Display), Inter (UI/Text), Newsreader (redaktionelle
Stimme), IBM Plex Mono (Quellen, Daten, Status). Jede Fläche folgt der Grammatik
**Aussage → Einordnung → Beleg → Handlung** und hat möglichst eine Hauptaktion.
WCAG 2.2 AA ist Mindeststandard und steht über allen Markenregeln.

## Schriften

Prototypen laden die Schriften über Google Fonts (siehe `<head>` der Beispiele).
Für Produktionssysteme werden die Schnitte als selbst gehostete WOFF2 mit
`font-display: swap` eingebunden:
[Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk) ·
[Inter](https://fonts.google.com/specimen/Inter) ·
[Newsreader](https://fonts.google.com/specimen/Newsreader) ·
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono)
(alle SIL Open Font License).

## Qualitätssicherung dieses Stands

Geprüft am 05.08.2026 (Chromium headless): HTML-Struktur aller sieben Seiten
valide; Reflow ohne horizontales Scrollen bei 320/390/768/1024 px; Geschäftsbrief
druckt exakt 2 A4-Seiten; Kontraste aller Text-Token nachgerechnet (Werte in
Kapitel 04 bzw. `tokens.json`); Reduced Motion global über `tokens.css` erzwungen;
PowerPoint-Dateien mit python-pptx und LibreOffice-Rendering verifiziert.

## Governance

Änderungen laufen über `tokens.css`/`tokens.json` und das Handbuch — nie über
Einzeldateien. Freigaben und Abweichungen verantwortet der Herausgeber
(Maximilian Hempel, info@versicherungstech-magazin.de).
