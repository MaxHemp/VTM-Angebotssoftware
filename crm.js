/* =========================================================
   ADAM · CRM-Modul
   Firmen, Kontakte, Verkaufschancen (Pipeline), Aktivitäten &
   Aufgaben, Berichte und Schnellsuche.

   Datenmodell – alle Sammlungen mit id, createdAt, updatedAt und
   Tombstone-Löschung (deleted:true), synchronisiert über
   sync.js/mergeById:
   - kunden        Firmen: firma, status, branche, ownerId, website,
                   telefon (Zentrale), strasse, plzort, notiz
   - kontakte      Personen: kundeId, anrede, vorname, nachname,
                   funktion, rolle, email, telefon, mobil, linkedin,
                   primary, notiz
   - deals         Verkaufschancen: titel, kundeId, kontaktId, stage,
                   wert, wertManuell, chance, abschluss, ownerId,
                   quelle, verlustgrund, notiz, wonAt, lostAt
   - aktivitaeten  typ (notiz|anruf|email|meeting|aufgabe|system),
                   betreff, text, datum, faellig, erledigt,
                   erledigtAm, ownerId, createdBy,
                   kundeId, kontaktId, dealId, offerId
   Angebote tragen zusätzlich kundeId, kontaktId und dealId.
   ========================================================= */

const CRM_STAGES = [
  {k:"lead",         label:"Lead",         chance:10},
  {k:"qualifiziert", label:"Qualifiziert", chance:25},
  {k:"angebot",      label:"Angebot",      chance:50},
  {k:"verhandlung",  label:"Verhandlung",  chance:75},
  {k:"gewonnen",     label:"Gewonnen",     chance:100},
  {k:"verloren",     label:"Verloren",     chance:0}
];
const OPEN_STAGES = ["lead","qualifiziert","angebot","verhandlung"];
const STAGE_IDX = Object.fromEntries(CRM_STAGES.map((s,i)=>[s.k,i]));
const stageLabel = k => (CRM_STAGES.find(s=>s.k===k)||{label:k}).label;

const FIRMA_STATUS = {lead:"Lead", interessent:"Interessent", kunde:"Kunde", inaktiv:"Inaktiv"};
const BRANCHEN = ["Erstversicherer","Rückversicherer","Makler & Vertrieb","InsurTech","IT & Software","Beratung","Verband & Institution","Sonstiges"];
const QUELLEN = ["Messe & Event","Empfehlung","Inbound (Website/Konfigurator)","Kaltakquise","Bestandskunde","LinkedIn","Sonstiges"];
const VERLUSTGRUENDE = ["Budget","Timing","Wettbewerb","Kein Bedarf","Keine Rückmeldung","Sonstiges"];
const ROLLEN = ["Entscheider","Budgetverantwortlich","Fachlicher Ansprechpartner","Beeinflusser","Einkauf","Assistenz"];
const AKT_TYPES = {notiz:"Notiz", anruf:"Anruf", email:"E-Mail", meeting:"Meeting", aufgabe:"Aufgabe", system:"System"};
const LOG_TYPES = ["notiz","anruf","email","meeting","aufgabe"];

/* ---------- Helfer ---------- */
/* IDs in HTML-/JS-Attributen: nur sichere Zeichen durchlassen */
const sid = s => String(s||"").replace(/[^A-Za-z0-9_\-]/g,"");
function safeUrl(u){
  u=String(u||"").trim();
  if(!u) return "";
  if(/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(u)) return "https://"+u;
  return "";
}
const telHref = t => "tel:"+String(t||"").replace(/[^\d+]/g,"");
/* Lokales Datum (nicht UTC) – wichtig für „heute"/„überfällig" */
function localISO(d){ const z=d||new Date(); if(isNaN(z.getTime())) return ""; return new Date(z.getTime()-z.getTimezoneOffset()*60000).toISOString().slice(0,10); }
/* Datum nur anzeigen, wenn es wirklich ein Datum ist (Daten können von anderen Geräten stammen) */
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||""));
const fdate = s => isDay(String(s||"").slice(0,10)) ? fmtDate(String(s).slice(0,10)) : "—";
function addDaysLocal(day,n){ const d=new Date((isDay(day)?day:localISO())+"T12:00:00"); d.setDate(d.getDate()+n); return localISO(d); }
const dayOf = iso => iso ? localISO(new Date(iso)) : "";
const fmtEUR0 = v => new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(v||0);
function fmtK(v){
  v=v||0;
  if(v>=1e6) return (v/1e6).toLocaleString("de-DE",{maximumFractionDigits:1})+" Mio. €";
  if(v>=1e3) return Math.round(v/1e3).toLocaleString("de-DE")+" T€";
  return Math.round(v).toLocaleString("de-DE")+" €";
}
const byFirma = (a,b)=>(a.firma||"").localeCompare(b.firma||"","de");

const CRM = {
  ui: {
    pipeline:{owner:""},
    aufgaben:{scope:"mine", owner:"", done:false},
    bericht:{range:"jahr", owner:""}
  },
  drafts: {},
  cctx: null,
  recent: [],

  /* =========================================================
     Datenzugriff
     ========================================================= */
  now(){ return new Date().toISOString(); },
  me(){ return Auth.user ? Auth.user.id : ""; },
  userName(id){ const u=Store.state.users.find(u=>u.id===id); return u?u.name:"—"; },
  userIdByName(name){ const u=Store.state.users.find(u=>u.name===name); return u?u.id:""; },
  initials(id){
    const n=this.userName(id); if(n==="—") return "–";
    const p=n.split(/\s+/).filter(Boolean);
    return ((p[0]||"")[0]||"")+((p.length>1?p[p.length-1]:"")[0]||"");
  },
  activeUsers(){ return Store.state.users.filter(u=>u.active!==false); },
  ownerMatch(ownerId, filter){ return !filter || (filter==="me" ? ownerId===this.me() : ownerId===filter); },

  firmen(){ return Store.activeKunden(); },
  kontakte(){ return (Store.state.kontakte||[]).filter(x=>!x.deleted); },
  deals(){ return (Store.state.deals||[]).filter(x=>!x.deleted); },
  akts(){ return (Store.state.aktivitaeten||[]).filter(x=>!x.deleted); },
  firma(id){ return id ? Store.kunde(id) : null; },
  kontakt(id){ return id ? (Store.state.kontakte||[]).find(x=>x.id===id && !x.deleted) : null; },
  deal(id){ return id ? (Store.state.deals||[]).find(x=>x.id===id && !x.deleted) : null; },
  akt(id){ return id ? (Store.state.aktivitaeten||[]).find(x=>x.id===id && !x.deleted) : null; },

  kontaktName(k){ return k ? ([k.vorname,k.nachname].filter(Boolean).join(" ") || k.email || "(ohne Namen)") : ""; },
  splitName(full){
    const p=String(full||"").trim().split(/\s+/).filter(Boolean);
    const nachname=p.length?p.pop():"";
    return {vorname:p.join(" "), nachname};
  },
  kontakteVon(kundeId){
    return this.kontakte().filter(k=>k.kundeId===kundeId)
      .sort((a,b)=>(b.primary?1:0)-(a.primary?1:0) || this.kontaktName(a).localeCompare(this.kontaktName(b),"de"));
  },
  dealsVon(kundeId){ return this.deals().filter(d=>d.kundeId===kundeId); },
  offersVonFirma(kundeId){ return Store.activeOffers().filter(o=>o.kundeId===kundeId); },
  offersVonDeal(dealId){ return Store.activeOffers().filter(o=>o.dealId===dealId); },

  isOpen(d){ return OPEN_STAGES.includes(d.stage); },
  /* Wert: aus dem jüngsten nicht abgelehnten Angebot, solange nicht
     manuell festgelegt – sonst der erfasste Schätzwert */
  dealValue(d){
    if(!d.wertManuell){
      const offs=this.offersVonDeal(d.id);
      if(offs.length){
        const valid=offs.filter(o=>o.status!=="abgelehnt");
        const pick=(valid.length?valid:offs).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""))[0];
        return Store.calc(pick.doc).nettoR;
      }
    }
    return Number(d.wert)||0;
  },
  dealChance(d){
    if(d.stage==="gewonnen") return 100;
    if(d.stage==="verloren") return 0;
    if(d.chance!==null && d.chance!==undefined && d.chance!=="") return Number(d.chance);
    return (CRM_STAGES[STAGE_IDX[d.stage]]||{chance:0}).chance;
  },
  weighted(d){ return this.dealValue(d)*this.dealChance(d)/100; },
  closedDay(d){ return dayOf(d.stage==="gewonnen"?(d.wonAt||d.updatedAt):(d.lostAt||d.updatedAt)); },

  whenOf(a){ return a.typ==="aufgabe" ? (a.erledigtAm||a.updatedAt||a.createdAt) : (a.datum||a.createdAt); },
  /* Letzter Kontakt je Firma (offene Aufgaben zählen nicht) */
  touchMap(){
    const m={};
    for(const a of this.akts()){
      if(!a.kundeId || (a.typ==="aufgabe" && !a.erledigt)) continue;
      const w=this.whenOf(a);
      if(!m[a.kundeId] || w>m[a.kundeId]) m[a.kundeId]=w;
    }
    return m;
  },

  /* =========================================================
     Schreiben: Aktivitäten, Phasen, Verknüpfungen
     ========================================================= */
  log(o){
    const now=this.now();
    const a=Object.assign({id:uid("ak"), typ:"notiz", betreff:"", text:"", datum:now, faellig:"",
      erledigt:false, erledigtAm:"", ownerId:this.me(), createdBy:this.me(), createdAt:now, updatedAt:now,
      kundeId:"", kontaktId:"", dealId:"", offerId:""}, o);
    if(!a.kundeId && a.dealId){ const d=this.deal(a.dealId); if(d) a.kundeId=d.kundeId; }
    if(!a.kundeId && a.kontaktId){ const k=this.kontakt(a.kontaktId); if(k) a.kundeId=k.kundeId; }
    Store.state.aktivitaeten.push(a);
    return a;
  },
  sys(text, ctx){ return this.log(Object.assign({typ:"system", betreff:text}, ctx||{})); },

  setStage(d, st, grund){
    const old=d.stage;
    if(old===st) return;
    const now=this.now();
    d.stage=st; d.updatedAt=now;
    d.chance=null;   /* Wahrscheinlichkeit folgt der neuen Phase */
    if(st==="gewonnen"){
      d.wonAt=now; d.lostAt=""; d.verlustgrund="";
      const f=this.firma(d.kundeId);
      if(f && f.status!=="kunde"){ f.status="kunde"; f.updatedAt=now; }
    } else if(st==="verloren"){
      d.lostAt=now; d.wonAt=""; d.verlustgrund=grund||d.verlustgrund||"";
    } else {
      d.wonAt=""; d.lostAt="";
      const f=this.firma(d.kundeId);
      if(f && f.status==="lead" && STAGE_IDX[st]>=STAGE_IDX.qualifiziert){ f.status="interessent"; f.updatedAt=now; }
    }
    this.sys(`Phase: ${stageLabel(old)} → ${stageLabel(st)}${st==="verloren"&&d.verlustgrund?" ("+d.verlustgrund+")":""}`,
      {kundeId:d.kundeId, dealId:d.id, kontaktId:d.kontaktId||""});
  },

  /* Angebot mit Firma, Kontakt und Verkaufschance verknüpfen –
     fehlende Datensätze werden (deterministisch) angelegt, damit
     parallele Geräte keine Dubletten erzeugen. Gelöschte
     Verknüpfungen werden nicht wiederbelebt. */
  ensureOfferLinks(o){
    const S=Store.state, now=this.now(), kd=o.doc.kunde||{};
    let changed=false;
    let f=o.kundeId ? this.firma(o.kundeId) : null;
    if(!o.kundeId && (kd.firma||"").trim()){
      const name=kd.firma.trim().toLowerCase();
      f=this.firmen().find(x=>(x.firma||"").trim().toLowerCase()===name);
      if(!f){
        const fid="kf-"+o.id;
        if(!S.kunden.some(x=>x.id===fid)){
          f={id:fid, firma:kd.firma.trim(), status:o.status==="angenommen"?"kunde":"interessent", branche:"",
             ownerId:this.userIdByName(o.doc.meta.betreuer)||o.createdBy||"", website:"", telefon:"",
             strasse:kd.strasse||"", plzort:kd.plzort||"", notiz:"", createdBy:o.createdBy||"", createdAt:now, updatedAt:now};
          S.kunden.push(f);
        }
      }
      if(f){ o.kundeId=f.id; changed=true; }
    }
    if(!f) return changed;

    if(!o.kontaktId && ((kd.name||"").trim() || (kd.email||"").trim())){
      const ks=this.kontakteVon(f.id);
      let k=null;
      if(kd.email) k=ks.find(x=>(x.email||"").toLowerCase()===kd.email.trim().toLowerCase());
      if(!k && kd.name) k=ks.find(x=>this.kontaktName(x).toLowerCase()===kd.name.trim().toLowerCase());
      if(!k){
        const kid="ktf-"+o.id;
        if(!S.kontakte.some(x=>x.id===kid)){
          const n=this.splitName(kd.name);
          k={id:kid, kundeId:f.id, anrede:kd.anrede||"", vorname:n.vorname, nachname:n.nachname,
             funktion:kd.funktion||"", rolle:"", email:(kd.email||"").trim(), telefon:"", mobil:"", linkedin:"",
             primary:!ks.length, notiz:"", createdBy:o.createdBy||"", createdAt:now, updatedAt:now};
          S.kontakte.push(k);
        }
      }
      if(k){ o.kontaktId=k.id; changed=true; }
    }

    if(!o.dealId){
      const did="dl-"+o.id;
      let d=S.deals.find(x=>x.id===did);
      if(!d){
        const st=o.status==="angenommen"?"gewonnen":(o.status==="abgelehnt"?"verloren":"angebot");
        const when=o.updatedAt||now;
        d={id:did, titel:o.doc.meta.betreff||("Angebot "+(o.doc.meta.nr||"")).trim(), kundeId:f.id,
           kontaktId:o.kontaktId||"", stage:st, wert:0, wertManuell:false, chance:null,
           abschluss:o.doc.meta.gueltig||"", ownerId:this.userIdByName(o.doc.meta.betreuer)||o.createdBy||"",
           quelle:"", verlustgrund:"", notiz:"", createdBy:o.createdBy||"", createdAt:o.createdAt||now, updatedAt:now,
           wonAt:st==="gewonnen"?when:"", lostAt:st==="verloren"?when:""};
        S.deals.push(d);
      }
      o.dealId=d.id; changed=true;
    }
    if(changed) o.updatedAt=now;
    return changed;
  },

  /* Status-Wechsel eines Angebots → CRM-Automatik */
  onOfferStatus(o, st){
    if(st!=="entwurf") this.ensureOfferLinks(o);
    const d=o.dealId ? this.deal(o.dealId) : null;
    const nr=o.doc.meta.nr||"ohne Nummer";
    const ctx={kundeId:o.kundeId||"", kontaktId:o.kontaktId||"", dealId:o.dealId||"", offerId:o.id};
    const bumpToOffer=()=>{ if(d && this.isOpen(d) && STAGE_IDX[d.stage]<STAGE_IDX.angebot) this.setStage(d,"angebot"); };
    if(st==="pruefung" || st==="freigegeben") bumpToOffer();
    if(st==="versendet"){ this.sys(`Angebot ${nr} versendet`, ctx); bumpToOffer(); }
    if(st==="angenommen"){
      this.sys(`Angebot ${nr} vom Kunden angenommen`, ctx);
      if(d && this.isOpen(d)) this.setStage(d,"gewonnen");
    }
    if(st==="abgelehnt") this.sys(`Angebot ${nr} vom Kunden abgelehnt`, ctx);
  },

  /* =========================================================
     Migration bestehender Daten (idempotent, bei jedem Laden
     und nach jedem Sync). Liefert true, wenn etwas geändert wurde.
     ========================================================= */
  migrate(){
    const S=Store.state; if(!S) return false;
    let changed=false;
    const now=this.now();
    for(const k of ["kontakte","deals","aktivitaeten"]) if(!Array.isArray(S[k])){ S[k]=[]; changed=true; }

    /* 1) Personenangaben alter Kundendatensätze → Kontakte */
    for(const k of S.kunden){
      if(k.deleted) continue;
      if(k.name || k.email || k.funktion){
        const id="kt-"+k.id;
        if(!S.kontakte.some(x=>x.id===id)){
          const n=this.splitName(k.name);
          S.kontakte.push({id, kundeId:k.id, anrede:k.anrede||"", vorname:n.vorname, nachname:n.nachname,
            funktion:k.funktion||"", rolle:"", email:k.email||"", telefon:k.telefon||"", mobil:"", linkedin:"",
            primary:true, notiz:"", createdAt:k.createdAt||now, updatedAt:now});
          delete k.telefon;
        }
        delete k.anrede; delete k.name; delete k.funktion; delete k.email;
        k.updatedAt=now; changed=true;
      }
    }
    /* 2) Nicht mehr in Bearbeitung befindliche Angebote verknüpfen und
          ihre bisherige Historie einmalig in die Timeline übernehmen */
    for(const o of S.offers){
      if(o.deleted || o.status==="entwurf") continue;
      if(this.ensureOfferLinks(o)) changed=true;
      if(!o.crmBackfill && o.kundeId){
        const nr=o.doc.meta.nr||"ohne Nummer";
        (o.history||[]).forEach((h,i)=>{
          const id="ah-"+o.id+"-"+i;
          if(S.aktivitaeten.some(x=>x.id===id)) return;
          const by=this.userIdByName(h.user)||o.createdBy||"";
          S.aktivitaeten.push({id, typ:"system", betreff:`Angebot ${nr}: ${h.text}`, text:"", datum:h.ts||o.createdAt||now,
            faellig:"", erledigt:false, erledigtAm:"", ownerId:by, createdBy:by, createdAt:h.ts||now, updatedAt:now,
            kundeId:o.kundeId, kontaktId:o.kontaktId||"", dealId:o.dealId||"", offerId:o.id});
        });
        o.crmBackfill=true; o.updatedAt=now; changed=true;
      }
    }
    /* 3) Lebenszyklus-Status der Firmen ableiten */
    for(const k of S.kunden){
      if(k.deleted || k.status) continue;
      const offs=S.offers.filter(o=>!o.deleted && o.kundeId===k.id);
      const won=S.deals.some(d=>!d.deleted && d.kundeId===k.id && d.stage==="gewonnen") || offs.some(o=>o.status==="angenommen");
      k.status=won?"kunde":(offs.length?"interessent":"lead");
      if(!k.ownerId){
        const latest=[...offs].sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""))[0];
        k.ownerId=latest?(this.userIdByName(latest.doc.meta.betreuer)||latest.createdBy||""):"";
      }
      k.updatedAt=now; changed=true;
    }
    return changed;
  },

  init(){
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k" && Auth.user){
        e.preventDefault(); this.openSearch();
      }
    });
  },

  rerender(){
    const cur=[...document.querySelectorAll(".view")].find(v=>!v.hidden);
    if(!cur) return;
    const name=cur.id.replace("view-","");
    if(name==="editor"){ Editor.updateBar(); return; }
    Views.render(name);
  },

  remember(t,id){
    this.recent=[{t,id},...this.recent.filter(r=>!(r.t===t&&r.id===id))].slice(0,6);
  },

  /* =========================================================
     Darstellungs-Bausteine
     ========================================================= */
  rel(iso){
    if(!iso) return "—";
    const d=new Date(iso); if(isNaN(d)) return "—";
    const day=localISO(d), today=localISO();
    const t=d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
    if(day===today) return "heute, "+t;
    if(day===addDaysLocal(today,-1)) return "gestern, "+t;
    const diff=Math.round((new Date(today+"T12:00:00")-new Date(day+"T12:00:00"))/864e5);
    if(diff>1 && diff<7) return `vor ${diff} Tagen`;
    return d.toLocaleDateString("de-DE");
  },
  relDay(day){
    if(!isDay(day)) return "—";
    const diff=Math.round((new Date(day+"T12:00:00")-new Date(localISO()+"T12:00:00"))/864e5);
    if(diff===0) return "heute";
    if(diff===1) return "morgen";
    if(diff===-1) return "gestern";
    if(diff>1 && diff<7) return `in ${diff} Tagen`;
    if(diff<-1 && diff>-7) return `vor ${-diff} Tagen`;
    return "am "+fdate(day);
  },
  firmaBadge(f){ const s=f.status||"lead"; return `<span class="badge fs-${sid(s)}">${esc(FIRMA_STATUS[s]||s)}</span>`; },
  stageBadge(d){ return `<span class="badge ds-${sid(d.stage)}">${esc(stageLabel(d.stage))}</span>`; },
  firmaLink(id){ const f=this.firma(id); return f?`<a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`:"—"; },
  kontaktLink(id){ const k=this.kontakt(id); return k?`<a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>`:"—"; },
  crumbs(parent, href, current){
    return `<nav class="crumbs" aria-label="Brotkrumen"><a href="${href}">${esc(parent)}</a><span aria-hidden="true">›</span><span aria-current="page">${esc(current)}</span></nav>`;
  },

  optFirmen(sel, emptyLabel){
    return `<option value="">${esc(emptyLabel||"— keine Firma —")}</option>`+
      [...this.firmen()].sort(byFirma).map(f=>`<option value="${sid(f.id)}"${f.id===sel?" selected":""}>${esc(f.firma)}</option>`).join("");
  },
  optKontakte(kundeId, sel){
    const list=kundeId?this.kontakteVon(kundeId):[];
    return `<option value="">${kundeId?"— kein Kontakt —":"— erst Firma wählen —"}</option>`+
      list.map(k=>`<option value="${sid(k.id)}"${k.id===sel?" selected":""}>${esc(this.kontaktName(k))}${k.funktion?" · "+esc(k.funktion):""}</option>`).join("");
  },
  optDeals(kundeId, sel){
    const list=kundeId?this.dealsVon(kundeId).filter(d=>this.isOpen(d)||d.id===sel):[];
    return `<option value="">— keine Verkaufschance —</option>`+
      list.map(d=>`<option value="${sid(d.id)}"${d.id===sel?" selected":""}>${esc(d.titel)} (${esc(stageLabel(d.stage))})</option>`).join("");
  },
  optUsers(sel, withEmpty){
    return (withEmpty?`<option value="">— nicht zugewiesen —</option>`:"")+
      this.activeUsers().map(u=>`<option value="${sid(u.id)}"${u.id===sel?" selected":""}>${esc(u.name)}</option>`).join("");
  },
  optOwnerFilter(sel){
    return `<option value="">Alle Betreuer</option><option value="me"${sel==="me"?" selected":""}>Nur meine</option>`+
      this.activeUsers().map(u=>`<option value="${sid(u.id)}"${u.id===sel?" selected":""}>${esc(u.name)}</option>`).join("");
  },
  bindLinkSelects(prefix){
    const fs=document.getElementById(prefix+"-firma");
    if(!fs) return;
    fs.addEventListener("change",()=>{
      document.getElementById(prefix+"-kontakt").innerHTML=this.optKontakte(fs.value,"");
      const ds=document.getElementById(prefix+"-deal");
      if(ds) ds.innerHTML=this.optDeals(fs.value,"");
    });
  },
  barsHTML(rows, fmt){
    if(!rows.length) return `<div class="empty">Noch keine Daten.</div>`;
    const max=Math.max(1,...rows.map(r=>r.v));
    return `<div class="bars">${rows.map(r=>`<div class="bar-row">
      <span class="bar-label">${esc(r.label)}</span>
      <span class="bar" aria-hidden="true"><span style="width:${Math.max(r.v>0?2:0,Math.round(r.v/max*100))}%"></span></span>
      <span class="bar-val">${fmt(r.v)}${r.note?`<small>${esc(r.note)}</small>`:""}</span></div>`).join("")}</div>`;
  },
  colsHTML(rows){
    const max=Math.max(1,...rows.map(r=>r.v));
    return `<div class="cols" role="img" aria-label="${esc(rows.map(r=>r.label+": "+fmtK(r.v)).join(", "))}">${rows.map(r=>`<div class="col">
      <span class="col-val">${r.v?fmtK(r.v):""}</span>
      <span class="col-bar"><span style="height:${Math.max(r.v>0?3:0,Math.round(r.v/max*100))}%"></span></span>
      <span class="col-label">${esc(r.label)}</span></div>`).join("")}</div>`;
  },
  kv(rows){
    return `<dl class="kv">${rows.filter(r=>r[1]!==null && r[1]!==undefined && r[1]!=="").map(r=>`<dt>${esc(r[0])}</dt><dd>${r[1]}</dd>`).join("")}</dl>`;
  },
  contactLinks(k){
    const out=[];
    if(k.email) out.push(`<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>`);
    if(k.telefon) out.push(`<a href="${esc(telHref(k.telefon))}">${esc(k.telefon)}</a>`);
    if(k.mobil) out.push(`<a href="${esc(telHref(k.mobil))}">${esc(k.mobil)} (mobil)</a>`);
    const li=safeUrl(k.linkedin);
    if(li) out.push(`<a href="${esc(li)}" target="_blank" rel="noopener">LinkedIn</a>`);
    return out.join(" · ");
  },

  /* ---------- Timeline ---------- */
  timelineHTML(filter, opts){
    const all=this.akts().filter(filter);
    if(!all.length) return `<div class="empty">Noch keine Einträge. Halte oben das erste Gespräch, eine Notiz oder eine Aufgabe fest.</div>`;
    const open=all.filter(a=>a.typ==="aufgabe"&&!a.erledigt).sort((a,b)=>(a.faellig||"9999").localeCompare(b.faellig||"9999"));
    const hist=all.filter(a=>!(a.typ==="aufgabe"&&!a.erledigt)).sort((a,b)=>this.whenOf(b).localeCompare(this.whenOf(a)));
    return `${open.length?`<div class="tl-group">Offene Aufgaben</div><ul class="timeline">${open.map(a=>this.aktItem(a,opts)).join("")}</ul>`:""}
      ${hist.length?`<div class="tl-group">Verlauf</div><ul class="timeline">${hist.map(a=>this.aktItem(a,opts)).join("")}</ul>`:""}`;
  },
  aktItem(a, opts){
    opts=opts||{};
    const ctx=[];
    if(!opts.hideFirma && a.kundeId){ const f=this.firma(a.kundeId); if(f) ctx.push(`<a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`); }
    if(!opts.hideDeal && a.dealId){ const d=this.deal(a.dealId); if(d) ctx.push(`<a href="#/deal/${sid(d.id)}">${esc(d.titel)}</a>`); }
    if(!opts.hideKontakt && a.kontaktId){ const k=this.kontakt(a.kontaktId); if(k) ctx.push(`<a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>`); }
    if(a.offerId){ const o=Store.offer(a.offerId); if(o) ctx.push(`<a href="#/angebot/${sid(o.id)}">${esc(o.doc.meta.nr||"Angebot")}</a>`); }
    const isTask=a.typ==="aufgabe";
    const overdue=isTask && !a.erledigt && a.faellig && a.faellig<localISO();
    const canEdit=a.typ!=="system";
    const canDel=canEdit && (Auth.isAdmin() || a.createdBy===this.me());
    const meta=isTask
      ? `${a.erledigt?"erledigt "+this.rel(a.erledigtAm):(overdue?"Überfällig · fällig "+this.relDay(a.faellig):(a.faellig?"fällig "+this.relDay(a.faellig):"ohne Fälligkeit"))} · ${esc(this.userName(a.ownerId))}`
      : `${this.rel(a.datum)} · ${esc(this.userName(a.createdBy))}`;
    return `<li class="tl-item tl-${sid(a.typ)}${a.erledigt?" done":""}">
      <div class="tl-type">${isTask?`<input type="checkbox" aria-label="Aufgabe erledigt" ${a.erledigt?"checked":""} onchange="CRM.toggleTask('${sid(a.id)}',this.checked)">`:""}<span>${esc(AKT_TYPES[a.typ]||a.typ)}</span></div>
      <div class="tl-body">
        <div class="tl-head">${a.betreff?`<b>${esc(a.betreff)}</b>`:""}<span class="tl-meta${overdue?" overdue":""}">${meta}${ctx.length?" · "+ctx.join(" · "):""}</span></div>
        ${a.text?`<div class="tl-text">${nlLink(a.text)}</div>`:""}
      </div>
      ${canEdit?`<div class="tl-actions"><button type="button" class="btn-link" onclick="CRM.editAkt('${sid(a.id)}')">Bearbeiten</button>${canDel?`<button type="button" class="btn-link danger" onclick="CRM.deleteAkt('${sid(a.id)}')">Löschen</button>`:""}</div>`:""}
    </li>`;
  },

  /* ---------- Schnell-Erfassung (Composer) ---------- */
  ctxKey(c){ return [c.kundeId||"",c.kontaktId||"",c.dealId||""].join("|"); },
  composerHTML(ctx){
    this.cctx=ctx;
    const dr=this.drafts[this.ctxKey(ctx)]||{};
    const typ=dr.typ||"notiz";
    const isTask=typ==="aufgabe";
    const today=localISO();
    const fixKontakt=!!ctx.fixKontakt, fixDeal=!!ctx.fixDeal;
    const linkKontakt=dr.kontaktId!==undefined?dr.kontaktId:(ctx.kontaktId||"");
    const linkDeal=dr.dealId!==undefined?dr.dealId:(ctx.dealId||"");
    return `<div class="card composer" id="composer">
      <div class="seg" role="group" aria-label="Art des Eintrags">${LOG_TYPES.map(t=>`<button type="button" class="${t===typ?"active":""}" aria-pressed="${t===typ}" onclick="CRM.setCompType('${t}')">${AKT_TYPES[t]}</button>`).join("")}</div>
      <label><span>${isTask?"Was ist zu tun? *":"Betreff"}</span>
        <input type="text" id="cp-betreff" value="${esc(dr.betreff||"")}" placeholder="${isTask?"z. B. Angebot nachfassen":"z. B. Erstgespräch zum Podcast-Sponsoring"}" oninput="CRM.saveDraft()"></label>
      <label><span>${isTask?"Details (optional)":"Notiz / Gesprächsinhalt"}</span>
        <textarea id="cp-text" rows="3" placeholder="${isTask?"":"Was wurde besprochen, was sind die nächsten Schritte?"}" oninput="CRM.saveDraft()">${esc(dr.text||"")}</textarea></label>
      <div class="row thirds">
        <label><span>${isTask?"Fällig am":"Datum"}</span><input type="date" id="cp-date" value="${esc(dr.date||(isTask?addDaysLocal(today,1):today))}" onchange="CRM.saveDraft()"></label>
        ${isTask?`<label><span>Zuständig</span><select id="cp-owner" onchange="CRM.saveDraft()">${this.optUsers(dr.ownerId||this.me())}</select></label>`:""}
        ${!fixKontakt&&ctx.kundeId?`<label><span>Kontakt</span><select id="cp-kontakt" onchange="CRM.saveDraft()">${this.optKontakte(ctx.kundeId,linkKontakt)}</select></label>`:""}
        ${!fixDeal&&ctx.kundeId?`<label><span>Verkaufschance</span><select id="cp-deal" onchange="CRM.saveDraft()">${this.optDeals(ctx.kundeId,linkDeal)}</select></label>`:""}
      </div>
      <div class="inline-actions" style="justify-content:flex-end"><button type="button" class="btn blue" onclick="CRM.saveComposer()">${isTask?"Aufgabe anlegen":"Eintrag speichern"}</button></div>
    </div>`;
  },
  saveDraft(){
    if(!this.cctx) return;
    const v=id=>{ const el=document.getElementById(id); return el?el.value:undefined; };
    const key=this.ctxKey(this.cctx);
    const dr=this.drafts[key]||{};
    dr.betreff=v("cp-betreff")||""; dr.text=v("cp-text")||""; dr.date=v("cp-date")||"";
    if(v("cp-owner")!==undefined) dr.ownerId=v("cp-owner");
    if(v("cp-kontakt")!==undefined) dr.kontaktId=v("cp-kontakt");
    if(v("cp-deal")!==undefined) dr.dealId=v("cp-deal");
    this.drafts[key]=dr;
  },
  setCompType(t){
    if(!this.cctx) return;
    this.saveDraft();
    const key=this.ctxKey(this.cctx);
    const dr=this.drafts[key]||{};
    const wasTask=dr.typ==="aufgabe";
    dr.typ=t;
    if(wasTask!==(t==="aufgabe")) dr.date="";   /* Datum passend zum Typ neu vorbelegen */
    this.drafts[key]=dr;
    const el=document.getElementById("composer");
    if(el) el.outerHTML=this.composerHTML(this.cctx);
    const b=document.getElementById("cp-betreff"); if(b) b.focus();
  },
  saveComposer(){
    this.saveDraft();
    const ctx=this.cctx, key=this.ctxKey(ctx), dr=this.drafts[key]||{};
    const typ=dr.typ||"notiz";
    const betreff=(dr.betreff||"").trim(), text=(dr.text||"").trim();
    if(typ==="aufgabe" && !betreff){ toast("Bitte beschreiben, was zu tun ist"); document.getElementById("cp-betreff").focus(); return; }
    if(typ!=="aufgabe" && !betreff && !text){ toast("Bitte Betreff oder Notiz eintragen"); document.getElementById("cp-text").focus(); return; }
    const today=localISO();
    const data={typ, betreff, text, kundeId:ctx.kundeId||"",
      kontaktId:ctx.fixKontakt?ctx.kontaktId:(dr.kontaktId!==undefined?dr.kontaktId:(ctx.kontaktId||"")),
      dealId:ctx.fixDeal?ctx.dealId:(dr.dealId!==undefined?dr.dealId:(ctx.dealId||""))};
    if(typ==="aufgabe"){ data.faellig=dr.date||""; data.ownerId=dr.ownerId||this.me(); }
    else data.datum=(!dr.date||dr.date===today)?this.now():new Date(dr.date+"T12:00:00").toISOString();
    this.log(data);
    delete this.drafts[key];
    Store.save();
    toast(typ==="aufgabe"?"Aufgabe angelegt":`${AKT_TYPES[typ]} gespeichert`);
    this.rerender();
  },
  toggleTask(id, done){
    const a=this.akt(id); if(!a) return;
    a.erledigt=!!done; a.erledigtAm=done?this.now():""; a.updatedAt=this.now();
    Store.save();
    toast(done?"Aufgabe erledigt":"Aufgabe wieder geöffnet");
    this.rerender();
  },
  deleteAkt(id){
    const a=this.akt(id); if(!a) return;
    Modal.confirm("Eintrag löschen?", `„${esc(a.betreff||AKT_TYPES[a.typ])}“ wird gelöscht.`, "Löschen", ()=>{
      a.deleted=true; a.updatedAt=this.now(); Store.save();
      toast("Eintrag gelöscht"); this.rerender();
    }, true);
  },

  /* =========================================================
     Dashboard
     ========================================================= */
  dashboard(){
    const me=this.me(), today=localISO(), year=today.slice(0,4), yStart=year+"-01-01";
    const deals=this.deals(), open=deals.filter(d=>this.isOpen(d));
    const pipe=open.reduce((a,d)=>a+this.dealValue(d),0);
    const wsum=open.reduce((a,d)=>a+this.weighted(d),0);
    const won=deals.filter(d=>d.stage==="gewonnen" && this.closedDay(d)>=yStart);
    const lost=deals.filter(d=>d.stage==="verloren" && this.closedDay(d)>=yStart);
    const wonSum=won.reduce((a,d)=>a+this.dealValue(d),0);
    const quote=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):null;
    const myTasks=this.akts().filter(a=>a.typ==="aufgabe" && !a.erledigt && a.ownerId===me);
    const overdue=myTasks.filter(a=>a.faellig && a.faellig<today);
    const dueNow=myTasks.filter(a=>a.faellig && a.faellig<=today);
    const soon=myTasks.filter(a=>a.faellig && a.faellig<=addDaysLocal(today,7)).sort((a,b)=>a.faellig.localeCompare(b.faellig)).slice(0,8);
    const pending=Store.activeOffers().filter(o=>o.status==="pruefung");
    const closing=open.filter(d=>d.abschluss && d.abschluss<=addDaysLocal(today,30)).sort((a,b)=>a.abschluss.localeCompare(b.abschluss)).slice(0,7);

    const offers=Store.activeOffers();
    const wv=offers.filter(o=>["entwurf","pruefung","freigegeben","versendet"].includes(o.status) && o.doc.intern && o.doc.intern.wiedervorlage && o.doc.intern.wiedervorlage<=today)
      .map(o=>({o,hint:"Wiedervorlage "+this.relDay(o.doc.intern.wiedervorlage)}));
    const expiring=offers.filter(o=>["freigegeben","versendet"].includes(o.status) && o.doc.meta.gueltig && o.doc.meta.gueltig>=today && o.doc.meta.gueltig<=addDaysLocal(today,7) && !wv.some(x=>x.o.id===o.id))
      .map(o=>({o,hint:"gültig bis "+fdate(o.doc.meta.gueltig)}));
    const watch=[...wv,...expiring].slice(0,6);

    const tm=this.touchMap(), cutoff=addDaysLocal(today,-60);
    const quiet=this.firmen().filter(f=>["kunde","interessent"].includes(f.status))
      .map(f=>({f,t:tm[f.id]||""})).filter(x=>!x.t || dayOf(x.t)<cutoff)
      .sort((a,b)=>(a.t||"").localeCompare(b.t||"")).slice(0,6);
    const feed=this.akts().filter(a=>a.typ!=="aufgabe"||a.erledigt).sort((a,b)=>this.whenOf(b).localeCompare(this.whenOf(a))).slice(0,6);

    const h=new Date().getHours();
    const gruss=h<11?"Guten Morgen":(h<18?"Guten Tag":"Guten Abend");
    document.getElementById("dash-greeting").textContent=
      `${gruss}, ${(Auth.user.name||"").split(" ")[0]} · ${new Date().toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}`;

    const taskRow=a=>`<li class="task-li">
      <input type="checkbox" aria-label="Erledigt" onchange="CRM.toggleTask('${sid(a.id)}',this.checked)">
      <div class="lp-main"><b><button type="button" class="btn-link plain" onclick="CRM.editAkt('${sid(a.id)}')">${esc(a.betreff)}</button></b>
        <span class="${a.faellig<today?"overdue":""}">${a.faellig<today?"Überfällig · ":""}fällig ${this.relDay(a.faellig)}${a.kundeId?" · "+this.firmaLink(a.kundeId):""}</span></div></li>`;
    const pipeRows=OPEN_STAGES.map(k=>{ const ds=open.filter(d=>d.stage===k); return {label:stageLabel(k), v:ds.reduce((a,d)=>a+this.dealValue(d),0), note:` · ${ds.length} Chance${ds.length===1?"":"n"}`}; });

    document.getElementById("dash-content").innerHTML=`
      <div class="kpi-row">
        <div class="kpi-tile"><div class="kt-label">Offene Pipeline</div><div class="kt-value">${fmtEUR0(pipe)}</div><div class="kt-note">gewichtet ${fmtEUR0(wsum)} · ${open.length} Chance${open.length===1?"":"n"}</div></div>
        <div class="kpi-tile dark"><div class="kt-label">Gewonnen ${year}</div><div class="kt-value">${fmtEUR0(wonSum)}</div><div class="kt-note">${won.length} Abschl${won.length===1?"uss":"üsse"}</div></div>
        <div class="kpi-tile"><div class="kt-label">Abschlussquote ${year}</div><div class="kt-value">${quote===null?"—":quote+" %"}</div><div class="kt-note">${won.length} gewonnen · ${lost.length} verloren</div></div>
        <div class="kpi-tile"><div class="kt-label">Meine Aufgaben fällig</div><div class="kt-value">${dueNow.length}</div><div class="kt-note">${overdue.length?`<span class="overdue">davon ${overdue.length} überfällig</span>`:"nichts überfällig"} · <a href="#/aufgaben">alle Aufgaben</a></div></div>
        ${Auth.isAdmin()?`<div class="kpi-tile"><div class="kt-label">Offene Freigaben</div><div class="kt-value">${pending.length}</div><div class="kt-note">${pending.length?'<a href="#/freigaben">Zur Freigabe-Liste</a>':"Nichts zu prüfen"}</div></div>`:""}
      </div>
      <div class="cardgrid cols-2">
        <div class="card"><h2>Meine Aufgaben · nächste 7 Tage<span class="h2-action"><button type="button" class="btn" onclick="CRM.editAkt(null,{typ:'aufgabe'})">＋ Aufgabe</button></span></h2>
          ${soon.length?`<ul class="list-plain">${soon.map(taskRow).join("")}</ul>`
            :`<div class="empty">Keine fälligen Aufgaben. Aufgaben entstehen im Composer einer Firma, Verkaufschance oder eines Kontakts – oder direkt über „＋ Aufgabe".</div>`}
        </div>
        <div class="card"><h2>Pipeline nach Phase<span class="h2-action"><a class="btn" href="#/pipeline">Zur Pipeline</a></span></h2>
          ${open.length?this.barsHTML(pipeRows, fmtEUR0):`<div class="empty"><b>Noch keine Verkaufschancen</b>Lege die erste Chance an – oder gib ein Angebot frei, dann entsteht sie automatisch.<br><button type="button" class="btn blue" onclick="CRM.editDeal()">＋ Verkaufschance</button></div>`}
        </div>
        <div class="card"><h2>Anstehende Abschlüsse · 30 Tage</h2>
          ${closing.length?`<ul class="list-plain">${closing.map(d=>`<li><div class="lp-main"><b><a href="#/deal/${sid(d.id)}">${esc(d.titel)}</a></b>
            <span class="${d.abschluss<today?"overdue":""}">${d.abschluss<today?"Abschlussdatum überschritten · ":""}${this.relDay(d.abschluss)} · ${this.firmaLink(d.kundeId)}</span></div>
            <div class="lp-side">${this.stageBadge(d)}<span class="mono">${fmtEUR0(this.dealValue(d))}</span></div></li>`).join("")}</ul>`
            :`<div class="empty">Keine Verkaufschance mit erwartetem Abschluss in den nächsten 30 Tagen.</div>`}
        </div>
        <div class="card"><h2>Angebote im Blick</h2>
          ${watch.length?`<ul class="list-plain">${watch.map(x=>`<li><div class="lp-main"><b><a href="#/angebot/${sid(x.o.id)}">${esc(x.o.doc.meta.nr||"ohne Nummer")} · ${esc(x.o.doc.kunde.firma||"(ohne Firma)")}</a></b>
            <span>${esc(x.hint)}</span></div><div class="lp-side">${badge(x.o)}</div></li>`).join("")}</ul>`
            :`<div class="empty">Keine fälligen Wiedervorlagen und kein Angebot, das in den nächsten 7 Tagen abläuft.</div>`}
        </div>
        <div class="card"><h2>Ruhende Kunden &amp; Interessenten · 60+ Tage</h2>
          ${quiet.length?`<ul class="list-plain">${quiet.map(x=>`<li><div class="lp-main"><b><a href="#/firma/${sid(x.f.id)}">${esc(x.f.firma)}</a></b>
            <span>${x.t?"letzter Kontakt "+this.rel(x.t):"noch kein Kontakt erfasst"} · ${esc(this.userName(x.f.ownerId))}</span></div><div class="lp-side">${this.firmaBadge(x.f)}</div></li>`).join("")}</ul>`
            :`<div class="empty">Alle Kunden und Interessenten wurden in den letzten 60 Tagen kontaktiert.</div>`}
        </div>
        <div class="card" style="grid-column:1/-1"><h2>Zuletzt im Team</h2>
          ${feed.length?`<ul class="timeline compact">${feed.map(a=>this.aktItem(a)).join("")}</ul>`:`<div class="empty">Noch keine Aktivitäten erfasst.</div>`}
        </div>
      </div>`;
  },

  /* =========================================================
     Pipeline (Kanban)
     ========================================================= */
  pipeline(){
    const ui=this.ui.pipeline, today=localISO(), recent=addDaysLocal(today,-30);
    const deals=this.deals().filter(d=>this.ownerMatch(d.ownerId,ui.owner));
    const open=deals.filter(d=>this.isOpen(d));
    const card=d=>{
      const late=this.isOpen(d) && d.abschluss && d.abschluss<today;
      const offs=this.offersVonDeal(d.id).length;
      return `<a class="kcard" href="#/deal/${sid(d.id)}" draggable="true" ondragstart="CRM.dragStart(event,'${sid(d.id)}')" ondragend="CRM.dragEnd(event)">
        <b>${esc(d.titel)}</b>
        <span class="kc-firma">${esc((this.firma(d.kundeId)||{}).firma||"—")}</span>
        <span class="kc-row"><span class="mono">${fmtEUR0(this.dealValue(d))}</span>${this.isOpen(d)?`<span class="kc-chance">${this.dealChance(d)} %</span>`:""}</span>
        <span class="kc-foot"><span class="${late?"overdue":""}">${!this.isOpen(d)?fdate(this.closedDay(d)):(d.abschluss?(late?"Überfällig · ":"")+fdate(d.abschluss):"kein Abschlussdatum")}</span>
          <span class="kc-tags">${offs?`<span class="chip">${offs} Angebot${offs===1?"":"e"}</span>`:""}<span class="avatar" title="${esc(this.userName(d.ownerId))}">${esc(this.initials(d.ownerId))}</span></span></span>
      </a>`;
    };
    const cols=CRM_STAGES.map(s=>{
      const isOpenCol=OPEN_STAGES.includes(s.k);
      let items=deals.filter(d=>d.stage===s.k);
      if(!isOpenCol) items=items.filter(d=>this.closedDay(d)>=recent).sort((a,b)=>this.closedDay(b).localeCompare(this.closedDay(a)));
      else items.sort((a,b)=>(a.abschluss||"9999").localeCompare(b.abschluss||"9999"));
      const sum=items.reduce((a,d)=>a+this.dealValue(d),0);
      return `<section class="kcol kcol-${s.k}" data-stage="${s.k}" aria-label="${esc(s.label)}" ondragover="CRM.dragOver(event)" ondragleave="CRM.dragLeave(event)" ondrop="CRM.drop(event)">
        <header class="kcol-head"><b>${esc(s.label)}</b><span class="kcol-n">${items.length}</span></header>
        <div class="kcol-sum">${fmtEUR0(sum)}${isOpenCol?` · ${s.chance} %`:" · 30 Tage"}</div>
        <div class="kcol-body">${items.map(card).join("")||`<div class="kcol-empty">${isOpenCol?"Keine Chancen":"Hierher ziehen"}</div>`}</div>
      </section>`;
    }).join("");
    document.getElementById("pipeline-root").innerHTML=`
      <div class="pagehead">
        <div><h1>Pipeline</h1><div class="ph-sub">${open.length} offene Chance${open.length===1?"":"n"} · ${fmtEUR0(open.reduce((a,d)=>a+this.dealValue(d),0))} · gewichtet ${fmtEUR0(open.reduce((a,d)=>a+this.weighted(d),0))}</div></div>
        <div class="spacer"></div>
        <select aria-label="Nach Betreuer filtern" onchange="CRM.ui.pipeline.owner=this.value;CRM.pipeline()">${this.optOwnerFilter(ui.owner)}</select>
        <button type="button" class="btn blue" onclick="CRM.editDeal()">＋ Verkaufschance</button>
      </div>
      <div class="content">
        <div class="hint" style="margin-bottom:12px">Karten per Drag &amp; Drop in die nächste Phase ziehen – oder die Chance öffnen und dort die Phase wählen. Gewonnen/Verloren zeigt die letzten 30 Tage.</div>
        <div class="kanban">${cols}</div>
      </div>`;
  },
  dragStart(e,id){ e.dataTransfer.setData("text/x-adam-deal",id); e.dataTransfer.effectAllowed="move"; e.currentTarget.classList.add("dragging"); },
  dragEnd(e){ e.currentTarget.classList.remove("dragging"); document.querySelectorAll(".kcol.drop").forEach(c=>c.classList.remove("drop")); },
  dragOver(e){ if([...e.dataTransfer.types].includes("text/x-adam-deal")){ e.preventDefault(); e.currentTarget.classList.add("drop"); } },
  dragLeave(e){ if(!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("drop"); },
  drop(e){
    e.preventDefault();
    const col=e.currentTarget; col.classList.remove("drop");
    const id=e.dataTransfer.getData("text/x-adam-deal");
    if(id) this.moveDeal(id, col.dataset.stage);
  },
  moveDeal(id, st){
    const d=this.deal(id); if(!d || d.stage===st) return;
    if(st==="verloren") return this.markLost(id);
    if(st==="gewonnen") return this.markWon(id);
    this.setStage(d, st); Store.save();
    toast(`„${d.titel}“ → ${stageLabel(st)}`);
    this.rerender();
  },
  markWon(id){
    const d=this.deal(id); if(!d) return;
    const f=this.firma(d.kundeId);
    Modal.confirm("Als gewonnen markieren?",
      `<b>${esc(d.titel)}</b> (${fmtEUR(this.dealValue(d))}) wird als gewonnen verbucht${f?`; <b>${esc(f.firma)}</b> wird als Kunde geführt`:""}.`,
      "Als gewonnen markieren", ()=>{
        this.setStage(d,"gewonnen"); Store.save();
        toast(`„${d.titel}“ als gewonnen verbucht`); this.rerender();
      });
  },
  markLost(id){
    const d=this.deal(id); if(!d) return;
    Modal.open(`<h3>Verkaufschance verloren</h3>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px"><b>${esc(d.titel)}</b> wird als verloren verbucht. Der Grund fließt in die Berichte ein.</p>
      <div class="row single"><label><span>Verlustgrund *</span><select id="ls-grund"><option value="">— bitte wählen —</option>${VERLUSTGRUENDE.map(g=>`<option>${esc(g)}</option>`).join("")}</select></label></div>
      <div class="row single"><label><span>Notiz (optional)</span><textarea id="ls-notiz" rows="3" placeholder="z. B. Budget auf 2027 verschoben – im Q1 erneut ansprechen"></textarea></label></div>
      <div class="modal-actions"><button type="button" class="btn" onclick="Modal.close()">Abbrechen</button><button type="button" class="btn danger" id="ls-save">Als verloren verbuchen</button></div>`);
    document.getElementById("ls-save").onclick=()=>{
      const grund=document.getElementById("ls-grund").value;
      if(!grund){ toast("Bitte einen Verlustgrund wählen"); document.getElementById("ls-grund").focus(); return; }
      this.setStage(d,"verloren",grund);
      const notiz=document.getElementById("ls-notiz").value.trim();
      if(notiz) this.log({typ:"notiz", betreff:"Verlust-Notiz", text:notiz, dealId:d.id, kundeId:d.kundeId, kontaktId:d.kontaktId||""});
      Store.save(); Modal.close();
      toast(`„${d.titel}“ als verloren verbucht`); this.rerender();
    };
  },
  reopenDeal(id){
    const d=this.deal(id); if(!d) return;
    this.setStage(d,"verhandlung"); Store.save();
    toast("Verkaufschance wieder geöffnet"); this.rerender();
  },

  /* =========================================================
     Firmen
     ========================================================= */
  firmenList(){
    const ids=["firmen-search","firmen-status","firmen-branche","firmen-owner"];
    const ow=document.getElementById("firmen-owner");
    const curOw=ow.value;
    ow.innerHTML=this.optOwnerFilter(curOw);
    const br=document.getElementById("firmen-branche");
    if(br.options.length<=1) br.insertAdjacentHTML("beforeend",BRANCHEN.map(b=>`<option>${esc(b)}</option>`).join(""));
    const st=document.getElementById("firmen-status");
    if(st.options.length<=1) st.insertAdjacentHTML("beforeend",Object.entries(FIRMA_STATUS).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join(""));
    ids.forEach(id=>{ const el=document.getElementById(id);
      if(!el._bound){ el._bound=true; el.addEventListener("input",()=>this.renderFirmenTable()); el.addEventListener("change",()=>this.renderFirmenTable()); } });
    this.renderFirmenTable();
  },
  renderFirmenTable(){
    const host=document.getElementById("firmen-table"); if(!host) return;
    const q=(document.getElementById("firmen-search").value||"").trim().toLowerCase();
    const st=document.getElementById("firmen-status").value;
    const br=document.getElementById("firmen-branche").value;
    const ow=document.getElementById("firmen-owner").value;
    const tm=this.touchMap();
    const kontakte=this.kontakte(), deals=this.deals();
    const all=this.firmen();
    const list=[...all].filter(f=>(!st||f.status===st) && (!br||f.branche===br) && this.ownerMatch(f.ownerId,ow))
      .filter(f=>{
        if(!q) return true;
        const names=kontakte.filter(k=>k.kundeId===f.id).map(k=>this.kontaktName(k)+" "+(k.email||"")).join(" ");
        return [f.firma,f.plzort,f.branche,f.website,names].join(" ").toLowerCase().includes(q);
      }).sort(byFirma);
    document.getElementById("firmen-count").textContent=`${list.length} von ${all.length} Firmen`;
    if(!list.length){
      host.innerHTML=all.length
        ?`<div class="empty"><b>Keine Treffer</b>Filter oder Suchbegriff anpassen.</div>`
        :`<div class="empty"><b>Noch keine Firmen</b>Firmen entstehen per Excel-/CSV-Import, beim Speichern aus einem Angebot – oder hier manuell.<br>
          <button type="button" class="btn" onclick="document.getElementById('kunden-import-file').click()">Excel/CSV importieren</button>
          <button type="button" class="btn blue" onclick="CRM.editFirma()">＋ Neue Firma</button></div>`;
      return;
    }
    host.innerHTML=`<table class="data"><thead><tr>
      <th>Firma</th><th>Status</th><th>Betreuung</th><th class="num">Kontakte</th><th class="num">Offene Chancen</th><th>Letzter Kontakt</th>
    </tr></thead><tbody>${list.map(f=>{
      const ks=kontakte.filter(k=>k.kundeId===f.id);
      const od=deals.filter(d=>d.kundeId===f.id && this.isOpen(d));
      const hk=ks.find(k=>k.primary)||ks[0];
      return `<tr class="clickable" onclick="location.hash='#/firma/${sid(f.id)}'">
        <td><a class="rowlink" href="#/firma/${sid(f.id)}" onclick="event.stopPropagation()"><b>${esc(f.firma)}</b></a><span class="sub">${esc([f.branche,f.plzort].filter(Boolean).join(" · "))||"&nbsp;"}</span></td>
        <td>${this.firmaBadge(f)}</td>
        <td>${esc(this.userName(f.ownerId))}</td>
        <td class="num">${ks.length}${hk?`<span class="sub">${esc(this.kontaktName(hk))}</span>`:""}</td>
        <td class="num">${od.length?`${od.length} · ${fmtEUR0(od.reduce((a,d)=>a+this.dealValue(d),0))}`:"—"}</td>
        <td>${tm[f.id]?this.rel(tm[f.id]):"—"}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  },

  firmaDetail(id){
    const root=document.getElementById("firma-root");
    const f=this.firma(id);
    if(!f){ root.innerHTML=`<div class="content"><div class="card"><div class="empty"><b>Firma nicht gefunden</b>Sie wurde möglicherweise gelöscht.<br><a class="btn" href="#/firmen">Zur Firmenliste</a></div></div></div>`; return; }
    this.remember("firma",f.id);
    const ks=this.kontakteVon(f.id);
    const ds=this.dealsVon(f.id).sort((a,b)=>(this.isOpen(b)?1:0)-(this.isOpen(a)?1:0) || (b.updatedAt||"").localeCompare(a.updatedAt||""));
    const offs=this.offersVonFirma(f.id).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    const web=safeUrl(f.website);
    const last=this.touchMap()[f.id];
    const openDeals=ds.filter(d=>this.isOpen(d));
    root.innerHTML=`
      <div class="pagehead">
        <div>${this.crumbs("Firmen","#/firmen",f.firma)}
          <h1>${esc(f.firma)} ${this.firmaBadge(f)}</h1>
          <div class="ph-sub">${esc([f.branche,f.plzort,"Betreuung: "+this.userName(f.ownerId)].filter(Boolean).join(" · "))}</div></div>
        <div class="spacer"></div>
        <button type="button" class="btn" onclick="CRM.editFirma('${sid(f.id)}')">Bearbeiten</button>
        <button type="button" class="btn" onclick="Views.newOffer({kundeId:'${sid(f.id)}'})">＋ Angebot</button>
        <button type="button" class="btn blue" onclick="CRM.editDeal(null,{kundeId:'${sid(f.id)}'})">＋ Verkaufschance</button>
        ${Auth.isAdmin()?`<button type="button" class="btn danger" onclick="CRM.deleteFirma('${sid(f.id)}')">Löschen</button>`:""}
      </div>
      <div class="content">
        <div class="kpi-row slim">
          <div class="kpi-tile"><div class="kt-label">Offene Chancen</div><div class="kt-value">${fmtEUR0(openDeals.reduce((a,d)=>a+this.dealValue(d),0))}</div><div class="kt-note">${openDeals.length} offen</div></div>
          <div class="kpi-tile"><div class="kt-label">Umsatz gewonnen</div><div class="kt-value">${fmtEUR0(ds.filter(d=>d.stage==="gewonnen").reduce((a,d)=>a+this.dealValue(d),0))}</div><div class="kt-note">gesamt</div></div>
          <div class="kpi-tile"><div class="kt-label">Letzter Kontakt</div><div class="kt-value small">${last?this.rel(last):"—"}</div><div class="kt-note">${ks.length} Kontakt${ks.length===1?"":"e"}</div></div>
        </div>
        <div class="detail-grid">
          <div class="dg-main">
            ${this.composerHTML({kundeId:f.id})}
            <div class="card"><h2>Aktivitäten &amp; Verlauf</h2>${this.timelineHTML(a=>a.kundeId===f.id,{hideFirma:true})}</div>
          </div>
          <div class="dg-side">
            <div class="card"><h2>Stammdaten</h2>${this.kv([
              ["Status", this.firmaBadge(f)],
              ["Branche", esc(f.branche)],
              ["Betreuung", esc(this.userName(f.ownerId))],
              ["Adresse", esc([f.strasse,f.plzort].filter(Boolean).join(", "))],
              ["Zentrale", f.telefon?`<a href="${esc(telHref(f.telefon))}">${esc(f.telefon)}</a>`:""],
              ["Website", web?`<a href="${esc(web)}" target="_blank" rel="noopener">${esc(f.website)}</a>`:esc(f.website)],
              ["Notiz", f.notiz?nlLink(f.notiz):""]
            ])}</div>
            <div class="card"><h2>Kontakte<span class="h2-action"><button type="button" class="btn" onclick="CRM.editKontakt(null,{kundeId:'${sid(f.id)}'})">＋ Kontakt</button></span></h2>
              ${ks.length?`<ul class="list-plain">${ks.map(k=>`<li><div class="lp-main"><b><a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>${k.primary?` <span class="chip">Hauptkontakt</span>`:""}</b>
                <span>${esc([k.funktion,k.rolle].filter(Boolean).join(" · "))}</span><span>${this.contactLinks(k)}</span></div></li>`).join("")}</ul>`
                :`<div class="empty">Noch keine Ansprechpartner hinterlegt.</div>`}
            </div>
            <div class="card"><h2>Verkaufschancen<span class="h2-action"><button type="button" class="btn" onclick="CRM.editDeal(null,{kundeId:'${sid(f.id)}'})">＋</button></span></h2>
              ${ds.length?`<ul class="list-plain">${ds.map(d=>`<li><div class="lp-main"><b><a href="#/deal/${sid(d.id)}">${esc(d.titel)}</a></b>
                <span>${d.abschluss&&this.isOpen(d)?"Abschluss "+this.relDay(d.abschluss):esc(this.userName(d.ownerId))}</span></div>
                <div class="lp-side">${this.stageBadge(d)}<span class="mono">${fmtEUR0(this.dealValue(d))}</span></div></li>`).join("")}</ul>`
                :`<div class="empty">Noch keine Verkaufschance.</div>`}
            </div>
            <div class="card"><h2>Angebote<span class="h2-action"><button type="button" class="btn" onclick="Views.newOffer({kundeId:'${sid(f.id)}'})">＋</button></span></h2>
              ${offs.length?`<ul class="list-plain">${offs.map(o=>`<li><div class="lp-main"><b><a href="#/angebot/${sid(o.id)}">${esc(o.doc.meta.nr||"ohne Nummer")}</a></b>
                <span>${esc(o.doc.meta.betreff||"")}</span></div><div class="lp-side">${badge(o)}<span class="mono">${fmtEUR0(Store.calc(o.doc).nettoR)}</span></div></li>`).join("")}</ul>`
                :`<div class="empty">Noch kein Angebot.</div>`}
            </div>
          </div>
        </div>
      </div>`;
  },

  editFirma(id){
    const f=id?this.firma(id):{firma:"",status:"lead",branche:"",ownerId:this.me(),website:"",telefon:"",strasse:"",plzort:"",notiz:""};
    if(id && !f) return;
    const isNew=!id;
    Modal.open(`<h3>${isNew?"Neue Firma":"Firma bearbeiten"}</h3>
      <div class="row single"><label><span>Firmenname *</span><input type="text" id="fm-firma" value="${esc(f.firma)}"></label></div>
      <div class="row thirds">
        <label><span>Status</span><select id="fm-status">${Object.entries(FIRMA_STATUS).map(([k,v])=>`<option value="${k}"${(f.status||"lead")===k?" selected":""}>${esc(v)}</option>`).join("")}</select></label>
        <label><span>Branche</span><select id="fm-branche"><option value="">—</option>${BRANCHEN.map(b=>`<option${f.branche===b?" selected":""}>${esc(b)}</option>`).join("")}</select></label>
        <label><span>Betreuung</span><select id="fm-owner">${this.optUsers(f.ownerId,true)}</select></label>
      </div>
      <div class="row">
        <label><span>Website</span><input type="text" id="fm-website" placeholder="www.beispiel.de" value="${esc(f.website)}"></label>
        <label><span>Telefon (Zentrale)</span><input type="text" id="fm-telefon" value="${esc(f.telefon)}"></label>
      </div>
      <div class="row">
        <label><span>Straße, Nr.</span><input type="text" id="fm-strasse" value="${esc(f.strasse)}"></label>
        <label><span>PLZ, Ort</span><input type="text" id="fm-plzort" value="${esc(f.plzort)}"></label>
      </div>
      <div class="row single"><label><span>Notiz (intern)</span><textarea id="fm-notiz" rows="2">${esc(f.notiz)}</textarea></label></div>
      ${isNew?`<fieldset style="margin:14px 0 0"><legend>Hauptkontakt (optional)</legend>
        <div class="row thirds">
          <label><span>Anrede</span><select id="fm-k-anrede"><option>Frau</option><option>Herr</option><option value="">Neutral</option></select></label>
          <label><span>Vorname</span><input type="text" id="fm-k-vorname"></label>
          <label><span>Nachname</span><input type="text" id="fm-k-nachname"></label>
        </div>
        <div class="row">
          <label><span>Funktion</span><input type="text" id="fm-k-funktion"></label>
          <label><span>E-Mail</span><input type="email" id="fm-k-email"></label>
        </div></fieldset>`:""}
      <div class="modal-actions"><button type="button" class="btn" onclick="Modal.close()">Abbrechen</button><button type="button" class="btn blue" id="fm-save">${isNew?"Firma anlegen":"Speichern"}</button></div>`, true);
    document.getElementById("fm-save").onclick=()=>{
      const v=x=>document.getElementById(x).value.trim();
      const name=v("fm-firma");
      if(!name){ toast("Bitte einen Firmennamen angeben"); document.getElementById("fm-firma").focus(); return; }
      const dup=this.firmen().find(x=>x.id!==id && (x.firma||"").trim().toLowerCase()===name.toLowerCase());
      if(dup){ toast(`„${dup.firma}“ existiert bereits`); Modal.close(); location.hash="#/firma/"+sid(dup.id); return; }
      const now=this.now();
      const data={firma:name, status:v("fm-status"), branche:v("fm-branche"), ownerId:v("fm-owner"), website:v("fm-website"),
        telefon:v("fm-telefon"), strasse:v("fm-strasse"), plzort:v("fm-plzort"), notiz:v("fm-notiz"), updatedAt:now};
      let target;
      if(isNew){
        target=Object.assign({id:uid("k"), createdBy:this.me(), createdAt:now}, data);
        Store.state.kunden.push(target);
        const vn=v("fm-k-vorname"), nn=v("fm-k-nachname"), em=v("fm-k-email");
        if(vn||nn||em){
          Store.state.kontakte.push({id:uid("kt"), kundeId:target.id, anrede:v("fm-k-anrede"), vorname:vn, nachname:nn,
            funktion:v("fm-k-funktion"), rolle:"", email:em, telefon:"", mobil:"", linkedin:"", primary:true, notiz:"",
            createdBy:this.me(), createdAt:now, updatedAt:now});
        }
      } else { target=f; Object.assign(f,data); }
      Store.save(); Modal.close();
      toast(isNew?`Firma „${name}“ angelegt`:"Firma gespeichert");
      Editor.fillCustomerSelect();
      if(isNew) location.hash="#/firma/"+sid(target.id); else this.rerender();
    };
  },

  deleteFirma(id){
    const f=this.firma(id); if(!f || !Auth.isAdmin()) return;
    const ks=this.kontakteVon(id), ds=this.dealsVon(id), as=this.akts().filter(a=>a.kundeId===id);
    Modal.confirm("Firma löschen?",
      `<b>${esc(f.firma)}</b> wird mitsamt ${ks.length} Kontakt(en), ${ds.length} Verkaufschance(n) und ${as.length} Aktivität(en) gelöscht. Bestehende Angebote bleiben erhalten. Das kann nicht rückgängig gemacht werden.`,
      "Endgültig löschen", ()=>{
        const now=this.now();
        [f,...ks,...ds,...as].forEach(x=>{ x.deleted=true; x.updatedAt=now; });
        Store.save(); toast("Firma gelöscht"); Editor.fillCustomerSelect();
        location.hash="#/firmen";
      }, true);
  },

  /* =========================================================
     Kontakte
     ========================================================= */
  kontakteList(){
    const rs=document.getElementById("kontakte-rolle");
    if(rs.options.length<=1) rs.insertAdjacentHTML("beforeend",ROLLEN.map(r=>`<option>${esc(r)}</option>`).join(""));
    ["kontakte-search","kontakte-rolle"].forEach(id=>{ const el=document.getElementById(id);
      if(!el._bound){ el._bound=true; el.addEventListener("input",()=>this.renderKontakteTable()); el.addEventListener("change",()=>this.renderKontakteTable()); } });
    this.renderKontakteTable();
  },
  renderKontakteTable(){
    const host=document.getElementById("kontakte-table"); if(!host) return;
    const q=(document.getElementById("kontakte-search").value||"").trim().toLowerCase();
    const rolle=document.getElementById("kontakte-rolle").value;
    const all=this.kontakte().filter(k=>this.firma(k.kundeId));
    const lastBy={};
    for(const a of this.akts()){ if(!a.kontaktId||(a.typ==="aufgabe"&&!a.erledigt)) continue; const w=this.whenOf(a); if(!lastBy[a.kontaktId]||w>lastBy[a.kontaktId]) lastBy[a.kontaktId]=w; }
    const list=all.filter(k=>(!rolle||k.rolle===rolle))
      .filter(k=>!q || [this.kontaktName(k),k.email,k.funktion,(this.firma(k.kundeId)||{}).firma].join(" ").toLowerCase().includes(q))
      .sort((a,b)=>(a.nachname||a.vorname||"").localeCompare(b.nachname||b.vorname||"","de"));
    document.getElementById("kontakte-count").textContent=`${list.length} von ${all.length} Kontakten`;
    if(!list.length){
      host.innerHTML=all.length?`<div class="empty"><b>Keine Treffer</b>Suchbegriff oder Filter anpassen.</div>`
        :`<div class="empty"><b>Noch keine Kontakte</b>Kontakte gehören immer zu einer Firma – lege sie in der Firmenansicht an oder importiere eine Excel-Liste.<br><a class="btn" href="#/firmen">Zu den Firmen</a></div>`;
      return;
    }
    host.innerHTML=`<table class="data"><thead><tr><th>Name</th><th>Firma</th><th>Rolle</th><th>E-Mail</th><th>Telefon</th><th>Letzte Aktivität</th></tr></thead>
      <tbody>${list.map(k=>`<tr class="clickable" onclick="location.hash='#/kontakt/${sid(k.id)}'">
        <td><a class="rowlink" href="#/kontakt/${sid(k.id)}" onclick="event.stopPropagation()"><b>${esc(this.kontaktName(k))}</b></a>${k.primary?` <span class="chip">Hauptkontakt</span>`:""}<span class="sub">${esc(k.funktion||"")||"&nbsp;"}</span></td>
        <td onclick="event.stopPropagation()">${this.firmaLink(k.kundeId)}</td>
        <td>${esc(k.rolle||"—")}</td>
        <td class="mono" onclick="event.stopPropagation()">${k.email?`<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>`:"—"}</td>
        <td onclick="event.stopPropagation()">${k.telefon||k.mobil?`<a href="${esc(telHref(k.telefon||k.mobil))}">${esc(k.telefon||k.mobil)}</a>`:"—"}</td>
        <td>${lastBy[k.id]?this.rel(lastBy[k.id]):"—"}</td>
      </tr>`).join("")}</tbody></table>`;
  },

  kontaktDetail(id){
    const root=document.getElementById("kontakt-root");
    const k=this.kontakt(id);
    if(!k){ root.innerHTML=`<div class="content"><div class="card"><div class="empty"><b>Kontakt nicht gefunden</b>Er wurde möglicherweise gelöscht.<br><a class="btn" href="#/kontakte">Zur Kontaktliste</a></div></div></div>`; return; }
    this.remember("kontakt",k.id);
    const f=this.firma(k.kundeId);
    const ds=this.deals().filter(d=>d.kontaktId===k.id);
    const offs=Store.activeOffers().filter(o=>o.kontaktId===k.id);
    const li=safeUrl(k.linkedin);
    const canDel=Auth.isAdmin() || k.createdBy===this.me();
    root.innerHTML=`
      <div class="pagehead">
        <div>${this.crumbs("Kontakte","#/kontakte",this.kontaktName(k))}
          <h1>${esc([k.anrede==="Frau"||k.anrede==="Herr"?"":k.anrede,this.kontaktName(k)].filter(Boolean).join(" "))}${k.primary?` <span class="chip">Hauptkontakt</span>`:""}</h1>
          <div class="ph-sub">${esc([k.funktion,k.rolle].filter(Boolean).join(" · "))}${f?` · <a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`:""}</div></div>
        <div class="spacer"></div>
        ${k.email?`<a class="btn" href="mailto:${esc(k.email)}" onclick="CRM.setCompType('email')">E-Mail schreiben</a>`:""}
        ${k.telefon||k.mobil?`<a class="btn" href="${esc(telHref(k.telefon||k.mobil))}" onclick="CRM.setCompType('anruf')">Anrufen</a>`:""}
        ${li?`<a class="btn" href="${esc(li)}" target="_blank" rel="noopener">LinkedIn</a>`:""}
        <button type="button" class="btn" onclick="CRM.editKontakt('${sid(k.id)}')">Bearbeiten</button>
        ${f?`<button type="button" class="btn blue" onclick="CRM.editDeal(null,{kundeId:'${sid(f.id)}',kontaktId:'${sid(k.id)}'})">＋ Verkaufschance</button>`:""}
        ${canDel?`<button type="button" class="btn danger" onclick="CRM.deleteKontakt('${sid(k.id)}')">Löschen</button>`:""}
      </div>
      <div class="content">
        <div class="detail-grid">
          <div class="dg-main">
            ${this.composerHTML({kundeId:k.kundeId, kontaktId:k.id, fixKontakt:true})}
            <div class="card"><h2>Aktivitäten &amp; Verlauf</h2>${this.timelineHTML(a=>a.kontaktId===k.id,{hideKontakt:true})}</div>
          </div>
          <div class="dg-side">
            <div class="card"><h2>Kontaktdaten</h2>${this.kv([
              ["Firma", f?`<a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`:"—"],
              ["Funktion", esc(k.funktion)],
              ["Rolle", esc(k.rolle)],
              ["E-Mail", k.email?`<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>`:""],
              ["Telefon", k.telefon?`<a href="${esc(telHref(k.telefon))}">${esc(k.telefon)}</a>`:""],
              ["Mobil", k.mobil?`<a href="${esc(telHref(k.mobil))}">${esc(k.mobil)}</a>`:""],
              ["LinkedIn", li?`<a href="${esc(li)}" target="_blank" rel="noopener">Profil öffnen</a>`:""],
              ["Notiz", k.notiz?nlLink(k.notiz):""]
            ])}</div>
            <div class="card"><h2>Verkaufschancen</h2>
              ${ds.length?`<ul class="list-plain">${ds.map(d=>`<li><div class="lp-main"><b><a href="#/deal/${sid(d.id)}">${esc(d.titel)}</a></b></div>
                <div class="lp-side">${this.stageBadge(d)}<span class="mono">${fmtEUR0(this.dealValue(d))}</span></div></li>`).join("")}</ul>`
                :`<div class="empty">Keine Verkaufschance mit diesem Kontakt.</div>`}
            </div>
            <div class="card"><h2>Angebote</h2>
              ${offs.length?`<ul class="list-plain">${offs.map(o=>`<li><div class="lp-main"><b><a href="#/angebot/${sid(o.id)}">${esc(o.doc.meta.nr||"ohne Nummer")}</a></b><span>${esc(o.doc.meta.betreff||"")}</span></div>
                <div class="lp-side">${badge(o)}</div></li>`).join("")}</ul>`:`<div class="empty">Noch kein Angebot an diesen Kontakt.</div>`}
            </div>
          </div>
        </div>
      </div>`;
  },

  editKontakt(id, preset){
    const k=id?this.kontakt(id):Object.assign({kundeId:"",anrede:"Frau",vorname:"",nachname:"",funktion:"",rolle:"",email:"",telefon:"",mobil:"",linkedin:"",primary:false,notiz:""},preset||{});
    if(id && !k) return;
    const isNew=!id;
    Modal.open(`<h3>${isNew?"Neuer Kontakt":"Kontakt bearbeiten"}</h3>
      <div class="row single"><label><span>Firma *</span><select id="kt-firma">${this.optFirmen(k.kundeId,"— Firma wählen —")}</select></label></div>
      <div class="row thirds">
        <label><span>Anrede</span><select id="kt-anrede"><option${k.anrede==="Frau"?" selected":""}>Frau</option><option${k.anrede==="Herr"?" selected":""}>Herr</option><option value=""${!k.anrede?" selected":""}>Neutral</option></select></label>
        <label><span>Vorname</span><input type="text" id="kt-vorname" value="${esc(k.vorname)}"></label>
        <label><span>Nachname *</span><input type="text" id="kt-nachname" value="${esc(k.nachname)}"></label>
      </div>
      <div class="row">
        <label><span>Funktion</span><input type="text" id="kt-funktion" value="${esc(k.funktion)}" placeholder="z. B. Head of Marketing"></label>
        <label><span>Rolle im Einkaufsprozess</span><select id="kt-rolle"><option value="">—</option>${ROLLEN.map(r=>`<option${k.rolle===r?" selected":""}>${esc(r)}</option>`).join("")}</select></label>
      </div>
      <div class="row">
        <label><span>E-Mail</span><input type="email" id="kt-email" value="${esc(k.email)}"></label>
        <label><span>Telefon</span><input type="text" id="kt-telefon" value="${esc(k.telefon)}"></label>
      </div>
      <div class="row">
        <label><span>Mobil</span><input type="text" id="kt-mobil" value="${esc(k.mobil)}"></label>
        <label><span>LinkedIn-Profil</span><input type="text" id="kt-linkedin" value="${esc(k.linkedin)}" placeholder="https://www.linkedin.com/in/…"></label>
      </div>
      <div class="row single"><label><span>Notiz (intern)</span><textarea id="kt-notiz" rows="2">${esc(k.notiz)}</textarea></label></div>
      <label class="switch"><input type="checkbox" id="kt-primary" ${k.primary?"checked":""}> Hauptansprechpartner dieser Firma</label>
      <div class="modal-actions"><button type="button" class="btn" onclick="Modal.close()">Abbrechen</button><button type="button" class="btn blue" id="kt-save">${isNew?"Kontakt anlegen":"Speichern"}</button></div>`, true);
    document.getElementById("kt-save").onclick=()=>{
      const v=x=>document.getElementById(x).value.trim();
      const kundeId=v("kt-firma");
      if(!kundeId){ toast("Bitte eine Firma wählen"); document.getElementById("kt-firma").focus(); return; }
      if(!v("kt-nachname") && !v("kt-email")){ toast("Bitte mindestens Nachname oder E-Mail angeben"); document.getElementById("kt-nachname").focus(); return; }
      const now=this.now();
      const primary=document.getElementById("kt-primary").checked || !this.kontakteVon(kundeId).some(x=>x.id!==id);
      const data={kundeId, anrede:v("kt-anrede"), vorname:v("kt-vorname"), nachname:v("kt-nachname"), funktion:v("kt-funktion"),
        rolle:v("kt-rolle"), email:v("kt-email"), telefon:v("kt-telefon"), mobil:v("kt-mobil"), linkedin:v("kt-linkedin"),
        notiz:v("kt-notiz"), primary, updatedAt:now};
      let target;
      if(isNew){ target=Object.assign({id:uid("kt"), createdBy:this.me(), createdAt:now}, data); Store.state.kontakte.push(target); }
      else { target=k; Object.assign(k,data); }
      if(primary) this.kontakteVon(kundeId).forEach(x=>{ if(x.id!==target.id && x.primary){ x.primary=false; x.updatedAt=now; } });
      Store.save(); Modal.close();
      toast(isNew?"Kontakt angelegt":"Kontakt gespeichert");
      this.rerender();
    };
  },

  deleteKontakt(id){
    const k=this.kontakt(id); if(!k) return;
    Modal.confirm("Kontakt löschen?", `<b>${esc(this.kontaktName(k))}</b> wird gelöscht. Aktivitäten und Verkaufschancen bleiben bei der Firma erhalten.`, "Löschen", ()=>{
      k.deleted=true; k.updatedAt=this.now(); Store.save();
      toast("Kontakt gelöscht");
      location.hash=k.kundeId && this.firma(k.kundeId) ? "#/firma/"+sid(k.kundeId) : "#/kontakte";
    }, true);
  },

  /* =========================================================
     Verkaufschancen
     ========================================================= */
  dealDetail(id){
    const root=document.getElementById("deal-root");
    const d=this.deal(id);
    if(!d){ root.innerHTML=`<div class="content"><div class="card"><div class="empty"><b>Verkaufschance nicht gefunden</b>Sie wurde möglicherweise gelöscht.<br><a class="btn" href="#/pipeline">Zur Pipeline</a></div></div></div>`; return; }
    this.remember("deal",d.id);
    const f=this.firma(d.kundeId), k=this.kontakt(d.kontaktId);
    const offs=this.offersVonDeal(d.id).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    const open=this.isOpen(d);
    const today=localISO();
    const canDel=Auth.isAdmin() || d.ownerId===this.me() || d.createdBy===this.me();
    const cur=STAGE_IDX[d.stage];
    const valueNote=(!d.wertManuell && offs.length)?"aus dem aktuellen Angebot":(d.wertManuell?"manuell festgelegt":"Schätzwert");
    const stepper=`<div class="stepper" role="group" aria-label="Phase der Verkaufschance">
      ${OPEN_STAGES.map(s=>{ const i=STAGE_IDX[s]; const state=!open?"":(i<cur?"done":(i===cur?"current":""));
        return `<button type="button" class="step ${state}" ${s===d.stage?'aria-current="step"':""} onclick="CRM.moveDeal('${sid(d.id)}','${s}')">${esc(stageLabel(s))}<small>${CRM_STAGES[i].chance} %</small></button>`; }).join("")}
      <button type="button" class="step won ${d.stage==="gewonnen"?"current":""}" onclick="CRM.markWon('${sid(d.id)}')">Gewonnen</button>
      <button type="button" class="step lost ${d.stage==="verloren"?"current":""}" onclick="CRM.markLost('${sid(d.id)}')">Verloren</button>
    </div>`;
    root.innerHTML=`
      <div class="pagehead">
        <div>${this.crumbs("Pipeline","#/pipeline",d.titel)}
          <h1>${esc(d.titel)} ${this.stageBadge(d)}</h1>
          <div class="ph-sub">${f?`<a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`:"—"}${k?` · <a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>`:""} · Betreuung: ${esc(this.userName(d.ownerId))}</div></div>
        <div class="spacer"></div>
        <button type="button" class="btn" onclick="CRM.editDeal('${sid(d.id)}')">Bearbeiten</button>
        ${canDel?`<button type="button" class="btn danger" onclick="CRM.deleteDeal('${sid(d.id)}')">Löschen</button>`:""}
        <button type="button" class="btn blue" onclick="Views.newOffer({dealId:'${sid(d.id)}'})">＋ Angebot erstellen</button>
      </div>
      <div class="content">
        ${stepper}
        ${!open?`<div class="notice ${d.stage==="gewonnen"?"success":"danger"}"><b>${d.stage==="gewonnen"?"Gewonnen":"Verloren"}</b> am ${fdate(this.closedDay(d))}${d.verlustgrund?" · Grund: "+esc(d.verlustgrund):""} · <button type="button" class="btn-link" onclick="CRM.reopenDeal('${sid(d.id)}')">Wieder öffnen</button></div>`:""}
        <div class="detail-grid">
          <div class="dg-main">
            ${this.composerHTML({kundeId:d.kundeId, kontaktId:d.kontaktId||"", dealId:d.id, fixDeal:true})}
            <div class="card"><h2>Aktivitäten &amp; Verlauf</h2>${this.timelineHTML(a=>a.dealId===d.id,{hideDeal:true,hideFirma:true})}</div>
          </div>
          <div class="dg-side">
            <div class="card"><h2>Eckdaten</h2>${this.kv([
              ["Wert", `<span class="mono">${fmtEUR(this.dealValue(d))}</span><span class="sub">${esc(valueNote)}</span>`],
              ["Wahrscheinlichkeit", `${this.dealChance(d)} %`],
              ["Gewichtet", `<span class="mono">${fmtEUR(this.weighted(d))}</span>`],
              ["Erwarteter Abschluss", d.abschluss?`<span class="${open&&d.abschluss<today?"overdue":""}">${open&&d.abschluss<today?"Überschritten · ":""}${fdate(d.abschluss)}</span>`:"—"],
              ["Quelle", esc(d.quelle)],
              ["Betreuung", esc(this.userName(d.ownerId))],
              ["Angelegt", fdate(dayOf(d.createdAt))],
              ["Notiz", d.notiz?nlLink(d.notiz):""]
            ])}</div>
            <div class="card"><h2>Angebote<span class="h2-action"><button type="button" class="btn" onclick="Views.newOffer({dealId:'${sid(d.id)}'})">＋</button></span></h2>
              ${offs.length?`<ul class="list-plain">${offs.map(o=>`<li><div class="lp-main"><b><a href="#/angebot/${sid(o.id)}">${esc(o.doc.meta.nr||"ohne Nummer")}</a></b><span>${esc(o.doc.meta.betreff||"")} · ${this.rel(o.updatedAt)}</span></div>
                <div class="lp-side">${badge(o)}<span class="mono">${fmtEUR0(Store.calc(o.doc).nettoR)}</span></div></li>`).join("")}</ul>`
                :`<div class="empty">Noch kein Angebot. „＋ Angebot erstellen" übernimmt Firma, Kontakt und Titel automatisch.</div>`}
            </div>
            ${k?`<div class="card"><h2>Ansprechpartner</h2>${this.kv([
              ["Name", `<a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>`],
              ["Funktion", esc(k.funktion)],
              ["Kontakt", this.contactLinks(k)]
            ])}</div>`:""}
          </div>
        </div>
      </div>`;
  },

  editDeal(id, preset){
    const d=id?this.deal(id):Object.assign({titel:"",kundeId:"",kontaktId:"",stage:"lead",wert:"",wertManuell:false,chance:null,
      abschluss:addDaysLocal(localISO(),30),ownerId:this.me(),quelle:"",verlustgrund:"",notiz:""},preset||{});
    if(id && !d) return;
    const isNew=!id;
    const offs=id?this.offersVonDeal(id):[];
    const auto=offs.length && !d.wertManuell;
    Modal.open(`<h3>${isNew?"Neue Verkaufschance":"Verkaufschance bearbeiten"}</h3>
      <div class="row single"><label><span>Titel *</span><input type="text" id="dm-titel" value="${esc(d.titel)}" placeholder="z. B. Podcast-Sponsoring Q1 2027"></label></div>
      <div class="row">
        <label><span>Firma *</span><select id="dm-firma">${this.optFirmen(d.kundeId,"— Firma wählen —")}</select></label>
        <label><span>Ansprechpartner</span><select id="dm-kontakt">${this.optKontakte(d.kundeId,d.kontaktId)}</select></label>
      </div>
      <div class="row thirds">
        <label><span>Phase</span><select id="dm-stage">${CRM_STAGES.map(s=>`<option value="${s.k}"${d.stage===s.k?" selected":""}>${esc(s.label)}</option>`).join("")}</select></label>
        <label><span>Wert (€ netto)</span><input type="number" id="dm-wert" min="0" step="100" value="${auto?Math.round(this.dealValue(d)):esc(d.wert)}" ${auto?"disabled":""}></label>
        <label><span>Wahrscheinlichkeit (%)</span><input type="number" id="dm-chance" min="0" max="100" step="5" value="${d.chance===null||d.chance===undefined?"":esc(d.chance)}" placeholder="automatisch"></label>
      </div>
      ${offs.length?`<label class="switch"><input type="checkbox" id="dm-manuell" ${d.wertManuell?"checked":""} onchange="document.getElementById('dm-wert').disabled=!this.checked"> Wert manuell festlegen (statt aus dem verknüpften Angebot)</label>`:""}
      <div class="row thirds">
        <label><span>Erwarteter Abschluss</span><input type="date" id="dm-abschluss" value="${esc(d.abschluss)}"></label>
        <label><span>Betreuung</span><select id="dm-owner">${this.optUsers(d.ownerId,true)}</select></label>
        <label><span>Quelle</span><select id="dm-quelle"><option value="">—</option>${QUELLEN.map(q=>`<option${d.quelle===q?" selected":""}>${esc(q)}</option>`).join("")}</select></label>
      </div>
      <div class="row single" id="dm-grund-row" ${d.stage==="verloren"?"":"hidden"}><label><span>Verlustgrund</span><select id="dm-grund"><option value="">—</option>${VERLUSTGRUENDE.map(g=>`<option${d.verlustgrund===g?" selected":""}>${esc(g)}</option>`).join("")}</select></label></div>
      <div class="row single"><label><span>Notiz</span><textarea id="dm-notiz" rows="3">${esc(d.notiz)}</textarea></label></div>
      <div class="hint">Die Wahrscheinlichkeit folgt automatisch der Phase (Lead 10 %, Qualifiziert 25 %, Angebot 50 %, Verhandlung 75 %), solange kein eigener Wert eingetragen ist.</div>
      <div class="modal-actions"><button type="button" class="btn" onclick="Modal.close()">Abbrechen</button><button type="button" class="btn blue" id="dm-save">${isNew?"Verkaufschance anlegen":"Speichern"}</button></div>`, true);
    const fs=document.getElementById("dm-firma");
    fs.addEventListener("change",()=>{ document.getElementById("dm-kontakt").innerHTML=this.optKontakte(fs.value,""); });
    document.getElementById("dm-stage").addEventListener("change",e=>{ document.getElementById("dm-grund-row").hidden=e.target.value!=="verloren"; });
    document.getElementById("dm-save").onclick=()=>{
      const v=x=>document.getElementById(x).value.trim();
      const titel=v("dm-titel"), kundeId=v("dm-firma");
      if(!titel){ toast("Bitte einen Titel angeben"); document.getElementById("dm-titel").focus(); return; }
      if(!kundeId){ toast("Bitte eine Firma wählen"); document.getElementById("dm-firma").focus(); return; }
      const stage=v("dm-stage");
      if(stage==="verloren" && !v("dm-grund")){ toast("Bitte einen Verlustgrund wählen"); document.getElementById("dm-grund").focus(); return; }
      const now=this.now();
      const manEl=document.getElementById("dm-manuell");
      const chanceRaw=v("dm-chance");
      const data={titel, kundeId, kontaktId:v("dm-kontakt"), abschluss:v("dm-abschluss"), ownerId:v("dm-owner"),
        quelle:v("dm-quelle"), notiz:v("dm-notiz"), wertManuell:manEl?manEl.checked:false, updatedAt:now};
      if(!document.getElementById("dm-wert").disabled) data.wert=Math.max(0,parseFloat(v("dm-wert"))||0);
      let target;
      if(isNew){
        target=Object.assign({id:uid("dl"), stage, chance:null, wert:0, verlustgrund:"", wonAt:"", lostAt:"", createdBy:this.me(), createdAt:now}, data);
        if(stage==="gewonnen") target.wonAt=now;
        if(stage==="verloren"){ target.lostAt=now; target.verlustgrund=v("dm-grund"); }
        Store.state.deals.push(target);
        this.sys(`Verkaufschance angelegt (${stageLabel(stage)})`, {kundeId, dealId:target.id, kontaktId:data.kontaktId});
        const f=this.firma(kundeId);
        if(stage==="gewonnen" && f){ f.status="kunde"; f.updatedAt=now; }
        else if(f && f.status==="lead" && STAGE_IDX[stage]>=STAGE_IDX.qualifiziert && stage!=="verloren"){ f.status="interessent"; f.updatedAt=now; }
      } else {
        target=d;
        Object.assign(d,data);
        if(stage!==d.stage) this.setStage(d, stage, v("dm-grund"));
        else if(stage==="verloren") d.verlustgrund=v("dm-grund");
      }
      target.chance=chanceRaw===""?null:Math.min(100,Math.max(0,parseInt(chanceRaw,10)||0));
      Store.save(); Modal.close();
      toast(isNew?`Verkaufschance „${titel}“ angelegt`:"Verkaufschance gespeichert");
      if(isNew) location.hash="#/deal/"+sid(target.id); else this.rerender();
    };
  },

  deleteDeal(id){
    const d=this.deal(id); if(!d) return;
    Modal.confirm("Verkaufschance löschen?", `<b>${esc(d.titel)}</b> wird gelöscht. Verknüpfte Angebote und Aktivitäten bleiben erhalten.`, "Löschen", ()=>{
      d.deleted=true; d.updatedAt=this.now(); Store.save();
      toast("Verkaufschance gelöscht"); location.hash="#/pipeline";
    }, true);
  },

  /* =========================================================
     Aktivität/Aufgabe bearbeiten (Modal)
     ========================================================= */
  editAkt(id, preset){
    const a=id?this.akt(id):Object.assign({typ:"aufgabe",betreff:"",text:"",faellig:addDaysLocal(localISO(),1),ownerId:this.me(),
      erledigt:false,kundeId:"",kontaktId:"",dealId:"",datum:this.now()},preset||{});
    if(id && !a) return;
    if(a.typ==="system") return;
    const dateFor=t=>t==="aufgabe"?(a.faellig||""):dayOf(a.datum||this.now());
    Modal.open(`<h3>${id?"Eintrag bearbeiten":(a.typ==="aufgabe"?"Neue Aufgabe":"Neuer Eintrag")}</h3>
      <div class="row">
        <label><span>Art</span><select id="ak-typ">${LOG_TYPES.map(t=>`<option value="${t}"${t===a.typ?" selected":""}>${AKT_TYPES[t]}</option>`).join("")}</select></label>
        <label><span id="ak-date-label">${a.typ==="aufgabe"?"Fällig am":"Datum"}</span><input type="date" id="ak-date" value="${esc(dateFor(a.typ))}"></label>
      </div>
      <div class="row single"><label><span>Betreff</span><input type="text" id="ak-betreff" value="${esc(a.betreff)}"></label></div>
      <div class="row single"><label><span>Beschreibung</span><textarea id="ak-text" rows="4">${esc(a.text)}</textarea></label></div>
      <div class="row" id="ak-task-row" ${a.typ==="aufgabe"?"":"hidden"}>
        <label><span>Zuständig</span><select id="ak-owner">${this.optUsers(a.ownerId)}</select></label>
        <label class="switch" style="align-self:end"><input type="checkbox" id="ak-done" ${a.erledigt?"checked":""}> Erledigt</label>
      </div>
      <fieldset style="margin:10px 0 0"><legend>Zuordnung</legend>
        <div class="row thirds">
          <label><span>Firma</span><select id="ak-firma">${this.optFirmen(a.kundeId)}</select></label>
          <label><span>Kontakt</span><select id="ak-kontakt">${this.optKontakte(a.kundeId,a.kontaktId)}</select></label>
          <label><span>Verkaufschance</span><select id="ak-deal">${this.optDeals(a.kundeId,a.dealId)}</select></label>
        </div>
      </fieldset>
      <div class="modal-actions"><button type="button" class="btn" onclick="Modal.close()">Abbrechen</button><button type="button" class="btn blue" id="ak-save">Speichern</button></div>`, true);
    this.bindLinkSelects("ak");
    const typSel=document.getElementById("ak-typ");
    typSel.addEventListener("change",()=>{
      const t=typSel.value;
      document.getElementById("ak-task-row").hidden=t!=="aufgabe";
      document.getElementById("ak-date-label").textContent=t==="aufgabe"?"Fällig am":"Datum";
      document.getElementById("ak-date").value=t==="aufgabe"?(a.faellig||addDaysLocal(localISO(),1)):dayOf(a.datum||this.now());
    });
    document.getElementById("ak-save").onclick=()=>{
      const v=x=>document.getElementById(x).value.trim();
      const t=v("ak-typ"), betreff=v("ak-betreff"), text=v("ak-text"), date=v("ak-date");
      if(t==="aufgabe" && !betreff){ toast("Bitte beschreiben, was zu tun ist"); document.getElementById("ak-betreff").focus(); return; }
      if(t!=="aufgabe" && !betreff && !text){ toast("Bitte Betreff oder Beschreibung eintragen"); return; }
      const now=this.now();
      const data={typ:t, betreff, text, kundeId:v("ak-firma"), kontaktId:v("ak-kontakt"), dealId:v("ak-deal"), updatedAt:now};
      if(!data.kundeId && data.dealId){ const dd=this.deal(data.dealId); if(dd) data.kundeId=dd.kundeId; }
      if(t==="aufgabe"){
        const done=document.getElementById("ak-done").checked;
        data.faellig=date; data.ownerId=v("ak-owner");
        data.erledigtAm=done?(a.erledigt?a.erledigtAm:now):"";
        data.erledigt=done;
      } else {
        data.faellig=""; data.erledigt=false; data.erledigtAm="";
        data.datum=(date && date!==dayOf(a.datum||""))?(date===localISO()?now:new Date(date+"T12:00:00").toISOString()):(a.datum||now);
      }
      if(id) Object.assign(a,data); else this.log(data);
      Store.save(); Modal.close();
      toast(t==="aufgabe"?(id?"Aufgabe gespeichert":"Aufgabe angelegt"):"Eintrag gespeichert");
      this.rerender();
    };
  },

  /* =========================================================
     Aufgaben
     ========================================================= */
  aufgaben(){
    const ui=this.ui.aufgaben, today=localISO(), me=this.me();
    const ownerOk=a=>ui.scope==="mine" ? a.ownerId===me : (!ui.owner || a.ownerId===ui.owner);
    const tasks=this.akts().filter(a=>a.typ==="aufgabe" && ownerOk(a));
    const open=tasks.filter(a=>!a.erledigt);
    const groups=[
      {k:"overdue", label:"Überfällig", items:open.filter(a=>a.faellig && a.faellig<today)},
      {k:"today",   label:"Heute",      items:open.filter(a=>a.faellig===today)},
      {k:"week",    label:"Nächste 7 Tage", items:open.filter(a=>a.faellig>today && a.faellig<=addDaysLocal(today,7))},
      {k:"later",   label:"Später",     items:open.filter(a=>a.faellig>addDaysLocal(today,7))},
      {k:"nodate",  label:"Ohne Fälligkeit", items:open.filter(a=>!a.faellig)}
    ];
    groups.forEach(g=>g.items.sort((a,b)=>(a.faellig||"").localeCompare(b.faellig||"")));
    const done=ui.done?tasks.filter(a=>a.erledigt).sort((a,b)=>(b.erledigtAm||"").localeCompare(a.erledigtAm||"")).slice(0,30):[];
    const myName=Auth.user.name;
    const wv=Store.activeOffers().filter(o=>["entwurf","pruefung","freigegeben","versendet"].includes(o.status) && o.doc.intern && o.doc.intern.wiedervorlage
      && o.doc.intern.wiedervorlage<=addDaysLocal(today,7)
      && (ui.scope!=="mine" || o.createdBy===me || o.doc.meta.betreuer===myName)
      && (ui.scope==="mine" || !ui.owner || this.userIdByName(o.doc.meta.betreuer)===ui.owner || o.createdBy===ui.owner))
      .sort((a,b)=>a.doc.intern.wiedervorlage.localeCompare(b.doc.intern.wiedervorlage));

    const row=a=>{
      const ctx=[];
      if(a.kundeId){ const f=this.firma(a.kundeId); if(f) ctx.push(`<a href="#/firma/${sid(f.id)}">${esc(f.firma)}</a>`); }
      if(a.dealId){ const d=this.deal(a.dealId); if(d) ctx.push(`<a href="#/deal/${sid(d.id)}">${esc(d.titel)}</a>`); }
      if(a.kontaktId){ const k=this.kontakt(a.kontaktId); if(k) ctx.push(`<a href="#/kontakt/${sid(k.id)}">${esc(this.kontaktName(k))}</a>`); }
      const late=!a.erledigt && a.faellig && a.faellig<today;
      return `<li class="task-row${a.erledigt?" done":""}">
        <input type="checkbox" aria-label="Erledigt" ${a.erledigt?"checked":""} onchange="CRM.toggleTask('${sid(a.id)}',this.checked)">
        <div class="lp-main"><b><button type="button" class="btn-link plain" onclick="CRM.editAkt('${sid(a.id)}')">${esc(a.betreff)}</button></b>
          <span>${ctx.join(" · ")||"ohne Zuordnung"}${a.text?" · "+esc(a.text.slice(0,90))+(a.text.length>90?"…":""):""}</span></div>
        <div class="lp-side"><span class="${late?"overdue":""}">${a.erledigt?"erledigt "+this.rel(a.erledigtAm):(a.faellig?(late?"Überfällig · ":"")+this.relDay(a.faellig):"—")}</span>
          ${ui.scope!=="mine"?`<span class="avatar" title="${esc(this.userName(a.ownerId))}">${esc(this.initials(a.ownerId))}</span>`:""}</div>
      </li>`;
    };
    const total=open.length;
    document.getElementById("aufgaben-root").innerHTML=`
      <div class="pagehead">
        <div><h1>Aufgaben</h1><div class="ph-sub">${total} offen${groups[0].items.length?` · <span class="overdue">${groups[0].items.length} überfällig</span>`:""}</div></div>
        <div class="spacer"></div>
        <button type="button" class="btn blue" onclick="CRM.editAkt(null,{typ:'aufgabe'})">＋ Aufgabe</button>
      </div>
      <div class="content">
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Ansicht">
            <button type="button" class="${ui.scope==="mine"?"active":""}" aria-pressed="${ui.scope==="mine"}" onclick="CRM.ui.aufgaben.scope='mine';CRM.aufgaben()">Meine</button>
            <button type="button" class="${ui.scope==="team"?"active":""}" aria-pressed="${ui.scope==="team"}" onclick="CRM.ui.aufgaben.scope='team';CRM.aufgaben()">Team</button>
          </div>
          ${ui.scope==="team"?`<select aria-label="Nach Person filtern" onchange="CRM.ui.aufgaben.owner=this.value;CRM.aufgaben()"><option value="">Alle Personen</option>${this.activeUsers().map(u=>`<option value="${sid(u.id)}"${ui.owner===u.id?" selected":""}>${esc(u.name)}</option>`).join("")}</select>`:""}
          <label class="switch" style="margin:0"><input type="checkbox" ${ui.done?"checked":""} onchange="CRM.ui.aufgaben.done=this.checked;CRM.aufgaben()"> Erledigte anzeigen</label>
        </div>
        ${wv.length?`<div class="card" style="margin-bottom:16px"><h2>Angebots-Wiedervorlagen</h2><ul class="list-plain">${wv.map(o=>{
          const late=o.doc.intern.wiedervorlage<today;
          return `<li class="task-row"><span class="chip">Angebot</span><div class="lp-main"><b><a href="#/angebot/${sid(o.id)}">${esc(o.doc.meta.nr||"ohne Nummer")} · ${esc(o.doc.kunde.firma||"(ohne Firma)")}</a></b><span>${esc(o.doc.meta.betreff||"")}</span></div>
            <div class="lp-side"><span class="${late?"overdue":""}">${late?"Überfällig · ":""}${this.relDay(o.doc.intern.wiedervorlage)}</span>${badge(o)}</div></li>`; }).join("")}</ul></div>`:""}
        ${total||done.length?groups.filter(g=>g.items.length).map(g=>`<div class="card task-group tg-${g.k}" style="margin-bottom:16px"><h2>${esc(g.label)} · ${g.items.length}</h2><ul class="list-plain">${g.items.map(row).join("")}</ul></div>`).join("")
          +(done.length?`<div class="card" style="margin-bottom:16px"><h2>Erledigt · zuletzt</h2><ul class="list-plain">${done.map(row).join("")}</ul></div>`:"")
          :`<div class="card"><div class="empty"><b>Keine offenen Aufgaben</b>${ui.scope==="mine"?"Dir ist aktuell nichts zugewiesen.":"Im Team ist aktuell nichts offen."}<br><button type="button" class="btn blue" onclick="CRM.editAkt(null,{typ:'aufgabe'})">＋ Aufgabe</button></div></div>`}
      </div>`;
  },

  /* =========================================================
     Berichte
     ========================================================= */
  berichte(){
    const ui=this.ui.bericht, today=localISO(), nowD=new Date();
    const start=ui.range==="quartal" ? localISO(new Date(nowD.getFullYear(),Math.floor(nowD.getMonth()/3)*3,1))
              : ui.range==="12m" ? addDaysLocal(today,-365) : today.slice(0,4)+"-01-01";
    const rangeLabel={jahr:"dieses Jahr",quartal:"dieses Quartal","12m":"letzte 12 Monate"}[ui.range];
    const deals=this.deals().filter(d=>this.ownerMatch(d.ownerId,ui.owner));
    const won=deals.filter(d=>d.stage==="gewonnen" && this.closedDay(d)>=start);
    const lost=deals.filter(d=>d.stage==="verloren" && this.closedDay(d)>=start);
    const wonSum=won.reduce((a,d)=>a+this.dealValue(d),0);
    const quote=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):null;
    const avg=won.length?wonSum/won.length:0;
    const cycle=won.length?Math.round(won.reduce((a,d)=>a+Math.max(0,(new Date(d.wonAt||d.updatedAt)-new Date(d.createdAt))/864e5),0)/won.length):null;
    const open=deals.filter(d=>this.isOpen(d));
    const wsum=open.reduce((a,d)=>a+this.weighted(d),0);

    const months=[];
    for(let i=11;i>=0;i--){ const d=new Date(nowD.getFullYear(),nowD.getMonth()-i,1); months.push({key:localISO(d).slice(0,7),label:d.toLocaleDateString("de-DE",{month:"short"}).replace(".",""),v:0}); }
    deals.filter(d=>d.stage==="gewonnen").forEach(d=>{ const m=months.find(x=>x.key===this.closedDay(d).slice(0,7)); if(m) m.v+=this.dealValue(d); });

    const fc=[];
    for(let i=0;i<6;i++){ const d=new Date(nowD.getFullYear(),nowD.getMonth()+i,1); fc.push({key:localISO(d).slice(0,7),label:d.toLocaleDateString("de-DE",{month:"long",year:"numeric"}),v:0,w:0,n:0}); }
    let late={v:0,w:0,n:0}, nod={v:0,w:0,n:0};
    open.forEach(d=>{
      const val=this.dealValue(d), w=this.weighted(d);
      const b=!d.abschluss?nod:(d.abschluss<today?late:fc.find(x=>x.key===d.abschluss.slice(0,7)));
      if(b){ b.v+=val; b.w+=w; b.n++; }
    });

    const since30=addDaysLocal(today,-30);
    const team=this.activeUsers().filter(u=>!ui.owner||this.ownerMatch(u.id,ui.owner)).map(u=>{
      const ud=this.deals().filter(d=>d.ownerId===u.id);
      const uo=ud.filter(d=>this.isOpen(d));
      const uw=ud.filter(d=>d.stage==="gewonnen"&&this.closedDay(d)>=start);
      const ul=ud.filter(d=>d.stage==="verloren"&&this.closedDay(d)>=start);
      return {u, open:uo.length, pipe:uo.reduce((a,d)=>a+this.dealValue(d),0), w:uo.reduce((a,d)=>a+this.weighted(d),0),
        won:uw.reduce((a,d)=>a+this.dealValue(d),0), wonN:uw.length,
        quote:(uw.length+ul.length)?Math.round(uw.length/(uw.length+ul.length)*100):null,
        akts:this.akts().filter(a=>a.createdBy===u.id && a.typ!=="system" && dayOf(a.createdAt)>=since30).length};
    }).filter(r=>r.open||r.won||r.akts||r.wonN);

    const srcMap={};
    deals.filter(d=>dayOf(d.createdAt)>=start || this.isOpen(d) || this.closedDay(d)>=start).forEach(d=>{
      const k=d.quelle||"Ohne Angabe";
      const s=srcMap[k]||(srcMap[k]={k,n:0,won:0,wonN:0,lostN:0});
      s.n++;
      if(d.stage==="gewonnen"&&this.closedDay(d)>=start){ s.wonN++; s.won+=this.dealValue(d); }
      if(d.stage==="verloren"&&this.closedDay(d)>=start) s.lostN++;
    });
    const sources=Object.values(srcMap).sort((a,b)=>b.won-a.won||b.n-a.n);
    const lossMap={};
    lost.forEach(d=>{ const k=d.verlustgrund||"Ohne Angabe"; lossMap[k]=(lossMap[k]||0)+1; });

    document.getElementById("berichte-root").innerHTML=`
      <div class="pagehead">
        <div><h1>Berichte</h1><div class="ph-sub">Vertriebskennzahlen · ${esc(rangeLabel)}${ui.owner?" · "+esc(ui.owner==="me"?"nur meine":this.userName(ui.owner)):""}</div></div>
        <div class="spacer"></div>
        <select aria-label="Zeitraum" onchange="CRM.ui.bericht.range=this.value;CRM.berichte()">
          <option value="jahr"${ui.range==="jahr"?" selected":""}>Dieses Jahr</option>
          <option value="quartal"${ui.range==="quartal"?" selected":""}>Dieses Quartal</option>
          <option value="12m"${ui.range==="12m"?" selected":""}>Letzte 12 Monate</option></select>
        <select aria-label="Betreuer" onchange="CRM.ui.bericht.owner=this.value;CRM.berichte()">${this.optOwnerFilter(ui.owner)}</select>
        <button type="button" class="btn" onclick="CRM.exportDealsCSV()">Verkaufschancen als CSV</button>
      </div>
      <div class="content">
        <div class="kpi-row">
          <div class="kpi-tile dark"><div class="kt-label">Gewonnen</div><div class="kt-value">${fmtEUR0(wonSum)}</div><div class="kt-note">${won.length} Abschl${won.length===1?"uss":"üsse"}</div></div>
          <div class="kpi-tile"><div class="kt-label">Abschlussquote</div><div class="kt-value">${quote===null?"—":quote+" %"}</div><div class="kt-note">${won.length} gewonnen · ${lost.length} verloren</div></div>
          <div class="kpi-tile"><div class="kt-label">Ø Auftragswert</div><div class="kt-value">${won.length?fmtEUR0(avg):"—"}</div><div class="kt-note">je gewonnener Chance</div></div>
          <div class="kpi-tile"><div class="kt-label">Ø Verkaufszyklus</div><div class="kt-value">${cycle===null?"—":cycle+" Tage"}</div><div class="kt-note">Anlage bis Abschluss</div></div>
          <div class="kpi-tile"><div class="kt-label">Pipeline gewichtet</div><div class="kt-value">${fmtEUR0(wsum)}</div><div class="kt-note">${open.length} offene Chancen</div></div>
        </div>
        <div class="cardgrid cols-2">
          <div class="card"><h2>Gewonnener Umsatz · letzte 12 Monate</h2>${this.colsHTML(months)}</div>
          <div class="card"><h2>Forecast nach erwartetem Abschluss</h2>
            <div class="table-scroll"><table class="data"><thead><tr><th>Monat</th><th class="num">Chancen</th><th class="num">Pipeline</th><th class="num">Gewichtet</th></tr></thead><tbody>
              ${late.n?`<tr><td><span class="overdue">Überschritten</span></td><td class="num">${late.n}</td><td class="num">${fmtEUR0(late.v)}</td><td class="num">${fmtEUR0(late.w)}</td></tr>`:""}
              ${fc.map(m=>`<tr><td>${esc(m.label)}</td><td class="num">${m.n||"—"}</td><td class="num">${m.n?fmtEUR0(m.v):"—"}</td><td class="num">${m.n?fmtEUR0(m.w):"—"}</td></tr>`).join("")}
              ${nod.n?`<tr><td>Ohne Abschlussdatum</td><td class="num">${nod.n}</td><td class="num">${fmtEUR0(nod.v)}</td><td class="num">${fmtEUR0(nod.w)}</td></tr>`:""}
            </tbody></table></div></div>
          <div class="card" style="grid-column:1/-1"><h2>Team</h2>
            ${team.length?`<div class="table-scroll"><table class="data"><thead><tr><th>Betreuung</th><th class="num">Offene Chancen</th><th class="num">Pipeline</th><th class="num">Gewichtet</th><th class="num">Gewonnen</th><th class="num">Quote</th><th class="num">Aktivitäten 30 T</th></tr></thead><tbody>
              ${team.map(r=>`<tr><td><b>${esc(r.u.name)}</b></td><td class="num">${r.open}</td><td class="num">${fmtEUR0(r.pipe)}</td><td class="num">${fmtEUR0(r.w)}</td><td class="num">${fmtEUR0(r.won)}<span class="sub">${r.wonN} Abschl.</span></td><td class="num">${r.quote===null?"—":r.quote+" %"}</td><td class="num">${r.akts}</td></tr>`).join("")}
            </tbody></table></div>`:`<div class="empty">Noch keine Vertriebsaktivität im gewählten Zeitraum.</div>`}</div>
          <div class="card"><h2>Quellen</h2>
            ${sources.length?`<div class="table-scroll"><table class="data"><thead><tr><th>Quelle</th><th class="num">Chancen</th><th class="num">Gewonnen</th><th class="num">Quote</th></tr></thead><tbody>
              ${sources.map(s=>`<tr><td>${esc(s.k)}</td><td class="num">${s.n}</td><td class="num">${s.wonN?fmtEUR0(s.won):"—"}<span class="sub">${s.wonN} Abschl.</span></td><td class="num">${(s.wonN+s.lostN)?Math.round(s.wonN/(s.wonN+s.lostN)*100)+" %":"—"}</td></tr>`).join("")}
            </tbody></table></div>`:`<div class="empty">Noch keine Verkaufschancen im Zeitraum.</div>`}</div>
          <div class="card"><h2>Verlustgründe</h2>
            ${lost.length?this.barsHTML(Object.entries(lossMap).sort((a,b)=>b[1]-a[1]).map(([k,n])=>({label:k,v:n})), n=>`${n}×`)
              :`<div class="empty">Keine verlorenen Chancen im Zeitraum.</div>`}</div>
        </div>
      </div>`;
  },

  exportDealsCSV(){
    const ui=this.ui.bericht;
    const rows=[["Titel","Firma","Ansprechpartner","Phase","Wert netto","Wahrscheinlichkeit","Gewichtet","Erwarteter Abschluss","Betreuung","Quelle","Verlustgrund","Angelegt","Gewonnen am","Verloren am"]];
    const n=v=>(Math.round(v*100)/100).toFixed(2).replace(".",",");
    this.deals().filter(d=>this.ownerMatch(d.ownerId,ui.owner)).forEach(d=>{
      rows.push([d.titel,(this.firma(d.kundeId)||{}).firma||"",this.kontaktName(this.kontakt(d.kontaktId)),stageLabel(d.stage),
        n(this.dealValue(d)),this.dealChance(d)+" %",n(this.weighted(d)),fdate(d.abschluss),this.userName(d.ownerId),d.quelle||"",
        d.verlustgrund||"",fdate(dayOf(d.createdAt)),d.wonAt?fdate(dayOf(d.wonAt)):"",d.lostAt?fdate(dayOf(d.lostAt)):""]);
    });
    const csv="﻿"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\r\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    a.download=`adam-verkaufschancen-${localISO()}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  },

  /* =========================================================
     Schnellsuche (Strg/Cmd + K)
     ========================================================= */
  openSearch(){
    Modal.open(`<h3>Schnellsuche</h3>
      <input type="search" id="qs-input" placeholder="Firma, Kontakt, Verkaufschance oder Angebotsnummer …" autocomplete="off" aria-label="Suchbegriff" aria-controls="qs-results">
      <div id="qs-results" class="qs-results" role="listbox" aria-label="Suchergebnisse"></div>
      <div class="hint" style="margin-top:8px">↑ ↓ auswählen · Enter öffnen · Esc schließen</div>`, true);
    const inp=document.getElementById("qs-input");
    this._qsIdx=0;
    inp.addEventListener("input",()=>{ this._qsIdx=0; this.renderSearch(inp.value); });
    inp.addEventListener("keydown",e=>{
      const items=[...document.querySelectorAll("#qs-results .qs-item")];
      if(!items.length) return;
      if(e.key==="ArrowDown"){ e.preventDefault(); this._qsIdx=Math.min(items.length-1,this._qsIdx+1); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); this._qsIdx=Math.max(0,this._qsIdx-1); }
      else if(e.key==="Enter"){ e.preventDefault(); items[this._qsIdx].click(); return; }
      else return;
      items.forEach((el,i)=>{ el.classList.toggle("active",i===this._qsIdx); el.setAttribute("aria-selected",i===this._qsIdx); });
      items[this._qsIdx].scrollIntoView({block:"nearest"});
    });
    this.renderSearch("");
  },
  renderSearch(raw){
    const host=document.getElementById("qs-results"); if(!host) return;
    const q=raw.trim().toLowerCase();
    const item=(href,title,sub,group)=>({href,title,sub,group});
    let res=[];
    if(!q){
      res=this.recent.map(r=>{
        if(r.t==="firma"){ const f=this.firma(r.id); return f&&item("#/firma/"+sid(f.id),f.firma,FIRMA_STATUS[f.status]||"","Zuletzt geöffnet"); }
        if(r.t==="kontakt"){ const k=this.kontakt(r.id); return k&&item("#/kontakt/"+sid(k.id),this.kontaktName(k),(this.firma(k.kundeId)||{}).firma||"","Zuletzt geöffnet"); }
        if(r.t==="deal"){ const d=this.deal(r.id); return d&&item("#/deal/"+sid(d.id),d.titel,stageLabel(d.stage),"Zuletzt geöffnet"); }
        return null;
      }).filter(Boolean);
      if(!res.length){ host.innerHTML=`<div class="empty">Tippe, um Firmen, Kontakte, Verkaufschancen und Angebote zu durchsuchen.</div>`; return; }
    } else {
      const hit=s=>String(s||"").toLowerCase().includes(q);
      res=res.concat(this.firmen().filter(f=>hit(f.firma)||hit(f.plzort)).slice(0,6)
        .map(f=>item("#/firma/"+sid(f.id),f.firma,[FIRMA_STATUS[f.status],f.plzort].filter(Boolean).join(" · "),"Firmen")));
      res=res.concat(this.kontakte().filter(k=>hit(this.kontaktName(k))||hit(k.email)).slice(0,6)
        .map(k=>item("#/kontakt/"+sid(k.id),this.kontaktName(k),[k.funktion,(this.firma(k.kundeId)||{}).firma].filter(Boolean).join(" · "),"Kontakte")));
      res=res.concat(this.deals().filter(d=>hit(d.titel)||hit((this.firma(d.kundeId)||{}).firma)).slice(0,6)
        .map(d=>item("#/deal/"+sid(d.id),d.titel,[stageLabel(d.stage),(this.firma(d.kundeId)||{}).firma,fmtEUR0(this.dealValue(d))].filter(Boolean).join(" · "),"Verkaufschancen")));
      res=res.concat(Store.activeOffers().filter(o=>hit(o.doc.meta.nr)||hit(o.doc.kunde.firma)||hit(o.doc.meta.betreff)).slice(0,6)
        .map(o=>item("#/angebot/"+sid(o.id),(o.doc.meta.nr||"ohne Nummer")+" · "+(o.doc.kunde.firma||""),[STATUS[effStatus(o)],o.doc.meta.betreff].filter(Boolean).join(" · "),"Angebote")));
      if(!res.length){ host.innerHTML=`<div class="empty">Keine Treffer für „${esc(raw.trim())}“.</div>`; return; }
    }
    let lastGroup="";
    host.innerHTML=res.map((r,i)=>{
      const g=r.group!==lastGroup?`<div class="qs-group">${esc(r.group)}</div>`:"";
      lastGroup=r.group;
      return `${g}<a class="qs-item${i===this._qsIdx?" active":""}" role="option" aria-selected="${i===this._qsIdx}" href="${esc(r.href)}" onclick="Modal.close()"><b>${esc(r.title)}</b><span>${esc(r.sub)}</span></a>`;
    }).join("");
  }
};
