/* app.js — Farmacias/Ópticas · Ventas Offline (PWA)
 * Integrado:
 * - Dashboard avanzado + Predicciones
 * - Farmacias: import JSON data[], import KML, Mis farmacias, detalle con histórico + próximo pedido
 * - Ópticas: catálogo + Mis ópticas (manual/import JSON), pedidos para ambas
 * - Pedidos: multi-línea (productos), total calculado, importar JSON archivo + pegar JSON
 * - Rutas: sugerencia diaria basada en vencidas/próximas, Maps
 * - Visitas: registrar visita con fecha+notas, listado por día, historial por entidad
 * - Offline real: IndexedDB + Service Worker + PWA (iPhone)
 */
(() => {
  "use strict";

  /**********************
   * Helpers DOM
   **********************/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**********************
   * Toast
   **********************/
  let toastTimer = null;
  function toast(msg, ms = 2200) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.display = "none"), ms);
  }

  /**********************
   * Escape
   **********************/
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("\n", " ");
  }

  /**********************
   * Formatting
   **********************/
  function nowISO() { return new Date().toISOString(); }

  function fmtEur(n) {
    const v = Number(n || 0);
    return v.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  }
  function fmtEurShort(n) {
    const v = Number(n || 0);
    if (v >= 1000) return (v / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + "K €";
    return fmtEur(v);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-ES");
  }
  function todayYMD() { return new Date().toISOString().slice(0,10); }
  function parseISODateYMD(ymd) {
    if (!ymd) return null;
    const d = new Date(ymd + "T10:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  /**********************
   * UID
   **********************/
  function uid() { return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16); }

  /**********************
   * Quarter helpers
   **********************/
  function quarterKey(date) {
    const d = new Date(date);
    const y = String(d.getFullYear()).slice(-2);
    const m = d.getMonth();
    const q = m < 3 ? 1 : m < 6 ? 2 : m < 9 ? 3 : 4;
    return `${q}T${y}`;
  }
  function quarterBounds(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = d.getMonth();
    const q = m < 3 ? 0 : m < 6 ? 3 : m < 9 ? 6 : 9;
    const start = new Date(y, q, 1, 0, 0, 0, 0);
    const end = new Date(y, q + 3, 1, 0, 0, 0, 0);
    return { start, end };
  }

  /**********************
   * IndexedDB
   **********************/
  const DB_NAME = "ventas_offline_db";
  const DB_VER = 3;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const d = req.result;

        // Farmacias
        if (!d.objectStoreNames.contains("farmacias")) {
          const s = d.createObjectStore("farmacias", { keyPath: "id" });
          s.createIndex("by_codigo", "codigo", { unique: false });
          s.createIndex("by_cliente", "cliente", { unique: false });
          s.createIndex("by_concello", "concello", { unique: false });
        }
        if (!d.objectStoreNames.contains("misFarmacias")) {
          d.createObjectStore("misFarmacias", { keyPath: "id" }); // {id, farmaciaId, createdAt}
        }

        // Ópticas
        if (!d.objectStoreNames.contains("opticas")) {
          const s = d.createObjectStore("opticas", { keyPath: "id" });
          s.createIndex("by_codigo", "codigo", { unique: false });
          s.createIndex("by_cliente", "cliente", { unique: false });
          s.createIndex("by_ciudad", "ciudad", { unique: false });
        }
        if (!d.objectStoreNames.contains("misOpticas")) {
          d.createObjectStore("misOpticas", { keyPath: "id" }); // {id, opticaId, createdAt}
        }

        // Productos
        if (!d.objectStoreNames.contains("productos")) {
          d.createObjectStore("productos", { keyPath: "id" });
        }

        // Pedidos (para farmacias u ópticas)
        if (!d.objectStoreNames.contains("pedidos")) {
          const s = d.createObjectStore("pedidos", { keyPath: "id" });
          s.createIndex("by_entity", "entityId", { unique: false });
          s.createIndex("by_tipo", "entityType", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });
        }

        // Visitas (nuevo). Conserva checkins antiguos si existen.
        if (!d.objectStoreNames.contains("visitas")) {
          const s = d.createObjectStore("visitas", { keyPath: "id" });
          s.createIndex("by_entity", "entityId", { unique: false });
          s.createIndex("by_tipo", "entityType", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });
          s.createIndex("by_day", "day", { unique: false });
        }

        // Ajustes
        if (!d.objectStoreNames.contains("settings")) {
          d.createObjectStore("settings", { keyPath: "key" }); // {key, value}
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = "readonly") {
    return db.transaction(store, mode).objectStore(store);
  }
  function dbGet(store, key) {
    return new Promise((resolve, reject) => {
      const r = tx(store).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  }
  function dbPut(store, obj) {
    return new Promise((resolve, reject) => {
      const r = tx(store, "readwrite").put(obj);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }
  function dbDel(store, key) {
    return new Promise((resolve, reject) => {
      const r = tx(store, "readwrite").delete(key);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }
  function dbAll(store) {
    return new Promise((resolve, reject) => {
      const r = tx(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  /**********************
   * Settings
   **********************/
  async function loadSettings() {
    const rows = await dbAll("settings");
    const s = {};
    for (const r of rows) s[r.key] = r.value;
    if (!s.quarterlyTargets) s.quarterlyTargets = {};
    if (s.desiredPct == null) s.desiredPct = 0;
    if (s.daysSoon == null) s.daysSoon = 7;
    return s;
  }
  function saveSetting(key, value) { return dbPut("settings", { key, value }); }
  function getQuarterTarget(settings, qKey) {
    return Number(settings?.quarterlyTargets?.[qKey] || 0);
  }

  /**********************
   * Business rules
   **********************/
  function normalizeEstado(s) {
    const t = String(s || "").toLowerCase().trim();
    if (t.includes("confirm")) return "confirmado";
    if (t.includes("export")) return "confirmado";
    if (t.includes("enviado")) return "confirmado";
    return "confirmado";
  }

  function recomputePedido(p) {
    const lineas = Array.isArray(p.lineas) ? p.lineas : [];
    for (const l of lineas) {
      const cant = Number(l.cantidad || 0);
      const pu = Number(l.precioUnit || 0);
      const dto = Number(l.descuentoPct || 0);
      const base = cant * pu;
      const t = base * (1 - dto / 100);
      l.total = Number.isFinite(t) ? +t.toFixed(2) : 0;
    }
    const tot = lineas.reduce((s, l) => s + Number(l.total || 0), 0);
    p.total = +tot.toFixed(2);
    return p;
  }

  function getPedidosOk(pedidos) {
    return (pedidos || []).filter((p) => String(p.estado || "") === "confirmado");
  }

  function entityName(entityType, entity) {
    if (!entity) return "—";
    return entity.nombre || entity.codigo || (entityType === "optica" ? "Óptica" : "Farmacia");
  }

  function mapsLinkForEntity(entity) {
    if (!entity) return "";
    if (entity.lat != null && entity.lon != null) {
      const lat = Number(entity.lat);
      const lon = Number(entity.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        return `https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lon)}`;
      }
    }
    const addr = (entity.direccion || "").trim();
    if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    return "";
  }

  /**********************
   * Forecast: media entre pedidos
   **********************/
  function farmaciaStats(entityId, pedidosOk) {
    const list = (pedidosOk || [])
      .filter((p) => p.entityId === entityId)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (list.length < 3) return { hasEstimate: false, count: list.length };

    const last10 = list.slice(0, 10).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const diffs = [];
    for (let i = 1; i < last10.length; i++) {
      const d1 = new Date(last10[i - 1].fecha);
      const d2 = new Date(last10[i].fecha);
      const days = (d2 - d1) / (1000 * 60 * 60 * 24);
      if (days > 0 && days < 3650) diffs.push(days);
    }
    const avgDays = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;

    const last = new Date(list[0].fecha);
    const next = avgDays ? new Date(last.getTime() + avgDays * 24 * 60 * 60 * 1000) : null;

    return {
      hasEstimate: !!(avgDays && next),
      avgDays,
      lastISO: list[0].fecha,
      nextISO: next ? next.toISOString() : null,
      count: list.length,
    };
  }

  function computeDueSoon(entities, pedidos, daysSoon = 7, entityType = "farmacia") {
    const ok = getPedidosOk(pedidos).filter(p => p.entityType === entityType);
    const now = new Date();
    const due = [];
    const soon = [];

    for (const e of entities) {
      const st = farmaciaStats(e.id, ok);
      if (!st.hasEstimate) continue;
      const next = st.nextISO ? new Date(st.nextISO) : null;
      if (!next) continue;

      const diff = Math.round((next - now) / (1000 * 60 * 60 * 24));
      const metaText = `Próximo: ${fmtDate(next.toISOString())} · media: ${Math.round(st.avgDays)} días`;

      if (diff < 0) due.push({ e, metaText, diff, priority: 3 });
      else if (diff <= daysSoon) soon.push({ e, metaText, diff, priority: diff <= 2 ? 2 : 1 });
    }

    due.sort((a, b) => a.diff - b.diff);
    soon.sort((a, b) => a.diff - b.diff);
    return { due, soon };
  }

  /**********************
   * Producto "General"
   **********************/
  async function ensureProductoGeneral() {
    const all = await dbAll("productos");
    let p = all.find((x) => String(x.nombre || "").trim().toLowerCase() === "general");
    if (p) return p;

    p = {
      id: uid(),
      nombre: "General",
      descripcion: "Importaciones y pedidos rápidos: total del pedido como línea única.",
      creadoEn: nowISO(),
      actualizadoEn: nowISO(),
    };
    await dbPut("productos", p);
    return p;
  }

  /**********************
   * Upserts Farmacias (catalogo nuevo data[])
   **********************/
  async function upsertFarmaciaFromNewItem(it) {
    const codigo = String(it.codigo || "").trim();
    if (!codigo) return null;

    const id = "F_" + codigo;
    const cur = await dbGet("farmacias", id);

    const f = {
      id,
      codigo,
      nombre: cur?.nombre || it.nombre || `Farmacia ${codigo}`,
      direccion: it.direccion || cur?.direccion || "",
      cp: it.cp || cur?.cp || "",
      concello: it.concello || cur?.concello || "",
      telefono: it.telefono || cur?.telefono || "",
      cliente: it.titular1 || it.cliente || cur?.cliente || "",
      lon: it.lon ?? cur?.lon ?? null,
      lat: it.lat ?? cur?.lat ?? null,
      source: cur?.source || "catalogo",
      createdAt: cur?.createdAt || nowISO(),
      updatedAt: nowISO(),
    };

    await dbPut("farmacias", f);
    return f;
  }

  /**********************
   * Import Farmacias JSON (nuevo data[])
   **********************/
  async function importFarmaciasNewJsonFile(file) {
    const txt = await file.text();
    let obj;
    try { obj = JSON.parse(txt); } catch { toast("JSON inválido"); return; }

    const arr = Array.isArray(obj.data) ? obj.data : [];
    if (!arr.length) { toast("No hay datos en el JSON"); return; }

    let n = 0;
    for (const it of arr) {
      const ok = await upsertFarmaciaFromNewItem(it);
      if (ok) n++;
    }
    toast(`Farmacias importadas/actualizadas: ${n}`);
  }

  /**********************
   * Import KML Farmacias
   **********************/
  function parseKmlDescTable(html) {
    const map = {};
    const div = document.createElement("div");
    div.innerHTML = html || "";
    const tds = div.querySelectorAll("td");
    for (let i = 0; i < tds.length - 1; i += 2) {
      const k = (tds[i].textContent || "").trim().toUpperCase();
      const v = (tds[i + 1].textContent || "").trim();
      if (k) map[k] = v;
    }
    return map;
  }

  async function importFarmaciasFromKmlFile(file) {
    const txt = await file.text();
    const xml = new DOMParser().parseFromString(txt, "text/xml");
    const placemarks = Array.from(xml.getElementsByTagName("Placemark"));

    let n = 0;
    for (const pm of placemarks) {
      const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || "";
      if (!name) continue;

      const desc = pm.getElementsByTagName("description")[0]?.textContent || "";
      const fields = parseKmlDescTable(desc);

      const coordText = pm.getElementsByTagName("coordinates")[0]?.textContent?.trim() || "";
      let lon = null, lat = null;
      if (coordText) {
        const parts = coordText.split(",").map((x) => x.trim());
        lon = parts[0] ? Number(String(parts[0]).replace(",", ".")) : null;
        lat = parts[1] ? Number(String(parts[1]).replace(",", ".")) : null;
      }

      const it = {
        codigo: name,
        direccion: fields["DIRECCION"] || "",
        cp: fields["CODIGOPOST"] || "",
        concello: fields["CONCELLO"] || "",
        telefono: fields["TELEFONO"] || "",
        titular1: fields["TITULAR1"] || "",
        lon, lat,
      };

      const ok = await upsertFarmaciaFromNewItem(it);
      if (ok) n++;
    }
    toast(`KML importado: ${n} farmacias`);
  }

  /**********************
   * Mis farmacias / Mis ópticas
   **********************/
  async function getMisIds(store, keyName) {
    const all = await dbAll(store);
    return new Set(all.map((x) => x[keyName]));
  }
  async function addToMis(store, keyName, idValue) {
    const all = await dbAll(store);
    if (all.some((x) => x[keyName] === idValue)) return;
    const obj = { id: uid(), createdAt: nowISO() };
    obj[keyName] = idValue;
    await dbPut(store, obj);
  }
  async function removeFromMis(store, keyName, idValue) {
    const all = await dbAll(store);
    const row = all.find((x) => x[keyName] === idValue);
    if (row) await dbDel(store, row.id);
  }

  /**********************
   * Ópticas — import simple
   **********************/
  async function importOpticasJsonFile(file) {
    const txt = await file.text();
    let obj;
    try { obj = JSON.parse(txt); } catch { toast("JSON inválido"); return; }

    const arr = Array.isArray(obj.data) ? obj.data : (Array.isArray(obj) ? obj : []);
    if (!arr.length) { toast("No hay datos"); return; }

    let n = 0;
    for (const it of arr) {
      const codigo = String(it.codigo || it.id || "").trim();
      const name = String(it.nombre || it.name || "").trim();
      if (!codigo && !name) continue;

      const id = "O_" + (codigo || uid());
      const cur = await dbGet("opticas", id);

      const o = {
        id,
        codigo: codigo || cur?.codigo || "",
        nombre: name || cur?.nombre || (codigo ? `Óptica ${codigo}` : "Óptica"),
        direccion: it.direccion || cur?.direccion || "",
        ciudad: it.ciudad || it.localidad || cur?.ciudad || "",
        telefono: it.telefono || cur?.telefono || "",
        cliente: it.titular1 || it.cliente || cur?.cliente || "",
        lon: it.lon ?? cur?.lon ?? null,
        lat: it.lat ?? cur?.lat ?? null,
        source: cur?.source || "catalogo",
        createdAt: cur?.createdAt || nowISO(),
        updatedAt: nowISO(),
      };

      await dbPut("opticas", o);
      n++;
    }
    toast(`Ópticas importadas/actualizadas: ${n}`);
  }

  /**********************
   * Pedidos — import archivo JSON (cliente/estado/elementos/fecha/total_eur)
   **********************/
  async function findOrCreateFarmaciaByCliente(cliente) {
    const name = String(cliente || "").trim();
    if (!name) return null;

    const farmacias = await dbAll("farmacias");
    let f = farmacias.find((x) => String(x.cliente || "").trim().toLowerCase() === name.toLowerCase());
    if (f) return f;

    f = {
      id: uid(),
      codigo: "",
      nombre: `Farmacia ${name.split(" ").slice(0, 2).join(" ")}`.trim(),
      direccion: "",
      cp: "",
      concello: "",
      telefono: "",
      cliente: name,
      lat: null, lon: null,
      source: "manual",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await dbPut("farmacias", f);
    return f;
  }

  async function importPedidosJsonFile(file) {
    const txt = await file.text();
    let arr;
    try { arr = JSON.parse(txt); } catch { toast("JSON inválido"); return; }
    if (!Array.isArray(arr)) { toast("El JSON debe ser una lista []"); return; }

    const gen = await ensureProductoGeneral();
    let n = 0;

    for (const it of arr) {
      const cliente = String(it.cliente || "").trim();
      const fechaYMD = String(it.fecha || "").trim();
      const total = Number(it.total_eur || 0);
      const elementos = Number(it.elementos || 0);
      if (!cliente || !fechaYMD) continue;

      const estado = normalizeEstado(it.estado);
      if (estado !== "confirmado") continue;

      const farmacia = await findOrCreateFarmaciaByCliente(cliente);
      if (!farmacia) continue;

      const d = parseISODateYMD(fechaYMD);
      if (!d) continue;

      const pedido = recomputePedido({
        id: uid(),
        entityType: "farmacia",
        entityId: farmacia.id,
        fecha: d.toISOString(),
        estado: "confirmado",
        elementos,
        notas: `Importado JSON · estado origen: ${it.estado} · elementos: ${elementos}`,
        lineas: [{
          id: uid(),
          productoId: gen.id,
          nombre: "General",
          cantidad: 1,
          precioUnit: +total.toFixed(2),
          descuentoPct: 0,
          total: +total.toFixed(2),
        }],
        total: +total.toFixed(2),
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      });

      await dbPut("pedidos", pedido);
      n++;
    }
    toast(`Pedidos importados: ${n}`);
  }

  async function importPedidosFromText(text) {
    let arr;
    try { arr = JSON.parse(text); } catch { toast("JSON inválido"); return; }
    if (!Array.isArray(arr)) { toast("El JSON debe ser una lista []"); return; }

    const gen = await ensureProductoGeneral();
    let n = 0;

    for (const it of arr) {
      const cliente = String(it.cliente || "").trim();
      const fechaYMD = String(it.fecha || "").trim();
      const total = Number(it.total_eur || 0);
      const elementos = Number(it.elementos || 0);
      if (!cliente || !fechaYMD) continue;

      const estado = normalizeEstado(it.estado);
      if (estado !== "confirmado") continue;

      const farmacia = await findOrCreateFarmaciaByCliente(cliente);
      if (!farmacia) continue;

      const d = parseISODateYMD(fechaYMD);
      if (!d) continue;

      const pedido = recomputePedido({
        id: uid(),
        entityType: "farmacia",
        entityId: farmacia.id,
        fecha: d.toISOString(),
        estado: "confirmado",
        elementos,
        notas: `Importado (pegado) · estado origen: ${it.estado}`,
        lineas: [{
          id: uid(),
          productoId: gen.id,
          nombre: "General",
          cantidad: 1,
          precioUnit: +total.toFixed(2),
          descuentoPct: 0,
          total: +total.toFixed(2),
        }],
        total: +total.toFixed(2),
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      });

      await dbPut("pedidos", pedido);
      n++;
    }
    toast(`Pedidos importados: ${n}`);
  }

  /**********************
   * Dialogs (main/sub)
   **********************/
  const dlgMain = () => $("#dlgMain");
  const dlgSub = () => $("#dlgSub");
  function dlgCloseMain() { dlgMain()?.close(); }
  function dlgCloseSub() { dlgSub()?.close(); }

  function dlgOpenMain(title, sub, bodyHTML, footHTML = "") {
    $("#dlgMainTitle").textContent = title || "Detalles";
    $("#dlgMainSub").textContent = sub || "";
    $("#dlgMainBody").innerHTML = bodyHTML || "";
    $("#dlgMainFoot").innerHTML = footHTML || "";
    dlgMain()?.showModal();
  }
  function dlgOpenSub(title, sub, bodyHTML, footHTML = "") {
    $("#dlgSubTitle").textContent = title || "Editar";
    $("#dlgSubSub").textContent = sub || "";
    $("#dlgSubBody").innerHTML = bodyHTML || "";
    $("#dlgSubFoot").innerHTML = footHTML || "";
    dlgSub()?.showModal();
  }

  /**********************
   * Help (data-help)
   **********************/
  function wireHelp(rootEl) {
    const help = rootEl.querySelector("[data-helpbox]");
    const inputs = $$("[data-help]", rootEl);
    for (const inp of inputs) {
      inp.addEventListener("focus", () => {
        if (help) help.innerHTML = `<b>Ayuda:</b> ${escapeHtml(inp.getAttribute("data-help"))}`;
      });
    }
  }

  /**********************
   * State
   **********************/
  const state = {
    view: "dash",
    farmacias: [],
    misFarmacias: [],
    opticas: [],
    misOpticas: [],
    pedidos: [],
    productos: [],
    visitas: [],
    settings: null,
  };

  async function refreshState() {
    state.farmacias = await dbAll("farmacias");
    state.misFarmacias = await dbAll("misFarmacias");
    state.opticas = await dbAll("opticas");
    state.misOpticas = await dbAll("misOpticas");
    state.pedidos = await dbAll("pedidos");
    state.productos = await dbAll("productos");
    state.visitas = await dbAll("visitas");
    state.settings = await loadSettings();

    // migración suave: si existe store checkins (antiguo) y hay datos, copiar una vez
    // (no rompemos si no existe)
    try {
      const has = db.objectStoreNames.contains("checkins");
      if (has) {
        const old = await dbAll("checkins");
        if (old && old.length) {
          const already = await dbAll("visitas");
          const existingIds = new Set(already.map(x => x.id));
          let copied = 0;
          for (const ci of old) {
            if (existingIds.has(ci.id)) continue;
            const day = (ci.fecha || "").slice(0,10) || todayYMD();
            await dbPut("visitas", {
              id: ci.id,
              entityType: "farmacia",
              entityId: ci.farmaciaId,
              fecha: ci.fecha || nowISO(),
              day,
              notas: ci.notas || "",
              createdAt: nowISO(),
            });
            copied++;
          }
          if (copied) toast(`Migradas ${copied} visitas antiguas`);
        }
      }
    } catch {}
  }

  function setView(v) {
    state.view = v;
    $$("nav .tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    render();
  }

  /**********************
   * Render components
   **********************/
  function renderSuggestList(items, entityType, includeVisit = false) {
    if (!items.length) return `<div class="muted">—</div>`;
    return `
      <div class="list">
        ${items.map((x) => {
          const e = x.e;
          const title = entityName(entityType, e);
          const cliente = e.cliente ? `Titular: ${e.cliente}` : "";
          const place = entityType === "optica" ? (e.ciudad ? `Ciudad: ${e.ciudad}` : "") : (e.concello ? `Concello: ${e.concello}` : "");
          const pr = x.priority === 3 ? `<span class="pill bad">Vencida</span>` : x.priority === 2 ? `<span class="pill warn">Muy próxima</span>` : `<span class="pill ok">Próxima</span>`;
          return `
            <div class="list-item">
              <div>
                <b>${escapeHtml(title)}</b> ${pr}<br>
                <span class="mini muted">${escapeHtml(x.metaText)}</span><br>
                <span class="mini muted">${escapeHtml(cliente)}</span><br>
                <span class="mini muted">${escapeHtml(place)}</span>
              </div>
              <div class="right flex">
                <button class="btn btn-xs" data-act="details" data-type="${escapeAttr(entityType)}" data-id="${escapeAttr(e.id)}">Detalles</button>
                <button class="btn btn-xs" data-act="maps" data-type="${escapeAttr(entityType)}" data-id="${escapeAttr(e.id)}">Maps</button>
                ${includeVisit ? `<button class="btn-primary btn-xs" data-act="visit" data-type="${escapeAttr(entityType)}" data-id="${escapeAttr(e.id)}">Registrar visita</button>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  /**********************
   * Dashboard
   **********************/
  async function renderDashboard(viewEl) {
    const { farmacias, opticas, pedidos, settings } = state;

    const now = new Date();
    const qNow = quarterKey(now);

    const target = getQuarterTarget(settings, qNow) || 0;
    const desiredPct = Number(settings.desiredPct || 0);
    const desiredTarget = target * (1 + desiredPct / 100);

    const ok = getPedidosOk(pedidos);
    const qSales = ok
      .filter((p) => quarterKey(new Date(p.fecha)) === qNow)
      .reduce((s, p) => s + Number(p.total || 0), 0);

    const faltan = Math.max(0, target - qSales);
    const faltanDeseado = Math.max(0, desiredTarget - qSales);

    const { end } = quarterBounds(now);
    const daysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));

    const perWeek = weeksLeft ? faltan / weeksLeft : faltan;
    const perDay = daysLeft ? faltan / daysLeft : faltan;

    const perWeekD = weeksLeft ? faltanDeseado / weeksLeft : faltanDeseado;
    const perDayD = daysLeft ? faltanDeseado / daysLeft : faltanDeseado;

    const prog = target ? Math.round((qSales / target) * 100) : 0;
    const progD = desiredTarget ? Math.round((qSales / desiredTarget) * 100) : 0;

    const daysSoon = Number(settings.daysSoon || 7);

    const { due: dueF, soon: soonF } = computeDueSoon(farmacias, pedidos, daysSoon, "farmacia");
    const { due: dueO, soon: soonO } = computeDueSoon(opticas, pedidos, daysSoon, "optica");

    const alertClass = prog < 60 ? "bad" : prog < 85 ? "warn" : "ok";
    const alertPill = prog < 60 ? "Riesgo" : prog < 85 ? "Atención" : "Bien";

    viewEl.innerHTML = `
      <div class="card">
        <h2>Dashboard · ${escapeHtml(qNow)}</h2>
        <div class="mini muted">KPIs del trimestre (ventas confirmadas). Alertas y ritmo recomendado.</div>
        <div class="hr"></div>

        <div class="kpi">
          <div class="k">
            <div class="v">${fmtEur(qSales)}</div>
            <div class="t">Ventas trimestre</div>
            <div class="mini muted">Progreso: <b>${prog}%</b></div>
          </div>

          <div class="k">
            <div class="v">${fmtEur(target)}</div>
            <div class="t">Objetivo ${escapeHtml(qNow)}</div>
            <div class="mini muted">Faltan: <b>${fmtEur(faltan)}</b></div>
          </div>

          <div class="k">
            <div class="v">${fmtEur(desiredTarget)}</div>
            <div class="t">Objetivo deseado (+${desiredPct}%)</div>
            <div class="mini muted">Faltan: <b>${fmtEur(faltanDeseado)}</b></div>
          </div>

          <div class="k">
            <div class="v"><span class="pill ${alertClass}">${escapeHtml(alertPill)}</span></div>
            <div class="t">Alerta visual</div>
            <div class="mini muted">${daysLeft} días restantes</div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Ritmo recomendado</h2>
            <div class="mini muted">Para llegar al objetivo configurado.</div>
            <div class="hr"></div>
            <div class="grid two">
              <div class="k">
                <div class="v">${fmtEur(perWeek)}</div>
                <div class="t">por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDay)}</div>
                <div class="t">por día</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin:0">
            <h2>Ritmo deseado</h2>
            <div class="mini muted">Objetivo deseado (+${desiredPct}%).</div>
            <div class="hr"></div>
            <div class="grid two">
              <div class="k">
                <div class="v">${fmtEur(perWeekD)}</div>
                <div class="t">por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDayD)}</div>
                <div class="t">por día</div>
              </div>
            </div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Farmacias vencidas (${dueF.length})</h2>
            ${renderSuggestList(dueF, "farmacia", true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Ópticas vencidas (${dueO.length})</h2>
            ${renderSuggestList(dueO, "optica", true)}
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Farmacias próximas (≤ ${daysSoon} días) (${soonF.length})</h2>
            ${renderSuggestList(soonF, "farmacia", true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Ópticas próximas (≤ ${daysSoon} días) (${soonO.length})</h2>
            ${renderSuggestList(soonO, "optica", true)}
          </div>
        </div>
      </div>
    `;

    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const type = b.dataset.type;
      const id = b.dataset.id;
      if (!act || !type || !id) return;
      if (act === "maps") {
        const entity = type === "optica" ? state.opticas.find(x => x.id === id) : state.farmacias.find(x => x.id === id);
        const url = mapsLinkForEntity(entity);
        if (url) window.open(url, "_blank", "noopener");
      }
      if (act === "details") {
        type === "optica" ? openOpticaDetails(id) : openFarmaciaDetails(id);
      }
      if (act === "visit") {
        openVisitaModal(type, id);
      }
    };
  }

  /**********************
   * Predicciones
   **********************/
  async function renderPredicciones(viewEl) {
    const { farmacias, opticas, pedidos, settings } = state;
    const daysSoon = Number(settings.daysSoon || 7);

    const { due: dueF, soon: soonF } = computeDueSoon(farmacias, pedidos, daysSoon, "farmacia");
    const { due: dueO, soon: soonO } = computeDueSoon(opticas, pedidos, daysSoon, "optica");

    viewEl.innerHTML = `
      <div class="card">
        <h2>Predicciones inteligentes</h2>
        <div class="mini muted">Basado en media de días entre pedidos (mínimo 3 pedidos confirmados).</div>
        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Farmacias vencidas (${dueF.length})</h2>
            ${renderSuggestList(dueF, "farmacia", true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Ópticas vencidas (${dueO.length})</h2>
            ${renderSuggestList(dueO, "optica", true)}
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Farmacias próximas (≤ ${daysSoon} días) (${soonF.length})</h2>
            ${renderSuggestList(soonF, "farmacia", true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Ópticas próximas (≤ ${daysSoon} días) (${soonO.length})</h2>
            ${renderSuggestList(soonO, "optica", true)}
          </div>
        </div>
      </div>
    `;

    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const type = b.dataset.type;
      const id = b.dataset.id;
      if (!act || !type || !id) return;
      if (act === "maps") {
        const entity = type === "optica" ? state.opticas.find(x => x.id === id) : state.farmacias.find(x => x.id === id);
        const url = mapsLinkForEntity(entity);
        if (url) window.open(url, "_blank", "noopener");
      }
      if (act === "details") {
        type === "optica" ? openOpticaDetails(id) : openFarmaciaDetails(id);
      }
      if (act === "visit") {
        openVisitaModal(type, id);
      }
    };
  }

  /**********************
   * Farmacias (catálogo)
   **********************/
  async function renderFarmacias(viewEl) {
    const { farmacias } = state;
    const misIds = await getMisIds("misFarmacias", "farmaciaId");

    const catalogo = farmacias
      .filter((f) => (f.source || "") === "catalogo")
      .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Farmacias · Catálogo (${catalogo.length})</h2>
            <div class="mini muted">Añade a Mis farmacias desde aquí.</div>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" id="btnImportJsonNew">Importar JSON</button>
            <button class="btn btn-xs" id="btnImportKml">Importar KML</button>
            <button class="btn-danger btn-xs" id="btnBorrarCatalogo">Borrar catálogo</button>
          </div>
        </div>

        <div class="hr"></div>

        <label>Buscar</label>
        <input id="catSearch" placeholder="Nombre / código / concello / titular..." data-help="Busca por nombre, código, concello o titular." />

        <div class="grid two">
          <div>
            <label>Límite listado</label>
            <select id="catLimit" data-help="Limita resultados para que vaya fluido.">
              ${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}">${n}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Filtrar por concello</label>
            <select id="catConcello" data-help="Filtra el catálogo por concello.">
              <option value="">Todos</option>
            </select>
          </div>
        </div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

        <div class="hr"></div>
        <div id="catRows"></div>
      </div>
    `;

    $("#catLimit").value = "100";
    const elCat = $("#catRows");

    function buildConcelloOptions(selectEl, list) {
      const concellos = [...new Set(list.map((x) => (x.concello || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "es"));
      const cur = selectEl.value || "";
      selectEl.innerHTML =
        `<option value="">Todos</option>` +
        concellos.map((c) => `<option value="${escapeAttr(c)}"${c === cur ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
    }

    function renderCatalogRows() {
      const q = ($("#catSearch").value || "").trim().toLowerCase();
      const limit = Number($("#catLimit").value || 100);
      const concelloSel = ($("#catConcello").value || "").trim();

      let arr = catalogo.slice();
      buildConcelloOptions($("#catConcello"), arr);

      if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

      if (q) {
        arr = arr.filter((f) => {
          const blob = `${f.nombre || ""} ${f.codigo || ""} ${f.concello || ""} ${f.cliente || ""}`.toLowerCase();
          return blob.includes(q);
        });
      }

      arr = arr.slice(0, limit);

      elCat.innerHTML = `
        <div class="list">
          ${arr.map((f) => {
            const inMis = misIds.has(f.id);
            const title = f.nombre || f.codigo || "Farmacia";
            const cliente = f.cliente || "—";
            const concello = f.concello || "—";
            const tel = f.telefono || "—";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(f.codigo || "—")} · Tel: ${escapeHtml(tel)}</span><br>
                  <span class="mini muted">Titular: ${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">Concello: ${escapeHtml(concello)} · CP ${escapeHtml(f.cp || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(f.id)}">Maps</button>
                  ${inMis
                    ? `<span class="pill ok">en Mis farmacias</span>`
                    : `<button class="btn-primary btn-xs" data-act="addmis" data-id="${escapeAttr(f.id)}">Añadir</button>`}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    renderCatalogRows();
    $("#catSearch").oninput = renderCatalogRows;
    $("#catLimit").onchange = renderCatalogRows;
    $("#catConcello").onchange = renderCatalogRows;
    wireHelp(viewEl);

    $("#btnImportJsonNew").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importFarmaciasNewJsonFile(f);
        await refreshState();
        render();
      };
      inp.click();
    };

    $("#btnImportKml").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".kml,application/vnd.google-earth.kml+xml,text/xml";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importFarmaciasFromKmlFile(f);
        await refreshState();
        render();
      };
      inp.click();
    };

    $("#btnBorrarCatalogo").onclick = async () => {
      if (!confirm("¿Borrar todas las farmacias importadas del catálogo? (No borra las manuales)")) return;
      const all = await dbAll("farmacias");
      let n = 0;
      for (const f of all) {
        if ((f.source || "") === "catalogo") {
          await dbDel("farmacias", f.id);
          n++;
        }
      }
      toast(`Catálogo borrado: ${n}`);
      await refreshState();
      render();
    };

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "maps") {
        const f = state.farmacias.find((x) => x.id === id);
        const url = mapsLinkForEntity(f);
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (act === "addmis") {
        await addToMis("misFarmacias", "farmaciaId", id);
        toast("Añadida a Mis farmacias");
        await refreshState();
        render();
        return;
      }
    };
  }

  /**********************
   * Mis farmacias (gestión separada)
   **********************/
  async function renderMisFarmacias(viewEl) {
    const misIds = await getMisIds("misFarmacias", "farmaciaId");
    const mis = state.farmacias
      .filter((f) => misIds.has(f.id))
      .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Mis farmacias (${mis.length})</h2>
            <div class="mini muted">Tus farmacias objetivo. Detalles, visitas y pedidos.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="btnAltaFarm">+ Alta manual</button>
          </div>
        </div>

        <div class="hr"></div>

        <label>Buscar</label>
        <input id="mySearch" placeholder="Nombre / código / titular..." data-help="Busca en tus farmacias." />

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

        <div class="hr"></div>
        <div id="myRows"></div>
      </div>
    `;

    function renderRows() {
      const q = ($("#mySearch").value || "").trim().toLowerCase();
      let arr = mis.slice();
      if (q) {
        arr = arr.filter((f) => `${f.nombre || ""} ${f.codigo || ""} ${f.cliente || ""}`.toLowerCase().includes(q));
      }

      $("#myRows").innerHTML = `
        <div class="list">
          ${arr.map((f) => {
            const title = f.nombre || f.codigo || "Farmacia";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">${escapeHtml(f.concello || "—")} · CP ${escapeHtml(f.cp || "—")}</span><br>
                  <span class="mini muted">Titular: ${escapeHtml(f.cliente || "—")} · Tel: ${escapeHtml(f.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-id="${escapeAttr(f.id)}">Detalles</button>
                  <button class="btn-primary btn-xs" data-act="visit" data-id="${escapeAttr(f.id)}">Visita</button>
                  <button class="btn btn-xs" data-act="order" data-id="${escapeAttr(f.id)}">Pedido</button>
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(f.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(f.id)}">Quitar</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    renderRows();
    $("#mySearch").oninput = renderRows;
    wireHelp(viewEl);

    $("#btnAltaFarm").onclick = () => openFarmaciaEdit(null);

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "details") return openFarmaciaDetails(id);
      if (act === "visit") return openVisitaModal("farmacia", id);
      if (act === "order") return openPedidoEdit(null, "farmacia", id);
      if (act === "maps") {
        const f = state.farmacias.find(x => x.id === id);
        const url = mapsLinkForEntity(f);
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (act === "del") {
        await removeFromMis("misFarmacias", "farmaciaId", id);
        toast("Quitada de Mis farmacias");
        await refreshState();
        render();
      }
    };
  }

  /**********************
   * Ópticas (catálogo)
   **********************/
  async function renderOpticas(viewEl) {
    const { opticas } = state;
    const misIds = await getMisIds("misOpticas", "opticaId");

    const catalogo = opticas
      .filter(o => (o.source || "") === "catalogo")
      .sort((a,b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Ópticas · Catálogo</h2>
            <div class="mini muted">Importa JSON y añade a Mis ópticas.</div>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" id="btnImportOpt">Importar JSON</button>
            <button class="btn-danger btn-xs" id="btnBorrarOpt">Borrar catálogo</button>
          </div>
        </div>

        <div class="hr"></div>

        <label>Buscar</label>
        <input id="oSearch" placeholder="Nombre / código / ciudad / titular..." />

        <div class="hr"></div>
        <div id="oRows"></div>
      </div>
    `;

    function renderRows() {
      const q = ($("#oSearch").value || "").trim().toLowerCase();
      let arr = catalogo.slice();
      if (q) {
        arr = arr.filter(o => `${o.nombre||""} ${o.codigo||""} ${o.ciudad||""} ${o.cliente||""}`.toLowerCase().includes(q));
      }

      $("#oRows").innerHTML = `
        <div class="list">
          ${arr.map((o) => {
            const inMis = misIds.has(o.id);
            const title = o.nombre || o.codigo || "Óptica";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(o.codigo || "—")} · Tel: ${escapeHtml(o.telefono || "—")}</span><br>
                  <span class="mini muted">Titular: ${escapeHtml(o.cliente || "—")}</span><br>
                  <span class="mini muted">Ciudad: ${escapeHtml(o.ciudad || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(o.id)}">Maps</button>
                  ${inMis
                    ? `<span class="pill ok">en Mis ópticas</span>`
                    : `<button class="btn-primary btn-xs" data-act="addmis" data-id="${escapeAttr(o.id)}">Añadir</button>`}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    renderRows();

    $("#oSearch").oninput = renderRows;

    $("#btnImportOpt").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importOpticasJsonFile(f);
        await refreshState();
        render();
      };
      inp.click();
    };

    $("#btnBorrarOpt").onclick = async () => {
      if (!confirm("¿Borrar todas las ópticas importadas del catálogo? (No borra las manuales)")) return;
      const all = await dbAll("opticas");
      let n = 0;
      for (const o of all) {
        if ((o.source || "") === "catalogo") {
          await dbDel("opticas", o.id);
          n++;
        }
      }
      toast(`Catálogo borrado: ${n}`);
      await refreshState();
      render();
    };

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "maps") {
        const o = state.opticas.find(x => x.id === id);
        const url = mapsLinkForEntity(o);
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (act === "addmis") {
        await addToMis("misOpticas", "opticaId", id);
        toast("Añadida a Mis ópticas");
        await refreshState();
        render();
      }
    };
  }

  /**********************
   * Mis ópticas
   **********************/
  async function renderMisOpticas(viewEl) {
    const misIds = await getMisIds("misOpticas", "opticaId");
    const mis = state.opticas
      .filter((o) => misIds.has(o.id))
      .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Mis ópticas (${mis.length})</h2>
            <div class="mini muted">Tus ópticas objetivo. Detalles, visitas y pedidos.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="btnAltaOpt">+ Alta manual</button>
          </div>
        </div>

        <div class="hr"></div>

        <label>Buscar</label>
        <input id="myOSearch" placeholder="Nombre / código / titular..." />

        <div class="hr"></div>
        <div id="myORows"></div>
      </div>
    `;

    function renderRows() {
      const q = ($("#myOSearch").value || "").trim().toLowerCase();
      let arr = mis.slice();
      if (q) {
        arr = arr.filter((o) => `${o.nombre || ""} ${o.codigo || ""} ${o.cliente || ""}`.toLowerCase().includes(q));
      }

      $("#myORows").innerHTML = `
        <div class="list">
          ${arr.map((o) => {
            const title = o.nombre || o.codigo || "Óptica";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Ciudad: ${escapeHtml(o.ciudad || "—")}</span><br>
                  <span class="mini muted">Titular: ${escapeHtml(o.cliente || "—")} · Tel: ${escapeHtml(o.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-id="${escapeAttr(o.id)}">Detalles</button>
                  <button class="btn-primary btn-xs" data-act="visit" data-id="${escapeAttr(o.id)}">Visita</button>
                  <button class="btn btn-xs" data-act="order" data-id="${escapeAttr(o.id)}">Pedido</button>
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(o.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(o.id)}">Quitar</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    renderRows();

    $("#myOSearch").oninput = renderRows;

    $("#btnAltaOpt").onclick = () => openOpticaEdit(null);

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "details") return openOpticaDetails(id);
      if (act === "visit") return openVisitaModal("optica", id);
      if (act === "order") return openPedidoEdit(null, "optica", id);
      if (act === "maps") {
        const o = state.opticas.find(x => x.id === id);
        const url = mapsLinkForEntity(o);
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (act === "del") {
        await removeFromMis("misOpticas", "opticaId", id);
        toast("Quitada de Mis ópticas");
        await refreshState();
        render();
      }
    };
  }

  /**********************
   * Productos
   **********************/
  async function renderProductos(viewEl) {
    const { productos } = state;
    const arr = [...productos].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Productos (${arr.length})</h2>
            <div class="mini muted">Catálogo interno. Importaciones usan el producto <b>General</b> automáticamente.</div>
          </div>
          <div class="right">
            <button class="btn-primary btn-xs" id="pNew">+ Nuevo producto</button>
          </div>
        </div>

        <div class="hr"></div>

        <label>Buscar</label>
        <input id="pSearch" placeholder="Nombre / descripción..." data-help="Filtra productos por texto." />

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

        <div class="hr"></div>

        <div id="pRows"></div>
      </div>
    `;

    function renderRows() {
      const q = ($("#pSearch").value || "").trim().toLowerCase();
      let list = arr.slice();
      if (q) list = list.filter((p) => `${p.nombre || ""} ${p.descripcion || ""}`.toLowerCase().includes(q));

      $("#pRows").innerHTML = `
        <div class="list">
          ${list.map((p) => `
            <div class="list-item">
              <div>
                <b>${escapeHtml(p.nombre || "—")}</b><br>
                <span class="mini muted">${escapeHtml(p.descripcion || "")}</span>
              </div>
              <div class="right flex">
                <button class="btn btn-xs" data-act="edit" data-id="${escapeAttr(p.id)}">Editar</button>
                <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(p.id)}">Borrar</button>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }

    renderRows();
    $("#pSearch").oninput = renderRows;
    wireHelp(viewEl);

    $("#pNew").onclick = () => openProductoEdit(null);

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "del") {
        if (!confirm("¿Borrar producto?")) return;
        await dbDel("productos", id);
        toast("Producto borrado");
        await refreshState();
        render();
        return;
      }
      if (act === "edit") return openProductoEdit(id);
    };
  }

  /**********************
   * Pedidos
   **********************/
  async function renderPedidos(viewEl) {
    const { pedidos, farmacias, opticas } = state;

    const farmById = new Map(farmacias.map((f) => [f.id, f]));
    const optById = new Map(opticas.map((o) => [o.id, o]));

    const misF = await getMisIds("misFarmacias", "farmaciaId");
    const misO = await getMisIds("misOpticas", "opticaId");

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Pedidos (${pedidos.length})</h2>
            <div class="mini muted">Solo confirmados (confirmado/exportado/enviado). Filtro por Mis.</div>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" id="oImport">Importar JSON</button>
            <button class="btn btn-xs" id="oPaste">Importar pegando JSON</button>
            <button class="btn-primary btn-xs" id="oNew">+ Nuevo pedido</button>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div>
            <label>Tipo</label>
            <select id="oType">
              <option value="">Todos</option>
              <option value="farmacia">Farmacias</option>
              <option value="optica">Ópticas</option>
            </select>
          </div>
          <div>
            <label>Solo mis (farmacias/ópticas)</label>
            <select id="oMine">
              <option value="1">Sí</option>
              <option value="0">No</option>
            </select>
          </div>
        </div>

        <div class="hr"></div>

        <div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th style="width:120px">Fecha</th>
                <th style="width:90px">Tipo</th>
                <th>Entidad</th>
                <th>Titular</th>
                <th style="width:130px">Total</th>
                <th style="width:160px"></th>
              </tr>
            </thead>
            <tbody id="oRows"></tbody>
          </table>
        </div>
      </div>
    `;

    $("#oMine").value = "1";

    function getEntity(p) {
      if (p.entityType === "optica") return optById.get(p.entityId);
      return farmById.get(p.entityId);
    }

    function renderRows() {
      const type = ($("#oType").value || "").trim();
      const onlyMine = ($("#oMine").value || "1") === "1";

      let arr = pedidos
        .filter((p) => String(p.estado || "") === "confirmado")
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      if (type) arr = arr.filter(p => p.entityType === type);

      if (onlyMine) {
        arr = arr.filter(p => {
          if (p.entityType === "optica") return misO.has(p.entityId);
          return misF.has(p.entityId);
        });
      }

      $("#oRows").innerHTML = arr.map((p) => {
        const e = getEntity(p);
        const tipo = p.entityType === "optica" ? "Óptica" : "Farmacia";
        const titular = e?.cliente || "—";
        const name = entityName(p.entityType, e);
        return `
          <tr>
            <td>${escapeHtml(fmtDate(p.fecha))}</td>
            <td>${escapeHtml(tipo)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(titular)}</td>
            <td><b>${fmtEur(p.total || 0)}</b></td>
            <td class="right">
              <button class="btn btn-xs" data-act="edit" data-id="${escapeAttr(p.id)}">Editar</button>
              <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(p.id)}">Borrar</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    renderRows();
    $("#oType").onchange = renderRows;
    $("#oMine").onchange = renderRows;

    $("#oNew").onclick = () => openPedidoEdit(null, null, null);

    $("#oImport").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importPedidosJsonFile(f);
        await refreshState();
        render();
      };
      inp.click();
    };

    $("#oPaste").onclick = () => {
      dlgOpenMain(
        "Importar pedidos",
        "Pega aquí el JSON de pedidos",
        `
          <label>JSON</label>
          <textarea id="pasteJSON" style="min-height:220px"
            placeholder='[ { "cliente": "...", "estado": "Confirmado", "elementos": 3, "fecha": "2026-01-12", "total_eur": 123.45 } ]'></textarea>
          <div class="mini muted">Se importan solo estados Confirmado / Exportado / Enviado.</div>
        `,
        `
          <div class="row">
            <div class="mini muted">Importa como pedidos de farmacias (por titular).</div>
            <div class="right flex">
              <button class="btn" id="pCancel">Cancelar</button>
              <button class="btn-primary" id="pDo">Importar</button>
            </div>
          </div>
        `
      );
      $("#pCancel").onclick = () => dlgCloseMain();
      $("#pDo").onclick = async () => {
        const txt = $("#pasteJSON").value || "";
        await importPedidosFromText(txt);
        dlgCloseMain();
        await refreshState();
        render();
      };
    };

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (!act || !id) return;

      if (act === "del") {
        if (!confirm("¿Borrar pedido?")) return;
        await dbDel("pedidos", id);
        toast("Pedido borrado");
        await refreshState();
        render();
        return;
      }
      if (act === "edit") return openPedidoEdit(id, null, null);
    };
  }

  /**********************
   * Rutas (lista diaria sugerida basada en predicciones)
   **********************/
  async function renderRutas(viewEl) {
    const { farmacias, opticas, pedidos, settings } = state;
    const daysSoon = Number(settings.daysSoon || 7);

    const { due: dueF, soon: soonF } = computeDueSoon(farmacias, pedidos, daysSoon, "farmacia");
    const { due: dueO, soon: soonO } = computeDueSoon(opticas, pedidos, daysSoon, "optica");

    const list = [
      ...dueF.map(x => ({...x, entityType:"farmacia"})),
      ...dueO.map(x => ({...x, entityType:"optica"})),
      ...soonF.map(x => ({...x, entityType:"farmacia"})),
      ...soonO.map(x => ({...x, entityType:"optica"})),
    ].sort((a,b) => b.priority - a.priority || a.diff - b.diff);

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Rutas</h2>
            <div class="mini muted">Lista sugerida para hoy basada en predicciones (vencidas y próximas).</div>
          </div>
          <div class="right">
            <span class="pill ok">${escapeHtml(todayYMD())}</span>
          </div>
        </div>

        <div class="hr"></div>

        ${renderSuggestList(list.map(x => ({e:x.e, metaText:x.metaText, diff:x.diff, priority:x.priority})), "farmacia", true)
          .replaceAll('data-type="farmacia"', (m)=>m) /* keep */}
        <div class="mini muted" style="margin-top:10px">
          Nota: en esta vista se mezclan farmacias y ópticas. Usa Predicciones para ver por separado.
        </div>
      </div>
    `;

    // Delegación: los data-type en esta vista no están, así que añadimos type por dataset en botones al renderSuggestList
    // Re-render rápido: añadimos data-type correcto aquí con un fix de post-proceso
    // (robusto y simple)
    const buttons = $$("button[data-act]", viewEl);
    for (const btn of buttons) {
      if (!btn.dataset.type) {
        // inferimos por texto del título del item: guardamos en parent
        const parent = btn.closest(".list-item");
        // intentamos detectar por presencia en catálogos
        const id = btn.dataset.id;
        const isOpt = state.opticas.some(o => o.id === id);
        btn.dataset.type = isOpt ? "optica" : "farmacia";
      }
    }

    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const type = b.dataset.type;
      const id = b.dataset.id;
      if (!act || !type || !id) return;

      if (act === "maps") {
        const entity = type === "optica" ? state.opticas.find(x => x.id === id) : state.farmacias.find(x => x.id === id);
        const url = mapsLinkForEntity(entity);
        if (url) window.open(url, "_blank", "noopener");
      }
      if (act === "details") {
        type === "optica" ? openOpticaDetails(id) : openFarmaciaDetails(id);
      }
      if (act === "visit") openVisitaModal(type, id);
    };
  }

  /**********************
   * Visitas (antes check-ins) — listar por día
   **********************/
  async function renderVisitas(viewEl) {
    const { visitas, farmacias, opticas } = state;
    const farmById = new Map(farmacias.map((f) => [f.id, f]));
    const optById = new Map(opticas.map((o) => [o.id, o]));

    const day0 = todayYMD();

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Visitas (${visitas.length})</h2>
            <div class="mini muted">Registra visitas con fecha y notas. Filtra por día.</div>
          </div>
          <div class="right">
            <button class="btn-primary btn-xs" id="vNew">+ Nueva visita</button>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div>
            <label>Día</label>
            <input id="vDay" type="date" value="${escapeAttr(day0)}" />
          </div>
          <div>
            <label>Buscar</label>
            <input id="vSearch" placeholder="Entidad / titular / notas..." />
          </div>
        </div>

        <div class="hr"></div>

        <div id="vRows"></div>
      </div>
    `;

    function getEntity(ci) {
      if (ci.entityType === "optica") return optById.get(ci.entityId);
      return farmById.get(ci.entityId);
    }

    function renderRows() {
      const day = ($("#vDay").value || day0).trim();
      const q = ($("#vSearch").value || "").trim().toLowerCase();

      let list = visitas
        .filter(v => (v.day || (v.fecha||"").slice(0,10)) === day)
        .sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

      if (q) {
        list = list.filter((v) => {
          const e = getEntity(v);
          const blob = `${entityName(v.entityType, e)} ${e?.cliente||""} ${e?.concello||""} ${e?.ciudad||""} ${v.notas||""}`.toLowerCase();
          return blob.includes(q);
        });
      }

      $("#vRows").innerHTML = `
        <div class="list">
          ${list.length ? list.map((v) => {
            const e = getEntity(v);
            const t = v.entityType === "optica" ? "Óptica" : "Farmacia";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(entityName(v.entityType, e))}</b> <span class="pill">${escapeHtml(t)}</span><br>
                  <span class="mini muted">${escapeHtml(fmtDate(v.fecha))} · Titular: ${escapeHtml(e?.cliente || "—")}</span><br>
                  <span class="mini muted">${escapeHtml(v.notas || "")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-type="${escapeAttr(v.entityType)}" data-id="${escapeAttr(v.entityId)}">Detalles</button>
                  <button class="btn-danger btn-xs" data-act="del" data-vid="${escapeAttr(v.id)}">Borrar</button>
                </div>
              </div>
            `;
          }).join("") : `<div class="muted">—</div>`}
        </div>
      `;
    }

    renderRows();
    $("#vDay").onchange = renderRows;
    $("#vSearch").oninput = renderRows;

    $("#vNew").onclick = () => openVisitaModal(null, null);

    viewEl.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;

      if (act === "details") {
        const type = b.dataset.type;
        const id = b.dataset.id;
        if (type === "optica") openOpticaDetails(id);
        else openFarmaciaDetails(id);
        return;
      }
      if (act === "del") {
        const vid = b.dataset.vid;
        if (!confirm("¿Borrar visita?")) return;
        await dbDel("visitas", vid);
        toast("Visita borrada");
        await refreshState();
        render();
      }
    };
  }

  /**********************
   * Backup
   **********************/
  async function renderBackup(viewEl) {
    viewEl.innerHTML = `
      <div class="card">
        <h2>Backup</h2>
        <div class="mini muted">Exporta o importa todos los datos (farmacias, ópticas, mis, pedidos, productos, visitas, ajustes).</div>
        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Exportar</h2>
            <div class="mini muted">Genera un JSON con toda la base de datos offline.</div>
            <div class="hr"></div>
            <button class="btn-primary" id="bExport">Exportar JSON</button>
          </div>

          <div class="card" style="margin:0">
            <h2>Importar</h2>
            <div class="mini muted">Restaura un backup exportado previamente.</div>
            <div class="hr"></div>
            <button class="btn" id="bImport">Importar JSON</button>
            <div class="mini muted" style="margin-top:10px">⚠️ Importar sobrescribe por clave (id). No borra lo que no exista en el JSON.</div>
          </div>
        </div>
      </div>
    `;

    $("#bExport").onclick = async () => {
      const payload = {
        exportedAt: nowISO(),
        version: 3,
        farmacias: await dbAll("farmacias"),
        misFarmacias: await dbAll("misFarmacias"),
        opticas: await dbAll("opticas"),
        misOpticas: await dbAll("misOpticas"),
        productos: await dbAll("productos"),
        pedidos: await dbAll("pedidos"),
        visitas: await dbAll("visitas"),
        settings: await dbAll("settings"),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_ventas_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Backup exportado");
    };

    $("#bImport").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        const txt = await f.text();
        let obj;
        try { obj = JSON.parse(txt); } catch { toast("JSON inválido"); return; }

        const putAll = async (store, arr) => {
          if (!Array.isArray(arr)) return;
          for (const x of arr) await dbPut(store, x);
        };

        await putAll("farmacias", obj.farmacias);
        await putAll("misFarmacias", obj.misFarmacias);
        await putAll("opticas", obj.opticas);
        await putAll("misOpticas", obj.misOpticas);
        await putAll("productos", obj.productos);
        await putAll("pedidos", obj.pedidos);
        await putAll("visitas", obj.visitas);
        await putAll("settings", obj.settings);

        toast("Backup importado");
        await refreshState();
        render();
      };
      inp.click();
    };
  }

  /**********************
   * Ajustes
   **********************/
  async function renderAjustes(viewEl) {
    const settings = state.settings;

    const now = new Date();
    const y2 = String(now.getFullYear()).slice(-2);
    const keys = ["1T", "2T", "3T", "4T"].map((q) => q + y2);
    const qNow = quarterKey(now);

    viewEl.innerHTML = `
      <div class="card">
        <h2>Ajustes</h2>
        <div class="mini muted">Objetivos trimestrales, objetivo deseado y ventana de “próximas”.</div>
        <div class="hr"></div>

        <form id="prefsForm">
          <h2>Objetivos por trimestre (${y2})</h2>

          <div class="grid two">
            ${keys.map((k) => {
              const val = Number(settings.quarterlyTargets?.[k] || 0);
              return `
                <div>
                  <label>${escapeHtml(k)} (objetivo)</label>
                  <input name="qt_${escapeAttr(k)}" type="number" min="0" step="100"
                    value="${escapeAttr(val)}"
                    data-help="Objetivo total de ventas para ${k}." />
                </div>
              `;
            }).join("")}
          </div>

          <div class="hr"></div>

          <div class="grid two">
            <div>
              <label>% extra sobre el objetivo del trimestre</label>
              <input name="desiredPct" type="number" min="0" step="0.5"
                value="${Number(settings.desiredPct || 0)}"
                data-help="Ej: 10%." />
            </div>
            <div>
              <label>Días para “próximas”</label>
              <input name="daysSoon" type="number" min="1" step="1"
                value="${Number(settings.daysSoon || 7)}"
                data-help="Ventana para marcar próximas (ej: 7 días)." />
            </div>
          </div>

          <div class="hr"></div>

          <div class="right">
            <button class="btn-primary" type="submit">Guardar</button>
          </div>

          <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
        </form>

        <div class="hr"></div>

        <div class="mini muted">
          Trimestre actual: <b>${escapeHtml(qNow)}</b> · Objetivo: <b>${fmtEur(getQuarterTarget(settings, qNow))}</b>
        </div>
      </div>
    `;

    wireHelp(viewEl);

    $("#prefsForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;

      const qt = { ...(settings.quarterlyTargets || {}) };
      for (const k of keys) {
        const inp = f[`qt_${k}`];
        const v = Math.max(0, Number(inp.value || 0));
        qt[k] = v;
      }
      const desiredPct = Math.max(0, Number(f.desiredPct.value || 0));
      const daysSoon = Math.max(1, Number(f.daysSoon.value || 7));

      await saveSetting("quarterlyTargets", qt);
      await saveSetting("desiredPct", desiredPct);
      await saveSetting("daysSoon", daysSoon);

      toast("Ajustes guardados");
      await refreshState();
      render();
    };
  }

  /**********************
   * CRUD — Farmacia / Óptica / Producto
   **********************/
  async function openFarmaciaEdit(id) {
    const isNew = !id;
    const f = isNew
      ? {
          id: uid(),
          codigo: "",
          nombre: "",
          direccion: "",
          cp: "",
          concello: "",
          telefono: "",
          cliente: "",
          lat: null,
          lon: null,
          source: "manual",
          createdAt: nowISO(),
          updatedAt: nowISO(),
        }
      : await dbGet("farmacias", id);

    if (!f) { toast("No encontrada"); return; }

    dlgOpenMain(
      isNew ? "Alta manual (Farmacia)" : "Editar farmacia",
      "Completa los datos principales.",
      `
        <label>Nombre</label>
        <input id="fNombre" value="${escapeAttr(f.nombre || "")}" />

        <label>Código</label>
        <input id="fCodigo" value="${escapeAttr(f.codigo || "")}" placeholder="PO-041-F" />

        <label>Titular</label>
        <input id="fCliente" value="${escapeAttr(f.cliente || "")}" />

        <label>Teléfono</label>
        <input id="fTel" value="${escapeAttr(f.telefono || "")}" />

        <label>Concello</label>
        <input id="fConc" value="${escapeAttr(f.concello || "")}" />

        <label>Código postal</label>
        <input id="fCp" value="${escapeAttr(f.cp || "")}" />

        <label>Dirección</label>
        <input id="fDir" value="${escapeAttr(f.direccion || "")}" />

        <div class="grid two">
          <div>
            <label>Lat</label>
            <input id="fLat" value="${escapeAttr(f.lat ?? "")}" />
          </div>
          <div>
            <label>Lon</label>
            <input id="fLon" value="${escapeAttr(f.lon ?? "")}" />
          </div>
        </div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(f.source || "manual")} · ${escapeHtml(f.codigo || f.id)}</div>
          <div class="right flex">
            <button class="btn" id="fCancel">Cancelar</button>
            <button class="btn-primary" id="fSave">Guardar</button>
          </div>
        </div>
      `
    );

    $("#fCancel").onclick = () => dlgCloseMain();
    $("#fSave").onclick = async () => {
      f.nombre = ($("#fNombre").value || "").trim();
      f.codigo = ($("#fCodigo").value || "").trim();
      f.cliente = ($("#fCliente").value || "").trim();
      f.telefono = ($("#fTel").value || "").trim();
      f.concello = ($("#fConc").value || "").trim();
      f.cp = ($("#fCp").value || "").trim();
      f.direccion = ($("#fDir").value || "").trim();

      const lat = ($("#fLat").value || "").trim();
      const lon = ($("#fLon").value || "").trim();
      f.lat = lat === "" ? null : Number(lat);
      f.lon = lon === "" ? null : Number(lon);

      f.updatedAt = nowISO();

      await dbPut("farmacias", f);
      toast("Farmacia guardada");
      dlgCloseMain();
      await refreshState();
      render();
    };
  }

  async function openOpticaEdit(id) {
    const isNew = !id;
    const o = isNew
      ? {
          id: uid(),
          codigo: "",
          nombre: "",
          direccion: "",
          ciudad: "",
          telefono: "",
          cliente: "",
          lat: null,
          lon: null,
          source: "manual",
          createdAt: nowISO(),
          updatedAt: nowISO(),
        }
      : await dbGet("opticas", id);

    if (!o) { toast("No encontrada"); return; }

    dlgOpenMain(
      isNew ? "Alta manual (Óptica)" : "Editar óptica",
      "Completa los datos principales.",
      `
        <label>Nombre</label>
        <input id="oNombre" value="${escapeAttr(o.nombre || "")}" />

        <label>Código</label>
        <input id="oCodigo" value="${escapeAttr(o.codigo || "")}" />

        <label>Titular</label>
        <input id="oCliente" value="${escapeAttr(o.cliente || "")}" />

        <label>Teléfono</label>
        <input id="oTel" value="${escapeAttr(o.telefono || "")}" />

        <label>Ciudad</label>
        <input id="oCiudad" value="${escapeAttr(o.ciudad || "")}" />

        <label>Dirección</label>
        <input id="oDir" value="${escapeAttr(o.direccion || "")}" />

        <div class="grid two">
          <div>
            <label>Lat</label>
            <input id="oLat" value="${escapeAttr(o.lat ?? "")}" />
          </div>
          <div>
            <label>Lon</label>
            <input id="oLon" value="${escapeAttr(o.lon ?? "")}" />
          </div>
        </div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(o.source || "manual")} · ${escapeHtml(o.codigo || o.id)}</div>
          <div class="right flex">
            <button class="btn" id="oCancel">Cancelar</button>
            <button class="btn-primary" id="oSave">Guardar</button>
          </div>
        </div>
      `
    );

    $("#oCancel").onclick = () => dlgCloseMain();
    $("#oSave").onclick = async () => {
      o.nombre = ($("#oNombre").value || "").trim();
      o.codigo = ($("#oCodigo").value || "").trim();
      o.cliente = ($("#oCliente").value || "").trim();
      o.telefono = ($("#oTel").value || "").trim();
      o.ciudad = ($("#oCiudad").value || "").trim();
      o.direccion = ($("#oDir").value || "").trim();

      const lat = ($("#oLat").value || "").trim();
      const lon = ($("#oLon").value || "").trim();
      o.lat = lat === "" ? null : Number(lat);
      o.lon = lon === "" ? null : Number(lon);

      o.updatedAt = nowISO();

      await dbPut("opticas", o);
      toast("Óptica guardada");
      dlgCloseMain();
      await refreshState();
      render();
    };
  }

  async function openProductoEdit(id) {
    const isNew = !id;
    const p = isNew
      ? { id: uid(), nombre: "", descripcion: "", creadoEn: nowISO(), actualizadoEn: nowISO() }
      : await dbGet("productos", id);

    if (!p) { toast("No encontrado"); return; }

    dlgOpenMain(
      isNew ? "Nuevo producto" : "Editar producto",
      "Campos básicos.",
      `
        <label>Nombre</label>
        <input id="pNombre" value="${escapeAttr(p.nombre || "")}" />

        <label>Descripción</label>
        <textarea id="pDesc">${escapeHtml(p.descripcion || "")}</textarea>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(p.id)}</div>
          <div class="right flex">
            <button class="btn" id="pCancel">Cancelar</button>
            <button class="btn-primary" id="pSave">Guardar</button>
          </div>
        </div>
      `
    );

    $("#pCancel").onclick = () => dlgCloseMain();
    $("#pSave").onclick = async () => {
      p.nombre = ($("#pNombre").value || "").trim();
      p.descripcion = ($("#pDesc").value || "").trim();
      p.actualizadoEn = nowISO();
      await dbPut("productos", p);
      toast("Producto guardado");
      dlgCloseMain();
      await refreshState();
      render();
    };
  }

  /**********************
   * Detalles (Farmacia / Óptica)
   **********************/
  async function openFarmaciaDetails(fid) {
    const f = await dbGet("farmacias", fid);
    if (!f) { toast("No encontrada"); return; }

    const pedidos = (await dbAll("pedidos"))
      .filter((p) => p.entityType === "farmacia" && p.entityId === fid)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const ok = getPedidosOk(pedidos);
    const st = farmaciaStats(fid, ok);
    const nextTxt = st.hasEstimate
      ? `Próximo estimado: ${fmtDate(st.nextISO)} (media ${Math.round(st.avgDays)} días)`
      : "Próximo estimado: — (mín. 3 pedidos confirmados)";

    const visitas = (await dbAll("visitas"))
      .filter(v => v.entityType === "farmacia" && v.entityId === fid)
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 8);

    dlgOpenMain(
      f.nombre || f.codigo || "Farmacia",
      `${f.concello || "—"} · Titular: ${f.cliente || "—"} · Tel: ${f.telefono || "—"}`,
      `
        <div class="mini muted">
          <b>Código:</b> ${escapeHtml(f.codigo || "—")}<br>
          <b>Dirección:</b> ${escapeHtml(f.direccion || "—")}<br>
          <b>CP:</b> ${escapeHtml(f.cp || "—")}<br>
          <b>Concello:</b> ${escapeHtml(f.concello || "—")}<br>
          <b>Titular:</b> ${escapeHtml(f.cliente || "—")}<br>
          <b>Teléfono:</b> ${escapeHtml(f.telefono || "—")}<br>
          <div class="hr"></div>
          <b>${escapeHtml(nextTxt)}</b>
        </div>

        <div class="hr"></div>

        <h2>Visitas recientes</h2>
        ${visitas.length ? `
          <div class="list">
            ${visitas.map(v => `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(fmtDate(v.fecha))}</b><br>
                  <span class="mini muted">${escapeHtml(v.notas || "")}</span>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="muted">—</div>`}

        <div class="hr"></div>

        <h2>Últimos pedidos</h2>
        ${
          pedidos.slice(0,10).length
            ? `
              <div style="overflow:auto">
                <table>
                  <thead>
                    <tr>
                      <th style="width:110px">Fecha</th>
                      <th style="width:120px">Estado</th>
                      <th style="width:120px">Elementos</th>
                      <th style="width:140px">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pedidos.slice(0,10).map((p) => `
                      <tr>
                        <td>${escapeHtml(fmtDate(p.fecha))}</td>
                        <td><span class="pill ${p.estado === "confirmado" ? "ok" : "warn"}">${escapeHtml(p.estado)}</span></td>
                        <td>${escapeHtml(p.elementos ?? "—")}</td>
                        <td><b>${fmtEur(p.total || 0)}</b></td>
                        <td class="right">
                          <button class="btn btn-xs" data-act="editPedido" data-id="${escapeAttr(p.id)}">Editar</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="muted">—</div>`
        }

        <div class="hr"></div>

        <h2>Acciones</h2>
        <div class="flex">
          <button class="btn" data-act="maps">Abrir en Maps</button>
          <button class="btn-primary" data-act="visit">Registrar visita</button>
          <button class="btn" data-act="newPedido">Nuevo pedido</button>
          <button class="btn" data-act="editFarm">Editar ficha</button>
        </div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(f.source || "—")} · ${escapeHtml(f.codigo || f.id)}</div>
          <div class="right">
            <button class="btn" id="dlgCloseFarm">Cerrar</button>
          </div>
        </div>
      `
    );

    $("#dlgCloseFarm").onclick = () => dlgCloseMain();

    $("#dlgMainBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;

      if (act === "maps") {
        const url = mapsLinkForEntity(f);
        if (url) window.open(url, "_blank", "noopener");
      }
      if (act === "visit") {
        dlgCloseMain();
        openVisitaModal("farmacia", fid);
      }
      if (act === "newPedido") {
        dlgCloseMain();
        openPedidoEdit(null, "farmacia", fid);
      }
      if (act === "editFarm") {
        dlgCloseMain();
        openFarmaciaEdit(fid);
      }
      if (act === "editPedido") {
        const pid = b.dataset.id;
        dlgCloseMain();
        openPedidoEdit(pid, null, null);
      }
    };
  }

  async function openOpticaDetails(oid) {
    const o = await dbGet("opticas", oid);
    if (!o) { toast("No encontrada"); return; }

    const pedidos = (await dbAll("pedidos"))
      .filter((p) => p.entityType === "optica" && p.entityId === oid)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const ok = getPedidosOk(pedidos);
    const st = farmaciaStats(oid, ok);
    const nextTxt = st.hasEstimate
      ? `Próximo estimado: ${fmtDate(st.nextISO)} (media ${Math.round(st.avgDays)} días)`
      : "Próximo estimado: — (mín. 3 pedidos confirmados)";

    const visitas = (await dbAll("visitas"))
      .filter(v => v.entityType === "optica" && v.entityId === oid)
      .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 8);

    dlgOpenMain(
      o.nombre || o.codigo || "Óptica",
      `${o.ciudad || "—"} · Titular: ${o.cliente || "—"} · Tel: ${o.telefono || "—"}`,
      `
        <div class="mini muted">
          <b>Código:</b> ${escapeHtml(o.codigo || "—")}<br>
          <b>Dirección:</b> ${escapeHtml(o.direccion || "—")}<br>
          <b>Ciudad:</b> ${escapeHtml(o.ciudad || "—")}<br>
          <b>Titular:</b> ${escapeHtml(o.cliente || "—")}<br>
          <b>Teléfono:</b> ${escapeHtml(o.telefono || "—")}<br>
          <div class="hr"></div>
          <b>${escapeHtml(nextTxt)}</b>
        </div>

        <div class="hr"></div>

        <h2>Visitas recientes</h2>
        ${visitas.length ? `
          <div class="list">
            ${visitas.map(v => `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(fmtDate(v.fecha))}</b><br>
                  <span class="mini muted">${escapeHtml(v.notas || "")}</span>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="muted">—</div>`}

        <div class="hr"></div>

        <h2>Últimos pedidos</h2>
        ${
          pedidos.slice(0,10).length
            ? `
              <div style="overflow:auto">
                <table>
                  <thead>
                    <tr>
                      <th style="width:110px">Fecha</th>
                      <th style="width:120px">Estado</th>
                      <th style="width:120px">Elementos</th>
                      <th style="width:140px">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pedidos.slice(0,10).map((p) => `
                      <tr>
                        <td>${escapeHtml(fmtDate(p.fecha))}</td>
                        <td><span class="pill ${p.estado === "confirmado" ? "ok" : "warn"}">${escapeHtml(p.estado)}</span></td>
                        <td>${escapeHtml(p.elementos ?? "—")}</td>
                        <td><b>${fmtEur(p.total || 0)}</b></td>
                        <td class="right">
                          <button class="btn btn-xs" data-act="editPedido" data-id="${escapeAttr(p.id)}">Editar</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `
            : `<div class="muted">—</div>`
        }

        <div class="hr"></div>

        <h2>Acciones</h2>
        <div class="flex">
          <button class="btn" data-act="maps">Abrir en Maps</button>
          <button class="btn-primary" data-act="visit">Registrar visita</button>
          <button class="btn" data-act="newPedido">Nuevo pedido</button>
          <button class="btn" data-act="editOpt">Editar ficha</button>
        </div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(o.source || "—")} · ${escapeHtml(o.codigo || o.id)}</div>
          <div class="right">
            <button class="btn" id="dlgCloseOpt">Cerrar</button>
          </div>
        </div>
      `
    );

    $("#dlgCloseOpt").onclick = () => dlgCloseMain();

    $("#dlgMainBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;

      if (act === "maps") {
        const url = mapsLinkForEntity(o);
        if (url) window.open(url, "_blank", "noopener");
      }
      if (act === "visit") {
        dlgCloseMain();
        openVisitaModal("optica", oid);
      }
      if (act === "newPedido") {
        dlgCloseMain();
        openPedidoEdit(null, "optica", oid);
      }
      if (act === "editOpt") {
        dlgCloseMain();
        openOpticaEdit(oid);
      }
      if (act === "editPedido") {
        const pid = b.dataset.id;
        dlgCloseMain();
        openPedidoEdit(pid, null, null);
      }
    };
  }

  /**********************
   * Visita modal (registrar visita)
   **********************/
  async function openVisitaModal(entityType, entityId) {
    // si no se pasa, permite seleccionar
    const type0 = entityType || "farmacia";
    const day0 = todayYMD();

    const misF = await getMisIds("misFarmacias", "farmaciaId");
    const misO = await getMisIds("misOpticas", "opticaId");

    const farms = state.farmacias.filter(f => misF.has(f.id)).sort((a,b)=> (a.nombre||a.codigo||"").localeCompare(b.nombre||b.codigo||"", "es"));
    const opts  = state.opticas.filter(o => misO.has(o.id)).sort((a,b)=> (a.nombre||a.codigo||"").localeCompare(b.nombre||b.codigo||"", "es"));

    const selectedList = (type0 === "optica") ? opts : farms;
    const selectedId = entityId || selectedList[0]?.id || "";

    dlgOpenMain(
      "Registrar visita",
      "Fecha + notas. Se guarda en tu historial.",
      `
        <label>Tipo</label>
        <select id="vType">
          <option value="farmacia"${type0==="farmacia" ? " selected":""}>Farmacia</option>
          <option value="optica"${type0==="optica" ? " selected":""}>Óptica</option>
        </select>

        <label>Entidad (solo MIS)</label>
        <select id="vEntity"></select>

        <label>Fecha</label>
        <input id="vFecha" type="date" value="${escapeAttr(day0)}" />

        <label>Notas</label>
        <textarea id="vNotas" placeholder="Qué hiciste, feedback, próximos pasos..."></textarea>
      `,
      `
        <div class="row">
          <div class="mini muted">Se guarda como visita.</div>
          <div class="right flex">
            <button class="btn" id="vCancel">Cancelar</button>
            <button class="btn-primary" id="vSave">Guardar</button>
          </div>
        </div>
      `
    );

    function fillEntitySelect() {
      const t = ($("#vType").value || "farmacia").trim();
      const list = t === "optica" ? opts : farms;
      const cur = (t === type0) ? selectedId : (list[0]?.id || "");
      $("#vEntity").innerHTML = list.map(x => `<option value="${escapeAttr(x.id)}"${x.id===cur ? " selected":""}>${escapeHtml(entityName(t, x))}</option>`).join("");
      if (!list.length) $("#vEntity").innerHTML = `<option value="">(no hay elementos en Mis)</option>`;
    }
    fillEntitySelect();

    $("#vType").onchange = fillEntitySelect;

    $("#vCancel").onclick = () => dlgCloseMain();
    $("#vSave").onclick = async () => {
      const t = ($("#vType").value || "farmacia").trim();
      const eid = ($("#vEntity").value || "").trim();
      const ymd = ($("#vFecha").value || "").trim();
      const d = parseISODateYMD(ymd);
      if (!eid || !d) { toast("Falta entidad o fecha"); return; }

      const v = {
        id: uid(),
        entityType: t,
        entityId: eid,
        fecha: d.toISOString(),
        day: ymd,
        notas: ($("#vNotas").value || "").trim(),
        createdAt: nowISO(),
      };

      await dbPut("visitas", v);
      toast("Visita guardada");
      dlgCloseMain();
      await refreshState();
      render();
    };
  }

  /**********************
   * Pedido editor (multi-línea con subdialog) + selector Mis
   **********************/
  async function openPedidoEdit(id, presetType, presetEntityId) {
    const isNew = !id;

    const productos = state.productos.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    if (!productos.length) await ensureProductoGeneral();

    const misF = await getMisIds("misFarmacias", "farmaciaId");
    const misO = await getMisIds("misOpticas", "opticaId");

    const farms = state.farmacias.filter(f => misF.has(f.id)).sort((a,b)=> (a.nombre||a.codigo||"").localeCompare(b.nombre||b.codigo||"", "es"));
    const opts  = state.opticas.filter(o => misO.has(o.id)).sort((a,b)=> (a.nombre||a.codigo||"").localeCompare(b.nombre||b.codigo||"", "es"));

    let p = isNew
      ? recomputePedido({
          id: uid(),
          entityType: presetType || "farmacia",
          entityId: presetEntityId || (presetType==="optica" ? (opts[0]?.id||"") : (farms[0]?.id||"")),
          fecha: nowISO(),
          estado: "confirmado",
          elementos: 0,
          notas: "",
          lineas: [],
          total: 0,
          creadoEn: nowISO(),
          actualizadoEn: nowISO(),
        })
      : await dbGet("pedidos", id);

    if (!p) { toast("Pedido no encontrado"); return; }

    function buildLineRow(l, idx) {
      const prodName = l.nombre || "—";
      return `
        <div class="list-item">
          <div>
            <b>${escapeHtml(prodName)}</b><br>
            <span class="mini muted">Cant: ${escapeHtml(l.cantidad)} · PU: ${fmtEur(l.precioUnit)} · Total: <b>${fmtEur(l.total)}</b></span>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" data-act="editLine" data-idx="${idx}">Editar</button>
            <button class="btn-danger btn-xs" data-act="delLine" data-idx="${idx}">Quitar</button>
          </div>
        </div>
      `;
    }

    dlgOpenMain(
      isNew ? "Nuevo pedido" : "Editar pedido",
      "Pedido offline (farmacia u óptica).",
      `
        <label>Tipo</label>
        <select id="pType">
          <option value="farmacia"${p.entityType==="farmacia" ? " selected":""}>Farmacia</option>
          <option value="optica"${p.entityType==="optica" ? " selected":""}>Óptica</option>
        </select>

        <label>Entidad (solo MIS)</label>
        <select id="pEntity"></select>

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input id="pFecha" type="date" value="${escapeAttr(new Date(p.fecha).toISOString().slice(0, 10))}" />
          </div>
          <div>
            <label>Estado</label>
            <select id="pEstado">
              ${["confirmado", "borrador"].map((s) => `<option${s === p.estado ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Elementos</label>
            <input id="pElem" type="number" min="0" step="1" value="${escapeAttr(p.elementos || 0)}" />
          </div>
          <div>
            <label>Total (calculado)</label>
            <input id="pTotal" disabled value="${escapeAttr(fmtEur(p.total || 0))}" />
          </div>
        </div>

        <label>Notas</label>
        <textarea id="pNotas">${escapeHtml(p.notas || "")}</textarea>

        <div class="hr"></div>

        <div class="row">
          <div>
            <h2>Productos</h2>
            <div class="mini muted">Añade varios productos; el total se calcula automáticamente.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="addLine">+ Añadir producto</button>
          </div>
        </div>

        <div id="linesBox" class="list"></div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(p.id)}</div>
          <div class="right flex">
            <button class="btn" id="pCancel">Cancelar</button>
            <button class="btn-primary" id="pSave">Guardar</button>
          </div>
        </div>
      `
    );

    const linesBox = $("#linesBox");
    function fillEntitySelect() {
      const t = ($("#pType").value || "farmacia").trim();
      const list = t === "optica" ? opts : farms;
      const cur = (p.entityType === t) ? p.entityId : (list[0]?.id || "");
      $("#pEntity").innerHTML = list.map(x => `<option value="${escapeAttr(x.id)}"${x.id===cur ? " selected":""}>${escapeHtml(entityName(t, x))}</option>`).join("");
      if (!list.length) $("#pEntity").innerHTML = `<option value="">(no hay elementos en Mis)</option>`;
    }

    function renderLines() {
      p.lineas = Array.isArray(p.lineas) ? p.lineas : [];
      recomputePedido(p);
      linesBox.innerHTML = p.lineas.length ? p.lineas.map(buildLineRow).join("") : `<div class="muted">—</div>`;
      $("#pTotal").value = fmtEur(p.total || 0);
    }

    fillEntitySelect();
    renderLines();

    $("#pType").onchange = () => {
      fillEntitySelect();
      // no cambiamos p.entityType hasta guardar
    };

    $("#pCancel").onclick = () => dlgCloseMain();

    $("#pSave").onclick = async () => {
      const t = ($("#pType").value || "farmacia").trim();
      const eid = ($("#pEntity").value || "").trim();
      const ymd = ($("#pFecha").value || "").trim();
      const d = parseISODateYMD(ymd);
      if (!eid || !d) { toast("Falta entidad o fecha"); return; }

      p.entityType = t;
      p.entityId = eid;
      p.fecha = d.toISOString();
      p.estado = ($("#pEstado").value || "confirmado").trim();
      p.elementos = Math.max(0, Number($("#pElem").value || 0));
      p.notas = ($("#pNotas").value || "").trim();
      p.actualizadoEn = nowISO();
      recomputePedido(p);

      await dbPut("pedidos", p);
      toast("Pedido guardado");
      dlgCloseMain();
      await refreshState();
      render();
    };

    $("#addLine").onclick = () => openLineEdit(p, null, productos, renderLines);

    $("#dlgMainBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;

      const act = b.dataset.act;
      const idx = Number(b.dataset.idx);

      if (act === "delLine") {
        p.lineas.splice(idx, 1);
        renderLines();
        return;
      }
      if (act === "editLine") {
        openLineEdit(p, idx, productos, renderLines);
      }
    };
  }

  function openLineEdit(pedido, idx, productos, onDone) {
    const isNew = idx == null;
    const baseProd = productos[0] || { id: "", nombre: "General" };
    const l = isNew
      ? { id: uid(), productoId: baseProd.id, nombre: baseProd.nombre, cantidad: 1, precioUnit: 0, descuentoPct: 0, total: 0 }
      : { ...pedido.lineas[idx] };

    dlgOpenSub(
      isNew ? "Añadir producto" : "Editar producto",
      "Detalle de la línea",
      `
        <label>Producto</label>
        <select id="lProd">
          ${productos.map((pr) =>
            `<option value="${escapeAttr(pr.id)}"${pr.id === l.productoId ? " selected" : ""}>${escapeHtml(pr.nombre)}</option>`
          ).join("")}
        </select>

        <div class="grid two">
          <div>
            <label>Cantidad</label>
            <input id="lQty" type="number" min="0" step="1" value="${escapeAttr(l.cantidad)}" />
          </div>
          <div>
            <label>Precio unitario</label>
            <input id="lPU" type="number" min="0" step="0.01" value="${escapeAttr(l.precioUnit)}" />
          </div>
        </div>

        <label>Descuento (%)</label>
        <input id="lDto" type="number" min="0" step="0.5" value="${escapeAttr(l.descuentoPct || 0)}" />
      `,
      `
        <div class="row">
          <div class="mini muted">El total se recalcula al guardar</div>
          <div class="right flex">
            <button class="btn" id="lCancel">Cancelar</button>
            <button class="btn-primary" id="lSave">Guardar</button>
          </div>
        </div>
      `
    );

    $("#lCancel").onclick = () => dlgCloseSub();
    $("#lSave").onclick = () => {
      const pid = ($("#lProd").value || "").trim();
      const pr = productos.find((x) => x.id === pid) || baseProd;
      l.productoId = pid;
      l.nombre = pr?.nombre || "Producto";
      l.cantidad = Math.max(0, Number($("#lQty").value || 0));
      l.precioUnit = Math.max(0, Number($("#lPU").value || 0));
      l.descuentoPct = Math.max(0, Number($("#lDto").value || 0));

      if (isNew) pedido.lineas.push(l);
      else pedido.lineas[idx] = l;

      recomputePedido(pedido);
      dlgCloseSub();
      onDone?.();
    };
  }

  /**********************
   * Render dispatcher
   **********************/
  async function render() {
    const viewEl = $("#view");
    if (!viewEl) return;

    $("#btnHome").onclick = () => setView("dash");

    if (state.view === "dash") return renderDashboard(viewEl);
    if (state.view === "predicciones") return renderPredicciones(viewEl);
    if (state.view === "farmacias") return renderFarmacias(viewEl);
    if (state.view === "misfarmacias") return renderMisFarmacias(viewEl);
    if (state.view === "opticas") return renderOpticas(viewEl);
    if (state.view === "misopticas") return renderMisOpticas(viewEl);
    if (state.view === "pedidos") return renderPedidos(viewEl);
    if (state.view === "productos") return renderProductos(viewEl);
    if (state.view === "rutas") return renderRutas(viewEl);
    if (state.view === "visitas") return renderVisitas(viewEl);
    if (state.view === "backup") return renderBackup(viewEl);
    if (state.view === "ajustes") return renderAjustes(viewEl);

    viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
  }

  /**********************
   * Tabs wiring
   **********************/
  function wireTabs() {
    const tabs = $("#tabs");
    if (!tabs) return;
    tabs.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const v = b.dataset.view;
      if (!v) return;
      setView(v);
    };
  }

  /**********************
   * PWA install + SW
   **********************/
  let deferredPrompt = null;

  function wirePwaInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const btn = $("#btnInstall");
      if (btn) btn.style.display = "inline-flex";
    });

    const btn = $("#btnInstall");
    if (btn) {
      btn.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        btn.style.display = "none";
      };
    }
  }

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  /**********************
   * Dialog close wiring
   **********************/
  function wireDialogClose() {
    $("#dlgMainClose").onclick = () => dlgCloseMain();
    $("#dlgSubClose").onclick = () => dlgCloseSub();

    $("#dlgMain").addEventListener("cancel", (e) => { e.preventDefault(); dlgCloseMain(); });
    $("#dlgSub").addEventListener("cancel", (e) => { e.preventDefault(); dlgCloseSub(); });
  }

  /**********************
   * Seed mínimo
   **********************/
  async function seedIfEmpty() {
    const farms = await dbAll("farmacias");
    if (!farms.length) {
      await dbPut("farmacias", {
        id: uid(),
        codigo: "DEMO-001",
        nombre: "Farmacia Demo",
        direccion: "C/ Michelena 10, Pontevedra",
        cp: "36002",
        concello: "Pontevedra",
        telefono: "000000000",
        cliente: "Cliente Demo",
        lat: null, lon: null,
        source: "manual",
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }
    await ensureProductoGeneral();
  }

  /**********************
   * Boot
   **********************/
  (async () => {
    db = await openDB();
    await seedIfEmpty();

    wireTabs();
    wireDialogClose();
    wirePwaInstall();
    registerSW();

    await refreshState();
    setView("dash");
  })();
})();
