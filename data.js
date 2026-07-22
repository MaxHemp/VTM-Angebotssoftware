/* =========================================================
   VTM Angebotsdesk · Stammdaten & Seeds
   Katalogstand: angebote.versicherungstech-magazin.de
   Diese Werte dienen als Erstbefüllung. Nach dem ersten Start
   werden sie in den lokalen Datenbestand übernommen und dort
   (Bereich Produkte & Leistungen bzw. Einstellungen) gepflegt.
   ========================================================= */

const SEED_FIRMA = {
  name: "VersicherungsTech Media UG (haftungsbeschränkt)",
  kurz: "VersicherungsTech Media UG",
  strasse: "Moitzfeld 17",
  plzort: "51429 Bergisch Gladbach",
  hrb: "HRB 126738, Amtsgericht Köln",
  gf: "Maximilian Hempel",
  iban: "DE42 3707 0209 0079 5427 00",
  stnr: "204/5723/2832",
  mail: "info@versicherungstech-magazin.de",
  web: "versicherungstech-magazin.de"
};

const SEED_USERS = [
  { id: "u-hempel",    name: "Maximilian Hempel",  email: "maximilian.hempel@versicherungstech-magazin.de", role: "admin",    active: true, passHash: null, salt: null },
  { id: "u-dahmen",    name: "Maximilian Dahmen",  email: "", role: "vertrieb", active: true, passHash: null, salt: null },
  { id: "u-haerle",    name: "Lukas Härle",        email: "", role: "vertrieb", active: true, passHash: null, salt: null },
  { id: "u-oberhofer", name: "Johannes Oberhofer", email: "", role: "vertrieb", active: true, passHash: null, salt: null },
  { id: "u-passler",   name: "Karl Heinz Passler", email: "", role: "vertrieb", active: true, passHash: null, salt: null }
];

const SEED_KATALOG = [
  { group:"Magazin · Reichweite & Sichtbarkeit", items:[
    { id:"banner", t:"Website-Werbebanner", p:1200, e:"Monat(e)",
      d:"Ihr Banner auf allen Seiten von versicherungstech-magazin.de\nDauerhaft präsent im redaktionellen Umfeld\nReporting zu Impressionen und Klicks" },
    { id:"bannerApp", t:"Werbebanner Website + VTM App", p:2000, e:"Monat(e)",
      d:"Ihr Banner auf allen Webseiten und zusätzlich in der VTM App\nDirekt auf dem Startbildschirm der Entscheider\nReporting zu Impressionen und Klicks" },
    { id:"newsletter", t:"Newsletter-Sponsoring", p:1900, e:"Monat(e)",
      d:"Exklusive Präsenz im VTM Briefing\n6.000+ Empfänger, rund 50 % Öffnungsrate\nDirekt im Posteingang der Branche" }
  ]},
  { group:"Magazin · Content & Thought Leadership", items:[
    { id:"fachartikel", t:"Fachartikel", p:900, e:"Artikel",
      d:"Von der Redaktion geschriebener Fachbeitrag zu Ihrem Thema\nVeröffentlichung auf Website und in der VTM App\nAnteaser im Newsletter, Kennzeichnung als Sponsored Content" },
    { id:"interview", t:"Executive Interview", p:1200, e:"Interview(s)",
      d:"Ihre Führungskraft im redaktionellen Interview\nPositionierung über Person und Haltung statt Werbebotschaft" },
    { id:"caseStudy", t:"Case Study inkl. Lead-Liste", p:3000, e:"Case Studies",
      d:"Ihr Kundenprojekt als Erfolgsgeschichte\nInklusive Kontaktliste aller Interessenten, die den Bericht angefordert haben" },
    { id:"liaas", t:"LinkedIn as a Service", p:2500, e:"Monat(e)",
      d:"4 fertige LinkedIn-Beiträge pro Monat für die Profile Ihrer Vertriebs- und Führungskräfte\nExperten-Sichtbarkeit zu relevanten Versicherungsthemen" },
    { id:"liPost", t:"Sponsored LinkedIn Post", p:750, e:"Post(s)", rule:"li",
      d:"Ihr Beitrag über den VTM-Kanal, wo die Branche täglich mitliest\nMengenrabatt: ab 5 Posts −10 %, ab 10 Posts −20 %" }
  ]},
  { group:"Podcast & Audio · Insurance Monday, ca. 35.000 Downloads/Monat", items:[
    { id:"quartal", t:"Quartalssponsoring Insurance Monday", p:30000, e:"Quartal(e)",
      d:"3 komplette Podcast-Episoden zu Ihrem Thema\nBewerbung auf LinkedIn und allen gängigen Podcast-Plattformen\nProduktion Ihres Audio-Werbespots + Ausspielung in 30 weiteren Episoden (Mid-Roll)\nOffizielle Nennung als Sponsor auf allen Materialien" },
    { id:"podcastEp", t:"Einzelne Podcast-Episode", p:3500, e:"Episode(n)",
      d:"Ihr Experte im Gespräch bei Insurance Monday\nEine ganze Folge zu Ihrem Thema, erzählt an echten Fällen aus der Praxis" },
    { id:"preroll", t:"Podcast-Werbespot (Pre-Roll)", p:2500, e:"Paket(e) à 3 Episoden",
      d:"Ihr Werbespot am Anfang von drei Episoden\nDort, wo die Aufmerksamkeit am höchsten ist" }
  ]},
  { group:"Jahresprogramme (ab-Preise, individuell zugeschnitten)", items:[
    { id:"progStartup", t:"VTM Startup Presence", p:12000, e:"Jahr(e)",
      d:"1× Podcast-Episode bei Insurance Monday\n2× Fachartikel\n1× Gründerinterview oder Startup-Porträt\n12× LinkedIn-Post über den VTM-Kanal (1× pro Monat)\nMonatlich zahlbar" },
    { id:"progCategory", t:"VTM Category Presence", p:25000, e:"Jahr(e)",
      d:"Positionierungs-Workshop zum Start\n2× Podcast-Folge bei Insurance Monday\n12 Monate Werbebanner- und Newsletter-Präsenz in Ihrer Kategorie\n2× Executive Interview\n1× Deep-Dive-Webinar, moderiert vom VTM\n„sponsored by“-Logo auf allen Inhalten Ihrer Kategorie, 12 Monate" },
    { id:"progAuthority", t:"VTM Authority Program", p:70000, e:"Jahr(e)",
      d:"Quartalsweiser Workshop zur Markenpositionierung\n4× Podcast-Folge bei Insurance Monday\n12 Monate Banner auf VTM-Startseite und in der App\n4× große Fachinhalte (z. B. Studie, Whitepaper, Case Study)\n2× Deep-Dive-Webinar, moderiert vom VTM\nSponsorslot, Tickets und Ausstellerpaket beim Hamburger Insurance Innovation Day\n12 Monate LinkedIn as a Service für einen Mitarbeiter" }
  ]},
  { group:"Programm-Bausteine (Preis individuell, hier Betrag eintragen)", items:[
    { id:"marktcheck", t:"Marktcheck im Entscheider-Panel", p:0, e:"pauschal",
      d:"Befragung des VTM-Netzwerks aus Führungskräften der Versicherungsbranche zu Ihrem Thema\nErgebnis: eine zitierfähige Zahl für Presse und Vertrieb" },
    { id:"webinar", t:"Fach-Webinar mit Teilnehmerliste", p:0, e:"pauschal",
      d:"45 Minuten unter VTM-Flagge: Moderation durch das VTM, Ihr Experte zeigt die Lösung an einem konkreten Fall\nKomplette Anmeldeliste für Ihren Vertrieb" },
    { id:"statements", t:"Experten-Statements", p:0, e:"pauschal",
      d:"Kurze Zitate und Einschätzungen Ihres Experten in der laufenden VTM-Berichterstattung" },
    { id:"exklusiv", t:"Kategorie-Exklusivität", p:0, e:"pauschal",
      d:"In Ihrer Kategorie tritt kein weiterer Werbepartner im VTM auf" }
  ]}
];

const SEED_BUNDLES = [
  { name:"Sichtbarkeits-Start", sub:"Der kompakte Einstieg: gesehen werden, wo die Branche liest.", price:"9.975 € netto",
    items:[["fachartikel",1],["newsletter",3],["liPost",5]] },
  { name:"Thought-Leader-Paket", sub:"Ihr Kopf und Ihr Thema werden in der Branche verankert.", price:"21.500 € netto",
    items:[["podcastEp",1],["interview",1],["fachartikel",2],["liaas",6]] },
  { name:"Marktführer-Paket", sub:"Volle Sichtbarkeit über alle Kanäle, ein Quartal lang.", price:"44.700 € netto",
    items:[["quartal",1],["newsletter",3],["bannerApp",3],["caseStudy",1]] }
];

const SEED_TEMPLATES = [
  { id:"tpl-standard", type:"anschreiben", name:"Standard · Erstangebot",
    text:`vielen Dank für Ihr Interesse an einer Zusammenarbeit mit dem VersicherungsTech Magazin. Unsere Leserinnen und Leser sind IT- und Innovationsverantwortliche, Vorstände und Fachbereichsleitungen von Versicherungsunternehmen in der DACH-Region. Genau diese Zielgruppe erreichen Sie mit den nachfolgend zusammengestellten Maßnahmen.

Das Angebot ist modular aufgebaut. Einzelne Positionen lassen sich jederzeit anpassen oder kombinieren. Erste Inhalte gehen in der Regel innerhalb von 10 Werktagen nach Beauftragung live. Gerne besprechen wir die Details in einem kurzen Abstimmungscall.` },
  { id:"tpl-event", type:"anschreiben", name:"Anlassbezogen · Event/Messe",
    text:`vielen Dank für das gute Gespräch. Wie besprochen erhalten Sie unser Angebot für eine mediale Begleitung rund um Ihren Anlass. Die vorgeschlagenen Bausteine sind zeitlich auf den Termin abgestimmt, sodass Sichtbarkeit vor, während und nach dem Event entsteht.

Alle Positionen sind modular und lassen sich bis zur Beauftragung anpassen. Gerne stimmen wir den konkreten Zeitplan gemeinsam ab.` },
  { id:"tpl-nachfass", type:"anschreiben", name:"Nachfass · Aktualisiertes Angebot",
    text:`vielen Dank für Ihre Rückmeldung zu unserem Angebot. Gerne haben wir die besprochenen Anpassungen übernommen – Sie finden die aktualisierte Zusammenstellung auf den folgenden Seiten.

Sollten weitere Fragen offen sein, melden Sie sich jederzeit. Zur Beauftragung genügt eine kurze Bestätigung per E-Mail.` },
  { id:"tpl-mail-angebot", type:"email", name:"E-Mail · Angebotsversand",
    text:`anbei erhalten Sie unser Angebot {NR} „{BETREFF}“ über {SUMME} netto, gültig bis {GUELTIG}.

Alle Positionen sind modular aufgebaut und lassen sich bis zur Beauftragung anpassen. Für Rückfragen oder einen kurzen Abstimmungscall stehe ich gerne zur Verfügung.

Mit freundlichen Grüßen
{BETREUER}
VersicherungsTech Magazin` }
];

const SEED_SETTINGS = {
  vat: 0.19,
  zahlungszielDefault: 14,
  gueltigkeitTage: 14,
  /* Startwerte gemäß letzter bekannter Belege:
     A-2026-041, V-2026-017, VTM-2026-0027 */
  counters: { angebot: 41, vertrag: 17, rechnung: 27, year: 2026 },
  freigabe: { enabled: true, maxRabatt: 15, maxNetto: 25000 },
  kpiZeile: [
    ["35.000", "Podcast-Downloads/Monat"],
    ["6.000+", "Newsletter-Empfänger"],
    ["~50 %", "Öffnungsrate Newsletter"],
    ["20.000+", "LinkedIn Follower (Team)"]
  ]
};

const SEED_KUNDEN = [];
