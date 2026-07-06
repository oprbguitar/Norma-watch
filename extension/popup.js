// ============================================================
// Norma Watch Perú — popup principal
// Autor: Pierre R. — peru.labs.pe@gmail.com
// ============================================================
const $ = (id) => document.getElementById(id);

let detectadas = [];
let resumenes = [];
let config = {};
let resultadosBusqueda = [];   // resultados de la última búsqueda
let analisisBusqueda = "";     // análisis IA de la búsqueda
let ultimoResultadoHerr = null; // { titulo, texto } de la herramienta IA
let herrPendiente = null;      // herramienta que espera desbloqueo

const normalizar = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sinTagsHtml = (s) => { const d = document.createElement("div"); d.innerHTML = s || ""; return d.textContent.replace(/\s+/g, " ").trim(); };

init();

async function init() {
  const store = await chrome.storage.local.get(["detectadas", "resumenes", "config", "ultimaRevision", "ultimoError"]);
  detectadas = store.detectadas || [];
  resumenes = store.resumenes || [];
  config = store.config || {};
  // selector de años (2001 → actual)
  const anioActual = new Date().getFullYear();
  for (const sel of [$("selAnioDesde"), $("selAnioHasta")]) {
    if (sel.options.length) continue;
    for (let a = anioActual; a >= 2001; a--) {
      const op = document.createElement("option");
      op.value = a; op.textContent = a;
      sel.appendChild(op);
    }
  }
  $("selAnioDesde").value = anioActual - 1;
  $("selAnioHasta").value = anioActual;

  await refrescarLicenciaUI();
  renderNormas();
  renderResumenes();
  renderNotaMonitoreo(store.ultimaRevision, store.ultimoError);
  chrome.action.setBadgeText({ text: "" });
}

async function refrescarLicenciaUI() {
  const est = await estadoLicencia();
  const chip = $("chipLicencia");
  chip.textContent = est.texto;
  chip.classList.toggle("premium", est.premium);
  const restantes = await busquedasRestantes();
  $("contadorBusquedas").textContent = est.premium
    ? "⭐ Búsquedas ilimitadas (Premium)"
    : `Búsquedas gratuitas restantes hoy: ${restantes} de ${LIMITE_BUSQUEDAS_DIA}`;
  document.querySelectorAll(".candado:not(.libre)").forEach((c) => {
    c.textContent = est.premium ? "⭐ Activo" : "🔒 Premium";
    c.classList.toggle("desbloqueado", est.premium);
  });
}

function renderNotaMonitoreo(ultimaRevision, ultimoError) {
  const partes = [];
  if (ultimaRevision) partes.push(`Última revisión automática: ${new Date(ultimaRevision).toLocaleString("es-PE")}`);
  partes.push(`Palabras clave vigiladas: ${(config.keywords || []).join(", ") || "— (configúrelas en ⚙️)"}`);
  if (ultimoError) partes.push(`⚠️ ${ultimoError}`);
  $("notaMonitoreo").textContent = partes.join(" · ");
}

// ---------------- navegación ----------------
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("activa"));
    b.classList.add("activa");
    for (const t of ["buscar", "monitoreo", "herramientas", "guia"])
      $("tab-" + t).hidden = b.dataset.tab !== t;
  })
);
document.querySelectorAll(".subtab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".subtab").forEach((x) => x.classList.remove("activa"));
    b.classList.add("activa");
    $("vistaNormas").hidden = b.dataset.vista !== "normas";
    $("vistaResumenes").hidden = b.dataset.vista !== "resumenes";
  })
);
$("btnOpciones").addEventListener("click", () => chrome.runtime.openOptionsPage());

function estado(msg, clase = "") {
  const e = $("estado");
  e.hidden = !msg;
  e.textContent = msg || "";
  e.className = "estado " + clase;
}

// ============================================================
// 🔎 BÚSQUEDA (Legal Search Perú)
// ============================================================
$("btnBuscarNorma").addEventListener("click", buscarNormas);
$("txtBuscar").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarNormas(); });

function fechaMs(f) {
  const m = (f || "").match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
}

const aPeruanoFmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const aUSFmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const aGobPeFmt = (d) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

async function buscarNormas() {
  const term = $("txtBuscar").value.trim();
  if (!term) return estado("Escriba un tema o norma para buscar (ej.: teletrabajo).", "error");

  const gate = await consumirBusqueda();
  if (!gate.ok) { estado("🔒 " + gate.error, "error"); abrirModalPremium("Búsquedas ilimitadas"); return; }

  const modoAnios = document.querySelector('input[name="modoRango"]:checked').value === "anios";
  const fuente = $("selFuente").value;
  let desde, hasta;
  if (modoAnios) {
    let a1 = parseInt($("selAnioDesde").value, 10), a2 = parseInt($("selAnioHasta").value, 10);
    if (a1 > a2) [a1, a2] = [a2, a1];
    desde = new Date(a1, 0, 1);
    hasta = new Date(Math.min(Date.now(), new Date(a2, 11, 31).getTime()));
  } else {
    hasta = new Date();
    desde = new Date(Date.now() - parseInt($("selDias").value, 10) * 86400000);
  }

  const b = $("btnBuscarNorma");
  b.disabled = true;
  estado("🔎 Buscando «" + term + "»…");
  $("resBusqueda").hidden = true;
  analisisBusqueda = "";
  $("panelAnalisis").hidden = true;

  try {
    const tareas = [];
    // El Peruano no admite rangos de años: solo se usa en modo días
    if (!modoAnios && (fuente === "ambas" || fuente === "elperuano")) tareas.push(buscarElPeruano(term, desde, hasta));
    if (fuente === "ambas" || fuente === "gobpe" || modoAnios) tareas.push(buscarGobPe(term, desde, hasta));

    const resultados = await Promise.allSettled(tareas);
    const errores = resultados.filter((r) => r.status === "rejected").map((r) => r.reason?.message);
    resultadosBusqueda = resultados.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);

    // dedupe por título normalizado
    const yaVisto = new Set();
    resultadosBusqueda = resultadosBusqueda.filter((n) => {
      const k = normalizar(n.titulo);
      if (yaVisto.has(k)) return false;
      yaVisto.add(k);
      return true;
    });

    // filtro estricto: todas las palabras del término deben aparecer
    // (así "ministerio público" no trae resultados de otras entidades)
    const q = normalizar(term).split(/\s+/).filter((w) => w.length > 2 || /^\d+$/.test(w));
    resultadosBusqueda = resultadosBusqueda.filter((n) => {
      const pajar = normalizar(`${n.entidad} ${n.titulo} ${n.sumilla}`);
      return q.every((w) => pajar.includes(w));
    });

    // orden: del más reciente al más antiguo
    resultadosBusqueda.sort((a, b) => fechaMs(b.fecha) - fechaMs(a.fecha));

    renderBusqueda(term);
    const msg = `✅ ${resultadosBusqueda.length} resultado(s) para «${term}».` + (errores.length ? `\n⚠️ Una fuente falló: ${errores.join("; ")}` : "");
    estado(msg, errores.length ? "" : "ok");
    await refrescarLicenciaUI();
  } catch (e) {
    estado("⚠️ Error en la búsqueda: " + e.message, "error");
  } finally {
    b.disabled = false;
  }
}

// --- fuente 1: El Peruano (diario oficial), por bloques de máx. 15 días ---
async function buscarElPeruano(term, desde, hasta) {
  const bloques = [];
  let cursor = new Date(desde);
  while (cursor < hasta) {
    const fin = new Date(Math.min(hasta.getTime(), cursor.getTime() + 14 * 86400000));
    bloques.push([new Date(cursor), fin]);
    cursor = new Date(fin.getTime() + 86400000);
  }
  const listas = await Promise.all(bloques.map(async ([d1, d2]) => {
    const url = "https://diariooficial.elperuano.pe/Normas/Filtro?dateparam=" + encodeURIComponent(aUSFmt(d2) + " 00:00:00");
    const resp = await fetch(url, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      body: new URLSearchParams({ cddesde: aPeruanoFmt(d1), cdhasta: aPeruanoFmt(d2) })
    });
    if (!resp.ok) throw new Error("El Peruano HTTP " + resp.status);
    return parsearElPeruano(await resp.text());
  }));
  const q = normalizar(term).split(/\s+/).filter((w) => w.length > 2 || /^\d+$/.test(w));
  return listas.flat().filter((n) => {
    const pajar = normalizar(`${n.entidad} ${n.titulo} ${n.sumilla}`);
    return q.every((w) => pajar.includes(w));
  });
}

function parsearElPeruano(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("article.edicionesoficiales_articulos")].map((art, idx) => {
    const entidad = art.querySelector("h4")?.textContent.trim() || "SIN ENTIDAD";
    const a = art.querySelector("h5 a");
    const titulo = a?.textContent.trim() || "Norma sin título";
    let urlFicha = a?.getAttribute("href") || "";
    if (urlFicha && !urlFicha.startsWith("http")) urlFicha = "https://diariooficial.elperuano.pe" + urlFicha;
    const id = urlFicha.split("/").pop() || "n" + idx;
    let fecha = "", sumilla = "";
    art.querySelectorAll(".ediciones_texto p, p").forEach((p) => {
      const t = p.textContent.trim();
      const m = t.match(/Fecha\s*:\s*(\d{2}\/\d{2}\/\d{4})/);
      if (m) fecha = m[1];
      else if (t && !sumilla) sumilla = t;
    });
    let urlPdf = "";
    if (fecha && /^\d+-\d+$/.test(id)) {
      const [d, m, y] = fecha.split("/");
      urlPdf = "https://epdoc2.elperuano.pe/EpPo/DescargaIN.asp?Referencias=" + btoa(id.replace("-", "_") + y + m + d);
    }
    return { entidad, titulo, sumilla, fecha, urlFicha, urlPdf, fuente: "El Peruano" };
  });
}

// --- fuente 2: gob.pe (buscador oficial del Estado, admite años) ---
async function buscarGobPe(term, desde, hasta) {
  const paginas = [1, 2, 3]; // hasta 75 resultados
  const resultados = [];
  for (const p of paginas) {
    const url =
      "https://www.gob.pe/busquedas.json?contenido%5B%5D=normas&term=" + encodeURIComponent(term) +
      "&desde=" + aGobPeFmt(desde) + "&hasta=" + aGobPeFmt(hasta) + (p > 1 ? "&sheet=" + p : "");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("gob.pe HTTP " + resp.status);
    const data = await resp.json();
    const items = data?.data?.attributes?.results || [];
    for (const r of items) {
      const href = (r.url || "").match(/href="([^"]+)"/)?.[1] || "";
      resultados.push({
        entidad: sinTagsHtml(r.content_sub_title_card) || "Entidad del Estado",
        titulo: sinTagsHtml(r.url) || r.name_with_parent || "Norma",
        sumilla: sinTagsHtml(r.content) || sinTagsHtml(r.subject),
        fecha: r.publication || "",
        urlFicha: href ? "https://www.gob.pe" + href : "",
        urlPdf: r.action_url || "",
        fuente: "gob.pe"
      });
    }
    if (items.length < 25) break; // no hay más páginas
  }
  return resultados;
}

function renderBusqueda(term) {
  $("resBusqueda").hidden = false;
  $("lblResultados").textContent = `📑 ${resultadosBusqueda.length} resultado(s) para «${term}»`;
  const lista = $("listaBusqueda");
  lista.innerHTML = resultadosBusqueda.length ? "" : '<p class="vacio">Sin resultados. Pruebe con otras palabras o amplíe el periodo.</p>';
  resultadosBusqueda.forEach((n) => lista.appendChild(tarjetaNorma(n)));
}

function tarjetaNorma(n, marcarNueva = false) {
  const div = document.createElement("div");
  div.className = "norma" + (marcarNueva ? " nueva" : "");
  div.innerHTML = `
    <div class="norma-entidad"></div>
    <div class="norma-titulo"><a target="_blank" rel="noopener"></a></div>
    <div class="norma-sumilla"></div>
    <div class="norma-pie">
      <span class="fuente-badge"></span>
      ${(n.keywords || []).map(() => '<span class="kw"></span>').join("")}
      <span>📅 ${n.fecha || "s/f"}</span>
      <span class="enlaces">
        ${n.urlFicha ? '<a class="ficha" target="_blank" rel="noopener">Ficha</a>' : ""}
        ${n.urlPdf ? '<a class="pdf" target="_blank" rel="noopener">PDF</a>' : ""}
      </span>
    </div>`;
  div.querySelector(".norma-entidad").textContent = n.entidad;
  const a = div.querySelector(".norma-titulo a");
  a.textContent = n.titulo;
  a.href = n.urlFicha || n.urlPdf || "#";
  div.querySelector(".norma-sumilla").textContent = n.sumilla || "";
  div.querySelector(".fuente-badge").textContent = "🏛️ " + (n.fuente || "El Peruano");
  div.querySelectorAll(".kw").forEach((el, i) => (el.textContent = n.keywords[i]));
  const fi = div.querySelector("a.ficha"); if (fi) fi.href = n.urlFicha;
  const pd = div.querySelector("a.pdf"); if (pd) pd.href = n.urlPdf;
  return div;
}

// --- exportación de resultados de búsqueda ---
document.querySelectorAll("[data-exp]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!resultadosBusqueda.length) return estado("No hay resultados para exportar.", "error");
    exportarDataset(b.dataset.exp, {
      titulo: `Búsqueda: ${$("txtBuscar").value.trim()}`,
      subtitulo: `Norma Watch Perú · ${new Date().toLocaleString("es-PE")} · ${resultadosBusqueda.length} resultado(s)`,
      normas: resultadosBusqueda,
      analisis: analisisBusqueda || undefined
    });
  })
);

// --- análisis IA de resultados (premium) ---
$("btnAnalisisIA").addEventListener("click", async () => {
  if (!(await esPremium())) return abrirModalPremium("Análisis IA de resultados de búsqueda");
  if (!resultadosBusqueda.length) return estado("Primero realice una búsqueda.", "error");
  const b = $("btnAnalisisIA");
  b.disabled = true;
  estado("✨ Analizando y contrastando resultados con IA…");
  try {
    const lista = resultadosBusqueda.slice(0, 30)
      .map((n, i) => `${i + 1}. [${n.fuente}] ${n.entidad}: ${n.titulo}. ${n.sumilla} (${n.fecha}) ${n.urlFicha}`)
      .join("\n");
    const prompt =
      `Eres ${perfilIA(config)}. El usuario buscó: «${$("txtBuscar").value.trim()}».\n` +
      `Sé BREVE y directo: usa viñetas cortas, sin párrafos largos.\n` +
      `Analiza y CONTRASTA los siguientes resultados (no solo los resumas):\n` +
      `1) Ordena los 5 más relevantes para la búsqueda y explica por qué.\n` +
      `2) Indica qué ministerio/entidad emite cada norma relevante, qué autoriza, resuelve o modifica, y su fecha.\n` +
      `3) Señala diferencias o relaciones entre las normas (cuál amplía, deroga o complementa a cuál, si aplica).\n` +
      `4) Cierra con "Recomendación práctica" en 2-3 líneas en lenguaje sencillo para alguien no técnico.\n` +
      `Usa español claro. No inventes normas que no estén en la lista.\n\nRESULTADOS:\n${lista}`;
    analisisBusqueda = await llamarIA(config, prompt);
    $("txtAnalisis").textContent = analisisBusqueda;
    $("panelAnalisis").hidden = false;
    estado("✅ Análisis IA generado.", "ok");
  } catch (e) {
    estado("⚠️ " + e.message, "error");
  } finally {
    b.disabled = false;
  }
});

// ============================================================
// 📡 MONITOREO
// ============================================================
$("filtro").addEventListener("input", renderNormas);

function normasVisibles() {
  const q = normalizar($("filtro").value.trim());
  if (!q) return detectadas;
  return detectadas.filter((n) =>
    q.split(/\s+/).every((p) => normalizar(`${n.entidad} ${n.titulo} ${n.sumilla} ${(n.keywords || []).join(" ")}`).includes(p))
  );
}

function renderNormas() {
  const lista = $("listaNormas");
  lista.innerHTML = "";
  const visibles = normasVisibles();
  $("vacioNormas").hidden = detectadas.length > 0;
  const hace24h = Date.now() - 86400000;
  visibles.forEach((n) => lista.appendChild(tarjetaNorma(n, n.detectadoEn > hace24h)));
  if (detectadas.length && !visibles.length) lista.innerHTML = '<p class="vacio">Sin coincidencias para ese filtro.</p>';
}

function renderResumenes() {
  const lista = $("listaResumenes");
  lista.innerHTML = "";
  $("vacioResumenes").hidden = resumenes.length > 0;
  resumenes.forEach((r) => {
    const div = document.createElement("div");
    div.className = "resumen";
    div.innerHTML = `<h3></h3><pre></pre>`;
    div.querySelector("h3").textContent = `📋 ${r.fecha} — ${r.cantidad} norma(s)`;
    div.querySelector("pre").textContent = r.texto;
    lista.appendChild(div);
  });
}

$("btnRevisar").addEventListener("click", async () => {
  const b = $("btnRevisar");
  b.disabled = true;
  estado("Consultando El Peruano…");
  const r = await chrome.runtime.sendMessage({ tipo: "revisarAhora" });
  b.disabled = false;
  if (r?.ok) { estado("✅ Barrido completado.", "ok"); await init(); }
  else estado("⚠️ " + (r?.error || "Error desconocido"), "error");
});

$("btnResumen").addEventListener("click", async () => {
  if (!(await esPremium())) return abrirModalPremium("Resumen ejecutivo diario con IA");
  const b = $("btnResumen");
  b.disabled = true;
  estado("✨ Generando resumen con IA…");
  const r = await chrome.runtime.sendMessage({ tipo: "generarResumen" });
  b.disabled = false;
  if (r?.ok) {
    estado("✅ Resumen generado.", "ok");
    await init();
    document.querySelector('[data-vista="resumenes"]').click();
  } else estado("⚠️ " + (r?.error || "Error desconocido"), "error");
});

document.querySelectorAll("[data-expmon]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!detectadas.length) return estado("No hay normas detectadas para exportar.", "error");
    exportarDataset(b.dataset.expmon, {
      titulo: "Normas detectadas por monitoreo",
      subtitulo: `Norma Watch Perú · ${new Date().toLocaleString("es-PE")} · Palabras clave: ${(config.keywords || []).join(", ")}`,
      normas: detectadas,
      analisis: resumenes[0]?.texto
    });
  })
);

// ============================================================
// 🧰 HERRAMIENTAS IA
// ============================================================
const TITULOS_HERR = {
  interprete: "🔍 Interpretador de Normas",
  timeline: "📅 Línea de Tiempo Legal",
  comparador: "⚔️ Comparador Legal IA"
};

document.querySelectorAll(".card").forEach((c) =>
  c.addEventListener("click", async () => {
    const herr = c.dataset.herr;
    if (herr === "buscarinfo") { document.querySelector('[data-tab="buscar"]').click(); return; }
    if (!(await esPremium())) { herrPendiente = herr; return abrirModalPremium(TITULOS_HERR[herr]); }
    abrirHerramienta(herr);
  })
);

function abrirHerramienta(herr) {
  $("menuHerramientas").hidden = true;
  $("vistaHerramienta").hidden = false;
  $("tituloHerr").textContent = TITULOS_HERR[herr];
  for (const h of ["interprete", "timeline", "comparador"]) $("herr-" + h).hidden = h !== herr;
  $("resultadoHerr").hidden = true;
}

$("btnVolverHerr").addEventListener("click", () => {
  $("menuHerramientas").hidden = false;
  $("vistaHerramienta").hidden = true;
});

// --- leer texto de la pestaña activa ---
async function leerPestanaActiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about):/.test(tab.url || "")) throw new Error("Abra la norma en una pestaña web normal (no funciona en páginas internas de Chrome).");
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body.innerText.slice(0, 28000)
  });
  const texto = (res?.result || "").trim();
  if (texto.length < 100) throw new Error("No se pudo leer suficiente texto de la pestaña. Copie y pegue el texto de la norma.");
  return texto;
}

$("btnLeerPestana").addEventListener("click", async () => {
  try { $("txtInterprete").value = await leerPestanaActiva(); estado("✅ Texto leído de la pestaña actual.", "ok"); }
  catch (e) { estado("⚠️ " + e.message, "error"); }
});
$("btnLeerPestanaTl").addEventListener("click", async () => {
  try { $("txtTimeline").value = await leerPestanaActiva(); estado("✅ Texto leído de la pestaña actual.", "ok"); }
  catch (e) { estado("⚠️ " + e.message, "error"); }
});

async function ejecutarHerramienta(boton, tituloResultado, prompt, { esTimeline = false } = {}) {
  boton.disabled = true;
  estado("✨ Trabajando con IA… esto puede tardar unos segundos.");
  try {
    const respuesta = await llamarIA(config, prompt, { maxTokens: 4000 });
    $("resultadoHerr").hidden = false;
    $("tituloResultadoHerr").textContent = tituloResultado;
    $("lineaTiempo").hidden = true;
    $("lineaTiempo").innerHTML = "";
    let textoFinal = respuesta;

    if (esTimeline) {
      const hitos = parsearTimeline(respuesta);
      if (hitos) {
        renderTimeline(hitos);
        textoFinal = hitos.map((h) => `${h.fecha} — ${h.evento}${h.detalle ? ": " + h.detalle : ""}`).join("\n");
      }
    }
    $("txtResultadoHerr").textContent = textoFinal;
    ultimoResultadoHerr = { titulo: tituloResultado, texto: textoFinal };
    estado("✅ Listo.", "ok");
  } catch (e) {
    estado("⚠️ " + e.message, "error");
  } finally {
    boton.disabled = false;
  }
}

function parsearTimeline(respuesta) {
  try {
    const json = respuesta.match(/\[[\s\S]*\]/);
    if (!json) return null;
    const arr = JSON.parse(json[0]);
    if (!Array.isArray(arr) || !arr.length || !arr[0].fecha) return null;
    return arr;
  } catch { return null; }
}

function renderTimeline(hitos) {
  const cont = $("lineaTiempo");
  cont.hidden = false;
  hitos.forEach((h) => {
    const div = document.createElement("div");
    div.className = "hito";
    div.innerHTML = `<div class="hito-fecha"></div><div class="hito-cuerpo"><b></b><span></span></div>`;
    div.querySelector(".hito-fecha").textContent = h.fecha || "s/f";
    div.querySelector("b").textContent = h.evento || "";
    div.querySelector("span").textContent = h.detalle || "";
    cont.appendChild(div);
  });
}

$("btnInterpretar").addEventListener("click", () => {
  const texto = $("txtInterprete").value.trim();
  if (texto.length < 80) return estado("Pegue el texto de la norma (o léalo desde la pestaña).", "error");
  ejecutarHerramienta(
    $("btnInterpretar"),
    "🔍 Interpretación de la norma",
    `Eres ${perfilIA(config)}. Interpreta la siguiente norma para un lector NO técnico y responde en español, BREVE y en viñetas cortas, con estas secciones:\n\n` +
    `📌 ¿QUÉ ES Y QUÉ BUSCA? (2-3 líneas)\n👥 ¿A QUIÉN APLICA? (sujetos obligados y beneficiarios)\n📋 OBLIGACIONES PRINCIPALES (lista numerada)\n⏰ PLAZOS Y VIGENCIA (fechas concretas si las hay)\n⚠️ SANCIONES E INCUMPLIMIENTO\n🎯 RIESGOS Y RECOMENDACIONES PRÁCTICAS (máx. 3 puntos)\n\n` +
    `Si algún dato no aparece en el texto, di "No se especifica en el texto". No inventes.\n\nTEXTO DE LA NORMA:\n${texto}`
  );
});

$("btnGenerarTimeline").addEventListener("click", () => {
  const texto = $("txtTimeline").value.trim();
  if (texto.length < 80) return estado("Pegue el texto de la norma o expediente.", "error");
  ejecutarHerramienta(
    $("btnGenerarTimeline"),
    "📅 Línea de tiempo legal",
    `Analiza el siguiente texto legal peruano y extrae su línea de tiempo: publicación, entrada en vigencia, plazos, hitos, modificaciones, disposiciones transitorias y vencimientos.\n` +
    `Responde ÚNICAMENTE con un arreglo JSON válido, sin texto adicional, con este formato:\n` +
    `[{"fecha":"DD/MM/AAAA o descripción del plazo","evento":"título corto del hito","detalle":"explicación en una frase"}]\n` +
    `Ordena cronológicamente. Si una fecha es relativa (ej. "30 días hábiles desde su publicación"), úsala tal cual en "fecha".\n\nTEXTO:\n${texto}`,
    { esTimeline: true }
  );
});

$("btnComparar").addEventListener("click", () => {
  const a = $("txtNormaA").value.trim(), b = $("txtNormaB").value.trim();
  if (a.length < 80 || b.length < 80) return estado("Pegue ambas normas (o versiones) para comparar.", "error");
  ejecutarHerramienta(
    $("btnComparar"),
    "⚔️ Comparación legal",
    `Eres ${perfilIA(config)}. Compara las dos normas (o versiones de una misma norma) siguientes y explica los cambios relevantes ARTÍCULO POR ARTÍCULO en español claro y BREVE (viñetas, sin relleno):\n\n` +
    `Para cada artículo o sección que cambie: indica el número/nombre, qué decía antes (versión A), qué dice ahora (versión B) y el impacto práctico del cambio.\n` +
    `Luego lista: artículos NUEVOS, artículos DEROGADOS/ELIMINADOS y artículos SIN CAMBIOS relevantes (solo enumerar).\n` +
    `Cierra con "Conclusión para el usuario" en 3 líneas sencillas.\nNo inventes contenido que no esté en los textos.\n\n` +
    `===== VERSIÓN A =====\n${a}\n\n===== VERSIÓN B =====\n${b}`
  );
});

document.querySelectorAll("[data-expherr]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!ultimoResultadoHerr) return estado("Aún no hay resultado para exportar.", "error");
    exportarDataset(b.dataset.expherr, expTextoDataset(ultimoResultadoHerr.titulo.replace(/^[^\w]*\s*/, ""), ultimoResultadoHerr.texto));
  })
);

// ============================================================
// ⭐ MODAL PREMIUM
// ============================================================
function abrirModalPremium(nombreFuncion) {
  $("modalDetalle").textContent = `«${nombreFuncion}» es una función Premium. Actívela con su código de licencia o solicítelo al autor.`;
  $("msgLicencia").textContent = "";
  $("modalPremium").hidden = false;
}
$("btnCerrarModal").addEventListener("click", () => { $("modalPremium").hidden = true; herrPendiente = null; });

$("btnActivar").addEventListener("click", async () => {
  const r = await activarLicencia($("txtCodigo").value);
  const m = $("msgLicencia");
  if (r.ok) {
    m.textContent = "✅ ¡Premium activado! Todas las funciones IA están disponibles.";
    m.style.color = "#16a34a";
    await refrescarLicenciaUI();
    setTimeout(() => {
      $("modalPremium").hidden = true;
      if (herrPendiente) { abrirHerramienta(herrPendiente); herrPendiente = null; }
    }, 900);
  } else {
    m.textContent = "❌ " + r.error;
    m.style.color = "#dc2626";
  }
});


// ============================================================
// 📋 COPIAR RESULTADOS DE IA
// ============================================================
async function copiarTexto(texto) {
  if (!texto) return estado("No hay texto para copiar.", "error");
  await navigator.clipboard.writeText(texto);
  estado("📋 Copiado al portapapeles.", "ok");
}
$("btnCopiarAnalisis").addEventListener("click", () => copiarTexto(analisisBusqueda));
$("btnCopiarHerr").addEventListener("click", () => copiarTexto(ultimoResultadoHerr?.texto));

// ============================================================
// 📌 FIJAR AL COSTADO DEL NAVEGADOR (panel lateral)
// ============================================================
$("btnFijar").addEventListener("click", async () => {
  try {
    if (!chrome.sidePanel?.open) throw new Error("Su navegador no soporta el panel lateral (requiere Chrome 116 o superior).");
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch (e) {
    estado("⚠️ " + e.message, "error");
  }
});

// cerrar el modal Premium tocando fuera de la caja (se sigue usando la versión básica)
$("modalPremium").addEventListener("click", (e) => {
  if (e.target === $("modalPremium")) { $("modalPremium").hidden = true; herrPendiente = null; }
});
