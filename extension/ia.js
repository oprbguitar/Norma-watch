// ============================================================
// Norma Watch Perú — módulo de IA multi-proveedor
// Funciona en el service worker (importScripts) y en páginas.
// 🆓 = modelo con capa gratuita · ✍️ = orientado a redacción
// ============================================================

const IA_PROVEEDORES = {
  gemini: {
    nombre: "Google Gemini",
    placeholder: "AIza…",
    urlKey: "https://aistudio.google.com/apikey",
    modelos: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"],
    gratis: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
    redaccion: ["gemini-2.5-pro"]
  },
  groq: {
    nombre: "Groq (ultra rápido)",
    placeholder: "gsk_…",
    urlKey: "https://console.groq.com/keys",
    api: "https://api.groq.com/openai/v1/chat/completions",
    modelos: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant", "gemma2-9b-it"],
    gratis: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant", "gemma2-9b-it"],
    redaccion: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]
  },
  mistral: {
    nombre: "Mistral AI",
    placeholder: "…",
    urlKey: "https://console.mistral.ai/api-keys",
    api: "https://api.mistral.ai/v1/chat/completions",
    modelos: ["mistral-small-latest", "open-mistral-nemo", "mistral-large-latest"],
    gratis: ["mistral-small-latest", "open-mistral-nemo"],
    redaccion: ["mistral-large-latest", "mistral-small-latest"]
  },
  nvidia: {
    nombre: "NVIDIA NIM",
    placeholder: "nvapi-…",
    urlKey: "https://build.nvidia.com/settings/api-keys",
    api: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelos: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct", "meta/llama-3.1-405b-instruct"],
    gratis: ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct", "meta/llama-3.1-405b-instruct"],
    redaccion: ["nvidia/llama-3.1-nemotron-70b-instruct", "meta/llama-3.1-405b-instruct"]
  },
  cohere: {
    nombre: "Cohere",
    placeholder: "…",
    urlKey: "https://dashboard.cohere.com/api-keys",
    api: "https://api.cohere.ai/compatibility/v1/chat/completions",
    modelos: ["command-a-03-2025", "command-r-plus-08-2024", "command-r7b-12-2024"],
    gratis: ["command-a-03-2025", "command-r-plus-08-2024", "command-r7b-12-2024"],
    redaccion: ["command-a-03-2025", "command-r-plus-08-2024"]
  },
  openai: {
    nombre: "OpenAI (ChatGPT)",
    placeholder: "sk-…",
    urlKey: "https://platform.openai.com/api-keys",
    api: "https://api.openai.com/v1/chat/completions",
    modelos: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    gratis: [],
    redaccion: ["gpt-4o", "gpt-4.1"]
  },
  claude: {
    nombre: "Anthropic Claude",
    placeholder: "sk-ant-…",
    urlKey: "https://console.anthropic.com/settings/keys",
    modelos: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-4-8"],
    gratis: [],
    redaccion: ["claude-sonnet-5", "claude-opus-4-8"]
  },
  openrouter: {
    nombre: "OpenRouter (multi-modelo)",
    placeholder: "sk-or-…",
    urlKey: "https://openrouter.ai/keys",
    api: "https://openrouter.ai/api/v1/chat/completions",
    modelos: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini", "anthropic/claude-haiku-4.5"],
    gratis: ["meta-llama/llama-3.3-70b-instruct:free"],
    redaccion: ["anthropic/claude-haiku-4.5"]
  }
};

// Etiqueta descriptiva de un modelo: "🆓 gratis · ✍️ redacción"
function iaEtiquetaModelo(provId, modelo) {
  const p = IA_PROVEEDORES[provId];
  if (!p) return "";
  const partes = [];
  if ((p.gratis || []).includes(modelo)) partes.push("🆓 gratis");
  if ((p.redaccion || []).includes(modelo)) partes.push("✍️ redacción");
  return partes.length ? "  — " + partes.join(" · ") : "";
}

// Perfil profesional con el que la IA analiza los documentos
const IA_PERFILES = {
  abogado: { nombre: "Abogado", persona: "un abogado peruano experto en derecho administrativo y compliance, con enfoque práctico" },
  analista: { nombre: "Analista jurídico", persona: "un analista jurídico peruano, riguroso y técnico-normativo, que cita artículos y fuentes" },
  economista: { nombre: "Economista", persona: "un economista peruano experto en impacto regulatorio, económico y fiscal de las normas" }
};
const perfilIA = (cfg) => (IA_PERFILES[cfg?.perfil] || IA_PERFILES.abogado).persona;

function iaKeyActiva(cfg) {
  const prov = cfg.proveedor || "gemini";
  return (cfg.apiKeys || {})[prov] || (prov === "gemini" ? cfg.geminiKey : "") || "";
}

// Llama al proveedor configurado. cfg = config del storage. Devuelve texto.
async function llamarIA(cfg, prompt, { maxTokens = 3000 } = {}) {
  const prov = cfg.proveedor || "gemini";
  const p = IA_PROVEEDORES[prov];
  if (!p) throw new Error("Proveedor de IA desconocido: " + prov);
  const key = iaKeyActiva(cfg);
  if (!key) throw new Error("Falta la API key del proveedor de IA. Configúrala en ⚙️ Opciones.");
  const modelo = cfg.modelo || p.modelos[0];

  if (prov === "gemini") return iaGemini(key, modelo, prompt, maxTokens);
  if (prov === "claude") return iaClaude(key, modelo, prompt, maxTokens);
  return iaOpenAIComp(p.api, key, modelo, prompt, maxTokens);
}

async function iaGemini(key, modelo, prompt, maxTokens) {
  // si el modelo elegido falla, prueba los demás modelos de Gemini
  const candidatos = [modelo, ...IA_PROVEEDORES.gemini.modelos.filter((m) => m !== modelo)];
  let ultimoErr = "";
  for (const m of candidatos) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens }
          })
        }
      );
      const data = await resp.json();
      if (!resp.ok) { ultimoErr = data.error?.message || "HTTP " + resp.status; continue; }
      const texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (texto) return texto;
      ultimoErr = "Respuesta vacía del modelo";
    } catch (e) { ultimoErr = e.message; }
  }
  throw new Error("Gemini: " + ultimoErr);
}

async function iaOpenAIComp(url, key, modelo, prompt, maxTokens) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "HTTP " + resp.status);
  const texto = data.choices?.[0]?.message?.content || "";
  if (!texto) throw new Error("Respuesta vacía del modelo");
  return texto;
}

async function iaClaude(key, modelo, prompt, maxTokens) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "HTTP " + resp.status);
  const texto = (data.content || []).map((b) => b.text || "").join("");
  if (!texto) throw new Error("Respuesta vacía del modelo");
  return texto;
}
