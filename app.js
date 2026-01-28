/************************************************************
 * Farmacias · Ventas Offline (PWA)
 * - IndexedDB storage
 * - Dashboard + Predicciones + Farmacias + Pedidos + Productos
 * - Import JSON farmacias (nuevo formato data[])
 * - Import KML farmacias
 * - Import JSON pedidos (cliente/estado/elementos/fecha/total_eur)
 * - Producto "General" para importaciones
 * - Check-in + Detalles farmacia + estimación próximo pedido
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
   * Quarter helpers
   **********************/
  function quarterKey(date) {
    const d = new Date(date);
    const y = String(d.getFullYear()).slice(-2);
    const m = d.getMonth(); // 0..11
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
   * UID
   **********************/
  function uid() {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  /**********************
   * IndexedDB
   **********************/
  const DB_NAME = "farmacias_offline_db";
  const DB_VER = 2;

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const d = req.result;

        if (!d.objectStoreNames.contains("farmacias")) {
          const s = d.createObjectStore("farmacias", { keyPath: "id" });
          s.createIndex("by_codigo", "codigo", { unique: false });
          s.createIndex("by_cliente", "cliente", { unique: false });
          s.createIndex("by_concello", "concello", { unique: false });
        }
        if (!d.objectStoreNames.contains("misFarmacias")) {
          d.createObjectStore("misFarmacias", { keyPath: "id" }); // {id, farmaciaId, createdAt}
        }
        if (!d.objectStoreNames.contains("productos")) {
          d.createObjectStore("productos", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("pedidos")) {
          const s = d.createObjectStore("pedidos", { keyPath: "id" });
          s.createIndex("by_farmacia", "farmaciaId", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });
        }
        if (!d.objectStoreNames.contains("checkins")) {
          const s = d.createObjectStore("checkins", { keyPath: "id" });
          s.createIndex("by_farmacia", "farmaciaId", { unique: false });
          s.createIndex("by_fecha", "fecha", { unique: false });
        }
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

  function pedidoTotal(p) {
    return Number(p.total || 0);
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
    // En tu app: consideramos "confirmado" como válido para ventas.
    return (pedidos || []).filter((p) => String(p.estado || "") === "confirmado");
  }

  function farmaciaStats(farmaciaId, pedidosOk) {
    const list = (pedidosOk || [])
      .filter((p) => p.farmaciaId === farmaciaId)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // desc

    if (list.length < 3) {
      return { hasEstimate: false, count: list.length };
    }

    const last10 = list
      .slice(0, 10)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha)); // asc

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

  function mapsLinkForFarmacia(f) {
    if (!f) return "";
    if (f.lat != null && f.lon != null) {
      const lat = Number(f.lat);
      const lon = Number(f.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        return `https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lon)}`;
      }
    }
    const addr = (f.direccion || "").trim();
    if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    return "";
  }

  async function ensureProductoGeneral() {
    const all = await dbAll("productos");
    let p = all.find((x) => String(x.nombre || "").trim().toLowerCase() === "general");
    if (p) return p;

    p = {
      id: uid(),
      nombre: "General",
      descripcion: "Importaciones: total del pedido como línea única.",
      creadoEn: nowISO(),
      actualizadoEn: nowISO(),
    };
    await dbPut("productos", p);
    return p;
  }

  async function findOrCreateFarmaciaByCliente(cliente) {
    const name = String(cliente || "").trim();
    if (!name) return null;

    const farmacias = await dbAll("farmacias");
    let f = farmacias.find((x) => String(x.cliente || "").trim().toLowerCase() === name.toLowerCase());
    if (f) return f;

    // crear farmacia mínima manual
    f = {
      id: uid(),
      codigo: "",
      nombre: `Farmacia ${name.split(" ").slice(0, 2).join(" ")}`.trim(),
      direccion: "",
      cp: "",
      concello: "",
      telefono: "",
      cliente: name,
      lat: null,
      lon: null,
      source: "manual",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await dbPut("farmacias", f);
    return f;
  }

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

  /**********************
   * Import farmacias JSON (nuevo formato data[])
   **********************/
  async function importFarmaciasNewJsonFile(file) {
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
      const ok = await upsertFarmaciaFromNewItem(it);
      if (ok) n++;
    }
    toast(`Farmacias importadas/actualizadas: ${n}`);
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
      let lon = null,
        lat = null;
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
   * Import pedidos JSON (tu formato)
   **********************/
  async function importPedidosJsonFile(file) {
    const txt = await file.text();
    let arr;
    try {
      arr = JSON.parse(txt);
    } catch {
      toast("JSON inválido");
      return;
    }
    if (!Array.isArray(arr)) {
      toast("El JSON debe ser una lista []");
      return;
    }

    const gen = await ensureProductoGeneral();
    let n = 0;

    for (const it of arr) {
      const cliente = String(it.cliente || "").trim();
      const fechaYMD = String(it.fecha || "").trim();
      const total = Number(it.total_eur || 0);
      const elementos = Number(it.elementos || 0);
      if (!cliente || !fechaYMD) continue;

      const farmacia = await findOrCreateFarmaciaByCliente(cliente);
      if (!farmacia) continue;

      const d = parseISODateYMD(fechaYMD);
      if (!d) continue;

      const pedido = recomputePedido({
        id: uid(),
        farmaciaId: farmacia.id,
        fecha: d.toISOString(),
        estado: normalizeEstado(it.estado),
        elementos,
        notas: `Importado JSON · estado origen: ${it.estado} · elementos: ${elementos}`,
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
      n++;
    }

    toast(`Pedidos importados: ${n}`);
  }

  /**********************
   * Mis farmacias
   **********************/
  async function getMisFarmaciasIds() {
    const all = await dbAll("misFarmacias");
    return new Set(all.map((x) => x.farmaciaId));
  }

  async function addToMisFarmacias(farmaciaId) {
    const all = await dbAll("misFarmacias");
    if (all.some((x) => x.farmaciaId === farmaciaId)) return;
    await dbPut("misFarmacias", { id: uid(), farmaciaId, createdAt: nowISO() });
  }

  async function removeFromMisFarmacias(farmaciaId) {
    const all = await dbAll("misFarmacias");
    const row = all.find((x) => x.farmaciaId === farmaciaId);
    if (row) await dbDel("misFarmacias", row.id);
  }

  /**********************
   * Dialog (details / checkin)
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

  /**********************
   * Compute due & soon
   **********************/
  function computeDueSoon(farmacias, pedidos, daysSoon = 7) {
    const ok = getPedidosOk(pedidos);
    const now = new Date();

    const due = [];
    const soon = [];

    for (const f of farmacias) {
      const st = farmaciaStats(f.id, ok);
      if (!st.hasEstimate) continue;
      const next = st.nextISO ? new Date(st.nextISO) : null;
      if (!next) continue;

      const diff = Math.round((next - now) / (1000 * 60 * 60 * 24));
      const metaText = `Próximo: ${fmtDate(next.toISOString())} · media: ${Math.round(st.avgDays)} días`;

      if (diff < 0) due.push({ f, metaText, diff });
      else if (diff <= daysSoon) soon.push({ f, metaText, diff });
    }

    due.sort((a, b) => a.diff - b.diff);
    soon.sort((a, b) => a.diff - b.diff);

    return { due, soon };
  }

  function renderSuggestList(items, includeCheckin = false) {
    if (!items.length) return `<div class="muted">—</div>`;
    return `
      <div class="list">
        ${items
          .map((x) => {
            const f = x.f;
            const title = f.nombre || f.codigo || "Farmacia";
            const cliente = f.cliente ? `Cliente: ${f.cliente}` : "";
            const concello = f.concello ? `Concello: ${f.concello}` : "";
            return `
              <div class="list-item">
                <div>
                  <b>${escapeHtml(title)}</b><br>
                  <span class="mini muted">${escapeHtml(x.metaText)}</span><br>
                  <span class="mini muted">${escapeHtml(cliente)}</span><br>
                  <span class="mini muted">${escapeHtml(concello)}</span>
                </div>
                <div class="right flex">
                  <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(f.id)}">Detalles</button>
                  <button class="btn btn-xs" data-act="maps" data-fid="${escapeAttr(f.id)}">Maps</button>
                  ${
                    includeCheckin
                      ? `<button class="btn-primary btn-xs" data-act="checkin" data-fid="${escapeAttr(
                          f.id
                        )}">Check-in</button>`
                      : ""
                  }
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /**********************
   * Render quarter bars
   **********************/
  function renderQuarterBars(okPedidos, settings, yearFull) {
    const year2 = String(yearFull).slice(-2);
    const keys = ["1T", "2T", "3T", "4T"].map((q) => q + year2);

    const totals = {};
    for (const k of keys) totals[k] = 0;

    for (const p of okPedidos) {
      const k = quarterKey(new Date(p.fecha));
      if (k.endsWith(year2) && totals[k] != null) totals[k] += Number(p.total || 0);
    }

    const targets = settings.quarterlyTargets || {};
    const maxVal = Math.max(1, ...keys.map((k) => Math.max(Number(targets[k] || 0), Number(totals[k] || 0))));

    const bar = (val, cls) => {
      const w = Math.round((val / maxVal) * 100);
      return `<div class="bar ${cls}" style="width:${w}%"></div>`;
    };

    return `
      <div class="qbars">
        ${keys
          .map((k) => {
            const t = Number(targets[k] || 0);
            const a = Number(totals[k] || 0);
            return `
              <div class="qrow">
                <div class="qname"><b>${k}</b></div>
                <div class="qstack">
                  <div class="qline">
                    <div class="mini muted">Objetivo: ${t ? fmtEurShort(t) : "—"}</div>
                    <div class="bars">${t ? bar(t, "target") : ""}</div>
                  </div>
                  <div class="qline">
                    <div class="mini muted">Conseguido: <b>${fmtEurShort(a)}</b></div>
                    <div class="bars">${bar(a, "ach")}</div>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /**********************
   * Help text (data-help)
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
   * App State + Router
   **********************/
  const state = {
    view: "dash",
    farmacias: [],
    pedidos: [],
    productos: [],
    checkins: [],
    settings: null,
  };

  async function refreshState() {
    state.farmacias = await dbAll("farmacias");
    state.pedidos = await dbAll("pedidos");
    state.productos = await dbAll("productos");
    state.checkins = await dbAll("checkins");
    state.settings = await loadSettings();
  }

  function setView(v) {
    state.view = v;
    $$("nav .tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    render();
  }

  /**********************
   * Views renderers
   **********************/
  async function renderDashboard(viewEl) {
    const { farmacias, pedidos, settings } = state;

    const now = new Date();
    const qNow = quarterKey(now);

    const target = getQuarterTarget(settings, qNow) || 0;
    const desiredPct = Number(settings.desiredPct || 0);
    const desiredTarget = target * (1 + desiredPct / 100);

    const ok = getPedidosOk(pedidos);
    const qSales = ok
      .filter((p) => quarterKey(new Date(p.fecha)) === qNow)
      .reduce((s, p) => s + pedidoTotal(p), 0);

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

    const { due, soon } = computeDueSoon(farmacias, pedidos, 7);

    viewEl.innerHTML = `
      <div class="card">
        <h2>Dashboard · ${escapeHtml(qNow)}</h2>
        <div class="muted">Total trimestre en curso frente a objetivos.</div>
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
            <div class="v">${progD}%</div>
            <div class="t">Progreso deseado</div>
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
                <div class="t">a vender por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDay)}</div>
                <div class="t">a vender por día</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin:0">
            <h2>Ritmo deseado</h2>
            <div class="mini muted">Calculado con objetivo deseado (+${desiredPct}%).</div>
            <div class="hr"></div>
            <div class="grid two">
              <div class="k">
                <div class="v">${fmtEur(perWeekD)}</div>
                <div class="t">a vender por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDayD)}</div>
                <div class="t">a vender por día</div>
              </div>
            </div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Vencidas (${due.length})</h2>
            ${renderSuggestList(due, true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Próximas (≤ 7 días) (${soon.length})</h2>
            ${renderSuggestList(soon, true)}
          </div>
        </div>
      </div>
    `;

    // Delegación de clicks
    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const fid = b.dataset.fid;
      const act = b.dataset.act;
      if (!fid || !act) return;
      if (act === "details") openFarmaciaDetails(fid);
      if (act === "checkin") openCheckinModal(fid);
      if (act === "maps") {
        const f = state.farmacias.find((x) => x.id === fid);
        const url = mapsLinkForFarmacia(f);
        if (url) window.open(url, "_blank", "noopener");
      }
    };
  }

  async function renderPredicciones(viewEl) {
    const { farmacias, pedidos, settings } = state;

    const now = new Date();
    const qNow = quarterKey(now);

    const target = getQuarterTarget(settings, qNow) || 0;
    const desiredPct = Number(settings.desiredPct || 0);
    const desiredTarget = target * (1 + desiredPct / 100);

    const ok = getPedidosOk(pedidos);
    const qSales = ok
      .filter((p) => quarterKey(new Date(p.fecha)) === qNow)
      .reduce((s, p) => s + pedidoTotal(p), 0);

    const faltan = Math.max(0, target - qSales);
    const faltanDeseado = Math.max(0, desiredTarget - qSales);

    const { end } = quarterBounds(now);
    const daysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));

    const perWeek = weeksLeft ? faltan / weeksLeft : faltan;
    const perDay = daysLeft ? faltan / daysLeft : faltan;

    const perWeekD = weeksLeft ? faltanDeseado / weeksLeft : faltanDeseado;
    const perDayD = daysLeft ? faltanDeseado / daysLeft : faltanDeseado;

    const { due, soon } = computeDueSoon(farmacias, pedidos, 7);

    viewEl.innerHTML = `
      <div class="card">
        <h2>Predicciones · ${escapeHtml(qNow)}</h2>
        <div class="muted">Se recalcula en base al objetivo trimestral y a tu histórico (offline).</div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Ritmo para alcanzar objetivo</h2>
            <div class="mini muted">
              Ventas trimestre: <b>${fmtEur(qSales)}</b><br>
              Objetivo: <b>${fmtEur(target)}</b><br>
              Faltan: <b>${fmtEur(faltan)}</b>
            </div>
            <div class="hr"></div>
            <div class="grid two">
              <div class="k">
                <div class="v">${fmtEur(perWeek)}</div>
                <div class="t">a vender por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDay)}</div>
                <div class="t">a vender por día</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin:0">
            <h2>Ritmo para alcanzar objetivo deseado</h2>
            <div class="mini muted">
              Objetivo deseado (+${desiredPct}%): <b>${fmtEur(desiredTarget)}</b><br>
              Ventas trimestre: <b>${fmtEur(qSales)}</b><br>
              Faltan: <b>${fmtEur(faltanDeseado)}</b>
            </div>
            <div class="hr"></div>
            <div class="grid two">
              <div class="k">
                <div class="v">${fmtEur(perWeekD)}</div>
                <div class="t">a vender por semana</div>
              </div>
              <div class="k">
                <div class="v">${fmtEur(perDayD)}</div>
                <div class="t">a vender por día</div>
              </div>
            </div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Vencidas (${due.length})</h2>
            ${renderSuggestList(due, true)}
          </div>
          <div class="card" style="margin:0">
            <h2>Próximas (≤ 7 días) (${soon.length})</h2>
            ${renderSuggestList(soon, true)}
          </div>
        </div>

        <div class="hr"></div>

        <div class="card" style="margin:0">
          <h2>Resumen por trimestre</h2>
          <div class="mini muted">Objetivo vs conseguido (ventas confirmadas).</div>
          <div class="hr"></div>
          ${renderQuarterBars(ok, settings, new Date().getFullYear())}
        </div>
      </div>
    `;

    // Delegación de clicks
    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const fid = b.dataset.fid;
      const act = b.dataset.act;
      if (!fid || !act) return;
      if (act === "details") openFarmaciaDetails(fid);
      if (act === "checkin") openCheckinModal(fid);
      if (act === "maps") {
        const f = state.farmacias.find((x) => x.id === fid);
        const url = mapsLinkForFarmacia(f);
        if (url) window.open(url, "_blank", "noopener");
      }
    };
  }

  async function renderFarmacias(viewEl) {
    const { farmacias, pedidos } = state;

    const misIds = await getMisFarmaciasIds();
    const catalogo = farmacias
      .filter((f) => (f.source || "") === "catalogo")
      .sort((a, b) => (a.codigo || a.nombre || "").localeCompare(b.codigo || b.nombre || "", "es"));

    const mis = farmacias
      .filter((f) => misIds.has(f.id))
      .sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Farmacias</h2>
            <div class="mini muted">Importa catálogo (JSON nuevo o KML) y añade farmacias a <b>Mis farmacias</b>.</div>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" id="btnImportJsonNew">Importar JSON (nuevo)</button>
            <button class="btn btn-xs" id="btnImportKml">Importar KML</button>
            <button class="btn-danger btn-xs" id="btnBorrarCatalogo">Borrar catálogo</button>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div class="card" style="margin:0">
            <h2>Catálogo Galicia (${catalogo.length})</h2>

            <label>Buscar</label>
            <input id="catSearch" placeholder="Nombre / código / concello / cliente..." data-help="Busca en el catálogo por nombre, código, concello o cliente (titular)." />

            <div class="grid two">
              <div>
                <label>Límite listado</label>
                <select id="catLimit" data-help="Limita cuántos resultados del catálogo se muestran para que vaya fluido.">
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

          <div class="card" style="margin:0">
            <div class="row">
              <div>
                <h2>Mis farmacias (${mis.length})</h2>
                <div class="mini muted">Cada farmacia tiene panel de detalles y check-in.</div>
              </div>
              <div class="right">
                <button class="btn btn-xs" id="btnAltaManual">+ Alta manual</button>
              </div>
            </div>

            <label>Filtrar Mis farmacias por concello</label>
            <select id="myConcello" data-help="Filtra tus farmacias por concello.">
              <option value="">Todas</option>
            </select>

            <label>Buscar</label>
            <input id="mySearch" placeholder="Nombre / código / cliente..." data-help="Busca dentro de Mis farmacias." />

            <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

            <div class="hr"></div>
            <div id="myRows"></div>
          </div>
        </div>
      </div>
    `;

    const elCat = $("#catRows");
    const elMy = $("#myRows");

    $("#catLimit").value = "100";

    function buildConcelloOptions(selectEl, list) {
      const concellos = [...new Set(list.map((x) => (x.concello || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "es")
      );
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

      // repoblar opciones según catálogo actual
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

    function renderMyRows() {
      const q = ($("#mySearch").value || "").trim().toLowerCase();
      const concelloSel = ($("#myConcello").value || "").trim();

      let arr = mis.slice();

      // repoblar concellos en Mis
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
                    <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(f.id)}">Detalles</button>
                    <button class="btn-primary btn-xs" data-act="checkin" data-fid="${escapeAttr(f.id)}">Check-in + pedido</button>
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

    renderCatalogRows();
    renderMyRows();

    $("#catSearch").oninput = renderCatalogRows;
    $("#catLimit").onchange = renderCatalogRows;
    $("#catConcello").onchange = renderCatalogRows;

    $("#myConcello").onchange = renderMyRows;
    $("#mySearch").oninput = renderMyRows;

    // help
    wireHelp(viewEl);

    // handlers botones
    $("#btnImportJsonNew").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importFarmaciasNewJsonFile(f);
        await refreshState();
        await renderFarmacias(viewEl);
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
        await renderFarmacias(viewEl);
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
      await renderFarmacias(viewEl);
    };

    $("#btnAltaManual").onclick = () => openFarmaciaEdit(null);

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
        await renderFarmacias(viewEl);
        return;
      }
      if (act === "delmis") {
        await removeFromMisFarmacias(fid);
        toast("Quitada de Mis farmacias");
        await refreshState();
        await renderFarmacias(viewEl);
        return;
      }
      if (act === "details") {
        openFarmaciaDetails(fid);
        return;
      }
      if (act === "checkin") {
        openCheckinModal(fid);
        return;
      }
    };
  }

  async function renderPedidos(viewEl) {
    const { pedidos, farmacias } = state;

    // map farmaciaId -> farmacia
    const farmById = new Map(farmacias.map((f) => [f.id, f]));

    viewEl.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <h2>Pedidos (${pedidos.length})</h2>
            <div class="mini muted">Filtra por farmacia y por cliente (titular). Importa pedidos JSON si lo necesitas.</div>
          </div>
          <div class="right flex">
            <button class="btn btn-xs" id="oImport">Importar pedidos JSON</button>
            <button class="btn-primary btn-xs" id="oNew">+ Nuevo pedido</button>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid two">
          <div>
            <label>Filtrar por farmacia</label>
            <select id="oFarm" data-help="Filtra pedidos por una farmacia concreta.">
              <option value="">Todas</option>
            </select>
          </div>
          <div>
            <label>Filtrar por cliente (titular)</label>
            <input id="oCliente" placeholder="Escribe parte del nombre del cliente..." data-help="Filtra pedidos por el titular/cliente de la farmacia." />
          </div>
        </div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

        <div class="hr"></div>

        <div id="oSummary" class="mini muted"></div>

        <div class="hr"></div>

        <div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th style="width:120px">Fecha</th>
                <th>Farmacia</th>
                <th>Cliente</th>
                <th style="width:120px">Estado</th>
                <th style="width:130px">Total</th>
                <th style="width:160px"></th>
              </tr>
            </thead>
            <tbody id="oRows"></tbody>
          </table>
        </div>
      </div>
    `;

    // fill farmacia options
    const farmSel = $("#oFarm");
    const farmsSorted = [...farmacias].sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
    farmSel.innerHTML =
      `<option value="">Todas</option>` +
      farmsSorted
        .map((f) => {
          const name = f.nombre || f.codigo || "Farmacia";
          return `<option value="${escapeAttr(f.id)}">${escapeHtml(name)}</option>`;
        })
        .join("");

    function renderRows() {
      const fid = ($("#oFarm").value || "").trim();
      const qCli = ($("#oCliente").value || "").trim().toLowerCase();

      let arr = pedidos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      if (fid) arr = arr.filter((p) => p.farmaciaId === fid);

      if (qCli) {
        arr = arr.filter((p) => {
          const f = farmById.get(p.farmaciaId);
          const c = (f?.cliente || "").toLowerCase();
          return c.includes(qCli);
        });
      }

      // summary
      const tot = arr.reduce((s, p) => s + Number(p.total || 0), 0);
      const ok = getPedidosOk(arr);
      const totOk = ok.reduce((s, p) => s + Number(p.total || 0), 0);

      $("#oSummary").innerHTML = `
        Total listado: <b>${fmtEur(tot)}</b> · Confirmados: <b>${fmtEur(totOk)}</b> · Registros: <b>${arr.length}</b>
      `;

      $("#oRows").innerHTML = arr
        .map((p) => {
          const f = farmById.get(p.farmaciaId);
          const fname = f ? f.nombre || f.codigo || "Farmacia" : "—";
          const cli = f?.cliente || "—";
          return `
            <tr>
              <td>${escapeHtml(fmtDate(p.fecha))}</td>
              <td>${escapeHtml(fname)}</td>
              <td>${escapeHtml(cli)}</td>
              <td><span class="pill ${p.estado === "confirmado" ? "ok" : "warn"}">${escapeHtml(p.estado || "—")}</span></td>
              <td><b>${fmtEur(p.total || 0)}</b></td>
              <td class="right">
                <button class="btn btn-xs" data-act="edit" data-id="${escapeAttr(p.id)}">Editar</button>
                <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(p.id)}">Borrar</button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    renderRows();

    $("#oFarm").onchange = renderRows;
    $("#oCliente").oninput = renderRows;

    // help
    wireHelp(viewEl);

    $("#oNew").onclick = () => openPedidoEdit(null);

    $("#oImport").onclick = async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        await importPedidosJsonFile(f);
        await refreshState();
        await renderPedidos(viewEl);
      };
      inp.click();
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
        await renderPedidos(viewEl);
        return;
      }
      if (act === "edit") {
        openPedidoEdit(id);
        return;
      }
    };
  }

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
      if (q) {
        list = list.filter((p) => `${p.nombre || ""} ${p.descripcion || ""}`.toLowerCase().includes(q));
      }

      $("#pRows").innerHTML = `
        <div class="list">
          ${list
            .map((p) => {
              return `
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
            `;
            })
            .join("")}
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
        await renderProductos(viewEl);
        return;
      }
      if (act === "edit") {
        openProductoEdit(id);
        return;
      }
    };
  }

  async function renderRutas(viewEl) {
    const misIds = await getMisFarmaciasIds();
    const mis = state.farmacias.filter((f) => misIds.has(f.id));

    // Agrupar por concello
    const map = new Map();
    for (const f of mis) {
      const c = (f.concello || "Sin concello").trim() || "Sin concello";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(f);
    }

    const concellos = [...map.keys()].sort((a, b) => a.localeCompare(b, "es"));

    viewEl.innerHTML = `
      <div class="card">
        <h2>Rutas</h2>
        <div class="mini muted">Vista rápida por concello para organizar visitas (offline).</div>
        <div class="hr"></div>

        ${concellos
          .map((c) => {
            const list = map.get(c).sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
            return `
              <div class="card" style="margin:0 0 12px 0">
                <div class="row">
                  <div>
                    <b>${escapeHtml(c)}</b><br>
                    <span class="mini muted">${list.length} farmacias</span>
                  </div>
                </div>
                <div class="hr"></div>
                <div class="list">
                  ${list
                    .map((f) => {
                      const title = f.nombre || f.codigo || "Farmacia";
                      return `
                        <div class="list-item">
                          <div>
                            <b>${escapeHtml(title)}</b><br>
                            <span class="mini muted">Cliente: ${escapeHtml(f.cliente || "—")} · Tel: ${escapeHtml(f.telefono || "—")}</span>
                          </div>
                          <div class="right flex">
                            <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(f.id)}">Detalles</button>
                            <button class="btn-primary btn-xs" data-act="checkin" data-fid="${escapeAttr(f.id)}">Check-in</button>
                            <button class="btn btn-xs" data-act="maps" data-fid="${escapeAttr(f.id)}">Maps</button>
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    viewEl.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const fid = b.dataset.fid;
      const act = b.dataset.act;
      if (!fid || !act) return;

      if (act === "details") openFarmaciaDetails(fid);
      if (act === "checkin") openCheckinModal(fid);
      if (act === "maps") {
        const f = state.farmacias.find((x) => x.id === fid);
        const url = mapsLinkForFarmacia(f);
        if (url) window.open(url, "_blank", "noopener");
      }
    };
  }

  async function renderCheckins(viewEl) {
    const { checkins, farmacias } = state;
    const farmById = new Map(farmacias.map((f) => [f.id, f]));

    const arr = [...checkins].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    viewEl.innerHTML = `
      <div class="card">
        <h2>Check-ins (${arr.length})</h2>
        <div class="mini muted">Registro de visitas/check-ins por farmacia.</div>
        <div class="hr"></div>

        <label>Buscar</label>
        <input id="cSearch" placeholder="Farmacia / cliente / concello / notas..." data-help="Filtra check-ins por texto." />

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>

        <div class="hr"></div>

        <div id="cRows"></div>
      </div>
    `;

    function renderRows() {
      const q = ($("#cSearch").value || "").trim().toLowerCase();
      let list = arr.slice();
      if (q) {
        list = list.filter((ci) => {
          const f = farmById.get(ci.farmaciaId);
          const blob = `${f?.nombre || ""} ${f?.codigo || ""} ${f?.cliente || ""} ${f?.concello || ""} ${ci.notas || ""}`.toLowerCase();
          return blob.includes(q);
        });
      }

      $("#cRows").innerHTML = `
        <div class="list">
          ${list
            .map((ci) => {
              const f = farmById.get(ci.farmaciaId);
              const title = f ? f.nombre || f.codigo || "Farmacia" : "—";
              return `
                <div class="list-item">
                  <div>
                    <b>${escapeHtml(title)}</b><br>
                    <span class="mini muted">${escapeHtml(fmtDate(ci.fecha))} · ${escapeHtml(f?.concello || "—")} · Cliente: ${escapeHtml(f?.cliente || "—")}</span><br>
                    <span class="mini muted">${escapeHtml(ci.notas || "")}</span>
                  </div>
                  <div class="right flex">
                    <button class="btn btn-xs" data-act="details" data-fid="${escapeAttr(ci.farmaciaId)}">Detalles</button>
                    <button class="btn-danger btn-xs" data-act="del" data-id="${escapeAttr(ci.id)}">Borrar</button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    renderRows();
    $("#cSearch").oninput = renderRows;
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
        if (!confirm("¿Borrar check-in?")) return;
        await dbDel("checkins", b.dataset.id);
        toast("Check-in borrado");
        await refreshState();
        await renderCheckins(viewEl);
      }
    };
  }

  async function renderBackup(viewEl) {
    viewEl.innerHTML = `
      <div class="card">
        <h2>Backup</h2>
        <div class="mini muted">Exporta o importa todos los datos (farmacias, mis farmacias, pedidos, productos, check-ins, ajustes).</div>
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
        version: 1,
        farmacias: await dbAll("farmacias"),
        misFarmacias: await dbAll("misFarmacias"),
        productos: await dbAll("productos"),
        pedidos: await dbAll("pedidos"),
        checkins: await dbAll("checkins"),
        settings: await dbAll("settings"),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_farmacias_${new Date().toISOString().slice(0, 10)}.json`;
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
        try {
          obj = JSON.parse(txt);
        } catch {
          toast("JSON inválido");
          return;
        }

        // import stores
        const tasks = [];
        const putAll = async (store, arr) => {
          if (!Array.isArray(arr)) return;
          for (const x of arr) await dbPut(store, x);
        };

        await putAll("farmacias", obj.farmacias);
        await putAll("misFarmacias", obj.misFarmacias);
        await putAll("productos", obj.productos);
        await putAll("pedidos", obj.pedidos);
        await putAll("checkins", obj.checkins);
        await putAll("settings", obj.settings);

        toast("Backup importado");
        await refreshState();
        render();
      };
      inp.click();
    };
  }

  async function renderAjustes(viewEl) {
    const settings = state.settings;

    // Proponer trimestre actual + siguientes
    const now = new Date();
    const y2 = String(now.getFullYear()).slice(-2);
    const keys = ["1T", "2T", "3T", "4T"].map((q) => q + y2);

    const qNow = quarterKey(now);

    viewEl.innerHTML = `
      <div class="card">
        <h2>Ajustes</h2>
        <div class="mini muted">Objetivos trimestrales y objetivo deseado.</div>
        <div class="hr"></div>

        <form id="prefsForm">
          <h2>Objetivos por trimestre (${y2})</h2>
          <div class="mini muted">Configura el objetivo total de ventas por trimestre. Ej: 1T${y2} → 180.000€</div>

          <div class="grid two">
            ${keys
              .map((k) => {
                const val = Number(settings.quarterlyTargets?.[k] || 0);
                return `
                  <div>
                    <label>${escapeHtml(k)} (objetivo)</label>
                    <input name="qt_${escapeAttr(k)}" type="number" min="0" step="100"
                      value="${escapeAttr(val)}"
                      data-help="Objetivo total de ventas para ${k}. Puedes poner 180000 para 180.000€." />
                  </div>
                `;
              })
              .join("")}
          </div>

          <div class="hr"></div>

          <h2>Objetivo deseado</h2>
          <label>% extra sobre el objetivo del trimestre</label>
          <input name="desiredPct" type="number" min="0" step="0.5"
            value="${Number(settings.desiredPct || 0)}"
            data-help="Esto crea un objetivo deseado adicional: objetivo_trimestre × (1 + %/100). Ej: 10%." />

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

      await saveSetting("quarterlyTargets", qt);
      await saveSetting("desiredPct", desiredPct);

      toast("Ajustes guardados");
      await refreshState();
      render();
    };
  }

  /**********************
   * Dialog flows
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

    if (!f) {
      toast("No encontrada");
      return;
    }

    dlgOpen(
      isNew ? "Alta manual" : "Editar farmacia",
      "Completa los datos principales.",
      `
        <label>Nombre</label>
        <input id="fNombre" value="${escapeAttr(f.nombre || "")}" data-help="Nombre visible de la farmacia (puede ser comercial)." />

        <label>Código</label>
        <input id="fCodigo" value="${escapeAttr(f.codigo || "")}" data-help="Código oficial (si lo tienes). Ej: PO-041-F." />

        <label>Cliente (titular)</label>
        <input id="fCliente" value="${escapeAttr(f.cliente || "")}" data-help="Titular/cliente de la farmacia (titular1 del catálogo)." />

        <label>Teléfono</label>
        <input id="fTel" value="${escapeAttr(f.telefono || "")}" data-help="Teléfono de la farmacia." />

        <label>Concello</label>
        <input id="fConc" value="${escapeAttr(f.concello || "")}" data-help="Concello/ayuntamiento." />

        <label>Código postal</label>
        <input id="fCp" value="${escapeAttr(f.cp || "")}" data-help="Código postal." />

        <label>Dirección</label>
        <input id="fDir" value="${escapeAttr(f.direccion || "")}" data-help="Dirección para Maps y referencia." />

        <div class="grid two">
          <div>
            <label>Lat</label>
            <input id="fLat" value="${escapeAttr(f.lat ?? "")}" data-help="Latitud (opcional)." />
          </div>
          <div>
            <label>Lon</label>
            <input id="fLon" value="${escapeAttr(f.lon ?? "")}" data-help="Longitud (opcional)." />
          </div>
        </div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(f.source || "manual")} · ${escapeHtml(f.id)}</div>
          <div class="right flex">
            <button class="btn" id="fCancel">Cancelar</button>
            <button class="btn-primary" id="fSave">Guardar</button>
          </div>
        </div>
      `
    );

    wireHelp($("#dlgBody"));

    $("#fCancel").onclick = () => dlgClose();
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

      // Si tiene codigo, y el id no sigue el patrón estable, lo dejamos tal cual (manual).
      await dbPut("farmacias", f);
      toast("Farmacia guardada");
      dlgClose();
      await refreshState();
      render();
    };
  }

  async function openFarmaciaDetails(fid) {
    const f = await dbGet("farmacias", fid);
    if (!f) {
      toast("No encontrada");
      return;
    }

    const pedidos = (await dbAll("pedidos"))
      .filter((p) => p.farmaciaId === fid)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const ok = getPedidosOk(pedidos);
    const st = farmaciaStats(fid, ok);
    const nextTxt = st.hasEstimate ? `Próximo estimado: ${fmtDate(st.nextISO)} (media ${Math.round(st.avgDays)} días)` : "Próximo estimado: — (mín. 3 pedidos confirmados)";

    const last = pedidos.slice(0, 10);

    dlgOpen(
      f.nombre || f.codigo || "Farmacia",
      `${f.concello || "—"} · Cliente: ${f.cliente || "—"} · Tel: ${f.telefono || "—"}`,
      `
        <div class="mini muted">
          <b>Código:</b> ${escapeHtml(f.codigo || "—")}<br>
          <b>Dirección:</b> ${escapeHtml(f.direccion || "—")}<br>
          <b>CP:</b> ${escapeHtml(f.cp || "—")}<br>
          <b>Concello:</b> ${escapeHtml(f.concello || "—")}<br>
          <b>Cliente:</b> ${escapeHtml(f.cliente || "—")}<br>
          <b>Teléfono:</b> ${escapeHtml(f.telefono || "—")}<br>
          <div class="hr"></div>
          <b>${escapeHtml(nextTxt)}</b>
        </div>

        <div class="hr"></div>

        <h2>Últimos pedidos</h2>
        ${
          last.length
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
                    ${last
                      .map((p) => {
                        return `
                          <tr>
                            <td>${escapeHtml(fmtDate(p.fecha))}</td>
                            <td><span class="pill ${p.estado === "confirmado" ? "ok" : "warn"}">${escapeHtml(p.estado)}</span></td>
                            <td>${escapeHtml(p.elementos ?? "—")}</td>
                            <td><b>${fmtEur(p.total || 0)}</b></td>
                            <td class="right">
                              <button class="btn btn-xs" data-act="editPedido" data-id="${escapeAttr(p.id)}">Editar</button>
                            </td>
                          </tr>
                        `;
                      })
                      .join("")}
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
          <button class="btn-primary" data-act="checkin">Check-in</button>
          <button class="btn" data-act="editFarm">Editar ficha</button>
        </div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(f.source || "—")}</div>
          <div class="right">
            <button class="btn" id="dlgClose2">Cerrar</button>
          </div>
        </div>
      `
    );

    $("#dlgClose2").onclick = () => dlgClose();

    $("#dlgBody").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;

      const act = b.dataset.act;
      if (act === "maps") {
        const url = mapsLinkForFarmacia(f);
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (act === "checkin") {
        dlgClose();
        openCheckinModal(fid);
        return;
      }
      if (act === "editFarm") {
        dlgClose();
        openFarmaciaEdit(fid);
        return;
      }
      if (act === "editPedido") {
        const pid = b.dataset.id;
        dlgClose();
        openPedidoEdit(pid);
      }
    };
  }

  async function openProductoEdit(id) {
    const isNew = !id;
    const p = isNew
      ? { id: uid(), nombre: "", descripcion: "", creadoEn: nowISO(), actualizadoEn: nowISO() }
      : await dbGet("productos", id);

    if (!p) {
      toast("No encontrado");
      return;
    }

    dlgOpen(
      isNew ? "Nuevo producto" : "Editar producto",
      "Campos básicos (sin coste/IVA/categoría).",
      `
        <label>Nombre</label>
        <input id="pNombre" value="${escapeAttr(p.nombre || "")}" data-help="Nombre del producto." />

        <label>Descripción</label>
        <textarea id="pDesc" data-help="Descripción breve del producto.">${escapeHtml(p.descripcion || "")}</textarea>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
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

    wireHelp($("#dlgBody"));

    $("#pCancel").onclick = () => dlgClose();
    $("#pSave").onclick = async () => {
      p.nombre = ($("#pNombre").value || "").trim();
      p.descripcion = ($("#pDesc").value || "").trim();
      p.actualizadoEn = nowISO();
      await dbPut("productos", p);
      toast("Producto guardado");
      dlgClose();
      await refreshState();
      render();
    };
  }

  async function openPedidoEdit(id) {
    const isNew = !id;

    const farmacias = state.farmacias.slice().sort((a, b) => (a.nombre || a.codigo || "").localeCompare(b.nombre || b.codigo || "", "es"));
    const productos = state.productos.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

    const p = isNew
      ? recomputePedido({
          id: uid(),
          farmaciaId: farmacias[0]?.id || "",
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

    if (!p) {
      toast("Pedido no encontrado");
      return;
    }

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

    dlgOpen(
      isNew ? "Nuevo pedido" : "Editar pedido",
      "Pedido offline por farmacia.",
      `
        <label>Farmacia</label>
        <select id="oFarmSel" data-help="Selecciona la farmacia para este pedido.">
          ${farmacias
            .map((f) => {
              const name = f.nombre || f.codigo || "Farmacia";
              return `<option value="${escapeAttr(f.id)}"${f.id === p.farmaciaId ? " selected" : ""}>${escapeHtml(name)}</option>`;
            })
            .join("")}
        </select>

        <div class="grid two">
          <div>
            <label>Fecha</label>
            <input id="oFecha" type="date" value="${escapeAttr(new Date(p.fecha).toISOString().slice(0, 10))}"
              data-help="Fecha del pedido." />
          </div>
          <div>
            <label>Estado</label>
            <select id="oEstado" data-help="Estado del pedido (confirmado suma a ventas).">
              ${["confirmado", "borrador"].map((s) => `<option${s === p.estado ? " selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid two">
          <div>
            <label>Elementos</label>
            <input id="oElem" type="number" min="0" step="1" value="${escapeAttr(p.elementos || 0)}"
              data-help="Número de productos (elementos) en el pedido (para tus estadísticas)." />
          </div>
          <div>
            <label>Total (calculado)</label>
            <input disabled value="${escapeAttr(fmtEur(p.total || 0))}" />
          </div>
        </div>

        <label>Notas</label>
        <textarea id="oNotas" data-help="Notas internas del pedido.">${escapeHtml(p.notas || "")}</textarea>

        <div class="hr"></div>

        <div class="row">
          <div>
            <h2>Líneas</h2>
            <div class="mini muted">Añade líneas si quieres detalle. Importaciones usan “General”.</div>
          </div>
          <div class="right">
            <button class="btn btn-xs" id="addLine">+ Añadir línea</button>
          </div>
        </div>

        <div id="linesBox" class="list"></div>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(p.id)}</div>
          <div class="right flex">
            <button class="btn" id="oCancel">Cancelar</button>
            <button class="btn-primary" id="oSave">Guardar</button>
          </div>
        </div>
      `
    );

    const linesBox = $("#linesBox");
    function renderLines() {
      p.lineas = Array.isArray(p.lineas) ? p.lineas : [];
      recomputePedido(p);
      linesBox.innerHTML = p.lineas.length ? p.lineas.map(buildLineRow).join("") : `<div class="muted">—</div>`;
      // actualizar total (input disabled)
      const totalInput = $$("input[disabled]", $("#dlgBody")).find((x) => (x.value || "").includes("€"));
      // (no lo tocamos, es informativo)
    }

    renderLines();
    wireHelp($("#dlgBody"));

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

    $("#addLine").onclick = () => openLineEdit(p, null, productos, renderLines);

    $("#dlgBody").onclick = (e) => {
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
        return;
      }
    };
  }

  function openLineEdit(pedido, idx, productos, onDone) {
    const isNew = idx == null;
    const l = isNew
      ? { id: uid(), productoId: productos[0]?.id || "", nombre: productos[0]?.nombre || "", cantidad: 1, precioUnit: 0, descuentoPct: 0, total: 0 }
      : { ...pedido.lineas[idx] };

    dlgOpen(
      isNew ? "Nueva línea" : "Editar línea",
      "Detalle de producto en el pedido.",
      `
        <label>Producto</label>
        <select id="lProd" data-help="Producto de esta línea.">
          ${productos
            .map((pr) => `<option value="${escapeAttr(pr.id)}"${pr.id === l.productoId ? " selected" : ""}>${escapeHtml(pr.nombre)}</option>`)
            .join("")}
        </select>

        <div class="grid two">
          <div>
            <label>Cantidad</label>
            <input id="lQty" type="number" min="0" step="1" value="${escapeAttr(l.cantidad)}" data-help="Cantidad vendida." />
          </div>
          <div>
            <label>Precio unitario</label>
            <input id="lPU" type="number" min="0" step="0.01" value="${escapeAttr(l.precioUnit)}" data-help="Precio unitario." />
          </div>
        </div>

        <label>Descuento (%)</label>
        <input id="lDto" type="number" min="0" step="0.5" value="${escapeAttr(l.descuentoPct || 0)}" data-help="Descuento porcentual en esta línea." />

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">Total se recalcula al guardar</div>
          <div class="right flex">
            <button class="btn" id="lCancel">Cancelar</button>
            <button class="btn-primary" id="lSave">Guardar</button>
          </div>
        </div>
      `
    );

    wireHelp($("#dlgBody"));

    $("#lCancel").onclick = () => dlgClose();
    $("#lSave").onclick = () => {
      const pid = ($("#lProd").value || "").trim();
      const pr = productos.find((x) => x.id === pid);
      l.productoId = pid;
      l.nombre = pr?.nombre || "Producto";
      l.cantidad = Math.max(0, Number($("#lQty").value || 0));
      l.precioUnit = Math.max(0, Number($("#lPU").value || 0));
      l.descuentoPct = Math.max(0, Number($("#lDto").value || 0));

      // write back
      if (isNew) pedido.lineas.push(l);
      else pedido.lineas[idx] = l;

      recomputePedido(pedido);
      dlgClose();
      onDone?.();
    };
  }

  async function openCheckinModal(fid) {
    const f = await dbGet("farmacias", fid);
    if (!f) {
      toast("No encontrada");
      return;
    }

    dlgOpen(
      "Check-in",
      `${f.nombre || f.codigo || "Farmacia"} · ${f.concello || "—"}`,
      `
        <div class="mini muted">Registra visita y, si quieres, crea un pedido rápido.</div>
        <div class="hr"></div>

        <label>Notas del check-in</label>
        <textarea id="ciNotas" data-help="Notas de la visita: motivos, feedback, acciones, etc."></textarea>

        <label>Crear pedido rápido (opcional)</label>
        <div class="grid two">
          <div>
            <label>Total (€)</label>
            <input id="ciTotal" type="number" min="0" step="0.01" value="" data-help="Si metes un total, se creará un pedido con línea General." />
          </div>
          <div>
            <label>Elementos</label>
            <input id="ciElems" type="number" min="0" step="1" value="0" data-help="Número de elementos (para tus estadísticas)." />
          </div>
        </div>

        <label>Estado del pedido (si se crea)</label>
        <select id="ciEstado" data-help="Si creas pedido, confirmado suma a ventas.">
          <option value="confirmado">confirmado</option>
          <option value="borrador">borrador</option>
        </select>

        <div class="helpbox mini muted" data-helpbox>Selecciona un campo para ver ayuda.</div>
      `,
      `
        <div class="row">
          <div class="mini muted">${escapeHtml(nowISO())}</div>
          <div class="right flex">
            <button class="btn" id="ciCancel">Cancelar</button>
            <button class="btn-primary" id="ciSave">Guardar</button>
          </div>
        </div>
      `
    );

    wireHelp($("#dlgBody"));

    $("#ciCancel").onclick = () => dlgClose();
    $("#ciSave").onclick = async () => {
      const notas = ($("#ciNotas").value || "").trim();
      const total = Number(($("#ciTotal").value || "").trim() || 0);
      const elems = Math.max(0, Number($("#ciElems").value || 0));
      const est = ($("#ciEstado").value || "confirmado").trim();

      // checkin
      const ci = {
        id: uid(),
        farmaciaId: fid,
        fecha: nowISO(),
        notas,
      };
      await dbPut("checkins", ci);

      // pedido rápido si hay total
      if (total > 0) {
        const gen = await ensureProductoGeneral();
        const pedido = recomputePedido({
          id: uid(),
          farmaciaId: fid,
          fecha: nowISO(),
          estado: est,
          elementos: elems,
          notas: `Pedido rápido desde check-in. ${notas ? "Notas: " + notas : ""}`.trim(),
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

      toast("Check-in guardado");
      dlgClose();
      await refreshState();
      render();
    };
  }

  /**********************
   * Render dispatcher
   **********************/
  async function render() {
    const viewEl = $("#view");
    if (!viewEl) return;

    // top home
    $("#btnHome").onclick = () => setView("dash");

    if (state.view === "dash") return renderDashboard(viewEl);
    if (state.view === "predicciones") return renderPredicciones(viewEl);
    if (state.view === "farmacias") return renderFarmacias(viewEl);
    if (state.view === "pedidos") return renderPedidos(viewEl);
    if (state.view === "productos") return renderProductos(viewEl);
    if (state.view === "rutas") return renderRutas(viewEl);
    if (state.view === "checkins") return renderCheckins(viewEl);
    if (state.view === "backup") return renderBackup(viewEl);
    if (state.view === "ajustes") return renderAjustes(viewEl);

    // fallback
    viewEl.innerHTML = `<div class="card"><h2>Vista no encontrada</h2></div>`;
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
   * Dialog close wiring
   **********************/
  function wireDialogClose() {
    $("#dlgClose").onclick = () => dlgClose();
    $("#dlg").addEventListener("cancel", (e) => {
      e.preventDefault();
      dlgClose();
    });
  }

  /**********************
   * Seed (opcional)
   **********************/
  async function seedIfEmpty() {
    const farms = await dbAll("farmacias");
    if (farms.length) return;

    // demo mínima
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
