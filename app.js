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
 *  Help (descripción al enfocar campos)
 *  ========================= */
function attachHelpToForm(formEl, helpEl){
  if(!formEl || !helpEl) return;
  const handler = (e)=>{
    const t = e.target;
    if(!t || !(t.matches("input,select,textarea"))) return;
    const msg = t.dataset.help || t.getAttribute("data-help") || "";
    helpEl.textContent = msg ? msg : "Toca un campo para ver una ayuda rápida.";
  };
  formEl.addEventListener("focusin", handler);
  formEl.addEventListener("click", handler);
}

/** =========================
 *  Maps links (Apple/Google)
 *  ========================= */
function mapsLinkForAddress(address){
  const q = encodeURIComponent(address||"");
  if(!q) return "";
  if(isIOS()) return `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** =========================
 *  Tiempo / Trimestres
 *  ========================= */
function getQuarter(date=new Date()){
  const m = date.getMonth(); // 0..11
  return Math.floor(m/3) + 1; // 1..4
}
function quarterKey(date=new Date()){
  const q = getQuarter(date);
  const yy = String(date.getFullYear()).slice(-2);
  return `${q}T${yy}`; // ej: 1T26
}
function quarterStartEnd(date=new Date()){
  const year = date.getFullYear();
  const q = getQuarter(date);
  const startMonth = (q-1)*3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth+3, 1); // exclusivo
  return {start, end, q, year};
}
function daysRemainingInQuarter(date=new Date()){
  const {end} = quarterStartEnd(date);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.ceil((end - today) / (1000*60*60*24));
  return Math.max(0, diff);
}

/** =========================
 *  IndexedDB
 *  ========================= */
const DB_NAME = "farmacias_ventas_offline_db";
const DB_VER = 4;
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
  // objetivos trimestrales: {"1T26":180000, "2T26":180000, ...}
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
 *  Seed demo (farmacias)
 *  ========================= */
async function ensureSeed(){
  const meta = await dbGet("meta","seeded_v2");
  if(meta?.value) return;

  const f1 = {id:uid(), nombre:"Farmacia Plaza", apodo:"Plaza", zona:"Pontevedra Centro", direccion:"C/ Michelena 10, Pontevedra", telefono:"600111222", email:"", notas:"Suele pedir cada 3 semanas. Interés en dermocosmética.", estado:"activo", etiquetas:["alto potencial"], frecuenciaObjetivoDias:21, creadoEn:nowISO()};
  const f2 = {id:uid(), nombre:"Farmacia Atlántico", apodo:"Atlántico", zona:"Vigo", direccion:"Av. Gran Vía 44, Vigo", telefono:"", email:"", notas:"Buena rotación. Sensible a promos.", estado:"activo", etiquetas:["recurrente"], frecuenciaObjetivoDias:18, creadoEn:nowISO()};
  const f3 = {id:uid(), nombre:"Farmacia Rías", apodo:"Rías", zona:"Sanxenxo", direccion:"Rúa Praia 9, Sanxenxo", telefono:"", email:"", notas:"Potencial, aún sin primer pedido.", estado:"potencial", etiquetas:["potencial"], frecuenciaObjetivoDias:30, creadoEn:nowISO()};

  const p1 = {id:uid(), nombre:"Crema Dermoprotectora 50ml", descripcion:"Piel sensible · alta rotación", precio:18.90, activo:true, creadoEn:nowISO()};
  const p2 = {id:uid(), nombre:"Complemento Vitamina D3", descripcion:"Formato 30 cápsulas", precio:12.90, activo:true, creadoEn:nowISO()};
  const p3 = {id:uid(), nombre:"Champú Anticaspa 200ml", descripcion:"Tratamiento intensivo", precio:14.50, activo:true, creadoEn:nowISO()};

  await dbPut("clientes", f1); await dbPut("clientes", f2); await dbPut("clientes", f3);
  await dbPut("productos", p1); await dbPut("productos", p2); await dbPut("productos", p3);

  const ped1 = {
    id:uid(),
    clienteId:f1.id,
    fecha:new Date(Date.now()-1000*60*60*24*35).toISOString(),
    fechaEntrega:new Date(Date.now()-1000*60*60*24*33).toISOString(),
    estado:"entregado",
    canal:"visita",
    comercial:"delegada",
    notas:"Reposición + promo",
    lineas:[
      {id:uid(), productoId:p1.id, nombre:p1.nombre, cantidad:6, precioUnit:18.90, descuentoPct:0, total:0},
      {id:uid(), productoId:p2.id, nombre:p2.nombre, cantidad:3, precioUnit:12.90, descuentoPct:5, total:0},
    ],
    total:0,
    creadoEn:nowISO()
  };
  recomputePedido(ped1);

  const ped2 = {
    id:uid(),
    clienteId:f2.id,
    fecha:new Date(Date.now()-1000*60*60*24*12).toISOString(),
    fechaEntrega:"",
    estado:"confirmado",
    canal:"whatsapp",
    comercial:"delegada",
    notas:"Añadir display",
    lineas:[
      {id:uid(), productoId:p3.id, nombre:p3.nombre, cantidad:5, precioUnit:14.50, descuentoPct:0, total:0},
      {id:uid(), productoId:p1.id, nombre:p1.nombre, cantidad:2, precioUnit:18.90, descuentoPct:0, total:0},
    ],
    total:0,
    creadoEn:nowISO()
  };
  recomputePedido(ped2);

  await dbPut("pedidos", ped1); await dbPut("pedidos", ped2);
  await dbPut("visitas", {
    id:uid(), clienteId:f2.id,
    fecha:new Date(Date.now()-1000*60*60*24*7).toISOString(),
    tipo:"llamada", resultado:"pendiente",
    notas:"Quiere info sobre nueva campaña.",
    proximaAccion:"Enviar material promocional",
    importeRapido:0,
    creadoEn:nowISO()
  });

  // Objetivos demo para trimestre actual (por si quieres ver el widget funcionando)
  const s = await loadSettings();
  if(!s.quarterlyTargets || Object.keys(s.quarterlyTargets).length===0){
    const k = quarterKey(new Date());
    s.quarterlyTargets[k] = 180000;
    await saveSetting("quarterlyTargets", s.quarterlyTargets);
  }

  await dbPut("meta",{key:"seeded_v2", value:true});
}

/** =========================
 *  KPIs + scoring + predicción
 *  ========================= */
function calcKpis(clientes, productos, pedidos){
  const pedidosOK = pedidos.filter(p=>["entregado","confirmado"].includes(p.estado));
  const totalVentas = pedidosOK.reduce((a,p)=>a+Number(p.total||0),0);
  const nPedidos = pedidosOK.length;
  const ticketMedio = nPedidos ? totalVentas/nPedidos : 0;

  const lim30 = Date.now() - 1000*60*60*24*30;
  const ventas30 = pedidosOK.filter(p=> new Date(p.fecha).getTime() >= lim30)
    .reduce((a,p)=>a+Number(p.total||0),0);

  const mapProd = new Map();
  for(const p of pedidosOK){
    for(const l of (p.lineas||[])){
      mapProd.set(l.productoId, (mapProd.get(l.productoId)||0) + Number(l.total||0));
    }
  }
  const topProd = Array.from(mapProd.entries())
    .map(([id,tot])=>({id, tot}))
    .sort((a,b)=>b.tot-a.tot)
    .slice(0,10)
    .map(x=>{
      const pr = productos.find(pp=>pp.id===x.id);
      return {nombre: pr?.nombre || "Producto", total:x.tot};
    });

  const porCliente = new Map();
  for(const p of pedidosOK){
    if(!porCliente.has(p.clienteId)) porCliente.set(p.clienteId, []);
    porCliente.get(p.clienteId).push(p);
  }

  const riesgo = [];
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
    const umbral = Math.round(objetivo*1.5);
    const enRiesgo = ultimo ? (diasDesdeUltimo > umbral) : false;

    const total = arr.reduce((a,p)=>a+Number(p.total||0),0);

    const predNext = ultimo ? (()=>{ const d=new Date(ultimo); d.setDate(d.getDate()+objetivo); return d.toISOString(); })() : "";

    statsCliente.push({
      cliente: c,
      total,
      pedidos: arr.length,
      diasDesdeUltimo,
      objetivo,
      mediaEntrePedidos: media,
      ultimoPedido: ultimo,
      predNext
    });

    if(enRiesgo){
      riesgo.push({cliente:c, dias:diasDesdeUltimo, umbral});
    }
  }

  statsCliente.sort((a,b)=>b.total-a.total);
  riesgo.sort((a,b)=>b.dias-a.dias);

  return { totalVentas, nPedidos, ticketMedio, ventas30, topProd, riesgo, statsCliente };
}

function scoreClienteForVisit(stat){
  // Más score => más prioridad de visita.
  const c = stat.cliente;
  const ratio = stat.objetivo ? (stat.diasDesdeUltimo / stat.objetivo) : 0;
  const ratioScore = clamp(ratio, 0, 3) * 60; // vencimiento pesa mucho
  const ventasScore = clamp(Math.log10((stat.total||0) + 1), 0, 5) * 10; // valor histórico
  const estadoAdj = c.estado==="activo" ? 12 : (c.estado==="potencial" ? 2 : -12);
  const firstOrderBoost = (stat.pedidos===0 ? 15 : 0); // empujar primeras compras
  return Math.round(ratioScore + ventasScore + estadoAdj + firstOrderBoost);
}
function clasePrioridad(stat){
  const ratio = stat.objetivo ? (stat.diasDesdeUltimo / stat.objetivo) : 0;
  if(ratio >= 1.5) return "bad";
  if(ratio >= 1.0) return "warn";
  return "ok";
}

/** =========================
 *  Auto-backup (snapshot local)
 *  ========================= */
async function updateBackupPill(){
  const m = await dbGet("meta","latestBackupReady");
  const pill = $("#backupPill");
  pill.style.display = m?.value ? "" : "none";
  pill.onclick = ()=> setView("backup");
}
async function createSnapshot(reason="auto"){
  const [clientes, productos, pedidos, visitas, rutas, settings] = await Promise.all([
    dbAll("clientes"), dbAll("productos"), dbAll("pedidos"), dbAll("visitas"), dbAll("rutas"), dbAll("settings")
  ]);

  const payload = {
    version: 2,
    reason,
    createdAt: nowISO(),
    clientes, productos, pedidos, visitas, rutas,
    settings
  };

  const snap = { id: uid(), createdAt: payload.createdAt, reason, payload };
  await dbPut("backups", snap);
  await dbPut("meta", {key:"lastSnapshotAt", value: payload.createdAt});
  await dbPut("meta", {key:"latestBackupReady", value: true});

  const s = await loadSettings();
  const keep = Number(s.keepBackups||10);
  const all = (await dbAll("backups")).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  for(let i=keep;i<all.length;i++){
    await dbDel("backups", all[i].id);
  }
  updateBackupPill();
}
async function checkAutoBackup(){
  const s = await loadSettings();
  if(!s.autoBackupEnabled) return;

  const last = await dbGet("meta","lastSnapshotAt");
  const lastAt = last?.value ? new Date(last.value) : null;
  const every = Number(s.autoBackupEveryDays||7);

  if(!lastAt){
    await createSnapshot("auto-first");
    toast("Backup automático creado (1ª vez)");
    return;
  }
  const diffDays = daysBetween(lastAt.toISOString(), nowISO());
  if(diffDays >= every){
    await createSnapshot("auto");
    toast("Backup automático creado");
  }
}

/** =========================
 *  PWA: Service Worker
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
 *  Estado UI
 *  ========================= */
let STATE = { view:"dash", editing:null };

function setView(v){ STATE.view=v; STATE.editing=null; render(); }

/** =========================
 *  Helpers: ventas trimestre actual
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
function shortK(n){
  const x = Number(n||0);
  if(x>=1000) return (Math.round(x/100)/10).toString().replace(".",",") + "K";
  return String(Math.round(x)).replace(".",",");
}

/** =========================
 *  Render router
 *  ========================= */
async function render(){
  const el = $("#view");
  const [clientes, productos, pedidos, visitas, rutas, settings] = await Promise.all([
    dbAll("clientes"), dbAll("productos"), dbAll("pedidos"), dbAll("visitas"), dbAll("rutas"), loadSettings()
  ]);

  if(STATE.view==="dash") return renderDash(el, clientes, productos, pedidos, settings);
  if(STATE.view==="predicciones") return renderPredicciones(el, clientes, productos, pedidos, visitas, settings);
  if(STATE.view==="rutas") return renderRutas(el, clientes, productos, pedidos, visitas, rutas);
  if(STATE.view==="clientes") return renderClientes(el, clientes);
  if(STATE.view==="productos") return renderProductos(el, productos);
  if(STATE.view==="pedidos") return renderPedidos(el, clientes, productos, pedidos);
  if(STATE.view==="visitas") return renderVisitas(el, clientes, visitas);
  if(STATE.view==="backup") return renderBackup(el);
  if(STATE.view==="ajustes") return renderAjustes(el, settings);
  el.innerHTML = `<div class="card">Vista no encontrada</div>`;
}

/** =========================
 *  DASHBOARD (con objetivo trimestral)
 *  ========================= */
function renderDash(el, clientes, productos, pedidos, settings){
  const k = calcKpis(clientes, productos, pedidos);

  const now = new Date();
  const qk = quarterKey(now);
  const {start, end} = quarterStartEnd(now);
  const quarterSales = sumPedidosInRange(pedidos, start, end);

  const target = Number((settings.quarterlyTargets||{})[qk] || 0);
  const remaining = Math.max(0, target - quarterSales);
  const pct = target>0 ? Math.min(100, (quarterSales/target)*100) : 0;

  const topClientes = k.statsCliente.slice(0,12);
  const riesgo = k.riesgo.slice(0,10);

  el.innerHTML = `
    <div class="grid">
      <div class="card">
        <h2>Trimestre en curso · ${escapeHtml(qk)}</h2>
        <div class="kpi">
          <div class="k">
            <div class="v">${fmtEur(quarterSales)}</div>
            <div class="t">Acumulado en el trimestre</div>
          </div>
          <div class="k">
            <div class="v">${target ? fmtEur(target) : "—"}</div>
            <div class="t">Objetivo trimestre (configurable)</div>
          </div>
          <div class="k">
            <div class="v">${target ? (Math.round(pct*10)/10).toString().replace(".",",") + "%" : "—"}</div>
            <div class="t">Progreso</div>
          </div>
          <div class="k">
            <div class="v">${target ? fmtEur(remaining) : "—"}</div>
            <div class="t">Falta para objetivo</div>
          </div>
        </div>
        <div class="mini" style="margin-top:8px">
          Tip: ajusta objetivos en <b>Ajustes</b>. Puedes escribir 180000 o 180K (la app lo interpreta).
        </div>

        <div class="hr"></div>

        <h2>KPIs generales</h2>
        <div class="kpi">
          <div class="k"><div class="v">${fmtEur(k.totalVentas)}</div><div class="t">Ventas total (confirmado/entregado)</div></div>
          <div class="k"><div class="v">${k.nPedidos}</div><div class="t">Nº pedidos</div></div>
          <div class="k"><div class="v">${fmtEur(k.ticketMedio)}</div><div class="t">Ticket medio</div></div>
          <div class="k"><div class="v">${fmtEur(k.ventas30)}</div><div class="t">Ventas últimos 30 días</div></div>
        </div>

        <div class="hr"></div>
        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Top productos</h2>
            ${k.topProd.length ? `
              <table>
                <thead><tr><th>Producto</th><th>Total</th></tr></thead>
                <tbody>
                  ${k.topProd.map(x=>`<tr><td>${escapeHtml(x.nombre)}</td><td>${fmtEur(x.total)}</td></tr>`).join("")}
                </tbody>
              </table>` : `<div class="muted">Aún no hay datos.</div>`}
          </div>

          <div class="card" style="margin:0">
            <h2>Farmacias en riesgo</h2>
            ${riesgo.length ? `
              <table>
                <thead><tr><th>Farmacia</th><th>Días sin pedido</th><th>Umbral</th></tr></thead>
                <tbody>
                  ${riesgo.map(r=>`<tr><td>${escapeHtml(r.cliente.nombre)}</td><td>${r.dias}</td><td>${r.umbral}</td></tr>`).join("")}
                </tbody>
              </table>` : `<span class="pill ok">Todo al día</span>`}
            <div class="mini">Regla simple: “riesgo” si supera 1,5× la frecuencia objetivo.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <h2>Ranking farmacias (ventas + planificación)</h2>
          <div class="right flex">
            <button class="btn" id="goAjustes">Objetivos</button>
            <button class="btn-primary" id="goPred">Predicciones</button>
            <button class="btn-primary" id="goRutas">Rutas</button>
          </div>
        </div>

        ${topClientes.length ? `
          <table>
            <thead><tr><th>Farmacia</th><th>Ventas</th><th>Pedidos</th><th>Último</th><th>Prioridad</th><th>Próxima estimada</th></tr></thead>
            <tbody>
              ${topClientes.map(s=>{
                const cls = clasePrioridad(s);
                const score = scoreClienteForVisit(s);
                return `<tr>
                  <td>
                    ${escapeHtml(s.cliente.nombre)} <span class="muted">${escapeHtml(s.cliente.apodo||"")}</span><br>
                    <span class="mini">${escapeHtml(s.cliente.zona||"")}</span>
                  </td>
                  <td>${fmtEur(s.total)}</td>
                  <td>${s.pedidos}</td>
                  <td>${s.ultimoPedido ? fmtDate(s.ultimoPedido) : "-"}</td>
                  <td><span class="pill ${cls}">${score} pts · ${s.diasDesdeUltimo}d/${s.objetivo}d</span></td>
                  <td>${s.predNext ? fmtDate(s.predNext) : "-"}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>` : `<div class="muted">Crea farmacias y pedidos para ver estadísticas.</div>`}
      </div>
    </div>
  `;

  $("#goRutas").onclick = ()=> setView("rutas");
  $("#goPred").onclick = ()=> setView("predicciones");
  $("#goAjustes").onclick = ()=> setView("ajustes");
}

/** =========================
 *  PREDICCIONES
 *  ========================= */
function renderPredicciones(el, clientes, productos, pedidos, visitas, settings){
  const now = new Date();
  const qk = quarterKey(now);
  const {start, end} = quarterStartEnd(now);
  const quarterSales = sumPedidosInRange(pedidos, start, end);

  const target = Number((settings.quarterlyTargets||{})[qk] || 0);
  const remaining = Math.max(0, target - quarterSales);

  const daysLeft = daysRemainingInQuarter(now);
  const weeksLeft = Math.max(1, Math.ceil(daysLeft/7));
  const perWeek = target>0 ? remaining / weeksLeft : 0;
  const perDay = target>0 ? (daysLeft>0 ? remaining/daysLeft : remaining) : 0;

  const k = calcKpis(clientes, productos, pedidos);
  const suggestions = k.statsCliente
    .filter(s=> s.cliente.estado !== "inactivo")
    .map(s=>({
      ...s,
      score: scoreClienteForVisit(s),
      cls: clasePrioridad(s),
      dueInDays: s.predNext ? daysBetween(nowISO(), s.predNext) : 999
    }))
    .sort((a,b)=> b.score - a.score)
    .slice(0, 12);

  const pendientes = visitas
    .filter(v=> (v.proximaAccion||"").trim().length>0 && v.resultado==="pendiente")
    .slice()
    .sort((a,b)=> new Date(b.fecha)-new Date(a.fecha))
    .slice(0, 10)
    .map(v=>{
      const c = clientes.find(x=>x.id===v.clienteId);
      return {...v, farmacia: c?.nombre||""};
    });

  el.innerHTML = `
    <div class="banner">
      <div class="row">
        <div>
          <b>Predicciones · ${escapeHtml(qk)}</b>
          <div class="mini">Objetivo trimestral, ritmo recomendado y sugerencias de visita (todo offline).</div>
        </div>
        <div class="right flex">
          <button class="btn" id="goTargets">Editar objetivos</button>
          <button class="btn-primary" id="goRutas2">Generar ruta</button>
        </div>
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <h2>Ritmo para alcanzar el objetivo</h2>
        ${target ? `
          <div class="kpi">
            <div class="k"><div class="v">${fmtEur(quarterSales)}</div><div class="t">Acumulado trimestre</div></div>
            <div class="k"><div class="v">${fmtEur(target)}</div><div class="t">Objetivo</div></div>
            <div class="k"><div class="v">${fmtEur(remaining)}</div><div class="t">Falta</div></div>
            <div class="k"><div class="v">${daysLeft}</div><div class="t">Días restantes</div></div>
          </div>
          <div class="hr"></div>
          <div class="kpi">
            <div class="k"><div class="v">${fmtEur(perWeek)}</div><div class="t">Necesario por semana</div></div>
            <div class="k"><div class="v">${fmtEur(perDay)}</div><div class="t">Necesario por día</div></div>
            <div class="k"><div class="v">${weeksLeft}</div><div class="t">Semanas restantes (aprox.)</div></div>
            <div class="k"><div class="v">${shortK(remaining)}</div><div class="t">Falta (abreviado)</div></div>
          </div>
          <div class="mini" style="margin-top:8px">
            Esto se recalcula automáticamente cada día según el acumulado y el tiempo que queda del trimestre.
          </div>
        ` : `
          <div class="muted">
            No hay objetivo para <b>${escapeHtml(qk)}</b>. Ve a <b>Ajustes</b> y configúralo (ej: 180000 o 180K).
          </div>
        `}
      </div>

      <div class="card">
        <h2>Pendientes (próxima acción)</h2>
        ${pendientes.length ? `
          <table>
            <thead><tr><th>Fecha</th><th>Farmacia</th><th>Acción</th><th></th></tr></thead>
            <tbody>
              ${pendientes.map(p=>{
                const m = mapsLinkForAddress((clientes.find(x=>x.id===p.clienteId)?.direccion)||"");
                return `<tr>
                  <td>${fmtDate(p.fecha)}</td>
                  <td>${escapeHtml(p.farmacia)}</td>
                  <td>${escapeHtml(p.proximaAccion)}</td>
                  <td class="right">
                    <button class="btn-primary btn-xs" data-act="checkin" data-id="${p.clienteId}">Check-in</button>
                    ${m?`<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:""}
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        ` : `<div class="muted">No hay acciones pendientes registradas.</div>`}
      </div>
    </div>

    <div class="card">
      <div class="row">
        <h2>Sugerencias de visita (a quién tocaría pedir pronto)</h2>
        <div class="right muted">Ordenado por prioridad (vencimiento + valor + estado)</div>
      </div>
      <div class="hr"></div>

      ${suggestions.length ? `
        <table id="tSug">
          <thead><tr>
            <th>Farmacia</th>
            <th>Zona</th>
            <th>Días desde último</th>
            <th>Objetivo</th>
            <th>Próx. estimada</th>
            <th>Prioridad</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${suggestions.map(s=>{
              const c = s.cliente;
              const m = mapsLinkForAddress(c.direccion||"");
              const dueTxt = s.predNext ? fmtDate(s.predNext) : "-";
              const score = s.score;
              return `<tr data-id="${c.id}">
                <td>
                  <b>${escapeHtml(c.nombre)}</b> <span class="muted">${escapeHtml(c.apodo||"")}</span><br>
                  <span class="mini">${escapeHtml((c.etiquetas||[]).join(", "))}</span>
                </td>
                <td>${escapeHtml(c.zona||"")}</td>
                <td>${s.diasDesdeUltimo}</td>
                <td>${s.objetivo} días</td>
                <td>${dueTxt}</td>
                <td><span class="pill ${s.cls}">${score} pts</span></td>
                <td class="right">
                  <button class="btn-primary btn-xs" data-act="checkin">Check-in</button>
                  ${m?`<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:""}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="muted">Crea pedidos para que las predicciones sean más precisas.</div>`}

      <div class="mini" style="margin-top:10px">
        Nota: la “próxima estimada” se calcula con la frecuencia objetivo (días) o la media histórica si existe.
      </div>
    </div>
  `;

  $("#goTargets").onclick = ()=> setView("ajustes");
  $("#goRutas2").onclick = ()=> setView("rutas");

  const tSug = $("#tSug");
  if(tSug){
    tSug.onclick = (e)=>{
      const b = e.target.closest("button");
      const tr = e.target.closest("tr");
      if(!b || !tr) return;
      const id = tr.dataset.id;
      if(b.dataset.act==="checkin"){
        openCheckinModal({clienteId:id, stopId:"", date: isoDateOnly(new Date())});
      }
    };
  }

  // Reutiliza el mismo modal de check-in que rutas
  async function openCheckinModal({clienteId, stopId, date}){
    const clientesAll = await dbAll("clientes");
    const productosAll = await dbAll("productos");
    const pedidosAll = await dbAll("pedidos");
    const visitasAll = await dbAll("visitas");
    const rutasAll = await dbAll("rutas");
    // “hack” simple: renderizamos rutas en memoria para usar su función interna de check-in
    // pero en vez de duplicar código, abrimos el modal con una función global.
    window.__openCheckin({clienteId, stopId, date, clientes: clientesAll, productos: productosAll, pedidos: pedidosAll, visitas: visitasAll, rutas: rutasAll});
  }
}

/** =========================
 *  RUTAS / VISITAS + MAPS + CHECKIN
 *  ========================= */
function renderRutas(el, clientes, productos, pedidos, visitas, rutas){
  const k = calcKpis(clientes, productos, pedidos);
  const zonas = Array.from(new Set(clientes.map(c=>c.zona).filter(Boolean))).sort((a,b)=>a.localeCompare(b));

  const hoy = isoDateOnly(new Date());
  const rutaPorFechaZona = (date, zona)=> rutas.find(r=>r.date===date && (r.zona||"")==(zona||""));

  el.innerHTML = `
    <div class="banner">
      <div class="row">
        <div>
          <b>Rutas/Visitas</b>
          <div class="mini">Genera paradas por prioridad, abre Maps y haz check-in rápido (con pedido opcional), todo offline.</div>
        </div>
        <div class="right flex">
          <button class="btn" id="btnNuevaRuta">+ Nueva ruta</button>
          <button class="btn-primary" id="btnGenerarRuta">Generar sugerida</button>
        </div>
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <h2>Planificador</h2>
        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input id="rutaFecha" type="date" value="${hoy}"
                   data-help="Fecha de la ruta. Te sirve para planificar y mantener historial por día." />
          </div>
          <div>
            <label>Zona (opcional)</label>
            <select id="rutaZona" data-help="Filtra por zona. Útil si tu área está dividida por ciudades/barrios.">
              <option value="">Todas</option>
              ${zonas.map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Nº paradas sugeridas</label>
            <input id="rutaStops" type="number" min="1" max="30" value="8"
                   data-help="Cuántas farmacias quieres en la ruta sugerida (por prioridad)."/>
          </div>
          <div>
            <label>Incluir solo “vencidos” (días ≥ objetivo)</label>
            <select id="rutaOnlyDue" data-help="Si está activado, la ruta solo propone farmacias que ya estarían 'tocando' según su frecuencia.">
              <option value="true">sí</option>
              <option value="false">no</option>
            </select>
          </div>
        </div>

        <div class="helpbox mini" id="rutaHelp">Toca un campo para ver una ayuda rápida.</div>

        <div class="hr"></div>
        <div class="row">
          <div class="pill ok">Activas: ${clientes.filter(c=>c.estado==="activo").length}</div>
          <div class="pill warn">Riesgo: ${k.riesgo.length}</div>
          <div class="pill">Pedidos OK: ${k.nPedidos}</div>
        </div>

        <div class="hr"></div>
        <h2 style="margin-top:0">Top candidatas</h2>
        <div id="candidatos"></div>
      </div>

      <div class="card">
        <div class="row">
          <h2>Ruta del día</h2>
          <div class="right flex">
            <button class="btn" id="btnGuardarRuta">Guardar</button>
            <button class="btn-danger" id="btnBorrarRuta">Borrar</button>
          </div>
        </div>
        <div class="muted">Ordena paradas, abre Maps y registra check-in (con pedido opcional).</div>
        <div class="hr"></div>
        <div id="rutaBox"></div>
      </div>
    </div>
  `;

  (async ()=>{
    const settings = await loadSettings();
    $("#rutaStops").value = Number(settings.routeDefaultStops||8);
    $("#rutaOnlyDue").value = String(!!settings.routeOnlyDue);

    attachHelpToForm($(".card form") || document.body, $("#rutaHelp")); // fallback

    renderCandidatos();
    const r0 = rutaPorFechaZona($("#rutaFecha").value, $("#rutaZona").value) || null;
    renderRutaWithClientId(r0);

    $("#btnNuevaRuta").onclick = ()=>{
      renderRutaWithClientId({id:uid(), date:$("#rutaFecha").value, zona:$("#rutaZona").value, status:"draft", stops:[], createdAt:nowISO()});
      toast("Ruta nueva (borrador)");
    };

    $("#btnGenerarRuta").onclick = ()=>{
      const date = $("#rutaFecha").value || hoy;
      const zona = $("#rutaZona").value || "";
      const n = Number($("#rutaStops").value||8);
      const onlyDue = ($("#rutaOnlyDue").value==="true");
      const candidatos = buildCandidates(zona, onlyDue);

      const selected = candidatos.slice(0,n).map(x=>({
        stopId: uid(),
        clienteId: x.cliente.id,
        done:false,
        note:""
      }));

      const r = { id: uid(), date, zona, status:"draft", createdAt: nowISO(), updatedAt: nowISO(), stops: selected };
      renderRutaWithClientId(r);
      toast("Ruta sugerida generada");
    };

    $("#btnGuardarRuta").onclick = async ()=>{
      const ruta = getCurrentRutaObject();
      if(!ruta) return;
      await dbPut("rutas", ruta);
      toast("Ruta guardada");
    };

    $("#btnBorrarRuta").onclick = async ()=>{
      const ruta = getCurrentRutaObject();
      if(!ruta?.id) return toast("No hay ruta");
      if(!confirm("¿Borrar esta ruta?")) return;
      await dbDel("rutas", ruta.id);
      toast("Ruta borrada");
      renderRutaWithClientId(null);
    };

    $("#rutaFecha").onchange = ()=>{
      const date = $("#rutaFecha").value;
      const found = rutaPorFechaZona(date, $("#rutaZona").value);
      renderRutaWithClientId(found||null);
      renderCandidatos();
    };

    $("#rutaZona").onchange = ()=>{
      renderCandidatos();
      const found = rutaPorFechaZona($("#rutaFecha").value, $("#rutaZona").value);
      renderRutaWithClientId(found||null);
    };

    $("#rutaOnlyDue").onchange = ()=> renderCandidatos();
  })();

  function buildCandidates(zona, onlyDue){
    const stats = k.statsCliente.slice()
      .filter(s=> s.cliente.estado!=="inactivo")
      .filter(s=> zona ? (s.cliente.zona||"")===zona : true)
      .map(s=>({...s, score: scoreClienteForVisit(s), cls: clasePrioridad(s)}))
      .filter(s=> onlyDue ? (s.diasDesdeUltimo >= (s.objetivo||21)) : true)
      .sort((a,b)=> b.score - a.score);
    return stats;
  }

  function renderCandidatos(){
    const zona = $("#rutaZona").value || "";
    const onlyDue = ($("#rutaOnlyDue").value==="true");
    const cand = buildCandidates(zona, onlyDue).slice(0,15);
    const box = $("#candidatos");

    if(!cand.length){
      box.innerHTML = `<div class="muted">No hay candidatas con esos filtros.</div>`;
      return;
    }

    box.innerHTML = `
      ${cand.map(s=>{
        const c = s.cliente;
        const mlink = mapsLinkForAddress(c.direccion||"");
        return `
          <div class="stop">
            <div class="row">
              <div>
                <b>${escapeHtml(c.nombre)}</b> <span class="muted">${escapeHtml(c.apodo||"")}</span><br>
                <span class="mini">${escapeHtml(c.zona||"")} · objetivo ${s.objetivo}d · ${s.diasDesdeUltimo}d desde último</span>
              </div>
              <div class="right">
                <span class="pill ${s.cls}">${s.score} pts</span>
              </div>
            </div>
            <div class="flex" style="margin-top:10px">
              <button class="btn-primary btn-xs" data-act="add" data-id="${c.id}">Añadir a ruta</button>
              <button class="btn btn-xs" data-act="checkin" data-id="${c.id}">Check-in</button>
              ${mlink ? `<a class="btn btn-xs" href="${mlink}" target="_blank" rel="noopener">Abrir en Maps</a>` : ``}
            </div>
          </div>
        `;
      }).join("")}
    `;

    box.onclick = async (e)=>{
      const b = e.target.closest("button");
      if(!b) return;
      const id = b.dataset.id;
      const act = b.dataset.act;
      if(!id) return;

      if(act==="add"){
        addStopToRuta(id);
        toast("Añadida a ruta");
      }
      if(act==="checkin"){
        openCheckin({clienteId:id, stopId:"", date: $("#rutaFecha").value});
      }
    };
  }

  function getCurrentRutaObject(){
    const box = $("#rutaBox");
    const routeId = box.dataset.routeId || uid();
    const date = $("#rutaFecha").value || hoy;
    const zona = $("#rutaZona").value || "";
    const status = box.dataset.routeStatus || "draft";

    const stopEls = $$("#rutaBox .stop");
    const stops = stopEls.map(el=>({
      stopId: el.dataset.stop,
      clienteId: el.dataset.clienteId,
      done: el.classList.contains("done"),
      note: el.querySelector('input[data-role="note"]')?.value || ""
    })).filter(x=>x.clienteId);

    if(!stopEls.length && !box.dataset.routeId) return { id: routeId, date, zona, status, createdAt: nowISO(), updatedAt: nowISO(), stops: [] };

    return { id: routeId, date, zona, status, createdAt: box.dataset.routeCreatedAt || nowISO(), updatedAt: nowISO(), stops };
  }

  function addStopToRuta(clienteId){
    let ruta = getCurrentRutaObject();
    if(!ruta.stops.find(s=>s.clienteId===clienteId)){
      ruta.stops.push({ stopId: uid(), clienteId, done:false, note:"" });
    }
    renderRutaWithClientId(ruta);
  }

  function renderRutaWithClientId(ruta){
    const box = $("#rutaBox");
    if(!ruta){
      box.innerHTML = `<div class="muted">No hay ruta cargada. Genera una sugerida o crea una nueva.</div>`;
      box.dataset.routeId = "";
      return;
    }

    box.dataset.routeId = ruta.id || "";
    box.dataset.routeDate = ruta.date || hoy;
    box.dataset.routeZona = ruta.zona || "";
    box.dataset.routeStatus = ruta.status || "draft";
    box.dataset.routeCreatedAt = ruta.createdAt || nowISO();

    if(!ruta.stops?.length){
      box.innerHTML = `<div class="muted">Ruta vacía. Añade paradas desde “Top candidatas”.</div>`;
      return;
    }

    box.innerHTML = ruta.stops.map((st, idx)=>{
      const c = clientes.find(x=>x.id===st.clienteId);
      const doneClass = st.done ? "done" : "";
      const mlink = mapsLinkForAddress(c?.direccion||"");
      return `
        <div class="stop ${doneClass}" data-stop="${st.stopId}" data-cliente-id="${st.clienteId}">
          <div class="row">
            <div>
              <b>${idx+1}. ${escapeHtml(c?.nombre||"")}</b> <span class="muted">${escapeHtml(c?.apodo||"")}</span><br>
              <span class="mini">${escapeHtml(c?.zona||"")} · ${escapeHtml(c?.direccion||"")}</span>
            </div>
            <div class="right flex">
              <button class="btn btn-xs" data-act="up">↑</button>
              <button class="btn btn-xs" data-act="down">↓</button>
              <button class="btn btn-xs" data-act="done">${st.done ? "Reabrir" : "Hecho"}</button>
              <button class="btn-primary btn-xs" data-act="checkin">Check-in</button>
              ${mlink ? `<a class="btn btn-xs" href="${mlink}" target="_blank" rel="noopener">Maps</a>` : ``}
              <button class="btn-danger btn-xs" data-act="remove">Quitar</button>
            </div>
          </div>

          <label>Nota (solo ruta)</label>
          <input data-role="note" value="${escapeHtml(st.note||"")}" placeholder="Ej: pedir reposición dermo / mostrar promo"
                 data-help="Nota interna de ruta. Se guarda con la ruta del día y no afecta a KPIs." />

          <div class="mini" style="margin-top:6px">
            Contacto: ${escapeHtml(c?.telefono||"")} · ${escapeHtml(c?.email||"")}
          </div>
        </div>
      `;
    }).join("");

    box.onclick = async (e)=>{
      const b = e.target.closest("button");
      if(!b) return;
      const stopEl = e.target.closest(".stop");
      const stopId = stopEl?.dataset?.stop;
      if(!stopId) return;

      const act = b.dataset.act;
      if(act==="up") moveStop(stopId, -1);
      if(act==="down") moveStop(stopId, +1);
      if(act==="remove") removeStop(stopId);
      if(act==="done") toggleDone(stopId);
      if(act==="checkin"){
        const cid = stopEl.dataset.clienteId;
        openCheckin({clienteId:cid, stopId:stopId, date: $("#rutaFecha").value});
      }
    };
  }

  function moveStop(stopId, dir){
    const ruta = getCurrentRutaObject();
    const idx = ruta.stops.findIndex(s=>s.stopId===stopId);
    if(idx<0) return;
    const j = idx + dir;
    if(j<0 || j>=ruta.stops.length) return;
    const tmp = ruta.stops[idx];
    ruta.stops[idx] = ruta.stops[j];
    ruta.stops[j] = tmp;
    renderRutaWithClientId(ruta);
  }
  function removeStop(stopId){
    const ruta = getCurrentRutaObject();
    ruta.stops = ruta.stops.filter(s=>s.stopId!==stopId);
    renderRutaWithClientId(ruta);
  }
  function toggleDone(stopId){
    const ruta = getCurrentRutaObject();
    const s = ruta.stops.find(x=>x.stopId===stopId);
    if(!s) return;
    s.done = !s.done;
    renderRutaWithClientId(ruta);
  }

  /** Check-in (modal) **/
  async function openCheckin({clienteId, stopId, date}){
    // Exponemos una función global para que Predicciones pueda abrir el mismo modal sin duplicar lógica
    window.__openCheckin = async ({clienteId, stopId, date, clientes, productos, pedidos, visitas, rutas})=>{
      await innerOpenCheckin({clienteId, stopId, date, clientes, productos, pedidos, visitas, rutas});
    };
    await innerOpenCheckin({clienteId, stopId, date, clientes, productos, pedidos, visitas, rutas});
  }

  async function innerOpenCheckin({clienteId, stopId, date, clientes, productos, pedidos, visitas, rutas}){
    const c = clientes.find(x=>x.id===clienteId);
    if(!c) return;

    $("#ciTitle").textContent = `Check-in · ${c.nombre}`;
    $("#ciSubtitle").textContent = `${c.apodo||""} · ${c.zona||""}`.trim();

    const dlg = $("#checkinDlg");
    const form = $("#ciForm");
    form.clienteId.value = clienteId;
    form.routeStopId.value = stopId || "";
    form.fecha.value = date || isoDateOnly(new Date());
    form.tipo.value = "visita";
    form.resultado.value = "ok";
    form.proximaAccion.value = "";
    form.notas.value = "";
    form.crearPedido.value = "no";
    form.importeRapido.value = "";

    // help
    attachHelpToForm(form, $("#ciHelp"));
    $("#ciHelp").textContent = "Toca un campo para ver una ayuda rápida.";

    // preparar líneas de pedido
    const lineasBox = $("#ciLineas");
    lineasBox.innerHTML = "";
    $("#ciPedidoBox").style.display = "none";
    $("#ciTotalPedido").textContent = "Total: 0,00 €";

    const prods = productos.filter(p=>p.activo!==false).sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""));
    const productoOpts = prods.map(p=>`<option value="${p.id}" data-precio="${p.precio||0}">${escapeHtml(p.nombre)} (${fmtEur(p.precio||0)})</option>`).join("");

    function makeLinea(linea){
      const row = document.createElement("div");
      row.className="card";
      row.style.margin="10px 0";
      row.dataset.id = linea?.id || uid();
      row.innerHTML = `
        <div class="grid two">
          <div>
            <label>Producto</label>
            <select name="productoId" required data-help="Selecciona el producto del laboratorio para este pedido.">
              <option value="" disabled selected>Selecciona...</option>
              ${productoOpts}
            </select>
          </div>
          <div class="grid two">
            <div>
              <label>Cantidad</label>
              <input name="cantidad" type="number" min="0" step="0.01" value="${linea?.cantidad ?? 1}"
                     placeholder="Ej: 3"
                     data-help="Cantidad pedida. Puedes usar decimales si vendes en packs fraccionables." />
            </div>
            <div>
              <label>Precio unit.</label>
              <input name="precioUnit" type="number" min="0" step="0.01" value="${linea?.precioUnit ?? 0}"
                     placeholder="Se autocompleta al elegir producto"
                     data-help="Precio unitario aplicado en este pedido. Se guarda 'congelado' aunque cambie el precio del catálogo." />
            </div>
          </div>
        </div>
        <div class="grid two">
          <div>
            <label>Descuento %</label>
            <input name="descuentoPct" type="number" min="0" step="0.01" value="${linea?.descuentoPct ?? 0}"
                   placeholder="Ej: 5"
                   data-help="Descuento aplicado a esta línea. Se calcula en el total." />
          </div>
          <div class="row" style="justify-content:space-between;align-items:flex-end;">
            <div class="pill" data-role="lineTotal">Línea: 0,00 €</div>
            <button type="button" class="btn-danger btn-xs" data-act="remove">Quitar</button>
          </div>
        </div>
      `;
      const sel = row.querySelector('select[name="productoId"]');
      if(linea?.productoId) sel.value = linea.productoId;

      sel.onchange = ()=>{
        const opt = sel.selectedOptions[0];
        const pr = Number(opt?.dataset?.precio||0);
        row.querySelector('input[name="precioUnit"]').value = pr;
        updateTotal();
      };
      row.oninput = ()=>updateTotal();
      row.onclick = (e)=>{
        const b = e.target.closest("button");
        if(b?.dataset?.act==="remove"){ row.remove(); updateTotal(); }
      };
      return row;
    }

    function readLineas(){
      const arr = [];
      $$("#ciLineas > div.card").forEach(row=>{
        const productoId = row.querySelector('select[name="productoId"]').value;
        if(!productoId) return;
        const prod = productos.find(p=>p.id===productoId);
        const cantidad = Number(row.querySelector('input[name="cantidad"]').value||0);
        const precioUnit = Number(row.querySelector('input[name="precioUnit"]').value||0);
        const descuentoPct = Number(row.querySelector('input[name="descuentoPct"]').value||0);
        const l = {id: row.dataset.id, productoId, nombre: prod?.nombre||"", cantidad, precioUnit, descuentoPct, total:0};
        l.total = lineTotal(l);
        arr.push(l);
      });
      return arr;
    }

    function updateTotal(){
      const lineas = readLineas();
      $$("#ciLineas > div.card").forEach(row=>{
        const productoId = row.querySelector('select[name="productoId"]').value;
        if(!productoId) return;
        const cantidad = Number(row.querySelector('input[name="cantidad"]').value||0);
        const precioUnit = Number(row.querySelector('input[name="precioUnit"]').value||0);
        const descuentoPct = Number(row.querySelector('input[name="descuentoPct"]').value||0);
        const t = lineTotal({cantidad, precioUnit, descuentoPct});
        row.querySelector('[data-role="lineTotal"]').textContent = "Línea: " + fmtEur(t);
      });
      const total = lineas.reduce((a,l)=>a+Number(l.total||0),0);
      $("#ciTotalPedido").textContent = "Total: " + fmtEur(total);
    }

    $("#ciAddLinea").onclick = ()=>{
      lineasBox.appendChild(makeLinea());
      updateTotal();
    };

    form.crearPedido.onchange = ()=>{
      const show = form.crearPedido.value === "si";
      $("#ciPedidoBox").style.display = show ? "" : "none";
      if(show && !lineasBox.children.length){
        lineasBox.appendChild(makeLinea());
        updateTotal();
      }
    };

    $("#ciOnlyVisit").onclick = ()=>{
      form.crearPedido.value = "no";
      $("#ciPedidoBox").style.display = "none";
      toast("Pedido desactivado para este check-in");
    };

    $("#ciClose").onclick = ()=> dlg.close();

    form.onsubmit = async (ev)=>{
      ev.preventDefault();
      const fechaISO = fromDateOnly(form.fecha.value);
      const tipo = form.tipo.value;
      const resultado = form.resultado.value;
      const notas = form.notas.value.trim();
      const proximaAccion = form.proximaAccion.value.trim();
      const importeRapido = Number(form.importeRapido.value||0);

      // 1) interacción
      const visita = {
        id: uid(),
        clienteId,
        fecha: fechaISO,
        tipo,
        resultado,
        notas,
        proximaAccion,
        importeRapido: importeRapido || 0,
        creadoEn: nowISO(),
        actualizadoEn: nowISO()
      };
      await dbPut("visitas", visita);

      // 2) pedido opcional
      let createdOrderId = "";
      if(form.crearPedido.value === "si"){
        const lineas = readLineas();
        if(!lineas.length){
          toast("Añade al menos una línea de pedido");
          return;
        }
        const pedido = {
          id: uid(),
          clienteId,
          fecha: fechaISO,
          fechaEntrega: "",
          estado: form.estadoPedido.value,
          canal: form.canalPedido.value,
          comercial: "delegada",
          notas: notas ? `Check-in: ${notas}` : "Pedido creado desde check-in",
          lineas,
          total: 0,
          creadoEn: nowISO(),
          actualizadoEn: nowISO()
        };
        recomputePedido(pedido);
        await dbPut("pedidos", pedido);
        createdOrderId = pedido.id;
      }

      // 3) si viene de ruta, marcar done + anotar
      if(stopId){
        // buscamos ruta actual por DOM
        const box = $("#rutaBox");
        const routeId = box?.dataset?.routeId;
        if(routeId){
          const rutaObj = await dbGet("rutas", routeId) || null;
          if(rutaObj?.stops){
            const st = rutaObj.stops.find(s=>s.stopId===stopId);
            if(st){
              st.done = true;
              const extra = [];
              extra.push(`CI: ${tipo}/${resultado}`);
              if(createdOrderId) extra.push(`Pedido: ${createdOrderId.slice(0,6)}…`);
              if(proximaAccion) extra.push(`Próx: ${proximaAccion}`);
              if(extra.length) st.note = (st.note ? st.note + " | " : "") + extra.join(" · ");
              rutaObj.updatedAt = nowISO();
              await dbPut("rutas", rutaObj);
            }
          }
        }
      }

      dlg.close();
      toast(createdOrderId ? "Check-in + pedido guardados" : "Check-in guardado");
      render();
    };

    dlg.showModal();
  }
}

/** =========================
 *  CLIENTES (Farmacias) · Empresa eliminado
 *  ========================= */
function renderClientes(el, clientes){
  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>${STATE.editing?.type==="cliente" ? "Editar farmacia" : "Nueva farmacia"}</h2>
        <form id="fCliente">
          <input type="hidden" name="id" value="${STATE.editing?.type==="cliente" ? STATE.editing.id : ""}">

          <label>Nombre de farmacia</label>
          <input name="nombre" required placeholder="Ej: Farmacia Plaza"
                 data-help="Nombre oficial o como la identificas en tu ruta. Aparece en rutas, pedidos y predicciones." />

          <label>Apodo (opcional)</label>
          <input name="apodo" placeholder="Ej: Plaza / Centro"
                 data-help="Alias corto para identificarla rápido. Útil si hay nombres parecidos." />

          <label>Zona (para rutas)</label>
          <input name="zona" placeholder="Ej: Pontevedra Centro / Vigo / Sanxenxo"
                 data-help="Zona para agrupar rutas. Te permite generar rutas por ciudad/barrio." />

          <label>Dirección (para Maps)</label>
          <input name="direccion" placeholder="Ej: Calle + número + ciudad"
                 data-help="Se usa para 'Abrir en Maps'. Cuanto más completa, mejor navegación." />

          <div class="grid two">
            <div>
              <label>Teléfono (opcional)</label>
              <input name="telefono" placeholder="Ej: 986xxxxxx"
                     data-help="Contacto principal. Útil para llamadas rápidas." />
            </div>
            <div>
              <label>Email (opcional)</label>
              <input name="email" placeholder="Ej: farmacia@..."
                     data-help="Correo para envíos de info/promos y seguimiento." />
            </div>
          </div>

          <label>Estado</label>
          <select name="estado" data-help="Activo: compra. Potencial: objetivo a captar. Inactivo: fuera de ruta.">
            <option value="activo">activo</option>
            <option value="potencial">potencial</option>
            <option value="inactivo">inactivo</option>
          </select>

          <label>Frecuencia objetivo (días)</label>
          <input name="frecuenciaObjetivoDias" type="number" min="0" placeholder="Ej: 21"
                 data-help="Cada cuántos días suele/quieres que haga pedido. Alimenta rutas y predicciones." />

          <label>Etiquetas (separadas por coma)</label>
          <input name="etiquetas" placeholder="Ej: alto potencial, dermo, promo"
                 data-help="Etiquetas rápidas para segmentar (dermo, pediatría, alto potencial, etc.)." />

          <label>Notas (opcional)</label>
          <textarea name="notas" placeholder="Preferencias, objeciones, competencia..."
                    data-help="Información útil para vender mejor: objeciones, gustos, acuerdos, competencia, etc."></textarea>

          <div class="helpbox mini" id="cliHelp">Toca un campo para ver una ayuda rápida.</div>

          <div class="flex">
            <button class="btn-primary" type="submit">Guardar</button>
            <button class="btn" type="button" id="cancelCliente">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="row">
          <h2>Farmacias (${clientes.length})</h2>
          <div class="right">
            <input id="qClientes" placeholder="Buscar..." style="min-width:220px"
                   data-help="Busca por nombre, apodo, zona, etiquetas o notas." />
          </div>
        </div>
        <div class="muted">Dirección = botón Maps. Frecuencia objetivo = predicciones y rutas.</div>
        <div class="hr"></div>
        <div style="overflow:auto">
          <table id="tClientes">
            <thead><tr><th>Farmacia</th><th>Zona</th><th>Estado</th><th>Maps</th><th></th></tr></thead>
            <tbody>
              ${clientes
                .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
                .map(c=>{
                  const m = mapsLinkForAddress(c.direccion||"");
                  return `
                  <tr data-id="${c.id}">
                    <td>
                      ${escapeHtml(c.nombre)} <span class="muted">${escapeHtml(c.apodo||"")}</span><br>
                      <span class="mini">${escapeHtml((c.etiquetas||[]).join(", "))}</span>
                    </td>
                    <td>${escapeHtml(c.zona||"")}</td>
                    <td><span class="pill ${c.estado==="activo"?"ok":(c.estado==="potencial"?"warn":"bad")}">${escapeHtml(c.estado||"")}</span></td>
                    <td>${m? `<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>`:"—"}</td>
                    <td class="right">
                      <button data-act="edit">Editar</button>
                      <button class="btn-danger" data-act="del">Borrar</button>
                    </td>
                  </tr>`;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const form = $("#fCliente");
  attachHelpToForm(form, $("#cliHelp"));

  if(STATE.editing?.type==="cliente"){
    const c = clientes.find(x=>x.id===STATE.editing.id);
    if(c){
      form.nombre.value = c.nombre||"";
      form.apodo.value = c.apodo||"";
      form.zona.value = c.zona||"";
      form.direccion.value = c.direccion||"";
      form.telefono.value = c.telefono||"";
      form.email.value = c.email||"";
      form.estado.value = c.estado||"activo";
      form.frecuenciaObjetivoDias.value = c.frecuenciaObjetivoDias||"";
      form.etiquetas.value = (c.etiquetas||[]).join(", ");
      form.notas.value = c.notas||"";
      form.id.value = c.id;
    }
  }

  $("#cancelCliente").onclick = ()=>{ STATE.editing=null; render(); };

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const id = form.id.value || uid();
    const prev = clientes.find(x=>x.id===id);
    const obj = {
      id,
      nombre: form.nombre.value.trim(),
      apodo: form.apodo.value.trim(),
      zona: form.zona.value.trim(),
      direccion: form.direccion.value.trim(),
      telefono: form.telefono.value.trim(),
      email: form.email.value.trim(),
      estado: form.estado.value,
      frecuenciaObjetivoDias: Number(form.frecuenciaObjetivoDias.value||0),
      etiquetas: form.etiquetas.value.split(",").map(s=>s.trim()).filter(Boolean),
      notas: form.notas.value.trim(),
      creadoEn: prev?.creadoEn || nowISO(),
      actualizadoEn: nowISO()
    };
    await dbPut("clientes", obj);
    toast("Farmacia guardada");
    STATE.editing=null;
    render();
  };

  $("#tClientes").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if(!id) return;
    const act = btn.dataset.act;
    if(act==="edit"){ STATE.editing={type:"cliente", id}; render(); }
    if(act==="del"){
      if(confirm("¿Borrar farmacia? (no borra pedidos existentes)")){
        await dbDel("clientes", id);
        toast("Farmacia borrada");
        render();
      }
    }
  };

  $("#qClientes").oninput = ()=>{
    const q = $("#qClientes").value.trim().toLowerCase();
    $$("#tClientes tbody tr").forEach(tr=>{
      const txt = tr.textContent.toLowerCase();
      tr.style.display = txt.includes(q) ? "" : "none";
    });
  };
}

/** =========================
 *  PRODUCTOS (campos eliminados)
 *  ========================= */
function renderProductos(el, productos){
  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>${STATE.editing?.type==="producto" ? "Editar producto" : "Nuevo producto"}</h2>
        <form id="fProducto">
          <input type="hidden" name="id" value="${STATE.editing?.type==="producto" ? STATE.editing.id : ""}">
          <label>Nombre</label>
          <input name="nombre" required placeholder="Ej: Crema Dermoprotectora 50ml"
                 data-help="Nombre comercial del producto del laboratorio. Es lo que aparecerá en pedidos y reportes." />
          <label>Descripción (opcional)</label>
          <textarea name="descripcion" placeholder="Beneficios, formato, rotación..."
                    data-help="Notas del producto para ti: beneficios, formato, rotación, recomendación, etc."></textarea>
          <label>Precio</label>
          <input name="precio" type="number" step="0.01" min="0" placeholder="Ej: 18.90"
                 data-help="Precio de referencia. En pedidos se puede ajustar y se guarda el precio usado en ese pedido." />
          <label>Activo</label>
          <select name="activo" data-help="Si lo desactivas, no se sugiere en nuevos pedidos, pero se mantiene en históricos.">
            <option value="true">sí</option>
            <option value="false">no</option>
          </select>

          <div class="helpbox mini" id="prodHelp">Toca un campo para ver una ayuda rápida.</div>

          <div class="flex">
            <button class="btn-primary" type="submit">Guardar</button>
            <button class="btn" type="button" id="cancelProducto">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="row">
          <h2>Productos (${productos.length})</h2>
          <div class="right">
            <input id="qProductos" placeholder="Buscar..." style="min-width:220px"
                   data-help="Busca por nombre o descripción." />
          </div>
        </div>
        <div class="hr"></div>
        <div style="overflow:auto">
          <table id="tProductos">
            <thead><tr><th>Producto</th><th>Precio</th><th></th></tr></thead>
            <tbody>
              ${productos
                .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
                .map(p=>`
                <tr data-id="${p.id}">
                  <td>
                    ${escapeHtml(p.nombre)} ${p.activo?``:`<span class="pill bad">inactivo</span>`}<br>
                    <span class="mini">${escapeHtml(p.descripcion||"")}</span>
                  </td>
                  <td>${fmtEur(p.precio||0)}</td>
                  <td class="right">
                    <button data-act="edit">Editar</button>
                    <button class="btn-danger" data-act="del">Borrar</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const form = $("#fProducto");
  attachHelpToForm(form, $("#prodHelp"));

  if(STATE.editing?.type==="producto"){
    const p = productos.find(x=>x.id===STATE.editing.id);
    if(p){
      form.id.value=p.id;
      form.nombre.value=p.nombre||"";
      form.descripcion.value=p.descripcion||"";
      form.precio.value=p.precio??"";
      form.activo.value=String(!!p.activo);
    }
  }

  $("#cancelProducto").onclick = ()=>{ STATE.editing=null; render(); };

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const id = form.id.value || uid();
    const prev = productos.find(x=>x.id===id);
    const obj = {
      id,
      nombre: form.nombre.value.trim(),
      descripcion: form.descripcion.value.trim(),
      precio: Number(form.precio.value||0),
      activo: form.activo.value==="true",
      creadoEn: prev?.creadoEn || nowISO(),
      actualizadoEn: nowISO()
    };
    await dbPut("productos", obj);
    toast("Producto guardado");
    STATE.editing=null;
    render();
  };

  $("#tProductos").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if(!id) return;
    const act = btn.dataset.act;
    if(act==="edit"){ STATE.editing={type:"producto", id}; render(); }
    if(act==="del"){
      if(confirm("¿Borrar producto?")){
        await dbDel("productos", id);
        toast("Producto borrado");
        render();
      }
    }
  };

  $("#qProductos").oninput = ()=>{
    const q = $("#qProductos").value.trim().toLowerCase();
    $$("#tProductos tbody tr").forEach(tr=>{
      const txt = tr.textContent.toLowerCase();
      tr.style.display = txt.includes(q) ? "" : "none";
    });
  };
}

/** =========================
 *  PEDIDOS (sin cambios grandes, pero help)
 *  ========================= */
function renderPedidos(el, clientes, productos, pedidos){
  const clienteOpts = clientes
    .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
    .map(c=>`<option value="${c.id}">${escapeHtml(c.nombre)}${c.apodo? " · " + escapeHtml(c.apodo):""}</option>`).join("");

  const prodsActivos = productos.filter(p=>p.activo!==false)
    .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""));
  const productoOpts = prodsActivos
    .map(p=>`<option value="${p.id}" data-precio="${p.precio||0}">${escapeHtml(p.nombre)} (${fmtEur(p.precio||0)})</option>`).join("");

  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>${STATE.editing?.type==="pedido" ? "Editar pedido" : "Nuevo pedido"}</h2>
        <form id="fPedido">
          <input type="hidden" name="id" value="${STATE.editing?.type==="pedido" ? STATE.editing.id : ""}">

          <label>Farmacia</label>
          <select name="clienteId" required data-help="Selecciona la farmacia a la que corresponde el pedido.">
            <option value="" disabled selected>Selecciona...</option>
            ${clienteOpts}
          </select>

          <div class="grid two">
            <div>
              <label>Fecha pedido</label>
              <input name="fecha" type="date" required data-help="Fecha del pedido. Se usa para KPIs y objetivo trimestral.">
            </div>
            <div>
              <label>Fecha entrega (opcional)</label>
              <input name="fechaEntrega" type="date" data-help="Si quieres registrar entrega. Útil para control, no obligatorio.">
            </div>
          </div>

          <div class="grid two">
            <div>
              <label>Estado</label>
              <select name="estado" data-help="Borrador/confirmado/entregado/cancelado. KPIs cuentan confirmado+entregado.">
                <option value="borrador">borrador</option>
                <option value="confirmado">confirmado</option>
                <option value="entregado">entregado</option>
                <option value="cancelado">cancelado</option>
              </select>
            </div>
            <div>
              <label>Canal</label>
              <select name="canal" data-help="Canal por el que se cerró. Sirve para analizar conversiones.">
                <option value="visita">visita</option>
                <option value="telefono">teléfono</option>
                <option value="whatsapp">whatsapp</option>
                <option value="email">email</option>
                <option value="otro">otro</option>
              </select>
            </div>
          </div>

          <label>Notas (opcional)</label>
          <textarea name="notas" placeholder="Promo, condiciones, observaciones..."
                    data-help="Detalles del pedido: promos, acuerdos, condiciones, comentarios de la farmacia."></textarea>

          <div class="helpbox mini" id="pedHelp">Toca un campo para ver una ayuda rápida.</div>

          <div class="hr"></div>
          <div class="row">
            <h2 style="margin:0">Líneas</h2>
            <button type="button" id="addLinea" class="btn-primary">+ Añadir línea</button>
          </div>
          <div id="lineas"></div>

          <div class="hr"></div>
          <div class="row">
            <div class="pill" id="totalPedido">Total: ${fmtEur(0)}</div>
            <div class="right flex">
              <button class="btn-primary" type="submit">Guardar</button>
              <button class="btn" type="button" id="cancelPedido">Cancelar</button>
            </div>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="row">
          <h2>Pedidos (${pedidos.length})</h2>
          <div class="right">
            <input id="qPedidos" placeholder="Buscar..." style="min-width:220px">
          </div>
        </div>
        <div class="hr"></div>
        <div style="overflow:auto">
          <table id="tPedidos">
            <thead><tr><th>Fecha</th><th>Farmacia</th><th>Estado</th><th>Total</th><th></th></tr></thead>
            <tbody>
              ${pedidos
                .slice()
                .sort((a,b)=> new Date(b.fecha)-new Date(a.fecha))
                .map(p=>{
                  const c = clientes.find(x=>x.id===p.clienteId);
                  const cls = p.estado==="entregado" ? "ok" : (p.estado==="confirmado"?"warn":(p.estado==="cancelado"?"bad":""));
                  return `<tr data-id="${p.id}">
                    <td>${fmtDate(p.fecha)}</td>
                    <td>${escapeHtml(c?.nombre||"")}</td>
                    <td><span class="pill ${cls}">${escapeHtml(p.estado||"")}</span></td>
                    <td>${fmtEur(p.total||0)}</td>
                    <td class="right">
                      <button data-act="edit">Editar</button>
                      <button class="btn-danger" data-act="del">Borrar</button>
                    </td>
                  </tr>`;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const form = $("#fPedido");
  attachHelpToForm(form, $("#pedHelp"));

  const lineasEl = $("#lineas");
  const totalEl = $("#totalPedido");

  function makeLineaRow(linea){
    const id = linea?.id || uid();
    const productoId = linea?.productoId || "";
    const cantidad = linea?.cantidad ?? 1;
    const precioUnit = linea?.precioUnit ?? 0;
    const descuentoPct = linea?.descuentoPct ?? 0;

    const row = document.createElement("div");
    row.className="card";
    row.style.margin="10px 0";
    row.dataset.id=id;
    row.innerHTML = `
      <div class="grid two">
        <div>
          <label>Producto</label>
          <select name="productoId" required data-help="Selecciona el producto del laboratorio.">
            <option value="" disabled ${productoId? "":"selected"}>Selecciona...</option>
            ${productoOpts}
          </select>
        </div>
        <div class="grid two">
          <div>
            <label>Cantidad</label>
            <input name="cantidad" type="number" min="0" step="0.01" value="${cantidad}"
                   placeholder="Ej: 2"
                   data-help="Cantidad pedida en esta línea." />
          </div>
          <div>
            <label>Precio unit.</label>
            <input name="precioUnit" type="number" min="0" step="0.01" value="${precioUnit}"
                   placeholder="Se autocompleta al elegir producto"
                   data-help="Precio unitario aplicado. Se guarda en el pedido y no cambia después." />
          </div>
        </div>
      </div>
      <div class="grid two">
        <div>
          <label>Descuento %</label>
          <input name="descuentoPct" type="number" min="0" step="0.01" value="${descuentoPct}"
                 placeholder="Ej: 5"
                 data-help="Descuento aplicado a la línea (porcentaje)." />
        </div>
        <div class="row" style="justify-content:space-between;align-items:flex-end;">
          <div class="pill" data-role="lineTotal">Línea: ${fmtEur(0)}</div>
          <button type="button" class="btn-danger" data-act="remove">Quitar</button>
        </div>
      </div>
    `;

    const sel = row.querySelector('select[name="productoId"]');
    if(productoId) sel.value = productoId;

    sel.onchange = ()=>{
      const opt = sel.selectedOptions[0];
      const pr = Number(opt?.dataset?.precio||0);
      row.querySelector('input[name="precioUnit"]').value = pr;
      updateTotals();
    };
    row.oninput = ()=>updateTotals();
    row.onclick = (e)=>{
      const b = e.target.closest("button");
      if(b?.dataset?.act==="remove"){ row.remove(); updateTotals(); }
    };
    return row;
  }

  function readLineas(){
    const arr = [];
    $$("#lineas > div.card").forEach(row=>{
      const productoId = row.querySelector('select[name="productoId"]').value;
      const prod = productos.find(p=>p.id===productoId);
      const cantidad = Number(row.querySelector('input[name="cantidad"]').value||0);
      const precioUnit = Number(row.querySelector('input[name="precioUnit"]').value||0);
      const descuentoPct = Number(row.querySelector('input[name="descuentoPct"]').value||0);
      const l = {id: row.dataset.id, productoId, nombre: prod?.nombre||"", cantidad, precioUnit, descuentoPct, total:0};
      l.total = lineTotal(l);
      arr.push(l);
    });
    return arr.filter(l=>l.productoId);
  }

  function updateTotals(){
    const lineas = readLineas();
    $$("#lineas > div.card").forEach(row=>{
      const productoId = row.querySelector('select[name="productoId"]').value;
      if(!productoId) return;
      const cantidad = Number(row.querySelector('input[name="cantidad"]').value||0);
      const precioUnit = Number(row.querySelector('input[name="precioUnit"]').value||0);
      const descuentoPct = Number(row.querySelector('input[name="descuentoPct"]').value||0);
      const t = lineTotal({cantidad, precioUnit, descuentoPct});
      row.querySelector('[data-role="lineTotal"]').textContent = "Línea: " + fmtEur(t);
    });
    const total = lineas.reduce((a,l)=>a+Number(l.total||0),0);
    totalEl.textContent = "Total: " + fmtEur(total);
  }

  $("#addLinea").onclick = ()=>{
    lineasEl.appendChild(makeLineaRow());
    updateTotals();
  };

  $("#cancelPedido").onclick = ()=>{ STATE.editing=null; render(); };

  form.fecha.value = isoDateOnly(new Date());
  form.estado.value = "borrador";
  form.canal.value = "visita";

  if(STATE.editing?.type==="pedido"){
    const p = pedidos.find(x=>x.id===STATE.editing.id);
    if(p){
      form.id.value = p.id;
      form.clienteId.value = p.clienteId;
      form.fecha.value = p.fecha ? new Date(p.fecha).toISOString().slice(0,10) : isoDateOnly(new Date());
      form.fechaEntrega.value = p.fechaEntrega ? new Date(p.fechaEntrega).toISOString().slice(0,10) : "";
      form.estado.value = p.estado || "borrador";
      form.canal.value = p.canal || "visita";
      form.notas.value = p.notas || "";
      lineasEl.innerHTML = "";
      (p.lineas||[]).forEach(l=> lineasEl.appendChild(makeLineaRow(l)));
      if((p.lineas||[]).length===0) lineasEl.appendChild(makeLineaRow());
      updateTotals();
    }
  } else {
    lineasEl.appendChild(makeLineaRow());
    updateTotals();
  }

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const id = form.id.value || uid();
    const prev = pedidos.find(x=>x.id===id);
    const obj = {
      id,
      clienteId: form.clienteId.value,
      fecha: fromDateOnly(form.fecha.value),
      fechaEntrega: form.fechaEntrega.value ? fromDateOnly(form.fechaEntrega.value) : "",
      estado: form.estado.value,
      canal: form.canal.value,
      comercial: "delegada",
      notas: form.notas.value.trim(),
      lineas: readLineas(),
      total: 0,
      creadoEn: prev?.creadoEn || nowISO(),
      actualizadoEn: nowISO()
    };
    recomputePedido(obj);
    await dbPut("pedidos", obj);
    toast("Pedido guardado");
    STATE.editing=null;
    render();
  };

  $("#tPedidos").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if(!id) return;
    const act = btn.dataset.act;
    if(act==="edit"){ STATE.editing={type:"pedido", id}; render(); }
    if(act==="del"){
      if(confirm("¿Borrar pedido?")){
        await dbDel("pedidos", id);
        toast("Pedido borrado");
        render();
      }
    }
  };

  $("#qPedidos").oninput = ()=>{
    const q = $("#qPedidos").value.trim().toLowerCase();
    $$("#tPedidos tbody tr").forEach(tr=>{
      const txt = tr.textContent.toLowerCase();
      tr.style.display = txt.includes(q) ? "" : "none";
    });
  };
}

/** =========================
 *  VISITAS (help)
 *  ========================= */
function renderVisitas(el, clientes, visitas){
  const clienteOpts = clientes
    .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
    .map(c=>`<option value="${c.id}">${escapeHtml(c.nombre)}${c.apodo? " · " + escapeHtml(c.apodo):""}</option>`).join("");

  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>${STATE.editing?.type==="visita" ? "Editar interacción" : "Nueva interacción"}</h2>
        <form id="fVisita">
          <input type="hidden" name="id" value="${STATE.editing?.type==="visita" ? STATE.editing.id : ""}">

          <label>Farmacia</label>
          <select name="clienteId" required data-help="Selecciona la farmacia para esta interacción.">
            <option value="" disabled selected>Selecciona...</option>
            ${clienteOpts}
          </select>

          <div class="grid two">
            <div>
              <label>Fecha</label>
              <input name="fecha" type="date" required data-help="Fecha del contacto para historial y planificación.">
            </div>
            <div>
              <label>Tipo</label>
              <select name="tipo" data-help="Tipo de interacción (visita, llamada, WhatsApp, email).">
                <option value="visita">visita</option>
                <option value="llamada">llamada</option>
                <option value="whatsapp">whatsapp</option>
                <option value="email">email</option>
              </select>
            </div>
          </div>

          <label>Resultado</label>
          <select name="resultado" data-help="Resultado del contacto. Si queda pendiente, usa 'pendiente' + próxima acción.">
            <option value="ok">ok</option>
            <option value="pendiente">pendiente</option>
            <option value="sin_respuesta">sin respuesta</option>
          </select>

          <label>Próxima acción (opcional)</label>
          <input name="proximaAccion" placeholder="Ej: enviar promo / llamar el martes"
                 data-help="Acción pendiente. Aparece en Predicciones para tu lista de tareas." />

          <label>Notas</label>
          <textarea name="notas" placeholder="Qué se habló, objeciones, acuerdos..."
                    data-help="Notas útiles para venta y seguimiento."></textarea>

          <label>Importe rápido (opcional)</label>
          <input name="importeRapido" type="number" step="0.01" min="0" placeholder="Ej: 200"
                 data-help="Importe estimado si no registras un pedido real. Útil para notas, pero no cuenta como pedido." />

          <div class="helpbox mini" id="visHelp">Toca un campo para ver una ayuda rápida.</div>

          <div class="flex">
            <button class="btn-primary" type="submit">Guardar</button>
            <button class="btn" type="button" id="cancelVisita">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="row">
          <h2>Interacciones (${visitas.length})</h2>
          <div class="right">
            <input id="qVisitas" placeholder="Buscar..." style="min-width:220px">
          </div>
        </div>
        <div class="hr"></div>
        <div style="overflow:auto">
          <table id="tVisitas">
            <thead><tr><th>Fecha</th><th>Farmacia</th><th>Tipo</th><th>Resultado</th><th>Próx</th><th></th></tr></thead>
            <tbody>
              ${visitas
                .slice()
                .sort((a,b)=> new Date(b.fecha)-new Date(a.fecha))
                .map(v=>{
                  const c = clientes.find(x=>x.id===v.clienteId);
                  const cls = v.resultado==="ok" ? "ok" : (v.resultado==="pendiente"?"warn":"bad");
                  return `<tr data-id="${v.id}">
                    <td>${fmtDate(v.fecha)}</td>
                    <td>${escapeHtml(c?.nombre||"")}</td>
                    <td>${escapeHtml(v.tipo||"")}</td>
                    <td><span class="pill ${cls}">${escapeHtml(v.resultado||"")}</span></td>
                    <td>${escapeHtml(v.proximaAccion||"")}</td>
                    <td class="right">
                      <button data-act="edit">Editar</button>
                      <button class="btn-danger" data-act="del">Borrar</button>
                    </td>
                  </tr>`;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const form = $("#fVisita");
  attachHelpToForm(form, $("#visHelp"));

  form.fecha.value = isoDateOnly(new Date());
  form.tipo.value = "visita";
  form.resultado.value = "ok";

  if(STATE.editing?.type==="visita"){
    const v = visitas.find(x=>x.id===STATE.editing.id);
    if(v){
      form.id.value=v.id;
      form.clienteId.value=v.clienteId;
      form.fecha.value = v.fecha ? new Date(v.fecha).toISOString().slice(0,10) : isoDateOnly(new Date());
      form.tipo.value=v.tipo||"visita";
      form.resultado.value=v.resultado||"ok";
      form.notas.value=v.notas||"";
      form.proximaAccion.value=v.proximaAccion||"";
      form.importeRapido.value=v.importeRapido||"";
    }
  }

  $("#cancelVisita").onclick = ()=>{ STATE.editing=null; render(); };

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const id = form.id.value || uid();
    const prev = visitas.find(x=>x.id===id);
    const obj = {
      id,
      clienteId: form.clienteId.value,
      fecha: fromDateOnly(form.fecha.value),
      tipo: form.tipo.value,
      resultado: form.resultado.value,
      notas: form.notas.value.trim(),
      proximaAccion: form.proximaAccion.value.trim(),
      importeRapido: Number(form.importeRapido.value||0),
      creadoEn: prev?.creadoEn || nowISO(),
      actualizadoEn: nowISO()
    };
    await dbPut("visitas", obj);
    toast("Interacción guardada");
    STATE.editing=null;
    render();
  };

  $("#tVisitas").onclick = async (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if(!id) return;
    const act = btn.dataset.act;
    if(act==="edit"){ STATE.editing={type:"visita", id}; render(); }
    if(act==="del"){
      if(confirm("¿Borrar interacción?")){
        await dbDel("visitas", id);
        toast("Interacción borrada");
        render();
      }
    }
  };

  $("#qVisitas").oninput = ()=>{
    const q = $("#qVisitas").value.trim().toLowerCase();
    $$("#tVisitas tbody tr").forEach(tr=>{
      const txt = tr.textContent.toLowerCase();
      tr.style.display = txt.includes(q) ? "" : "none";
    });
  };
}

/** =========================
 *  BACKUP (incluye settings)
 *  ========================= */
async function renderBackup(el){
  const backups = (await dbAll("backups")).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  const lastSnap = await dbGet("meta","lastSnapshotAt");
  const ready = await dbGet("meta","latestBackupReady");

  el.innerHTML = `
    ${ready?.value ? `
      <div class="banner">
        <div class="row">
          <div>
            <b>Backup automático listo</b>
            <div class="mini">Se creó un snapshot local y está listo para descargar cuando quieras.</div>
          </div>
          <div class="right">
            <button class="btn-primary" id="dlLatest">Descargar último</button>
          </div>
        </div>
      </div>
    ` : ""}

    <div class="grid two">
      <div class="card">
        <h2>Acciones</h2>
        <div class="muted">Exporta a JSON para guardarlo fuera (Drive/iCloud/PC) o restaura desde un JSON.</div>
        <div class="hr"></div>
        <div class="flex">
          <button class="btn-primary" id="btnExportAll">Exportar TODO ahora</button>
          <button class="btn" id="btnSnap">Crear snapshot local</button>
        </div>
        <div class="hr"></div>
        <div class="muted">Último snapshot: <b>${lastSnap?.value ? fmtDateTime(lastSnap.value) : "—"}</b></div>
      </div>

      <div class="card">
        <h2>Importar (restaurar)</h2>
        <div class="muted">Carga un JSON exportado previamente. Ojo: reemplaza los datos actuales.</div>
        <div class="hr"></div>
        <input type="file" id="fileImport" accept="application/json">
        <div class="flex" style="margin-top:10px">
          <button class="btn-primary" id="btnImport">Importar</button>
          <button class="btn-danger" id="btnWipe">Borrar TODO</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <h2>Snapshots locales (${backups.length})</h2>
        <div class="right muted">Se guardan en el dispositivo. Puedes descargarlos o borrarlos.</div>
      </div>
      <div class="hr"></div>
      ${backups.length ? `
        <table id="tBackups">
          <thead><tr><th>Fecha</th><th>Motivo</th><th></th></tr></thead>
          <tbody>
            ${backups.map(b=>`
              <tr data-id="${b.id}">
                <td>${fmtDateTime(b.createdAt)}</td>
                <td>${escapeHtml(b.reason||"")}</td>
                <td class="right">
                  <button data-act="dl">Descargar</button>
                  <button class="btn-danger" data-act="del">Borrar</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="muted">Aún no hay snapshots. Crea uno o espera al auto-backup.</div>`}
    </div>
  `;

  async function downloadPayload(payload, filename){
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $("#btnExportAll").onclick = async ()=>{
    const payload = {
      exportedAt: nowISO(),
      version: 2,
      clientes: await dbAll("clientes"),
      productos: await dbAll("productos"),
      pedidos: await dbAll("pedidos"),
      visitas: await dbAll("visitas"),
      rutas: await dbAll("rutas"),
      settings: await dbAll("settings")
    };
    await downloadPayload(payload, "export_farmacias_ventas_offline.json");
    toast("Export completo descargado");
    await dbPut("meta", {key:"latestBackupReady", value:false});
    updateBackupPill();
  };

  $("#btnSnap").onclick = async ()=>{
    await createSnapshot("manual");
    toast("Snapshot local creado");
    render();
  };

  const dlLatest = $("#dlLatest");
  if(dlLatest){
    dlLatest.onclick = async ()=>{
      const backups2 = (await dbAll("backups")).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
      const latest = backups2[0];
      if(!latest) return toast("No hay snapshots");
      await downloadPayload(latest.payload, `snapshot_${latest.createdAt.replaceAll(":","-")}.json`);
      toast("Snapshot descargado");
      await dbPut("meta", {key:"latestBackupReady", value:false});
      updateBackupPill();
      render();
    };
  }

  $("#btnImport").onclick = async ()=>{
    const f = $("#fileImport").files[0];
    if(!f) return toast("Selecciona un archivo JSON");
    const txt = await f.text();
    let data;
    try{ data = JSON.parse(txt); } catch { return toast("JSON inválido"); }

    if(!confirm("Esto reemplazará tus datos actuales. ¿Continuar?")) return;

    await Promise.all([
      dbClear("clientes"), dbClear("productos"), dbClear("pedidos"), dbClear("visitas"), dbClear("rutas"), dbClear("settings")
    ]);

    const clientes = data.clientes || data.payload?.clientes || [];
    const productos = data.productos || data.payload?.productos || [];
    const pedidos = data.pedidos || data.payload?.pedidos || [];
    const visitas = data.visitas || data.payload?.visitas || [];
    const rutas = data.rutas || data.payload?.rutas || [];
    const settings = data.settings || data.payload?.settings || [];

    for(const c of clientes) await dbPut("clientes", c);
    for(const p of productos) await dbPut("productos", p);
    for(const o of pedidos) await dbPut("pedidos", o);
    for(const v of visitas) await dbPut("visitas", v);
    for(const r of rutas) await dbPut("rutas", r);
    for(const s of settings) await dbPut("settings", s);

    toast("Datos importados");
    setView("dash");
  };

  $("#btnWipe").onclick = async ()=>{
    if(!confirm("¿Borrar TODO? No se puede deshacer.")) return;
    await Promise.all([
      dbClear("clientes"), dbClear("productos"), dbClear("pedidos"), dbClear("visitas"), dbClear("rutas"), dbClear("backups"), dbClear("settings")
    ]);
    await dbPut("meta",{key:"seeded_v2", value:false});
    await dbPut("meta",{key:"latestBackupReady", value:false});
    toast("Datos borrados");
    updateBackupPill();
    setView("dash");
  };

  const tb = $("#tBackups");
  if(tb){
    tb.onclick = async (e)=>{
      const b = e.target.closest("button");
      if(!b) return;
      const tr = e.target.closest("tr");
      const id = tr?.dataset?.id;
      if(!id) return;
      const act = b.dataset.act;

      const snap = await dbGet("backups", id);
      if(!snap) return;

      if(act==="dl"){
        await downloadPayload(snap.payload, `snapshot_${snap.createdAt.replaceAll(":","-")}.json`);
        toast("Snapshot descargado");
        await dbPut("meta", {key:"latestBackupReady", value:false});
        updateBackupPill();
      }
      if(act==="del"){
        if(!confirm("¿Borrar snapshot?")) return;
        await dbDel("backups", id);
        toast("Snapshot borrado");
        render();
      }
    };
  }
}

/** =========================
 *  AJUSTES (objetivos trimestrales + auto-backup + rutas)
 *  ========================= */
function parseTargetValue(v){
  const s = String(v||"").trim().toUpperCase().replace(",",".");
  if(!s) return 0;
  // Permite 180K
  if(s.endsWith("K")){
    const n = Number(s.slice(0,-1));
    return isNaN(n) ? 0 : Math.round(n*1000);
  }
  const n = Number(s);
  return isNaN(n) ? 0 : Math.round(n);
}

async function renderAjustes(el, settings){
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const yearFull = now.getFullYear();

  // construimos keys del año actual por defecto: 1Tyy..4Tyy
  const keys = [`1T${yy}`, `2T${yy}`, `3T${yy}`, `4T${yy}`];
  const targets = settings.quarterlyTargets || {};

  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h2>Objetivos trimestrales</h2>
        <div class="muted">Configura el objetivo de ventas por trimestre. Formato: <b>1T26</b>, <b>2T26</b>… Puedes escribir 180000 o 180K.</div>
        <div class="hr"></div>

        <div class="card" style="margin:0">
          <h2>Año ${yearFull}</h2>
          <table>
            <thead><tr><th>Trimestre</th><th>Objetivo</th><th>Ejemplo</th></tr></thead>
            <tbody>
              ${keys.map(k=>`
                <tr>
                  <td><b>${k}</b></td>
                  <td>
                    <input class="tgt" data-key="${k}" placeholder="Ej: 180K" value="${targets[k] ? targets[k] : ""}"
                           data-help="Objetivo de ventas para este trimestre. Se usa en Dashboard y Predicciones." />
                  </td>
                  <td class="muted">180K = 180.000 €</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <div class="flex">
            <button class="btn-primary" id="saveTargets">Guardar objetivos</button>
            <button class="btn" id="copyToNextYear">Copiar al año siguiente</button>
          </div>
          <div class="helpbox mini" id="tgtHelp">Toca un campo para ver una ayuda rápida.</div>
        </div>
      </div>

      <div class="card">
        <h2>Auto-backup</h2>
        <div class="muted">Crea snapshots locales automáticamente. Muy recomendable si trabajas offline.</div>

        <label>Activado</label>
        <select id="abEnabled" data-help="Si está activo, la app creará snapshots locales de forma automática.">
          <option value="true">sí</option>
          <option value="false">no</option>
        </select>

        <label>Cada cuántos días</label>
        <input id="abDays" type="number" min="1" max="60"
               data-help="Frecuencia del backup automático (en días). Ej: 7 = semanal." />

        <label>Conservar últimos N snapshots</label>
        <input id="abKeep" type="number" min="1" max="50"
               data-help="Cuántos snapshots locales conservar. Los más antiguos se borran automáticamente." />

        <div class="hr"></div>
        <button class="btn-primary" id="saveBackup">Guardar auto-backup</button>
        <button class="btn" id="makeSnap">Crear snapshot ahora</button>

        <div class="hr"></div>

        <h2>Rutas</h2>
        <div class="muted">Ajustes del generador de rutas sugeridas.</div>

        <label>Nº paradas por defecto</label>
        <input id="rtStops" type="number" min="1" max="30"
               data-help="Paradas por defecto al generar una ruta sugerida." />

        <label>Solo vencidos (días ≥ objetivo)</label>
        <select id="rtOnlyDue" data-help="Si está activo, sugiere farmacias que ya están en su ventana de pedido.">
          <option value="true">sí</option>
          <option value="false">no</option>
        </select>

        <div class="hr"></div>
        <button class="btn-primary" id="saveRutas">Guardar rutas</button>

        <div class="helpbox mini" id="setHelp">Toca un campo para ver una ayuda rápida.</div>
      </div>
    </div>
  `;

  $("#abEnabled").value = String(!!settings.autoBackupEnabled);
  $("#abDays").value = Number(settings.autoBackupEveryDays||7);
  $("#abKeep").value = Number(settings.keepBackups||10);
  $("#rtStops").value = Number(settings.routeDefaultStops||8);
  $("#rtOnlyDue").value = String(!!settings.routeOnlyDue);

  attachHelpToForm(document.body, $("#setHelp"));
  attachHelpToForm(document.body, $("#tgtHelp"));

  $("#saveTargets").onclick = async ()=>{
    const updated = {...(settings.quarterlyTargets||{})};
    $$(".tgt").forEach(inp=>{
      const key = inp.dataset.key;
      const val = parseTargetValue(inp.value);
      if(val>0) updated[key] = val;
      else delete updated[key];
    });
    await saveSetting("quarterlyTargets", updated);
    toast("Objetivos guardados");
    setView("dash");
  };

  $("#copyToNextYear").onclick = async ()=>{
    const nextYY = String(now.getFullYear()+1).slice(-2);
    const updated = {...(settings.quarterlyTargets||{})};
    keys.forEach((k, i)=>{
      const q = i+1;
      const src = updated[`${q}T${yy}`];
      if(src) updated[`${q}T${nextYY}`] = src;
    });
    await saveSetting("quarterlyTargets", updated);
    toast("Copiado al año siguiente");
    render();
  };

  $("#saveBackup").onclick = async ()=>{
    await saveSetting("autoBackupEnabled", $("#abEnabled").value==="true");
    await saveSetting("autoBackupEveryDays", Number($("#abDays").value||7));
    await saveSetting("keepBackups", Number($("#abKeep").value||10));
    toast("Auto-backup guardado");
  };

  $("#makeSnap").onclick = async ()=>{
    await createSnapshot("manual-from-settings");
    toast("Snapshot creado");
  };

  $("#saveRutas").onclick = async ()=>{
    await saveSetting("routeDefaultStops", Number($("#rtStops").value||8));
    await saveSetting("routeOnlyDue", $("#rtOnlyDue").value==="true");
    toast("Ajustes de rutas guardados");
  };
}

/** =========================
 *  Init
 *  ========================= */
(async function init(){
  await openDB();
  await ensureSeed();
  await setupPWA();
  await checkAutoBackup();
  await updateBackupPill();

  $$("nav button").forEach(b=> b.onclick = ()=> setView(b.dataset.view));

  render();
  setInterval(()=>{ checkAutoBackup().catch(()=>{}); }, 30*60*1000);
})();
