/* =========================================================
   VTM Angebotsdesk · Kontaktimport (Excel/CSV)

   Liest .xlsx ohne externe Bibliothek: Eine Excel-Datei ist ein
   ZIP-Archiv mit XML-Dateien. Das Zentralverzeichnis wird direkt
   gelesen, die Einträge über DecompressionStream("deflate-raw")
   entpackt und mit DOMParser ausgewertet. .csv/.tsv werden direkt
   geparst (Trennzeichen wird erkannt).

   Die Spalten werden über Synonymlisten automatisch den
   Kundenfeldern zugeordnet; die Zuordnung bleibt im Dialog
   überprüf- und änderbar, bevor importiert wird.
   ========================================================= */

const ContactImport = {

  /* ---------- Feldkatalog & Erkennung ---------- */
  FIELDS: [
    {k:"",        label:"— nicht importieren —"},
    {k:"firma",   label:"Firma"},
    {k:"anrede",  label:"Anrede"},
    {k:"vorname", label:"Vorname"},
    {k:"nachname",label:"Nachname"},
    {k:"name",    label:"Ansprechpartner/in (voller Name)"},
    {k:"funktion",label:"Funktion"},
    {k:"email",   label:"E-Mail"},
    {k:"telefon", label:"Telefon"},
    {k:"strasse", label:"Straße, Nr."},
    {k:"plz",     label:"PLZ"},
    {k:"ort",     label:"Ort"},
    {k:"plzort",  label:"PLZ und Ort (kombiniert)"},
    {k:"notiz",   label:"Notiz"}
  ],

  HEADERS: {
    firma:   ["firma","firmenname","unternehmen","unternehmensname","company","companyname","organisation","organization","account","accountname","kunde","kundenname","arbeitgeber","gesellschaft"],
    anrede:  ["anrede","salutation","geschlecht","gender"],
    vorname: ["vorname","firstname","givenname","first"],
    nachname:["nachname","lastname","surname","familienname","familyname","last"],
    name:    ["name","ansprechpartner","ansprechpartnerin","kontakt","kontaktperson","contact","contactname","fullname","vollstaendigername"],
    funktion:["funktion","position","rolle","role","jobtitle","title","berufsbezeichnung","stelle","abteilung","department"],
    email:   ["email","emailadresse","mail","mailadresse","emailaddress","epost"],
    telefon: ["telefon","telefonnummer","tel","phone","phonenumber","mobil","mobile","handy","rufnummer"],
    strasse: ["strasse","strassenr","strassehausnummer","street","streetaddress","adresse","address","anschrift","adresszeile"],
    plz:     ["plz","postleitzahl","zip","zipcode","postalcode","postcode"],
    ort:     ["ort","stadt","city","wohnort","sitz"],
    plzort:  ["plzort","plzundort","postleitzahlort","zipcity"],
    notiz:   ["notiz","notizen","bemerkung","bemerkungen","kommentar","kommentare","note","notes","comment","comments","info"]
  },

  norm(s){
    return (s===undefined||s===null?"":String(s)).toLowerCase()
      .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
      .replace(/[^a-z0-9]/g,"");
  },

  detectField(header){
    const h=this.norm(header);
    if(!h) return "";
    for(const k of Object.keys(this.HEADERS)) if(this.HEADERS[k].includes(h)) return k;
    /* Teiltreffer – spezifische Felder vor dem generischen „name" */
    const order=["email","telefon","plzort","plz","ort","strasse","funktion","vorname","nachname","anrede","firma","notiz","name"];
    for(const k of order) if(this.HEADERS[k].some(w=>h.includes(w))) return k;
    return "";
  },

  /* Inhaltsbasierte Erkennung, wenn die Überschrift nichts hergibt */
  detectByContent(values){
    const vals=values.filter(v=>String(v||"").trim()).slice(0,25);
    if(!vals.length) return "";
    const share=re=>vals.filter(v=>re.test(String(v))).length/vals.length;
    if(share(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i)>0.6) return "email";
    if(share(/^[+()\d][\d\s\-/()]{5,}$/)>0.6) return "telefon";
    if(share(/^\d{4,5}\s+\S/)>0.6) return "plzort";
    if(share(/^\d{4,5}$/)>0.6) return "plz";
    if(share(/^(frau|herr|mr|mrs|ms)\.?$/i)>0.6) return "anrede";
    return "";
  },

  normAnrede(v){
    const s=this.norm(v);
    if(!s) return "";
    if(["frau","mrs","ms","female","weiblich","w"].includes(s)) return "Frau";
    if(["herr","mr","male","maennlich","m"].includes(s)) return "Herr";
    return "";
  },

  /* ---------- ZIP (nur was für .xlsx nötig ist) ---------- */
  async openZip(buf){
    const u8=new Uint8Array(buf), dv=new DataView(buf);
    let eocd=-1;
    for(let i=u8.length-22;i>=0 && i>u8.length-22-65558;i--){
      if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
    }
    if(eocd<0) throw new Error("Die Datei ist keine gültige Excel-Datei (.xlsx).");
    const count=dv.getUint16(eocd+10,true);
    let off=dv.getUint32(eocd+16,true);
    const files={};
    const dec=new TextDecoder();
    for(let i=0;i<count;i++){
      if(dv.getUint32(off,true)!==0x02014b50) break;
      const method=dv.getUint16(off+10,true);
      const compSize=dv.getUint32(off+20,true);
      const nameLen=dv.getUint16(off+28,true);
      const extraLen=dv.getUint16(off+30,true);
      const cmtLen=dv.getUint16(off+32,true);
      const localOff=dv.getUint32(off+42,true);
      files[dec.decode(u8.subarray(off+46,off+46+nameLen))]={method,compSize,localOff};
      off+=46+nameLen+extraLen+cmtLen;
    }
    return {u8,dv,files};
  },

  async zipText(zip,name){
    const f=zip.files[name];
    if(!f) return null;
    const nameLen=zip.dv.getUint16(f.localOff+26,true);
    const extraLen=zip.dv.getUint16(f.localOff+28,true);
    const start=f.localOff+30+nameLen+extraLen;
    const data=zip.u8.subarray(start,start+f.compSize);
    if(f.method===0) return new TextDecoder().decode(data);
    if(f.method!==8) throw new Error("Die Excel-Datei nutzt eine nicht unterstützte Komprimierung.");
    if(typeof DecompressionStream!=="function")
      throw new Error("Dieser Browser kann .xlsx nicht entpacken. Bitte die Liste in Excel als CSV speichern und erneut importieren.");
    const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  },

  /* ---------- XLSX ---------- */
  colIndex(ref){
    const m=/^([A-Z]+)/.exec(ref||"");
    if(!m) return 0;
    let n=0;
    for(const ch of m[1]) n=n*26+(ch.charCodeAt(0)-64);
    return n-1;
  },

  async parseXlsx(buf){
    const zip=await this.openZip(buf);
    const xml=new DOMParser();

    /* Erstes Arbeitsblatt über workbook.xml + Beziehungen finden */
    let sheetPath=null;
    const wb=await this.zipText(zip,"xl/workbook.xml");
    if(wb){
      const doc=xml.parseFromString(wb,"application/xml");
      const sheet=doc.getElementsByTagName("sheet")[0];
      const rid=sheet && (sheet.getAttribute("r:id")||sheet.getAttribute("id"));
      const rels=await this.zipText(zip,"xl/_rels/workbook.xml.rels");
      if(rid && rels){
        const rdoc=xml.parseFromString(rels,"application/xml");
        for(const rel of rdoc.getElementsByTagName("Relationship")){
          if(rel.getAttribute("Id")===rid){
            let t=rel.getAttribute("Target")||"";
            t=t.replace(/^\/?xl\//,"").replace(/^\//,"");
            sheetPath="xl/"+t;
          }
        }
      }
    }
    if(!sheetPath || !zip.files[sheetPath]){
      sheetPath=Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d*\.xml$/.test(n)).sort()[0];
    }
    if(!sheetPath) throw new Error("In der Datei wurde kein Tabellenblatt gefunden.");

    /* Zeichenketten-Tabelle */
    const shared=[];
    const ss=await this.zipText(zip,"xl/sharedStrings.xml");
    if(ss){
      const doc=xml.parseFromString(ss,"application/xml");
      for(const si of doc.getElementsByTagName("si")){
        let t="";
        for(const node of si.getElementsByTagName("t")) t+=node.textContent;
        shared.push(t);
      }
    }

    const doc=xml.parseFromString(await this.zipText(zip,sheetPath),"application/xml");
    const rows=[];
    for(const row of doc.getElementsByTagName("row")){
      const cells=[];
      for(const c of row.getElementsByTagName("c")){
        const i=this.colIndex(c.getAttribute("r"));
        const type=c.getAttribute("t");
        let val="";
        if(type==="inlineStr"){
          for(const node of c.getElementsByTagName("t")) val+=node.textContent;
        } else {
          const v=c.getElementsByTagName("v")[0];
          val=v?v.textContent:"";
          if(type==="s") val=shared[parseInt(val,10)]??"";
        }
        cells[i]=String(val).trim();
      }
      for(let i=0;i<cells.length;i++) if(cells[i]===undefined) cells[i]="";
      rows.push(cells);
    }
    return rows;
  },

  /* ---------- CSV ---------- */
  parseCsv(text){
    text=text.replace(/^﻿/,"");
    const head=text.split(/\r?\n/,1)[0]||"";
    const counts={";":(head.match(/;/g)||[]).length,",":(head.match(/,/g)||[]).length,"\t":(head.match(/\t/g)||[]).length};
    const sep=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const rows=[]; let row=[], field="", quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else quoted=false; }
        else field+=ch;
      } else if(ch==='"'){ quoted=true; }
      else if(ch===sep){ row.push(field.trim()); field=""; }
      else if(ch==="\n"){ row.push(field.trim()); rows.push(row); row=[]; field=""; }
      else if(ch!=="\r"){ field+=ch; }
    }
    if(field||row.length){ row.push(field.trim()); rows.push(row); }
    return rows.filter(r=>r.some(c=>c));
  },

  /* ---------- Ablauf ---------- */
  async handleFile(input){
    const file=input.files && input.files[0];
    input.value="";
    if(!file) return;
    if(/\.xls$/i.test(file.name)){
      toast("Altes Excel-Format (.xls) – bitte als .xlsx oder CSV speichern");
      return;
    }
    try{
      const rows=/\.(csv|tsv|txt)$/i.test(file.name)
        ? this.parseCsv(await file.text())
        : await this.parseXlsx(await file.arrayBuffer());
      const clean=rows.filter(r=>r.some(c=>String(c||"").trim()));
      if(!clean.length){ toast("Die Datei enthält keine Daten"); return; }
      this.openMapping(file.name, clean);
    }catch(e){
      console.error(e);
      Modal.open(`<h3>Import nicht möglich</h3>
        <div class="notice danger">${esc(e.message||"Die Datei konnte nicht gelesen werden.")}</div>
        <p style="font-size:12.5px;color:var(--text-secondary)">Unterstützt werden <b>.xlsx</b> (Excel 2007 und neuer) sowie <b>.csv</b>. In Excel: „Datei → Speichern unter" und eines dieser Formate wählen.</p>
        <div class="modal-actions"><button class="btn" onclick="Modal.close()">Schließen</button></div>`);
    }
  },

  /* Kopfzeile erkennen und Spalten zuordnen */
  analyze(rows){
    const first=rows[0]||[];
    const width=Math.max(...rows.map(r=>r.length));
    let score=0;
    for(const h of first) if(this.detectField(h)) score++;
    const looksLikeData=first.some(c=>/@/.test(String(c||"")));
    const hasHeader = score>=2 || (score>=1 && !looksLikeData);

    const header=hasHeader?first:Array.from({length:width},(_,i)=>"Spalte "+(i+1));
    const data=hasHeader?rows.slice(1):rows;
    const map=[];
    for(let i=0;i<width;i++){
      let f=hasHeader?this.detectField(first[i]):"";
      if(!f) f=this.detectByContent(data.map(r=>r[i]));
      /* jedes Zielfeld nur einmal automatisch vergeben */
      if(f && map.includes(f)) f="";
      map[i]=f;
    }
    return {header,data,map,hasHeader,width};
  },

  openMapping(filename, rows){
    const a=this.analyze(rows);
    this._pending={filename,...a};
    const example=i=>{
      const v=(a.data.find(r=>String(r[i]||"").trim())||[])[i]||"";
      return String(v).slice(0,40);
    };
    const options=sel=>this.FIELDS.map(f=>`<option value="${f.k}"${f.k===sel?" selected":""}>${esc(f.label)}</option>`).join("");

    Modal.open(`<h3>Kontakte importieren</h3>
      <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px">
        <b>${esc(filename)}</b> · ${a.data.length} Zeile${a.data.length===1?"":"n"} erkannt${a.hasHeader?" (erste Zeile als Überschrift)":" (ohne Überschriftenzeile)"}.
        Die Zuordnung wurde automatisch vorgeschlagen – bitte kurz prüfen.</p>
      <div class="table-scroll" style="max-height:42vh">
        <table class="data"><thead><tr><th>Spalte</th><th>Beispiel</th><th>Wird übernommen als</th></tr></thead>
        <tbody>${a.header.map((h,i)=>`<tr>
          <td><b>${esc(h||"Spalte "+(i+1))}</b></td>
          <td style="color:var(--text-muted)">${esc(example(i))||"—"}</td>
          <td><select data-col="${i}" style="min-width:220px">${options(a.map[i])}</select></td>
        </tr>`).join("")}</tbody></table>
      </div>
      <div id="imp-warn"></div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" id="imp-update" checked> Bereits vorhandene Kunden ergänzen (Abgleich über E-Mail bzw. Firma); sonst überspringen</label>
      <div class="modal-actions">
        <button class="btn" onclick="Modal.close()">Abbrechen</button>
        <button class="btn blue" id="imp-run">${a.data.length} Zeile${a.data.length===1?"":"n"} importieren</button>
      </div>`, true);

    const warn=()=>{
      const sel=[...document.querySelectorAll("#modal select[data-col]")].map(s=>s.value);
      const ok=sel.includes("firma")||sel.includes("name")||sel.includes("nachname");
      document.getElementById("imp-warn").innerHTML = ok?"":
        `<div class="notice warn" style="margin-top:12px"><b>Hinweis:</b> Es ist weder eine Spalte für die Firma noch für den Namen zugeordnet – so lassen sich keine Kunden anlegen.</div>`;
      document.getElementById("imp-run").disabled=!ok;
    };
    document.querySelectorAll("#modal select[data-col]").forEach(s=>s.addEventListener("change",warn));
    warn();
    document.getElementById("imp-run").onclick=()=>this.run();
  },

  run(){
    const p=this._pending; if(!p) return;
    const map=[];
    document.querySelectorAll("#modal select[data-col]").forEach(s=>map[parseInt(s.dataset.col,10)]=s.value);
    const update=document.getElementById("imp-update").checked;

    const get=(row,field)=>{
      const i=map.indexOf(field);
      return i<0?"":String(row[i]||"").trim();
    };
    let neu=0, aktualisiert=0, uebersprungen=0, ohneDaten=0;
    const now=new Date().toISOString();

    p.data.forEach(row=>{
      const vorname=get(row,"vorname"), nachname=get(row,"nachname");
      const name=[vorname,nachname].filter(Boolean).join(" ") || get(row,"name");
      const email=get(row,"email");
      let firma=get(row,"firma") || name;
      if(!firma && !email){ ohneDaten++; return; }
      if(!firma) firma=email;

      const plzort=get(row,"plzort") || [get(row,"plz"),get(row,"ort")].filter(Boolean).join(" ");
      const daten={
        firma, name,
        anrede:this.normAnrede(get(row,"anrede")),
        funktion:get(row,"funktion"),
        email, telefon:get(row,"telefon"),
        strasse:get(row,"strasse"), plzort,
        notiz:get(row,"notiz")
      };

      const vorhanden=Store.activeKunden().find(k=>
        (email && k.email && k.email.toLowerCase()===email.toLowerCase()) ||
        (!email && k.firma && k.firma.toLowerCase()===firma.toLowerCase()));

      if(vorhanden){
        if(!update){ uebersprungen++; return; }
        /* nur befüllte Werte übernehmen – nichts überschreiben mit Leere */
        let geaendert=false;
        for(const [k,v] of Object.entries(daten)){
          if(v && vorhanden[k]!==v){ vorhanden[k]=v; geaendert=true; }
        }
        if(geaendert){ vorhanden.updatedAt=now; aktualisiert++; }
        else uebersprungen++;
      } else {
        Store.state.kunden.push(Object.assign(
          {id:uid("k"),createdAt:now,updatedAt:now,telefon:"",notiz:""}, daten));
        neu++;
      }
    });

    Store.save();
    this._pending=null;
    Modal.open(`<h3>Import abgeschlossen</h3>
      <div class="notice success"><b>${neu}</b> neue Kunden angelegt${aktualisiert?`, <b>${aktualisiert}</b> ergänzt`:""}.</div>
      ${(uebersprungen||ohneDaten)?`<p style="font-size:12.5px;color:var(--text-secondary)">
        ${uebersprungen?`${uebersprungen} Zeile${uebersprungen===1?"":"n"} übersprungen (bereits vorhanden bzw. keine neuen Angaben).`:""}
        ${ohneDaten?`${ohneDaten} Zeile${ohneDaten===1?"":"n"} ohne Firma und ohne E-Mail ignoriert.`:""}</p>`:""}
      <p style="font-size:12.5px;color:var(--text-secondary);margin-top:8px">${Sync.enabled()?"Die Kunden werden automatisch mit dem Team synchronisiert.":"Hinweis: Ohne Team-Server bleiben die Kunden nur auf diesem Gerät."}</p>
      <div class="modal-actions"><button class="btn blue" onclick="Modal.close()">Fertig</button></div>`);
    Views.renderCustomersTable();
    Editor.fillCustomerSelect();
  }
};
