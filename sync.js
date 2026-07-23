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
  rest(table,url){ return this.normalizeUrl(url||this.config().url)+"/rest/v1/"+table; },
  base(url){ return this.rest("desk_state",url); },

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

/* SQL-Script für den Einladungs-Mailversand (pg_net → Resend).
   Wird in den Einstellungen mit den echten Werten befüllt und
   zum Kopieren angezeigt – der API-Key landet nur in Supabase. */
function buildMailSetupSQL(key, sender, domains){
  const q=s=>String(s).replace(/'/g,"''");
  return `-- ADAM · E-Mail-Einladungen: einmaliges Setup (Supabase SQL Editor)
create extension if not exists pg_net;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  otp text not null,
  invited_by text,
  app_url text,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
drop policy if exists "invite insert" on public.invites;
create policy "invite insert" on public.invites
  for insert to anon with check (true);
-- kein select für anon: Einmalpasswörter sind über die API nicht auslesbar

create table if not exists public.mail_secrets (k text primary key, v text not null);
alter table public.mail_secrets enable row level security;
-- keine Policies: der Key ist über die API nicht erreichbar
insert into public.mail_secrets (k,v) values
  ('resend_key','${q(key)}'),
  ('mail_from','${q(sender)}'),
  ('allowed_domains','${q(domains)}')
on conflict (k) do update set v = excluded.v;

create or replace function public.send_invite_mail() returns trigger
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  rkey text; sender text; domains text; dom text; ok boolean := false; html text;
begin
  select v into rkey    from public.mail_secrets where k = 'resend_key';
  select v into sender  from public.mail_secrets where k = 'mail_from';
  select v into domains from public.mail_secrets where k = 'allowed_domains';
  foreach dom in array string_to_array(coalesce(domains, ''), ',') loop
    if lower(new.email) like '%@' || lower(trim(dom)) then ok := true; end if;
  end loop;
  if not ok or rkey is null then return new; end if;

  html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#121e39">'
    || '<div style="background:#121e39;padding:22px 28px;color:#ffffff">'
    ||   '<div style="font-size:17px;font-weight:bold">VersicherungsTech Magazin</div>'
    ||   '<div style="font-size:11px;letter-spacing:2px;color:#dce8ff">ADAM &middot; ANGEBOTSDESK</div>'
    || '</div>'
    || '<div style="height:3px;background:#123fa6"></div>'
    || '<div style="padding:26px 28px;background:#ffffff;border:1px solid #dce1e9;border-top:none">'
    ||   '<p style="margin:0 0 12px">Hallo ' || coalesce(new.name, '') || ',</p>'
    ||   '<p style="margin:0 0 16px;line-height:1.6">' || coalesce(new.invited_by, 'das VTM-Team')
    ||     ' hat Dich zur Zusammenarbeit in <b>ADAM</b> eingeladen &ndash; dem Angebotsdesk des VersicherungsTech Magazins f&uuml;r Angebote, Vertr&auml;ge und Rechnungen.</p>'
    ||   '<table style="width:100%;background:#f2f6ff;border-left:3px solid #123fa6;font-size:14px" cellpadding="8" cellspacing="0">'
    ||     '<tr><td style="color:#3f4958;width:140px">Benutzername</td><td><b>' || new.email || '</b></td></tr>'
    ||     '<tr><td style="color:#3f4958">Einmalpasswort</td><td><b style="font-family:Consolas,monospace">' || new.otp || '</b></td></tr>'
    ||   '</table>'
    ||   '<p style="margin:20px 0"><a href="' || new.app_url || '" style="background:#123fa6;color:#ffffff;text-decoration:none;padding:11px 22px;font-weight:bold;border-radius:5px;display:inline-block">Jetzt bei ADAM anmelden</a></p>'
    ||   '<p style="margin:0;font-size:12.5px;color:#3f4958;line-height:1.6">Beim ersten Login legst Du direkt Dein pers&ouml;nliches Passwort fest &ndash; das Einmalpasswort wird damit ung&uuml;ltig. Bei Fragen wende Dich an ' || coalesce(new.invited_by, 'die Administration') || '.</p>'
    || '</div></div>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || rkey, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from', sender,
      'to', jsonb_build_array(new.email),
      'subject', 'Deine Einladung zu ADAM – dem VTM Angebotsdesk',
      'html', html)
  );
  return new;
end
$fn$;

drop trigger if exists trg_invite_mail on public.invites;
create trigger trg_invite_mail
  after insert on public.invites
  for each row execute function public.send_invite_mail();`;
}
