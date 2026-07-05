// ============================================================
// Norma Watch Perú — módulo de licencia Premium y límites
// Las funciones Premium se activan con un código de licencia.
// Para obtener un código, contacte al autor:
// peru.labs.pe@gmail.com · WhatsApp 973 337 773
// ============================================================

const LIC_OFUSCADA = "2IDMy0CajRXYXFWby9mTtMnYhxUdyVGU";
const licSecreto = () => atob(LIC_OFUSCADA.split("").reverse().join(""));

const LIMITE_BUSQUEDAS_DIA = 10;

async function licHash12(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12).toUpperCase();
}

const licMesActual = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Valida un código. Devuelve { ok, vence } o { ok:false, error }
async function validarCodigo(codigo) {
  const m = (codigo || "").trim().toUpperCase().match(/^NW-(MASTER|\d{6})-([0-9A-F]{12})$/);
  if (!m) return { ok: false, error: "Formato inválido. Debe ser NW-AAAAMM-CÓDIGO (ej. NW-202612-…)" };
  const [, periodo, hash] = m;
  const base = periodo === "MASTER" ? "normawatch|master|" : `normawatch|${periodo}|`;
  const esperado = await licHash12(base + licSecreto());
  if (hash !== esperado) return { ok: false, error: "Código no válido. Verifica con el proveedor." };
  if (periodo !== "MASTER" && periodo < licMesActual())
    return { ok: false, error: `Este código venció en ${periodo.slice(4)}/${periodo.slice(0, 4)}.` };
  return { ok: true, vence: periodo === "MASTER" ? null : periodo };
}

async function activarLicencia(codigo) {
  const r = await validarCodigo(codigo);
  if (r.ok) await chrome.storage.local.set({ licencia: { codigo: codigo.trim().toUpperCase(), vence: r.vence, activadaEn: Date.now() } });
  return r;
}

async function esPremium() {
  const { licencia } = await chrome.storage.local.get("licencia");
  if (!licencia) return false;
  if (licencia.vence && licencia.vence < licMesActual()) return false; // venció
  return true;
}

async function estadoLicencia() {
  const { licencia } = await chrome.storage.local.get("licencia");
  if (!licencia) return { premium: false, texto: "Versión gratuita" };
  if (licencia.vence && licencia.vence < licMesActual())
    return { premium: false, texto: `Licencia vencida (${licencia.vence.slice(4)}/${licencia.vence.slice(0, 4)})` };
  const hasta = licencia.vence ? `hasta ${licencia.vence.slice(4)}/${licencia.vence.slice(0, 4)}` : "permanente";
  return { premium: true, texto: `⭐ Premium activo (${hasta})` };
}

// Contador de búsquedas gratuitas (10/día). Premium = ilimitado.
async function consumirBusqueda() {
  if (await esPremium()) return { ok: true, restantes: Infinity };
  const hoy = new Date().toISOString().slice(0, 10);
  const { contadorBusquedas } = await chrome.storage.local.get("contadorBusquedas");
  const c = contadorBusquedas?.fecha === hoy ? contadorBusquedas.n : 0;
  if (c >= LIMITE_BUSQUEDAS_DIA)
    return { ok: false, restantes: 0, error: `Alcanzaste las ${LIMITE_BUSQUEDAS_DIA} búsquedas gratuitas de hoy. Activa Premium para búsquedas ilimitadas.` };
  await chrome.storage.local.set({ contadorBusquedas: { fecha: hoy, n: c + 1 } });
  return { ok: true, restantes: LIMITE_BUSQUEDAS_DIA - c - 1 };
}

async function busquedasRestantes() {
  if (await esPremium()) return Infinity;
  const hoy = new Date().toISOString().slice(0, 10);
  const { contadorBusquedas } = await chrome.storage.local.get("contadorBusquedas");
  const c = contadorBusquedas?.fecha === hoy ? contadorBusquedas.n : 0;
  return Math.max(0, LIMITE_BUSQUEDAS_DIA - c);
}
