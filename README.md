# VTM Angebotsdesk

Interne **Angebotssoftware für das Vertriebsteam** des
VersicherungsTech Magazins (VTM). Statische Webanwendung ohne
Build-Tools und ohne Server-Abhängigkeiten – einfach deployen,
Domain verbinden, loslegen.

Gebaut nach dem **VTM Brand & Design System „Master Next"**
(Kapitel Webanwendungen: Cobalt-Seitenleiste, Inter/Plus Jakarta
Sans/IBM Plex Mono, Electric nur für Aktionen, Brass nur für
Research) und der Struktur des **VTM Sales Desk**.

## Bereiche

- **Dashboard** – offene Angebote, Pipeline-Wert (netto), gewonnene
  Summe und Abschlussquote des Jahres, fällige Wiedervorlagen,
  ablaufende Angebote, zuletzt bearbeitete Vorgänge.
- **Angebote** – Team-Übersicht mit Suche, Status- und
  Betreuer-Filter, CSV-Export, Duplizieren, Löschen.
- **Angebots-Editor** – drei Reiter (Angebot / Vertrag / Rechnung)
  mit Live-A4-Vorschau im Dokumentdesign „Master Next":
  - Leistungskatalog mit Paket-Bundles und automatischem
    Mengenrabatt für Sponsored LinkedIn Posts (ab 5 −10 %, ab 10 −20 %)
  - Anschreiben-Generator und Textvorlagen
  - Nummernkreise (A-JJJJ-NNN, V-JJJJ-NNN, VTM-JJJJ-NNNN) mit
    „Nächste Nummer ziehen", Startwerte gemäß letzter Belege
  - Autosave, Word-Export (.doc), PDF über den Druckdialog,
    E-Mail-Text-Generator (inkl. mailto)
  - Interne Steuerung: Wiedervorlage, Abschlusswahrscheinlichkeit,
    Notizen (erscheinen nie im Dokument)
- **Kunden** – gemeinsamer Kundenstamm; Übernahme in Angebote per
  Auswahl, „Als Kunde speichern" direkt aus dem Editor,
  „＋ Angebot" direkt aus der Kundenliste.
- **Produkte & Leistungen** – Katalog- und Paketpflege
  (nur Administration), inkl. rechnerischer Kontrolle der
  Bundle-Listenpreise.
- **Freigaben** – Vier-Augen-Workflow: Angebote über den Grenzen
  (Standard: Paketrabatt > 15 % oder Netto > 25.000 €) werden „Zur
  Freigabe eingereicht"; die Administration gibt frei oder weist
  mit Begründung zurück. Entscheidungen werden protokolliert.
- **Vorlagen** – Textbausteine für Anschreiben und E-Mails mit
  Platzhaltern (`{NR} {BETREFF} {SUMME} {GUELTIG} {BETREUER}`).
- **Einstellungen** – Firmendaten (Dokument-Footer), USt.-Satz,
  Freigaberegeln, Zahlungsziel-/Gültigkeits-Standards,
  Nummernkreise, Benutzerverwaltung, Datensicherung
  (JSON-Export/-Import, Zurücksetzen).

## Login & Rollen

- **Administration:** `maximilian.hempel@versicherungstech-magazin.de`
  (voreingerichtet). Beim **ersten Login** wird das persönliche
  Passwort festgelegt (mind. 8 Zeichen) – es gibt kein
  Standard-Passwort.
- **Vertrieb:** Das Team (Maximilian Dahmen, Lukas Härle, Johannes
  Oberhofer, Karl Heinz Passler) ist als Betreuer vorangelegt.
  Login-Zugänge entstehen, sobald die Administration unter
  **Einstellungen → Benutzer** die jeweilige E-Mail-Adresse
  hinterlegt; das Passwort setzt jede Person beim ersten Login
  selbst.
- Rollenunterschiede: Nur Admins pflegen Katalog, Firmendaten,
  Regeln, Nummernkreise und Benutzer und entscheiden Freigaben.
  Statusworkflow: Entwurf → In Prüfung → Freigegeben → Versendet →
  Angenommen/Abgelehnt (Abgelaufen wird automatisch angezeigt).

> **Wichtig – Sicherheitsmodell:** Dies ist eine rein statische
> Anwendung. Der Login steuert Rollen und Bedienung, ist aber **kein
> Serverschutz** – wer die URL kennt, kann den Quellcode lesen.
> Keine hochsensiblen Daten ablegen und die Seite idealerweise
> zusätzlich absichern (z. B. Cloudflare Access, Netlify
> Password/Identity oder Basic Auth des Webservers).

## Datenhaltung

Alle Daten (Angebote, Kunden, Katalog, Benutzer, Einstellungen)
liegen im **localStorage des jeweiligen Browsers** – es gibt
bewusst kein Backend, damit die Software ohne Betriebskosten sofort
läuft. Konsequenzen:

- Pro Gerät/Browser ein eigener Datenbestand. Austausch im Team
  über **Einstellungen → Datensicherung** (JSON-Export/-Import).
- Regelmäßig exportieren (Backup!). Browserdaten löschen = Daten weg.
- Späterer Ausbau: Die gesamte Persistenz läuft über das
  `Store`-Objekt in `app.js` (`Store.load`/`Store.save`). Wer eine
  echte Team-Synchronisation möchte, ersetzt diese zwei Methoden
  durch API-Aufrufe (z. B. Supabase, Firebase, eigener Endpoint) –
  der Rest der Anwendung bleibt unverändert.

## Deployment

Statische Seite – es genügt, die Dateien auszuliefern:

**GitHub Pages (empfohlen, kostenlos):**
1. Repo → *Settings → Pages* → Source: diesen Branch, Ordner `/ (root)`.
2. Die Datei `CNAME` enthält `adam.versicherungstech-magazin.de`
   (bei Bedarf anpassen).
3. Beim DNS-Anbieter einen **CNAME-Record** anlegen:
   `adam` → `maxhemp.github.io`. HTTPS aktiviert GitHub
   automatisch („Enforce HTTPS" anhaken).

Alternativ Netlify/Vercel (Repo verbinden, kein Build-Command) oder
ein beliebiger Webserver. Es gibt keine Abhängigkeiten und keinen
Build-Schritt; Schriften kommen von Google Fonts.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Markup: Login, App-Shell, alle Bereiche, Editor, A4-Vorschau |
| `app.css` | Design-Tokens „Master Next" + UI- und Dokument-Styles + Print |
| `app.js` | Store, Auth/Rollen, Router, Views, Editor, Word-Export |
| `data.js` | Seed-Daten: Katalog, Bundles, Vorlagen, Firma, Benutzer, Nummernkreise |
| `assets/` | VTM-Logos (farbig/weiß) |

Preise, Katalog und Firmendaten werden **in der App** gepflegt
(Einstellungen bzw. Produkte & Leistungen); `data.js` dient nur der
Erstbefüllung neuer Browser.
