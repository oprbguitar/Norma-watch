// ============================================================
// Norma Watch Perú — service worker
// Monitorea el Diario Oficial El Peruano por palabras clave,
// genera resumen diario con IA (premium) y lanza alertas.
// Autor: Pierre R. — peru.labs.pe@gmail.com
// ============================================================

importScripts("ia.js", "licencia.js");

const DEFAULTS = {
  keywords: ["SST", "contrataciones", "presupuesto", "MEF", "Ministerio Público", "IA", "tránsito", "laboral"],
  email: "",            // el usuario configura su propio correo en Opciones
  whatsapp: "",         // el usuario configura su propio número en Opciones
  proveedor: "gemini",  // proveedor de IA activo
  modelo: "",           // modelo elegido (vacío = por defecto del proveedor)
  apiKeys: {},          // { gemini: "...", openai: "...", claude: "...", openrouter: "..." }
  frecuenciaMin: 60,    // cada cuántos minutos revisar El Peruano
  horaResumen: 8,       // hora local del resumen diario (0-23)
  abrirCorreoAuto: false, // al generar el resumen diario, abrir Gmail con el borrador listo
  diasRetro: 3,         // días hacia atrás que se revisan en cada barrido
  perfil: "abogado"     // perfil profesional del análisis IA
};

// Sinónimos: si la palabra clave es corta/ambigua, se buscan también sus variantes largas
const SINONIMOS = {
  ia: ["inteligencia artificial"],
  sst: ["seguridad y salud en el trabajo"],
  mef: ["ministerio de economia y finanzas"]
};

// ---------------- utilidades ----------------
const normalizar = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const decodificarEntidades = (s) =>
  (s || "")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

const sinTags = (s) => decodificarEntidades((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const aPeruano = (d) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const aUS = (d) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

async function getConfig() {
  const r = await chrome.storage.local.get("config");
  return { ...DEFAULTS, ...(r.config || {}) };
}

// ---------------- ciclo de vida ----------------
chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  await chrome.storage.local.set({ config: cfg });
  programarAlarmas(cfg);
  revisarNormas(); // primer barrido inmediato
});

chrome.runtime.onStartup.addListener(async () => programarAlarmas(await getConfig()));

async function programarAlarmas(cfg) {
  await chrome.alarms.clearAll();
  chrome.alarms.create("monitoreo", { periodInMinutes: Math.max(15, cfg.frecuenciaMin) });
  // próximo resumen diario a la hora configurada
  const ahora = new Date();
  const proximo = new Date(ahora);
  proximo.setHours(cfg.horaResumen, 0, 0, 0);
  if (proximo <= ahora) proximo.setDate(proximo.getDate() + 1);
  chrome.alarms.create("resumenDiario", { when: proximo.getTime(), periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener((alarma) => {
  if (alarma.name === "monitoreo") revisarNormas();
  if (alarma.name === "resumenDiario") generarResumenDiario({ abrirAlertas: true });
});

// ---------------- consulta a El Peruano ----------------
async function fetchNormasRango(desde, hasta) {
  const url =
    "https://diariooficial.elperuano.pe/Normas/Filtro?dateparam=" +
    encodeURIComponent(aUS(hasta) + " 00:00:00");
  const resp = await fetch(url, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body: new URLSearchParams({ cddesde: aPeruano(desde), cdhasta: aPeruano(hasta) })
  });
  if (!resp.ok) throw new Error("El Peruano respondió HTTP " + resp.status);
  return parsearNormas(await resp.text());
}

// Parseo por regex (el service worker no tiene DOMParser)
function parsearNormas(html) {
  const resultado = [];
  const bloques = html.split(/<article[^>]*edicionesoficiales_articulos[^>]*>/i).slice(1);
  bloques.forEach((bloque, idx) => {
    const seg = bloque.split(/<\/article>/i)[0];
    const entidad = sinTags((seg.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || [])[1]) || "SIN ENTIDAD";
    const mTitulo = seg.match(/<h5[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const urlFicha = mTitulo ? mTitulo[1] : "";
    const titulo = mTitulo ? sinTags(mTitulo[2]) : "Norma sin título";
    const id = urlFicha.split("/").pop() || `norma-${idx}`;
    const fecha = (seg.match(/Fecha\s*:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "";

    let sumilla = "";
    const parrafos = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => sinTags(m[1]));
    for (const p of parrafos) if (p && !/^Fecha\s*:/.test(p)) { sumilla = p; break; }

    let urlPdf = "";
    if (fecha && /^\d+-\d+$/.test(id)) {
      const [d, m, y] = fecha.split("/");
      urlPdf = "https://epdoc2.elperuano.pe/EpPo/DescargaIN.asp?Referencias=" + btoa(id.replace("-", "_") + y + m + d);
    }
    const fichaAbs = urlFicha.startsWith("http") ? urlFicha : "https://diariooficial.elperuano.pe" + urlFicha;
    resultado.push({ id, entidad, titulo, sumilla, fecha, urlFicha: fichaAbs, urlPdf, fuente: "El Peruano" });
  });
  return resultado;
}

// ---------------- coincidencia de palabras clave ----------------
function keywordsQueCoinciden(norma, keywords) {
  const texto = normalizar(`${norma.entidad} ${norma.titulo} ${norma.sumilla}`);
  const encontradas = [];
  for (const kw of keywords) {
    const variantes = [normalizar(kw), ...(SINONIMOS[normalizar(kw)] || [])];
    const hay = variantes.some((v) => {
      const escapada = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escapada}([^a-z0-9]|$)`).test(texto);
    });
    if (hay) encontradas.push(kw);
  }
  return encontradas;
}

// ---------------- barrido principal ----------------
async function revisarNormas() {
  const cfg = await getConfig();
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - cfg.diasRetro * 86400000);

  let normas;
  try {
    normas = await fetchNormasRango(desde, hoy);
  } catch (e) {
    console.error("Norma Watch: error consultando El Peruano", e);
    await chrome.storage.local.set({ ultimoError: `${new Date().toLocaleString("es-PE")}: ${e.message}` });
    return;
  }

  const store = await chrome.storage.local.get(["detectadas", "vistos"]);
  const detectadas = store.detectadas || [];
  const vistos = new Set(store.vistos || []);
  const nuevas = [];

  for (const n of normas) {
    if (vistos.has(n.id)) continue;
    vistos.add(n.id);
    const kws = keywordsQueCoinciden(n, cfg.keywords);
    if (kws.length) {
      nuevas.push({ ...n, keywords: kws, detectadoEn: Date.now() });
    }
  }

  if (nuevas.length) {
    const todas = [...nuevas, ...detectadas].slice(0, 300);
    await chrome.storage.local.set({ detectadas: todas });
    notificarNuevas(nuevas, cfg);
  }
  await chrome.storage.local.set({
    vistos: [...vistos].slice(-2000),
    ultimaRevision: Date.now(),
    ultimoError: null
  });
  actualizarBadge();
}

async function actualizarBadge() {
  const { detectadas = [] } = await chrome.storage.local.get("detectadas");
  const hace24h = Date.now() - 86400000;
  const recientes = detectadas.filter((n) => n.detectadoEn > hace24h).length;
  chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
  chrome.action.setBadgeText({ text: recientes ? String(recientes) : "" });
}

// ---------------- alertas ----------------
function textoAlerta(nuevas) {
  const lineas = nuevas.slice(0, 10).map(
    (n) => `• [${n.keywords.join(", ")}] ${n.titulo} (${n.entidad}, ${n.fecha})\n${n.urlFicha}`
  );
  let t = `⚖️ Norma Watch Perú — ${nuevas.length} norma(s) nueva(s) detectada(s):\n\n${lineas.join("\n\n")}`;
  if (nuevas.length > 10) t += `\n\n…y ${nuevas.length - 10} más.`;
  return t;
}

function urlWhatsApp(numero, texto) {
  const num = (numero || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!num) return null;
  const conPais = num.length === 9 ? "51" + num : num; // 9 dígitos => celular peruano
  return `https://wa.me/${conPais}?text=${encodeURIComponent(texto.slice(0, 3500))}`;
}

function urlGmail(correo, asunto, cuerpo) {
  if (!correo) return null;
  return (
    "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(correo) +
    "&su=" + encodeURIComponent(asunto) +
    "&body=" + encodeURIComponent(cuerpo.slice(0, 6000))
  );
}

function notificarNuevas(nuevas, cfg) {
  const texto = textoAlerta(nuevas);
  chrome.storage.local.set({ ultimaAlerta: texto });
  chrome.notifications.create("nw-nuevas-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/128.png",
    title: `⚖️ ${nuevas.length} norma(s) nueva(s) — Norma Watch Perú`,
    message: nuevas.slice(0, 3).map((n) => `[${n.keywords[0]}] ${n.titulo}`).join("\n"),
    buttons: [{ title: "📲 Enviar por WhatsApp" }, { title: "✉️ Enviar por correo" }],
    priority: 2
  });
}

chrome.notifications.onButtonClicked.addListener(async (idNotif, idxBoton) => {
  const cfg = await getConfig();
  const { ultimaAlerta = "", resumenes = [] } = await chrome.storage.local.get(["ultimaAlerta", "resumenes"]);
  const esResumen = idNotif.startsWith("nw-resumen");
  const texto = esResumen ? (resumenes[0]?.texto || ultimaAlerta) : ultimaAlerta;
  const asunto = esResumen
    ? `Norma Watch Perú — Resumen diario ${new Date().toLocaleDateString("es-PE")}`
    : "Norma Watch Perú — Nuevas normas detectadas";
  const url = idxBoton === 0 ? urlWhatsApp(cfg.whatsapp, texto) : urlGmail(cfg.email, asunto, texto);
  // si el canal no está configurado, lleva a Opciones para que el usuario ponga su número/correo
  if (url) chrome.tabs.create({ url });
  else chrome.runtime.openOptionsPage();
});

// ---------------- resumen diario con IA ----------------
async function generarResumenDiario({ abrirAlertas = false } = {}) {
  const cfg = await getConfig();
  const { detectadas = [], resumenes = [] } = await chrome.storage.local.get(["detectadas", "resumenes"]);
  const hace24h = Date.now() - 86400000;
  const recientes = detectadas.filter((n) => n.detectadoEn > hace24h);
  const premium = await esPremium();

  let texto;
  if (!recientes.length) {
    texto = `📋 Norma Watch Perú — ${new Date().toLocaleDateString("es-PE")}\n\nSin normas nuevas que coincidan con tus palabras clave (${cfg.keywords.join(", ")}) en las últimas 24 horas.`;
  } else if (!premium) {
    texto = textoAlerta(recientes) + "\n\n⭐ Activa Premium para recibir el resumen ejecutivo con análisis de IA (impacto práctico y acciones sugeridas).";
  } else if (!iaKeyActiva(cfg)) {
    texto = textoAlerta(recientes) + "\n\n(Configura tu API key de IA en ⚙️ Opciones para recibir el resumen con análisis.)";
  } else {
    const lista = recientes
      .map((n) => `- [${n.keywords.join(", ")}] ${n.entidad}: ${n.titulo}. ${n.sumilla} (Fecha: ${n.fecha}) ${n.urlFicha}`)
      .join("\n");
    const prompt =
      `Eres ${perfilIA(cfg)} de "Norma Watch Perú". Redacta en español un RESUMEN EJECUTIVO BREVE de las siguientes normas publicadas en el Diario Oficial El Peruano.\n\n` +
      `Sé BREVE: viñetas de máximo 2 líneas, sin párrafos largos.\nFormato:\n1) Titular del día (una línea).\n2) Puntos clave por tema (agrupa por palabra clave: ${cfg.keywords.join(", ")}), señalando en una viñeta el impacto práctico de cada norma.\n3) "Acción sugerida" (máximo 3 viñetas).\nIncluye el enlace de cada norma citada. No inventes normas que no estén en la lista.\n\nNORMAS DETECTADAS:\n${lista}`;
    try {
      const analisis = await llamarIA(cfg, prompt);
      texto = `📋 Norma Watch Perú — Resumen diario ${new Date().toLocaleDateString("es-PE")}\n\n${analisis}`;
    } catch (e) {
      texto = textoAlerta(recientes) + `\n\n⚠️ No se pudo generar el análisis con IA: ${e.message}`;
    }
  }

  const nuevos = [{ fecha: new Date().toLocaleDateString("es-PE"), creadoEn: Date.now(), texto, cantidad: recientes.length }, ...resumenes].slice(0, 30);
  await chrome.storage.local.set({ resumenes: nuevos, ultimaAlerta: texto });

  chrome.notifications.create("nw-resumen-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/128.png",
    title: "📋 Resumen diario listo — Norma Watch Perú",
    message: recientes.length
      ? `${recientes.length} norma(s) relevante(s) en las últimas 24 h. Ábrelo desde el ícono de la extensión.`
      : "Sin novedades para tus palabras clave.",
    buttons: [{ title: "📲 Enviar por WhatsApp" }, { title: "✉️ Enviar por correo" }],
    priority: 2
  });

  if (abrirAlertas && cfg.abrirCorreoAuto && cfg.email && recientes.length) {
    const url = urlGmail(cfg.email, `Norma Watch Perú — Resumen diario ${new Date().toLocaleDateString("es-PE")}`, texto);
    if (url) chrome.tabs.create({ url, active: false });
  }
  return texto;
}

// ---------------- mensajes desde popup/options ----------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.tipo === "revisarAhora") {
        await revisarNormas();
        sendResponse({ ok: true });
      } else if (msg.tipo === "generarResumen") {
        const texto = await generarResumenDiario({ abrirAlertas: false });
        sendResponse({ ok: true, texto });
      } else if (msg.tipo === "reprogramar") {
        await programarAlarmas(await getConfig());
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Mensaje desconocido" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // respuesta asíncrona
});
