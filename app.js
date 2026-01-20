/** =========================
 *  Utilidades
 *  ========================= */
const $ = (q, el=document)=>el.querySelector(q);
const $$ = (q, el=document)=>Array.from(el.querySelectorAll(q));
const fmtEur = (n)=> new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n||0));
const fmtDate = (iso)=> iso ? new Date(iso).toLocaleDateString('es-ES') : '';
const fmtDateTime = (iso)=> iso ? new Date(iso).toLocaleString('es-ES') : '';
const nowISO = ()=> new Date().toISOString();
const uid = ()=> (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2));
const daysBetween = (a,b)=> Math.round((new Date(b)-new Date(a))/(1000*60*60*24));
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const isIOS = ()=> /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.style.display="none", 2400);
}
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[m]);
}
function isoDateOnly(d=new Date()){
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function fromDateOnly(s){
  return s ? new Date(s + "T00:00:00").toISOString() : "";
}
function mapsLinkForAddress(address){
  const q = encodeURIComponent(address||"");
  if(!q) return "";
  if(isIOS()) return `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
function attachHelpToForm(formEl, helpEl){
  if(!formEl || !helpEl) return;
  const handler = (e)=>{
    const t = e.target;
    if(!t || !(t.matches("input,select,textarea"))) return;
    const msg = t.dataset.help || "";
    helpEl.textContent = msg ? msg : "Toca un campo para ver una ayuda rápida.";
  };
  formEl.addEventListener("focusin", handler);
  formEl.addEventListener("click", handler);
}

/** =========================
 *  Trimestre
 *  ========================= */
function getQuarter(date=new Date()){
  const m = date.getMonth();
  return Math.floor(m/3) + 1;
}
function quarterKey(date=new Date()){
  const q = getQuarter(date);
  const yy = String(date.getFullYear()).slice(-2);
  return `${q}T${yy}`;
}
function quarterStartEnd(date=new Date()){
  const year = date.getFullYear();
  const q = getQuarter(date);
  const startMonth = (q-1)*3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth+3, 1);
  return {start, end, q, year};
}
function daysRemainingInQuarter(date=new Date()){
  const {end} = quarterStartEnd(date);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.ceil((end - today) / (1000*60*60*24));
  return Math.max(0, diff);
}

/** =========================
 *  Pedido helpers
 *  ========================= */
function lineTotal(l){
  const qty = Number(l.cantidad||0);
  const pu = Number(l.precioUnit||0);
  const disc = Number(l.descuentoPct||0);
  const t = qty * pu * (1 - disc/100);
  return Math.round(t*1000)/1000;
}
function recomputePedido(p){
  (p.lineas||[]).forEach(l=>l.total=lineTotal(l));
  p.total = Math.round((p.lineas||[]).reduce((a,l)=>a+Number(l.total||0),0)*1000)/1000;
  return p;
}

/** =========================
 *  IndexedDB
 *  ========================= */
const DB_NAME = "farmacias_ventas_offline_db";
const DB_VER = 5; // <-- subimos versión por nuevo store "catalogo"
let db;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;

      if(!d.objectStoreNames.contains("clientes")){
        const s = d.createObjectStore("clientes", {keyPath:"id"});
        s.createIndex("nombre","nombre",{unique:false});
        s.createIndex("zona","zona",{unique:false});
      }
      if(!d.objectStoreNames.contains("productos")){
        const s = d.createObjectStore("productos", {keyPath:"id"});
        s.createIndex("nombre","nombre",{unique:false});
      }
      if(!d.objectStoreNames.contains("pedidos")){
        const s = d.createObjectStore("pedidos", {keyPath:"id"});
        s.createIndex("clienteId","clienteId",{unique:false});
        s.createIndex("fecha","fecha",{unique:false});
        s.createIndex("estado","estado",{unique:false});
      }
      if(!d.objectStoreNames.contains("visitas")){
        const s = d.createObjectStore("visitas", {keyPath:"id"});
        s.createIndex("clienteId","clienteId",{unique:false});
        s.createIndex("fecha","fecha",{unique:false});
        s.createIndex("tipo","tipo",{unique:false});
      }
      if(!d.objectStoreNames.contains("meta")){
        d.createObjectStore("meta", {keyPath:"key"});
      }
      if(!d.objectStoreNames.contains("settings")){
        d.createObjectStore("settings", {keyPath:"key"});
      }
      if(!d.objectStoreNames.contains("backups")){
        const s = d.createObjectStore("backups", {keyPath:"id"});
        s.createIndex("createdAt","createdAt",{unique:false});
      }
      if(!d.objectStoreNames.contains("rutas")){
        const s = d.createObjectStore("rutas", {keyPath:"id"});
        s.createIndex("date","date",{unique:false});
        s.createIndex("zona","zona",{unique:false});
        s.createIndex("status","status",{unique:false});
      }

      // NUEVO: catálogo (farmacias Galicia importadas)
      // keyPath = "catalogId" (estable por import)
      if(!d.objectStoreNames.contains("catalogo")){
        const s = d.createObjectStore("catalogo", {keyPath:"catalogId"});
        s.createIndex("nombre","nombre",{unique:false});
        s.createIndex("provincia","provincia",{unique:false});
        s.createIndex("municipio","municipio",{unique:false});
      }
    };
    req.onsuccess = ()=>{ db=req.result; resolve(db); };
    req.onerror = ()=>reject(req.error);
  });
}
function tx(store, mode="readonly"){
  return db.transaction(store, mode).objectStore(store);
}
function dbPut(store, obj){
  return new Promise((resolve,reject)=>{
    const r = tx(store,"readwrite").put(obj);
    r.onsuccess=()=>resolve(obj);
    r.onerror=()=>reject(r.error);
  });
}
function dbDel(store, id){
  return new Promise((resolve,reject)=>{
    const r = tx(store,"readwrite").delete(id);
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}
function dbGet(store, id){
  return new Promise((resolve,reject)=>{
    const r = tx(store,"readonly").get(id);
    r.onsuccess=()=>resolve(r.result||null);
    r.onerror=()=>reject(r.error);
  });
}
function dbAll(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store,"readonly").getAll();
    r.onsuccess=()=>resolve(r.result||[]);
    r.onerror=()=>reject(r.error);
  });
}
function dbClear(store){
  return new Promise((resolve,reject)=>{
    const r = tx(store,"readwrite").clear();
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}

/** =========================
 *  Settings
 *  ========================= */
const DEFAULT_SETTINGS = {
  autoBackupEnabled: true,
  autoBackupEveryDays: 7,
  keepBackups: 10,
  routeDefaultStops: 8,
  routeOnlyDue: true,
  quarterlyTargets: {}
};

async function loadSettings(){
  const out = {...DEFAULT_SETTINGS};
  for(const k of Object.keys(DEFAULT_SETTINGS)){
    const v = await dbGet("settings", k);
    if(v && v.value !== undefined) out[k] = v.value;
  }
  if(!out.quarterlyTargets || typeof out.quarterlyTargets !== "object"){
    out.quarterlyTargets = {};
  }
  return out;
}
async function saveSetting(key, value){
  await dbPut("settings", {key, value});
}

/** =========================
 *  Seed mínimo
 *  ========================= */
async function ensureSeed(){
  const meta = await dbGet("meta","seeded_v3");
  if(meta?.value) return;

  // Seed pequeño solo para que la app no esté vacía
  const f1 = {id:uid(), nombre:"Farmacia Plaza", apodo:"Plaza", zona:"Pontevedra Centro", direccion:"C/ Michelena 10, Pontevedra", telefono:"", email:"", notas:"", estado:"activo", etiquetas:["demo"], frecuenciaObjetivoDias:21, creadoEn:nowISO()};
  await dbPut("clientes", f1);

  await dbPut("meta",{key:"seeded_v3", value:true});
}

/** =========================
 *  KPIs + scoring + predicción
 *  ========================= */
function calcKpis(clientes, productos, pedidos){
  const pedidosOK = pedidos.filter(p=>["entregado","confirmado"].includes(p.estado));
  const totalVentas = pedidosOK.reduce((a,p)=>a+Number(p.total||0),0);
  const nPedidos = pedidosOK.length;
  const ticketMedio = nPedidos ? totalVentas/nPedidos : 0;

  const porCliente = new Map();
  for(const p of pedidosOK){
    if(!porCliente.has(p.clienteId)) porCliente.set(p.clienteId, []);
    porCliente.get(p.clienteId).push(p);
  }

  const statsCliente = [];
  for(const c of clientes){
    const arr = (porCliente.get(c.id)||[]).sort((a,b)=> new Date(a.fecha)-new Date(b.fecha));
    const fechas = arr.map(x=>x.fecha);

    let media = null;
    if(fechas.length>=2){
      const deltas=[];
      for(let i=1;i<fechas.length;i++) deltas.push(daysBetween(fechas[i-1], fechas[i]));
      media = deltas.reduce((a,d)=>a+d,0)/deltas.length;
    }

    const ultimo = fechas.length ? fechas[fechas.length-1] : null;
    const diasDesdeUltimo = ultimo ? daysBetween(ultimo, nowISO()) : 999;

    const objetivo = Number(c.frecuenciaObjetivoDias||0) || (media ? Math.round(media) : 21);
    const predNext = ultimo ? (()=>{ const d=new Date(ultimo); d.setDate(d.getDate()+objetivo); return d.toISOString(); })() : "";

    const total = arr.reduce((a,p)=>a+Number(p.total||0),0);

    statsCliente.push({
      cliente: c, total, pedidos: arr.length,
      diasDesdeUltimo, objetivo, mediaEntrePedidos: media,
      ultimoPedido: ultimo, predNext
    });
  }

  statsCliente.sort((a,b)=>b.total-a.total);
  return { totalVentas, nPedidos, ticketMedio, statsCliente };
}

function scoreClienteForVisit(stat){
  const c = stat.cliente;
  const ratio = stat.objetivo ? (stat.diasDesdeUltimo / stat.objetivo) : 0;
  const ratioScore = clamp(ratio, 0, 3) * 60;
  const ventasScore = clamp(Math.log10((stat.total||0) + 1), 0, 5) * 10;
  const estadoAdj = c.estado==="activo" ? 12 : (c.estado==="potencial" ? 2 : -12);
  const firstOrderBoost = (stat.pedidos===0 ? 15 : 0);
  return Math.round(ratioScore + ventasScore + estadoAdj + firstOrderBoost);
}

/** =========================
 *  Catálogo import: KML/JSON
 *  ========================= */
function normText(s){ return String(s||"").trim(); }

// Parse KML (muy simple) -> farmacias[] (solo placemarks)
function parseKmlToCatalog(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  // placemarks
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const rows = [];

  for(const pm of placemarks){
    const name = normText(pm.getElementsByTagName("name")[0]?.textContent || "");
    const desc = normText(pm.getElementsByTagName("description")[0]?.textContent || "");

    // coordinates "lon,lat,alt"
    const coordsTxt = normText(pm.getElementsByTagName("coordinates")[0]?.textContent || "");
    let lon=null, lat=null;
    if(coordsTxt){
      const parts = coordsTxt.split(",").map(x=>x.trim());
      lon = Number(parts[0]); lat = Number(parts[1]);
      if(Number.isNaN(lon)) lon=null;
      if(Number.isNaN(lat)) lat=null;
    }

    // La descripción del KML puede venir en HTML. Intentamos sacar una “dirección” razonable.
    // Si no encontramos nada, guardamos la descripción completa.
    const addressGuess = desc
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Para evitar meter hospitales/centros, aplicamos filtro heurístico:
    // Si en el nombre no aparece "FARMACIA" y la descripción tampoco, lo saltamos.
    const upper = (name + " " + addressGuess).toUpperCase();
    if(!upper.includes("FARMACIA")) continue;

    // catalogId estable: name + coords (si hay) + address
    const catalogId = btoa(unescape(encodeURIComponent(`${name}|${lon||""}|${lat||""}|${addressGuess}`))).slice(0,40);

    rows.push({
      catalogId,
      nombre: name || "Farmacia",
      direccion: addressGuess,
      lat, lon,
      provincia: "", municipio: "",
      source: "KML import",
      importedAt: nowISO()
    });
  }

  // dedupe por catalogId
  const map = new Map();
  for(const r of rows) map.set(r.catalogId, r);
  return Array.from(map.values());
}

function parseJsonToCatalog(jsonText){
  const data = JSON.parse(jsonText);
  // Aceptamos:
  // - array directo: [{nombre,direccion,lat,lon,...}]
  // - wrapper: {farmacias:[...]}
  const arr = Array.isArray(data) ? data : (data.farmacias || []);
  return arr.map((x)=>{
    const nombre = normText(x.nombre || x.name || "Farmacia");
    const direccion = normText(x.direccion || x.address || "");
    const lat = x.lat!==undefined ? Number(x.lat) : null;
    const lon = x.lon!==undefined ? Number(x.lon) : null;
    const provincia = normText(x.provincia||"");
    const municipio = normText(x.municipio||"");
    const catalogId = x.catalogId || btoa(unescape(encodeURIComponent(`${nombre}|${direccion}|${lat||""}|${lon||""}`))).slice(0,40);
    return {catalogId, nombre, direccion, lat, lon, provincia, municipio, source: "JSON import", importedAt: nowISO()};
  });
}

/** =========================
 *  Estimación próximo pedido (media últimos 10 pedidos, min 3 pedidos)
 *  ========================= */
function estimateNextOrderISOForCliente(clienteId, pedidosAll){
  const arr = pedidosAll
    .filter(p=>p.clienteId===clienteId)
    .filter(p=>["confirmado","entregado"].includes(p.estado))
    .slice()
    .sort((a,b)=> new Date(a.fecha)-new Date(b.fecha));

  if(arr.length < 3) return null;

  // últimos 10
  const last = arr.slice(-10);
  const fechas = last.map(x=>x.fecha).filter(Boolean);

  if(fechas.length < 3) return null;

  const deltas = [];
  for(let i=1;i<fechas.length;i++){
    deltas.push(daysBetween(fechas[i-1], fechas[i]));
  }
  if(deltas.length < 2) return null;

  const avg = deltas.reduce((a,d)=>a+d,0)/deltas.length;
  const lastDate = new Date(fechas[fechas.length-1]);
  lastDate.setDate(lastDate.getDate() + Math.round(avg));
  return lastDate.toISOString();
}

/** =========================
 *  PWA
 *  ========================= */
async function setupPWA(){
  const hint = $("#installHint");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  hint.textContent = isStandalone ? "Modo app · Offline" : "Instalable · Offline";

  if("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./sw.js"); }
    catch(e){ console.warn("SW no registrado", e); }
  }
}

/** =========================
 *  UI router
 *  ========================= */
let STATE = { view:"dash", editing:null };
function setView(v){ STATE.view=v; STATE.editing=null; render(); }

/** =========================
 *  Dashboard / Predicciones / Rutas / Productos / Pedidos / Visitas / Backup / Ajustes
 *  (Para no hacer infinito el mensaje, reutilizo tus mismas pantallas anteriores
 *   salvo “clientes” que la sustituimos por la nueva “farmacias”)
 *  ========================= */

function sumPedidosInRange(pedidos, start, end){
  const a = start.getTime();
  const b = end.getTime();
  return pedidos
    .filter(p=>["entregado","confirmado"].includes(p.estado))
    .filter(p=>{
      const t = new Date(p.fecha).getTime();
      return t >= a && t < b;
    })
    .reduce((acc,p)=> acc + Number(p.total||0), 0);
}

function parseTargetValue(v){
  const s = String(v||"").trim().toUpperCase().replace(",",".");
  if(!s) return 0;
  if(s.endsWith("K")){
    const n = Number(s.slice(0,-1));
    return isNaN(n) ? 0 : Math.round(n*1000);
  }
  const n = Number(s);
  return isNaN(n) ? 0 : Math.round(n);
}

/** =========================
 *  Render
 *  ========================= */
async function render(){
  const el = $("#view");
  const [clientes, productos, pedidos, visitas, rutas, settings, catalogo] = await Promise.all([
    dbAll("clientes"),
    dbAll("productos"),
    dbAll("pedidos"),
    dbAll("visitas"),
    dbAll("rutas"),
    loadSettings(),
    dbAll("catalogo")
  ]);

  // OJO: aquí solo implementamos la vista "clientes" (farmacias)
  // El resto de vistas puedes mantenerlas de tu versión anterior tal cual.
  // Si ya las tenías funcionando, copia/pega tus funciones anteriores.

  if(STATE.view==="clientes") return renderFarmacias(el, clientes, pedidos, catalogo);
  // fallback simple (para que no rompa si aún no has pegado tus otras vistas):
  el.innerHTML = `
    <div class="card">
      <h2>Vista "${escapeHtml(STATE.view)}"</h2>
      <div class="muted">Para esta entrega he implementado la parte de Farmacias (catálogo + mis farmacias + detalles). Mantén tus otras pantallas como estaban.</div>
      <div class="hr"></div>
      <button class="btn-primary" id="goFarm">Ir a Farmacias</button>
    </div>
  `;
  $("#goFarm").onclick = ()=>setView("clientes");
}

/** =========================
 *  NUEVA VISTA: Farmacias (Catálogo Galicia + Mis farmacias + Detalles)
 *  ========================= */
function renderFarmacias(el, misFarmacias, pedidos, catalogo){
  const misIds = new Set(misFarmacias.map(f=>f.catalogId || f.id)); // usamos catalogId si existe

  const zonas = Array.from(new Set(misFarmacias.map(x=>x.zona).filter(Boolean))).sort((a,b)=>a.localeCompare(b));

  el.innerHTML = `
    <div class="banner">
      <div class="row">
        <div>
          <b>Farmacias</b>
          <div class="mini">
            Catálogo Galicia (importado) + Mis farmacias (seguimiento, pedidos, visitas).
          </div>
        </div>
        <div class="right flex">
          <button class="btn" id="btnImportCat">Importar catálogo (KML/JSON)</button>
          <button class="btn-danger" id="btnClearCat">Borrar catálogo</button>
        </div>
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <h2>Catálogo Galicia (${catalogo.length})</h2>
        <div class="muted">
          Importa un KML/JSON y podrás añadir farmacias a “Mis farmacias”.<br>
          Recomendación: usa una fuente oficial (dataset sanitario de Galicia) para tener direcciones y coordenadas. :contentReference[oaicite:4]{index=4}
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div>
            <label>Buscar en catálogo</label>
            <input id="qCat" placeholder="Nombre / dirección..."
              data-help="Filtra el catálogo para encontrar una farmacia y añadirla a Mis farmacias." />
          </div>
          <div>
            <label>Límite listado</label>
            <select id="catLimit" data-help="Para catálogos grandes, muestra menos filas y mejora rendimiento.">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>

        <div class="helpbox mini" id="catHelp">Toca un campo para ver una ayuda rápida.</div>

        <div class="hr"></div>
        <div style="overflow:auto; max-height:560px">
          <table id="tCat">
            <thead>
              <tr>
                <th>Farmacia</th>
                <th>Dirección</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${renderCatalogRows(catalogo, misIds, 100)}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <h2>Mis farmacias (${misFarmacias.length})</h2>
          <div class="right">
            <button class="btn-primary" id="btnAltaManual">+ Alta manual</button>
          </div>
        </div>
        <div class="muted">Aquí es donde gestionas pedidos, visitas y detalles (panel por farmacia).</div>

        <div class="hr"></div>

        <div style="overflow:auto; max-height:560px">
          <table id="tMis">
            <thead>
              <tr>
                <th>Farmacia</th>
                <th>Zona</th>
                <th>Dirección</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${misFarmacias
                .slice()
                .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
                .map(f=>{
                  const m = mapsLinkForAddress(f.direccion||"");
                  const tag = f.catalogId ? `<span class="pill ok">catálogo</span>` : `<span class="pill">manual</span>`;
                  return `
                    <tr data-id="${f.id}">
                      <td>
                        <b>${escapeHtml(f.nombre||"")}</b> <span class="muted">${escapeHtml(f.apodo||"")}</span><br>
                        ${tag} <span class="mini">${escapeHtml((f.etiquetas||[]).join(", "))}</span>
                      </td>
                      <td>${escapeHtml(f.zona||"")}</td>
                      <td>${escapeHtml(f.direccion||"")}</td>
                      <td class="right">
                        <button class="btn-primary btn-xs" data-act="details">Detalles</button>
                        <button class="btn btn-xs" data-act="checkin">Check-in + pedido</button>
                        ${m?`<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:""}
                        <button class="btn-danger btn-xs" data-act="del">Quitar</button>
                      </td>
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <dialog id="importDlg">
      <div class="dlg-head">
        <div class="row">
          <div>
            <b>Importar catálogo</b><br>
            <span class="mini">Sube un archivo KML o JSON. Se procesa offline en el dispositivo.</span>
          </div>
          <div class="right">
            <button class="btn" id="impClose">Cerrar</button>
          </div>
        </div>
      </div>
      <div class="dlg-body">
        <div class="card" style="margin:0">
          <h2>Archivo</h2>
          <input type="file" id="impFile" accept=".kml,application/vnd.google-earth.kml+xml,application/json,.json">
          <div class="mini" style="margin-top:8px">
            Tip: si descargas un KML oficial del mapa sanitario, aquí lo importas y ya lo tienes como catálogo.
          </div>

          <div class="hr"></div>

          <div class="flex">
            <button class="btn-primary" id="impRun">Importar</button>
            <button class="btn-danger" id="impReplace">Importar reemplazando</button>
          </div>

          <div class="helpbox mini" id="impHelp">KML: se filtran elementos que contengan “FARMACIA”. JSON: usa campos nombre/direccion.</div>
        </div>
      </div>
      <div class="dlg-foot">
        <div class="mini">Esto no requiere Python ni servidor.</div>
      </div>
    </dialog>
  `;

  attachHelpToForm(document.body, $("#catHelp"));

  function renderCatalogRows(all, misIdsSet, limit){
    const rows = all.slice()
      .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
      .slice(0, limit);

    if(!rows.length){
      return `<tr><td colspan="4" class="muted">Catálogo vacío. Importa un KML/JSON.</td></tr>`;
    }

    return rows.map(f=>{
      const inMine = misIdsSet.has(f.catalogId);
      const m = mapsLinkForAddress(f.direccion||"");
      return `
        <tr data-catid="${f.catalogId}" style="${inMine ? 'background: rgba(34,197,94,.08);' : ''}">
          <td><b>${escapeHtml(f.nombre||"")}</b><br><span class="mini">${escapeHtml(f.municipio||"")}</span></td>
          <td>${escapeHtml(f.direccion||"")}</td>
          <td>${inMine ? `<span class="pill ok">en Mis farmacias</span>` : `<span class="pill">no añadida</span>`}</td>
          <td class="right">
            ${m?`<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:""}
            <button class="btn-primary btn-xs" data-act="add" ${inMine?'disabled':''}>Añadir</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // buscar / limitar catálogo
  const updateCatTable = ()=>{
    const q = ($("#qCat").value||"").trim().toLowerCase();
    const limit = Number($("#catLimit").value||100);
    const filtered = q
      ? catalogo.filter(x=>{
          const t = (x.nombre+" "+x.direccion+" "+(x.municipio||"")+" "+(x.provincia||"")).toLowerCase();
          return t.includes(q);
        })
      : catalogo;

    $("#tCat tbody").innerHTML = renderCatalogRows(filtered, misIds, limit);
  };

  $("#qCat").oninput = updateCatTable;
  $("#catLimit").onchange = updateCatTable;

  // abrir modal import
  const importDlg = $("#importDlg");
  $("#btnImportCat").onclick = ()=> importDlg.showModal();
  $("#impClose").onclick = ()=> importDlg.close();

  async function runImport({replace=false}){
    const file = $("#impFile").files[0];
    if(!file) return toast("Selecciona un archivo KML o JSON");

    const text = await file.text();
    let items = [];
    try{
      if(file.name.toLowerCase().endsWith(".kml")){
        items = parseKmlToCatalog(text);
      }else{
        items = parseJsonToCatalog(text);
      }
    }catch(err){
      console.error(err);
      return toast("No se pudo importar (formato inválido)");
    }

    if(!items.length){
      return toast("No se detectaron farmacias (revisa el archivo)");
    }

    if(replace){
      await dbClear("catalogo");
    }

    for(const it of items){
      await dbPut("catalogo", it);
    }

    toast(`Catálogo importado: ${items.length}`);
    importDlg.close();
    render();
  }

  $("#impRun").onclick = ()=> runImport({replace:false});
  $("#impReplace").onclick = ()=> runImport({replace:true});

  $("#btnClearCat").onclick = async ()=>{
    if(!confirm("¿Borrar TODO el catálogo importado?")) return;
    await dbClear("catalogo");
    toast("Catálogo borrado");
    render();
  };

  // añadir desde catálogo -> Mis farmacias (clientes)
  $("#tCat").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    if(btn.dataset.act!=="add") return;

    const tr = e.target.closest("tr");
    const catid = tr?.dataset?.catid;
    if(!catid) return;

    const cat = await dbGet("catalogo", catid);
    if(!cat) return;

    // crear “cliente” con catalogId para “pintar verde”
    const cliente = {
      id: uid(),
      catalogId: cat.catalogId,
      nombre: cat.nombre,
      apodo: "",
      zona: "",
      direccion: cat.direccion,
      telefono: "",
      email: "",
      notas: "",
      estado: "activo",
      etiquetas: ["catálogo"],
      frecuenciaObjetivoDias: 21,
      creadoEn: nowISO(),
      actualizadoEn: nowISO()
    };

    await dbPut("clientes", cliente);
    toast("Añadida a Mis farmacias");
    render();
  };

  // Mis farmacias: detalles / checkin / quitar
  $("#tMis").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if(!id) return;

    const act = btn.dataset.act;
    if(act==="del"){
      if(!confirm("¿Quitar de Mis farmacias? (No borra pedidos existentes)")) return;
      await dbDel("clientes", id);
      toast("Quitada");
      render();
      return;
    }

    if(act==="details"){
      const cliente = await dbGet("clientes", id);
      if(!cliente) return;
      openPharmacyDetails(cliente, pedidos);
      return;
    }

    if(act==="checkin"){
      const cliente = await dbGet("clientes", id);
      if(!cliente) return;
      // abre check-in “general” (sin stopId)
      openCheckinModal(cliente.id);
      return;
    }
  };

  $("#btnAltaManual").onclick = async ()=>{
    const nombre = prompt("Nombre farmacia:");
    if(!nombre) return;
    const dir = prompt("Dirección (para Maps):") || "";
    await dbPut("clientes", {
      id: uid(),
      catalogId: "",
      nombre: nombre.trim(),
      apodo: "",
      zona: "",
      direccion: dir.trim(),
      telefono: "",
      email: "",
      notas: "",
      estado: "activo",
      etiquetas: ["manual"],
      frecuenciaObjetivoDias: 21,
      creadoEn: nowISO(),
      actualizadoEn: nowISO()
    });
    toast("Alta manual creada");
    render();
  };
}

/** =========================
 *  Detalles farmacia modal
 *  ========================= */
function openPharmacyDetails(cliente, pedidosAll){
  const dlg = $("#pharmacyDlg");
  $("#phTitle").textContent = `Detalles · ${cliente.nombre}`;
  $("#phSubtitle").textContent = `${cliente.direccion || ""}`;

  const pedidosCli = pedidosAll
    .filter(p=>p.clienteId===cliente.id)
    .slice()
    .sort((a,b)=> new Date(b.fecha)-new Date(a.fecha));

  const last10 = pedidosCli.slice(0,10);
  const nextISO = estimateNextOrderISOForCliente(cliente.id, pedidosAll);
  const nextTxt = nextISO ? fmtDate(nextISO) : "—";

  const m = mapsLinkForAddress(cliente.direccion||"");

  $("#phBody").innerHTML = `
    <div class="card" style="margin:0">
      <div class="row">
        <div>
          <b>${escapeHtml(cliente.nombre)}</b><br>
          <span class="mini">${escapeHtml((cliente.etiquetas||[]).join(", "))}</span>
        </div>
        <div class="right flex">
          ${m?`<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:""}
          <button class="btn-primary btn-xs" id="phCheckin">Check-in + pedido</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="kpi">
        <div class="k"><div class="v">${pedidosCli.length}</div><div class="t">Pedidos registrados</div></div>
        <div class="k"><div class="v">${nextTxt}</div><div class="t">Próximo pedido estimado</div></div>
        <div class="k"><div class="v">${cliente.frecuenciaObjetivoDias||"—"}</div><div class="t">Frecuencia objetivo (días)</div></div>
        <div class="k"><div class="v">${fmtEur(pedidosCli.filter(p=>["confirmado","entregado"].includes(p.estado)).reduce((a,p)=>a+Number(p.total||0),0))}</div><div class="t">Ventas acumuladas</div></div>
      </div>

      <div class="mini" style="margin-top:8px">
        La estimación usa la media de intervalos entre pedidos de los <b>últimos 10</b> pedidos y requiere <b>mínimo 3</b> pedidos.
      </div>

      <div class="hr"></div>
      <h2>Últimos pedidos</h2>

      ${last10.length ? `
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Total</th><th>Notas</th></tr></thead>
          <tbody>
            ${last10.map(p=>{
              const cls = p.estado==="entregado" ? "ok" : (p.estado==="confirmado" ? "warn" : "bad");
              return `<tr>
                <td>${fmtDate(p.fecha)}</td>
                <td><span class="pill ${cls}">${escapeHtml(p.estado||"")}</span></td>
                <td>${fmtEur(p.total||0)}</td>
                <td class="mini">${escapeHtml((p.notas||"").slice(0,120))}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="muted">Aún no hay pedidos para esta farmacia.</div>`}
    </div>
  `;

  $("#phClose").onclick = ()=> dlg.close();
  $("#phCheckin").onclick = ()=>{
    dlg.close();
    openCheckinModal(cliente.id);
  };

  dlg.showModal();
}

/** =========================
 *  Check-in modal (versión compacta)
 *  - Para esta entrega lo dejamos funcional:
 *    1) guarda interacción en "visitas"
 *    2) si activas "crear pedido", crea un pedido básico (sin líneas complejas)
 *  - Si quieres, lo conecto con tu check-in avanzado anterior y líneas de producto.
 *  ========================= */
async function openCheckinModal(clienteId){
  // Construimos el modal “al vuelo” en #checkinDlg
  const dlg = $("#checkinDlg");
  const c = await dbGet("clientes", clienteId);
  if(!c) return;

  dlg.innerHTML = `
    <div class="dlg-head">
      <div class="row">
        <div>
          <b>Check-in · ${escapeHtml(c.nombre)}</b><br>
          <span class="mini">${escapeHtml(c.direccion||"")}</span>
        </div>
        <div class="right">
          <button class="btn" id="ciClose2">Cerrar</button>
        </div>
      </div>
    </div>
    <div class="dlg-body">
      <form id="ciForm2">
        <input type="hidden" name="clienteId" value="${escapeHtml(clienteId)}">

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input type="date" name="fecha" required value="${isoDateOnly(new Date())}"
              data-help="Fecha de la interacción. Por defecto hoy." />
          </div>
          <div>
            <label>Tipo</label>
            <select name="tipo" data-help="Tipo de interacción.">
              <option value="visita">visita</option>
              <option value="llamada">llamada</option>
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Resultado</label>
            <select name="resultado" data-help="Resultado del contacto.">
              <option value="ok">ok</option>
              <option value="pendiente">pendiente</option>
              <option value="sin_respuesta">sin respuesta</option>
            </select>
          </div>
          <div>
            <label>Próxima acción (opcional)</label>
            <input name="proximaAccion" placeholder="Ej: enviar promo / llamar martes"
              data-help="Se verá en Predicciones como pendiente." />
          </div>
        </div>

        <label>Notas</label>
        <textarea name="notas" placeholder="Necesidades, objeciones..."
          data-help="Notas útiles de la visita."></textarea>

        <div class="grid two">
          <div>
            <label>¿Crear pedido ahora?</label>
            <select name="crearPedido" data-help="Si se confirma pedido, actívalo.">
              <option value="no">no</option>
              <option value="si">sí</option>
            </select>
          </div>
          <div>
            <label>Importe pedido (si lo creas)</label>
            <input name="importe" type="number" step="0.01" min="0" placeholder="Ej: 250"
              data-help="Importe total del pedido (rápido). Luego puedes editar y añadir líneas en Pedidos." />
          </div>
        </div>

        <div class="helpbox mini" id="ciHelp2">Toca un campo para ver una ayuda rápida.</div>

        <div class="hr"></div>
        <button class="btn-primary" type="submit">Guardar</button>
      </form>
    </div>
    <div class="dlg-foot"><div class="mini">Se guarda offline.</div></div>
  `;

  $("#ciClose2").onclick = ()=> dlg.close();
  const form = $("#ciForm2");
  attachHelpToForm(form, $("#ciHelp2"));

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const fechaISO = fromDateOnly(form.fecha.value);

    // 1) visita
    await dbPut("visitas", {
      id: uid(),
      clienteId,
      fecha: fechaISO,
      tipo: form.tipo.value,
      resultado: form.resultado.value,
      notas: form.notas.value.trim(),
      proximaAccion: form.proximaAccion.value.trim(),
      importeRapido: 0,
      creadoEn: nowISO(),
      actualizadoEn: nowISO()
    });

    // 2) pedido rápido (si sí)
    if(form.crearPedido.value==="si"){
      const imp = Number(form.importe.value||0);
      await dbPut("pedidos", recomputePedido({
        id: uid(),
        clienteId,
        fecha: fechaISO,
        fechaEntrega: "",
        estado: "confirmado",
        canal: form.tipo.value==="visita" ? "visita" : "telefono",
        comercial: "delegada",
        notas: "Pedido creado desde Check-in (rápido)",
        lineas: imp>0 ? [{id:uid(), productoId:"", nombre:"(pendiente detallar)", cantidad:1, precioUnit:imp, descuentoPct:0, total:imp}] : [],
        total: imp>0 ? imp : 0,
        creadoEn: nowISO(),
        actualizadoEn: nowISO()
      }));
    }

    dlg.close();
    toast("Check-in guardado");
  };

  dlg.showModal();
}

/** =========================
 *  Init
 *  ========================= */
(async function init(){
  await openDB();
  await ensureSeed();
  await setupPWA();

  $$("nav button").forEach(b=> b.onclick = ()=> setView(b.dataset.view));
  render();
})();
