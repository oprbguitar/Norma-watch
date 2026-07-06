// ================= Norma Watch Perú — configuración =================
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  keywords: ["SST", "contrataciones", "presupuesto", "MEF", "Ministerio Público", "IA", "tránsito", "laboral"],
  email: "",
  whatsapp: "",
  proveedor: "gemini",
  modelo: "",
  apiKeys: {},
  frecuenciaMin: 60,
  horaResumen: 8,
  abrirCorreoAuto: false,
  diasRetro: 3,
  perfil: "abogado"
};

let keywords = [];
let apiKeys = {};

// horas del selector
for (let h = 0; h < 24; h++) {
  const op = document.createElement("option");
  op.value = h;
  op.textContent = `${String(h).padStart(2, "0")}:00`;
  $("horaResumen").appendChild(op);
}
// proveedores
for (const [id, p] of Object.entries(IA_PROVEEDORES)) {
  const op = document.createElement("option");
  op.value = id;
  op.textContent = p.nombre;
  $("selProveedor").appendChild(op);
}

init();

async function init() {
  const { config } = await chrome.storage.local.get("config");
  const cfg = { ...DEFAULTS, ...(config || {}) };
  keywords = [...cfg.keywords];
  apiKeys = { ...(cfg.apiKeys || {}) };
  if (cfg.geminiKey && !apiKeys.gemini) apiKeys.gemini = cfg.geminiKey; // migración v1

  renderChips();
  $("frecuenciaMin").value = cfg.frecuenciaMin;
  $("diasRetro").value = cfg.diasRetro;
  $("horaResumen").value = cfg.horaResumen;
  $("email").value = cfg.email;
  $("whatsapp").value = cfg.whatsapp;
  $("abrirCorreoAuto").checked = cfg.abrirCorreoAuto;
  $("selProveedor").value = cfg.proveedor;
  $("selPerfil").value = cfg.perfil || "abogado";
  refrescarProveedor(cfg.modelo);
  refrescarLicencia();
}

// ---------- palabras clave (chips) ----------
function renderChips() {
  const cont = $("chipsKeywords");
  cont.innerHTML = "";
  keywords.forEach((kw, i) => {
    const chip = document.createElement("span");
    chip.className = "chip-kw";
    chip.innerHTML = `<span></span><button title="Quitar">✕</button>`;
    chip.querySelector("span").textContent = kw;
    chip.querySelector("button").addEventListener("click", () => { keywords.splice(i, 1); renderChips(); });
    cont.appendChild(chip);
  });
  if (!keywords.length) cont.innerHTML = '<span style="font-size:12px;color:#94a3b8">Sin palabras clave — agregue al menos una.</span>';
}

function agregarKeyword() {
  const v = $("nuevaKeyword").value.trim();
  if (!v) return;
  if (!keywords.some((k) => k.toLowerCase() === v.toLowerCase())) keywords.push(v);
  $("nuevaKeyword").value = "";
  renderChips();
}
$("btnAgregarKw").addEventListener("click", agregarKeyword);
$("nuevaKeyword").addEventListener("keydown", (e) => { if (e.key === "Enter") agregarKeyword(); });

// ---------- gestor de API keys / modelos ----------
function refrescarProveedor(modeloGuardado = "") {
  const provId = $("selProveedor").value;
  const p = IA_PROVEEDORES[provId];
  $("lblProveedor").textContent = p.nombre;
  $("txtApiKey").value = apiKeys[provId] || "";
  $("txtApiKey").placeholder = p.placeholder;
  $("lnkKey").textContent = p.urlKey.replace("https://", "");
  $("lnkKey").href = p.urlKey;

  const sel = $("selModelo");
  sel.innerHTML = "";
  p.modelos.forEach((m, i) => {
    const op = document.createElement("option");
    op.value = m;
    op.textContent = m + (i === 0 ? "  (recomendado)" : "") + iaEtiquetaModelo(provId, m);
    sel.appendChild(op);
  });
  const otro = document.createElement("option");
  otro.value = "__otro__";
  otro.textContent = "Otro modelo (escribir nombre)…";
  sel.appendChild(otro);

  if (modeloGuardado && p.modelos.includes(modeloGuardado)) sel.value = modeloGuardado;
  else if (modeloGuardado) { sel.value = "__otro__"; $("txtModeloOtro").value = modeloGuardado; }
  $("txtModeloOtro").style.display = sel.value === "__otro__" ? "block" : "none";
}

$("selProveedor").addEventListener("change", () => refrescarProveedor());
$("selModelo").addEventListener("change", () => {
  $("txtModeloOtro").style.display = $("selModelo").value === "__otro__" ? "block" : "none";
});
$("txtApiKey").addEventListener("input", () => {
  apiKeys[$("selProveedor").value] = $("txtApiKey").value.trim();
});

// ---------- licencia ----------
async function refrescarLicencia() {
  const est = await estadoLicencia();
  const el = $("licEstado");
  el.textContent = est.texto;
  el.classList.toggle("premium", est.premium);
}

$("btnActivar").addEventListener("click", async () => {
  const r = await activarLicencia($("txtCodigo").value);
  const m = $("msgLicencia");
  m.textContent = r.ok ? "✅ ¡Premium activado!" : "❌ " + r.error;
  m.style.color = r.ok ? "#16a34a" : "#dc2626";
  refrescarLicencia();
});

// ---------- guardar ----------
$("btnGuardar").addEventListener("click", async () => {
  if (!keywords.length) return estado("Agregue al menos una palabra clave.", "error");
  const modeloSel = $("selModelo").value;
  const config = {
    keywords: [...keywords],
    frecuenciaMin: Math.min(720, Math.max(15, parseInt($("frecuenciaMin").value, 10) || 60)),
    diasRetro: Math.min(15, Math.max(1, parseInt($("diasRetro").value, 10) || 3)),
    horaResumen: parseInt($("horaResumen").value, 10),
    email: $("email").value.trim(),
    whatsapp: $("whatsapp").value.trim(),
    abrirCorreoAuto: $("abrirCorreoAuto").checked,
    proveedor: $("selProveedor").value,
    modelo: modeloSel === "__otro__" ? $("txtModeloOtro").value.trim() : modeloSel,
    perfil: $("selPerfil").value,
    apiKeys: { ...apiKeys }
  };
  await chrome.storage.local.set({ config });
  await chrome.runtime.sendMessage({ tipo: "reprogramar" });
  estado("✅ Guardado. Monitoreo reprogramado.", "ok");
});

function estado(msg, clase) {
  const e = $("estado");
  e.textContent = msg;
  e.className = clase;
  setTimeout(() => (e.textContent = ""), 4000);
}
