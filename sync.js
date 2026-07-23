/* =========================================================
   VTM Angebotsdesk · Team-Synchronisation (Supabase-Backend)

   Der komplette Datenbestand wird als eine Zeile (id='main')
   in der Tabelle desk_state gehalten (PostgREST-API). Schreiben
   erfolgt mit optimistischer Sperre über die Spalte rev:
   PATCH ...&rev=eq.<gesehen> — liefert 0 Zeilen bei Konflikt,
   dann wird neu gelesen, gemerged und erneut versucht.

   Merge-Regeln:
   - offers/kunden/users/templates: pro Datensatz (id) gewinnt
     der neuere updatedAt-Stempel; Löschungen sind Tombstones
     ({deleted:true}) und synchronisieren dadurch sauber.
   - katalog/bundles: als Ganzes, neuerer Stempel gewinnt.
   - settings: neuerer Stempel gewinnt – außer Nummernkreise,
     die pro Zähler auf das Maximum gemerged werden (keine
     doppelt vergebenen Nummern durch parallele Geräte).

   Konfiguration (URL + anon key) liegt bewusst NICHT im
   synchronisierten Zustand, sondern separat im localStorage
   und wird über Team-Datei-Export/-Import mitgegeben.
   ========================================================= */

const Sync = {
  CFG_KEY: "vtmdesk-sync",
  lastSync: null, lastError: null,
  _timer: null, _busy: false, _pending: false, _interval: null,

  /* ---------- Konfiguration ---------- */
  config(){ try{ return JSON.parse(localStorage.getItem(this.CFG_KEY))||null; }catch(e){ return null; } },
  saveConfig(c){ localStorage.setItem(this.CFG_KEY, JSON.stringify(c)); },
  clearConfig(){ localStorage.removeItem(this.CFG_KEY); },
  enabled(){ const c=this.config(); return !!(c && c.enabled && c.url && c.key); },

  headers(extra){
    const c=this.config();
    return Object.assign({ "apikey":c.key, "Authorization":"Bearer "+c.key, "Content-Type":"application/json" }, extra||{});
  },
  /* URL säubern: Leerzeichen, Slashes am Ende, versehentlich
     mitkopierte /rest/v1-Pfade */
  normalizeUrl(url){
    return (url||"").trim().replace(/\/rest\/v1.*$/,"").replace(/\/+$/,"");
  },
  base(url){ return this.normalizeUrl(url||this.config().url)+"/rest/v1/desk_state"; },

  /* ---------- REST ---------- */
  async fetchRow(){
    const r=await fetch(this.base()+"?id=eq.main&select=rev,data",{headers:this.headers()});
    if(!r.ok) throw new Error("Server nicht erreichbar (HTTP "+r.status+")");
    const rows=await r.json();
    return rows[0]||null;
  },
  async createRow(state){
    const r=await fetch(this.base(),{method:"POST",
      headers:this.headers({"Prefer":"return=representation"}),
      body:JSON.stringify({id:"main",rev:1,data:state,updated_at:new Date().toISOString()})});
    return r.ok;
  },
  async patchRow(seenRev,state){
    const r=await fetch(this.base()+"?id=eq.main&rev=eq."+seenRev,{method:"PATCH",
      headers:this.headers({"Prefer":"return=representation"}),
      body:JSON.stringify({rev:seenRev+1,data:state,updated_at:new Date().toISOString()})});
    if(!r.ok) throw new Error("Schreiben fehlgeschlagen (HTTP "+r.status+")");
    const rows=await r.json();
    return rows.length>0;
  },
  /* Verbindungstest, auch vom Login-Screen genutzt */
  async test(url,key){
    url=this.normalizeUrl(url);
    if(/supabase\.com/i.test(url))
      throw new Error("Das ist die Adresse des Supabase-Dashboards. Benötigt wird die Project URL (Settings → API bzw. Data API) – sie sieht so aus: https://abcdefgh.supabase.co");
    if(!/^https?:\/\//i.test(url))
      throw new Error("Die Server-URL muss mit https:// beginnen, z. B. https://abcdefgh.supabase.co");
    if(/^ey[A-Za-z0-9_-]{10}/.test(url))
      throw new Error("Im URL-Feld steht offenbar der Schlüssel – bitte die Felder tauschen.");
    let r;
    try{
      r=await fetch(this.base(url)+"?id=eq.main&select=rev",
        {headers:{"apikey":key,"Authorization":"Bearer "+key}});
    }catch(e){ throw new Error("Server nicht erreichbar – bitte die Project URL prüfen (https://…supabase.co)."); }
    if(r.status===404) throw new Error("Verbindung steht, aber die Tabelle desk_state fehlt – bitte das SQL-Setup im Supabase SQL Editor ausführen und die Warnung dort mit „Run query“ bestätigen.");
    if(r.status===401||r.status===403) throw new Error("Zugangsschlüssel wird nicht akzeptiert – bitte den anon public key verwenden (Settings → API Keys).");
    if(!r.ok) throw new Error("Verbindung fehlgeschlagen (HTTP "+r.status+").");
    return true;
  },

  /* ---------- Merge ---------- */
  ts(x){ return x||""; },
  mergeById(localArr, remoteArr, stampField){
    const f=stampField||"updatedAt";
    const map=new Map();
    (remoteArr||[]).forEach(x=>{ if(x&&x.id) map.set(x.id,x); });
    (localArr||[]).forEach(x=>{
      if(!x||!x.id) return;
      const r=map.get(x.id);
      if(!r || this.ts(x[f])>this.ts(r[f])) map.set(x.id,x);
    });
    return [...map.values()];
  },
  mergeCounters(l,r){
    if(!l) return r; if(!r) return l;
    if((l.year||0)>(r.year||0)) return Object.assign({},l);
    if((r.year||0)>(l.year||0)) return Object.assign({},r);
    return { year:l.year||r.year,
      angebot:Math.max(l.angebot||0,r.angebot||0),
      vertrag:Math.max(l.vertrag||0,r.vertrag||0),
      rechnung:Math.max(l.rechnung||0,r.rechnung||0) };
  },
  mergeState(local, remote){
    if(!remote) return JSON.parse(JSON.stringify(local));
    const m=JSON.parse(JSON.stringify(remote));
    m.offers   = this.mergeById(local.offers,   remote.offers);
    m.kunden   = this.mergeById(local.kunden,   remote.kunden);
    m.users    = this.mergeById(local.users,    remote.users);
    m.templates= this.mergeById(local.templates,remote.templates);
    if(this.ts(local.katalogUpdatedAt)>this.ts(remote.katalogUpdatedAt)){
      m.katalog=JSON.parse(JSON.stringify(local.katalog)); m.katalogUpdatedAt=local.katalogUpdatedAt;
    }
    if(this.ts(local.bundlesUpdatedAt)>this.ts(remote.bundlesUpdatedAt)){
      m.bundles=JSON.parse(JSON.stringify(local.bundles)); m.bundlesUpdatedAt=local.bundlesUpdatedAt;
    }
    const localSettingsNewer=this.ts(local.settingsUpdatedAt)>this.ts(remote.settingsUpdatedAt);
    if(localSettingsNewer){
      m.settings=JSON.parse(JSON.stringify(local.settings)); m.settingsUpdatedAt=local.settingsUpdatedAt;
    }
    m.settings.counters=this.mergeCounters(
      (local.settings||{}).counters, (remote.settings||{}).counters);
    return m;
  },

  /* ---------- Sync-Zyklus ---------- */
  onLocalChange(){
    if(!this.enabled()) return;
    clearTimeout(this._timer);
    this._timer=setTimeout(()=>this.syncOnce(),1500);
  },
  async syncOnce(){
    if(!this.enabled()) return false;
    if(this._busy){ this._pending=true; return false; }
    this._busy=true;
    try{
      for(let attempt=0; attempt<4; attempt++){
        const row=await this.fetchRow();
        if(!row){
          if(await this.createRow(Store.state)){ this.ok(); return true; }
          continue;
        }
        const merged=this.mergeState(Store.state,row.data);
        const localStr=JSON.stringify(Store.state);
        const mergedStr=JSON.stringify(merged);
        const remoteStr=JSON.stringify(row.data);
        if(mergedStr!==remoteStr){
          if(await this.patchRow(row.rev,merged)){
            if(mergedStr!==localStr) this.applyState(merged);
            this.ok(); return true;
          }
          /* rev-Konflikt: jemand war schneller → neu lesen und erneut mergen */
          continue;
        }
        if(mergedStr!==localStr) this.applyState(merged);
        this.ok(); return true;
      }
      throw new Error("Zu viele parallele Änderungen – wird automatisch erneut versucht.");
    }catch(e){
      this.lastError=e.message; this.updateUI(); return false;
    }finally{
      this._busy=false;
      if(this._pending){ this._pending=false; this.onLocalChange(); }
    }
  },
  ok(){ this.lastSync=new Date(); this.lastError=null; this.updateUI(); },

  /* Gemergten Stand übernehmen, ohne die laufende Bearbeitung zu stören */
  applyState(merged){
    const editorVisible=!document.getElementById("view-editor").hidden && Editor.offer;
    const edId=editorVisible?Editor.offer.id:null;
    const edUpd=editorVisible?Editor.offer.updatedAt:null;

    Store.state=merged;
    Store.persist();

    if(Auth.user){
      const fresh=Store.state.users.find(u=>u.id===Auth.user.id);
      if(fresh) Auth.user=fresh;
    }
    if(edId){
      const cur=Store.offer(edId);
      if(!cur){
        toast("Dieses Angebot wurde von einem Teammitglied gelöscht.");
        location.hash="#/angebote";
      } else {
        Editor.offer=cur; Editor.s=cur.doc;
        if(cur.updatedAt!==edUpd){ Editor.pushToInputs(); Editor.renderAll(); Editor.updateBar(); }
      }
    }
    /* Sichtbare Liste aktualisieren – aber nie mitten ins Tippen rendern */
    const typing=document.activeElement && ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName);
    const modalOpen=document.getElementById("modal-bg").classList.contains("open");
    if(!typing && !modalOpen){
      const cur=[...document.querySelectorAll(".view")].find(v=>!v.hidden);
      if(cur && cur.id!=="view-editor" && Auth.user) Views.render(cur.id.replace("view-",""));
    }
    Views.updateNavCounts();
  },

  /* ---------- Start & Status ---------- */
  init(){
    if(this.enabled()){ this.startLoop(); this.syncOnce(); }
    this.updateUI();
  },
  startLoop(){
    if(this._interval) return;
    this._interval=setInterval(()=>{ if(!this._busy) this.syncOnce(); },45000);
    window.addEventListener("focus",()=>{ if(!this._busy) this.syncOnce(); });
  },
  updateUI(){
    const el=document.getElementById("sync-status");
    if(el){
      if(!this.enabled()){ el.textContent="Team-Sync: nicht verbunden"; el.dataset.state="off"; }
      else if(this.lastError){ el.textContent="⚠ Sync-Fehler"; el.title=this.lastError; el.dataset.state="error"; }
      else { el.textContent="● Team-Sync aktiv"+(this.lastSync?" · "+this.lastSync.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}):""); el.title=""; el.dataset.state="on"; }
    }
    const st=document.getElementById("st-sync-status");
    if(st){
      const safe=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      st.innerHTML=this.lastError
        ? `<span style="color:var(--c-danger)"><b>Fehler:</b> ${safe(this.lastError)}</span>`
        : !this.enabled()
          ? "Nicht verbunden."
          : `<span style="color:var(--c-success)">Verbunden.</span> Letzte Synchronisation: ${this.lastSync?this.lastSync.toLocaleTimeString("de-DE"):"—"}`;
    }
  }
};

/* Setup-SQL, wird in den Einstellungen zum Kopieren angezeigt */
const SYNC_SETUP_SQL = `create table if not exists public.desk_state (
  id text primary key,
  rev bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.desk_state enable row level security;
drop policy if exists "team access" on public.desk_state;
create policy "team access" on public.desk_state
  for all to anon using (true) with check (true);`;
