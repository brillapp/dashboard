/************************************************************
 * Farmacias · Ventas Offline (PWA)
 * v2.1 (cambios estructurales)
 * - Separar: Farmacias / Mis farmacias
 * - Añadir: Ópticas / Mis ópticas
 * - Renombrar: Check-ins -> Visitas (con filtro por día)
 * - Pedidos: líneas => productos (arreglo modal en partes siguientes)
 ************************************************************/

(() => {
  "use strict";

  /**********************
   * Small DOM helpers
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
   * Escape helpers
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
  function nowISO() {
    return new Date().toISOString();
  }
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
  function parseISODateYMD(ymd) {
    // ymd = "2026-01-12"
    if (!ymd) return null;
    const d = new Date(ymd + "T10:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  /**********************
   * UID
   **********************/
  function uid() {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  /**********************
   * IndexedDB
   **********************/
  const DB_NAME = "farmacias_offline_db";
  const DB_VER = 3; // <-- SUBIMOS versión por nuevas stores + migración

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const d = req.result;
        const t = req.transaction;

        // Farmacias
        if (!d.objectStoreNames.contains("farmacias")) {
          const s = d.createObjectStore("farmacias", { keyPath: "id" });
          s.createIndex("by_codigo", "codigo", { unique: false });
          s.createIndex("by_cliente", "cliente", { unique: false });
          s.createIndex("by_concello", "concello", { unique: false });
        }

        // Mis farmacias
        if (!d.objectStoreNames.contains("misFarmacias")) {
          d.createObjectStore("misFarmacias", { keyPath: "id" }); // {id, farmaciaId, createdAt}
        }

        // Ópticas (nuevo)
        if (!d.objectStoreNames.contains("opticas")) {
          const s = d.createObjectStore("opticas", { keyPath: "id" });
          s.createIndex("by_codigo", "codigo", { unique: false });
          s.createIndex("by_cliente", "cliente", { unique: false });
          s.createIndex("by_concello", "concello", { unique: false });
        }

        // Mis ópticas (nuevo)
        if (!d.objectStoreNames.contains("misOpticas")) {
          d.createObjectStore("misOpticas", { keyPath: "id" }); // {id, opticaId, createdAt}
        }

        // Productos
        if (!d.objectStoreNames.contains("productos")) {
          d.createObjectStore("productos", { keyPath: "id" });
        }

        // Pedidos
        // Nota: en partes siguientes pasamos a: {tipo:'farmacia'|'optica', entidadId:...}
        // pero mantenemos compatibilidad con pedidos antiguos (farmaciaId).
        if (!d.objectStoreNames.contains("pedidos")) {
          const s = d.createObjectStore("pedidos", { keyPath: "id" });
          s.createIndex("by_farmacia", "farmaciaId", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });
          s.createIndex("by_tipo", "tipo", { unique: false });
          s.createIndex("by_entidad", "entidadId", { unique: false });
        } else {
          // Best-effort: crear índices si faltan (algunos navegadores no permiten comprobar; lo intentamos y capturamos)
          try {
            const s = t.objectStore("pedidos");
            if (!s.indexNames.contains("by_tipo")) s.createIndex("by_tipo", "tipo", { unique: false });
            if (!s.indexNames.contains("by_entidad")) s.createIndex("by_entidad", "entidadId", { unique: false });
          } catch {}
        }

        // Visitas (nuevo) -> reemplaza checkins
        if (!d.objectStoreNames.contains("visitas")) {
          const s = d.createObjectStore("visitas", { keyPath: "id" });
          s.createIndex("by_tipo", "tipo", { unique: false });
          s.createIndex("by_entidad", "entidadId", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });

          // Migración desde checkins si existe
          if (d.objectStoreNames.contains("checkins")) {
            try {
              const old = t.objectStore("checkins");
              old.openCursor().onsuccess = (ev) => {
                const cursor = ev.target.result;
                if (!cursor) return;

                const ci = cursor.value;
                // checkins antiguos: {id, farmaciaId, fecha, notas}
                const v = {
                  id: ci.id || uid(),
                  tipo: "farmacia",
                  entidadId: ci.farmaciaId,
                  farmaciaId: ci.farmaciaId, // compat
                  fecha: ci.fecha || nowISO(),
                  notas: ci.notas || "",
                  createdAt: ci.fecha || nowISO(),
                };
                s.put(v);
                cursor.continue();
              };
            } catch {}
          }
        }

        // Settings
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

  async function loadSettings() {
    const rows = await dbAll("settings");
    const s = {};
    for (const r of rows) s[r.key] = r.value;
    // defaults
    if (!s.quarterlyTargets) s.quarterlyTargets = {};
    if (s.desiredPct == null) s.desiredPct = 0;
    return s;
  }

  function saveSetting(key, value) {
    return dbPut("settings", { key, value });
  }

  /**********************
   * Compat normalizers
   **********************/
  function normalizePedidoCompat(p) {
    // Pedidos antiguos: {farmaciaId,...} sin tipo/entidadId
    if (!p) return p;
    if (!p.tipo) p.tipo = "farmacia";
    if (!p.entidadId) p.entidadId = p.farmaciaId || p.opticaId || "";
    // Mantener alias por compat
    if (p.tipo === "farmacia") p.farmaciaId = p.entidadId;
    if (p.tipo === "optica") p.opticaId = p.entidadId;
    return p;
  }

  function normalizeVisitaCompat(v) {
    // Si viene de migración o antiguo schema
    if (!v) return v;
    if (!v.tipo) v.tipo = "farmacia";
    if (!v.entidadId) v.entidadId = v.farmaciaId || v.opticaId || "";
    if (v.tipo === "farmacia") v.farmaciaId = v.entidadId;
    if (v.tipo === "optica") v.opticaId = v.entidadId;
    return v;
  }

  /**********************
   * App State + Router
   **********************/
  const state = {
    view: "dash",
    farmacias: [],
    misFarmaciasIds: new Set(),
    opticas: [],
    misOpticasIds: new Set(),
    pedidos: [],
    productos: [],
    visitas: [],
    settings: null,
  };

  async function refreshState() {
    state.farmacias = await dbAll("farmacias");
    state.opticas = await dbAll("opticas");
    state.pedidos = (await dbAll("pedidos")).map(normalizePedidoCompat);
    state.productos = await dbAll("productos");
    state.visitas = (await dbAll("visitas")).map(normalizeVisitaCompat);
    state.settings = await loadSettings();

    // ids rápidos
    const mf = await dbAll("misFarmacias");
    state.misFarmaciasIds = new Set(mf.map((x) => x.farmaciaId));

    const mo = await dbAll("misOpticas");
    state.misOpticasIds = new Set(mo.map((x) => x.opticaId));
  }

  function setView(v) {
    state.view = v;
    $$("nav .tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    render();
  }

  /**********************
   * Dialog helpers (base)
   **********************/
  const dlg = () => $("#dlg");
  function dlgClose() {
    dlg()?.close();
  }
  function dlgOpen(title, sub, bodyHTML, footHTML = "") {
    $("#dlgTitle").textContent = title || "Detalles";
    $("#dlgSub").textContent = sub || "";
    $("#dlgBody").innerHTML = bodyHTML || "";
    $("#dlgFoot").innerHTML = footHTML || "";
    dlg()?.showModal();
  }

  function wireDialogClose() {
    $("#dlgClose").onclick = () => dlgClose();
    $("#dlg").addEventListener("cancel", (e) => {
      e.preventDefault();
      dlgClose();
    });
  }

  /**********************
   * Nav wiring
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
   * PWA Install + SW register
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
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch {
      // sin ruido
    }
  }

  /**********************
   * Render dispatcher (stub)
   * (Las vistas completas vienen en partes siguientes)
   **********************/
  async function render() {
    const viewEl = $("#view");
    if (!viewEl) return;

    $("#btnHome").onclick = () => setView("dash");

    // Stubs: en siguientes partes llenamos cada renderX
    if (state.view === "dash") {
      viewEl.innerHTML = `<div class="card"><h2>Dashboard</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "predicciones") {
      viewEl.innerHTML = `<div class="card"><h2>Predicciones</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "farmacias") {
      viewEl.innerHTML = `<div class="card"><h2>Farmacias</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "misFarmacias") {
      viewEl.innerHTML = `<div class="card"><h2>Mis farmacias</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "opticas") {
      viewEl.innerHTML = `<div class="card"><h2>Ópticas</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "misOpticas") {
      viewEl.innerHTML = `<div class="card"><h2>Mis ópticas</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "pedidos") {
      viewEl.innerHTML = `<div class="card"><h2>Pedidos</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "productos") {
      viewEl.innerHTML = `<div class="card"><h2>Productos</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "rutas") {
      viewEl.innerHTML = `<div class="card"><h2>Rutas</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "visitas") {
      viewEl.innerHTML = `<div class="card"><h2>Visitas</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "backup") {
      viewEl.innerHTML = `<div class="card"><h2>Backup</h2><div class="muted">Cargando…</div></div>`;
      return;
    }
    if (state.view === "ajustes") {
      viewEl.innerHTML = `<div class="card"><h2>Ajustes</h2><div class="muted">Cargando…</div></div>`;
      return;
    }

    viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
  }

  /**********************
   * Seed mínimo (opcional)
   **********************/
  async function seedIfEmpty() {
    const farms = await dbAll("farmacias");
    if (farms.length) return;

    const f = {
      id: uid(),
      codigo: "DEMO-001",
      nombre: "Farmacia Demo",
      direccion: "C/ Michelena 10, Pontevedra",
      cp: "36002",
      concello: "Pontevedra",
      telefono: "000000000",
      cliente: "Cliente Demo",
      lat: null,
      lon: null,
      source: "manual",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await dbPut("farmacias", f);
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

/**********************
 * Help text (data-help)
 **********************/
function wireHelp(rootEl) {
  const help = rootEl?.querySelector?.("[data-helpbox]");
  const inputs = rootEl ? Array.from(rootEl.querySelectorAll("[data-help]")) : [];
  for (const inp of inputs) {
    inp.addEventListener("focus", () => {
      if (help) help.innerHTML = `<b>Ayuda:</b> ${escapeHtml(inp.getAttribute("data-help"))}`;
    });
  }
}

/**********************
 * Maps link (común)
 **********************/
function mapsLinkForEntidad(ent) {
  if (!ent) return "";
  if (ent.lat != null && ent.lon != null) {
    const lat = Number(ent.lat);
    const lon = Number(ent.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return `https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lon)}`;
    }
  }
  const addr = (ent.direccion || "").trim();
  if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  return "";
}

/**********************
 * Mis listas: helpers (farmacias / ópticas)
 **********************/
async function addToMis(tipo, entidadId) {
  if (!entidadId) return;
  if (tipo === "farmacia") {
    const all = await dbAll("misFarmacias");
    if (all.some((x) => x.farmaciaId === entidadId)) return;
    await dbPut("misFarmacias", { id: uid(), farmaciaId: entidadId, createdAt: nowISO() });
  } else if (tipo === "optica") {
    const all = await dbAll("misOpticas");
    if (all.some((x) => x.opticaId === entidadId)) return;
    await dbPut("misOpticas", { id: uid(), opticaId: entidadId, createdAt: nowISO() });
  }
}

async function removeFromMis(tipo, entidadId) {
  if (!entidadId) return;
  if (tipo === "farmacia") {
    const all = await dbAll("misFarmacias");
    const row = all.find((x) => x.farmaciaId === entidadId);
    if (row) await dbDel("misFarmacias", row.id);
  } else if (tipo === "optica") {
    const all = await dbAll("misOpticas");
    const row = all.find((x) => x.opticaId === entidadId);
    if (row) await dbDel("misOpticas", row.id);
  }
}

/**********************
 * Upserts catálogo (farmacias / ópticas)
 **********************/
async function upsertFarmaciaFromNewItem(it) {
  const codigo = String(it.codigo || "").trim();
  if (!codigo) return null;

  const id = "F_" + codigo; // estable por código
  const cur = await dbGet("farmacias", id);

  const f = {
    id,
    codigo,
    nombre: cur?.nombre || `Farmacia ${codigo}`,
    direccion: it.direccion || cur?.direccion || "",
    cp: it.cp || cur?.cp || "",
    concello: it.concello || cur?.concello || "",
    telefono: it.telefono || cur?.telefono || "",
    cliente: it.titular1 || cur?.cliente || "",
    lon: it.lon ?? cur?.lon ?? null,
    lat: it.lat ?? cur?.lat ?? null,
    source: cur?.source || "catalogo",
    createdAt: cur?.createdAt || nowISO(),
    updatedAt: nowISO(),
  };

  await dbPut("farmacias", f);
  return f;
}

async function upsertOpticaFromNewItem(it) {
  const codigo = String(it.codigo || "").trim();
  if (!codigo) return null;

  const id = "O_" + codigo; // estable por código
  const cur = await dbGet("opticas", id);

  const o = {
    id,
    codigo,
    nombre: cur?.nombre || `Óptica ${codigo}`,
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

  await dbPut("opticas", o);
  return o;
}

/**********************
 * Import JSON nuevo (data[]) para Farmacias / Ópticas
 **********************/
async function importCatalogNewJsonFile(file, tipo) {
  const txt = await file.text();
  let obj;
  try {
    obj = JSON.parse(txt);
  } catch {
    toast("JSON inválido");
    return;
  }

  const arr = Array.isArray(obj.data) ? obj.data : [];
  if (!arr.length) {
    toast("No hay data[] en el JSON");
    return;
  }

  let n = 0;
  for (const it of arr) {
    const ok = tipo === "farmacia" ? await upsertFarmaciaFromNewItem(it) : await upsertOpticaFromNewItem(it);
    if (ok) n++;
  }
  toast(`${tipo === "farmacia" ? "Farmacias" : "Ópticas"} importadas/actualizadas: ${n}`);
}

/**********************
 * Import farmacias KML
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
      lon,
      lat,
    };

    const ok = await upsertFarmaciaFromNewItem(it);
    if (ok) n++;
  }

  toast(`KML importado: ${n} farmacias`);
}

/**********************
 * UI helpers: combos concello + buscadores
 **********************/
function buildConcelloOptions(selectEl, list) {
  const concellos = [...new Set(list.map((x) => (x.concello || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  const cur = selectEl.value || "";
  selectEl.innerHTML =
    `<option value="">Todos</option>` +
    concellos
      .map((c) => `<option value="${escapeAttr(c)}"${c === cur ? " selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
}

/**********************
 * Render: Farmacias (solo catálogo)
 * - aquí ya NO mostramos Mis farmacias (va en su vista)
 **********************/
async function renderFarmaciasView(viewEl) {
  const { farmacias } = state;

  const catalogo = farmacias
    .filter((f) => (f.source || "") === "catalogo")
    .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Farmacias (Catálogo)</h2>
          <div class="mini muted">Importa catálogo (JSON nuevo o KML) y añade a <b>Mis farmacias</b> desde aquí.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnImportFarmJsonNew">Importar JSON (nuevo)</button>
          <button class="btn btn-xs" id="btnImportFarmKml">Importar KML</button>
          <button class="btn-danger btn-xs" id="btnBorrarFarmCatalogo">Borrar catálogo</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Buscar</label>
          <input id="catSearch" placeholder="Nombre / código / concello / cliente..." data-help="Busca en el catálogo por nombre, código, concello o cliente (titular)." />
        </div>
        <div>
          <label>Filtrar por concello</label>
          <select id="catConcello" data-help="Filtra el catálogo por concello/ayuntamiento.">
            <option value="">Todos</option>
          </select>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Límite listado</label>
          <select id="catLimit" data-help="Limita cuántos resultados se muestran para que vaya fluido.">
            ${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
        </div>
        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      </div>

      <div class="hr"></div>
      <div id="catRows"></div>
    </div>
  `;

  $("#catLimit").value = "100";

  const elCat = $("#catRows");
  const misIds = state.misFarmaciasIds;

  function renderCatalogRows() {
    const q = ($("#catSearch").value || "").trim().toLowerCase();
    const limit = Number($("#catLimit").value || 100);
    const concelloSel = ($("#catConcello").value || "").trim();

    let arr = catalogo.slice();

    // opciones concello
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
        ${arr
          .map((f) => {
            const inMis = misIds.has(f.id);
            const title = f.nombre || f.codigo || "Farmacia";
            const cliente = f.cliente || "—";
            const concello = f.concello || "—";
            const cp = f.cp ? ` · CP ${f.cp}` : "";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(f.codigo || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">Concello: ${escapeHtml(concello)}${escapeHtml(cp)}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(f.id)}">Maps</button>
                  ${
                    inMis
                      ? `<span class="pill ok">en Mis farmacias</span>`
                      : `<button class="btn-primary btn-xs" data-act="addmis" data-id="${escapeAttr(f.id)}">Añadir</button>`
                  }
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderCatalogRows();
  $("#catSearch").oninput = renderCatalogRows;
  $("#catLimit").onchange = renderCatalogRows;
  $("#catConcello").onchange = renderCatalogRows;

  wireHelp(viewEl);

  $("#btnImportFarmJsonNew").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      await importCatalogNewJsonFile(f, "farmacia");
      await refreshState();
      await renderFarmaciasView(viewEl);
    };
    inp.click();
  };

  $("#btnImportFarmKml").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".kml,application/vnd.google-earth.kml+xml,text/xml";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      await importFarmaciasFromKmlFile(f);
      await refreshState();
      await renderFarmaciasView(viewEl);
    };
    inp.click();
  };

  $("#btnBorrarFarmCatalogo").onclick = async () => {
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
    await renderFarmaciasView(viewEl);
  };

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (!act || !id) return;

    if (act === "maps") {
      const f = state.farmacias.find((x) => x.id === id);
      const url = mapsLinkForEntidad(f);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "addmis") {
      await addToMis("farmacia", id);
      toast("Añadida a Mis farmacias");
      await refreshState();
      await renderFarmaciasView(viewEl);
    }
  };
}

/**********************
 * Render: Mis farmacias (solo mis)
 * - incluye + Alta manual
 **********************/
async function renderMisFarmaciasView(viewEl) {
  const misIds = state.misFarmaciasIds;
  const mis = state.farmacias
    .filter((f) => misIds.has(f.id))
    .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Mis farmacias (${mis.length})</h2>
          <div class="mini muted">Tu lista de trabajo. Desde aquí harás pedidos y visitas.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnAltaFarmaciaManual">+ Alta manual</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Filtrar por concello</label>
          <select id="myConcello" data-help="Filtra tus farmacias por concello.">
            <option value="">Todas</option>
          </select>
        </div>
        <div>
          <label>Buscar</label>
          <input id="mySearch" placeholder="Nombre / código / cliente..." data-help="Busca dentro de Mis farmacias." />
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="myRows"></div>
    </div>
  `;

  const elMy = $("#myRows");

  function renderMyRows() {
    const q = ($("#mySearch").value || "").trim().toLowerCase();
    const concelloSel = ($("#myConcello").value || "").trim();

    let arr = mis.slice();
    buildConcelloOptions($("#myConcello"), arr);

    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((f) => {
        const blob = `${f.nombre || ""} ${f.codigo || ""} ${f.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    elMy.innerHTML = `
      <div class="list">
        ${arr
          .map((f) => {
            const title = f.nombre || f.codigo || "Farmacia";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Concello: ${escapeHtml(f.concello || "—")} · CP ${escapeHtml(f.cp || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(f.cliente || "—")} · Tel: ${escapeHtml(f.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-id="${escapeAttr(f.id)}">Detalles</button>
                  <button class="btn-primary btn-xs" data-act="visita" data-id="${escapeAttr(f.id)}">Visita</button>
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(f.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="delmis" data-id="${escapeAttr(f.id)}">Quitar</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderMyRows();
  $("#myConcello").onchange = renderMyRows;
  $("#mySearch").oninput = renderMyRows;

  wireHelp(viewEl);

  // Alta manual -> se implementa el modal en parte posterior; dejamos hook
  $("#btnAltaFarmaciaManual").onclick = () => {
    toast("Alta manual se conecta en la PARTE 4/10 (editor ficha).");
  };

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (!act || !id) return;

    if (act === "maps") {
      const f = state.farmacias.find((x) => x.id === id);
      const url = mapsLinkForEntidad(f);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }

    if (act === "delmis") {
      await removeFromMis("farmacia", id);
      toast("Quitada de Mis farmacias");
      await refreshState();
      await renderMisFarmaciasView(viewEl);
      return;
    }

    if (act === "details") {
      toast("Detalles se conecta en la PARTE 4/10 (panel detalles).");
      return;
    }

    if (act === "visita") {
      toast("Visita se conecta en la PARTE 5/10 (modal visitas + filtro por día).");
      return;
    }
  };
}

/**********************
 * Render: Ópticas (catálogo)
 **********************/
async function renderOpticasView(viewEl) {
  const { opticas } = state;

  const catalogo = opticas
    .filter((o) => (o.source || "") === "catalogo")
    .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Ópticas (Catálogo)</h2>
          <div class="mini muted">Importa catálogo (JSON nuevo) y añade a <b>Mis ópticas</b> desde aquí.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnImportOptJsonNew">Importar JSON (nuevo)</button>
          <button class="btn-danger btn-xs" id="btnBorrarOptCatalogo">Borrar catálogo</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Buscar</label>
          <input id="optSearch" placeholder="Nombre / código / concello / cliente..." data-help="Busca en el catálogo por nombre, código, concello o cliente." />
        </div>
        <div>
          <label>Filtrar por concello</label>
          <select id="optConcello" data-help="Filtra el catálogo por concello/ayuntamiento.">
            <option value="">Todos</option>
          </select>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Límite listado</label>
          <select id="optLimit" data-help="Limita cuántos resultados se muestran para que vaya fluido.">
            ${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
        </div>
        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      </div>

      <div class="hr"></div>
      <div id="optRows"></div>
    </div>
  `;

  $("#optLimit").value = "100";

  const elRows = $("#optRows");
  const misIds = state.misOpticasIds;

  function renderRows() {
    const q = ($("#optSearch").value || "").trim().toLowerCase();
    const limit = Number($("#optLimit").value || 100);
    const concelloSel = ($("#optConcello").value || "").trim();

    let arr = catalogo.slice();

    buildConcelloOptions($("#optConcello"), arr);
    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((o) => {
        const blob = `${o.nombre || ""} ${o.codigo || ""} ${o.concello || ""} ${o.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    arr = arr.slice(0, limit);

    elRows.innerHTML = `
      <div class="list">
        ${arr
          .map((o) => {
            const inMis = misIds.has(o.id);
            const title = o.nombre || o.codigo || "Óptica";
            const cliente = o.cliente || "—";
            const concello = o.concello || "—";
            const cp = o.cp ? ` · CP ${o.cp}` : "";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(o.codigo || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">Concello: ${escapeHtml(concello)}${escapeHtml(cp)}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(o.id)}">Maps</button>
                  ${
                    inMis
                      ? `<span class="pill ok">en Mis ópticas</span>`
                      : `<button class="btn-primary btn-xs" data-act="addmis" data-id="${escapeAttr(o.id)}">Añadir</button>`
                  }
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderRows();
  $("#optSearch").oninput = renderRows;
  $("#optLimit").onchange = renderRows;
  $("#optConcello").onchange = renderRows;

  wireHelp(viewEl);

  $("#btnImportOptJsonNew").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      await importCatalogNewJsonFile(f, "optica");
      await refreshState();
      await renderOpticasView(viewEl);
    };
    inp.click();
  };

  $("#btnBorrarOptCatalogo").onclick = async () => {
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
    await renderOpticasView(viewEl);
  };

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (!act || !id) return;

    if (act === "maps") {
      const o = state.opticas.find((x) => x.id === id);
      const url = mapsLinkForEntidad(o);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "addmis") {
      await addToMis("optica", id);
      toast("Añadida a Mis ópticas");
      await refreshState();
      await renderOpticasView(viewEl);
    }
  };
}

/**********************
 * Render: Mis ópticas
 **********************/
async function renderMisOpticasView(viewEl) {
  const misIds = state.misOpticasIds;
  const mis = state.opticas
    .filter((o) => misIds.has(o.id))
    .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Mis ópticas (${mis.length})</h2>
          <div class="mini muted">Tu lista de trabajo para ópticas.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnAltaOpticaManual">+ Alta manual</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Filtrar por concello</label>
          <select id="myOConcello" data-help="Filtra tus ópticas por concello.">
            <option value="">Todas</option>
          </select>
        </div>
        <div>
          <label>Buscar</label>
          <input id="myOSearch" placeholder="Nombre / código / cliente..." data-help="Busca dentro de Mis ópticas." />
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="myORows"></div>
    </div>
  `;

  const elMy = $("#myORows");

  function renderRows() {
    const q = ($("#myOSearch").value || "").trim().toLowerCase();
    const concelloSel = ($("#myOConcello").value || "").trim();

    let arr = mis.slice();
    buildConcelloOptions($("#myOConcello"), arr);

    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((o) => {
        const blob = `${o.nombre || ""} ${o.codigo || ""} ${o.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    elMy.innerHTML = `
      <div class="list">
        ${arr
          .map((o) => {
            const title = o.nombre || o.codigo || "Óptica";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Concello: ${escapeHtml(o.concello || "—")} · CP ${escapeHtml(o.cp || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(o.cliente || "—")} · Tel: ${escapeHtml(o.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-id="${escapeAttr(o.id)}">Detalles</button>
                  <button class="btn-primary btn-xs" data-act="visita" data-id="${escapeAttr(o.id)}">Visita</button>
                  <button class="btn btn-xs" data-act="maps" data-id="${escapeAttr(o.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="delmis" data-id="${escapeAttr(o.id)}">Quitar</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderRows();
  $("#myOConcello").onchange = renderRows;
  $("#myOSearch").oninput = renderRows;

  wireHelp(viewEl);

  $("#btnAltaOpticaManual").onclick = () => {
    toast("Alta manual óptica se conecta en la PARTE 4/10 (editor ficha).");
  };

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (!act || !id) return;

    if (act === "maps") {
      const o = state.opticas.find((x) => x.id === id);
      const url = mapsLinkForEntidad(o);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }

    if (act === "delmis") {
      await removeFromMis("optica", id);
      toast("Quitada de Mis ópticas");
      await refreshState();
      await renderMisOpticasView(viewEl);
      return;
    }

    if (act === "details") {
      toast("Detalles óptica se conecta en la PARTE 4/10.");
      return;
    }

    if (act === "visita") {
      toast("Visita óptica se conecta en la PARTE 5/10.");
      return;
    }
  };
}

/************************************************************
 * PARTE 3/10 — Pedidos arreglados (productos múltiples)
 * + Dialog stack (volver atrás sin perder el pedido)
 ************************************************************/

/**********************
 * Dialog stack helpers
 **********************/
const _dlgStack = [];

function dlgSnapshot() {
  return {
    title: $("#dlgTitle")?.textContent || "",
    sub: $("#dlgSub")?.textContent || "",
    body: $("#dlgBody")?.innerHTML || "",
    foot: $("#dlgFoot")?.innerHTML || "",
  };
}

function dlgRestore(snap) {
  if (!snap) return;
  $("#dlgTitle").textContent = snap.title || "";
  $("#dlgSub").textContent = snap.sub || "";
  $("#dlgBody").innerHTML = snap.body || "";
  $("#dlgFoot").innerHTML = snap.foot || "";
}

function dlgPush() {
  _dlgStack.push(dlgSnapshot());
}

function dlgPop() {
  const snap = _dlgStack.pop();
  if (!snap) {
    dlgClose();
    return;
  }
  dlgRestore(snap);
}

/**********************
 * Pedidos: helpers comunes
 **********************/
function recomputePedido(p) {
  const items = Array.isArray(p.productos) ? p.productos : [];
  for (const it of items) {
    const cant = Number(it.cantidad || 0);
    const pu = Number(it.precioUnit || 0);
    const dto = Number(it.descuentoPct || 0);
    const base = cant * pu;
    const t = base * (1 - dto / 100);
    it.total = Number.isFinite(t) ? +t.toFixed(2) : 0;
  }
  const tot = items.reduce((s, it) => s + Number(it.total || 0), 0);
  p.total = +tot.toFixed(2);
  // si no informas elementos a mano, puedes autocalcular:
  if (p.autoelementos) p.elementos = items.reduce((s, it) => s + Math.max(0, Number(it.cantidad || 0)), 0);
  return p;
}

function pedidoEntidadLabel(tipo) {
  return tipo === "optica" ? "Óptica" : "Farmacia";
}

function pedidoTipoDefault() {
  // por defecto: farmacias
  return "farmacia";
}

async function getMisEntidades(tipo) {
  if (tipo === "optica") {
    const misIds = state.misOpticasIds || new Set();
    return state.opticas
      .filter((o) => misIds.has(o.id))
      .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
  }
  const misIds = state.misFarmaciasIds || new Set();
  return state.farmacias
    .filter((f) => misIds.has(f.id))
    .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
}

function entidadById(tipo, id) {
  if (tipo === "optica") return state.opticas.find((x) => x.id === id) || null;
  return state.farmacias.find((x) => x.id === id) || null;
}

/**********************
 * Pedidos: Editor principal (Nuevo / Editar)
 * - productos múltiples
 * - selector solo Mis farmacias / Mis ópticas
 **********************/
async function openPedidoEdit(id) {
  const isNew = !id;

  // productos de catálogo (para las líneas/productos del pedido)
  const productos = (state.productos || []).slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

  // pedido
  const p = isNew
    ? recomputePedido({
        id: uid(),
        tipo: pedidoTipoDefault(), // "farmacia" | "optica"
        entidadId: "", // farmaciaId u opticaId
        fecha: nowISO(),
        estado: "confirmado",
        elementos: 0,
        autoelementos: false, // si lo activas autocalcula elementos
        notas: "",
        productos: [],
        total: 0,
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      })
    : await dbGet("pedidos", id);

  if (!p) {
    toast("Pedido no encontrado");
    return;
  }

  // compatibilidad con pedidos antiguos (farmaciaId/lineas)
  if (!p.tipo) p.tipo = "farmacia";
  if (!p.entidadId && p.farmaciaId) p.entidadId = p.farmaciaId;
  if (!Array.isArray(p.productos) && Array.isArray(p.lineas)) p.productos = p.lineas;
  if (!Array.isArray(p.productos)) p.productos = [];
  delete p.lineas; // ya no usamos "lineas"
  delete p.farmaciaId; // normalizamos a entidadId

  const mis = await getMisEntidades(p.tipo);
  if (!p.entidadId) p.entidadId = mis[0]?.id || "";

  function buildProductoRow(it, idx) {
    const name = it.nombre || "Producto";
    return `
      <div class="list-item">
        <div>
          <b>${escapeHtml(name)}</b><br>
          <span class="mini muted">
            Cant: ${escapeHtml(it.cantidad)} · PU: ${fmtEur(it.precioUnit)} · Dto: ${escapeHtml(it.descuentoPct || 0)}% ·
            Total: <b>${fmtEur(it.total || 0)}</b>
          </span>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" data-act="editProd" data-idx="${idx}">Editar</button>
          <button class="btn-danger btn-xs" data-act="delProd" data-idx="${idx}">Quitar</button>
        </div>
      </div>
    `;
  }

  function renderPedidoDialog() {
    const tipo = p.tipo || "farmacia";
    const misNow = (tipo === "optica" ? state.misOpticasIds : state.misFarmaciasIds) || new Set();

    // refresca lista de mis entidades según tipo (por si cambias tipo)
    const listMis = tipo === "optica"
      ? state.opticas.filter((o) => misNow.has(o.id)).sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"))
      : state.farmacias.filter((f) => misNow.has(f.id)).sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

    // si la entidad seleccionada ya no está en mis, intenta corregir
    if (!listMis.some((x) => x.id === p.entidadId)) p.entidadId = listMis[0]?.id || "";

    recomputePedido(p);

    const entidad = entidadById(tipo, p.entidadId);
    const sub = entidad
      ? `${entidad.concello || "—"} · Cliente: ${entidad.cliente || "—"}`
      : `Selecciona ${pedidoEntidadLabel(tipo)} de tu lista`;

    dlgOpen(
      isNew ? "Nuevo pedido" : "Editar pedido",
      sub,
      `
        <div class="grid two">
          <div>
            <label>Tipo</label>
            <select id="oTipo" data-help="El pedido puede ser para Mis farmacias o Mis ópticas.">
              <option value="farmacia"${tipo === "farmacia" ? " selected" : ""}>Farmacia</option>
              <option value="optica"${tipo === "optica" ? " selected" : ""}>Óptica</option>
            </select>
          </div>
          <div>
            <label>${pedidoEntidadLabel(tipo)}</label>
            <select id="oEntidad" data-help="Se muestran solo tus ${tipo === "optica" ? "ópticas" : "farmacias"} (Mis...).">
              ${
                listMis.length
                  ? listMis
                      .map((x) => {
                        const name = x.nombre || x.codigo || pedidoEntidadLabel(tipo);
                        return `<option value="${escapeAttr(x.id)}"${x.id === p.entidadId ? " selected" : ""}>${escapeHtml(name)}</option>`;
                      })
                      .join("")
                  : `<option value="">(No tienes ${tipo === "optica" ? "Mis ópticas" : "Mis farmacias"} aún)</option>`
              }
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input id="oFecha" type="date" value="${escapeAttr(new Date(p.fecha).toISOString().slice(0, 10))}" data-help="Fecha del pedido." />
          </div>
          <div>
            <label>Estado</label>
            <select id="oEstado" data-help="Confirmado suma a ventas.">
              ${["confirmado", "borrador"].map((s) => `<option${s === p.estado ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Elementos</label>
            <input id="oElem" type="number" min="0" step="1" value="${escapeAttr(p.elementos || 0)}"
              data-help="Número de productos del pedido (para estadísticas). Puedes ponerlo manual o activar auto en código." />
          </div>
          <div>
            <label>Total (calculado)</label>
            <input id="oTotal" disabled value="${escapeAttr(fmtEur(p.total || 0))}" />
          </div>
        </div>

        <label>Notas</label>
        <textarea id="oNotas" data-help="Notas internas del pedido.">${escapeHtml(p.notas || "")}</textarea>

        <div class="hr"></div>

        <div class="row">
          <div>
            <h2>Productos</h2>
            <div class="mini muted">Añade varios productos y se recalcula el total automáticamente.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="addProd">+ Añadir producto</button>
          </div>
        </div>

        <div id="prodsBox" class="list">
          ${p.productos.length ? p.productos.map(buildProductoRow).join("") : `<div class="muted">—</div>`}
        </div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(p.id)}</div>
          <div class="right flex">
            <button class="btn" id="oCancel">Cancelar</button>
            <button class="btn-primary" id="oSave">Guardar pedido</button>
          </div>
        </div>
      `
    );

    wireHelp($("#dlgBody"));

    $("#oCancel").onclick = () => dlgClose();

    $("#oTipo").onchange = async () => {
      p.tipo = ($("#oTipo").value || "farmacia").trim();
      // al cambiar tipo, intentamos escoger primera entidad de la lista
      const misNew = await getMisEntidades(p.tipo);
      p.entidadId = misNew[0]?.id || "";
      renderPedidoDialog();
    };

    $("#oEntidad").onchange = () => {
      p.entidadId = ($("#oEntidad").value || "").trim();
      renderPedidoDialog();
    };

    $("#addProd").onclick = () => {
      if (!productos.length) {
        toast("Crea algún producto primero en el menú Productos");
        return;
      }
      openPedidoProductoEdit(p, null, productos, () => renderPedidoDialog());
    };

    $("#dlgBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      const idx = Number(b.dataset.idx);

      if (act === "delProd") {
        p.productos.splice(idx, 1);
        renderPedidoDialog();
        return;
      }
      if (act === "editProd") {
        openPedidoProductoEdit(p, idx, productos, () => renderPedidoDialog());
        return;
      }
    };

    $("#oSave").onclick = async () => {
      p.tipo = ($("#oTipo").value || "farmacia").trim();
      p.entidadId = ($("#oEntidad").value || "").trim();

      if (!p.entidadId) {
        toast(`Selecciona una ${pedidoEntidadLabel(p.tipo)}`);
        return;
      }

      const ymd = ($("#oFecha").value || "").trim();
      const d = parseISODateYMD(ymd);
      if (!d) {
        toast("Fecha inválida");
        return;
      }
      p.fecha = d.toISOString();
      p.estado = ($("#oEstado").value || "confirmado").trim();
      p.elementos = Math.max(0, Number($("#oElem").value || 0));
      p.notas = ($("#oNotas").value || "").trim();
      p.actualizadoEn = nowISO();

      recomputePedido(p);

      await dbPut("pedidos", p);
      toast("Pedido guardado");
      dlgClose();
      await refreshState();
      render();
    };
  }

  renderPedidoDialog();
}

/**********************
 * Editor de producto dentro de un pedido (sub-diálogo con volver atrás)
 **********************/
function openPedidoProductoEdit(pedido, idx, productos, onDone) {
  const isNew = idx == null;

  // base producto
  const cur = isNew
    ? {
        id: uid(),
        productoId: productos[0]?.id || "",
        nombre: productos[0]?.nombre || "",
        cantidad: 1,
        precioUnit: 0,
        descuentoPct: 0,
        total: 0,
      }
    : { ...pedido.productos[idx] };

  // guardamos el diálogo del pedido para volver después
  dlgPush();

  dlgOpen(
    isNew ? "Nuevo producto" : "Editar producto",
    "Detalle de producto en el pedido.",
    `
      <label>Producto</label>
      <select id="ppProd" data-help="Producto de esta línea del pedido.">
        ${productos
          .map((pr) => `<option value="${escapeAttr(pr.id)}"${pr.id === cur.productoId ? " selected" : ""}>${escapeHtml(pr.nombre)}</option>`)
          .join("")}
      </select>

      <div class="grid two">
        <div>
          <label>Cantidad</label>
          <input id="ppQty" type="number" min="0" step="1" value="${escapeAttr(cur.cantidad)}" data-help="Cantidad vendida." />
        </div>
        <div>
          <label>Precio unitario</label>
          <input id="ppPU" type="number" min="0" step="0.01" value="${escapeAttr(cur.precioUnit)}" data-help="Precio unitario." />
        </div>
      </div>

      <label>Descuento (%)</label>
      <input id="ppDto" type="number" min="0" step="0.5" value="${escapeAttr(cur.descuentoPct || 0)}" data-help="Descuento porcentual en esta línea." />

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
    `,
    `
      <div class="row">
        <div class="mini muted">Al guardar vuelves al pedido (no se cierra).</div>
        <div class="right flex">
          <button class="btn" id="ppBack">Volver</button>
          <button class="btn-primary" id="ppSave">Guardar producto</button>
        </div>
      </div>
    `
  );

  wireHelp($("#dlgBody"));

  $("#ppBack").onclick = () => {
    dlgPop();
  };

  $("#ppSave").onclick = () => {
    const pid = ($("#ppProd").value || "").trim();
    const pr = productos.find((x) => x.id === pid);

    cur.productoId = pid;
    cur.nombre = pr?.nombre || "Producto";
    cur.cantidad = Math.max(0, Number($("#ppQty").value || 0));
    cur.precioUnit = Math.max(0, Number($("#ppPU").value || 0));
    cur.descuentoPct = Math.max(0, Number($("#ppDto").value || 0));

    // write back
    pedido.productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    if (isNew) pedido.productos.push(cur);
    else pedido.productos[idx] = cur;

    recomputePedido(pedido);

    // volver al pedido
    dlgPop();
    onDone?.();
  };
}
/************************************************************
 * PARTE 4/10 — Ópticas + separación de vistas
 * - Nuevas stores: opticas, misOpticas
 * - Estado: opticas + misOpticasIds
 * - Router: nuevas vistas "misfarmacias", "opticas", "misopticas"
 ************************************************************/

/**********************
 * IndexedDB — ampliar esquema
 * (Esto va DENTRO de openDB() -> req.onupgradeneeded)
 **********************/
// 🔁 Sustituye tu bloque req.onupgradeneeded completo por este,
// o añade lo que falta si ya lo tienes casi igual.
req.onupgradeneeded = () => {
  const d = req.result;

  // --- Farmacias (igual que ya tenías) ---
  if (!d.objectStoreNames.contains("farmacias")) {
    const s = d.createObjectStore("farmacias", { keyPath: "id" });
    s.createIndex("by_codigo", "codigo", { unique: false });
    s.createIndex("by_cliente", "cliente", { unique: false });
    s.createIndex("by_concello", "concello", { unique: false });
  }
  if (!d.objectStoreNames.contains("misFarmacias")) {
    d.createObjectStore("misFarmacias", { keyPath: "id" }); // {id, farmaciaId, createdAt}
  }

  // --- Ópticas (NUEVO) ---
  if (!d.objectStoreNames.contains("opticas")) {
    const s = d.createObjectStore("opticas", { keyPath: "id" });
    s.createIndex("by_codigo", "codigo", { unique: false });
    s.createIndex("by_cliente", "cliente", { unique: false });
    s.createIndex("by_concello", "concello", { unique: false });
  }
  if (!d.objectStoreNames.contains("misOpticas")) {
    d.createObjectStore("misOpticas", { keyPath: "id" }); // {id, opticaId, createdAt}
  }

  // --- Productos ---
  if (!d.objectStoreNames.contains("productos")) {
    d.createObjectStore("productos", { keyPath: "id" });
  }

  // --- Pedidos (se mantiene store) ---
  if (!d.objectStoreNames.contains("pedidos")) {
    const s = d.createObjectStore("pedidos", { keyPath: "id" });
    // compat: en pedidos nuevos usamos entidadId + tipo, pero mantenemos índices antiguos
    s.createIndex("by_farmacia", "farmaciaId", { unique: false });
    s.createIndex("by_fecha", "fecha", { unique: false });
    // nuevo índice "by_entidad" opcional (si tu navegador soporta upgrade bien, genial)
    try {
      s.createIndex("by_entidad", "entidadId", { unique: false });
      s.createIndex("by_tipo", "tipo", { unique: false });
    } catch {}
  }

  // --- Visitas (por ahora mantenemos 'checkins' para no romper) ---
  if (!d.objectStoreNames.contains("checkins")) {
    const s = d.createObjectStore("checkins", { keyPath: "id" });
    s.createIndex("by_farmacia", "farmaciaId", { unique: false });
    s.createIndex("by_fecha", "fecha", { unique: false });
  }

  // --- Settings ---
  if (!d.objectStoreNames.contains("settings")) {
    d.createObjectStore("settings", { keyPath: "key" }); // {key, value}
  }
};

/**********************
 * Estado global (añadir campos)
 * (Esto va donde defines const state = {...})
 **********************/
// 🔁 Sustituye tu const state por este (o añade las claves que falten).
const state = {
  view: "dash",
  farmacias: [],
  opticas: [],               // NUEVO
  pedidos: [],
  productos: [],
  checkins: [],
  settings: null,

  // caches de "Mis ..."
  misFarmaciasIds: new Set(), // NUEVO cache
  misOpticasIds: new Set(),   // NUEVO cache
};

/**********************
 * Cargar estado + caches Mis...
 * (Esto va dentro de refreshState())
 **********************/
// 🔁 Sustituye tu refreshState() por este.
async function refreshState() {
  state.farmacias = await dbAll("farmacias");
  state.opticas = (await (async () => {
    try {
      return await dbAll("opticas");
    } catch {
      return [];
    }
  })());

  state.pedidos = await dbAll("pedidos");
  state.productos = await dbAll("productos");
  state.checkins = await dbAll("checkins");
  state.settings = await loadSettings();

  // caches Mis...
  try {
    const mf = await dbAll("misFarmacias");
    state.misFarmaciasIds = new Set(mf.map((x) => x.farmaciaId));
  } catch {
    state.misFarmaciasIds = new Set();
  }

  try {
    const mo = await dbAll("misOpticas");
    state.misOpticasIds = new Set(mo.map((x) => x.opticaId));
  } catch {
    state.misOpticasIds = new Set();
  }
}

/**********************
 * Helpers Mis Ópticas (CRUD)
 * (Añade esto junto a tus helpers de Mis farmacias)
 **********************/
async function addToMisOpticas(opticaId) {
  const all = await dbAll("misOpticas");
  if (all.some((x) => x.opticaId === opticaId)) return;
  await dbPut("misOpticas", { id: uid(), opticaId, createdAt: nowISO() });
}
async function removeFromMisOpticas(opticaId) {
  const all = await dbAll("misOpticas");
  const row = all.find((x) => x.opticaId === opticaId);
  if (row) await dbDel("misOpticas", row.id);
}

/**********************
 * Router: permitir nuevas vistas
 * (Esto va donde tienes render() dispatcher)
 **********************/
// 🔁 Sustituye tu render() por este (misma lógica, con 4 vistas nuevas)
async function render() {
  const viewEl = $("#view");
  if (!viewEl) return;

  $("#btnHome").onclick = () => setView("dash");

  if (state.view === "dash") return renderDashboard(viewEl);
  if (state.view === "predicciones") return renderPredicciones(viewEl);

  // NUEVO: separar en vistas distintas
  if (state.view === "farmacias") return renderFarmaciasCatalogo(viewEl);     // catálogo farmacias
  if (state.view === "misfarmacias") return renderMisFarmacias(viewEl);       // solo mis farmacias

  if (state.view === "opticas") return renderOpticasCatalogo(viewEl);         // catálogo ópticas
  if (state.view === "misopticas") return renderMisOpticas(viewEl);           // solo mis ópticas

  if (state.view === "pedidos") return renderPedidos(viewEl);
  if (state.view === "productos") return renderProductos(viewEl);
  if (state.view === "rutas") return renderRutas(viewEl);

  // (de momento sigue siendo checkins; en PARTE 6 lo renombramos a VISITAS + filtro por día)
  if (state.view === "checkins") return renderCheckins(viewEl);

  if (state.view === "backup") return renderBackup(viewEl);
  if (state.view === "ajustes") return renderAjustes(viewEl);

  viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
}

/**********************
 * Nav: tabs wiring (sin HTML aún)
 * - No cambio el HTML aquí (eso lo haré cuando me pegues styles o confirmes),
 *   pero dejo helper para "botones extra" si los añades.
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
 * Fix: no mostrar ids raros como subtítulo/ayuda
 * - Esto evita que accidentalmente el pie del diálogo muestre IDs
 **********************/
function safeMiniText(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  // si parece un uid tipo id_... o F_PO-... lo ocultamos en subtítulos informativos
  if (/^id_[a-f0-9]+_/i.test(t)) return "";
  return t;
}

// 🔁 Ajuste en dlgOpen: usa safeMiniText en subtítulo
function dlgOpen(title, sub, bodyHTML, footHTML = "") {
  $("#dlgTitle").textContent = title || "Detalles";
  $("#dlgSub").textContent = safeMiniText(sub || "");
  $("#dlgBody").innerHTML = bodyHTML || "";
  $("#dlgFoot").innerHTML = footHTML || "";
  dlg()?.showModal();
}

/************************************************************
 * Vistas nuevas (stubs funcionales)
 * - En PARTE 5/10 te doy estas vistas completas con filtros,
 *   importación y gestión "Mis..."
 ************************************************************/

async function renderFarmaciasCatalogo(viewEl) {
  // En PARTE 5 meto la vista completa (catálogo farmacias)
  viewEl.innerHTML = `
    <div class="card">
      <h2>Farmacias · Catálogo</h2>
      <div class="mini muted">En el siguiente bloque activamos el listado, importación y “Añadir a Mis farmacias”.</div>
      <div class="hr"></div>
      <button class="btn-primary" id="goMisF">Ir a Mis farmacias</button>
    </div>
  `;
  $("#goMisF").onclick = () => setView("misfarmacias");
}

async function renderMisFarmacias(viewEl) {
  viewEl.innerHTML = `
    <div class="card">
      <h2>Mis farmacias</h2>
      <div class="mini muted">En el siguiente bloque activamos listado, filtros, detalles y acciones.</div>
      <div class="hr"></div>
      <button class="btn" id="goCatF">Volver a Catálogo</button>
    </div>
  `;
  $("#goCatF").onclick = () => setView("farmacias");
}

async function renderOpticasCatalogo(viewEl) {
  viewEl.innerHTML = `
    <div class="card">
      <h2>Ópticas · Catálogo</h2>
      <div class="mini muted">En el siguiente bloque activamos listado, importación y “Añadir a Mis ópticas”.</div>
      <div class="hr"></div>
      <button class="btn-primary" id="goMisO">Ir a Mis ópticas</button>
    </div>
  `;
  $("#goMisO").onclick = () => setView("misopticas");
}

async function renderMisOpticas(viewEl) {
  viewEl.innerHTML = `
    <div class="card">
      <h2>Mis ópticas</h2>
      <div class="mini muted">En el siguiente bloque activamos listado, filtros, detalles y acciones.</div>
      <div class="hr"></div>
      <button class="btn" id="goCatO">Volver a Catálogo</button>
    </div>
  `;
  $("#goCatO").onclick = () => setView("opticas");
}

/************************************************************
 * PARTE 5/10 — Vistas separadas:
 * - Farmacias (Catálogo)
 * - Mis farmacias
 * - Ópticas (Catálogo)
 * - Mis ópticas
 ************************************************************/

/**********************
 * Helpers comunes: buscar + concellos
 **********************/
function uniqSorted(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}
function buildConcelloOptions(selectEl, list, includeAllLabel = "Todos") {
  const concellos = uniqSorted(list.map((x) => (x.concello || "").trim()).filter(Boolean));
  const cur = selectEl.value || "";
  selectEl.innerHTML =
    `<option value="">${includeAllLabel}</option>` +
    concellos.map((c) => `<option value="${escapeAttr(c)}"${c === cur ? " selected" : ""}>${escapeHtml(c)}</option>`).join("");
}

/**********************
 * Import ópticas JSON (formato simple)
 * Admite:
 *  - {data:[...]} o [...]
 * Campos recomendados: codigo,nombre,direccion,cp,concello,telefono,cliente,lat,lon
 **********************/
async function upsertOpticaFromItem(it) {
  const codigo = String(it.codigo || "").trim();
  if (!codigo) return null;

  const id = "O_" + codigo;
  const cur = await dbGet("opticas", id);

  const o = {
    id,
    codigo,
    nombre: cur?.nombre || it.nombre || `Óptica ${codigo}`,
    direccion: it.direccion || cur?.direccion || "",
    cp: it.cp || cur?.cp || "",
    concello: it.concello || cur?.concello || "",
    telefono: it.telefono || cur?.telefono || "",
    cliente: it.cliente || cur?.cliente || "",
    lon: it.lon ?? cur?.lon ?? null,
    lat: it.lat ?? cur?.lat ?? null,
    source: cur?.source || "catalogo",
    createdAt: cur?.createdAt || nowISO(),
    updatedAt: nowISO(),
  };

  await dbPut("opticas", o);
  return o;
}

async function importOpticasJsonFile(file) {
  const txt = await file.text();
  let obj;
  try {
    obj = JSON.parse(txt);
  } catch {
    toast("JSON inválido");
    return;
  }

  const arr = Array.isArray(obj) ? obj : Array.isArray(obj.data) ? obj.data : [];
  if (!arr.length) {
    toast("El JSON debe ser [] o {data:[]}");
    return;
  }

  let n = 0;
  for (const it of arr) {
    const ok = await upsertOpticaFromItem(it);
    if (ok) n++;
  }
  toast(`Ópticas importadas/actualizadas: ${n}`);
}

/**********************
 * Alta/edición manual Óptica (similar a farmacia)
 **********************/
async function openOpticaEdit(id) {
  const isNew = !id;
  const o = isNew
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
    : await dbGet("opticas", id);

  if (!o) {
    toast("No encontrada");
    return;
  }

  dlgOpen(
    isNew ? "Alta manual (Óptica)" : "Editar óptica",
    "Completa los datos principales.",
    `
      <label>Nombre</label>
      <input id="oNombre" value="${escapeAttr(o.nombre || "")}" data-help="Nombre visible de la óptica." />

      <label>Código</label>
      <input id="oCodigo" value="${escapeAttr(o.codigo || "")}" data-help="Código interno/externo si lo tienes." />

      <label>Cliente (titular)</label>
      <input id="oCliente" value="${escapeAttr(o.cliente || "")}" data-help="Titular/cliente." />

      <label>Teléfono</label>
      <input id="oTel" value="${escapeAttr(o.telefono || "")}" data-help="Teléfono." />

      <label>Concello</label>
      <input id="oConc" value="${escapeAttr(o.concello || "")}" data-help="Concello/ayuntamiento." />

      <label>Código postal</label>
      <input id="oCp" value="${escapeAttr(o.cp || "")}" data-help="CP." />

      <label>Dirección</label>
      <input id="oDir" value="${escapeAttr(o.direccion || "")}" data-help="Dirección para Maps." />

      <div class="grid two">
        <div>
          <label>Lat</label>
          <input id="oLat" value="${escapeAttr(o.lat ?? "")}" data-help="Latitud (opcional)." />
        </div>
        <div>
          <label>Lon</label>
          <input id="oLon" value="${escapeAttr(o.lon ?? "")}" data-help="Longitud (opcional)." />
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
    `,
    `
      <div class="row">
        <div class="mini muted">${escapeHtml(o.source || "manual")}</div>
        <div class="right flex">
          <button class="btn" id="oCancel">Cancelar</button>
          <button class="btn-primary" id="oSave">Guardar</button>
        </div>
      </div>
    `
  );

  wireHelp($("#dlgBody"));

  $("#oCancel").onclick = () => dlgClose();
  $("#oSave").onclick = async () => {
    o.nombre = ($("#oNombre").value || "").trim();
    o.codigo = ($("#oCodigo").value || "").trim();
    o.cliente = ($("#oCliente").value || "").trim();
    o.telefono = ($("#oTel").value || "").trim();
    o.concello = ($("#oConc").value || "").trim();
    o.cp = ($("#oCp").value || "").trim();
    o.direccion = ($("#oDir").value || "").trim();

    const lat = ($("#oLat").value || "").trim();
    const lon = ($("#oLon").value || "").trim();
    o.lat = lat === "" ? null : Number(lat);
    o.lon = lon === "" ? null : Number(lon);

    o.updatedAt = nowISO();
    await dbPut("opticas", o);
    toast("Óptica guardada");
    dlgClose();
    await refreshState();
    render();
  };
}

/**********************
 * Render: FARMACIAS (Catálogo) — SOLO catálogo
 **********************/
async function renderFarmaciasCatalogo(viewEl) {
  const { farmacias } = state;
  const misIds = state.misFarmaciasIds;

  const catalogo = farmacias
    .filter((f) => (f.source || "") === "catalogo")
    .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Farmacias · Catálogo (${catalogo.length})</h2>
          <div class="mini muted">Importa catálogo y añade a <b>Mis farmacias</b>. (Vista separada)</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnGoMisF">Mis farmacias</button>
          <button class="btn btn-xs" id="btnImportJsonNew">Importar JSON</button>
          <button class="btn btn-xs" id="btnImportKml">Importar KML</button>
          <button class="btn-danger btn-xs" id="btnBorrarCatalogo">Borrar catálogo</button>
        </div>
      </div>

      <div class="hr"></div>

      <label>Buscar</label>
      <input id="catSearch" placeholder="Nombre / código / concello / cliente..." data-help="Busca en el catálogo por nombre, código, concello o cliente (titular)." />

      <div class="grid two">
        <div>
          <label>Límite listado</label>
          <select id="catLimit" data-help="Limita cuántos resultados se muestran para que vaya fluido.">
            ${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Filtrar por concello</label>
          <select id="catConcello" data-help="Filtra el catálogo por concello/ayuntamiento.">
            <option value="">Todos</option>
          </select>
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="catRows"></div>
    </div>
  `;

  $("#btnGoMisF").onclick = () => setView("misfarmacias");
  $("#catLimit").value = "100";

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

    $("#catRows").innerHTML = `
      <div class="list">
        ${arr
          .map((f) => {
            const inMis = misIds.has(f.id);
            const title = f.nombre || f.codigo || "Farmacia";
            const cliente = f.cliente || "—";
            const concello = f.concello || "—";
            const cp = f.cp ? ` · CP ${f.cp}` : "";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(f.codigo || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">Concello: ${escapeHtml(concello)}${escapeHtml(cp)}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="maps" data-fid="${escapeAttr(f.id)}">Maps</button>
                  ${
                    inMis
                      ? `<span class="pill ok">en Mis farmacias</span>`
                      : `<button class="btn-primary btn-xs" data-act="addmis" data-fid="${escapeAttr(f.id)}">Añadir</button>`
                  }
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderCatalogRows();

  $("#catSearch").oninput = renderCatalogRows;
  $("#catLimit").onchange = renderCatalogRows;
  $("#catConcello").onchange = renderCatalogRows;

  wireHelp(viewEl);

  // importar JSON farmacias (nuevo)
  $("#btnImportJsonNew").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      await importFarmaciasNewJsonFile(f);
      await refreshState();
      await renderFarmaciasCatalogo(viewEl);
    };
    inp.click();
  };

  // importar KML farmacias
  $("#btnImportKml").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".kml,application/vnd.google-earth.kml+xml,text/xml";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      await importFarmaciasFromKmlFile(f);
      await refreshState();
      await renderFarmaciasCatalogo(viewEl);
    };
    inp.click();
  };

  // borrar catálogo
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
    await renderFarmaciasCatalogo(viewEl);
  };

  // delegación
  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const fid = b.dataset.fid;
    const act = b.dataset.act;
    if (!fid || !act) return;

    if (act === "maps") {
      const f = state.farmacias.find((x) => x.id === fid);
      const url = mapsLinkForFarmacia(f);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "addmis") {
      await addToMisFarmacias(fid);
      toast("Añadida a Mis farmacias");
      await refreshState();
      await renderFarmaciasCatalogo(viewEl);
      return;
    }
  };
}

/**********************
 * Render: MIS FARMACIAS — SOLO mis farmacias
 **********************/
async function renderMisFarmacias(viewEl) {
  const { farmacias } = state;
  const misIds = state.misFarmaciasIds;

  const mis = farmacias
    .filter((f) => misIds.has(f.id))
    .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Mis farmacias (${mis.length})</h2>
          <div class="mini muted">Gestión separada: detalles, check-in/visita, mapas y quitar.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnGoCatF">Catálogo</button>
          <button class="btn btn-xs" id="btnAltaManualF">+ Alta manual</button>
        </div>
      </div>

      <div class="hr"></div>

      <label>Filtrar por concello</label>
      <select id="myConcello" data-help="Filtra tus farmacias por concello.">
        <option value="">Todas</option>
      </select>

      <label>Buscar</label>
      <input id="mySearch" placeholder="Nombre / código / cliente..." data-help="Busca dentro de Mis farmacias." />

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="myRows"></div>
    </div>
  `;

  $("#btnGoCatF").onclick = () => setView("farmacias");
  $("#btnAltaManualF").onclick = () => openFarmaciaEdit(null);

  function renderMyRows() {
    const q = ($("#mySearch").value || "").trim().toLowerCase();
    const concelloSel = ($("#myConcello").value || "").trim();

    let arr = mis.slice();
    buildConcelloOptions($("#myConcello"), arr, "Todas");

    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((f) => {
        const blob = `${f.nombre || ""} ${f.codigo || ""} ${f.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    $("#myRows").innerHTML = `
      <div class="list">
        ${arr
          .map((f) => {
            const title = f.nombre || f.codigo || "Farmacia";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Concello: ${escapeHtml(f.concello || "—")} · CP ${escapeHtml(f.cp || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(f.cliente || "—")} · Tel: ${escapeHtml(f.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(f.id)}">Detalles</button>
                  <button class="btn-primary btn-xs" data-act="checkin" data-fid="${escapeAttr(f.id)}">Visita + pedido</button>
                  <button class="btn btn-xs" data-act="maps" data-fid="${escapeAttr(f.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="delmis" data-fid="${escapeAttr(f.id)}">Quitar</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderMyRows();

  $("#myConcello").onchange = renderMyRows;
  $("#mySearch").oninput = renderMyRows;

  wireHelp(viewEl);

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const fid = b.dataset.fid;
    const act = b.dataset.act;
    if (!fid || !act) return;

    if (act === "maps") {
      const f = state.farmacias.find((x) => x.id === fid);
      const url = mapsLinkForFarmacia(f);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "delmis") {
      await removeFromMisFarmacias(fid);
      toast("Quitada de Mis farmacias");
      await refreshState();
      await renderMisFarmacias(viewEl);
      return;
    }
    if (act === "details") {
      openFarmaciaDetails(fid);
      return;
    }
    if (act === "checkin") {
      openCheckinModal(fid); // en PARTE 6 lo convertimos a "visita" con fecha elegible + listado por día
      return;
    }
  };
}

/**********************
 * Render: ÓPTICAS (Catálogo)
 **********************/
async function renderOpticasCatalogo(viewEl) {
  const { opticas } = state;
  const misIds = state.misOpticasIds;

  const catalogo = (opticas || [])
    .filter((o) => (o.source || "") === "catalogo")
    .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Ópticas · Catálogo (${catalogo.length})</h2>
          <div class="mini muted">Importa catálogo de ópticas y añade a <b>Mis ópticas</b>.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnGoMisO">Mis ópticas</button>
          <button class="btn btn-xs" id="btnImportOptJson">Importar JSON</button>
          <button class="btn-danger btn-xs" id="btnBorrarOptCat">Borrar catálogo</button>
        </div>
      </div>

      <div class="hr"></div>

      <label>Buscar</label>
      <input id="oCatSearch" placeholder="Nombre / código / concello / cliente..." data-help="Busca en el catálogo por nombre, código, concello o cliente." />

      <div class="grid two">
        <div>
          <label>Límite listado</label>
          <select id="oCatLimit" data-help="Limita cuántos resultados se muestran para que vaya fluido.">
            ${[50, 100, 200, 500, 1000].map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Filtrar por concello</label>
          <select id="oCatConcello" data-help="Filtra el catálogo por concello/ayuntamiento.">
            <option value="">Todos</option>
          </select>
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="oCatRows"></div>
    </div>
  `;

  $("#btnGoMisO").onclick = () => setView("misopticas");
  $("#oCatLimit").value = "100";

  function renderRows() {
    const q = ($("#oCatSearch").value || "").trim().toLowerCase();
    const limit = Number($("#oCatLimit").value || 100);
    const concelloSel = ($("#oCatConcello").value || "").trim();

    let arr = catalogo.slice();
    buildConcelloOptions($("#oCatConcello"), arr);

    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((o) => {
        const blob = `${o.nombre || ""} ${o.codigo || ""} ${o.concello || ""} ${o.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    arr = arr.slice(0, limit);

    $("#oCatRows").innerHTML = `
      <div class="list">
        ${arr
          .map((o) => {
            const inMis = misIds.has(o.id);
            const title = o.nombre || o.codigo || "Óptica";
            const cliente = o.cliente || "—";
            const concello = o.concello || "—";
            const cp = o.cp ? ` · CP ${o.cp}` : "";
            return `
              <div class="list-item" style="${inMis ? "border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.06)" : ""}">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Código: ${escapeHtml(o.codigo || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">Concello: ${escapeHtml(concello)}${escapeHtml(cp)}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="mapsO" data-oid="${escapeAttr(o.id)}">Maps</button>
                  ${
                    inMis
                      ? `<span class="pill ok">en Mis ópticas</span>`
                      : `<button class="btn-primary btn-xs" data-act="addmisO" data-oid="${escapeAttr(o.id)}">Añadir</button>`
                  }
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderRows();

  $("#oCatSearch").oninput = renderRows;
  $("#oCatLimit").onchange = renderRows;
  $("#oCatConcello").onchange = renderRows;

  wireHelp(viewEl);

  // importar ópticas JSON
  $("#btnImportOptJson").onclick = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json,.json";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      await importOpticasJsonFile(f);
      await refreshState();
      await renderOpticasCatalogo(viewEl);
    };
    inp.click();
  };

  // borrar catálogo ópticas
  $("#btnBorrarOptCat").onclick = async () => {
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
    await renderOpticasCatalogo(viewEl);
  };

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;

    const act = b.dataset.act;
    const oid = b.dataset.oid;
    if (!act || !oid) return;

    if (act === "mapsO") {
      const o = state.opticas.find((x) => x.id === oid);
      const url = mapsLinkForFarmacia(o); // reutilizamos misma función (lat/lon/dirección)
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "addmisO") {
      await addToMisOpticas(oid);
      toast("Añadida a Mis ópticas");
      await refreshState();
      await renderOpticasCatalogo(viewEl);
      return;
    }
  };
}

/**********************
 * Render: MIS ÓPTICAS
 **********************/
async function renderMisOpticas(viewEl) {
  const { opticas } = state;
  const misIds = state.misOpticasIds;

  const mis = (opticas || [])
    .filter((o) => misIds.has(o.id))
    .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Mis ópticas (${mis.length})</h2>
          <div class="mini muted">Gestión separada: detalles, visita + pedido, mapas y quitar.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnGoCatO">Catálogo</button>
          <button class="btn btn-xs" id="btnAltaManualO">+ Alta manual</button>
        </div>
      </div>

      <div class="hr"></div>

      <label>Filtrar por concello</label>
      <select id="myConcelloO" data-help="Filtra tus ópticas por concello.">
        <option value="">Todas</option>
      </select>

      <label>Buscar</label>
      <input id="mySearchO" placeholder="Nombre / código / cliente..." data-help="Busca dentro de Mis ópticas." />

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>
      <div id="myRowsO"></div>
    </div>
  `;

  $("#btnGoCatO").onclick = () => setView("opticas");
  $("#btnAltaManualO").onclick = () => openOpticaEdit(null);

  function renderRows() {
    const q = ($("#mySearchO").value || "").trim().toLowerCase();
    const concelloSel = ($("#myConcelloO").value || "").trim();

    let arr = mis.slice();
    buildConcelloOptions($("#myConcelloO"), arr, "Todas");

    if (concelloSel) arr = arr.filter((x) => (x.concello || "").trim() === concelloSel);

    if (q) {
      arr = arr.filter((o) => {
        const blob = `${o.nombre || ""} ${o.codigo || ""} ${o.cliente || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    $("#myRowsO").innerHTML = `
      <div class="list">
        ${arr
          .map((o) => {
            const title = o.nombre || o.codigo || "Óptica";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">Concello: ${escapeHtml(o.concello || "—")} · CP ${escapeHtml(o.cp || "—")}</span><br>
                  <span class="mini muted">Cliente: ${escapeHtml(o.cliente || "—")} · Tel: ${escapeHtml(o.telefono || "—")}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="editO" data-oid="${escapeAttr(o.id)}">Editar</button>
                  <button class="btn-primary btn-xs" data-act="visitO" data-oid="${escapeAttr(o.id)}">Visita + pedido</button>
                  <button class="btn btn-xs" data-act="mapsO" data-oid="${escapeAttr(o.id)}">Maps</button>
                  <button class="btn-danger btn-xs" data-act="delmisO" data-oid="${escapeAttr(o.id)}">Quitar</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderRows();

  $("#myConcelloO").onchange = renderRows;
  $("#mySearchO").oninput = renderRows;

  wireHelp(viewEl);

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;

    const act = b.dataset.act;
    const oid = b.dataset.oid;
    if (!act || !oid) return;

    if (act === "mapsO") {
      const o = state.opticas.find((x) => x.id === oid);
      const url = mapsLinkForFarmacia(o);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }

    if (act === "delmisO") {
      await removeFromMisOpticas(oid);
      toast("Quitada de Mis ópticas");
      await refreshState();
      await renderMisOpticas(viewEl);
      return;
    }

    if (act === "editO") {
      openOpticaEdit(oid);
      return;
    }

    if (act === "visitO") {
      // En PARTE 6 convertimos Check-ins -> Visitas con fecha elegible + listado por día
      // Por ahora reutilizamos el modal existente pero necesitaremos que acepte tipo+entidad.
      toast("En la siguiente parte activamos Visitas y pedidos para ópticas.");
      return;
    }
  };
}

/************************************************************
 * PARTE 6/10 — Check-ins => VISITAS
 * - Guardar visita con fecha elegible
 * - Listar visitas por día
 * - Mantener store IndexedDB "checkins" (compatibilidad)
 ************************************************************/

/**********************
 * Helpers fecha (día)
 **********************/
function ymdFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Convierte YYYY-MM-DD a ISO "a media mañana" para evitar líos de huso horario
function isoFromYMDAt10(ymd) {
  const d = parseISODateYMD(ymd); // ya crea "T10:00:00"
  return d ? d.toISOString() : null;
}

/**********************
 * Modal: VISITA (+ pedido rápido opcional)
 * Mantiene store "checkins"
 **********************/
async function openVisitaModal(fid) {
  const f = await dbGet("farmacias", fid);
  if (!f) {
    toast("No encontrada");
    return;
  }

  const todayYMD = new Date().toISOString().slice(0, 10);

  dlgOpen(
    "Visita",
    `${f.nombre || f.codigo || "Farmacia"} · ${f.concello || "—"}`,
    `
      <div class="mini muted">Registra una visita y, si quieres, crea un pedido rápido.</div>
      <div class="hr"></div>

      <label>Fecha de la visita</label>
      <input id="vFecha" type="date" value="${escapeAttr(todayYMD)}"
        data-help="Fecha real de la visita. Se guardará con hora aproximada (10:00) para evitar problemas de zona horaria." />

      <label>Notas de la visita</label>
      <textarea id="vNotas" data-help="Notas de la visita: motivos, feedback, acciones, etc."></textarea>

      <div class="hr"></div>

      <label>Crear pedido rápido (opcional)</label>
      <div class="grid two">
        <div>
          <label>Total (€)</label>
          <input id="vTotal" type="number" min="0" step="0.01" value=""
            data-help="Si metes un total, se creará un pedido con una línea General." />
        </div>
        <div>
          <label>Elementos</label>
          <input id="vElems" type="number" min="0" step="1" value="0"
            data-help="Número de elementos (para tus estadísticas)." />
        </div>
      </div>

      <label>Estado del pedido (si se crea)</label>
      <select id="vEstado" data-help="Si creas pedido, confirmado suma a ventas.">
        <option value="confirmado">confirmado</option>
        <option value="borrador">borrador</option>
      </select>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
    `,
    `
      <div class="row">
        <div class="mini muted">Se guarda como “Visita” (store: checkins)</div>
        <div class="right flex">
          <button class="btn" id="vCancel">Cancelar</button>
          <button class="btn-primary" id="vSave">Guardar</button>
        </div>
      </div>
    `
  );

  wireHelp($("#dlgBody"));

  $("#vCancel").onclick = () => dlgClose();
  $("#vSave").onclick = async () => {
    const ymd = ($("#vFecha").value || "").trim();
    const iso = isoFromYMDAt10(ymd);
    if (!iso) {
      toast("Fecha inválida");
      return;
    }

    const notas = ($("#vNotas").value || "").trim();
    const total = Number(($("#vTotal").value || "").trim() || 0);
    const elems = Math.max(0, Number($("#vElems").value || 0));
    const est = ($("#vEstado").value || "confirmado").trim();

    // VISITA (store checkins)
    const visita = {
      id: uid(),
      farmaciaId: fid,
      fecha: iso, // fecha elegida
      notas,
      tipo: "visita", // opcional (para futuro)
    };
    await dbPut("checkins", visita);

    // Pedido rápido (si hay total)
    if (total > 0) {
      const gen = await ensureProductoGeneral();
      const pedido = recomputePedido({
        id: uid(),
        farmaciaId: fid,
        fecha: iso, // mismo día que la visita
        estado: est,
        elementos: elems,
        notas: `Pedido desde visita. ${notas ? "Notas: " + notas : ""}`.trim(),
        lineas: [
          {
            id: uid(),
            productoId: gen.id,
            nombre: "General",
            cantidad: 1,
            precioUnit: +total.toFixed(2),
            descuentoPct: 0,
            total: +total.toFixed(2),
          },
        ],
        total: +total.toFixed(2),
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      });

      await dbPut("pedidos", pedido);
    }

    toast("Visita guardada");
    dlgClose();
    await refreshState();
    render();
  };
}

// Compatibilidad: donde el código viejo llama a openCheckinModal, lo redirigimos
async function openCheckinModal(fid) {
  return openVisitaModal(fid);
}

/**********************
 * Render: VISITAS (antes renderCheckins)
 * - filtro por día
 * - búsqueda dentro del día
 **********************/
async function renderVisitas(viewEl) {
  const { checkins, farmacias } = state;
  const farmById = new Map(farmacias.map((f) => [f.id, f]));

  // ordenar desc
  const arr = [...(checkins || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  // día por defecto: hoy si hay, si no, el último registro, si no hoy
  const today = new Date().toISOString().slice(0, 10);
  const defaultDay = arr.length ? ymdFromISO(arr[0].fecha) || today : today;

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Visitas (${arr.length})</h2>
          <div class="mini muted">Registro de visitas por farmacia. Filtra por día y busca por texto.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="vHoy">Hoy</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Día</label>
          <input id="vDay" type="date" value="${escapeAttr(defaultDay)}" data-help="Selecciona un día y se mostrarán solo las visitas de ese día." />
        </div>
        <div>
          <label>Buscar</label>
          <input id="vSearch" placeholder="Farmacia / cliente / concello / notas..." data-help="Filtra visitas del día por texto." />
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>

      <div id="vSummary" class="mini muted"></div>

      <div class="hr"></div>

      <div id="vRows"></div>
    </div>
  `;

  $("#vHoy").onclick = () => {
    $("#vDay").value = today;
    renderRows();
  };

  function renderRows() {
    const day = ($("#vDay").value || "").trim();
    const q = ($("#vSearch").value || "").trim().toLowerCase();

    let list = arr.slice();

    if (day) {
      list = list.filter((ci) => ymdFromISO(ci.fecha) === day);
    }

    if (q) {
      list = list.filter((ci) => {
        const f = farmById.get(ci.farmaciaId);
        const blob = `${f?.nombre || ""} ${f?.codigo || ""} ${f?.cliente || ""} ${f?.concello || ""} ${ci.notas || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    $("#vSummary").innerHTML = `Día: <b>${escapeHtml(day || "—")}</b> · Registros: <b>${list.length}</b>`;

    $("#vRows").innerHTML = `
      <div class="list">
        ${
          list.length
            ? list
                .map((ci) => {
                  const f = farmById.get(ci.farmaciaId);
                  const title = f ? f.nombre || f.codigo || "Farmacia" : "—";
                  return `
                    <div class="list-item">
                      <div>
                        <b>${escapeHtml(title)}</b><br>
                        <span class="mini muted">${escapeHtml(fmtDate(ci.fecha))} · ${escapeHtml(f?.concello || "—")} · Cliente: ${escapeHtml(
                    f?.cliente || "—"
                  )}</span><br>
                        <span class="mini muted">${escapeHtml(ci.notas || "")}</span>
                      </div>
                      <div class="right flex">
                        <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(ci.farmaciaId)}">Detalles</button>
                        <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(ci.id)}">Borrar</button>
                      </div>
                    </div>
                  `;
                })
                .join("")
            : `<div class="muted">—</div>`
        }
      </div>
    `;
  }

  renderRows();

  $("#vDay").onchange = renderRows;
  $("#vSearch").oninput = renderRows;

  wireHelp(viewEl);

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;

    if (act === "details") {
      openFarmaciaDetails(b.dataset.fid);
      return;
    }
    if (act === "del") {
      if (!confirm("¿Borrar visita?")) return;
      await dbDel("checkins", b.dataset.id);
      toast("Visita borrada");
      await refreshState();
      await renderVisitas(viewEl);
      return;
    }
  };
}

/**********************
 * IMPORTANTE:
 * Si tu render() aún llama a renderCheckins, cámbialo a renderVisitas.
 * (Ese cambio lo consolidamos en PARTE 9/10 con el router final)
 **********************/

/************************************************************
 * PARTE 7/10 — PEDIDOS (FIX productos + modal stack)
 * - "Líneas" => "Productos"
 * - Añadir varios productos y guardar bien
 * - Total recalculado y actualizado en pantalla
 * - Selector de farmacia SOLO "Mis farmacias"
 ************************************************************/

/**********************
 * Dialog stack (para sub-modales dentro del mismo <dialog>)
 **********************/
const _dlgStack = [];

function dlgSnapshot() {
  return {
    title: $("#dlgTitle")?.textContent || "",
    sub: $("#dlgSub")?.textContent || "",
    body: $("#dlgBody")?.innerHTML || "",
    foot: $("#dlgFoot")?.innerHTML || "",
  };
}

function dlgRestore(snap) {
  $("#dlgTitle").textContent = snap.title || "";
  $("#dlgSub").textContent = snap.sub || "";
  $("#dlgBody").innerHTML = snap.body || "";
  $("#dlgFoot").innerHTML = snap.foot || "";
}

function dlgPush() {
  _dlgStack.push(dlgSnapshot());
}

function dlgPop() {
  const snap = _dlgStack.pop();
  if (snap) dlgRestore(snap);
}

/**********************
 * Helpers: solo Mis farmacias para selector de pedidos
 **********************/
async function getMisFarmaciasListSorted() {
  const misIds = await getMisFarmaciasIds();
  const list = (state.farmacias || []).filter((f) => misIds.has(f.id));
  return list.sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
}

/**********************
 * Pedido editor (FIX)
 **********************/
async function openPedidoEdit(id) {
  const isNew = !id;

  const misFarmacias = await getMisFarmaciasListSorted();
  const productos = (state.productos || [])
    .slice()
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

  // Si no hay mis farmacias, avisamos (pero no rompemos)
  if (isNew && !misFarmacias.length) {
    toast("No tienes 'Mis farmacias'. Añade alguna primero.");
    return;
  }

  const p = isNew
    ? recomputePedido({
        id: uid(),
        farmaciaId: misFarmacias[0]?.id || "",
        fecha: nowISO(),
        estado: "confirmado",
        elementos: 0,
        notas: "",
        lineas: [], // (internamente siguen siendo lineas, pero en UI serán "productos")
        total: 0,
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      })
    : await dbGet("pedidos", id);

  if (!p) {
    toast("Pedido no encontrado");
    return;
  }

  // Si el pedido existente apunta a farmacia fuera de Mis, lo dejamos (pero el selector mostrará Mis + la actual)
  let farmaciasSelect = misFarmacias.slice();
  if (!farmaciasSelect.some((f) => f.id === p.farmaciaId)) {
    const cur = state.farmacias.find((x) => x.id === p.farmaciaId);
    if (cur) farmaciasSelect = [cur, ...farmaciasSelect];
  }

  function buildProductoRow(l, idx) {
    const prodName = l.nombre || "—";
    return `
      <div class="list-item">
        <div>
          <b>${escapeHtml(prodName)}</b><br>
          <span class="mini muted">
            Cant: ${escapeHtml(l.cantidad)} · PU: ${fmtEur(l.precioUnit)} · Dto: ${escapeHtml(l.descuentoPct || 0)}% ·
            Total: <b>${fmtEur(l.total)}</b>
          </span>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" data-act="editProd" data-idx="${idx}">Editar</button>
          <button class="btn-danger btn-xs" data-act="delProd" data-idx="${idx}">Quitar</button>
        </div>
      </div>
    `;
  }

  function renderPedidoDialog() {
    // Asegurar arrays
    p.lineas = Array.isArray(p.lineas) ? p.lineas : [];
    recomputePedido(p);

    dlgOpen(
      isNew ? "Nuevo pedido" : "Editar pedido",
      "Pedido offline.",
      `
        <label>Farmacia</label>
        <select id="oFarmSel" data-help="Solo aparecen tus 'Mis farmacias' (y la farmacia actual si editas un pedido antiguo).">
          ${farmaciasSelect
            .map((f) => {
              const name = f.nombre || f.codigo || "Farmacia";
              return `<option value="${escapeAttr(f.id)}"${f.id === p.farmaciaId ? " selected" : ""}>${escapeHtml(name)}</option>`;
            })
            .join("")}
        </select>

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input id="oFecha" type="date"
              value="${escapeAttr(new Date(p.fecha).toISOString().slice(0, 10))}"
              data-help="Fecha del pedido." />
          </div>
          <div>
            <label>Estado</label>
            <select id="oEstado" data-help="confirmado suma a ventas.">
              ${["confirmado", "borrador"].map((s) => `<option${s === p.estado ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Elementos</label>
            <input id="oElem" type="number" min="0" step="1"
              value="${escapeAttr(p.elementos || 0)}"
              data-help="Número de elementos en el pedido (tu métrica). No se calcula automáticamente." />
          </div>
          <div>
            <label>Total (calculado)</label>
            <input id="oTotalCalc" disabled value="${escapeAttr(fmtEur(p.total || 0))}" />
          </div>
        </div>

        <label>Notas</label>
        <textarea id="oNotas" data-help="Notas internas del pedido.">${escapeHtml(p.notas || "")}</textarea>

        <div class="hr"></div>

        <div class="row">
          <div>
            <h2>Productos</h2>
            <div class="mini muted">Añade varios productos y luego guarda el pedido.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="addProd">+ Añadir producto</button>
          </div>
        </div>

        <div id="prodsBox" class="list">
          ${p.lineas.length ? p.lineas.map(buildProductoRow).join("") : `<div class="muted">—</div>`}
        </div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(p.id)}</div>
          <div class="right flex">
            <button class="btn" id="oCancel">Cancelar</button>
            <button class="btn-primary" id="oSave">Guardar pedido</button>
          </div>
        </div>
      `
    );

    wireHelp($("#dlgBody"));

    // Wire botones
    $("#oCancel").onclick = () => dlgClose();

    $("#oSave").onclick = async () => {
      p.farmaciaId = ($("#oFarmSel").value || "").trim();

      const ymd = ($("#oFecha").value || "").trim();
      const d = parseISODateYMD(ymd);
      if (!d) {
        toast("Fecha inválida");
        return;
      }

      p.fecha = d.toISOString();
      p.estado = ($("#oEstado").value || "confirmado").trim();
      p.elementos = Math.max(0, Number($("#oElem").value || 0));
      p.notas = ($("#oNotas").value || "").trim();
      p.actualizadoEn = nowISO();

      recomputePedido(p);
      await dbPut("pedidos", p);

      toast("Pedido guardado");
      dlgClose();
      await refreshState();
      render();
    };

    $("#addProd").onclick = () => openProductoEnPedidoEdit(p, null, productos, () => {
      // refrescar solo la lista + total
      recomputePedido(p);
      const box = $("#prodsBox");
      if (box) box.innerHTML = p.lineas.length ? p.lineas.map(buildProductoRow).join("") : `<div class="muted">—</div>`;
      const tot = $("#oTotalCalc");
      if (tot) tot.value = fmtEur(p.total || 0);
    });

    // Delegación edit/quitar
    $("#dlgBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;

      const act = b.dataset.act;
      const idx = Number(b.dataset.idx);

      if (act === "delProd") {
        p.lineas.splice(idx, 1);
        recomputePedido(p);
        renderPedidoDialog(); // re-render completo (simple y robusto)
        return;
      }
      if (act === "editProd") {
        openProductoEnPedidoEdit(p, idx, productos, () => {
          recomputePedido(p);
          renderPedidoDialog();
        });
        return;
      }
    };
  }

  renderPedidoDialog();
}

/**********************
 * Sub-editor: Producto dentro del pedido (antes openLineEdit)
 * - Usa dlgPush/dlgPop para NO romper el editor del pedido
 **********************/
function openProductoEnPedidoEdit(pedido, idx, productos, onDone) {
  const isNew = idx == null;

  // Si no hay productos, permitimos crear línea "General" manualmente
  const fallbackProd = { id: "", nombre: "General" };

  const baseProd = productos.length ? productos[0] : fallbackProd;

  const l = isNew
    ? {
        id: uid(),
        productoId: baseProd.id || "",
        nombre: baseProd.nombre || "General",
        cantidad: 1,
        precioUnit: 0,
        descuentoPct: 0,
        total: 0,
      }
    : { ...pedido.lineas[idx] };

  // Guardar estado del pedido-dialog y abrir "subdialog"
  dlgPush();

  dlgOpen(
    isNew ? "Nuevo producto" : "Editar producto",
    "Producto dentro del pedido.",
    `
      <label>Producto</label>
      <select id="plProd" data-help="Producto del catálogo.">
        ${
          productos.length
            ? productos
                .map(
                  (pr) =>
                    `<option value="${escapeAttr(pr.id)}"${pr.id === l.productoId ? " selected" : ""}>${escapeHtml(pr.nombre)}</option>`
                )
                .join("")
            : `<option value="">General</option>`
        }
      </select>

      <div class="grid two">
        <div>
          <label>Cantidad</label>
          <input id="plQty" type="number" min="0" step="1" value="${escapeAttr(l.cantidad)}" data-help="Cantidad." />
        </div>
        <div>
          <label>Precio unitario</label>
          <input id="plPU" type="number" min="0" step="0.01" value="${escapeAttr(l.precioUnit)}" data-help="Precio unitario." />
        </div>
      </div>

      <label>Descuento (%)</label>
      <input id="plDto" type="number" min="0" step="0.5" value="${escapeAttr(l.descuentoPct || 0)}" data-help="Descuento porcentual." />

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
    `,
    `
      <div class="row">
        <div class="mini muted">Se recalcula al guardar</div>
        <div class="right flex">
          <button class="btn" id="plCancel">Cancelar</button>
          <button class="btn-primary" id="plSave">Guardar</button>
        </div>
      </div>
    `
  );

  wireHelp($("#dlgBody"));

  $("#plCancel").onclick = () => {
    // volver al pedido
    dlgPop();
    // reenganchar eventos del pedido (lo más robusto es que el caller re-renderice)
    onDone?.();
  };

  $("#plSave").onclick = () => {
    const pid = ($("#plProd").value || "").trim();
    const pr = (productos || []).find((x) => x.id === pid);

    l.productoId = pid;
    l.nombre = pr?.nombre || (productos.length ? "Producto" : "General");
    l.cantidad = Math.max(0, Number($("#plQty").value || 0));
    l.precioUnit = Math.max(0, Number($("#plPU").value || 0));
    l.descuentoPct = Math.max(0, Number($("#plDto").value || 0));

    // escribir en pedido
    pedido.lineas = Array.isArray(pedido.lineas) ? pedido.lineas : [];
    if (isNew) pedido.lineas.push(l);
    else pedido.lineas[idx] = l;

    recomputePedido(pedido);

    // volver al pedido
    dlgPop();
    onDone?.();
  };
}

// Compatibilidad: si en algún sitio se llama a openLineEdit, lo redirigimos
function openLineEdit(pedido, idx, productos, onDone) {
  return openProductoEnPedidoEdit(pedido, idx, productos, onDone);
}

/************************************************************
 * PARTE 9/10 — CHECK-INS -> VISITAS + FECHA + LISTADO POR DÍA
 * - UI: "Check-ins" pasa a "Visitas"
 * - Guardar visita con fecha seleccionable
 * - Listar visitas por día (selector de fecha)
 * - Botones: "Check-in" -> "Visita"
 ************************************************************/

/**********************
 * Helpers fecha día
 **********************/
function ymdFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function sameYMD(iso, ymd) {
  return ymdFromISO(iso) === String(ymd || "");
}

/**********************
 * Renombrar modal: openCheckinModal -> openVisitaModal
 * (mantengo wrapper por compatibilidad)
 **********************/
async function openVisitaModal(fid) {
  const f = await dbGet("farmacias", fid);
  if (!f) {
    toast("No encontrada");
    return;
  }

  const todayYMD = new Date().toISOString().slice(0, 10);

  dlgOpen(
    "Visita",
    `${f.nombre || f.codigo || "Farmacia"} · ${f.concello || "—"}`,
    `
      <div class="mini muted">Registra la visita y, si quieres, crea un pedido rápido.</div>
      <div class="hr"></div>

      <label>Fecha de la visita</label>
      <input id="viFecha" type="date" value="${escapeAttr(todayYMD)}"
        data-help="Selecciona el día real de la visita para poder listarlas por fecha." />

      <label>Notas de la visita</label>
      <textarea id="viNotas" data-help="Notas de la visita: motivos, feedback, acciones, etc."></textarea>

      <div class="hr"></div>

      <label>Crear pedido rápido (opcional)</label>
      <div class="grid two">
        <div>
          <label>Total (€)</label>
          <input id="viTotal" type="number" min="0" step="0.01" value=""
            data-help="Si metes un total, se creará un pedido con línea General." />
        </div>
        <div>
          <label>Elementos</label>
          <input id="viElems" type="number" min="0" step="1" value="0"
            data-help="Número de elementos (para tus estadísticas)." />
        </div>
      </div>

      <label>Estado del pedido (si se crea)</label>
      <select id="viEstado" data-help="Si creas pedido, confirmado suma a ventas.">
        <option value="confirmado">confirmado</option>
        <option value="borrador">borrador</option>
      </select>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
    `,
    `
      <div class="row">
        <div class="mini muted">${escapeHtml(f.concello || "—")}</div>
        <div class="right flex">
          <button class="btn" id="viCancel">Cancelar</button>
          <button class="btn-primary" id="viSave">Guardar</button>
        </div>
      </div>
    `
  );

  wireHelp($("#dlgBody"));

  $("#viCancel").onclick = () => dlgClose();
  $("#viSave").onclick = async () => {
    const notas = ($("#viNotas").value || "").trim();
    const total = Number(($("#viTotal").value || "").trim() || 0);
    const elems = Math.max(0, Number($("#viElems").value || 0));
    const est = ($("#viEstado").value || "confirmado").trim();

    const ymd = ($("#viFecha").value || "").trim();
    const d = parseISODateYMD(ymd);
    if (!d) {
      toast("Fecha inválida");
      return;
    }

    // Visita (store "checkins")
    const visita = {
      id: uid(),
      farmaciaId: fid,
      // guardamos ISO consistente para ese día
      fecha: d.toISOString(),
      notas,
      tipo: "visita",
    };
    await dbPut("checkins", visita);

    // Pedido rápido si hay total
    if (total > 0) {
      const gen = await ensureProductoGeneral();
      const pedido = recomputePedido({
        id: uid(),
        farmaciaId: fid,
        fecha: d.toISOString(), // mismo día que la visita
        estado: est,
        elementos: elems,
        notas: `Pedido rápido desde visita. ${notas ? "Notas: " + notas : ""}`.trim(),
        lineas: [
          {
            id: uid(),
            productoId: gen.id,
            nombre: "General",
            cantidad: 1,
            precioUnit: +total.toFixed(2),
            descuentoPct: 0,
            total: +total.toFixed(2),
          },
        ],
        total: +total.toFixed(2),
        creadoEn: nowISO(),
        actualizadoEn: nowISO(),
      });

      await dbPut("pedidos", pedido);
    }

    toast("Visita guardada");
    dlgClose();
    await refreshState();
    render();
  };
}

// Compatibilidad: donde aún se llame openCheckinModal, que abra Visita
const _openCheckinModal_original = openCheckinModal;
openCheckinModal = async function (fid) {
  return openVisitaModal(fid);
};

/**********************
 * Render: VISITAS (antes renderCheckins)
 * - Selector de fecha y listado SOLO de ese día
 **********************/
async function renderVisitas(viewEl) {
  const { checkins, farmacias } = state;
  const farmById = new Map(farmacias.map((f) => [f.id, f]));

  const todayYMD = new Date().toISOString().slice(0, 10);

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Visitas</h2>
          <div class="mini muted">Registra visitas por farmacia y consúltalas por día.</div>
        </div>
        <div class="right"></div>
      </div>

      <div class="hr"></div>

      <div class="grid two">
        <div>
          <label>Día</label>
          <input id="vDay" type="date" value="${escapeAttr(todayYMD)}"
            data-help="Selecciona el día para ver las visitas realizadas ese día." />
        </div>
        <div>
          <label>Buscar (solo en el día seleccionado)</label>
          <input id="vSearch" placeholder="Farmacia / cliente / concello / notas..." data-help="Filtra visitas del día por texto." />
        </div>
      </div>

      <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

      <div class="hr"></div>

      <div id="vSummary" class="mini muted"></div>

      <div class="hr"></div>

      <div id="vRows"></div>
    </div>
  `;

  wireHelp(viewEl);

  function renderRows() {
    const ymd = ($("#vDay").value || "").trim();
    const q = ($("#vSearch").value || "").trim().toLowerCase();

    // solo del día seleccionado
    let list = (checkins || [])
      .filter((ci) => sameYMD(ci.fecha, ymd))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (q) {
      list = list.filter((ci) => {
        const f = farmById.get(ci.farmaciaId);
        const blob = `${f?.nombre || ""} ${f?.codigo || ""} ${f?.cliente || ""} ${f?.concello || ""} ${ci.notas || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }

    $("#vSummary").innerHTML = `Día: <b>${escapeHtml(ymd)}</b> · Visitas: <b>${list.length}</b>`;

    $("#vRows").innerHTML = `
      <div class="list">
        ${
          list.length
            ? list
                .map((ci) => {
                  const f = farmById.get(ci.farmaciaId);
                  const title = f ? f.nombre || f.codigo || "Farmacia" : "—";
                  return `
                    <div class="list-item">
                      <div>
                        <b>${escapeHtml(title)}</b><br>
                        <span class="mini muted">${escapeHtml(fmtDate(ci.fecha))} · ${escapeHtml(
                    f?.concello || "—"
                  )} · Cliente: ${escapeHtml(f?.cliente || "—")}</span><br>
                        <span class="mini muted">${escapeHtml(ci.notas || "")}</span>
                      </div>
                      <div class="right flex">
                        <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(ci.farmaciaId)}">Detalles</button>
                        <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(ci.id)}">Borrar</button>
                      </div>
                    </div>
                  `;
                })
                .join("")
            : `<div class="muted">—</div>`
        }
      </div>
    `;
  }

  renderRows();

  $("#vDay").onchange = renderRows;
  $("#vSearch").oninput = renderRows;

  viewEl.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;

    if (act === "details") {
      openFarmaciaDetails(b.dataset.fid);
      return;
    }
    if (act === "del") {
      if (!confirm("¿Borrar visita?")) return;
      await dbDel("checkins", b.dataset.id);
      toast("Visita borrada");
      await refreshState();
      await renderVisitas(viewEl);
    }
  };
}

// Sustituimos renderCheckins por renderVisitas en el dispatcher
const _render_original_part9 = render;
render = async function () {
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

  // 👇 aquí está el cambio clave
  if (state.view === "checkins") return renderVisitas(viewEl);

  if (state.view === "backup") return renderBackup(viewEl);
  if (state.view === "ajustes") return renderAjustes(viewEl);

  viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
};

/**********************
 * Parche rápido de textos visibles en botones (sin tocar todo el archivo aquí)
 * - Cambia etiquetas comunes en renders ya existentes
 **********************/
function patchCheckinTextInHTML(root = document) {
  // botones con texto "Check-in" -> "Visita"
  $$("button", root).forEach((b) => {
    const t = (b.textContent || "").trim();
    if (t === "Check-in") b.textContent = "Visita";
    if (t === "Check-in + pedido") b.textContent = "Visita + pedido";
  });
}

// Aplica cada render
const _setView_original_part9 = setView;
setView = function (v) {
  state.view = v;
  $$("nav .tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  render().then(() => patchCheckinTextInHTML(document));
};

/************************************************************
 * PARTE 10/10 — PEDIDOS FINAL + IMPORTAR PEGANDO JSON
 * - Importar pedidos desde textarea (copiar/pegar)
 * - Producto General garantizado
 * - Filtro por Mis Farmacias
 * - Recalcular totales siempre
 ************************************************************/

/**********************
 * Recalcular pedido
 **********************/
function recomputePedido(p) {
  let total = 0;
  for (const l of p.lineas || []) {
    const qty = Number(l.cantidad || 0);
    const pu = Number(l.precioUnit || 0);
    const dto = Number(l.descuentoPct || 0);
    const lineTotal = qty * pu * (1 - dto / 100);
    l.total = +lineTotal.toFixed(2);
    total += l.total;
  }
  p.total = +total.toFixed(2);
  p.actualizadoEn = nowISO();
  return p;
}

/**********************
 * Importar pedidos desde TEXTO (textarea)
 **********************/
async function importPedidosFromText(text) {
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    toast("JSON inválido");
    return;
  }

  if (!Array.isArray(arr)) {
    toast("El JSON debe ser un array []");
    return;
  }

  const gen = await ensureProductoGeneral();
  let n = 0;

  for (const it of arr) {
    const cliente = String(it.cliente || "").trim();
    const fechaYMD = String(it.fecha || "").trim();
    const total = Number(it.total_eur || 0);
    const elementos = Number(it.elementos || 0);

    if (!cliente || !fechaYMD || !total) continue;

    const estado = normalizeEstado(it.estado);
    if (estado !== "confirmado") continue;

    const farmacia = await findOrCreateFarmaciaByCliente(cliente);
    if (!farmacia) continue;

    const d = parseISODateYMD(fechaYMD);
    if (!d) continue;

    const pedido = recomputePedido({
      id: uid(),
      farmaciaId: farmacia.id,
      fecha: d.toISOString(),
      estado: "confirmado",
      elementos,
      notas: `Importado desde texto · estado origen: ${it.estado}`,
      lineas: [
        {
          id: uid(),
          productoId: gen.id,
          nombre: "General",
          cantidad: 1,
          precioUnit: +total.toFixed(2),
          descuentoPct: 0,
          total: +total.toFixed(2),
        },
      ],
      creadoEn: nowISO(),
      actualizadoEn: nowISO(),
    });

    await dbPut("pedidos", pedido);
    n++;
  }

  toast(`Pedidos importados: ${n}`);
  await refreshState();
  render();
}

/**********************
 * Render PEDIDOS
 **********************/
async function renderPedidos(viewEl) {
  const { pedidos, farmacias, misFarmacias } = state;

  const farmById = new Map(farmacias.map((f) => [f.id, f]));
  const misSet = new Set((misFarmacias || []).map((m) => m.farmaciaId));

  viewEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <h2>Pedidos</h2>
          <div class="mini muted">Ventas confirmadas y gestión de pedidos.</div>
        </div>
        <div class="right flex">
          <button class="btn btn-xs" id="btnPaste">Importar pegando JSON</button>
        </div>
      </div>

      <div class="hr"></div>

      <label>
        <input type="checkbox" id="onlyMine" checked />
        Solo mis farmacias
      </label>

      <div class="hr"></div>

      <div id="pRows"></div>
    </div>
  `;

  function renderRows() {
    const onlyMine = $("#onlyMine").checked;

    let list = pedidos
      .filter((p) => p.estado === "confirmado")
      .filter((p) => !onlyMine || misSet.has(p.farmaciaId))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    $("#pRows").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Elementos</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${
            list.length
              ? list
                  .map((p) => {
                    const f = farmById.get(p.farmaciaId);
                    return `
                      <tr>
                        <td>${fmtDate(p.fecha)}</td>
                        <td>${escapeHtml(f?.cliente || "—")}</td>
                        <td>${p.elementos || 0}</td>
                        <td><b>${fmtEur(p.total)}</b></td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="4" class="muted">—</td></tr>`
          }
        </tbody>
      </table>
    `;
  }

  renderRows();
  $("#onlyMine").onchange = renderRows;

  // Importar pegando JSON
  $("#btnPaste").onclick = () => {
    dlgOpen(
      "Importar pedidos",
      "Pega aquí el JSON de pedidos",
      `
        <textarea id="pasteJSON" style="min-height:220px"
          placeholder='[ { "cliente": "...", "estado": "Confirmado", ... } ]'></textarea>
        <div class="mini muted">
          Se importan solo pedidos en estado Confirmado / Exportado / Enviado.
        </div>
      `,
      `
        <div class="right flex">
          <button class="btn" id="pCancel">Cancelar</button>
          <button class="btn-primary" id="pDo">Importar</button>
        </div>
      `
    );

    $("#pCancel").onclick = () => dlgClose();
    $("#pDo").onclick = async () => {
      const txt = $("#pasteJSON").value || "";
      await importPedidosFromText(txt);
      dlgClose();
    };
  };
}

/**********************
 * Dispatcher FINAL
 **********************/
const _render_final = render;
render = async function () {
  const viewEl = $("#view");
  if (!viewEl) return;

  if (state.view === "dash") return renderDashboard(viewEl);
  if (state.view === "predicciones") return renderPredicciones(viewEl);
  if (state.view === "farmacias") return renderFarmacias(viewEl);
  if (state.view === "pedidos") return renderPedidos(viewEl);
  if (state.view === "productos") return renderProductos(viewEl);
  if (state.view === "rutas") return renderRutas(viewEl);
  if (state.view === "checkins") return renderVisitas(viewEl);
  if (state.view === "backup") return renderBackup(viewEl);
  if (state.view === "ajustes") return renderAjustes(viewEl);

  viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
};
