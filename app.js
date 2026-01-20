/* =========================================================
   app.js — PARTE 1/5
   Base + utilidades + IndexedDB + settings + seed + PWA
   + parsers base (JSON/KML wrapper) (detalle HTML-table en PARTE 2)
   ========================================================= */

/** =========================
 *  Utilidades UI
 *  ========================= */
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => (t.style.display = "none"), 2400);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

const fmtEur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    Number(n || 0)
  );

const nowISO = () => new Date().toISOString();

const uid = () =>
  crypto?.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(16).slice(2);

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function mapsLinkForAddress(address) {
  const q = encodeURIComponent(address || "");
  if (!q) return "";
  // iOS: Apple Maps; resto: Google Maps Search
  if (isIOS()) return `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function isoDateOnly(d = new Date()) {
  // ajusta al huso local
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
function fromDateOnly(s) {
  return s ? new Date(s + "T00:00:00").toISOString() : "";
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-ES") : "";
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString("es-ES") : "";
}

function daysBetween(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / (1000 * 60 * 60 * 24));
}

function attachHelp(rootEl, helpEl) {
  if (!rootEl || !helpEl) return;
  const handler = (e) => {
    const t = e.target;
    if (!t || !(t.matches("input,select,textarea"))) return;
    const msg = t.dataset.help || "";
    helpEl.textContent = msg || "Toca un campo para ver una ayuda rápida.";
  };
  rootEl.addEventListener("focusin", handler);
  rootEl.addEventListener("click", handler);
}

/** =========================
 *  Trimestres / objetivos
 *  ========================= */
function getQuarter(date = new Date()) {
  return Math.floor(date.getMonth() / 3) + 1;
}
function quarterKey(date = new Date()) {
  const q = getQuarter(date);
  const yy = String(date.getFullYear()).slice(-2);
  return `${q}T${yy}`;
}
function quarterStartEnd(date = new Date()) {
  const year = date.getFullYear();
  const q = getQuarter(date);
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 1);
  return { start, end, q, year };
}
function daysRemainingInQuarter(date = new Date()) {
  const { end } = quarterStartEnd(date);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}
function parseTargetValue(v) {
  const s = String(v || "").trim().toUpperCase().replace(",", ".");
  if (!s) return 0;
  if (s.endsWith("K")) {
    const n = Number(s.slice(0, -1));
    return isNaN(n) ? 0 : Math.round(n * 1000);
  }
  const n = Number(s);
  return isNaN(n) ? 0 : Math.round(n);
}
function formatTargetShort(n) {
  const x = Number(n || 0);
  if (x >= 1000) return `${Math.round(x / 1000)}K`;
  return String(x);
}

/** =========================
 *  Pedidos: líneas y total
 *  ========================= */
function lineTotal(l) {
  const qty = Number(l.cantidad || 0);
  const pu = Number(l.precioUnit || 0);
  const disc = Number(l.descuentoPct || 0);
  const t = qty * pu * (1 - disc / 100);
  return Math.round(t * 1000) / 1000;
}
function recomputePedido(p) {
  (p.lineas || []).forEach((l) => (l.total = lineTotal(l)));
  p.total =
    Math.round(
      (p.lineas || []).reduce((a, l) => a + Number(l.total || 0), 0) * 1000
    ) / 1000;
  return p;
}

/** =========================
 *  Estimación próximo pedido
 *  media intervalos últimos 10, requiere mínimo 3
 *  ========================= */
function estimateNextOrderISO(farmaciaId, pedidosAll) {
  const arr = pedidosAll
    .filter((p) => p.farmaciaId === farmaciaId)
    .filter((p) => ["confirmado", "entregado"].includes(p.estado))
    .slice()
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  if (arr.length < 3) return null;
  const last = arr.slice(-10);
  const fechas = last.map((x) => x.fecha).filter(Boolean);
  if (fechas.length < 3) return null;

  const deltas = [];
  for (let i = 1; i < fechas.length; i++) deltas.push(daysBetween(fechas[i - 1], fechas[i]));
  if (deltas.length < 2) return null;

  const avg = deltas.reduce((a, d) => a + d, 0) / deltas.length;
  const lastDate = new Date(fechas[fechas.length - 1]);
  lastDate.setDate(lastDate.getDate() + Math.round(avg));
  return lastDate.toISOString();
}

/** =========================
 *  Importación Catálogo (base)
 *  Tu formato es JSON con:
 *    - type: "KML"
 *    - features: [{ name, description(html table), geometry.coordinates }]
 *  En PARTE 2: parsearemos la tabla HTML para extraer DIRECCION, CONCELLO, etc.
 *  ========================= */

// normaliza texto
function normText(s) {
  return String(s || "").trim();
}

// convierte " -9,188959 " a número -9.188959
function parseCommaNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// PARSER BASE: acepta:
//  - JSON array simple [{nombre, direccion, lat, lon,...}]  (fallback)
//  - JSON "KML wrapper" como el que has pegado: {type, features:[...]}
function parseJsonToCatalog(jsonText) {
  const data = JSON.parse(jsonText);

  // 1) Caso: tu formato KML en JSON
  if (data && typeof data === "object" && Array.isArray(data.features)) {
    const out = [];
    for (const feat of data.features) {
      const codigo = normText(feat?.name || "");
      const descHtml = String(feat?.description || "");
      const coords = feat?.geometry?.coordinates;
      let lon = null,
        lat = null;

      if (Array.isArray(coords) && coords.length >= 2) {
        lon = parseCommaNumber(coords[0]);
        lat = parseCommaNumber(coords[1]);
      }

      // De momento no parseamos la tabla HTML aquí (PARTE 2).
      // Guardamos description para parseo posterior.
      const catalogId = codigo || uid();
      out.push({
        catalogId,
        nombre: codigo ? `Farmacia ${codigo}` : "Farmacia",
        direccion: "",        // PARTE 2 rellenará con DIRECCION + CP + CONCELLO
        municipio: "",        // PARTE 2 CONCELLO
        provincia: "Galicia", // fallback
        telefono: "",         // PARTE 2 TELEFONO
        siglas: codigo,       // name suele ser la SIGLA
        titular1: "",
        titular2: "",
        titular3: "",
        lat,
        lon,
        source: "JSON KML",
        importedAt: nowISO(),
        rawDescription: descHtml
      });
    }
    // dedupe por catalogId
    const map = new Map();
    for (const r of out) map.set(r.catalogId, r);
    return Array.from(map.values());
  }

  // 2) Caso: JSON lista simple
  const arr = Array.isArray(data) ? data : data?.farmacias || [];
  return arr.map((x) => {
    const nombre = normText(x.nombre || x.name || "Farmacia");
    const direccion = normText(x.direccion || x.address || "");
    const lat = x.lat !== undefined ? Number(x.lat) : null;
    const lon = x.lon !== undefined ? Number(x.lon) : null;
    const municipio = normText(x.municipio || "");
    const provincia = normText(x.provincia || "");
    const catalogId =
      x.catalogId ||
      btoa(unescape(encodeURIComponent(`${nombre}|${direccion}|${lat || ""}|${lon || ""}`))).slice(0, 40);

    return {
      catalogId,
      nombre,
      direccion,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      municipio,
      provincia,
      telefono: normText(x.telefono || ""),
      siglas: normText(x.siglas || ""),
      titular1: normText(x.titular1 || ""),
      titular2: normText(x.titular2 || ""),
      titular3: normText(x.titular3 || ""),
      source: "JSON import",
      importedAt: nowISO(),
      rawDescription: ""
    };
  });
}

/** =========================
 *  IndexedDB
 *  ========================= */
const DB_NAME = "farmacias_ventas_offline_db";
const DB_VER = 7; // sube si cambias stores/índices
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;

      // Mis farmacias (clientes)
      if (!d.objectStoreNames.contains("farmacias")) {
        const s = d.createObjectStore("farmacias", { keyPath: "id" });
        s.createIndex("nombre", "nombre", { unique: false });
        s.createIndex("zona", "zona", { unique: false });
        s.createIndex("catalogId", "catalogId", { unique: false });
      }

      // Catálogo importado (Galicia)
      if (!d.objectStoreNames.contains("catalogo")) {
        const s = d.createObjectStore("catalogo", { keyPath: "catalogId" });
        s.createIndex("nombre", "nombre", { unique: false });
        s.createIndex("provincia", "provincia", { unique: false });
        s.createIndex("municipio", "municipio", { unique: false });
      }

      // Productos (simplificado)
      if (!d.objectStoreNames.contains("productos")) {
        const s = d.createObjectStore("productos", { keyPath: "id" });
        s.createIndex("nombre", "nombre", { unique: false });
      }

      // Pedidos
      if (!d.objectStoreNames.contains("pedidos")) {
        const s = d.createObjectStore("pedidos", { keyPath: "id" });
        s.createIndex("farmaciaId", "farmaciaId", { unique: false });
        s.createIndex("fecha", "fecha", { unique: false });
        s.createIndex("estado", "estado", { unique: false });
      }

      // Interacciones / check-ins
      if (!d.objectStoreNames.contains("interacciones")) {
        const s = d.createObjectStore("interacciones", { keyPath: "id" });
        s.createIndex("farmaciaId", "farmaciaId", { unique: false });
        s.createIndex("fecha", "fecha", { unique: false });
        s.createIndex("tipo", "tipo", { unique: false });
      }

      // Rutas (planificador)
      if (!d.objectStoreNames.contains("rutas")) {
        const s = d.createObjectStore("rutas", { keyPath: "id" });
        s.createIndex("date", "date", { unique: false });
        s.createIndex("zona", "zona", { unique: false });
      }

      // Settings
      if (!d.objectStoreNames.contains("settings")) {
        d.createObjectStore("settings", { keyPath: "key" });
      }

      // Meta (seed, backups, etc.)
      if (!d.objectStoreNames.contains("meta")) {
        d.createObjectStore("meta", { keyPath: "key" });
      }

      // Snapshots
      if (!d.objectStoreNames.contains("backups")) {
        const s = d.createObjectStore("backups", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}
function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").put(obj);
    r.onsuccess = () => resolve(obj);
    r.onerror = () => reject(r.error);
  });
}
function dbDel(store, id) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").delete(id);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}
function dbGet(store, id) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readonly").get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
function dbAll(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readonly").getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function dbClear(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store, "readwrite").clear();
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
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

async function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = await dbGet("settings", k);
    if (v && v.value !== undefined) out[k] = v.value;
  }
  if (!out.quarterlyTargets || typeof out.quarterlyTargets !== "object") {
    out.quarterlyTargets = {};
  }
  return out;
}
async function saveSetting(key, value) {
  await dbPut("settings", { key, value });
}

/** =========================
 *  Seed demo (para arrancar)
 *  ========================= */
async function ensureSeed() {
  const meta = await dbGet("meta", "seeded");
  if (meta?.value) return;

  // productos demo
  await dbPut("productos", {
    id: uid(),
    nombre: "Producto A",
    descripcion: "Ejemplo de producto del laboratorio",
    precio: 45.0,
    activo: true,
    creadoEn: nowISO()
  });
  await dbPut("productos", {
    id: uid(),
    nombre: "Producto B",
    descripcion: "Ejemplo de producto del laboratorio",
    precio: 25.0,
    activo: true,
    creadoEn: nowISO()
  });

  // farmacia demo
  await dbPut("farmacias", {
    id: uid(),
    catalogId: "",
    nombre: "Farmacia Demo",
    apodo: "Demo",
    zona: "Pontevedra",
    direccion: "C/ Michelena 10, Pontevedra",
    telefono: "",
    email: "",
    estado: "activo",
    frecuenciaObjetivoDias: 21,
    etiquetas: ["demo"],
    notas: "",
    creadoEn: nowISO()
  });

  await dbPut("meta", { key: "seeded", value: true });
}

/** =========================
 *  KPIs helpers (base)
 *  ========================= */
function calcTotalPedidos(pedidos) {
  return pedidos
    .filter((p) => ["confirmado", "entregado"].includes(p.estado))
    .reduce((a, p) => a + Number(p.total || 0), 0);
}
function sumPedidosInRange(pedidos, start, end) {
  const a = start.getTime();
  const b = end.getTime();
  return pedidos
    .filter((p) => ["confirmado", "entregado"].includes(p.estado))
    .filter((p) => {
      const t = new Date(p.fecha).getTime();
      return t >= a && t < b;
    })
    .reduce((acc, p) => acc + Number(p.total || 0), 0);
}

/** =========================
 *  PWA setup
 *  ========================= */
async function setupPWA() {
  const hint = $("#installHint");
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone;

  if (hint) hint.textContent = isStandalone ? "Modo app · Offline" : "Instalable · Offline";

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW no registrado", e);
    }
  }
}

/** =========================
 *  Router / estado (base)
 *  ========================= */
let STATE = { view: "dash", editing: null };

function setView(v) {
  STATE.view = v;
  STATE.editing = null;
  render();
}

/** =========================
 *  Render principal (stub)
 *  PARTE 3-5 implementan renderDash/renderFarmacias/etc.
 *  ========================= */
async function render() {
  const el = $("#view");
  if (!el) return;

  // Cargamos datos base (PARTE 3+ los usará)
  const [farmacias, catalogo, productos, pedidos, interacciones, rutas, settings] =
    await Promise.all([
      dbAll("farmacias"),
      dbAll("catalogo"),
      dbAll("productos"),
      dbAll("pedidos"),
      dbAll("interacciones"),
      dbAll("rutas"),
      loadSettings()
    ]);

  // Stub: en PARTE 3-5 vendrán estos renders completos
  el.innerHTML = `
    <div class="card">
      <h2>Base cargada</h2>
      <div class="muted">Todo OK. Ya tienes IndexedDB, settings y seed.</div>
      <div class="hr"></div>
      <div class="mini">
        Datos: Mis farmacias=${farmacias.length} · Catálogo=${catalogo.length} · Productos=${productos.length} · Pedidos=${pedidos.length} · Interacciones=${interacciones.length} · Rutas=${rutas.length}
      </div>
      <div class="hr"></div>
      <div class="muted">Pídeme ahora: <b>“PARTE 2”</b> (importador de tu JSON KML con parsing de la tabla HTML).</div>
    </div>
  `;

  // navegación
  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================
 *  Init
 *  ========================= */
(async function init() {
  await openDB();
  await ensureSeed();
  await setupPWA();
  render();
})();

/* =========================================================
   app.js — PARTE 2/5
   Importación REAL de tu JSON (KML->JSON con description HTML table)
   ========================================================= */

/** =========================
 *  Helpers HTML table parsing
 *  ========================= */

// Decodifica entidades HTML frecuentes (incluye &#37; etc.)
function decodeHtmlEntities(str) {
  if (!str) return "";
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

// Limpia etiquetas HTML -> texto
function htmlToText(html) {
  if (!html) return "";
  // quitar tags conservando separaciones
  const s = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/th>/gi, " | ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeHtmlEntities(s).trim();
}

// Extrae pares KEY->VALUE desde una tabla en HTML.
// Tu tabla tiene filas tipo: <td>DIRECCION</td><td>CONSTITUCION, Nº 16,</td>
function parseDescriptionTableToMap(descriptionHtml) {
  const map = {};
  if (!descriptionHtml) return map;

  // Usamos DOMParser para robustez
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(descriptionHtml), "text/html");

  const rows = Array.from(doc.querySelectorAll("tr"));
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll("td,th"));
    if (cells.length < 2) continue;

    const k = decodeHtmlEntities(cells[0].textContent || "")
      .trim()
      .toUpperCase();
    const v = decodeHtmlEntities(cells[1].textContent || "").trim();

    // Filtra header "Field Name/Field Value"
    if (!k || k.includes("FIELD NAME")) continue;
    if (!k) continue;

    map[k] = v;
  }
  return map;
}

// Convierte "-9,188959" o "-9.188959" a Number
function parseCoord(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Normaliza valores tipo "<Null>" o "&lt;Null&gt;"
function nullish(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const up = s.toUpperCase();
  if (up === "<NULL>" || up === "&LT;NULL&GT;" || up === "NULL") return "";
  return s;
}

// Crea un id estable para el catálogo
function makeCatalogId(siglas, lon, lat, direccion) {
  const base = `${siglas || ""}|${lon ?? ""}|${lat ?? ""}|${direccion || ""}`;
  return btoa(unescape(encodeURIComponent(base))).slice(0, 40);
}

// Construye dirección usable para Maps
function buildAddress(fields) {
  const dir = nullish(fields.DIRECCION || "");
  const cp = nullish(fields.CODIGOPOST || "");
  const concello = nullish(fields.CONCELLO || "");
  const parts = [];
  if (dir) parts.push(dir.replace(/\s+,/g, ",").trim());
  if (cp) parts.push(cp);
  if (concello) parts.push(concello);
  // Galicia (para que Maps afine)
  parts.push("Galicia, España");
  return parts.filter(Boolean).join(", ");
}

/** =========================
 *  parseJsonToCatalog() (REEMPLAZA la de PARTE 1)
 *  - Soporta tu JSON tipo KML
 *  - Soporta JSON array simple
 *  ========================= */
function parseJsonToCatalog(jsonText) {
  const data = JSON.parse(jsonText);

  // 1) Tu caso: KML convertido a JSON
  if (data && typeof data === "object" && Array.isArray(data.features)) {
    const out = [];

    for (const feat of data.features) {
      const siglas = normText(feat?.name || ""); // ej: C-184-F
      const descHtml = String(feat?.description || "");

      // geometry.coordinates = [lon, lat]
      const coords = feat?.geometry?.coordinates;
      let lon = null, lat = null;
      if (Array.isArray(coords) && coords.length >= 2) {
        lon = parseCoord(coords[0]);
        lat = parseCoord(coords[1]);
      }

      // parse description table
      const fields = parseDescriptionTableToMap(descHtml);

      // Si no venía coords, intenta COORDX/COORDY desde tabla
      if (lon === null) lon = parseCoord(fields.COORDX);
      if (lat === null) lat = parseCoord(fields.COORDY);

      const direccion = buildAddress(fields);
      const municipio = nullish(fields.CONCELLO || "");
      const telefono = nullish(fields.TELEFONO || "");
      const cp = nullish(fields.CODIGOPOST || "");

      const titular1 = nullish(fields.TITULAR1 || "");
      const titular2 = nullish(fields.TITULAR2 || "");
      const titular3 = nullish(fields.TITULAR3 || "");

      // Nombre: si tienes SIGLAS, y si quieres algo más humano, usamos "Farmacia (SIGLAS)"
      const nombre = siglas ? `Farmacia ${siglas}` : "Farmacia";

      const catalogId = makeCatalogId(siglas, lon, lat, direccion || municipio);

      out.push({
        catalogId,
        nombre,
        direccion,
        municipio,
        provincia: "Galicia",
        telefono,
        codigopost: cp,
        siglas: siglas || nullish(fields.SIGLAS || ""),
        titular1,
        titular2,
        titular3,
        lat,
        lon,
        source: "JSON KML (features)",
        importedAt: nowISO(),
        rawDescription: descHtml
      });
    }

    // dedupe por catalogId
    const map = new Map();
    for (const r of out) map.set(r.catalogId, r);
    return Array.from(map.values());
  }

  // 2) Caso: JSON lista simple
  const arr = Array.isArray(data) ? data : (data?.farmacias || []);
  return arr.map((x) => {
    const nombre = normText(x.nombre || x.name || "Farmacia");
    const direccion = normText(x.direccion || x.address || "");
    const municipio = normText(x.municipio || x.concello || "");
    const provincia = normText(x.provincia || "Galicia");
    const telefono = normText(x.telefono || "");
    const siglas = normText(x.siglas || x.codigo || "");

    const lat = x.lat !== undefined ? Number(x.lat) : null;
    const lon = x.lon !== undefined ? Number(x.lon) : null;

    const catalogId =
      x.catalogId ||
      makeCatalogId(siglas, lon, lat, direccion || municipio || nombre);

    return {
      catalogId,
      nombre,
      direccion,
      municipio,
      provincia,
      telefono,
      codigopost: normText(x.codigopost || x.cp || ""),
      siglas,
      titular1: normText(x.titular1 || ""),
      titular2: normText(x.titular2 || ""),
      titular3: normText(x.titular3 || ""),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      source: "JSON import",
      importedAt: nowISO(),
      rawDescription: ""
    };
  });
}

/** =========================
 *  (Opcional pero útil) Validación rápida de un item de catálogo
 *  ========================= */
function validateCatalogItem(it) {
  // evita basura; no impide importar, solo ayuda si quieres filtrar
  const hasSomeId = !!(it.catalogId || it.siglas);
  const hasLocation = !!(it.direccion || (it.lat !== null && it.lon !== null));
  return hasSomeId && hasLocation;
}

/** =========================
 *  (Opcional) Normaliza items importados para que Maps sea útil
 *  ========================= */
function normalizeCatalogItems(items) {
  return (items || []).map((it) => {
    const dir = normText(it.direccion || "");
    // Si la dirección está vacía pero hay coords, dejamos dirección “(coords)”
    const fallbackDir =
      dir ||
      (it.lat !== null && it.lon !== null
        ? `${it.lat}, ${it.lon} (Galicia, España)`
        : "");
    return {
      ...it,
      direccion: fallbackDir
    };
  });
}

/** =========================
 *  Consejo de uso en PARTE 3:
 *    const items = normalizeCatalogItems(parseJsonToCatalog(text))
 *    items.filter(validateCatalogItem).forEach(dbPut("catalogo", it))
 *  ========================= */

/* =========================================================
   app.js — PARTE 3/5
   UI: pestaña FARMACIAS completa + Router render real (parcial)
   - Importar catálogo (tu JSON KML)
   - Listado catálogo + añadir a Mis farmacias (verde si ya está)
   - Listado Mis farmacias + Maps + Detalles (PARTE 4) + Check-in (PARTE 5)
   ========================================================= */

/** =========================
 *  Router: render real (parcial)
 *  (Dash/Predicciones/Rutas/Productos/Pedidos/Interacciones/Backup/Ajustes
 *   se completan en PARTE 4/5; aquí dejamos placeholders.)
 *  ========================= */
async function render() {
  const el = $("#view");
  if (!el) return;

  const [farmacias, catalogo, productos, pedidos, interacciones, rutas, settings] =
    await Promise.all([
      dbAll("farmacias"),
      dbAll("catalogo"),
      dbAll("productos"),
      dbAll("pedidos"),
      dbAll("interacciones"),
      dbAll("rutas"),
      loadSettings()
    ]);

  // Router por vista
  if (STATE.view === "farmacias") {
    return renderFarmacias(el, farmacias, catalogo);
  }

  // Placeholders (PARTE 4/5 los sustituye por vistas completas)
  if (STATE.view === "dash") {
    el.innerHTML = `
      <div class="card">
        <h2>Dashboard</h2>
        <div class="muted">Se completa en PARTE 4/5 (objetivo trimestral + KPIs).</div>
        <div class="hr"></div>
        <div class="mini">Mis farmacias=${farmacias.length} · Catálogo=${catalogo.length} · Productos=${productos.length} · Pedidos=${pedidos.length} · Interacciones=${interacciones.length}</div>
        <div class="hr"></div>
        <button class="btn-primary" id="goFarm">Ir a Farmacias</button>
      </div>
    `;
    $("#goFarm").onclick = () => setView("farmacias");
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(STATE.view)}</h2>
      <div class="muted">Vista pendiente (se completa en PARTE 4/5).</div>
      <div class="hr"></div>
      <button class="btn-primary" id="goFarm2">Ir a Farmacias</button>
    </div>
  `;
  $("#goFarm2").onclick = () => setView("farmacias");

  // asegurar nav
  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================
 *  UI: Farmacias (Catálogo + Mis farmacias)
 *  ========================= */
function renderFarmacias(el, misFarmacias, catalogo) {
  // para pintar verde si está en Mis farmacias
  const misCatalogIds = new Set(misFarmacias.map((f) => f.catalogId).filter(Boolean));

  // Zonas existentes (por si quieres filtrar luego)
  const zonas = Array.from(new Set(misFarmacias.map((f) => (f.zona || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  el.innerHTML = `
    <div class="banner">
      <div class="row">
        <div>
          <b>Farmacias</b>
          <div class="mini">
            Importa un catálogo (tu JSON tipo KML) y añade farmacias a <b>Mis farmacias</b>.
            Se marcarán en verde cuando estén añadidas.
          </div>
        </div>
        <div class="right flex">
          <button class="btn" id="btnImport">Importar catálogo</button>
          <button class="btn-danger" id="btnClearCat">Borrar catálogo</button>
        </div>
      </div>
    </div>

    <div class="grid two">
      <!-- Catálogo -->
      <div class="card">
        <h2>Catálogo Galicia (${catalogo.length})</h2>

        <div class="grid two">
          <div>
            <label>Buscar</label>
            <input id="qCat" placeholder="Nombre / dirección / concello / siglas..."
              data-help="Busca en el catálogo importado por nombre, dirección, concello o siglas." />
          </div>
          <div>
            <label>Límite listado</label>
            <select id="catLimit" data-help="Si el catálogo es grande, baja el límite para que vaya más fluido.">
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
            <tbody></tbody>
          </table>
        </div>

        <div class="hr"></div>
        <div class="mini">
          Tip: si el archivo es el que has pegado, el importador lee: <b>DIRECCION, CODIGOPOST, CONCELLO, TELEFONO, COORDX, COORDY, TITULAR1/2/3</b>.
        </div>
      </div>

      <!-- Mis farmacias -->
      <div class="card">
        <div class="row">
          <h2>Mis farmacias (${misFarmacias.length})</h2>
          <div class="right flex">
            <button class="btn-primary" id="btnAlta">+ Alta manual</button>
          </div>
        </div>

        <div class="muted">
          Aquí guardas pedidos e interacciones. Cada farmacia tiene su panel de detalles (PARTE 4) y check-in + pedido (PARTE 5).
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div>
            <label>Filtrar por zona</label>
            <select id="misZona" data-help="Filtra Mis farmacias por zona (útil para rutas).">
              <option value="">Todas</option>
              ${zonas.map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Buscar</label>
            <input id="qMis" placeholder="Nombre / dirección..."
              data-help="Busca en Mis farmacias por nombre o dirección." />
          </div>
        </div>

        <div class="helpbox mini" id="misHelp">Toca un campo para ver una ayuda rápida.</div>

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
                  const m = mapsLinkForAddress(f.direccion || "");
                  const tag = f.catalogId ? `<span class="pill ok">catálogo</span>` : `<span class="pill">manual</span>`;
                  return `
                    <tr data-id="${f.id}">
                      <td>
                        <b>${escapeHtml(f.nombre || "")}</b>
                        <span class="muted">${escapeHtml(f.apodo || "")}</span><br>
                        ${tag}
                        <span class="mini">${escapeHtml((f.etiquetas || []).join(", "))}</span>
                      </td>
                      <td>${escapeHtml(f.zona || "")}</td>
                      <td>${escapeHtml(f.direccion || "")}</td>
                      <td class="right">
                        <button class="btn-primary btn-xs" data-act="details">Detalles</button>
                        <button class="btn btn-xs" data-act="checkin">Check-in + pedido</button>
                        ${m ? `<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>` : ""}
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

    <!-- Import dialog -->
    <dialog id="importDlg">
      <div class="dlg-head">
        <div class="row">
          <div>
            <b>Importar catálogo</b><br>
            <span class="mini">Sube un archivo JSON (tu KML convertido). Se procesa offline.</span>
          </div>
          <div class="right">
            <button class="btn" id="impClose">Cerrar</button>
          </div>
        </div>
      </div>

      <div class="dlg-body">
        <div class="card" style="margin:0">
          <h2>Archivo</h2>

          <input type="file" id="impFile" accept=".json,application/json"
            data-help="Selecciona el JSON (tipo KML) con features[].description y geometry.coordinates." />

          <div class="grid two" style="margin-top:10px">
            <div>
              <label>Modo</label>
              <select id="impMode" data-help="Añadir: acumula catálogo. Reemplazar: borra y vuelve a importar.">
                <option value="append" selected>Añadir (acumular)</option>
                <option value="replace">Reemplazar (borrar y cargar)</option>
              </select>
            </div>
            <div>
              <label>Filtrar</label>
              <select id="impFilter" data-help="Si activas, intenta importar solo elementos que parezcan farmacias.">
                <option value="all" selected>Importar todo</option>
                <option value="valid">Solo válidos (id + dirección/coords)</option>
              </select>
            </div>
          </div>

          <div class="helpbox mini" id="impHelp">Toca un campo para ver una ayuda rápida.</div>

          <div class="hr"></div>

          <div class="flex">
            <button class="btn-primary" id="impRun">Importar</button>
          </div>

          <div class="mini" style="margin-top:10px">
            Nota: el importador ya soporta coma decimal en COORDX/COORDY (ej: -9,188959).
          </div>
        </div>
      </div>

      <div class="dlg-foot">
        <div class="mini">No requiere servidor.</div>
      </div>
    </dialog>
  `;

  attachHelp(el, $("#catHelp"));
  attachHelp(el, $("#misHelp"));

  // Render catálogo (tabla)
  const renderCat = () => {
    const q = ($("#qCat").value || "").trim().toLowerCase();
    const limit = Number($("#catLimit").value || 100);

    const filtered = q
      ? catalogo.filter((x) => {
          const hay =
            (x.nombre || "") + " " +
            (x.direccion || "") + " " +
            (x.municipio || "") + " " +
            (x.siglas || "");
          return hay.toLowerCase().includes(q);
        })
      : catalogo;

    const rows = filtered
      .slice()
      .sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""))
      .slice(0, limit)
      .map((c) => {
        const inMine = misCatalogIds.has(c.catalogId);
        const m = mapsLinkForAddress(c.direccion || "");
        const sub = [
          c.siglas ? `Siglas: ${c.siglas}` : "",
          c.municipio ? `Concello: ${c.municipio}` : ""
        ].filter(Boolean).join(" · ");

        return `
          <tr data-catid="${c.catalogId}" style="${inMine ? "background: rgba(34,197,94,.08);" : ""}">
            <td>
              <b>${escapeHtml(c.nombre || "")}</b><br>
              <span class="mini">${escapeHtml(sub)}</span>
            </td>
            <td>${escapeHtml(c.direccion || "")}</td>
            <td>
              ${inMine
                ? `<span class="pill ok">en Mis farmacias</span>`
                : `<span class="pill">no añadida</span>`
              }
            </td>
            <td class="right">
              ${m ? `<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>` : ""}
              <button class="btn-primary btn-xs" data-act="add" ${inMine ? "disabled" : ""}>Añadir</button>
            </td>
          </tr>
        `;
      })
      .join("");

    $("#tCat tbody").innerHTML =
      rows || `<tr><td colspan="4" class="muted">Catálogo vacío. Importa un JSON.</td></tr>`;
  };

  renderCat();
  $("#qCat").oninput = renderCat;
  $("#catLimit").onchange = renderCat;

  // Render Mis farmacias (filtros)
  const applyMisFilters = () => {
    const q = ($("#qMis").value || "").trim().toLowerCase();
    const z = ($("#misZona").value || "").trim();

    $$("#tMis tbody tr").forEach((tr) => {
      const id = tr.dataset.id;
      const f = misFarmacias.find(x => x.id === id);
      if (!f) return;

      const okZona = z ? ((f.zona || "") === z) : true;
      const hay = ((f.nombre || "") + " " + (f.direccion || "")).toLowerCase();
      const okQ = q ? hay.includes(q) : true;

      tr.style.display = (okZona && okQ) ? "" : "none";
    });
  };
  $("#qMis").oninput = applyMisFilters;
  $("#misZona").onchange = applyMisFilters;

  /** =========================
   *  Importación Catálogo (JSON)
   *  ========================= */
  const importDlg = $("#importDlg");
  $("#btnImport").onclick = () => importDlg.showModal();
  $("#impClose").onclick = () => importDlg.close();
  attachHelp(importDlg, $("#impHelp"));

  $("#impRun").onclick = async () => {
    const file = $("#impFile").files[0];
    if (!file) return toast("Selecciona un archivo JSON");

    let text;
    try {
      text = await file.text();
    } catch {
      return toast("No se pudo leer el archivo");
    }

    let items;
    try {
      items = parseJsonToCatalog(text);
      items = normalizeCatalogItems(items);
      if ($("#impFilter").value === "valid") {
        items = items.filter(validateCatalogItem);
      }
    } catch (e) {
      console.error(e);
      return toast("JSON inválido o formato no soportado");
    }

    if (!items.length) return toast("No se detectaron farmacias en el archivo");

    const mode = $("#impMode").value;
    if (mode === "replace") {
      await dbClear("catalogo");
    }

    // Insertar/actualizar
    for (const it of items) {
      await dbPut("catalogo", it);
    }

    toast(`Catálogo importado: ${items.length}`);
    importDlg.close();
    render();
  };

  $("#btnClearCat").onclick = async () => {
    if (!confirm("¿Borrar TODO el catálogo importado?")) return;
    await dbClear("catalogo");
    toast("Catálogo borrado");
    render();
  };

  /** =========================
   *  Añadir desde catálogo a Mis farmacias
   *  ========================= */
  $("#tCat").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.dataset.act !== "add") return;

    const tr = e.target.closest("tr");
    const catid = tr?.dataset?.catid;
    if (!catid) return;

    // evitar duplicado
    const ya = misFarmacias.find((f) => f.catalogId === catid);
    if (ya) return toast("Ya está en Mis farmacias");

    const cat = await dbGet("catalogo", catid);
    if (!cat) return toast("No encontrado en catálogo");

    const farmacia = {
      id: uid(),
      catalogId: cat.catalogId,
      nombre: cat.nombre || (cat.siglas ? `Farmacia ${cat.siglas}` : "Farmacia"),
      apodo: "",
      zona: "", // lo rellenas tú (rutas)
      direccion: cat.direccion || "",
      telefono: cat.telefono || "",
      email: "",
      estado: "activo",
      frecuenciaObjetivoDias: 21,
      etiquetas: ["catálogo"],
      notas: "",
      creadoEn: nowISO()
    };

    await dbPut("farmacias", farmacia);
    toast("Añadida a Mis farmacias");
    render();
  };

  /** =========================
   *  Alta manual
   *  ========================= */
  $("#btnAlta").onclick = async () => {
    const nombre = prompt("Nombre de la farmacia:");
    if (!nombre) return;

    const direccion = prompt("Dirección (para Maps):") || "";
    const telefono = prompt("Teléfono (opcional):") || "";
    const zona = prompt("Zona (opcional, para rutas):") || "";

    await dbPut("farmacias", {
      id: uid(),
      catalogId: "",
      nombre: nombre.trim(),
      apodo: "",
      zona: zona.trim(),
      direccion: direccion.trim(),
      telefono: telefono.trim(),
      email: "",
      estado: "activo",
      frecuenciaObjetivoDias: 21,
      etiquetas: ["manual"],
      notas: "",
      creadoEn: nowISO()
    });

    toast("Farmacia creada");
    render();
  };

  /** =========================
   *  Acciones Mis farmacias
   *  ========================= */
  $("#tMis").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;

    const act = btn.dataset.act;

    if (act === "del") {
      if (!confirm("¿Quitar de Mis farmacias? (No borra pedidos/interacciones ya creados)")) return;
      await dbDel("farmacias", id);
      toast("Quitada");
      render();
      return;
    }

    if (act === "details") {
      // PARTE 4 implementa openPharmacyDetails()
      const f = await dbGet("farmacias", id);
      const pedidosAll = await dbAll("pedidos");
      if (typeof openPharmacyDetails === "function") {
        openPharmacyDetails(f, pedidosAll);
      } else {
        toast("Detalles se activan en PARTE 4/5");
      }
      return;
    }

    if (act === "checkin") {
      // PARTE 5 implementa openCheckinModal()
      if (typeof openCheckinModal === "function") {
        openCheckinModal(id);
      } else {
        toast("Check-in se activa en PARTE 5/5");
      }
      return;
    }
  };

  // asegurar nav
  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/* =========================================================
   app.js — PARTE 4/5
   Dashboard + Predicciones + Detalles farmacia (modal)
   + router actualizado (redefine render y setView)
   ========================================================= */

/** =========================
 *  Compat: si el menú aún usa "clientes", lo tratamos como "farmacias"
 *  ========================= */
const _setViewPrev = setView;
setView = function (v) {
  if (v === "clientes") v = "farmacias";
  return _setViewPrev(v);
};

/** =========================
 *  Helpers KPIs / stats farmacia
 *  ========================= */
function getPedidosOk(pedidos) {
  return pedidos.filter(p => ["confirmado", "entregado"].includes(p.estado));
}

function getPedidosByFarmacia(pedidosOk) {
  const m = new Map();
  for (const p of pedidosOk) {
    if (!m.has(p.farmaciaId)) m.set(p.farmaciaId, []);
    m.get(p.farmaciaId).push(p);
  }
  for (const [k, arr] of m.entries()) {
    arr.sort((a,b)=> new Date(a.fecha) - new Date(b.fecha));
  }
  return m;
}

// devuelve { lastISO, daysSince, nextISO, avgDays, totalVentas, nPedidos }
function farmaciaStats(f, pedidosOkMap) {
  const arr = (pedidosOkMap.get(f.id) || []).slice().sort((a,b)=> new Date(a.fecha)-new Date(b.fecha));
  const n = arr.length;
  const totalVentas = arr.reduce((a,p)=> a + Number(p.total||0), 0);
  const lastISO = n ? arr[n-1].fecha : null;
  const daysSince = lastISO ? daysBetween(lastISO, nowISO()) : null;

  // avgDays con últimos 10 pedidos (si >=3)
  let avgDays = null;
  if (n >= 3) {
    const last10 = arr.slice(-10);
    const fechas = last10.map(x=>x.fecha).filter(Boolean);
    if (fechas.length >= 3) {
      const deltas = [];
      for (let i=1;i<fechas.length;i++) deltas.push(daysBetween(fechas[i-1], fechas[i]));
      if (deltas.length >= 2) avgDays = deltas.reduce((a,d)=>a+d,0) / deltas.length;
    }
  }

  // next estimate: usa estimateNextOrderISO (mín 3 pedidos)
  let nextISO = estimateNextOrderISO(f.id, getPedidosOk(Array.from(pedidosOkMap.get(f.id) || [])));

  // estimateNextOrderISO que tenemos en PARTE 1 espera pedidosAll con farmaciaId,
  // pero arriba le pasamos array filtrado; para robustez, si falla, recalculamos:
  try {
    const all = (pedidosOkMap.get(f.id) || []).slice().sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));
    // reusar la función global que usa pedidosAll
    // (si no hay 3 pedidos, devuelve null)
    nextISO = estimateNextOrderISO(f.id, all) || nextISO || null;
  } catch {}

  // fallback: si no hay estimación pero hay último pedido y frecuencia objetivo
  if (!nextISO && lastISO) {
    const base = new Date(lastISO);
    const freq = Number(f.frecuenciaObjetivoDias || 0) || (avgDays ? Math.round(avgDays) : 21);
    base.setDate(base.getDate() + freq);
    nextISO = base.toISOString();
  }

  return { lastISO, daysSince, nextISO, avgDays, totalVentas, nPedidos: n };
}

/** =========================
 *  Objetivo trimestral (settings.quarterlyTargets)
 *  ========================= */
function getQuarterTarget(settings, key) {
  const t = settings?.quarterlyTargets?.[key];
  return Number(t || 0);
}

/** =========================
 *  Router: render actualizado (redefine render)
 *  ========================= */
render = async function render() {
  const el = $("#view");
  if (!el) return;

  const [farmacias, catalogo, productos, pedidos, interacciones, rutas, settings] =
    await Promise.all([
      dbAll("farmacias"),
      dbAll("catalogo"),
      dbAll("productos"),
      dbAll("pedidos"),
      dbAll("interacciones"),
      dbAll("rutas"),
      loadSettings()
    ]);

  // compat view
  if (STATE.view === "clientes") STATE.view = "farmacias";

  if (STATE.view === "farmacias") return renderFarmacias(el, farmacias, catalogo);

  if (STATE.view === "dash") return renderDashboard(el, farmacias, pedidos, settings);

  if (STATE.view === "predicciones") return renderPredicciones(el, farmacias, pedidos, settings);

  // placeholders restantes (PARTE 5 completa productos/pedidos/interacciones/backup/ajustes/rutas)
  el.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(STATE.view)}</h2>
      <div class="muted">Vista pendiente (se completa en PARTE 5/5).</div>
      <div class="hr"></div>
      <button class="btn-primary" id="goDash">Ir a Dashboard</button>
      <button class="btn" id="goFarm">Ir a Farmacias</button>
    </div>
  `;
  $("#goDash").onclick = ()=>setView("dash");
  $("#goFarm").onclick = ()=>setView("farmacias");

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
};

/** =========================
 *  Dashboard: trimestre vs objetivo
 *  ========================= */
function renderDashboard(el, farmacias, pedidos, settings) {
  const { start, end } = quarterStartEnd(new Date());
  const qKey = quarterKey(new Date());

  const pedidosOk = getPedidosOk(pedidos);
  const totalTrim = sumPedidosInRange(pedidosOk, start, end);

  const objetivo = getQuarterTarget(settings, qKey);
  const faltan = Math.max(0, objetivo - totalTrim);
  const pct = objetivo > 0 ? Math.round((totalTrim / objetivo) * 1000) / 10 : 0;

  const daysLeft = daysRemainingInQuarter(new Date());
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const porSemana = objetivo > 0 ? (faltan / weeksLeft) : 0;
  const porDia = objetivo > 0 ? (faltan / Math.max(1, daysLeft)) : 0;

  const pillClass = (objetivo === 0)
    ? "warn"
    : (totalTrim >= objetivo ? "ok" : "warn");

  el.innerHTML = `
    <div class="card">
      <h2>Dashboard · ${escapeHtml(qKey)}</h2>
      <div class="muted">
        Total trimestre en curso frente al objetivo configurado en Ajustes (PARTE 5).
      </div>

      <div class="hr"></div>

      <div class="kpi">
        <div class="k">
          <div class="v">${fmtEur(totalTrim)}</div>
          <div class="t">Ventas trimestre</div>
        </div>
        <div class="k">
          <div class="v">${objetivo ? fmtEur(objetivo) : "—"}</div>
          <div class="t">Objetivo ${escapeHtml(qKey)}</div>
        </div>
        <div class="k">
          <div class="v">${objetivo ? fmtEur(faltan) : "—"}</div>
          <div class="t">Faltan para objetivo</div>
        </div>
        <div class="k">
          <div class="v"><span class="pill ${pillClass}">${objetivo ? pct + "%" : "sin objetivo"}</span></div>
          <div class="t">Progreso</div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Ritmo recomendado</h2>
          <div class="mini">
            Días restantes en el trimestre: <b>${daysLeft}</b> · Semanas restantes aprox.: <b>${weeksLeft}</b>
          </div>
          <div class="hr"></div>
          <div class="mini">Para llegar al objetivo:</div>
          <div class="kpi" style="grid-template-columns:repeat(2,1fr)">
            <div class="k">
              <div class="v">${objetivo ? fmtEur(porSemana) : "—"}</div>
              <div class="t">por semana</div>
            </div>
            <div class="k">
              <div class="v">${objetivo ? fmtEur(porDia) : "—"}</div>
              <div class="t">por día</div>
            </div>
          </div>
          ${objetivo === 0 ? `<div class="mini muted" style="margin-top:10px">Configura el objetivo del trimestre en Ajustes.</div>` : ""}
        </div>

        <div class="card" style="margin:0">
          <h2>Accesos rápidos</h2>
          <div class="flex">
            <button class="btn-primary" id="goPred">Predicciones</button>
            <button class="btn" id="goFarm">Farmacias</button>
            <button class="btn" id="goPedidos">Pedidos</button>
            <button class="btn" id="goAjustes">Ajustes</button>
          </div>
          <div class="hr"></div>
          <div class="mini">
            Mis farmacias: <b>${farmacias.length}</b> · Pedidos: <b>${pedidos.length}</b>
          </div>
        </div>
      </div>
    </div>
  `;

  $("#goPred").onclick = ()=>setView("predicciones");
  $("#goFarm").onclick = ()=>setView("farmacias");
  $("#goPedidos").onclick = ()=>setView("pedidos");
  $("#goAjustes").onclick = ()=>setView("ajustes");

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================
 *  Predicciones
 *  - cuánto vender / semana para objetivo
 *  - sugerencia de a quién visitar:
 *      1) vencidas (daysSince > frecuenciaObjetivoDias)
 *      2) próximas (nextISO dentro de 7 días)
 *  ========================= */
function renderPredicciones(el, farmacias, pedidos, settings) {
  const now = new Date();
  const qKey = quarterKey(now);
  const { start, end } = quarterStartEnd(now);

  const pedidosOk = getPedidosOk(pedidos);
  const totalTrim = sumPedidosInRange(pedidosOk, start, end);

  const objetivo = getQuarterTarget(settings, qKey);
  const faltan = Math.max(0, objetivo - totalTrim);

  const daysLeft = daysRemainingInQuarter(now);
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const porSemana = objetivo > 0 ? (faltan / weeksLeft) : 0;
  const porDia = objetivo > 0 ? (faltan / Math.max(1, daysLeft)) : 0;

  const okMap = getPedidosByFarmacia(pedidosOk);

  const list = farmacias.map(f => {
    const st = farmaciaStats(f, okMap);
    const freq = Number(f.frecuenciaObjetivoDias || 0) || (st.avgDays ? Math.round(st.avgDays) : 21);
    const due = st.daysSince !== null ? (st.daysSince >= freq) : false;

    const next = st.nextISO ? new Date(st.nextISO) : null;
    const daysToNext = next ? Math.round((next - now) / (1000*60*60*24)) : null;
    const soon = daysToNext !== null ? (daysToNext >= 0 && daysToNext <= 7) : false;

    return {
      f,
      st,
      freq,
      due,
      soon,
      daysToNext
    };
  });

  const vencidas = list.filter(x => x.due).sort((a,b)=> (b.st.daysSince||0) - (a.st.daysSince||0));
  const proximas = list.filter(x => !x.due && x.soon).sort((a,b)=> (a.daysToNext||999) - (b.daysToNext||999));

  el.innerHTML = `
    <div class="card">
      <h2>Predicciones · ${escapeHtml(qKey)}</h2>
      <div class="muted">
        Se recalcula cada día en base al objetivo trimestral y a tu histórico de pedidos (offline).
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Ritmo para alcanzar objetivo</h2>
          <div class="mini">Ventas trimestre: <b>${fmtEur(totalTrim)}</b></div>
          <div class="mini">Objetivo: <b>${objetivo ? fmtEur(objetivo) : "—"}</b></div>
          <div class="mini">Faltan: <b>${objetivo ? fmtEur(faltan) : "—"}</b></div>
          <div class="hr"></div>
          <div class="kpi" style="grid-template-columns:repeat(2,1fr)">
            <div class="k">
              <div class="v">${objetivo ? fmtEur(porSemana) : "—"}</div>
              <div class="t">a vender por semana</div>
            </div>
            <div class="k">
              <div class="v">${objetivo ? fmtEur(porDia) : "—"}</div>
              <div class="t">a vender por día</div>
            </div>
          </div>
          ${objetivo === 0 ? `<div class="mini muted" style="margin-top:10px">Configura objetivos en Ajustes (PARTE 5).</div>` : ``}
        </div>

        <div class="card" style="margin:0">
          <h2>Sugerencias de visita</h2>
          <div class="mini">Prioridad: vencidas (ya tocaba pedir) y próximas (estimación ≤ 7 días).</div>
          <div class="hr"></div>
          <div class="flex">
            <button class="btn-primary" id="goFarm">Ver Farmacias</button>
            <button class="btn" id="goDash">Dashboard</button>
          </div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Vencidas (${vencidas.length})</h2>
          ${renderSuggestionTable(vencidas, "vencida")}
        </div>

        <div class="card" style="margin:0">
          <h2>Próximas (≤ 7 días) (${proximas.length})</h2>
          ${renderSuggestionTable(proximas, "proxima")}
        </div>
      </div>
    </div>
  `;

  $("#goFarm").onclick = ()=>setView("farmacias");
  $("#goDash").onclick = ()=>setView("dash");

  // enlazar botones detalles/checkin
  $$("#predTable button[data-act]").forEach(btn=>{
    btn.onclick = async (e)=>{
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const f = farmacias.find(x=>x.id===id);
      if(!f) return;
      if(act==="details"){
        const pedidosAll = await dbAll("pedidos");
        openPharmacyDetails(f, pedidosAll);
      }
      if(act==="checkin"){
        // PARTE 5 implementa openCheckinModal completa
        if(typeof openCheckinModal === "function") openCheckinModal(id);
        else toast("Check-in se activa en PARTE 5/5");
      }
    };
  });

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

function renderSuggestionTable(items, mode) {
  if(!items.length) return `<div class="muted">—</div>`;

  const rows = items.slice(0, 25).map(x=>{
    const f = x.f;
    const st = x.st;
    const mapLink = mapsLinkForAddress(f.direccion||"");
    const last = st.lastISO ? fmtDate(st.lastISO) : "—";
    const next = st.nextISO ? fmtDate(st.nextISO) : "—";
    const badge = mode==="vencida"
      ? `<span class="pill warn">vencida</span>`
      : `<span class="pill ok">próxima</span>`;

    const extra = mode==="vencida"
      ? (st.daysSince!==null ? `${st.daysSince} días desde último` : "sin histórico")
      : (x.daysToNext!==null ? `en ${x.daysToNext} días` : "—");

    return `
      <tr>
        <td>
          <b>${escapeHtml(f.nombre||"")}</b><br>
          <span class="mini">${badge} <span class="muted">${escapeHtml(extra)}</span></span>
        </td>
        <td class="mini">
          <div>Último: <b>${last}</b></div>
          <div>Estimado: <b>${next}</b></div>
        </td>
        <td class="right">
          <button class="btn-primary btn-xs" data-act="details" data-id="${f.id}">Detalles</button>
          <button class="btn btn-xs" data-act="checkin" data-id="${f.id}">Check-in</button>
          ${mapLink ? `<a class="btn btn-xs" href="${mapLink}" target="_blank" rel="noopener">Maps</a>` : ""}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div style="overflow:auto; max-height:520px">
      <table id="predTable">
        <thead><tr><th>Farmacia</th><th>Pedido</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/** =========================
 *  Modal Detalles farmacia
 *  - Últimos pedidos
 *  - Próximo pedido estimado (media últimos 10, min 3)
 *  - Botón Check-in + pedido
 *  ========================= */
function ensurePharmacyDialog() {
  let dlg = $("#pharmacyDlg");
  if (dlg) return dlg;

  // si tu index.html no lo tiene, lo inyectamos
  dlg = document.createElement("dialog");
  dlg.id = "pharmacyDlg";
  dlg.innerHTML = `
    <div class="dlg-head">
      <div class="row">
        <div>
          <b id="phTitle">Detalles</b><br>
          <span class="mini" id="phSubtitle"></span>
        </div>
        <div class="right">
          <button class="btn" id="phClose">Cerrar</button>
        </div>
      </div>
    </div>
    <div class="dlg-body" id="phBody"></div>
    <div class="dlg-foot"><div class="mini">Todo offline.</div></div>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

function openPharmacyDetails(farmacia, pedidosAll) {
  const dlg = ensurePharmacyDialog();

  const pedidosCli = pedidosAll
    .filter(p=>p.farmaciaId === farmacia.id)
    .slice()
    .sort((a,b)=> new Date(b.fecha) - new Date(a.fecha));

  const pedidosOk = pedidosCli.filter(p=>["confirmado","entregado"].includes(p.estado));
  const totalVentas = pedidosOk.reduce((a,p)=>a+Number(p.total||0),0);

  const nextISO = estimateNextOrderISO(farmacia.id, pedidosOk) ||
                  (pedidosOk.length ? (()=> {
                    const last = new Date(pedidosOk[0].fecha);
                    const freq = Number(farmacia.frecuenciaObjetivoDias||0) || 21;
                    last.setDate(last.getDate()+freq);
                    return last.toISOString();
                  })() : null);

  const nextTxt = nextISO ? fmtDate(nextISO) : "—";

  const last10 = pedidosCli.slice(0, 10);
  const m = mapsLinkForAddress(farmacia.direccion || "");

  const titleEl = $("#phTitle");
  const subEl = $("#phSubtitle");
  const bodyEl = $("#phBody");

  if (titleEl) titleEl.textContent = `Detalles · ${farmacia.nombre}`;
  if (subEl) subEl.textContent = farmacia.direccion || "";

  const reqMin = (pedidosOk.length < 3) ? `<span class="pill warn">mín. 3 pedidos para estimación real</span>` : `<span class="pill ok">estimación basada en histórico</span>`;

  bodyEl.innerHTML = `
    <div class="card" style="margin:0">
      <div class="row">
        <div>
          <b>${escapeHtml(farmacia.nombre||"")}</b>
          <span class="muted">${escapeHtml(farmacia.apodo||"")}</span><br>
          <span class="mini">${escapeHtml((farmacia.etiquetas||[]).join(", "))}</span>
        </div>
        <div class="right flex">
          ${m ? `<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>` : ""}
          <button class="btn btn-xs" id="phCheckin">Check-in + pedido</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="kpi">
        <div class="k"><div class="v">${pedidosCli.length}</div><div class="t">Pedidos registrados</div></div>
        <div class="k"><div class="v">${fmtEur(totalVentas)}</div><div class="t">Ventas acumuladas</div></div>
        <div class="k"><div class="v">${nextTxt}</div><div class="t">Próximo pedido estimado</div></div>
        <div class="k"><div class="v">${farmacia.frecuenciaObjetivoDias||"—"}</div><div class="t">Frecuencia objetivo (días)</div></div>
      </div>

      <div class="mini" style="margin-top:8px">${reqMin}</div>

      <div class="hr"></div>

      <h2>Últimos pedidos</h2>
      ${
        last10.length
          ? `
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Total</th><th>Notas</th></tr></thead>
          <tbody>
            ${last10.map(p=>{
              const cls = p.estado==="entregado" ? "ok" : (p.estado==="confirmado" ? "warn" : "bad");
              return `
                <tr>
                  <td>${fmtDate(p.fecha)}</td>
                  <td><span class="pill ${cls}">${escapeHtml(p.estado||"")}</span></td>
                  <td>${fmtEur(p.total||0)}</td>
                  <td class="mini">${escapeHtml((p.notas||"").slice(0,120))}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `
          : `<div class="muted">Aún no hay pedidos para esta farmacia.</div>`
      }
    </div>
  `;

  const closeBtn = $("#phClose");
  if (closeBtn) closeBtn.onclick = ()=>dlg.close();
  const checkBtn = $("#phCheckin");
  if (checkBtn) checkBtn.onclick = ()=>{
    dlg.close();
    if (typeof openCheckinModal === "function") openCheckinModal(farmacia.id);
    else toast("Check-in se activa en PARTE 5/5");
  };

  dlg.showModal();
}
/* =========================================================
   app.js — PARTE 5A/5 (de 3)
   Ajustes (objetivos trimestrales + preferencias offline)
   ========================================================= */

/** =========================
 *  View: Ajustes
 *  ========================= */
function renderAjustes(el, settings) {
  const qNow = quarterKey(new Date());
  const currentTarget = getQuarterTarget(settings, qNow);

  // Pintamos en orden por año/trimestre si existen
  const keys = Object.keys(settings.quarterlyTargets || {});
  keys.sort((a,b)=>{
    // formato "1T26" -> [26,1]
    const pa = a.match(/^(\d)T(\d\d)$/);
    const pb = b.match(/^(\d)T(\d\d)$/);
    if(!pa || !pb) return a.localeCompare(b);
    const ya = Number(pa[2]), qa = Number(pa[1]);
    const yb = Number(pb[2]), qb = Number(pb[1]);
    return ya===yb ? qa-qb : ya-yb;
  });

  el.innerHTML = `
    <div class="card">
      <h2>Ajustes</h2>
      <div class="muted">Todo se guarda offline (IndexedDB).</div>

      <div class="hr"></div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Objetivos por trimestre</h2>
          <div class="mini">
            Trimestre actual: <b>${escapeHtml(qNow)}</b> ·
            Objetivo: <b>${currentTarget ? fmtEur(currentTarget) : "—"}</b>
          </div>

          <div class="hr"></div>

          <form id="targetForm">
            <div class="grid two">
              <div>
                <label>Clave trimestre</label>
                <input name="qkey" placeholder="Ej: 1T26"
                  data-help="Formato: 1T26, 2T26, 3T26, 4T26 (T=trimestre, 26=año 2026)." />
              </div>
              <div>
                <label>Objetivo</label>
                <input name="qval" placeholder="Ej: 180000 o 180K"
                  data-help="Puedes escribir 180000 o 180K. Se interpreta en euros." />
              </div>
            </div>

            <div class="helpbox mini" id="targetsHelp">Toca un campo para ver ayuda.</div>

            <div class="hr"></div>

            <div class="flex">
              <button class="btn-primary" type="submit">Guardar / Actualizar</button>
              <button class="btn-danger" type="button" id="btnDeleteTarget">Borrar clave</button>
            </div>

            <div class="mini" style="margin-top:10px">
              Claves guardadas: <b>${keys.length}</b>
            </div>
          </form>

          <div class="hr"></div>

          <div style="overflow:auto; max-height:320px">
            <table>
              <thead>
                <tr><th>Trimestre</th><th>Objetivo</th><th></th></tr>
              </thead>
              <tbody>
                ${
                  keys.length ? keys.map(k=>{
                    const v = Number(settings.quarterlyTargets[k]||0);
                    return `
                      <tr>
                        <td><b>${escapeHtml(k)}</b></td>
                        <td>${v ? `${fmtEur(v)} <span class="muted">(${escapeHtml(formatTargetShort(v))})</span>` : "—"}</td>
                        <td class="right"><button class="btn btn-xs" data-pick="${escapeHtml(k)}">Editar</button></td>
                      </tr>
                    `;
                  }).join("") : `<tr><td colspan="3" class="muted">Aún no hay objetivos. Añade el primero.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin:0">
          <h2>Preferencias offline</h2>

          <form id="prefsForm">
            <label>Autobackup</label>
            <select name="autoBackupEnabled" data-help="Si está activado, la app te sugerirá backups periódicos.">
              <option value="true" ${settings.autoBackupEnabled ? "selected":""}>Activado</option>
              <option value="false" ${!settings.autoBackupEnabled ? "selected":""}>Desactivado</option>
            </select>

            <label>Cada cuántos días</label>
            <input name="autoBackupEveryDays" type="number" min="1" step="1"
              value="${Number(settings.autoBackupEveryDays||7)}"
              data-help="Frecuencia recomendada del backup (no requiere internet)." />

            <label>Conservar nº backups</label>
            <input name="keepBackups" type="number" min="1" step="1"
              value="${Number(settings.keepBackups||10)}"
              data-help="Número máximo de backups locales a conservar." />

            <div class="hr"></div>

            <h2>Rutas / visitas</h2>

            <label>Paradas por ruta (por defecto)</label>
            <input name="routeDefaultStops" type="number" min="1" step="1"
              value="${Number(settings.routeDefaultStops||8)}"
              data-help="Cuántas farmacias sugiere la app en una ruta diaria." />

            <label>Mostrar solo vencidas (por defecto)</label>
            <select name="routeOnlyDue" data-help="Si activas, la ruta sugerida prioriza farmacias a las que ya tocaba pedir.">
              <option value="true" ${settings.routeOnlyDue ? "selected":""}>Sí</option>
              <option value="false" ${!settings.routeOnlyDue ? "selected":""}>No</option>
            </select>

            <div class="helpbox mini" id="prefsHelp">Toca un campo para ver ayuda.</div>

            <div class="hr"></div>

            <button class="btn-primary" type="submit">Guardar preferencias</button>
          </form>

          <div class="hr"></div>

          <div class="mini muted">
            Nota: en PARTE 5C tendrás Backup completo (export/import JSON) y Rutas.
          </div>
        </div>
      </div>
    </div>
  `;

  // ayudas
  attachHelp($("#targetForm"), $("#targetsHelp"));
  attachHelp($("#prefsForm"), $("#prefsHelp"));

  // click "Editar" en tabla -> rellena form
  $$("button[data-pick]").forEach(btn=>{
    btn.onclick = ()=>{
      const k = btn.dataset.pick;
      const v = settings.quarterlyTargets?.[k];
      const f = $("#targetForm");
      f.qkey.value = k;
      f.qval.value = v ? formatTargetShort(v) : "";
      toast("Editando objetivo " + k);
    };
  });

  // guardar/actualizar objetivo
  $("#targetForm").onsubmit = async (e)=>{
    e.preventDefault();
    const f = e.target;
    const k = String(f.qkey.value||"").trim().toUpperCase();
    const raw = String(f.qval.value||"").trim();

    if(!/^[1-4]T\d\d$/.test(k)){
      toast("Clave inválida. Usa 1T26, 2T26, 3T26, 4T26");
      return;
    }

    const val = parseTargetValue(raw);
    if(!val || val < 0){
      toast("Objetivo inválido (usa 180000 o 180K)");
      return;
    }

    const targets = {...(settings.quarterlyTargets||{})};
    targets[k] = val;

    await saveSetting("quarterlyTargets", targets);
    toast("Objetivo guardado: " + k);
    render();
  };

  // borrar objetivo
  $("#btnDeleteTarget").onclick = async ()=>{
    const f = $("#targetForm");
    const k = String(f.qkey.value||"").trim().toUpperCase();
    if(!k) return toast("Indica una clave (ej: 1T26) para borrar");
    const targets = {...(settings.quarterlyTargets||{})};
    if(!(k in targets)) return toast("Esa clave no existe");
    if(!confirm("¿Borrar el objetivo " + k + "?")) return;
    delete targets[k];
    await saveSetting("quarterlyTargets", targets);
    toast("Objetivo borrado");
    render();
  };

  // guardar preferencias
  $("#prefsForm").onsubmit = async (e)=>{
    e.preventDefault();
    const f = e.target;

    const autoBackupEnabled = (f.autoBackupEnabled.value === "true");
    const autoBackupEveryDays = Math.max(1, Number(f.autoBackupEveryDays.value||7));
    const keepBackups = Math.max(1, Number(f.keepBackups.value||10));
    const routeDefaultStops = Math.max(1, Number(f.routeDefaultStops.value||8));
    const routeOnlyDue = (f.routeOnlyDue.value === "true");

    await saveSetting("autoBackupEnabled", autoBackupEnabled);
    await saveSetting("autoBackupEveryDays", autoBackupEveryDays);
    await saveSetting("keepBackups", keepBackups);
    await saveSetting("routeDefaultStops", routeDefaultStops);
    await saveSetting("routeOnlyDue", routeOnlyDue);

    toast("Preferencias guardadas");
    render();
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================
 *  Router: añade la vista "ajustes"
 *  (envolvemos el render actual)
 *  ========================= */
const _renderPrev_5A = render;
render = async function renderWrapped5A(){
  const el = $("#view");
  const settings = await loadSettings();

  if (STATE.view === "ajustes") {
    return renderAjustes(el, settings);
  }
  return _renderPrev_5A();
};
/* =========================================================
   app.js — PARTE 5B/5 (de 3)
   Check-in + pedido (Interacciones offline)
   ========================================================= */

/** =========================
 *  Modal check-in (inyectar si no existe)
 *  ========================= */
function ensureCheckinDialog() {
  let dlg = $("#checkinDlg");
  if (dlg) return dlg;

  dlg = document.createElement("dialog");
  dlg.id = "checkinDlg";
  document.body.appendChild(dlg);
  return dlg;
}

/** =========================
 *  Crear pedido rápido
 *  - crea un pedido con 1 línea "(pendiente detallar)" si hay importe
 *  - vinculado a farmaciaId
 *  ========================= */
async function createQuickPedido({ farmaciaId, fechaISO, importe, canal, notas }) {
  const imp = Number(importe || 0);
  const has = imp > 0;

  const pedido = recomputePedido({
    id: uid(),
    farmaciaId,
    fecha: fechaISO,
    fechaEntrega: "",
    estado: "confirmado",
    canal: canal || "visita",
    comercial: "delegada",
    notas: notas || "Pedido creado desde check-in (rápido)",
    lineas: has
      ? [{
          id: uid(),
          productoId: "",
          nombre: "(pendiente detallar)",
          cantidad: 1,
          precioUnit: imp,
          descuentoPct: 0,
          total: imp
        }]
      : [],
    total: has ? imp : 0,
    creadoEn: nowISO(),
    actualizadoEn: nowISO()
  });

  await dbPut("pedidos", pedido);
  return pedido;
}

/** =========================
 *  openCheckinModal(farmaciaId)
 *  - guarda interacción
 *  - opcional: crear pedido rápido
 *  ========================= */
async function openCheckinModal(farmaciaId) {
  const dlg = ensureCheckinDialog();
  const farmacia = await dbGet("farmacias", farmaciaId);
  if (!farmacia) return toast("Farmacia no encontrada");

  const maps = mapsLinkForAddress(farmacia.direccion || "");

  dlg.innerHTML = `
    <div class="dlg-head">
      <div class="row">
        <div>
          <b>Check-in · ${escapeHtml(farmacia.nombre || "")}</b><br>
          <span class="mini">${escapeHtml(farmacia.direccion || "")}</span>
        </div>
        <div class="right flex">
          ${maps ? `<a class="btn btn-xs" href="${maps}" target="_blank" rel="noopener">Maps</a>` : ""}
          <button class="btn" id="ciClose">Cerrar</button>
        </div>
      </div>
    </div>

    <div class="dlg-body">
      <form id="ciForm">
        <input type="hidden" name="farmaciaId" value="${escapeHtml(farmaciaId)}" />

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input type="date" name="fecha" required value="${isoDateOnly(new Date())}"
              data-help="Fecha del contacto/visita. Por defecto hoy." />
          </div>
          <div>
            <label>Tipo</label>
            <select name="tipo" data-help="Tipo de interacción registrada.">
              <option value="visita" selected>visita</option>
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
              <option value="ok" selected>ok</option>
              <option value="pendiente">pendiente</option>
              <option value="sin_respuesta">sin respuesta</option>
              <option value="rechazo">rechazo</option>
            </select>
          </div>
          <div>
            <label>Próxima acción (opcional)</label>
            <input name="proximaAccion" placeholder="Ej: enviar promo / volver jueves"
              data-help="Se guarda como recordatorio interno para próximas visitas." />
          </div>
        </div>

        <label>Notas</label>
        <textarea name="notas" placeholder="Necesidades, objeciones, stock, competencia..."
          data-help="Anota lo importante: necesidades, objeciones, acuerdos, reposición, etc."></textarea>

        <div class="hr"></div>

        <h2>¿Check-in + pedido?</h2>

        <div class="grid two">
          <div>
            <label>Crear pedido ahora</label>
            <select name="crearPedido" data-help="Si en la visita se confirma pedido, créalo al guardar.">
              <option value="no" selected>no</option>
              <option value="si">sí</option>
            </select>
          </div>
          <div>
            <label>Importe total (rápido)</label>
            <input name="importe" type="number" min="0" step="0.01" placeholder="Ej: 250"
              data-help="Importe total del pedido. Luego podrás detallarlo en la vista Pedidos (PARTE 5C)." />
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Canal</label>
            <select name="canal" data-help="Cómo se originó el pedido.">
              <option value="visita" selected>visita</option>
              <option value="telefono">teléfono</option>
              <option value="email">email</option>
              <option value="whatsapp">whatsapp</option>
            </select>
          </div>
          <div>
            <label>Estado del pedido</label>
            <select name="estadoPedido" data-help="Estado inicial del pedido al crearlo rápido.">
              <option value="confirmado" selected>confirmado</option>
              <option value="entregado">entregado</option>
              <option value="borrador">borrador</option>
            </select>
          </div>
        </div>

        <div class="helpbox mini" id="ciHelp">Toca un campo para ver ayuda.</div>

        <div class="hr"></div>

        <div class="flex">
          <button class="btn-primary" type="submit">Guardar</button>
          <button class="btn" type="button" id="ciQuickOk">Guardar como OK</button>
        </div>
      </form>
    </div>

    <div class="dlg-foot">
      <div class="mini">Se guarda offline en tu dispositivo.</div>
    </div>
  `;

  // cierre
  $("#ciClose").onclick = () => dlg.close();

  // ayudas
  attachHelp($("#ciForm"), $("#ciHelp"));

  // botón "Guardar como OK" (atajo)
  $("#ciQuickOk").onclick = () => {
    const f = $("#ciForm");
    f.resultado.value = "ok";
    f.tipo.value = f.tipo.value || "visita";
    f.requestSubmit();
  };

  // submit
  $("#ciForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;

    const fechaISO = fromDateOnly(f.fecha.value);
    const tipo = f.tipo.value;
    const resultado = f.resultado.value;
    const proximaAccion = (f.proximaAccion.value || "").trim();
    const notas = (f.notas.value || "").trim();

    // 1) Guardar interacción
    const inter = {
      id: uid(),
      farmaciaId,
      fecha: fechaISO,
      tipo,
      resultado,
      proximaAccion,
      notas,
      creadoEn: nowISO(),
      actualizadoEn: nowISO()
    };
    await dbPut("interacciones", inter);

    // 2) Pedido rápido opcional
    const crearPedido = f.crearPedido.value === "si";
    let pedidoCreado = null;

    if (crearPedido) {
      const importe = Number(f.importe.value || 0);
      const canal = f.canal.value || "visita";
      const estadoPedido = f.estadoPedido.value || "confirmado";

      pedidoCreado = await createQuickPedido({
        farmaciaId,
        fechaISO,
        importe,
        canal,
        notas: "Pedido creado desde Check-in + pedido"
      });

      // Actualizar estado si no es el default
      if (estadoPedido && estadoPedido !== "confirmado") {
        pedidoCreado.estado = estadoPedido;
        pedidoCreado.actualizadoEn = nowISO();
        await dbPut("pedidos", pedidoCreado);
      }
    }

    dlg.close();

    if (pedidoCreado) {
      toast(`Check-in + pedido guardado (${fmtEur(pedidoCreado.total || 0)})`);
    } else {
      toast("Check-in guardado");
    }

    // refrescar vistas
    render();
  };

  dlg.showModal();
}

/** =========================
 *  Hook: si abres Detalles y no estaba definido el check-in (antes PARTE 5),
 *  ahora ya está.
 *  ========================= */
/* =========================================================
   app.js — PARTE 5C/5 (de 3)
   Productos + Pedidos + Interacciones + Backup + Rutas
   + router final (wrap render)
   ========================================================= */

/** =========================
 *  Helpers comunes UI
 *  ========================= */
function ensureGenericDialog(id, title) {
  let dlg = document.getElementById(id);
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = id;
  dlg.innerHTML = `
    <div class="dlg-head">
      <div class="row">
        <div><b id="${id}_title">${escapeHtml(title || "")}</b></div>
        <div class="right"><button class="btn" id="${id}_close">Cerrar</button></div>
      </div>
    </div>
    <div class="dlg-body" id="${id}_body"></div>
    <div class="dlg-foot"><div class="mini">Offline</div></div>
  `;
  document.body.appendChild(dlg);
  document.getElementById(`${id}_close`).onclick = () => dlg.close();
  return dlg;
}

function clamp(n, a, b) {
  n = Number(n || 0);
  return Math.max(a, Math.min(b, n));
}

function toNum(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** =========================================================
 *  PRODUCTOS (CRUD)
 *  ========================================================= */
function renderProductos(el, productos) {
  el.innerHTML = `
    <div class="card">
      <div class="row">
        <h2>Productos (${productos.length})</h2>
        <div class="right flex">
          <button class="btn-primary" id="pAdd">+ Nuevo</button>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Buscar</label>
          <input id="pQ" placeholder="Nombre / descripción"
            data-help="Filtra productos por nombre o descripción." />
        </div>
        <div>
          <label>Mostrar</label>
          <select id="pShow" data-help="Puedes ocultar inactivos para ir más rápido.">
            <option value="all" selected>Todos</option>
            <option value="active">Solo activos</option>
          </select>
        </div>
      </div>

      <div class="helpbox mini" id="pHelp">Toca un campo para ver ayuda.</div>
      <div class="hr"></div>

      <div style="overflow:auto; max-height:620px">
        <table id="pTable">
          <thead><tr><th>Producto</th><th>Precio</th><th>Activo</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  attachHelp(el, $("#pHelp"));

  const renderRows = () => {
    const q = ($("#pQ").value || "").trim().toLowerCase();
    const show = $("#pShow").value;

    let arr = productos.slice().sort((a,b)=> (a.nombre||"").localeCompare(b.nombre||""));
    if (show === "active") arr = arr.filter(x => x.activo !== false);
    if (q) {
      arr = arr.filter(x => ((x.nombre||"")+" "+(x.descripcion||"")).toLowerCase().includes(q));
    }

    $("#pTable tbody").innerHTML = arr.map(p => `
      <tr data-id="${p.id}">
        <td><b>${escapeHtml(p.nombre||"")}</b><br><span class="mini muted">${escapeHtml((p.descripcion||"").slice(0,120))}</span></td>
        <td>${fmtEur(p.precio||0)}</td>
        <td>${p.activo === false ? `<span class="pill bad">no</span>` : `<span class="pill ok">sí</span>`}</td>
        <td class="right">
          <button class="btn btn-xs" data-act="edit">Editar</button>
          <button class="btn-danger btn-xs" data-act="del">Borrar</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Sin productos.</td></tr>`;
  };

  renderRows();
  $("#pQ").oninput = renderRows;
  $("#pShow").onchange = renderRows;

  $("#pAdd").onclick = () => openProductoModal(null);

  $("#pTable").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;

    if (btn.dataset.act === "edit") {
      const p = await dbGet("productos", id);
      openProductoModal(p);
    }
    if (btn.dataset.act === "del") {
      if (!confirm("¿Borrar producto?")) return;
      await dbDel("productos", id);
      toast("Producto borrado");
      render();
    }
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

function openProductoModal(prod) {
  const dlg = ensureGenericDialog("prodDlg", "Producto");
  const body = $("#prodDlg_body");
  const isEdit = !!prod;

  body.innerHTML = `
    <form id="prodForm">
      <div class="grid two">
        <div>
          <label>Nombre</label>
          <input name="nombre" required value="${escapeHtml(prod?.nombre||"")}"
            placeholder="Ej: Complemento X"
            data-help="Nombre comercial del producto." />
        </div>
        <div>
          <label>Precio</label>
          <input name="precio" type="number" min="0" step="0.01"
            value="${prod?.precio ?? ""}"
            placeholder="Ej: 45"
            data-help="Precio estándar (puedes cambiarlo en el pedido si hace falta)." />
        </div>
      </div>

      <label>Descripción</label>
      <textarea name="descripcion" placeholder="Qué es / indicaciones / puntos clave"
        data-help="Descripción breve para recordar el producto al hacer pedidos.">${escapeHtml(prod?.descripcion||"")}</textarea>

      <label>Activo</label>
      <select name="activo" data-help="Si lo desactivas, no aparece por defecto en pedidos.">
        <option value="true" ${(prod?.activo ?? true) ? "selected":""}>sí</option>
        <option value="false" ${(prod?.activo ?? true) ? "": "selected"}>no</option>
      </select>

      <div class="helpbox mini" id="prodHelp">Toca un campo para ver ayuda.</div>
      <div class="hr"></div>

      <button class="btn-primary" type="submit">${isEdit ? "Guardar" : "Crear"}</button>
    </form>
  `;

  attachHelp(body, $("#prodHelp"));

  $("#prodForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;

    const obj = {
      id: prod?.id || uid(),
      nombre: (f.nombre.value || "").trim(),
      descripcion: (f.descripcion.value || "").trim(),
      precio: toNum(f.precio.value),
      activo: f.activo.value === "true",
      creadoEn: prod?.creadoEn || nowISO(),
      actualizadoEn: nowISO()
    };

    await dbPut("productos", obj);
    dlg.close();
    toast(isEdit ? "Producto guardado" : "Producto creado");
    render();
  };

  dlg.showModal();
}

/** =========================================================
 *  PEDIDOS (crear/editar)
 *  ========================================================= */
function renderPedidos(el, farmacias, productos, pedidos) {
  const farmById = new Map(farmacias.map(f => [f.id, f]));
  el.innerHTML = `
    <div class="card">
      <div class="row">
        <h2>Pedidos (${pedidos.length})</h2>
        <div class="right flex">
          <button class="btn-primary" id="oAdd">+ Nuevo pedido</button>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Filtrar por farmacia</label>
          <select id="oFarm" data-help="Filtra pedidos por una farmacia concreta.">
            <option value="">Todas</option>
            ${farmacias.slice().sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""))
              .map(f=>`<option value="${f.id}">${escapeHtml(f.nombre||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Estado</label>
          <select id="oState" data-help="Puedes ver solo confirmados/entregados para KPIs.">
            <option value="">Todos</option>
            <option value="borrador">borrador</option>
            <option value="confirmado">confirmado</option>
            <option value="entregado">entregado</option>
            <option value="cancelado">cancelado</option>
          </select>
        </div>
      </div>

      <div class="helpbox mini" id="oHelp">Toca un campo para ver ayuda.</div>
      <div class="hr"></div>

      <div style="overflow:auto; max-height:620px">
        <table id="oTable">
          <thead><tr><th>Fecha</th><th>Farmacia</th><th>Estado</th><th>Total</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  attachHelp(el, $("#oHelp"));

  const renderRows = () => {
    const farmId = $("#oFarm").value;
    const st = $("#oState").value;

    let arr = pedidos.slice().sort((a,b)=> new Date(b.fecha) - new Date(a.fecha));
    if (farmId) arr = arr.filter(p=>p.farmaciaId===farmId);
    if (st) arr = arr.filter(p=>p.estado===st);

    $("#oTable tbody").innerHTML = arr.map(p=>{
      const f = farmById.get(p.farmaciaId);
      const cls = p.estado==="entregado" ? "ok" : (p.estado==="confirmado" ? "warn" : (p.estado==="borrador" ? "" : "bad"));
      return `
        <tr data-id="${p.id}">
          <td>${fmtDate(p.fecha)}</td>
          <td>${escapeHtml(f?.nombre || "—")}</td>
          <td><span class="pill ${cls}">${escapeHtml(p.estado||"")}</span></td>
          <td><b>${fmtEur(p.total||0)}</b></td>
          <td class="right">
            <button class="btn btn-xs" data-act="edit">Editar</button>
            <button class="btn-danger btn-xs" data-act="del">Borrar</button>
          </td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="5" class="muted">Sin pedidos.</td></tr>`;
  };

  renderRows();
  $("#oFarm").onchange = renderRows;
  $("#oState").onchange = renderRows;

  $("#oAdd").onclick = () => openPedidoModal(null, farmacias, productos);

  $("#oTable").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;

    if (btn.dataset.act === "edit") {
      const p = await dbGet("pedidos", id);
      openPedidoModal(p, farmacias, productos);
    }
    if (btn.dataset.act === "del") {
      if (!confirm("¿Borrar pedido?")) return;
      await dbDel("pedidos", id);
      toast("Pedido borrado");
      render();
    }
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

function openPedidoModal(pedido, farmacias, productos) {
  const dlg = ensureGenericDialog("pedidoDlg", "Pedido");
  const body = $("#pedidoDlg_body");
  const isEdit = !!pedido;

  const p = pedido ? JSON.parse(JSON.stringify(pedido)) : recomputePedido({
    id: uid(),
    farmaciaId: farmacias[0]?.id || "",
    fecha: fromDateOnly(isoDateOnly(new Date())),
    fechaEntrega: "",
    estado: "confirmado",
    canal: "visita",
    comercial: "delegada",
    notas: "",
    lineas: [],
    total: 0,
    creadoEn: nowISO(),
    actualizadoEn: nowISO()
  });

  const prodById = new Map(productos.map(x=>[x.id,x]));
  const prodOptions = productos
    .filter(x=>x.activo !== false)
    .slice()
    .sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""))
    .map(x=>`<option value="${x.id}">${escapeHtml(x.nombre||"")}</option>`)
    .join("");

  const renderLines = () => {
    const tb = $("#lineTbody");
    const rows = (p.lineas||[]).map((l, idx)=>{
      const prod = l.productoId ? prodById.get(l.productoId) : null;
      return `
        <tr data-idx="${idx}">
          <td>
            <select data-f="productoId" data-help="Elige un producto.">
              <option value="">(pendiente)</option>
              ${prodOptions}
            </select>
            <div class="mini muted">${escapeHtml(prod?.descripcion?.slice(0,80) || "")}</div>
          </td>
          <td><input data-f="cantidad" type="number" min="0" step="1" value="${l.cantidad ?? 1}" data-help="Cantidad." /></td>
          <td><input data-f="precioUnit" type="number" min="0" step="0.01" value="${l.precioUnit ?? 0}" data-help="Precio unitario (puedes ajustarlo)." /></td>
          <td><input data-f="descuentoPct" type="number" min="0" max="100" step="0.1" value="${l.descuentoPct ?? 0}" data-help="Descuento % si aplica." /></td>
          <td><b>${fmtEur(l.total||0)}</b></td>
          <td class="right"><button class="btn-danger btn-xs" data-act="rm">X</button></td>
        </tr>
      `;
    }).join("");

    tb.innerHTML = rows || `<tr><td colspan="6" class="muted">Añade líneas de producto.</td></tr>`;

    // set selected values
    $$("#lineTbody tr").forEach(tr=>{
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;
      const l = p.lineas[idx];
      const sel = tr.querySelector('select[data-f="productoId"]');
      if (sel) sel.value = l.productoId || "";
    });

    $("#pedidoTotal").textContent = fmtEur(p.total||0);
  };

  body.innerHTML = `
    <form id="pedidoForm">
      <div class="grid two">
        <div>
          <label>Farmacia</label>
          <select name="farmaciaId" required data-help="Farmacia a la que pertenece el pedido.">
            ${farmacias.slice().sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""))
              .map(f=>`<option value="${f.id}">${escapeHtml(f.nombre||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Fecha pedido</label>
          <input name="fecha" type="date" required value="${isoDateOnly(new Date(p.fecha))}"
            data-help="Fecha del pedido." />
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Estado</label>
          <select name="estado" data-help="Borrador no cuenta para KPIs; confirmado/entregado sí.">
            <option value="borrador">borrador</option>
            <option value="confirmado">confirmado</option>
            <option value="entregado">entregado</option>
            <option value="cancelado">cancelado</option>
          </select>
        </div>
        <div>
          <label>Canal</label>
          <select name="canal" data-help="Origen del pedido.">
            <option value="visita">visita</option>
            <option value="telefono">teléfono</option>
            <option value="email">email</option>
            <option value="whatsapp">whatsapp</option>
          </select>
        </div>
      </div>

      <label>Notas</label>
      <textarea name="notas" placeholder="Condiciones, promociones, recordatorios..."
        data-help="Notas internas del pedido.">${escapeHtml(p.notas||"")}</textarea>

      <div class="hr"></div>

      <div class="row">
        <h2>Líneas</h2>
        <div class="right flex">
          <button class="btn" type="button" id="addLine">+ Línea</button>
        </div>
      </div>

      <div style="overflow:auto; max-height:360px">
        <table id="lineTable">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc%</th><th>Total</th><th></th></tr></thead>
          <tbody id="lineTbody"></tbody>
        </table>
      </div>

      <div class="hr"></div>

      <div class="row">
        <div class="mini muted">Total pedido</div>
        <div class="right"><b id="pedidoTotal">${fmtEur(p.total||0)}</b></div>
      </div>

      <div class="helpbox mini" id="pedidoHelp">Toca un campo para ver ayuda.</div>

      <div class="hr"></div>

      <button class="btn-primary" type="submit">${isEdit ? "Guardar" : "Crear"}</button>
    </form>
  `;

  // set selects
  const form = $("#pedidoForm");
  form.farmaciaId.value = p.farmaciaId || (farmacias[0]?.id || "");
  form.estado.value = p.estado || "confirmado";
  form.canal.value = p.canal || "visita";

  attachHelp(body, $("#pedidoHelp"));

  // init render
  recomputePedido(p);
  renderLines();

  // add line
  $("#addLine").onclick = () => {
    p.lineas.push({
      id: uid(),
      productoId: "",
      nombre: "",
      cantidad: 1,
      precioUnit: 0,
      descuentoPct: 0,
      total: 0
    });
    recomputePedido(p);
    renderLines();
  };

  // line interactions
  $("#lineTable").oninput = (e) => {
    const tr = e.target.closest("tr");
    if (!tr || tr.dataset.idx === undefined) return;
    const idx = Number(tr.dataset.idx);
    const l = p.lineas[idx];
    if (!l) return;

    const fld = e.target.dataset.f;
    if (!fld) return;

    if (fld === "productoId") {
      l.productoId = e.target.value || "";
      const prod = l.productoId ? prodById.get(l.productoId) : null;
      l.nombre = prod?.nombre || l.nombre || "";
      // si precioUnit es 0, sugerimos el precio del producto
      if (!l.precioUnit || l.precioUnit === 0) l.precioUnit = toNum(prod?.precio || 0);
    } else if (fld === "cantidad") {
      l.cantidad = clamp(toNum(e.target.value), 0, 999999);
    } else if (fld === "precioUnit") {
      l.precioUnit = clamp(toNum(e.target.value), 0, 999999999);
    } else if (fld === "descuentoPct") {
      l.descuentoPct = clamp(toNum(e.target.value), 0, 100);
    }

    recomputePedido(p);
    renderLines();
  };

  $("#lineTable").onchange = $("#lineTable").oninput;

  $("#lineTable").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const idx = Number(tr?.dataset?.idx);
    if (!Number.isFinite(idx)) return;

    if (btn.dataset.act === "rm") {
      p.lineas.splice(idx, 1);
      recomputePedido(p);
      renderLines();
    }
  };

  // submit
  form.onsubmit = async (e) => {
    e.preventDefault();

    p.farmaciaId = form.farmaciaId.value;
    p.fecha = fromDateOnly(form.fecha.value);
    p.estado = form.estado.value;
    p.canal = form.canal.value;
    p.notas = (form.notas.value || "").trim();
    p.actualizadoEn = nowISO();
    recomputePedido(p);

    await dbPut("pedidos", p);
    dlg.close();
    toast(isEdit ? "Pedido guardado" : "Pedido creado");
    render();
  };

  dlg.showModal();
}

/** =========================================================
 *  INTERACCIONES (histórico)
 *  ========================================================= */
function renderInteracciones(el, farmacias, interacciones) {
  const farmById = new Map(farmacias.map(f=>[f.id,f]));
  el.innerHTML = `
    <div class="card">
      <div class="row">
        <h2>Interacciones (${interacciones.length})</h2>
        <div class="right flex">
          <button class="btn-primary" id="iAdd">+ Check-in</button>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Farmacia</label>
          <select id="iFarm" data-help="Filtra por farmacia.">
            <option value="">Todas</option>
            ${farmacias.slice().sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""))
              .map(f=>`<option value="${f.id}">${escapeHtml(f.nombre||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Tipo</label>
          <select id="iType" data-help="Filtra por tipo de interacción.">
            <option value="">Todos</option>
            <option value="visita">visita</option>
            <option value="llamada">llamada</option>
            <option value="whatsapp">whatsapp</option>
            <option value="email">email</option>
          </select>
        </div>
      </div>

      <div class="hr"></div>

      <div style="overflow:auto; max-height:620px">
        <table id="iTable">
          <thead><tr><th>Fecha</th><th>Farmacia</th><th>Tipo</th><th>Resultado</th><th>Notas</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  const renderRows = () => {
    const farmId = $("#iFarm").value;
    const tipo = $("#iType").value;

    let arr = interacciones.slice().sort((a,b)=> new Date(b.fecha) - new Date(a.fecha));
    if (farmId) arr = arr.filter(x=>x.farmaciaId===farmId);
    if (tipo) arr = arr.filter(x=>x.tipo===tipo);

    $("#iTable tbody").innerHTML = arr.map(x=>{
      const f = farmById.get(x.farmaciaId);
      const cls = x.resultado==="ok" ? "ok" : (x.resultado==="pendiente" ? "warn" : "bad");
      return `
        <tr data-id="${x.id}">
          <td>${fmtDateTime(x.fecha)}</td>
          <td>${escapeHtml(f?.nombre || "—")}</td>
          <td>${escapeHtml(x.tipo||"")}</td>
          <td><span class="pill ${cls}">${escapeHtml(x.resultado||"")}</span></td>
          <td class="mini">${escapeHtml((x.notas||"").slice(0,120))}</td>
          <td class="right">
            <button class="btn-danger btn-xs" data-act="del">Borrar</button>
          </td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" class="muted">Sin interacciones.</td></tr>`;
  };

  renderRows();
  $("#iFarm").onchange = renderRows;
  $("#iType").onchange = renderRows;

  $("#iAdd").onclick = () => {
    // si hay farmacia seleccionada, abre esa; si no, la primera
    const id = $("#iFarm").value || farmacias[0]?.id;
    if (!id) return toast("No hay farmacias");
    openCheckinModal(id);
  };

  $("#iTable").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;
    if (btn.dataset.act === "del") {
      if (!confirm("¿Borrar interacción?")) return;
      await dbDel("interacciones", id);
      toast("Interacción borrada");
      render();
    }
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================================================
 *  BACKUP (export/import JSON) + snapshots locales
 *  ========================================================= */
async function makeBackupPayload() {
  const [farmacias, catalogo, productos, pedidos, interacciones, rutas, settings, meta] =
    await Promise.all([
      dbAll("farmacias"),
      dbAll("catalogo"),
      dbAll("productos"),
      dbAll("pedidos"),
      dbAll("interacciones"),
      dbAll("rutas"),
      (async()=> {
        const s = await loadSettings();
        return s;
      })(),
      dbAll("meta")
    ]);

  return {
    kind: "farmacias_offline_backup",
    version: 1,
    createdAt: nowISO(),
    data: { farmacias, catalogo, productos, pedidos, interacciones, rutas, settings, meta }
  };
}

async function applyBackupPayload(payload, mode) {
  // mode: "merge" | "replace"
  const d = payload?.data;
  if (!d) throw new Error("payload sin data");

  if (mode === "replace") {
    await Promise.all([
      dbClear("farmacias"),
      dbClear("catalogo"),
      dbClear("productos"),
      dbClear("pedidos"),
      dbClear("interacciones"),
      dbClear("rutas"),
      dbClear("settings"),
      dbClear("meta"),
    ]);
  }

  // stores arrays
  const putAll = async (store, arr, keyField) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      // asegura key
      if (!x) continue;
      if (keyField && !x[keyField]) continue;
      await dbPut(store, x);
    }
  };

  await putAll("farmacias", d.farmacias, "id");
  await putAll("catalogo", d.catalogo, "catalogId");
  await putAll("productos", d.productos, "id");
  await putAll("pedidos", d.pedidos, "id");
  await putAll("interacciones", d.interacciones, "id");
  await putAll("rutas", d.rutas, "id");

  // settings es objeto, lo guardamos por claves
  if (d.settings && typeof d.settings === "object") {
    for (const [k, v] of Object.entries(d.settings)) {
      await saveSetting(k, v);
    }
  }

  // meta
  await putAll("meta", d.meta, "key");
}

function renderBackup(el, settings, backups) {
  el.innerHTML = `
    <div class="card">
      <div class="row">
        <h2>Backup</h2>
        <div class="right flex">
          <button class="btn-primary" id="bExport">Exportar JSON</button>
          <button class="btn" id="bSnap">Crear snapshot</button>
        </div>
      </div>

      <div class="muted">Recomendación: exporta el JSON a iCloud/Drive cada cierto tiempo.</div>

      <div class="hr"></div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Importar</h2>
          <input type="file" id="bFile" accept=".json,application/json"
            data-help="Selecciona un backup exportado por la app." />
          <label>Modo importación</label>
          <select id="bMode" data-help="Merge combina datos. Replace borra TODO y restaura tal cual el backup.">
            <option value="merge" selected>Merge (combinar)</option>
            <option value="replace">Replace (reemplazar todo)</option>
          </select>

          <div class="helpbox mini" id="bHelp">Toca un campo para ver ayuda.</div>
          <div class="hr"></div>

          <button class="btn-primary" id="bImport">Importar</button>
        </div>

        <div class="card" style="margin:0">
          <h2>Snapshots locales (${backups.length})</h2>
          <div class="mini muted">Se guardan dentro de IndexedDB (útil como “punto de restauración”).</div>
          <div class="hr"></div>

          <div style="overflow:auto; max-height:420px">
            <table id="bTable">
              <thead><tr><th>Fecha</th><th></th></tr></thead>
              <tbody>
                ${
                  backups.slice().sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)).map(b=>`
                    <tr data-id="${b.id}">
                      <td>${fmtDateTime(b.createdAt)}</td>
                      <td class="right">
                        <button class="btn btn-xs" data-act="restore">Restaurar</button>
                        <button class="btn-danger btn-xs" data-act="del">Borrar</button>
                      </td>
                    </tr>
                  `).join("") || `<tr><td colspan="2" class="muted">Sin snapshots.</td></tr>`
                }
              </tbody>
            </table>
          </div>

          <div class="hr"></div>
          <div class="mini">
            Autobackup: <b>${settings.autoBackupEnabled ? "activado" : "desactivado"}</b> · cada <b>${settings.autoBackupEveryDays}</b> días · conservar <b>${settings.keepBackups}</b>
          </div>
        </div>
      </div>
    </div>
  `;

  attachHelp(el, $("#bHelp"));

  $("#bExport").onclick = async () => {
    const payload = await makeBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `backup_farmacias_${isoDateOnly(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup exportado");
  };

  $("#bImport").onclick = async () => {
    const file = $("#bFile").files[0];
    if (!file) return toast("Selecciona un archivo JSON");
    const mode = $("#bMode").value;
    const text = await file.text();

    let payload;
    try { payload = JSON.parse(text); } catch { return toast("JSON inválido"); }

    try {
      await applyBackupPayload(payload, mode);
      toast("Importación OK");
      render();
    } catch (e) {
      console.error(e);
      toast("No se pudo importar");
    }
  };

  $("#bSnap").onclick = async () => {
    const payload = await makeBackupPayload();
    const snap = { id: uid(), createdAt: payload.createdAt, payload };
    await dbPut("backups", snap);

    // limpieza: conserva keepBackups
    const all = await dbAll("backups");
    const keep = Number(settings.keepBackups || 10);
    const sorted = all.slice().sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const toDel = sorted.slice(keep);
    for (const x of toDel) await dbDel("backups", x.id);

    // marca último backup para recordatorio
    await dbPut("meta", { key: "lastBackupAt", value: payload.createdAt });

    toast("Snapshot creado");
    render();
  };

  $("#bTable").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;

    if (btn.dataset.act === "del") {
      if (!confirm("¿Borrar snapshot?")) return;
      await dbDel("backups", id);
      toast("Snapshot borrado");
      render();
    }

    if (btn.dataset.act === "restore") {
      if (!confirm("¿Restaurar este snapshot? (reemplaza todo)")) return;
      const snap = await dbGet("backups", id);
      if (!snap?.payload) return toast("Snapshot inválido");
      await applyBackupPayload(snap.payload, "replace");
      toast("Snapshot restaurado");
      render();
    }
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================================================
 *  RUTAS (planificador)
 *  - sugiere farmacias vencidas/próximas
 *  - guarda ruta con paradas
 *  - abre ruta en Maps (Google/Apple)
 *  ========================================================= */
function buildRouteMapsUrl(addresses) {
  // Para simplicidad offline: abrimos Maps con el primer destino y el resto como query.
  // Alternativa: construir “directions” con origin/destination/waypoints en Google.
  const clean = addresses.filter(Boolean);
  if (!clean.length) return "";
  const first = clean[0];
  const rest = clean.slice(1).join(" | ");

  if (isIOS()) {
    // Apple Maps: query con múltiples términos (no siempre hace waypoints perfectos, pero sirve)
    const q = encodeURIComponent([first, rest].filter(Boolean).join(" "));
    return `https://maps.apple.com/?q=${q}`;
  } else {
    const q = encodeURIComponent([first, rest].filter(Boolean).join(" "));
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
}

async function renderRutas(el, farmacias, pedidos, settings, rutas) {
  const okMap = getPedidosByFarmacia(getPedidosOk(pedidos));
  const now = new Date();

  // sugerencias
  const list = farmacias.map(f => {
    const st = farmaciaStats(f, okMap);
    const freq = Number(f.frecuenciaObjetivoDias || 0) || (st.avgDays ? Math.round(st.avgDays) : 21);
    const due = st.daysSince !== null ? (st.daysSince >= freq) : false;

    const next = st.nextISO ? new Date(st.nextISO) : null;
    const daysToNext = next ? Math.round((next - now) / (1000*60*60*24)) : null;
    const soon = daysToNext !== null ? (daysToNext >= 0 && daysToNext <= 7) : false;

    return { f, st, freq, due, soon, daysToNext };
  });

  const onlyDue = !!settings.routeOnlyDue;
  const stops = Number(settings.routeDefaultStops || 8);

  let suggested = list
    .filter(x => onlyDue ? x.due : (x.due || x.soon))
    .sort((a,b)=> {
      // due primero por más días desde último; luego próximos por díasToNext
      if (a.due && b.due) return (b.st.daysSince||0) - (a.st.daysSince||0);
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return (a.daysToNext||999) - (b.daysToNext||999);
    })
    .slice(0, stops);

  const dateStr = isoDateOnly(new Date());

  el.innerHTML = `
    <div class="card">
      <div class="row">
        <h2>Rutas</h2>
        <div class="right flex">
          <button class="btn-primary" id="rNew">Crear ruta de hoy</button>
        </div>
      </div>

      <div class="grid two">
        <div class="card" style="margin:0">
          <h2>Sugeridas (${suggested.length})</h2>
          <div class="mini muted">
            Según: ${onlyDue ? "solo vencidas" : "vencidas + próximas (≤ 7 días)"} · paradas: ${stops}
          </div>

          <div class="hr"></div>

          <div style="overflow:auto; max-height:520px">
            <table id="rSug">
              <thead><tr><th>Farmacia</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${
                  suggested.length ? suggested.map(x=>{
                    const f = x.f;
                    const badge = x.due ? `<span class="pill warn">vencida</span>` : `<span class="pill ok">próxima</span>`;
                    const extra = x.due
                      ? `${x.st.daysSince ?? "—"} días desde último`
                      : `en ${x.daysToNext} días`;
                    const m = mapsLinkForAddress(f.direccion||"");
                    return `
                      <tr data-id="${f.id}">
                        <td><b>${escapeHtml(f.nombre||"")}</b><br><span class="mini muted">${escapeHtml(f.zona||"")}</span></td>
                        <td class="mini">${badge} <span class="muted">${escapeHtml(extra)}</span></td>
                        <td class="right">
                          <button class="btn btn-xs" data-act="add">Añadir a ruta</button>
                          ${m ? `<a class="btn btn-xs" href="${m}" target="_blank" rel="noopener">Maps</a>` : ""}
                        </td>
                      </tr>
                    `;
                  }).join("") : `<tr><td colspan="3" class="muted">Sin sugerencias (añade pedidos o ajusta frecuencia).</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin:0">
          <h2>Rutas guardadas (${rutas.length})</h2>

          <div class="hr"></div>

          <div style="overflow:auto; max-height:520px">
            <table id="rTable">
              <thead><tr><th>Fecha</th><th>Zona</th><th>Paradas</th><th></th></tr></thead>
              <tbody>
                ${
                  rutas.slice().sort((a,b)=> (b.date||"").localeCompare(a.date||"")).map(r=>`
                    <tr data-id="${r.id}">
                      <td>${escapeHtml(r.date||"")}</td>
                      <td>${escapeHtml(r.zona||"")}</td>
                      <td>${(r.stops||[]).length}</td>
                      <td class="right">
                        <button class="btn btn-xs" data-act="open">Abrir</button>
                        <button class="btn-danger btn-xs" data-act="del">Borrar</button>
                      </td>
                    </tr>
                  `).join("") || `<tr><td colspan="4" class="muted">Aún no hay rutas.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  // Estado temporal para ruta en construcción
  let draftStops = [];

  const openRouteBuilder = async (initialStops) => {
    draftStops = (initialStops || []).slice();

    const dlg = ensureGenericDialog("routeDlg", "Ruta");
    const body = $("#routeDlg_body");

    const renderDraft = () => {
      const selFarm = draftStops.map(id => farmacias.find(f=>f.id===id)).filter(Boolean);

      body.innerHTML = `
        <form id="routeForm">
          <div class="grid two">
            <div>
              <label>Fecha</label>
              <input name="date" type="date" required value="${dateStr}"
                data-help="Fecha de la ruta (por defecto hoy)." />
            </div>
            <div>
              <label>Zona (opcional)</label>
              <input name="zona" placeholder="Ej: Vigo / Coruña / Costa"
                data-help="Etiqueta de zona para organizar rutas." />
            </div>
          </div>

          <label>Notas</label>
          <textarea name="notes" placeholder="Objetivos del día, promos, recordatorios..."
            data-help="Notas internas de la ruta."></textarea>

          <div class="hr"></div>

          <div class="row">
            <h2>Paradas (${selFarm.length})</h2>
            <div class="right flex">
              <button class="btn" type="button" id="routeOpenMaps">Abrir en Maps</button>
            </div>
          </div>

          <div style="overflow:auto; max-height:360px">
            <table id="routeStops">
              <thead><tr><th>#</th><th>Farmacia</th><th>Dirección</th><th></th></tr></thead>
              <tbody>
                ${
                  selFarm.length ? selFarm.map((f, idx)=>`
                    <tr data-id="${f.id}">
                      <td>${idx+1}</td>
                      <td><b>${escapeHtml(f.nombre||"")}</b><br><span class="mini muted">${escapeHtml(f.zona||"")}</span></td>
                      <td class="mini">${escapeHtml(f.direccion||"")}</td>
                      <td class="right"><button class="btn-danger btn-xs" data-act="rm">Quitar</button></td>
                    </tr>
                  `).join("") : `<tr><td colspan="4" class="muted">Añade paradas desde “Sugeridas”.</td></tr>`
                }
              </tbody>
            </table>
          </div>

          <div class="helpbox mini" id="routeHelp">Toca un campo para ver ayuda.</div>
          <div class="hr"></div>

          <button class="btn-primary" type="submit">Guardar ruta</button>
        </form>
      `;

      attachHelp(body, $("#routeHelp"));

      $("#routeOpenMaps").onclick = () => {
        const addrs = selFarm.map(f=>f.direccion).filter(Boolean);
        const url = buildRouteMapsUrl(addrs);
        if (!url) return toast("Sin direcciones");
        window.open(url, "_blank", "noopener");
      };

      $("#routeStops").onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const tr = e.target.closest("tr");
        const id = tr?.dataset?.id;
        if (!id) return;
        if (btn.dataset.act === "rm") {
          draftStops = draftStops.filter(x => x !== id);
          renderDraft();
        }
      };

      $("#routeForm").onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;

        const route = {
          id: uid(),
          date: f.date.value,
          zona: (f.zona.value || "").trim(),
          notes: (f.notes.value || "").trim(),
          stops: draftStops.slice(),
          createdAt: nowISO()
        };

        await dbPut("rutas", route);
        toast("Ruta guardada");
        dlg.close();
        render();
      };
    };

    renderDraft();
    dlg.showModal();
  };

  $("#rNew").onclick = () => openRouteBuilder(suggested.map(x=>x.f.id));

  $("#rSug").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;
    if (btn.dataset.act === "add") {
      if (!draftStops.includes(id)) draftStops.push(id);
      toast("Añadida a ruta en memoria (pulsa “Crear ruta de hoy” para guardar)");
    }
  };

  $("#rTable").onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.dataset?.id;
    if (!id) return;

    if (btn.dataset.act === "del") {
      if (!confirm("¿Borrar ruta?")) return;
      await dbDel("rutas", id);
      toast("Ruta borrada");
      render();
    }

    if (btn.dataset.act === "open") {
      const r = await dbGet("rutas", id);
      if (!r) return;
      await openRouteBuilder(r.stops || []);
    }
  };

  $$("nav button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
}

/** =========================================================
 *  Recordatorio de autobackup (suave)
 *  ========================================================= */
async function maybeBackupReminder(settings) {
  if (!settings.autoBackupEnabled) return;
  const m = await dbGet("meta", "lastBackupAt");
  const last = m?.value ? new Date(m.value) : null;
  const days = Number(settings.autoBackupEveryDays || 7);

  if (!last) {
    toast("Sugerencia: crea un snapshot en Backup");
    return;
  }
  const diffDays = Math.floor((new Date() - last) / (1000*60*60*24));
  if (diffDays >= days) {
    toast("Sugerencia: toca hacer backup (Backup → snapshot/export)");
  }
}

/** =========================================================
 *  Router FINAL: añade vistas
 *  ========================================================= */
const _renderPrev_5C = render;
render = async function renderWrapped5C() {
  const el = $("#view");
  const [farmacias, catalogo, productos, pedidos, interacciones, rutas, settings, backups] =
    await Promise.all([
      dbAll("farmacias"),
      dbAll("catalogo"),
      dbAll("productos"),
      dbAll("pedidos"),
      dbAll("interacciones"),
      dbAll("rutas"),
      loadSettings(),
      dbAll("backups")
    ]);

  // recordatorio suave
  maybeBackupReminder(settings);

  if (STATE.view === "productos") return renderProductos(el, productos);
  if (STATE.view === "pedidos") return renderPedidos(el, farmacias, productos, pedidos);
  if (STATE.view === "interacciones") return renderInteracciones(el, farmacias, interacciones);
  if (STATE.view === "backup") return renderBackup(el, settings, backups);
  if (STATE.view === "rutas") return renderRutas(el, farmacias, pedidos, settings, rutas);

  return _renderPrev_5C();
};
