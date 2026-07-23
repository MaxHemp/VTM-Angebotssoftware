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

## Team-Synchronisation (Backend)

Die App synchronisiert den kompletten Datenbestand (Angebote,
Kunden, Katalog, Benutzer, Einstellungen) über ein **kleines
Supabase-Backend** (kostenloser Tarif). Synchronisiert wird
automatisch: nach jeder Änderung (leicht verzögert), alle
45 Sekunden und beim Fokus-Wechsel ins Fenster. Der Status ist
unten in der Seitenleiste sichtbar.

**Einmalige Einrichtung (Administration, ca. 5 Minuten):**

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen
   (Free-Tarif genügt).
2. Im Projekt **SQL Editor** öffnen und `supabase-setup.sql`
   ausführen (liegt im Repo; identisch in der App unter
   Einstellungen → Team-Synchronisation).
3. **Settings → API**: *Project URL* und *anon public key*
   kopieren.
4. In der App: **Einstellungen → Team-Synchronisation** → beide
   Werte eintragen → „Speichern & verbinden".

**Onboarding neuer Teammitglieder (mit E-Mail-Einladung):**

1. Administration legt die Person unter **Einstellungen →
   Benutzer** mit E-Mail-Adresse an. Die App erzeugt automatisch
   ein Einmalpasswort und der Team-Server verschickt die
   **Einladungs-E-Mail** (Link zu ADAM, Benutzername = E-Mail,
   Einmalpasswort). Das Einmalpasswort wird der Administration
   zusätzlich einmalig als Fallback angezeigt.
2. Person: Link öffnen → ggf. am Login **„Mit Team-Server
   verbinden"** (Server-URL + Zugangsschlüssel von der
   Administration, nur beim allerersten Mal auf einem Gerät) →
   mit E-Mail + Einmalpasswort anmelden.
3. Beim ersten Login **erzwingt** die App das Festlegen eines
   eigenen Passworts; das Einmalpasswort wird damit ungültig.
   „Neues Einmalpasswort senden" in der Benutzerverwaltung setzt
   ein vergessenes Passwort zurück.

**Mailversand einrichten (einmalig):** Einstellungen →
**E-Mail-Einladungen** → Resend-API-Key (nur Versandrecht)
eintragen → „SQL erzeugen" → Script im Supabase SQL Editor
ausführen (`supabase-mail-setup.sql` ist die Vorlage). Versand
läuft über einen Datenbank-Trigger (pg_net → Resend) mit der
verifizierten Absender-Domain `versicherungstech-magazin.de`;
der Key liegt nur in Supabase (RLS-geschützt, per API nicht
auslesbar), Empfänger sind auf konfigurierte Domains beschränkt.

**Konfliktverhalten:** Pro Angebot/Kunde/Benutzer/Vorlage gewinnt
die zuletzt gespeicherte Änderung; Katalog und Einstellungen als
Ganzes ebenso. Nummernkreise werden auf das Maximum zusammengeführt,
damit parallel gezogene Nummern nicht doppelt vergeben werden.
Löschungen synchronisieren über Lösch-Markierungen (Tombstones).
Schreibkonflikte verhindert eine optimistische Sperre (`rev`-Spalte)
mit automatischem Merge-Retry.

## Datenhaltung

Jedes Gerät hält eine lokale Kopie im **localStorage** (die App
funktioniert damit auch offline weiter) und gleicht sie mit dem
Team-Server ab. Ohne konfigurierten Server arbeitet die App rein
lokal – dann gilt: Austausch über **Einstellungen → Datensicherung**
(JSON-Export/-Import) und regelmäßig exportieren (Backup!).

Hinweis zum Zugriffsschutz: Der *anon public key* berechtigt zum
Lesen/Schreiben der Team-Daten und wird deshalb nur intern geteilt
(er steht bewusst **nicht** im Code des Repos, sondern wird pro
Gerät hinterlegt). Wer den Schlüssel rotieren will: in Supabase
unter Settings → API neu generieren und im Team neu verteilen.

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
| `sync.js` | Team-Synchronisation: Supabase-Anbindung, Merge-Logik, Statusanzeige |
| `supabase-setup.sql` | Einmaliges SQL-Setup für das Backend |
| `supabase-mail-setup.sql` | Vorlage für den Einladungs-Mailversand (pg_net → Resend) |
| `data.js` | Seed-Daten: Katalog, Bundles, Vorlagen, Firma, Benutzer, Nummernkreise |
| `assets/` | VTM-Logos (farbig/weiß) |

Preise, Katalog und Firmendaten werden **in der App** gepflegt
(Einstellungen bzw. Produkte & Leistungen); `data.js` dient nur der
Erstbefüllung neuer Browser.
