// ================= Norma Watch Perú — reporte imprimible / exportable =================
const $ = (id) => document.getElementById(id);
let soloRecientes = true;
let detectadas = [];
let resumenes = [];
let config = {};
let datasetExterno = null; // dataset de exportación (búsquedas, herramientas IA)

init();

async function init() {
  const params = new URLSearchParams(location.search);
  const store = await chrome.storage.local.get(["detectadas", "resumenes", "config", "exportData"]);
  detectadas = store.detectadas || [];
  resumenes = store.resumenes || [];
  config = store.config || {};
  if (params.get("vista") === "export" && store.exportData) {
    datasetExterno = store.exportData;
    $("btnTodo").style.display = "none"; // el dataset ya viene definido
  }
  render();
}

function datasetActual() {
  if (datasetExterno) return datasetExterno;
  const hace24h = Date.now() - 86400000;
  const recientes = soloRecientes ? detectadas.filter((n) => n.detectadoEn > hace24h) : detectadas;
  const base = soloRecientes && !recientes.length ? detectadas : recientes;
  return {
    titulo: "Normas detectadas por monitoreo",
    subtitulo: `Reporte del ${new Date().toLocaleString("es-PE")} · Palabras clave: ${(config.keywords || []).join(", ") || "—"}`,
    normas: base,
    analisis: resumenes[0]?.texto
  };
}

function render() {
  const d = datasetActual();
  document.title = `${d.titulo} — Norma Watch Perú`;
  document.querySelector("h1").textContent = "⚖️ " + d.titulo;
  $("meta").textContent = `${d.subtitulo || ""} · ${d.normas.length} norma(s)`;

  if (d.analisis) {
    $("secResumen").hidden = false;
    $("resumenIa").textContent = d.analisis;
  } else {
    $("secResumen").hidden = true;
  }

  $("tituloNormas").textContent = datasetExterno
    ? "📑 Resultados"
    : soloRecientes
      ? "📑 Normas detectadas (últimas 24 h; si no hay, historial)"
      : "📑 Normas detectadas (historial completo)";

  const lista = $("listaNormas");
  lista.innerHTML = d.normas.length ? "" : (d.analisis ? "" : '<p class="vacio">Sin normas para mostrar.</p>');

  d.normas.forEach((n) => {
    const div = document.createElement("div");
    div.className = "norma";
    div.innerHTML = `
      <div class="entidad"></div>
      <div class="titulo"></div>
      <div class="sumilla"></div>
      <div class="pie"><span class="kws"></span> 📅 <span class="fecha"></span> · 🏛️ <span class="fte"></span></div>
      <div class="enlace"></div>`;
    div.querySelector(".entidad").textContent = n.entidad;
    div.querySelector(".titulo").textContent = n.titulo;
    div.querySelector(".sumilla").textContent = n.sumilla || "";
    div.querySelector(".fecha").textContent = n.fecha || "s/f";
    div.querySelector(".fte").textContent = n.fuente || "El Peruano";
    div.querySelector(".kws").innerHTML = (n.keywords || []).map(() => '<span class="kw"></span>').join("");
    div.querySelectorAll(".kw").forEach((el, i) => (el.textContent = n.keywords[i]));
    div.querySelector(".enlace").textContent = n.urlFicha || "";
    lista.appendChild(div);
  });
}

$("btnPdf").addEventListener("click", () => window.print());

$("btnTodo").addEventListener("click", () => {
  soloRecientes = !soloRecientes;
  $("btnTodo").textContent = soloRecientes ? "Incluir historial completo" : "Solo últimas 24 h";
  render();
});

document.querySelectorAll("[data-expr]").forEach((b) =>
  b.addEventListener("click", () => exportarDataset(b.dataset.expr, datasetActual()))
);
