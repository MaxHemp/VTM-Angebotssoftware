/* =========================================================
   VTM Angebotsdesk · Anwendungslogik
   Aufbau: Helpers · Store · Auth · Router · Views · Editor ·
   Word-Export. Keine Frameworks, keine Build-Tools.
   Datenhaltung: localStorage dieses Browsers; Team-Austausch
   über Export/Import in den Einstellungen (siehe README).
   ========================================================= */

/* ---------- Helpers ---------- */
const fmtEUR = v => new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(v||0);
const fmtDate = iso => { if(!iso) return "—"; const [y,m,d]=String(iso).slice(0,10).split("-"); return `${d}.${m}.${y}`; };
const fmtDateTime = iso => { if(!iso) return "—"; const d=new Date(iso); return d.toLocaleDateString("de-DE")+" "+d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); };
const addDays = (iso,n) => { if(!iso) return ""; const d=new Date(iso); d.setDate(d.getDate()+(n||0)); return d.toISOString().slice(0,10); };
const todayISO = () => new Date().toISOString().slice(0,10);
const esc = s => (s===undefined||s===null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const nl = s => esc(s).replace(/\n/g,"<br>");
const uid = p => (p||"x")+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function lastName(full){ if(!full) return ""; const parts=full.trim().split(/\s+/); return parts[parts.length-1]; }
function toast(msg){
  const t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toast._tt); toast._tt=setTimeout(()=>t.classList.remove("show"),2600);
}

/* Mengenrabatt-Regel Sponsored LinkedIn Post */
function liRabatt(menge){ return menge>=10?20:(menge>=5?10:0); }
function lineNet(p){ return (p.menge||0)*(p.preis||0)*(1-(p.rab||0)/100); }

/* ---------- Store ---------- */
const Store = {
  KEY: "vtm-angebotsdesk-v1",
  state: null,

  emptyDoc(){
    const s = this.state.settings;
    const today = todayISO();
    return {
      kunde:{firma:"",anrede:"Frau",name:"",funktion:"",email:"",strasse:"",plzort:""},
      meta:{nr:"",datum:today,gueltig:addDays(today,s.gueltigkeitTage||14),betreff:"",anlass:"",betreuer:(Auth.user?Auth.user.name:""),kpi:true},
      anschreiben:"",
      positionen:[],
      rabatt:0, zahlungsziel:s.zahlungszielDefault||14,
      vertrag:{nr:"",datum:today,beginn:"",ende:"",kuendigung:"drei Monate zum Laufzeitende",gerichtsstand:"Köln",zusatz:""},
      rechnung:{nr:"",datum:today,von:"",bis:"",bezug:""},
      intern:{wiedervorlage:"",chance:"",notiz:""}
    };
  },

  seed(){
    return {
      version: 1,
      users: JSON.parse(JSON.stringify(SEED_USERS)),
      kunden: JSON.parse(JSON.stringify(SEED_KUNDEN)),
      offers: [],
      katalog: JSON.parse(JSON.stringify(SEED_KATALOG)),
      bundles: JSON.parse(JSON.stringify(SEED_BUNDLES)),
      templates: JSON.parse(JSON.stringify(SEED_TEMPLATES)),
      settings: Object.assign(JSON.parse(JSON.stringify(SEED_SETTINGS)), { firma: JSON.parse(JSON.stringify(SEED_FIRMA)) })
    };
  },

  load(){
    try{
      const raw = localStorage.getItem(this.KEY);
      if(raw){
        this.state = JSON.parse(raw);
        const seed = this.seed();
        for(const k of Object.keys(seed)) if(this.state[k]===undefined) this.state[k]=seed[k];
        for(const k of Object.keys(seed.settings)) if(this.state.settings[k]===undefined) this.state.settings[k]=seed.settings[k];
      } else {
        this.state = this.seed();
        this.save();
      }
    }catch(e){
      console.error("Store.load", e);
      this.state = this.seed();
    }
  },
  /* persist = nur lokal schreiben (auch von Sync genutzt);
     save = lokal schreiben + Team-Sync anstoßen */
  persist(){
    try{ localStorage.setItem(this.KEY, JSON.stringify(this.state)); }
    catch(e){ console.error("Store.persist", e); toast("Speichern fehlgeschlagen – Speicher voll?"); }
  },
  save(){
    this.persist();
    if(typeof Sync!=="undefined") Sync.onLocalChange();
  },

  katIndex(){
    const idx={};
    this.state.katalog.forEach(g=>g.items.forEach(it=>idx[it.id]=it));
    return idx;
  },

  /* Tombstones ({deleted:true}) bleiben für den Sync erhalten,
     sind aber überall ausgeblendet */
  activeOffers(){ return this.state.offers.filter(o=>!o.deleted); },
  activeKunden(){ return this.state.kunden.filter(k=>!k.deleted); },
  activeTemplates(){ return this.state.templates.filter(t=>!t.deleted); },
  offer(id){ return this.state.offers.find(o=>o.id===id && !o.deleted); },
  kunde(id){ return this.state.kunden.find(k=>k.id===id && !k.deleted); },
  userByName(name){ return this.state.users.find(u=>u.name===name); },

  calc(doc){
    const vat = this.state.settings.vat ?? 0.19;
    const netto = (doc.positionen||[]).reduce((a,p)=>a+lineNet(p),0);
    const rabatt = netto*(doc.rabatt||0)/100;
    const nettoR = netto-rabatt;
    const mwst = nettoR*vat;
    return {netto,rabatt,nettoR,mwst,brutto:nettoR+mwst,vatPct:Math.round(vat*100)};
  },

  exportJSON(){
    const dump=JSON.parse(JSON.stringify(this.state));
    if(typeof Sync!=="undefined" && Sync.config()) dump._sync=Sync.config();
    const blob = new Blob([JSON.stringify(dump,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`vtm-angebotsdesk-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  }
};

/* ---------- Status ---------- */
const STATUS = {
  entwurf:"Entwurf", pruefung:"In Prüfung", freigegeben:"Freigegeben",
  versendet:"Versendet", angenommen:"Angenommen", abgelehnt:"Abgelehnt", abgelaufen:"Abgelaufen"
};
function effStatus(o){
  if((o.status==="freigegeben"||o.status==="versendet") && o.doc.meta.gueltig && o.doc.meta.gueltig<todayISO()) return "abgelaufen";
  return o.status;
}
function badge(o){
  const st = typeof o==="string" ? o : effStatus(o);
  return `<span class="badge st-${st}">${STATUS[st]||st}</span>`;
}
function addHistory(o, text){
  o.history = o.history||[];
  o.history.push({ts:new Date().toISOString(), user:(Auth.user?Auth.user.name:"System"), text});
}
function needsApproval(o){
  const f = Store.state.settings.freigabe;
  if(!f || !f.enabled) return false;
  const c = Store.calc(o.doc);
  return (o.doc.rabatt||0) > f.maxRabatt || c.nettoR > f.maxNetto;
}
function approvalReason(o){
  const f = Store.state.settings.freigabe, c = Store.calc(o.doc), r=[];
  if((o.doc.rabatt||0) > f.maxRabatt) r.push(`Paketrabatt ${(o.doc.rabatt||0).toLocaleString("de-DE")} % über Grenze (${f.maxRabatt} %)`);
  if(c.nettoR > f.maxNetto) r.push(`Netto ${fmtEUR(c.nettoR)} über Grenze (${fmtEUR(f.maxNetto)})`);
  return r.join(" · ");
}

/* ---------- Auth ---------- */
const Auth = {
  user: null,

  async hash(pw, salt){
    const input = salt+":"+pw;
    if(window.crypto && crypto.subtle && window.isSecureContext !== false){
      try{
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
        return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
      }catch(e){ /* Fallback unten */ }
    }
    /* Fallback für nicht-sichere Kontexte (z. B. file://) */
    let h1=5381,h2=52711;
    for(let i=0;i<input.length;i++){ const c=input.charCodeAt(i); h1=(h1*33)^c; h2=(h2*31)^c; }
    return "fb"+(h1>>>0).toString(16)+(h2>>>0).toString(16);
  },

  findUser(email){
    const e=(email||"").trim().toLowerCase();
    return Store.state.users.find(u=>u.email && u.email.toLowerCase()===e);
  },

  sessionUserId(){
    return sessionStorage.getItem("vtmdesk-session") || localStorage.getItem("vtmdesk-session");
  },

  async tryRestore(){
    const id=this.sessionUserId();
    if(!id) return false;
    const u=Store.state.users.find(u=>u.id===id && u.active!==false);
    if(!u) return false;
    this.user=u;
    return true;
  },

  loginUI(){
    const form=document.getElementById("login-form");
    const emailEl=document.getElementById("login-email");
    const passEl=document.getElementById("login-pass");
    const pass2Wrap=document.getElementById("login-pass2-wrap");
    const pass2El=document.getElementById("login-pass2");
    const err=document.getElementById("login-error");
    const info=document.getElementById("login-info");
    const submit=document.getElementById("login-submit");
    let setupMode=false;

    const showErr=m=>{err.textContent=m;err.classList.add("show");};
    const clearMsg=()=>{err.classList.remove("show");info.classList.remove("show");};

    emailEl.addEventListener("input",()=>{
      clearMsg();
      if(setupMode){ setupMode=false; pass2Wrap.style.display="none";
        document.getElementById("login-pass-label").textContent="Passwort";
        passEl.autocomplete="current-password"; submit.textContent="Anmelden"; }
    });

    /* Team-Server-Verbindung direkt am Login (Onboarding ohne Datei) */
    document.getElementById("login-sync-toggle").addEventListener("click",()=>{
      const f=document.getElementById("login-sync-form");
      f.style.display = f.style.display==="none" ? "" : "none";
      if(f.style.display==="") document.getElementById("ls-url").focus();
    });
    document.getElementById("ls-connect").addEventListener("click", async ()=>{
      clearMsg();
      const url=document.getElementById("ls-url").value.trim();
      const key=document.getElementById("ls-key").value.trim();
      if(!url||!key){ showErr("Bitte Server-URL und Zugangsschlüssel eintragen."); return; }
      const btn=document.getElementById("ls-connect");
      btn.disabled=true; btn.textContent="Verbinde …";
      try{
        await Sync.test(url,key);
        Sync.saveConfig({url,key,enabled:true});
        const row=await Sync.fetchRow();
        if(row){ Store.state=Sync.mergeState(Store.state,row.data); Store.persist(); }
        Sync.startLoop(); Sync.ok();
        document.getElementById("login-sync-form").style.display="none";
        info.textContent = row
          ? "Verbunden – Team-Daten geladen. Jetzt oben mit der eigenen E-Mail anmelden."
          : "Verbunden. Auf dem Server liegen noch keine Team-Daten – nach dem ersten Login werden sie automatisch hochgeladen.";
        info.classList.add("show");
      }catch(e){ showErr(e.message); }
      finally{ btn.disabled=false; btn.textContent="Verbinden & Team-Daten laden"; }
    });

    /* Team-Daten-Import direkt am Login (Onboarding neuer Geräte).
       Natives confirm(), da der Login-Screen über dem Modal-Layer liegt. */
    const imp=document.getElementById("login-import");
    imp.addEventListener("change",()=>{
      const file=imp.files && imp.files[0];
      imp.value="";
      if(!file) return;
      const reader=new FileReader();
      reader.onload=()=>{
        let data;
        try{ data=JSON.parse(reader.result); }
        catch(e){ showErr("Die Datei ist kein gültiges JSON-Backup."); return; }
        if(!data || !Array.isArray(data.users) || !Array.isArray(data.offers)){
          showErr("Die Datei ist keine Angebotsdesk-Team-Datei."); return;
        }
        const hasLocal=Store.state.offers.length||Store.state.kunden.length;
        if(hasLocal && !confirm(`Auf diesem Gerät liegen bereits Daten (${Store.state.offers.length} Angebote). Durch den Import werden sie ersetzt. Fortfahren?`)) return;
        if(data._sync){ Sync.saveConfig(data._sync); delete data._sync; }
        localStorage.setItem(Store.KEY, JSON.stringify(data));
        sessionStorage.removeItem("vtmdesk-session");
        localStorage.removeItem("vtmdesk-session");
        location.reload();
      };
      reader.readAsText(file);
    });

    form.addEventListener("submit", async ev=>{
      ev.preventDefault(); clearMsg();
      const u=this.findUser(emailEl.value);
      if(!u || u.active===false){ showErr("Diese E-Mail-Adresse ist auf diesem Gerät nicht als Teammitglied hinterlegt. Bitte unten die von der Administration erhaltene Team-Datei importieren – oder den Zugang von der Administration anlegen lassen."); return; }

      if(!u.passHash && !setupMode){
        setupMode=true;
        pass2Wrap.style.display="";
        document.getElementById("login-pass-label").textContent="Neues Passwort (mind. 8 Zeichen)";
        passEl.value=""; passEl.autocomplete="new-password";
        submit.textContent="Passwort festlegen & anmelden";
        info.textContent=`Willkommen, ${u.name}! Für diesen Zugang wird jetzt einmalig das persönliche Passwort festgelegt.`;
        info.classList.add("show");
        passEl.focus();
        return;
      }

      if(setupMode){
        if((passEl.value||"").length<8){ showErr("Das Passwort muss mindestens 8 Zeichen lang sein."); return; }
        if(passEl.value!==pass2El.value){ showErr("Die Passwörter stimmen nicht überein."); return; }
        u.salt = uid("s");
        u.passHash = await this.hash(passEl.value, u.salt);
        u.updatedAt = new Date().toISOString();
        Store.save();
      } else {
        const h = await this.hash(passEl.value||"", u.salt||"");
        if(h!==u.passHash){ showErr("E-Mail-Adresse oder Passwort ist nicht korrekt."); return; }
      }

      this.user=u;
      const remember=document.getElementById("login-remember").checked;
      (remember?localStorage:sessionStorage).setItem("vtmdesk-session",u.id);
      App.start();
    });
  },

  async setPassword(user, pw){
    user.salt = uid("s");
    user.passHash = await this.hash(pw, user.salt);
    user.updatedAt = new Date().toISOString();
    Store.save();
  },

  isAdmin(){ return this.user && this.user.role==="admin"; },

  logout(){
    sessionStorage.removeItem("vtmdesk-session");
    localStorage.removeItem("vtmdesk-session");
    location.hash="";
    location.reload();
  }
};

/* ---------- Modal ---------- */
const Modal = {
  lastFocus:null,
  open(html, wide){
    this.lastFocus=document.activeElement;
    const bg=document.getElementById("modal-bg"), m=document.getElementById("modal");
    m.className="modal"+(wide?" wide":"");
    m.innerHTML=html;
    bg.classList.add("open");
    const f=m.querySelector("input,select,textarea,button");
    if(f) f.focus();
  },
  close(){
    document.getElementById("modal-bg").classList.remove("open");
    if(this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
  },
  confirm(title, text, label, cb, danger){
    this.open(`<h3>${esc(title)}</h3><p style="font-size:13px;color:var(--text-secondary);line-height:1.6">${text}</p>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn ${danger?'danger':'blue'}" id="modal-confirm-btn">${esc(label)}</button>
      </div>`);
    document.getElementById("modal-confirm-btn").onclick=()=>{ this.close(); cb(); };
  }
};
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && document.getElementById("modal-bg").classList.contains("open")) Modal.close();
});
document.getElementById("modal-bg").addEventListener("click",e=>{ if(e.target.id==="modal-bg") Modal.close(); });

/* ---------- Router ---------- */
const Router = {
  route(){
    if(!Auth.user) return;
    const h = location.hash || "#/dashboard";
    const parts = h.replace(/^#\//,"").split("/");
    const name = parts[0]||"dashboard";

    if(name==="neu"){ Views.newOffer(); return; }
    if(name==="angebot" && parts[1]){ this.show("editor"); Editor.open(parts[1]); this.mark("angebote"); return; }

    const known=["dashboard","angebote","kunden","katalog","freigaben","vorlagen","einstellungen"];
    const v = known.includes(name)?name:"dashboard";
    this.show(v); this.mark(v);
    Views.render(v);
  },
  show(view){
    document.querySelectorAll(".view").forEach(s=>s.hidden = (s.id!=="view-"+view));
    window.scrollTo(0,0);
  },
  mark(nav){
    document.querySelectorAll("#mainnav a").forEach(a=>{
      if(a.dataset.nav===nav) a.setAttribute("aria-current","page");
      else a.removeAttribute("aria-current");
    });
  }
};
window.addEventListener("hashchange",()=>Router.route());

/* ---------- Views ---------- */
const Views = {

  render(name){
    Views.updateNavCounts();
    if(name==="dashboard") this.dashboard();
    if(name==="angebote") this.offers();
    if(name==="kunden") this.customers();
    if(name==="katalog") this.catalog();
    if(name==="freigaben") this.approvals();
    if(name==="vorlagen") this.templates();
    if(name==="einstellungen") this.settings();
  },

  updateNavCounts(){
    const pending = Store.activeOffers().filter(o=>o.status==="pruefung");
    const mine = Auth.isAdmin()?pending:pending.filter(o=>o.createdBy===Auth.user.id);
    const el=document.getElementById("nav-freigaben-count");
    if(mine.length){ el.textContent=mine.length; el.style.display=""; } else el.style.display="none";
  },

  offerRowMeta(o){
    const c=Store.calc(o.doc);
    return {c, kunde:o.doc.kunde.firma||"(ohne Firma)", nr:o.doc.meta.nr||"—"};
  },

  /* ===== Dashboard ===== */
  dashboard(){
    const offers=Store.activeOffers();
    const open=offers.filter(o=>["entwurf","pruefung","freigegeben","versendet"].includes(o.status));
    const year=new Date().getFullYear();
    const won=offers.filter(o=>o.status==="angenommen" && (o.doc.meta.datum||"").startsWith(String(year)));
    const lost=offers.filter(o=>o.status==="abgelehnt" && (o.doc.meta.datum||"").startsWith(String(year)));
    const pipeline=open.reduce((a,o)=>a+Store.calc(o.doc).nettoR,0);
    const wonSum=won.reduce((a,o)=>a+Store.calc(o.doc).nettoR,0);
    const quote=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):null;
    const pending=offers.filter(o=>o.status==="pruefung");

    const today=todayISO();
    const wv=open.filter(o=>o.doc.intern && o.doc.intern.wiedervorlage && o.doc.intern.wiedervorlage<=today)
      .sort((a,b)=>(a.doc.intern.wiedervorlage||"").localeCompare(b.doc.intern.wiedervorlage||""));
    const expiring=offers.filter(o=>["freigegeben","versendet"].includes(o.status) && o.doc.meta.gueltig && o.doc.meta.gueltig>=today && o.doc.meta.gueltig<=addDays(today,7));
    const recent=[...offers].sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||"")).slice(0,6);

    document.getElementById("dash-greeting").textContent =
      `${new Date().toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · angemeldet als ${Auth.user.name}`;

    const li=(o,extra)=>`<li>
      <div class="lp-main"><b>${esc(this.offerRowMeta(o).nr)} · ${esc(this.offerRowMeta(o).kunde)}</b>
      <span>${esc(o.doc.meta.betreff||"")}${extra?" · "+extra:""}</span></div>
      <div style="display:flex;gap:8px;align-items:center">${badge(o)}
      <button class="btn" onclick="location.hash='#/angebot/${o.id}'">Öffnen</button></div></li>`;

    document.getElementById("dash-content").innerHTML=`
      <div class="kpi-row">
        <div class="kpi-tile"><div class="kt-label">Offene Angebote</div><div class="kt-value">${open.length}</div><div class="kt-note">Entwurf bis versendet</div></div>
        <div class="kpi-tile"><div class="kt-label">Pipeline (netto)</div><div class="kt-value">${fmtEUR(pipeline)}</div><div class="kt-note">Summe offener Angebote</div></div>
        <div class="kpi-tile dark"><div class="kt-label">Gewonnen ${year}</div><div class="kt-value">${fmtEUR(wonSum)}</div><div class="kt-note">${won.length} Angebote angenommen</div></div>
        <div class="kpi-tile"><div class="kt-label">Abschlussquote ${year}</div><div class="kt-value">${quote===null?"—":quote+" %"}</div><div class="kt-note">${won.length} gewonnen · ${lost.length} verloren</div></div>
        ${Auth.isAdmin()?`<div class="kpi-tile"><div class="kt-label">Offene Freigaben</div><div class="kt-value">${pending.length}</div><div class="kt-note">${pending.length?'<a href="#/freigaben">Zur Freigabe-Liste</a>':"Nichts zu prüfen"}</div></div>`:""}
      </div>
      <div class="cardgrid cols-2">
        <div class="card"><h2>Wiedervorlagen fällig</h2>
          ${wv.length?`<ul class="list-plain">${wv.map(o=>li(o,"Wiedervorlage "+fmtDate(o.doc.intern.wiedervorlage))).join("")}</ul>`
          :`<div class="empty">Keine fälligen Wiedervorlagen. Termine werden im Angebot unter „Interne Steuerung" gesetzt.</div>`}
        </div>
        <div class="card"><h2>Läuft in den nächsten 7 Tagen ab</h2>
          ${expiring.length?`<ul class="list-plain">${expiring.map(o=>li(o,"gültig bis "+fmtDate(o.doc.meta.gueltig))).join("")}</ul>`
          :`<div class="empty">Kein Angebot läuft in den nächsten sieben Tagen ab.</div>`}
        </div>
        <div class="card" style="grid-column:1/-1"><h2>Zuletzt bearbeitet</h2>
          ${recent.length?`<ul class="list-plain">${recent.map(o=>li(o,"bearbeitet "+fmtDateTime(o.updatedAt))).join("")}</ul>`
          :`<div class="empty"><b>Noch keine Angebote</b>Lege das erste Angebot an – Katalog und Vorlagen sind bereits eingerichtet.<br><button class="btn blue" onclick="Views.newOffer()">＋ Neues Angebot</button></div>`}
        </div>
      </div>`;
  },

  /* ===== Angebote ===== */
  offers(){
    const bsel=document.getElementById("offers-betreuer");
    if(bsel.options.length<=1){
      Store.state.users.forEach(u=>{ const o=document.createElement("option"); o.value=u.name; o.textContent=u.name; bsel.appendChild(o); });
    }
    const rerender=()=>this.renderOffersTable();
    ["offers-search","offers-status","offers-betreuer"].forEach(id=>{
      const el=document.getElementById(id);
      if(!el._bound){ el._bound=true; el.addEventListener("input",rerender); el.addEventListener("change",rerender); }
    });
    this.renderOffersTable();
  },

  filteredOffers(){
    const q=(document.getElementById("offers-search").value||"").toLowerCase();
    const st=document.getElementById("offers-status").value;
    const bt=document.getElementById("offers-betreuer").value;
    return [...Store.activeOffers()]
      .filter(o=>!st||o.status===st)
      .filter(o=>!bt||o.doc.meta.betreuer===bt)
      .filter(o=>{
        if(!q) return true;
        const hay=[o.doc.meta.nr,o.doc.kunde.firma,o.doc.kunde.name,o.doc.meta.betreff].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  },

  renderOffersTable(){
    const list=this.filteredOffers();
    document.getElementById("offers-count").textContent=`${list.length} von ${Store.activeOffers().length} Angeboten`;
    const host=document.getElementById("offers-table");
    if(!list.length){
      host.innerHTML=`<div class="empty"><b>Keine Angebote gefunden</b>Filter anpassen oder ein neues Angebot anlegen.<br><button class="btn blue" onclick="Views.newOffer()">＋ Neues Angebot</button></div>`;
      return;
    }
    host.innerHTML=`<table class="data"><thead><tr>
      <th>Nr.</th><th>Kunde</th><th>Status</th><th>Betreuung</th><th class="num">Netto</th><th>Gültig bis</th><th></th>
    </tr></thead><tbody>${list.map(o=>{
      const c=Store.calc(o.doc);
      const mayDelete = Auth.isAdmin() || (o.createdBy===Auth.user.id && o.status==="entwurf");
      return `<tr class="clickable" onclick="location.hash='#/angebot/${o.id}'">
        <td class="mono">${esc(o.doc.meta.nr)||"—"}</td>
        <td><b>${esc(o.doc.kunde.firma)||"(ohne Firma)"}</b><span class="sub">${esc(o.doc.meta.betreff||"")}</span></td>
        <td>${badge(o)}</td>
        <td>${esc(o.doc.meta.betreuer||"")}</td>
        <td class="num">${fmtEUR(c.nettoR)}</td>
        <td>${fmtDate(o.doc.meta.gueltig)}</td>
        <td class="num" onclick="event.stopPropagation()">
          <button class="btn" onclick="Views.duplicateOffer('${o.id}')">Duplizieren</button>
          ${mayDelete?`<button class="btn danger" onclick="Views.deleteOffer('${o.id}')">Löschen</button>`:""}
        </td></tr>`;
    }).join("")}</tbody></table>`;
  },

  newOffer(){
    const o={
      id: uid("a"), status:"entwurf",
      createdBy: Auth.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      history:[], freigabe:null, kundeId:null,
      doc: Store.emptyDoc()
    };
    addHistory(o,"Angebot angelegt");
    Store.state.offers.push(o); Store.save();
    location.hash="#/angebot/"+o.id;
  },

  duplicateOffer(id){
    const src=Store.offer(id); if(!src) return;
    const o=JSON.parse(JSON.stringify(src));
    o.id=uid("a"); o.status="entwurf"; o.freigabe=null; o.history=[];
    o.createdBy=Auth.user.id; o.createdAt=new Date().toISOString(); o.updatedAt=o.createdAt;
    o.doc.meta.nr=""; o.doc.vertrag.nr=""; o.doc.rechnung.nr="";
    o.doc.meta.datum=todayISO(); o.doc.meta.gueltig=addDays(todayISO(),Store.state.settings.gueltigkeitTage||14);
    o.doc.meta.betreff=(o.doc.meta.betreff||"")+" (Kopie)";
    addHistory(o,`Dupliziert aus ${src.doc.meta.nr||src.id}`);
    Store.state.offers.push(o); Store.save();
    toast("Angebot dupliziert");
    location.hash="#/angebot/"+o.id;
  },

  deleteOffer(id){
    const o=Store.offer(id); if(!o) return;
    Modal.confirm("Angebot löschen?",
      `Das Angebot <b>${esc(o.doc.meta.nr||"(ohne Nummer)")}</b> für <b>${esc(o.doc.kunde.firma||"—")}</b> wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`,
      "Endgültig löschen", ()=>{
        o.deleted=true; o.updatedAt=new Date().toISOString(); Store.save();
        toast("Angebot gelöscht"); Views.renderOffersTable(); Views.updateNavCounts();
      }, true);
  },

  exportOffersCSV(){
    const rows=[["Nr","Status","Kunde","Betreff","Betreuung","Datum","Gueltig bis","Netto","Brutto"]];
    this.filteredOffers().forEach(o=>{
      const c=Store.calc(o.doc);
      rows.push([o.doc.meta.nr,STATUS[effStatus(o)],o.doc.kunde.firma,o.doc.meta.betreff,o.doc.meta.betreuer,
        fmtDate(o.doc.meta.datum),fmtDate(o.doc.meta.gueltig),
        c.nettoR.toFixed(2).replace(".",","),c.brutto.toFixed(2).replace(".",",")]);
    });
    const csv="﻿"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\r\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    a.download=`vtm-angebote-${todayISO()}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  },

  /* ===== Kunden ===== */
  customers(){
    const el=document.getElementById("kunden-search");
    if(!el._bound){ el._bound=true; el.addEventListener("input",()=>this.renderCustomersTable()); }
    this.renderCustomersTable();
  },

  renderCustomersTable(){
    const q=(document.getElementById("kunden-search").value||"").toLowerCase();
    const list=[...Store.activeKunden()]
      .filter(k=>!q||[k.firma,k.name,k.plzort,k.email].join(" ").toLowerCase().includes(q))
      .sort((a,b)=>(a.firma||"").localeCompare(b.firma||""));
    document.getElementById("kunden-count").textContent=`${list.length} von ${Store.activeKunden().length} Kunden`;
    const host=document.getElementById("kunden-table");
    if(!list.length){
      host.innerHTML=`<div class="empty"><b>Noch keine Kunden</b>Kunden entstehen automatisch beim Speichern aus einem Angebot – oder hier manuell.<br><button class="btn blue" onclick="Views.editCustomer()">＋ Neuer Kunde</button></div>`;
      return;
    }
    host.innerHTML=`<table class="data"><thead><tr>
      <th>Firma</th><th>Ansprechpartner/in</th><th>E-Mail</th><th>Ort</th><th class="num">Angebote</th><th></th>
    </tr></thead><tbody>${list.map(k=>{
      const cnt=Store.activeOffers().filter(o=>o.kundeId===k.id || (o.doc.kunde.firma&&o.doc.kunde.firma===k.firma)).length;
      return `<tr>
        <td><b>${esc(k.firma)}</b>${k.notiz?`<span class="sub">${esc(k.notiz)}</span>`:""}</td>
        <td>${esc([k.anrede,k.name].filter(Boolean).join(" "))}${k.funktion?`<span class="sub">${esc(k.funktion)}</span>`:""}</td>
        <td class="mono">${esc(k.email||"")}</td>
        <td>${esc(k.plzort||"")}</td>
        <td class="num">${cnt}</td>
        <td class="num">
          <button class="btn blue" onclick="Views.offerForCustomer('${k.id}')">＋ Angebot</button>
          <button class="btn" onclick="Views.editCustomer('${k.id}')">Bearbeiten</button>
          ${Auth.isAdmin()?`<button class="btn danger" onclick="Views.deleteCustomer('${k.id}')">Löschen</button>`:""}
        </td></tr>`;
    }).join("")}</tbody></table>`;
  },

  editCustomer(id){
    const k=id?Store.kunde(id):{id:null,firma:"",anrede:"Frau",name:"",funktion:"",email:"",telefon:"",strasse:"",plzort:"",notiz:""};
    if(id && !k) return;
    Modal.open(`<h3>${id?"Kunde bearbeiten":"Neuer Kunde"}</h3>
      <div class="row single"><label><span>Firma *</span><input type="text" id="ck-firma" value="${esc(k.firma)}"></label></div>
      <div class="row">
        <label><span>Anrede</span><select id="ck-anrede">
          <option${k.anrede==="Frau"?" selected":""}>Frau</option>
          <option${k.anrede==="Herr"?" selected":""}>Herr</option>
          <option value=""${!k.anrede?" selected":""}>Neutral</option></select></label>
        <label><span>Ansprechpartner/in</span><input type="text" id="ck-name" value="${esc(k.name)}"></label>
      </div>
      <div class="row">
        <label><span>Funktion</span><input type="text" id="ck-funktion" value="${esc(k.funktion)}"></label>
        <label><span>E-Mail</span><input type="email" id="ck-email" value="${esc(k.email)}"></label>
      </div>
      <div class="row">
        <label><span>Telefon</span><input type="text" id="ck-telefon" value="${esc(k.telefon||"")}"></label>
        <label><span>Straße, Nr.</span><input type="text" id="ck-strasse" value="${esc(k.strasse)}"></label>
      </div>
      <div class="row"><label><span>PLZ, Ort</span><input type="text" id="ck-plzort" value="${esc(k.plzort)}"></label></div>
      <div class="row single"><label><span>Notiz (intern)</span><textarea id="ck-notiz" rows="3">${esc(k.notiz||"")}</textarea></label></div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="ck-save">Speichern</button>
      </div>`);
    document.getElementById("ck-save").onclick=()=>{
      const firma=document.getElementById("ck-firma").value.trim();
      if(!firma){ toast("Bitte eine Firma angeben"); document.getElementById("ck-firma").focus(); return; }
      const data={
        firma, anrede:document.getElementById("ck-anrede").value,
        name:document.getElementById("ck-name").value.trim(),
        funktion:document.getElementById("ck-funktion").value.trim(),
        email:document.getElementById("ck-email").value.trim(),
        telefon:document.getElementById("ck-telefon").value.trim(),
        strasse:document.getElementById("ck-strasse").value.trim(),
        plzort:document.getElementById("ck-plzort").value.trim(),
        notiz:document.getElementById("ck-notiz").value.trim()
      };
      data.updatedAt=new Date().toISOString();
      if(id){ Object.assign(Store.kunde(id),data); }
      else { Store.state.kunden.push(Object.assign({id:uid("k"),createdAt:new Date().toISOString()},data)); }
      Store.save(); Modal.close(); toast("Kunde gespeichert");
      if(location.hash.includes("kunden")) this.renderCustomersTable();
      Editor.fillCustomerSelect();
    };
  },

  deleteCustomer(id){
    const k=Store.kunde(id); if(!k) return;
    Modal.confirm("Kunde löschen?",
      `<b>${esc(k.firma)}</b> wird aus dem Kundenstamm gelöscht. Bereits erstellte Angebote bleiben unverändert erhalten.`,
      "Löschen",()=>{
        k.deleted=true; k.updatedAt=new Date().toISOString(); Store.save();
        toast("Kunde gelöscht"); this.renderCustomersTable();
      },true);
  },

  offerForCustomer(id){
    const k=Store.kunde(id); if(!k) return;
    const o={
      id: uid("a"), status:"entwurf",
      createdBy: Auth.user.id, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      history:[], freigabe:null, kundeId:id,
      doc: Store.emptyDoc()
    };
    Object.assign(o.doc.kunde,{firma:k.firma,anrede:k.anrede||"",name:k.name||"",funktion:k.funktion||"",email:k.email||"",strasse:k.strasse||"",plzort:k.plzort||""});
    addHistory(o,`Angebot für ${k.firma} angelegt`);
    Store.state.offers.push(o); Store.save();
    location.hash="#/angebot/"+o.id;
  },

  /* ===== Katalog ===== */
  catalog(){
    const admin=Auth.isAdmin();
    const kat=Store.state.katalog;
    const kidx=Store.katIndex();
    const bundleCalc=b=>{
      let sum=0;
      b.items.forEach(([iid,qty])=>{ const it=kidx[iid]; if(it) sum+=qty*it.p*(1-(it.rule==="li"?liRabatt(qty):0)/100); });
      return sum;
    };
    document.getElementById("katalog-content").innerHTML=`
      ${admin?"":`<div class="notice">Der Katalog wird von der Administration gepflegt. Preisänderungen wirken auf neue Positionen – bestehende Angebote bleiben unverändert.</div>`}
      <div class="card" style="margin-bottom:16px"><h2>Beliebte Kombinationen (Bundles)</h2>
        <div class="table-scroll"><table class="data"><thead><tr><th>Paket</th><th>Enthält</th><th class="num">Listenpreis</th><th class="num">rechnerisch</th>${admin?"<th></th>":""}</tr></thead>
        <tbody>${Store.state.bundles.map((b,i)=>`<tr>
          <td><b>${esc(b.name)}</b><span class="sub">${esc(b.sub)}</span></td>
          <td style="font-size:12px;color:var(--text-secondary)">${b.items.map(([iid,qty])=>`${qty}× ${esc(kidx[iid]?kidx[iid].t:iid)}`).join("<br>")}</td>
          <td class="num mono">${esc(b.price)}</td>
          <td class="num mono">${fmtEUR(bundleCalc(b))}</td>
          ${admin?`<td class="num"><button class="btn" onclick="Views.editBundle(${i})">Bearbeiten</button></td>`:""}
        </tr>`).join("")}</tbody></table></div>
        <div class="hint">„Rechnerisch" = Summe der Einzelpreise inkl. automatischer Mengenrabatte. Weicht der Listenpreis ab, bitte in der Paketpflege angleichen.</div>
      </div>
      ${kat.map((g,gi)=>`<div class="card" style="margin-bottom:16px"><h2>${esc(g.group)}</h2>
        <div class="table-scroll"><table class="data"><thead><tr><th>Leistung</th><th>Einheit</th><th class="num">Preis netto</th>${admin?"<th></th>":""}</tr></thead>
        <tbody>${g.items.map((it,ii)=>`<tr>
          <td style="max-width:520px"><b>${esc(it.t)}</b><span class="sub" style="white-space:pre-line">${esc(it.d)}</span></td>
          <td>${esc(it.e)}</td>
          <td class="num mono">${it.p>0?fmtEUR(it.p):"auf Anfrage"}</td>
          ${admin?`<td class="num">
            <button class="btn" onclick="Views.editCatalogItem(${gi},${ii})">Bearbeiten</button>
            <button class="btn danger" onclick="Views.deleteCatalogItem(${gi},${ii})">Löschen</button></td>`:""}
        </tr>`).join("")}</tbody></table></div>
        ${admin?`<div class="inline-actions" style="margin-top:10px"><button class="btn ghost" onclick="Views.editCatalogItem(${gi},-1)">＋ Leistung hinzufügen</button></div>`:""}
      </div>`).join("")}`;
  },

  editCatalogItem(gi,ii){
    const g=Store.state.katalog[gi];
    const it=ii>=0?g.items[ii]:{id:uid("kat"),t:"",p:0,e:"pauschal",d:""};
    Modal.open(`<h3>${ii>=0?"Leistung bearbeiten":"Neue Leistung"} · ${esc(g.group)}</h3>
      <div class="row single"><label><span>Bezeichnung *</span><input type="text" id="ci-t" value="${esc(it.t)}"></label></div>
      <div class="row">
        <label><span>Preis netto (€) · 0 = auf Anfrage</span><input type="number" id="ci-p" min="0" step="50" value="${it.p}"></label>
        <label><span>Einheit</span><input type="text" id="ci-e" value="${esc(it.e)}"></label>
      </div>
      <div class="row single"><label><span>Beschreibung (eine Zeile je Leistungsbestandteil)</span><textarea id="ci-d" rows="5">${esc(it.d)}</textarea></label></div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="ci-save">Speichern</button>
      </div>`);
    document.getElementById("ci-save").onclick=()=>{
      const t=document.getElementById("ci-t").value.trim();
      if(!t){ toast("Bitte eine Bezeichnung angeben"); return; }
      it.t=t; it.p=parseFloat(document.getElementById("ci-p").value)||0;
      it.e=document.getElementById("ci-e").value.trim()||"pauschal";
      it.d=document.getElementById("ci-d").value;
      if(ii<0) g.items.push(it);
      Store.state.katalogUpdatedAt=new Date().toISOString();
      Store.save(); Modal.close(); toast("Katalog gespeichert"); this.catalog();
    };
  },

  deleteCatalogItem(gi,ii){
    const it=Store.state.katalog[gi].items[ii];
    Modal.confirm("Leistung löschen?",
      `<b>${esc(it.t)}</b> wird aus dem Katalog entfernt. Bestehende Angebotspositionen bleiben unverändert.`,
      "Löschen",()=>{
        Store.state.katalog[gi].items.splice(ii,1);
        Store.state.katalogUpdatedAt=new Date().toISOString(); Store.save();
        toast("Leistung gelöscht"); this.catalog();
      },true);
  },

  editBundle(i){
    const b=Store.state.bundles[i];
    Modal.open(`<h3>Paket bearbeiten</h3>
      <div class="row single"><label><span>Name</span><input type="text" id="bd-name" value="${esc(b.name)}"></label></div>
      <div class="row single"><label><span>Kurzbeschreibung</span><input type="text" id="bd-sub" value="${esc(b.sub)}"></label></div>
      <div class="row single"><label><span>Listenpreis (Anzeigetext)</span><input type="text" id="bd-price" value="${esc(b.price)}"></label></div>
      <div class="hint">Die Zusammensetzung des Pakets wird aktuell im Datenbestand gepflegt (Einstellungen → Datensicherung → Export/Import).</div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="bd-save">Speichern</button>
      </div>`);
    document.getElementById("bd-save").onclick=()=>{
      b.name=document.getElementById("bd-name").value.trim()||b.name;
      b.sub=document.getElementById("bd-sub").value.trim();
      b.price=document.getElementById("bd-price").value.trim();
      Store.state.bundlesUpdatedAt=new Date().toISOString();
      Store.save(); Modal.close(); toast("Paket gespeichert"); this.catalog();
    };
  },

  /* ===== Freigaben ===== */
  approvals(){
    const admin=Auth.isAdmin();
    document.getElementById("freigaben-sub").textContent = admin
      ? "Angebote über den Freigabegrenzen prüfen und freigeben"
      : "Eigene eingereichte Angebote und Entscheidungen";
    const pending=Store.activeOffers().filter(o=>o.status==="pruefung");
    const mine=admin?pending:pending.filter(o=>o.createdBy===Auth.user.id);
    const decided=Store.activeOffers()
      .filter(o=>o.freigabe && o.freigabe.decidedAt)
      .sort((a,b)=>(b.freigabe.decidedAt||"").localeCompare(a.freigabe.decidedAt||"")).slice(0,10);
    const f=Store.state.settings.freigabe;

    document.getElementById("freigaben-content").innerHTML=`
      <div class="notice">Freigabepflicht${f.enabled?"":" (derzeit deaktiviert)"}: Paketrabatt über <b>${f.maxRabatt} %</b> oder Netto-Summe über <b>${fmtEUR(f.maxNetto)}</b>. Grenzen werden in den Einstellungen gepflegt.</div>
      <div class="card" style="margin-bottom:16px"><h2>Offene Freigaben</h2>
        ${mine.length?`<div class="table-scroll"><table class="data"><thead><tr>
          <th>Nr.</th><th>Kunde</th><th class="num">Netto</th><th class="num">Rabatt</th><th>Eingereicht</th><th>Grund</th><th></th>
        </tr></thead><tbody>${mine.map(o=>{
          const c=Store.calc(o.doc);
          return `<tr>
            <td class="mono">${esc(o.doc.meta.nr)||"—"}</td>
            <td><b>${esc(o.doc.kunde.firma)||"—"}</b><span class="sub">${esc(o.doc.meta.betreff||"")}</span></td>
            <td class="num">${fmtEUR(c.nettoR)}</td>
            <td class="num">${(o.doc.rabatt||0).toLocaleString("de-DE")} %</td>
            <td>${esc(o.freigabe?o.freigabe.requestedByName:"")}<span class="sub">${fmtDateTime(o.freigabe?o.freigabe.requestedAt:"")}</span></td>
            <td style="font-size:12px;color:var(--text-secondary)">${esc(o.freigabe?o.freigabe.reason:"")}</td>
            <td class="num">
              <button class="btn" onclick="location.hash='#/angebot/${o.id}'">Öffnen</button>
              ${admin?`<button class="btn success" onclick="Views.approve('${o.id}')">Freigeben</button>
              <button class="btn danger" onclick="Views.reject('${o.id}')">Zurückweisen</button>`:""}
            </td></tr>`;
        }).join("")}</tbody></table></div>`
        :`<div class="empty">Keine offenen Freigaben.</div>`}
      </div>
      <div class="card"><h2>Letzte Entscheidungen</h2>
        ${decided.length?`<ul class="list-plain">${decided.map(o=>`<li>
          <div class="lp-main"><b>${esc(o.doc.meta.nr||"—")} · ${esc(o.doc.kunde.firma||"—")}</b>
          <span>${esc(o.freigabe.decision==="approved"?"freigegeben":"zurückgewiesen")} von ${esc(o.freigabe.decidedByName||"")} am ${fmtDateTime(o.freigabe.decidedAt)}${o.freigabe.comment?" · „"+esc(o.freigabe.comment)+"“":""}</span></div>
          <button class="btn" onclick="location.hash='#/angebot/${o.id}'">Öffnen</button></li>`).join("")}</ul>`
        :`<div class="empty">Noch keine Entscheidungen protokolliert.</div>`}
      </div>`;
  },

  approve(id){
    const o=Store.offer(id); if(!o||!Auth.isAdmin()) return;
    o.status="freigegeben";
    o.freigabe=Object.assign(o.freigabe||{},{decision:"approved",decidedBy:Auth.user.id,decidedByName:Auth.user.name,decidedAt:new Date().toISOString(),comment:""});
    addHistory(o,"Freigegeben durch "+Auth.user.name);
    o.updatedAt=new Date().toISOString(); Store.save();
    toast(`Angebot ${o.doc.meta.nr||""} freigegeben`);
    this.approvals(); this.updateNavCounts();
    if(Editor.offer && Editor.offer.id===id) Editor.updateBar();
  },

  reject(id){
    const o=Store.offer(id); if(!o||!Auth.isAdmin()) return;
    Modal.open(`<h3>Angebot zurückweisen</h3>
      <p style="font-size:13px;color:var(--text-secondary)">Das Angebot <b>${esc(o.doc.meta.nr||"—")}</b> geht zurück in den Status „Entwurf". Bitte kurz begründen, damit die Betreuung nacharbeiten kann.</p>
      <div class="row single"><label><span>Begründung</span><textarea id="rj-comment" rows="3" placeholder="z. B. Rabatt auf 12 % begrenzen …"></textarea></label></div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn danger" id="rj-save">Zurückweisen</button>
      </div>`);
    document.getElementById("rj-save").onclick=()=>{
      const comment=document.getElementById("rj-comment").value.trim();
      o.status="entwurf";
      o.freigabe=Object.assign(o.freigabe||{},{decision:"rejected",decidedBy:Auth.user.id,decidedByName:Auth.user.name,decidedAt:new Date().toISOString(),comment});
      addHistory(o,"Zurückgewiesen durch "+Auth.user.name+(comment?": "+comment:""));
      o.updatedAt=new Date().toISOString(); Store.save(); Modal.close();
      toast("Angebot zurückgewiesen");
      this.approvals(); this.updateNavCounts();
      if(Editor.offer && Editor.offer.id===id) Editor.updateBar();
    };
  },

  /* ===== Vorlagen ===== */
  templates(){
    const list=Store.activeTemplates();
    document.getElementById("vorlagen-content").innerHTML=`
      <div class="notice">Anschreiben-Vorlagen stehen im Angebots-Editor zur Auswahl. E-Mail-Vorlagen nutzt der Button „E-Mail-Text" – Platzhalter: <span class="mono" style="font-family:var(--font-mono);font-size:11px">{NR} {BETREFF} {SUMME} {GUELTIG} {BETREUER}</span></div>
      <div class="cardgrid cols-2">
      ${list.length?list.map(t=>`<div class="card">
        <h2>${esc(t.name)}<span class="h2-action"><span class="badge ${t.type==="email"?"st-versendet":"st-freigegeben"}">${t.type==="email"?"E-Mail":"Anschreiben"}</span></span></h2>
        <p style="font-size:12.5px;color:var(--text-secondary);white-space:pre-line;max-height:130px;overflow:hidden">${esc(t.text)}</p>
        <div class="inline-actions" style="margin-top:10px">
          <button class="btn" onclick="Views.editTemplate('${t.id}')">Bearbeiten</button>
          <button class="btn danger" onclick="Views.deleteTemplate('${t.id}')">Löschen</button>
        </div>
      </div>`).join(""):`<div class="card"><div class="empty"><b>Keine Vorlagen</b>Lege die erste Textvorlage an.</div></div>`}
      </div>`;
  },

  editTemplate(id){
    const t=id?Store.activeTemplates().find(x=>x.id===id):{id:null,type:"anschreiben",name:"",text:""};
    if(id&&!t) return;
    Modal.open(`<h3>${id?"Vorlage bearbeiten":"Neue Vorlage"}</h3>
      <div class="row">
        <label><span>Name *</span><input type="text" id="tp-name" value="${esc(t.name)}"></label>
        <label><span>Typ</span><select id="tp-type">
          <option value="anschreiben"${t.type==="anschreiben"?" selected":""}>Anschreiben (Dokument)</option>
          <option value="email"${t.type==="email"?" selected":""}>E-Mail-Text</option></select></label>
      </div>
      <div class="row single"><label><span>Text</span><textarea id="tp-text" rows="9">${esc(t.text)}</textarea></label></div>
      <div class="hint">Anschreiben-Vorlagen: ohne Anrede-Zeile schreiben – die persönliche Anrede wird beim Einsetzen automatisch ergänzt.</div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="tp-save">Speichern</button>
      </div>`, true);
    document.getElementById("tp-save").onclick=()=>{
      const name=document.getElementById("tp-name").value.trim();
      if(!name){ toast("Bitte einen Namen angeben"); return; }
      const data={name,type:document.getElementById("tp-type").value,text:document.getElementById("tp-text").value,updatedAt:new Date().toISOString()};
      if(id) Object.assign(t,data);
      else Store.state.templates.push(Object.assign({id:uid("tpl")},data));
      Store.save(); Modal.close(); toast("Vorlage gespeichert");
      this.templates(); Editor.fillTemplateSelect();
    };
  },

  deleteTemplate(id){
    const t=Store.activeTemplates().find(x=>x.id===id); if(!t) return;
    Modal.confirm("Vorlage löschen?",`<b>${esc(t.name)}</b> wird gelöscht.`,"Löschen",()=>{
      t.deleted=true; t.updatedAt=new Date().toISOString();
      Store.save(); toast("Vorlage gelöscht"); this.templates(); Editor.fillTemplateSelect();
    },true);
  },

  /* ===== Einstellungen ===== */
  settings(){
    const admin=Auth.isAdmin();
    document.getElementById("settings-sub").textContent=admin
      ?"Firmendaten, Freigaberegeln, Nummernkreise, Benutzer und Datensicherung"
      :"Eigenes Konto und Datensicherung";
    const s=Store.state.settings, F=s.firma;

    const firmaCard=admin?`<div class="card"><h2>Firmendaten (erscheinen auf allen Dokumenten)</h2>
      <div class="row"><label><span>Firmierung (lang)</span><input type="text" id="st-name" value="${esc(F.name)}"></label>
      <label><span>Firmierung (kurz)</span><input type="text" id="st-kurz" value="${esc(F.kurz)}"></label></div>
      <div class="row"><label><span>Straße, Nr.</span><input type="text" id="st-strasse" value="${esc(F.strasse)}"></label>
      <label><span>PLZ, Ort</span><input type="text" id="st-plzort" value="${esc(F.plzort)}"></label></div>
      <div class="row"><label><span>Registereintrag</span><input type="text" id="st-hrb" value="${esc(F.hrb)}"></label>
      <label><span>Geschäftsführung</span><input type="text" id="st-gf" value="${esc(F.gf)}"></label></div>
      <div class="row"><label><span>IBAN</span><input type="text" id="st-iban" value="${esc(F.iban)}"></label>
      <label><span>Steuernummer</span><input type="text" id="st-stnr" value="${esc(F.stnr)}"></label></div>
      <div class="row"><label><span>E-Mail</span><input type="email" id="st-mail" value="${esc(F.mail)}"></label>
      <label><span>Website</span><input type="text" id="st-web" value="${esc(F.web)}"></label></div>
      <div class="inline-actions"><button class="btn blue" onclick="Views.saveFirma()">Firmendaten speichern</button></div>
    </div>`:"";

    const rulesCard=admin?`<div class="card"><h2>Freigaberegeln &amp; Standards</h2>
      <label class="switch"><input type="checkbox" id="st-fg-enabled"${s.freigabe.enabled?" checked":""}> Freigabepflicht aktiv</label>
      <div class="row thirds">
        <label><span>Max. Paketrabatt ohne Freigabe (%)</span><input type="number" id="st-fg-rabatt" min="0" max="100" value="${s.freigabe.maxRabatt}"></label>
        <label><span>Max. Netto ohne Freigabe (€)</span><input type="number" id="st-fg-netto" min="0" step="500" value="${s.freigabe.maxNetto}"></label>
        <label><span>USt.-Satz (%)</span><input type="number" id="st-vat" min="0" max="30" step="0.5" value="${Math.round((s.vat??0.19)*1000)/10}"></label>
      </div>
      <div class="row thirds">
        <label><span>Zahlungsziel Standard (Tage)</span><input type="number" id="st-zz" min="0" value="${s.zahlungszielDefault}"></label>
        <label><span>Angebots-Gültigkeit (Tage)</span><input type="number" id="st-gt" min="1" value="${s.gueltigkeitTage}"></label>
      </div>
      <div class="inline-actions"><button class="btn blue" onclick="Views.saveRules()">Regeln speichern</button></div>
    </div>`:"";

    const countersCard=admin?`<div class="card"><h2>Nummernkreise (${s.counters.year})</h2>
      <div class="notice">Formate: Angebot <b>A-JJJJ-NNN</b> · Vertrag <b>V-JJJJ-NNN</b> · Rechnung <b>VTM-JJJJ-NNNN</b>. Hinterlegt ist jeweils die <b>zuletzt vergebene</b> Nummer; „Nächste Nummer ziehen" vergibt die folgende.</div>
      <div class="row thirds">
        <label><span>Angebot · zuletzt</span><input type="number" id="st-cn-angebot" min="0" value="${s.counters.angebot}"></label>
        <label><span>Vertrag · zuletzt</span><input type="number" id="st-cn-vertrag" min="0" value="${s.counters.vertrag}"></label>
        <label><span>Rechnung · zuletzt</span><input type="number" id="st-cn-rechnung" min="0" value="${s.counters.rechnung}"></label>
      </div>
      <div class="inline-actions"><button class="btn blue" onclick="Views.saveCounters()">Nummernkreise speichern</button></div>
    </div>`:"";

    const usersCard=admin?`<div class="card"><h2>Benutzer &amp; Rollen</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Name</th><th>E-Mail (Login)</th><th>Rolle</th><th>Status</th><th></th></tr></thead>
      <tbody>${Store.state.users.map(u=>`<tr>
        <td><b>${esc(u.name)}</b></td>
        <td class="mono">${esc(u.email)||"<span style='color:var(--text-muted)'>kein Login hinterlegt</span>"}</td>
        <td>${u.role==="admin"?"Administration":"Vertrieb"}</td>
        <td>${u.active===false?'<span class="badge st-abgelehnt">deaktiviert</span>':(u.passHash?'<span class="badge st-angenommen">aktiv</span>':'<span class="badge st-entwurf">wartet auf 1. Login</span>')}</td>
        <td class="num">
          <button class="btn" onclick="Views.editUser('${u.id}')">Bearbeiten</button>
          ${u.passHash?`<button class="btn" onclick="Views.resetUserPass('${u.id}')">Passwort zurücksetzen</button>`:""}
          ${u.id!==Auth.user.id?`<button class="btn ${u.active===false?"":"danger"}" onclick="Views.toggleUser('${u.id}')">${u.active===false?"Aktivieren":"Deaktivieren"}</button>`:""}
        </td></tr>`).join("")}</tbody></table></div>
      <div class="inline-actions" style="margin-top:10px"><button class="btn blue" onclick="Views.editUser()">＋ Benutzer anlegen</button></div>
      <div class="hint">Neue Benutzer legen beim ersten Login ihr Passwort selbst fest. Ohne hinterlegte E-Mail ist kein Login möglich (Name erscheint trotzdem in der Betreuer-Auswahl).</div>
    </div>`:"";

    const sc=(typeof Sync!=="undefined" && Sync.config())||{};
    const syncCard=`<div class="card"><h2>Team-Synchronisation</h2>
      <p id="st-sync-status" style="font-size:12.5px;margin-bottom:10px"></p>
      ${admin?`
      <div class="row">
        <label><span>Supabase-Projekt-URL</span><input type="text" id="st-sync-url" placeholder="https://xxxx.supabase.co" value="${esc(sc.url||"")}"></label>
        <label><span>Zugangsschlüssel (anon public key)</span><input type="text" id="st-sync-key" placeholder="eyJ…" value="${esc(sc.key||"")}"></label>
      </div>
      <div class="inline-actions">
        <button class="btn blue" onclick="Views.connectSync()">Speichern &amp; verbinden</button>
        <button class="btn" onclick="Sync.syncOnce().then(ok=>toast(ok?'Synchronisiert':'Synchronisation fehlgeschlagen'))">Jetzt synchronisieren</button>
        ${sc.url?`<button class="btn danger" onclick="Views.disconnectSync()">Trennen</button>`:""}
      </div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:12.5px;color:var(--text-secondary);font-weight:600">Einmalige Einrichtung (Supabase, ca. 5 Minuten)</summary>
        <ol style="font-size:12.5px;color:var(--text-secondary);margin:10px 0 8px 18px;line-height:1.8">
          <li>Auf <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> ein neues Projekt anlegen (Free-Tarif genügt).</li>
          <li>Im Projekt links <b>SQL Editor</b> öffnen, dieses Script einfügen und mit „Run" ausführen:</li>
        </ol>
        <textarea readonly rows="10" style="font-family:var(--font-mono);font-size:11px" onclick="this.select()">${esc(SYNC_SETUP_SQL)}</textarea>
        <ol start="3" style="font-size:12.5px;color:var(--text-secondary);margin:8px 0 0 18px;line-height:1.8">
          <li>Links <b>Settings → API</b>: die <b>Project URL</b> und den <b>anon public</b>-Key kopieren und oben eintragen → „Speichern &amp; verbinden".</li>
          <li>Teammitglieder: am Login-Screen „Mit Team-Server verbinden" und dieselben zwei Werte eintragen – danach mit der eigenen E-Mail anmelden.</li>
        </ol>
      </details>`
      :`<div class="hint">Die Verbindung zum Team-Server richtet die Administration ein. Änderungen werden automatisch mit dem Team synchronisiert.</div>`}
    </div>`;

    const accountCard=`<div class="card"><h2>Eigenes Konto</h2>
      <p style="font-size:13px;margin-bottom:10px"><b>${esc(Auth.user.name)}</b> · <span class="mono" style="font-family:var(--font-mono);font-size:12px">${esc(Auth.user.email)}</span> · ${Auth.isAdmin()?"Administration":"Vertrieb"}</p>
      <div class="row">
        <label><span>Neues Passwort (mind. 8 Zeichen)</span><input type="password" id="st-pw1" autocomplete="new-password"></label>
        <label><span>Wiederholen</span><input type="password" id="st-pw2" autocomplete="new-password"></label>
      </div>
      <div class="inline-actions"><button class="btn blue" onclick="Views.changeOwnPass()">Passwort ändern</button></div>
    </div>`;

    const backupCard=`<div class="card"><h2>Datensicherung</h2>
      <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:10px">Alle Daten (Angebote, Kunden, Katalog, Benutzer, Einstellungen) liegen im Browser dieses Geräts. Regelmäßig exportieren! Der Export ist zugleich die <b>Team-Datei fürs Onboarding</b>: Nach dem Anlegen neuer Benutzer die Datei an die Person schicken – sie importiert sie auf dem Login-Screen über „Team-Daten importieren" und meldet sich dann mit ihrer E-Mail an.</p>
      <div class="inline-actions">
        <button class="btn blue" onclick="Store.exportJSON()">Backup exportieren (JSON)</button>
        ${admin?`<button class="btn" onclick="document.getElementById('st-import').click()">Backup importieren</button>
        <input type="file" id="st-import" accept="application/json" style="display:none" onchange="Views.importBackup(this)">`:""}
        ${admin?`<button class="btn danger" onclick="Views.resetAll()">Alles zurücksetzen</button>`:""}
      </div>
    </div>`;

    document.getElementById("settings-content").innerHTML=
      `<div class="cardgrid cols-2">${syncCard}${accountCard}</div>
       <div style="height:16px"></div><div class="cardgrid cols-2">${backupCard}${admin?rulesCard:""}</div>
       ${admin?`<div style="height:16px"></div><div class="cardgrid cols-2">${firmaCard}${countersCard}</div>
       <div style="height:16px"></div>${usersCard}`:""}`;
    if(typeof Sync!=="undefined") Sync.updateUI();
  },

  async connectSync(){
    const url=document.getElementById("st-sync-url").value.trim();
    const key=document.getElementById("st-sync-key").value.trim();
    if(!url||!key){ toast("Bitte Server-URL und Zugangsschlüssel eintragen"); return; }
    try{ await Sync.test(url,key); }
    catch(e){ toast(e.message); Sync.lastError=e.message; Sync.updateUI(); return; }
    Sync.saveConfig({url,key,enabled:true});
    Sync.startLoop();
    const ok=await Sync.syncOnce();
    toast(ok?"Team-Synchronisation aktiv":"Verbunden, aber erste Synchronisation fehlgeschlagen");
    this.settings();
  },

  disconnectSync(){
    Modal.confirm("Team-Synchronisation trennen?",
      "Dieses Gerät synchronisiert dann nicht mehr mit dem Team-Server. Die lokalen Daten bleiben erhalten.",
      "Trennen",()=>{
        Sync.clearConfig(); Sync.lastError=null; Sync.lastSync=null;
        toast("Synchronisation getrennt"); this.settings();
      },true);
  },

  saveFirma(){
    const F=Store.state.settings.firma;
    ["name","kurz","strasse","plzort","hrb","gf","iban","stnr","mail","web"].forEach(k=>{
      F[k]=document.getElementById("st-"+k).value.trim();
    });
    Store.state.settingsUpdatedAt=new Date().toISOString();
    Store.save(); toast("Firmendaten gespeichert");
  },
  saveRules(){
    const s=Store.state.settings;
    s.freigabe.enabled=document.getElementById("st-fg-enabled").checked;
    s.freigabe.maxRabatt=parseFloat(document.getElementById("st-fg-rabatt").value)||0;
    s.freigabe.maxNetto=parseFloat(document.getElementById("st-fg-netto").value)||0;
    s.vat=(parseFloat(document.getElementById("st-vat").value)||19)/100;
    s.zahlungszielDefault=parseInt(document.getElementById("st-zz").value)||14;
    s.gueltigkeitTage=parseInt(document.getElementById("st-gt").value)||14;
    Store.state.settingsUpdatedAt=new Date().toISOString();
    Store.save(); toast("Regeln gespeichert");
  },
  saveCounters(){
    const c=Store.state.settings.counters;
    c.angebot=parseInt(document.getElementById("st-cn-angebot").value)||0;
    c.vertrag=parseInt(document.getElementById("st-cn-vertrag").value)||0;
    c.rechnung=parseInt(document.getElementById("st-cn-rechnung").value)||0;
    Store.state.settingsUpdatedAt=new Date().toISOString();
    Store.save(); toast("Nummernkreise gespeichert");
  },

  editUser(id){
    const u=id?Store.state.users.find(x=>x.id===id):{id:null,name:"",email:"",role:"vertrieb"};
    if(id&&!u) return;
    Modal.open(`<h3>${id?"Benutzer bearbeiten":"Benutzer anlegen"}</h3>
      <div class="row">
        <label><span>Name *</span><input type="text" id="us-name" value="${esc(u.name)}"></label>
        <label><span>E-Mail (Login)</span><input type="email" id="us-email" value="${esc(u.email)}"></label>
      </div>
      <div class="row"><label><span>Rolle</span><select id="us-role">
        <option value="vertrieb"${u.role!=="admin"?" selected":""}>Vertrieb</option>
        <option value="admin"${u.role==="admin"?" selected":""}>Administration</option></select></label></div>
      <div class="hint">Das Passwort legt die Person beim ersten Login selbst fest.</div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="us-save">Speichern</button>
      </div>`);
    document.getElementById("us-save").onclick=()=>{
      const name=document.getElementById("us-name").value.trim();
      const email=document.getElementById("us-email").value.trim().toLowerCase();
      if(!name){ toast("Bitte einen Namen angeben"); return; }
      if(email && Store.state.users.some(x=>x.email && x.email.toLowerCase()===email && x.id!==id)){
        toast("Diese E-Mail-Adresse ist bereits vergeben"); return;
      }
      const role=document.getElementById("us-role").value;
      if(id){
        if(u.id===Auth.user.id && role!=="admin" && Auth.isAdmin() &&
           Store.state.users.filter(x=>x.role==="admin"&&x.active!==false).length<=1){
          toast("Der letzte Admin kann sich nicht selbst herabstufen"); return;
        }
        u.name=name; u.email=email; u.role=role; u.updatedAt=new Date().toISOString();
      } else {
        Store.state.users.push({id:uid("u"),name,email,role,active:true,passHash:null,salt:null,updatedAt:new Date().toISOString()});
      }
      Store.save(); Modal.close(); toast("Benutzer gespeichert"); this.settings(); Editor.fillBetreuerSelect();
    };
  },

  resetUserPass(id){
    const u=Store.state.users.find(x=>x.id===id); if(!u) return;
    Modal.confirm("Passwort zurücksetzen?",
      `<b>${esc(u.name)}</b> legt beim nächsten Login ein neues Passwort fest. Die aktuelle Anmeldung wird ungültig.`,
      "Zurücksetzen",()=>{
        u.passHash=null; u.salt=null; u.updatedAt=new Date().toISOString(); Store.save();
        toast("Passwort zurückgesetzt"); this.settings();
      });
  },

  toggleUser(id){
    const u=Store.state.users.find(x=>x.id===id); if(!u) return;
    if(u.active!==false && u.role==="admin" &&
       Store.state.users.filter(x=>x.role==="admin"&&x.active!==false).length<=1){
      toast("Der letzte aktive Admin kann nicht deaktiviert werden"); return;
    }
    u.active = u.active===false ? true : false;
    u.updatedAt=new Date().toISOString();
    Store.save(); this.settings();
    toast(u.active?"Benutzer aktiviert":"Benutzer deaktiviert");
  },

  async changeOwnPass(){
    const p1=document.getElementById("st-pw1").value, p2=document.getElementById("st-pw2").value;
    if(p1.length<8){ toast("Mindestens 8 Zeichen"); return; }
    if(p1!==p2){ toast("Passwörter stimmen nicht überein"); return; }
    await Auth.setPassword(Auth.user,p1);
    document.getElementById("st-pw1").value=""; document.getElementById("st-pw2").value="";
    toast("Passwort geändert");
  },

  importBackup(input){
    const file=input.files && input.files[0];
    input.value="";
    if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      let data;
      try{ data=JSON.parse(reader.result); }
      catch(e){ toast("Datei ist kein gültiges JSON-Backup"); return; }
      if(!data || !Array.isArray(data.users) || !Array.isArray(data.offers)){
        toast("Datei ist kein Angebotsdesk-Backup"); return;
      }
      Modal.confirm("Backup importieren?",
        `Der komplette Datenbestand dieses Browsers wird durch das Backup ersetzt (${data.offers.length} Angebote, ${(data.kunden||[]).length} Kunden). Vorher ggf. den aktuellen Stand exportieren.`,
        "Importieren & neu laden",()=>{
          if(data._sync){ Sync.saveConfig(data._sync); delete data._sync; }
          localStorage.setItem(Store.KEY, JSON.stringify(data));
          location.reload();
        },true);
    };
    reader.readAsText(file);
  },

  resetAll(){
    Modal.confirm("Alles zurücksetzen?",
      "Sämtliche Angebote, Kunden, Benutzer und Einstellungen in diesem Browser werden gelöscht und die Anwendung auf den Auslieferungszustand zurückgesetzt. Ein Backup-Export vorher ist dringend empfohlen.",
      "Endgültig zurücksetzen",()=>{
        localStorage.removeItem(Store.KEY);
        localStorage.removeItem("vtmdesk-session");
        sessionStorage.removeItem("vtmdesk-session");
        location.reload();
      },true);
  }
};

/* =========================================================
   Editor · Angebot / Vertrag / Rechnung
   ========================================================= */
const Editor = {
  offer:null, s:null, tab:"angebot", _saveTimer:null,

  get FIRMA(){ return Store.state.settings.firma; },

  bindInputs(){
    document.querySelectorAll("#view-editor [data-k]").forEach(el=>{
      const ev=(el.tagName==="SELECT"||el.type==="checkbox"||el.type==="date")?"change":"input";
      el.addEventListener(ev,()=>{
        if(!this.s) return;
        const path=el.getAttribute("data-k").split(".");
        let ref=this.s;
        for(let i=0;i<path.length-1;i++) ref=ref[path[i]];
        const key=path[path.length-1];
        if(el.type==="checkbox") ref[key]=el.checked;
        else if(el.type==="number") ref[key]=parseFloat(el.value)||0;
        else ref[key]=el.value;
        this.renderAll();
        this.scheduleSave();
      });
    });
  },
  pushToInputs(){
    document.querySelectorAll("#view-editor [data-k]").forEach(el=>{
      const path=el.getAttribute("data-k").split(".");
      let v=this.s;
      for(const p of path){ v=(v||{})[p]; }
      if(el.type==="checkbox") el.checked=!!v;
      else el.value=(v===undefined||v===null)?"":v;
    });
  },

  open(id){
    const o=Store.offer(id);
    if(!o){ toast("Angebot nicht gefunden"); location.hash="#/angebote"; return; }
    /* Ältere Datenstände um neue Felder ergänzen */
    const base=Store.emptyDoc();
    for(const k of Object.keys(base)) if(o.doc[k]===undefined) o.doc[k]=base[k];
    if(!o.doc.intern) o.doc.intern=base.intern;
    this.offer=o; this.s=o.doc; this.tab="angebot";
    this.fillBetreuerSelect(); this.fillCustomerSelect(); this.fillTemplateSelect();
    this.renderCatalog();
    this.pushToInputs();
    this.setTab("angebot");
    this.updateBar();
    document.getElementById("editor-autosave").textContent="";
  },

  backToList(){ location.hash="#/angebote"; },

  updateBar(){
    const o=this.offer; if(!o) return;
    document.getElementById("editor-id").innerHTML=`<b>${esc(o.doc.meta.nr||"ohne Nummer")}</b> · angelegt von ${esc((Store.state.users.find(u=>u.id===o.createdBy)||{}).name||"—")}`;
    document.getElementById("editor-status").innerHTML=badge(o);

    const host=document.getElementById("editor-workflow-actions");
    const acts=[];
    const na=needsApproval(o);
    if(o.status==="entwurf"){
      if(na && !Auth.isAdmin()) acts.push(`<button class="btn blue" onclick="Editor.submitApproval()">Zur Freigabe einreichen</button>`);
      else acts.push(`<button class="btn success" onclick="Editor.markStatus('freigegeben','Freigegeben')">Freigeben</button>`);
    }
    if(o.status==="pruefung" && Auth.isAdmin()){
      acts.push(`<button class="btn success" onclick="Views.approve('${o.id}');Editor.updateBar()">Freigeben</button>`);
      acts.push(`<button class="btn danger" onclick="Views.reject('${o.id}')">Zurückweisen</button>`);
    }
    if(o.status==="freigegeben") acts.push(`<button class="btn" onclick="Editor.markStatus('versendet','Als versendet markiert')">Als versendet markieren</button>`);
    if(o.status==="versendet"){
      acts.push(`<button class="btn success" onclick="Editor.markStatus('angenommen','Vom Kunden angenommen')">Angenommen</button>`);
      acts.push(`<button class="btn danger" onclick="Editor.markStatus('abgelehnt','Vom Kunden abgelehnt')">Abgelehnt</button>`);
    }
    if(o.status==="angenommen"||o.status==="abgelehnt") acts.push(`<button class="btn" onclick="Editor.markStatus('entwurf','Wieder geöffnet')">Wieder öffnen</button>`);
    acts.push(`<button class="btn" onclick="Editor.showHistory()">Verlauf</button>`);
    host.innerHTML=acts.join(" ");

    const note=document.getElementById("freigabe-note");
    if(o.status==="pruefung"){
      note.style.display="";
      note.innerHTML=`<b>In Prüfung:</b> Dieses Angebot wartet auf die Freigabe der Administration (${esc(o.freigabe?o.freigabe.reason:approvalReason(o))}).`;
    } else if(o.status==="entwurf" && o.freigabe && o.freigabe.decision==="rejected" && o.freigabe.comment){
      note.style.display="";
      note.innerHTML=`<b>Zurückgewiesen:</b> „${esc(o.freigabe.comment)}“ – bitte anpassen und erneut einreichen.`;
    } else if(o.status==="entwurf" && na){
      note.style.display="";
      note.innerHTML=`<b>Freigabepflichtig:</b> ${esc(approvalReason(o))}. ${Auth.isAdmin()?"Als Admin kannst Du direkt freigeben.":"Vor dem Versand bitte zur Freigabe einreichen."}`;
    } else note.style.display="none";
  },

  submitApproval(){
    const o=this.offer;
    o.status="pruefung";
    o.freigabe={requestedBy:Auth.user.id,requestedByName:Auth.user.name,requestedAt:new Date().toISOString(),reason:approvalReason(o),decision:null,comment:""};
    addHistory(o,"Zur Freigabe eingereicht ("+o.freigabe.reason+")");
    this.save(false);
    toast("Zur Freigabe eingereicht");
    this.updateBar(); Views.updateNavCounts();
  },

  markStatus(st,text){
    const o=this.offer;
    o.status=st;
    addHistory(o,text);
    this.save(false);
    toast(text);
    this.updateBar(); Views.updateNavCounts();
  },

  showHistory(){
    const o=this.offer;
    Modal.open(`<h3>Verlauf · ${esc(o.doc.meta.nr||"ohne Nummer")}</h3>
      <ul class="history">${(o.history||[]).slice().reverse().map(h=>`<li><span class="h-ts">${fmtDateTime(h.ts)}</span><span><b>${esc(h.user)}</b> · ${esc(h.text)}</span></li>`).join("")||"<li>Kein Verlauf vorhanden.</li>"}</ul>
      <div class="modal-actions"><button class="btn" onclick="Modal.close()">Schließen</button></div>`);
  },

  scheduleSave(){
    clearTimeout(this._saveTimer);
    this._saveTimer=setTimeout(()=>this.save(false),800);
  },
  save(manual){
    const o=this.offer; if(!o) return;
    o.updatedAt=new Date().toISOString();
    Store.save();
    document.getElementById("editor-autosave").textContent="Gespeichert "+new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    if(manual) toast("Angebot gespeichert");
    this.updateBar();
  },

  /* ---------- Selects ---------- */
  fillBetreuerSelect(){
    const sel=document.getElementById("betreuer-select"); if(!sel) return;
    const cur=this.s?this.s.meta.betreuer:"";
    sel.innerHTML=Store.state.users.filter(u=>u.active!==false).map(u=>`<option${u.name===cur?" selected":""}>${esc(u.name)}</option>`).join("");
    if(cur && ![...sel.options].some(o=>o.value===cur)){
      sel.insertAdjacentHTML("beforeend",`<option selected>${esc(cur)}</option>`);
    }
  },
  fillCustomerSelect(){
    const sel=document.getElementById("kunde-select"); if(!sel) return;
    sel.innerHTML=`<option value="">— Kunde wählen —</option>`+
      [...Store.activeKunden()].sort((a,b)=>(a.firma||"").localeCompare(b.firma||""))
      .map(k=>`<option value="${k.id}">${esc(k.firma)}${k.name?" · "+esc(k.name):""}</option>`).join("");
  },
  fillTemplateSelect(){
    const sel=document.getElementById("anschreiben-tpl"); if(!sel) return;
    sel.innerHTML=Store.activeTemplates().filter(t=>t.type==="anschreiben")
      .map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("")||`<option value="">Keine Vorlagen</option>`;
  },

  pickCustomer(id){
    if(!id||!this.s) return;
    const k=Store.kunde(id); if(!k) return;
    Object.assign(this.s.kunde,{firma:k.firma,anrede:k.anrede||"",name:k.name||"",funktion:k.funktion||"",email:k.email||"",strasse:k.strasse||"",plzort:k.plzort||""});
    this.offer.kundeId=id;
    this.pushToInputs(); this.renderAll(); this.scheduleSave();
    toast(`Kundendaten von ${k.firma} übernommen`);
  },

  saveAsCustomer(){
    const kd=this.s.kunde;
    if(!kd.firma){ toast("Bitte zuerst eine Firma eintragen"); return; }
    let k=Store.activeKunden().find(x=>x.firma.toLowerCase()===kd.firma.toLowerCase());
    if(k){
      Object.assign(k,{anrede:kd.anrede,name:kd.name,funktion:kd.funktion,email:kd.email,strasse:kd.strasse,plzort:kd.plzort,updatedAt:new Date().toISOString()});
      toast(`Kunde „${k.firma}" aktualisiert`);
    } else {
      k=Object.assign({id:uid("k"),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),telefon:"",notiz:""},JSON.parse(JSON.stringify(kd)));
      Store.state.kunden.push(k);
      toast(`Kunde „${k.firma}" angelegt`);
    }
    this.offer.kundeId=k.id;
    Store.save(); this.fillCustomerSelect();
  },

  /* ---------- Tabs ---------- */
  setTab(t){
    this.tab=t;
    ["angebot","vertrag","rechnung"].forEach(x=>{
      document.getElementById("tab-"+x).classList.toggle("active",t===x);
      document.getElementById("form-"+x).style.display=t===x?"":"none";
      document.getElementById("sheet-"+x).style.display=t===x?"":"none";
    });
    this.renderAll();
  },

  /* ---------- Katalog, Bundles, Positionen ---------- */
  renderCatalog(){
    const kidx=Store.katIndex();
    document.getElementById("bundles").innerHTML=Store.state.bundles.map((b,i)=>`
      <button type="button" onclick="Editor.addBundle(${i})">
        <span class="bn"><b>${esc(b.name)}</b><span>${esc(b.sub)}</span></span>
        <span class="bp">${esc(b.price)}</span>
      </button>`).join("");
    document.getElementById("catalog").innerHTML=Store.state.katalog.map((g,gi)=>`
      <div class="cat-group">${esc(g.group)}</div>
      <div class="catalog">${g.items.map((k,i)=>
        `<button type="button" onclick="Editor.addFromCatalog(${gi},${i})"><b>${esc(k.t)}</b><em>${k.p>0?fmtEUR(k.p)+" / "+esc(k.e):"auf Anfrage"}</em></button>`
      ).join("")}</div>`).join("");
  },
  makePos(k,qty){
    const menge=qty||1;
    const rab=k.rule==="li"?liRabatt(menge):0;
    return {titel:k.t,beschr:k.d,menge,einheit:k.e,preis:k.p,rab,_rule:k.rule||""};
  },
  addFromCatalog(gi,i){
    const k=Store.state.katalog[gi].items[i];
    this.s.positionen.push(this.makePos(k,1));
    this.renderAll(); this.scheduleSave(); toast("Position hinzugefügt");
  },
  addBundle(i){
    const b=Store.state.bundles[i], kidx=Store.katIndex();
    b.items.forEach(([id,qty])=>{ const k=kidx[id]; if(k) this.s.positionen.push(this.makePos(k,qty)); });
    if(!this.s.meta.betreff){ this.s.meta.betreff=b.name; this.pushToInputs(); }
    this.renderAll(); this.scheduleSave(); toast(`Paket „${b.name}" übernommen`);
  },
  addPos(){
    this.s.positionen.push({titel:"",beschr:"",menge:1,einheit:"pauschal",preis:0,rab:0,_rule:""});
    this.renderAll(); this.scheduleSave();
  },
  delPos(i){ this.s.positionen.splice(i,1); this.renderAll(); this.scheduleSave(); },
  updPos(i,field,val){
    const p=this.s.positionen[i];
    if(field==="menge"||field==="preis"||field==="rab") p[field]=parseFloat(val)||0;
    else p[field]=val;
    if(field==="menge"&&p._rule==="li"){
      p.rab=liRabatt(p.menge);
      const rabEl=document.getElementById("pos-rab-"+i);
      if(rabEl) rabEl.value=p.rab;
    }
    this.renderPreview(); this.renderTotals(); this.scheduleSave();
  },

  renderPositions(){
    const host=document.getElementById("poslist");
    if(!this.s.positionen.length){
      host.innerHTML=`<div class="empty">Noch keine Positionen. Paket oder Einzelleistung aus dem Katalog wählen, oder frei anlegen.</div>`;
      return;
    }
    host.innerHTML=this.s.positionen.map((p,i)=>`
      <div class="pos">
        <div class="pos-head">
          <label><span>Leistung</span><input type="text" value="${esc(p.titel)}" oninput="Editor.updPos(${i},'titel',this.value)"></label>
          <label><span>Menge</span><input type="number" min="0" step="1" value="${p.menge}" oninput="Editor.updPos(${i},'menge',this.value)"></label>
          <label><span>Einheit</span><input type="text" value="${esc(p.einheit)}" oninput="Editor.updPos(${i},'einheit',this.value)"></label>
          <label><span>Einzelpreis €</span><input type="number" min="0" step="50" value="${p.preis}" oninput="Editor.updPos(${i},'preis',this.value)"></label>
          <label><span>Rabatt %</span><input type="number" id="pos-rab-${i}" min="0" max="100" step="1" value="${p.rab||0}" oninput="Editor.updPos(${i},'rab',this.value)"></label>
          <button type="button" class="del" title="Position entfernen" onclick="Editor.delPos(${i})">✕</button>
        </div>
        <label><span>Beschreibung (eine Zeile je Leistungsbestandteil)</span>
          <textarea rows="3" oninput="Editor.updPos(${i},'beschr',this.value)">${esc(p.beschr)}</textarea></label>
      </div>`).join("");
  },

  calc(){ return Store.calc(this.s); },
  renderTotals(){
    const c=this.calc();
    document.getElementById("totals").innerHTML=`
      <div class="trow"><span>Zwischensumme (netto, inkl. Positionsrabatte)</span><b>${fmtEUR(c.netto)}</b></div>
      ${c.rabatt>0?`<div class="trow"><span>Paketrabatt (${(this.s.rabatt||0).toLocaleString("de-DE")} %)</span><b class="neg">− ${fmtEUR(c.rabatt)}</b></div>`:""}
      <div class="trow"><span>Netto</span><b>${fmtEUR(c.nettoR)}</b></div>
      <div class="trow"><span>zzgl. ${c.vatPct} % MwSt.</span><b>${fmtEUR(c.mwst)}</b></div>
      <div class="trow grand"><span>Gesamt (brutto)</span><b>${fmtEUR(c.brutto)}</b></div>`;
  },

  /* ---------- Anschreiben ---------- */
  anredeZeile(){
    const k=this.s.kunde;
    return k.anrede==="Frau"?`Sehr geehrte Frau ${lastName(k.name)},`
         :k.anrede==="Herr"?`Sehr geehrter Herr ${lastName(k.name)},`
         :`Guten Tag ${k.name||""},`.replace(" ,",",");
  },
  genAnschreiben(){
    const m=this.s.meta;
    const anlass=m.anlass?` rund um ${m.anlass}`:"";
    this.s.anschreiben=
`${this.anredeZeile()}

vielen Dank für Ihr Interesse an einer Zusammenarbeit mit dem VersicherungsTech Magazin. Unsere Leserinnen und Leser sind IT- und Innovationsverantwortliche, Vorstände und Fachbereichsleitungen von Versicherungsunternehmen in der DACH-Region. Genau diese Zielgruppe erreichen Sie mit den nachfolgend zusammengestellten Maßnahmen${anlass}.

Das Angebot ist modular aufgebaut. Einzelne Positionen lassen sich jederzeit anpassen oder kombinieren. Erste Inhalte gehen in der Regel innerhalb von 10 Werktagen nach Beauftragung live. Gerne besprechen wir die Details in einem kurzen Abstimmungscall.`;
    this.pushToInputs(); this.renderAll(); this.scheduleSave();
  },
  applyTemplate(){
    const id=document.getElementById("anschreiben-tpl").value;
    const t=Store.activeTemplates().find(x=>x.id===id);
    if(!t){ toast("Keine Vorlage ausgewählt"); return; }
    this.s.anschreiben=this.anredeZeile()+"\n\n"+t.text;
    this.pushToInputs(); this.renderAll(); this.scheduleSave();
    toast(`Vorlage „${t.name}" eingesetzt`);
  },

  /* ---------- Nummernkreis ---------- */
  pullNumber(kind){
    const c=Store.state.settings.counters;
    const year=new Date().getFullYear();
    if(c.year!==year){ c.year=year; c.angebot=0; c.vertrag=0; c.rechnung=0; }
    c[kind]=(c[kind]||0)+1;
    let nr;
    if(kind==="angebot"){ nr=`A-${year}-${String(c[kind]).padStart(3,"0")}`; this.s.meta.nr=nr; }
    else if(kind==="vertrag"){ nr=`V-${year}-${String(c[kind]).padStart(3,"0")}`; this.s.vertrag.nr=nr; }
    else { nr=`VTM-${year}-${String(c[kind]).padStart(4,"0")}`; this.s.rechnung.nr=nr; }
    Store.state.settingsUpdatedAt=new Date().toISOString();
    Store.save();
    this.pushToInputs(); this.renderAll(); this.save(false);
    toast(`Nummer ${nr} reserviert`);
  },

  /* ---------- E-Mail-Text ---------- */
  mailText(){
    const s=this.s, c=this.calc();
    const tpl=Store.activeTemplates().find(t=>t.type==="email");
    const body=(tpl?tpl.text:`anbei erhalten Sie unser Angebot {NR} über {SUMME} netto, gültig bis {GUELTIG}.\n\nMit freundlichen Grüßen\n{BETREUER}`)
      .replace(/\{NR\}/g,s.meta.nr||"—")
      .replace(/\{BETREFF\}/g,s.meta.betreff||"Medienkooperation")
      .replace(/\{SUMME\}/g,fmtEUR(c.nettoR))
      .replace(/\{GUELTIG\}/g,fmtDate(s.meta.gueltig))
      .replace(/\{BETREUER\}/g,s.meta.betreuer||"");
    const full=this.anredeZeile()+"\n\n"+body;
    const subject=`Ihr Angebot ${s.meta.nr||""} · ${s.meta.betreff||"VersicherungsTech Magazin"}`.trim();
    const mailto=`mailto:${encodeURIComponent(s.kunde.email||"")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(full)}`;
    Modal.open(`<h3>E-Mail-Text für den Versand</h3>
      <div class="row single"><label><span>Betreff</span><input type="text" id="mt-subject" value="${esc(subject)}"></label></div>
      <div class="row single"><label><span>Text</span><textarea id="mt-body" rows="12">${esc(full)}</textarea></label></div>
      <div class="hint">Das Angebots-PDF (Button „Als PDF drucken") als Anhang beifügen.</div>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Schließen</button>
        <button class="btn" id="mt-copy">Text kopieren</button>
        <a class="btn blue" style="text-decoration:none" href="${mailto}">In E-Mail-Programm öffnen</a>
      </div>`, true);
    document.getElementById("mt-copy").onclick=()=>{
      const ta=document.getElementById("mt-body");
      ta.select();
      try{ navigator.clipboard.writeText(ta.value); toast("Text kopiert"); }
      catch(e){ document.execCommand("copy"); toast("Text kopiert"); }
    };
  },

  /* ---------- Gemeinsame Dokument-Bausteine ---------- */
  band(doctype,nr,datum){
    return `<div class="doc-band">
        <div class="wordmark"><b>VersicherungsTech<br>Magazin</b><i>Technologie verstehen. Versicherung gestalten.</i></div>
        <div class="doctype"><b>${doctype}</b><span>${esc(nr)||"—"} · ${fmtDate(datum)}</span></div>
      </div>
      <div class="signal-line" aria-hidden="true"></div>`;
  },
  posRowsHTML(){
    return this.s.positionen.map((p,i)=>`
      <tr>
        <td class="num" style="width:8mm;color:var(--text-muted)">${i+1}</td>
        <td><div class="pt-title">${esc(p.titel)||"—"}</div>${p.beschr?`<div class="pt-desc">${nl(p.beschr)}</div>`:""}${p.rab>0?`<div class="pt-rab">inkl. ${p.rab.toLocaleString("de-DE")} % Positionsrabatt</div>`:""}</td>
        <td class="num">${p.menge} ${esc(p.einheit&&p.einheit!=="pauschal"?p.einheit:"")}</td>
        <td class="num">${fmtEUR(p.preis)}</td>
        <td class="num"><b>${fmtEUR(lineNet(p))}</b></td>
      </tr>`).join("");
  },
  sumTableHTML(c){
    return `<table class="sumtable">
      <tr><td>Zwischensumme (netto)</td><td class="num">${fmtEUR(c.netto)}</td></tr>
      ${c.rabatt>0?`<tr><td>Paketrabatt (${(this.s.rabatt||0).toLocaleString("de-DE")} %)</td><td class="num" style="color:var(--text-secondary)">− ${fmtEUR(c.rabatt)}</td></tr>
      <tr><td><b>Netto nach Rabatt</b></td><td class="num"><b>${fmtEUR(c.nettoR)}</b></td></tr>`:""}
      <tr><td>zzgl. ${c.vatPct} % USt.</td><td class="num">${fmtEUR(c.mwst)}</td></tr>
      <tr class="grand"><td>Gesamtbetrag</td><td class="num">${fmtEUR(c.brutto)}</td></tr>
    </table>`;
  },
  footerHTML(withStnr){
    const F=this.FIRMA;
    return `<div class="doc-footer">
      <div>${esc(F.kurz)} · ${esc(F.strasse)}, ${esc(F.plzort)}<br>${esc(F.hrb)}${withStnr?` · St.-Nr. ${esc(F.stnr)}`:""} · Geschäftsführer: ${esc(F.gf)}</div>
      <div style="text-align:right">IBAN ${esc(F.iban)}<br>${esc(F.mail)} · ${esc(F.web)}</div>
    </div>`;
  },

  /* ---------- Rendering: Angebot ---------- */
  renderAngebot(){
    const s=this.s,k=s.kunde,m=s.meta,c=this.calc(),F=this.FIRMA;
    let sec=0;
    const H2=t=>`<h2><span class="h2i">${String(++sec).padStart(2,"0")} ·</span>${t}</h2>`;
    const kpiTiles=Store.state.settings.kpiZeile||[];
    const kpi=m.kpi?`
      <div class="eyebrow research" style="margin-top:4mm">VTM Reichweitendaten · eigene Erhebung</div>
      <div class="kpis">${kpiTiles.map(x=>`<div class="kpi"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")}</div>`:"";

    document.getElementById("sheet-angebot").innerHTML=`
      ${this.band("ANGEBOT",m.nr||"A-"+new Date().getFullYear()+"-XXX",m.datum)}

      <div class="eyebrow">Kooperationsangebot</div>
      <h1>${esc(m.betreff)||"Medienkooperation mit dem VersicherungsTech Magazin"}</h1>
      ${m.anlass?`<div class="sub">${esc(m.anlass)}</div>`:""}

      <div class="meta-grid">
        <div class="meta-box">
          <div class="mb-label">Auftraggeber</div>
          <div><b>${esc(k.firma)||"—"}</b><br>
          ${k.name?esc((k.anrede?k.anrede+" ":"")+k.name)+(k.funktion?", "+esc(k.funktion):"")+"<br>":""}
          ${k.strasse?esc(k.strasse)+"<br>":""}${esc(k.plzort)||""}
          ${k.email?`<br><span style="font-family:var(--font-mono);font-size:8pt">${esc(k.email)}</span>`:""}</div>
        </div>
        <div class="meta-box">
          <div class="mb-label">Anbieter</div>
          <div><b>${esc(F.kurz)}</b><br>${esc(F.strasse)}<br>${esc(F.plzort)}<br>
          Ihr Kontakt: ${esc(m.betreuer)}<br>
          <span style="font-family:var(--font-mono);font-size:8pt">${esc(F.mail)}</span></div>
        </div>
      </div>
      <div class="meta-line">
        <span>Angebotsnr.: <b>${esc(m.nr)||"—"}</b></span>
        <span>Datum: <b>${fmtDate(m.datum)}</b></span>
        <span>Gültig bis: <b>${fmtDate(m.gueltig)}</b></span>
      </div>

      ${s.anschreiben?H2("Persönliches Anschreiben")+`<p class="anschreiben" style="white-space:pre-line">${esc(s.anschreiben)}</p>`:""}

      ${m.kpi?H2("Warum VersicherungsTech Magazin")+kpi:""}

      ${H2("Leistungen &amp; Konditionen")}
      <table class="postable">
        <thead><tr><th>Pos.</th><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr></thead>
        <tbody>${this.posRowsHTML()||`<tr><td colspan="5" style="color:var(--text-secondary);text-align:center;padding:6mm">Noch keine Positionen erfasst.</td></tr>`}</tbody>
      </table>
      ${this.sumTableHTML(c)}
      <div class="taxnote">Alle Preise verstehen sich netto zzgl. gesetzlicher Umsatzsteuer.</div>

      ${H2("Konditionen &amp; nächste Schritte")}
      <p>Dieses Angebot ist gültig bis zum <b>${fmtDate(m.gueltig)}</b>. Das Zahlungsziel beträgt <b>${s.zahlungsziel||14} Tage netto</b> nach Rechnungsstellung. Erste Inhalte gehen in der Regel innerhalb von 10 Werktagen nach Beauftragung live. Werbliche Formate werden als solche gekennzeichnet; die redaktionelle Unabhängigkeit des VersicherungsTech Magazins bleibt unberührt.</p>
      <p>Zur Beauftragung genügt eine kurze Bestätigung per E-Mail. Anschließend stimmen wir Zeitplan und benötigte Materialien mit Ihnen ab.</p>

      <p style="margin-top:8mm">Mit freundlichen Grüßen</p>
      <p><b>${esc(m.betreuer)}</b><br><span style="color:var(--text-secondary)">VersicherungsTech Magazin</span></p>
      ${this.footerHTML(false)}`;
  },

  /* ---------- Rendering: Vertrag ---------- */
  renderVertrag(){
    const s=this.s,k=s.kunde,v=s.vertrag,c=this.calc(),F=this.FIRMA;
    const leistungen=s.positionen.length
      ?s.positionen.map(p=>`${p.menge>1?p.menge+"× ":""}${p.titel}`).join(", ")
      :"die im Angebot beschriebenen Leistungen";

    document.getElementById("sheet-vertrag").innerHTML=`
      ${this.band("VERTRAG",v.nr||"V-"+new Date().getFullYear()+"-XXX",v.datum)}

      <div class="eyebrow">Kooperationsvertrag</div>
      <h1>${esc(s.meta.betreff)||"Medienkooperation"}</h1>
      <div class="sub">Vertrags-Nr. ${esc(v.nr)||"—"} · ${fmtDate(v.datum)}</div>

      <div class="contract-parties">
        <div class="party"><b>${esc(k.firma)||"[Auftraggeberin]"}</b><br>${esc(k.strasse)||"[Straße Nr.]"} · ${esc(k.plzort)||"[PLZ Ort]"}<br><span style="color:var(--text-secondary)">— nachfolgend „Auftraggeberin" —</span></div>
        <div class="zw">und</div>
        <div class="party"><b>${esc(F.name)}</b><br>${esc(F.strasse)} · ${esc(F.plzort)}<br>vertreten durch den Geschäftsführer ${esc(F.gf)}<br><span style="color:var(--text-secondary)">— nachfolgend „Auftragnehmerin" —</span></div>
      </div>
      <p style="text-align:center;margin-bottom:6mm">wird folgender Vertrag geschlossen:</p>

      <div class="para"><b class="pnum">§ 1 Vertragsgegenstand</b>
        <p>(1) Gegenstand des Vertrags ist die Durchführung einer Medienkooperation gemäß Angebot <b>${esc(s.meta.nr)||"[Angebotsnr.]"}</b> vom ${fmtDate(s.meta.datum)}. (2) Das Angebot ist Bestandteil dieses Vertrags.</p></div>

      <div class="para"><b class="pnum">§ 2 Leistungen</b>
        <p>Die Auftragnehmerin erbringt die im Angebot beschriebenen Leistungen (${esc(leistungen)}). Werbliche Formate werden als solche gekennzeichnet; die redaktionelle Unabhängigkeit bleibt unberührt. Von der Auftraggeberin bereitgestellte Inhalte werden inhaltlich unverändert übernommen und ausschließlich gestalterisch an das Erscheinungsbild des VersicherungsTech Magazins angepasst. Die Veröffentlichung gekennzeichneter Inhalte erfolgt erst nach schriftlicher Freigabe durch die Auftraggeberin.</p></div>

      <div class="para"><b class="pnum">§ 3 Vergütung</b>
        <p>Die Vergütung beträgt <b>${fmtEUR(c.nettoR)}</b> zzgl. gesetzlicher Umsatzsteuer${c.rabatt>0?` (bereits berücksichtigt: Paketrabatt von ${(s.rabatt||0).toLocaleString("de-DE")} %)`:""}. Das Zahlungsziel beträgt ${s.zahlungsziel||14} Tage netto nach Rechnungsstellung.</p></div>

      <div class="para"><b class="pnum">§ 4 Laufzeit und Kündigung</b>
        <p>Der Vertrag beginnt am <b>${fmtDate(v.beginn)}</b> und läuft bis zum <b>${fmtDate(v.ende)}</b>. Er kann mit einer Frist von ${esc(v.kuendigung)||"drei Monaten zum Laufzeitende"} gekündigt werden. Das Recht zur außerordentlichen Kündigung bleibt unberührt.</p></div>

      <div class="para"><b class="pnum">§ 5 Vertraulichkeit</b>
        <p>Die Parteien behandeln vertrauliche Informationen der jeweils anderen Partei auch nach Vertragsende vertraulich.</p></div>

      ${v.zusatz?`<div class="para"><b class="pnum">§ 6 Ergänzende Regelungen</b><p style="white-space:pre-line">${esc(v.zusatz)}</p></div>`:""}

      <div class="para"><b class="pnum">§ ${v.zusatz?"7":"6"} Schlussbestimmungen</b>
        <p>Änderungen und Ergänzungen bedürfen der Textform. Gerichtsstand ist ${esc(v.gerichtsstand)||"Köln"}. Sollten einzelne Bestimmungen unwirksam sein, bleibt der Vertrag im Übrigen wirksam.</p></div>

      <div class="sig-grid">
        <div class="sig-box"><div class="sg-label">Ort, Datum · Unterschrift Auftraggeberin</div><div class="sg-name">${esc(k.firma)||"[Auftraggeberin]"}</div></div>
        <div class="sig-box"><div class="sg-label">Ort, Datum · Unterschrift Auftragnehmerin</div><div class="sg-name">${esc(F.kurz)} · ${esc(F.gf)}</div></div>
      </div>
      ${this.footerHTML(false)}`;
  },

  /* ---------- Rendering: Rechnung ---------- */
  renderRechnung(){
    const s=this.s,k=s.kunde,r=s.rechnung,c=this.calc(),F=this.FIRMA;
    const faellig=addDays(r.datum,s.zahlungsziel||14);
    const bezug=r.bezug||(s.meta.nr?`Angebot ${s.meta.nr}${s.vertrag.nr?` / Vertrag ${s.vertrag.nr}`:""}`:"");
    const zeitraum=(r.von||r.bis)?`${fmtDate(r.von)} bis ${fmtDate(r.bis)}`:"";

    document.getElementById("sheet-rechnung").innerHTML=`
      ${this.band("RECHNUNG",r.nr||"VTM-"+new Date().getFullYear()+"-XXXX",r.datum)}

      <div style="font-family:var(--font-mono);font-size:7pt;color:var(--text-secondary);margin-bottom:2mm">${esc(F.kurz)} · ${esc(F.strasse)} · ${esc(F.plzort)}</div>
      <div class="meta-grid">
        <div class="meta-box">
          <div class="mb-label">Rechnungsempfänger</div>
          <div><b>${esc(k.firma)||"—"}</b><br>
          ${k.name?esc((k.anrede?k.anrede+" ":"")+k.name)+"<br>":""}
          ${k.strasse?esc(k.strasse)+"<br>":""}${esc(k.plzort)||""}</div>
        </div>
        <div class="meta-box">
          <div class="mb-label">Rechnungsdaten</div>
          <div>Rechnungsnr.: <b>${esc(r.nr)||"—"}</b><br>
          Rechnungsdatum: <b>${fmtDate(r.datum)}</b><br>
          Zahlungsziel: <b>${fmtDate(faellig)}</b> (${s.zahlungsziel||14} Tage netto)
          ${zeitraum?`<br>Leistungszeitraum: <b>${zeitraum}</b>`:""}</div>
        </div>
      </div>

      ${bezug?`<p style="margin-bottom:4mm">Wir erlauben uns, die folgenden Leistungen gemäß ${esc(bezug)} in Rechnung zu stellen:</p>`
             :`<p style="margin-bottom:4mm">Wir erlauben uns, die folgenden Leistungen in Rechnung zu stellen:</p>`}

      <table class="postable">
        <thead><tr><th>Pos.</th><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr></thead>
        <tbody>${this.posRowsHTML()||`<tr><td colspan="5" style="color:var(--text-secondary);text-align:center;padding:6mm">Keine Positionen. Bitte im Reiter „Angebot" erfassen.</td></tr>`}</tbody>
      </table>
      ${this.sumTableHTML(c)}

      <div class="paybox">
        Bitte überweisen Sie den Rechnungsbetrag von <b>${fmtEUR(c.brutto)}</b> bis zum <b>${fmtDate(faellig)}</b> unter Angabe der Rechnungsnummer auf folgendes Konto:<br>
        <b>${esc(F.kurz)}</b> · IBAN <b>${esc(F.iban)}</b>
      </div>

      <p style="margin-top:6mm">Vielen Dank für die gute Zusammenarbeit.</p>
      <p><b>${esc(F.gf)}</b><br><span style="color:var(--text-secondary)">Geschäftsführer, ${esc(F.kurz)}</span></p>
      ${this.footerHTML(true)}`;
  },

  renderPreview(){ this.renderAngebot(); this.renderVertrag(); this.renderRechnung(); },
  renderAll(){ if(!this.s) return; this.renderPositions(); this.renderTotals(); this.renderPreview(); },

  /* ---------- Drucken ---------- */
  print(){
    document.body.classList.remove("print-angebot","print-vertrag","print-rechnung");
    document.body.classList.add("print-"+this.tab);
    window.print();
  },

  /* =========================================================
     Word-Export (.doc) · Word-kompatibles HTML
     ========================================================= */
  exportWord(){
    const body=this.tab==="angebot"?this.wordAngebot()
             :this.tab==="vertrag"?this.wordVertrag()
             :this.wordRechnung();
    const title=this.tab==="angebot"?"Angebot":this.tab==="vertrag"?"Vertrag":"Rechnung";
    const nr=this.tab==="angebot"?this.s.meta.nr:this.tab==="vertrag"?this.s.vertrag.nr:this.s.rechnung.nr;
    const firma=(this.s.kunde.firma||"Kunde").replace(/[^\wäöüÄÖÜß -]/g,"").replace(/\s+/g,"_");
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)} ${esc(nr||"")}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
  @page{size:A4;margin:2cm 2cm 2.4cm}
  body{font-family:Inter,Aptos,"Segoe UI",Arial,sans-serif;font-size:10pt;color:#121E39;line-height:1.5}
  table{border-collapse:collapse}
  p{margin:0 0 8pt 0}
</style></head><body>${body}</body></html>`;
    const blob=new Blob(["﻿"+html],{type:"application/msword;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`${title}_${nr||"Entwurf"}_${firma}.doc`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
    toast("Word-Datei heruntergeladen");
  },

  wBand(doctype,nr,datum){
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#121E39" style="background-color:#121E39"><tr>
      <td style="padding:14pt 16pt">
        <span style="color:#FFFFFF;font-size:15pt;font-weight:bold">VersicherungsTech Magazin</span><br>
        <span style="color:#DCE8FF;font-size:8pt;font-style:italic">Technologie verstehen. Versicherung gestalten.</span></td>
      <td align="right" style="padding:14pt 16pt">
        <span style="color:#FFFFFF;font-size:12pt;font-weight:bold;letter-spacing:3pt">${esc(doctype)}</span><br>
        <span style="color:#DCE8FF;font-size:8pt">${esc(nr)||"—"} · ${fmtDate(datum)}</span></td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" bgcolor="#123FA6" style="background-color:#123FA6;font-size:1pt;line-height:1pt">&nbsp;</td></tr></table>
    <p>&nbsp;</p>`;
  },
  wH2(idx,t){
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12pt"><tr>
      <td style="border-bottom:1pt solid #C7CED9;padding-bottom:3pt;font-size:9pt;font-weight:bold;letter-spacing:2pt;color:#121E39"><span style="color:#6E7888;font-weight:normal">${idx} · </span>${esc(t).toUpperCase()}</td></tr></table><p style="margin:4pt 0 0 0">&nbsp;</p>`;
  },
  wPosTable(){
    const rows=this.s.positionen.map((p,i)=>`<tr>
      <td valign="top" align="right" style="border-bottom:.75pt solid #DCE1E9;padding:5pt 6pt;color:#6E7888">${i+1}</td>
      <td valign="top" style="border-bottom:.75pt solid #DCE1E9;padding:5pt 6pt">
        <b>${esc(p.titel)||"—"}</b>${p.beschr?`<br><span style="font-size:8.5pt;color:#3F4958">${nl(p.beschr)}</span>`:""}${p.rab>0?`<br><span style="font-size:8pt;color:#6E7888">inkl. ${p.rab.toLocaleString("de-DE")} % Positionsrabatt</span>`:""}</td>
      <td valign="top" align="right" style="border-bottom:.75pt solid #DCE1E9;padding:5pt 6pt;white-space:nowrap">${p.menge} ${esc(p.einheit&&p.einheit!=="pauschal"?p.einheit:"")}</td>
      <td valign="top" align="right" style="border-bottom:.75pt solid #DCE1E9;padding:5pt 6pt;white-space:nowrap">${fmtEUR(p.preis)}</td>
      <td valign="top" align="right" style="border-bottom:.75pt solid #DCE1E9;padding:5pt 6pt;white-space:nowrap"><b>${fmtEUR(lineNet(p))}</b></td>
    </tr>`).join("");
    const th='style="border-bottom:1.5pt solid #121E39;padding:4pt 6pt;font-size:8pt;letter-spacing:1pt;color:#3F4958;text-transform:uppercase"';
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td ${th}>Pos.</td><td ${th}>Leistung</td><td align="right" ${th}>Menge</td><td align="right" ${th}>Einzelpreis</td><td align="right" ${th}>Gesamt</td></tr>
      ${rows||`<tr><td colspan="5" style="padding:10pt;color:#3F4958" align="center">Keine Positionen erfasst.</td></tr>`}
    </table>`;
  },
  wSumTable(c){
    const td='style="padding:3pt 6pt"';
    return `<table align="right" cellpadding="0" cellspacing="0" border="0" width="60%" style="margin-top:6pt">
      <tr><td ${td}>Zwischensumme (netto)</td><td align="right" ${td}>${fmtEUR(c.netto)}</td></tr>
      ${c.rabatt>0?`<tr><td ${td}>Paketrabatt (${(this.s.rabatt||0).toLocaleString("de-DE")} %)</td><td align="right" ${td} style="color:#3F4958">− ${fmtEUR(c.rabatt)}</td></tr>
      <tr><td ${td}><b>Netto nach Rabatt</b></td><td align="right" ${td}><b>${fmtEUR(c.nettoR)}</b></td></tr>`:""}
      <tr><td ${td}>zzgl. ${c.vatPct} % USt.</td><td align="right" ${td}>${fmtEUR(c.mwst)}</td></tr>
      <tr><td style="padding:5pt 6pt;border-top:1.5pt solid #121E39"><b>Gesamtbetrag</b></td><td align="right" style="padding:5pt 6pt;border-top:1.5pt solid #121E39"><b>${fmtEUR(c.brutto)}</b></td></tr>
    </table><br clear="all">`;
  },
  wFooter(withStnr){
    const F=this.FIRMA;
    return `<p>&nbsp;</p><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-top:.75pt solid #DCE1E9;padding-top:5pt;font-size:7.5pt;color:#3F4958">
        ${esc(F.kurz)} · ${esc(F.strasse)}, ${esc(F.plzort)} · ${esc(F.hrb)}${withStnr?` · St.-Nr. ${esc(F.stnr)}`:""} · Geschäftsführer: ${esc(F.gf)}<br>
        IBAN ${esc(F.iban)} · ${esc(F.mail)} · ${esc(F.web)}</td></tr></table>`;
  },

  wordAngebot(){
    const s=this.s,k=s.kunde,m=s.meta,c=this.calc(),F=this.FIRMA;
    let sec=0; const H2=t=>this.wH2(String(++sec).padStart(2,"0"),t);
    const kpiTiles=Store.state.settings.kpiZeile||[];
    const kpi=m.kpi?`<p style="font-size:8pt;letter-spacing:1.5pt;color:#9B7017;font-weight:bold">▪ VTM REICHWEITENDATEN · EIGENE ERHEBUNG</p>
      <table width="100%" cellpadding="0" cellspacing="4" border="0"><tr>
      ${kpiTiles.map(x=>
        `<td width="25%" align="center" bgcolor="#121E39" style="background-color:#121E39;padding:8pt 4pt">
          <span style="color:#FFFFFF;font-size:12pt;font-weight:bold">${esc(x[0])}</span><br>
          <span style="color:#DCE8FF;font-size:7pt">${esc(x[1])}</span></td>`).join("")}
    </tr></table>`:"";
    return `${this.wBand("ANGEBOT",m.nr,m.datum)}
      <p style="font-size:14pt;font-weight:bold;margin-bottom:2pt">${esc(m.betreff)||"Medienkooperation mit dem VersicherungsTech Magazin"}</p>
      ${m.anlass?`<p style="color:#3F4958">${esc(m.anlass)}</p>`:""}
      <table width="100%" cellpadding="0" cellspacing="6" border="0"><tr>
        <td width="50%" valign="top" bgcolor="#F2F6FF" style="background-color:#F2F6FF;border-left:2pt solid #123FA6;padding:8pt 10pt">
          <span style="font-size:7.5pt;letter-spacing:1.5pt;color:#123FA6;font-weight:bold">AUFTRAGGEBER</span><br>
          <b>${esc(k.firma)||"—"}</b><br>${k.name?esc((k.anrede?k.anrede+" ":"")+k.name)+(k.funktion?", "+esc(k.funktion):"")+"<br>":""}${k.strasse?esc(k.strasse)+"<br>":""}${esc(k.plzort)||""}${k.email?"<br>"+esc(k.email):""}</td>
        <td width="50%" valign="top" bgcolor="#F2F6FF" style="background-color:#F2F6FF;border-left:2pt solid #123FA6;padding:8pt 10pt">
          <span style="font-size:7.5pt;letter-spacing:1.5pt;color:#123FA6;font-weight:bold">ANBIETER</span><br>
          <b>${esc(F.kurz)}</b><br>${esc(F.strasse)}<br>${esc(F.plzort)}<br>Ihr Kontakt: ${esc(m.betreuer)}<br>${esc(F.mail)}</td>
      </tr></table>
      <p style="font-size:9pt;color:#3F4958">Angebotsnr.: <b>${esc(m.nr)||"—"}</b> &nbsp;·&nbsp; Datum: <b>${fmtDate(m.datum)}</b> &nbsp;·&nbsp; Gültig bis: <b>${fmtDate(m.gueltig)}</b></p>
      ${s.anschreiben?H2("Persönliches Anschreiben")+`<p style="font-family:'Source Serif 4','Palatino Linotype',Georgia,serif;font-size:10.5pt">${nl(s.anschreiben)}</p>`:""}
      ${m.kpi?H2("Warum VersicherungsTech Magazin")+kpi:""}
      ${H2("Leistungen & Konditionen")}
      ${this.wPosTable()}
      ${this.wSumTable(c)}
      <p align="right" style="font-size:8pt;color:#3F4958;font-style:italic">Alle Preise verstehen sich netto zzgl. gesetzlicher Umsatzsteuer.</p>
      ${H2("Konditionen & nächste Schritte")}
      <p>Dieses Angebot ist gültig bis zum <b>${fmtDate(m.gueltig)}</b>. Das Zahlungsziel beträgt <b>${s.zahlungsziel||14} Tage netto</b> nach Rechnungsstellung. Erste Inhalte gehen in der Regel innerhalb von 10 Werktagen nach Beauftragung live. Werbliche Formate werden als solche gekennzeichnet; die redaktionelle Unabhängigkeit des VersicherungsTech Magazins bleibt unberührt.</p>
      <p>Zur Beauftragung genügt eine kurze Bestätigung per E-Mail. Anschließend stimmen wir Zeitplan und benötigte Materialien mit Ihnen ab.</p>
      <p>&nbsp;</p><p>Mit freundlichen Grüßen</p>
      <p><b>${esc(m.betreuer)}</b><br><span style="color:#3F4958">VersicherungsTech Magazin</span></p>
      ${this.wFooter(false)}`;
  },

  wordVertrag(){
    const s=this.s,k=s.kunde,v=s.vertrag,c=this.calc(),F=this.FIRMA;
    const leistungen=s.positionen.length?s.positionen.map(p=>`${p.menge>1?p.menge+"× ":""}${p.titel}`).join(", "):"die im Angebot beschriebenen Leistungen";
    const par=(n,t,body)=>`<p style="margin-top:10pt"><b style="color:#123FA6;font-size:9.5pt">§ ${n} ${t}</b><br>${body}</p>`;
    return `${this.wBand("VERTRAG",v.nr,v.datum)}
      <p style="font-size:14pt;font-weight:bold">${esc(s.meta.betreff)||"Medienkooperation"}</p>
      <p style="color:#3F4958">Kooperationsvertrag · Vertrags-Nr. ${esc(v.nr)||"—"} · ${fmtDate(v.datum)}</p>
      <p align="center" style="margin-top:12pt"><b>${esc(k.firma)||"[Auftraggeberin]"}</b><br>${esc(k.strasse)||"[Straße Nr.]"} · ${esc(k.plzort)||"[PLZ Ort]"}<br><span style="color:#3F4958">— nachfolgend „Auftraggeberin" —</span></p>
      <p align="center" style="letter-spacing:2pt;color:#3F4958;font-size:8.5pt">UND</p>
      <p align="center"><b>${esc(F.name)}</b><br>${esc(F.strasse)} · ${esc(F.plzort)}<br>vertreten durch den Geschäftsführer ${esc(F.gf)}<br><span style="color:#3F4958">— nachfolgend „Auftragnehmerin" —</span></p>
      <p align="center" style="margin:10pt 0">wird folgender Vertrag geschlossen:</p>
      ${par(1,"Vertragsgegenstand",`(1) Gegenstand des Vertrags ist die Durchführung einer Medienkooperation gemäß Angebot <b>${esc(s.meta.nr)||"[Angebotsnr.]"}</b> vom ${fmtDate(s.meta.datum)}. (2) Das Angebot ist Bestandteil dieses Vertrags.`)}
      ${par(2,"Leistungen",`Die Auftragnehmerin erbringt die im Angebot beschriebenen Leistungen (${esc(leistungen)}). Werbliche Formate werden als solche gekennzeichnet; die redaktionelle Unabhängigkeit bleibt unberührt. Von der Auftraggeberin bereitgestellte Inhalte werden inhaltlich unverändert übernommen und ausschließlich gestalterisch an das Erscheinungsbild des VersicherungsTech Magazins angepasst. Die Veröffentlichung gekennzeichneter Inhalte erfolgt erst nach schriftlicher Freigabe durch die Auftraggeberin.`)}
      ${par(3,"Vergütung",`Die Vergütung beträgt <b>${fmtEUR(c.nettoR)}</b> zzgl. gesetzlicher Umsatzsteuer${c.rabatt>0?` (bereits berücksichtigt: Paketrabatt von ${(s.rabatt||0).toLocaleString("de-DE")} %)`:""}. Das Zahlungsziel beträgt ${s.zahlungsziel||14} Tage netto nach Rechnungsstellung.`)}
      ${par(4,"Laufzeit und Kündigung",`Der Vertrag beginnt am <b>${fmtDate(v.beginn)}</b> und läuft bis zum <b>${fmtDate(v.ende)}</b>. Er kann mit einer Frist von ${esc(v.kuendigung)||"drei Monaten zum Laufzeitende"} gekündigt werden. Das Recht zur außerordentlichen Kündigung bleibt unberührt.`)}
      ${par(5,"Vertraulichkeit",`Die Parteien behandeln vertrauliche Informationen der jeweils anderen Partei auch nach Vertragsende vertraulich.`)}
      ${v.zusatz?par(6,"Ergänzende Regelungen",nl(v.zusatz)):""}
      ${par(v.zusatz?7:6,"Schlussbestimmungen",`Änderungen und Ergänzungen bedürfen der Textform. Gerichtsstand ist ${esc(v.gerichtsstand)||"Köln"}. Sollten einzelne Bestimmungen unwirksam sein, bleibt der Vertrag im Übrigen wirksam.`)}
      <p>&nbsp;</p><p>&nbsp;</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="46%" style="border-top:.75pt solid #121E39;padding-top:4pt;font-size:7.5pt;color:#3F4958">ORT, DATUM · UNTERSCHRIFT AUFTRAGGEBERIN<br><span style="font-size:9.5pt;color:#121E39"><b>${esc(k.firma)||"[Auftraggeberin]"}</b></span></td>
        <td width="8%">&nbsp;</td>
        <td width="46%" style="border-top:.75pt solid #121E39;padding-top:4pt;font-size:7.5pt;color:#3F4958">ORT, DATUM · UNTERSCHRIFT AUFTRAGNEHMERIN<br><span style="font-size:9.5pt;color:#121E39"><b>${esc(F.kurz)} · ${esc(F.gf)}</b></span></td>
      </tr></table>
      ${this.wFooter(false)}`;
  },

  wordRechnung(){
    const s=this.s,k=s.kunde,r=s.rechnung,c=this.calc(),F=this.FIRMA;
    const faellig=addDays(r.datum,s.zahlungsziel||14);
    const bezug=r.bezug||(s.meta.nr?`Angebot ${s.meta.nr}${s.vertrag.nr?` / Vertrag ${s.vertrag.nr}`:""}`:"");
    const zeitraum=(r.von||r.bis)?`${fmtDate(r.von)} bis ${fmtDate(r.bis)}`:"";
    return `${this.wBand("RECHNUNG",r.nr,r.datum)}
      <p style="font-size:7.5pt;color:#3F4958">${esc(F.kurz)} · ${esc(F.strasse)} · ${esc(F.plzort)}</p>
      <table width="100%" cellpadding="0" cellspacing="6" border="0"><tr>
        <td width="50%" valign="top" bgcolor="#F2F6FF" style="background-color:#F2F6FF;border-left:2pt solid #123FA6;padding:8pt 10pt">
          <span style="font-size:7.5pt;letter-spacing:1.5pt;color:#123FA6;font-weight:bold">RECHNUNGSEMPFÄNGER</span><br>
          <b>${esc(k.firma)||"—"}</b><br>${k.name?esc((k.anrede?k.anrede+" ":"")+k.name)+"<br>":""}${k.strasse?esc(k.strasse)+"<br>":""}${esc(k.plzort)||""}</td>
        <td width="50%" valign="top" bgcolor="#F2F6FF" style="background-color:#F2F6FF;border-left:2pt solid #123FA6;padding:8pt 10pt">
          <span style="font-size:7.5pt;letter-spacing:1.5pt;color:#123FA6;font-weight:bold">RECHNUNGSDATEN</span><br>
          Rechnungsnr.: <b>${esc(r.nr)||"—"}</b><br>Rechnungsdatum: <b>${fmtDate(r.datum)}</b><br>Zahlungsziel: <b>${fmtDate(faellig)}</b> (${s.zahlungsziel||14} Tage netto)${zeitraum?`<br>Leistungszeitraum: <b>${zeitraum}</b>`:""}</td>
      </tr></table>
      <p>Wir erlauben uns, die folgenden Leistungen${bezug?` gemäß ${esc(bezug)}`:""} in Rechnung zu stellen:</p>
      ${this.wPosTable()}
      ${this.wSumTable(c)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#F2F6FF" style="background-color:#F2F6FF;border-left:2pt solid #123FA6;padding:8pt 10pt">
          Bitte überweisen Sie den Rechnungsbetrag von <b>${fmtEUR(c.brutto)}</b> bis zum <b>${fmtDate(faellig)}</b> unter Angabe der Rechnungsnummer auf folgendes Konto:<br>
          <b>${esc(F.kurz)}</b> · IBAN <b>${esc(F.iban)}</b></td></tr></table>
      <p style="margin-top:10pt">Vielen Dank für die gute Zusammenarbeit.</p>
      <p><b>${esc(F.gf)}</b><br><span style="color:#3F4958">Geschäftsführer, ${esc(F.kurz)}</span></p>
      ${this.wFooter(true)}`;
  }
};

/* ---------- App-Start ---------- */
const App = {
  async init(){
    Store.load();
    Editor.bindInputs();
    Auth.loginUI();
    Sync.init();
    if(await Auth.tryRestore()) this.start();
  },
  start(){
    document.getElementById("login-screen").style.display="none";
    document.getElementById("app").classList.add("active");
    document.getElementById("sb-user-name").textContent=Auth.user.name;
    document.getElementById("sb-user-role").textContent=Auth.isAdmin()?"Administration":"Vertrieb";
    if(!location.hash) location.hash="#/dashboard";
    Router.route();
  }
};

App.init();
