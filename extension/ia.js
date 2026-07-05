// ============================================================
// Norma Watch Perú — módulo de IA multi-proveedor
// Funciona en el service worker (importScripts) y en páginas.
// ============================================================

const IA_PROVEEDORES = {
  gemini: {
    nombre: "Google Gemini",
    placeholder: "AIza…",
    urlKey: "https://aistudio.google.com/apikey",
    modelos: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"]
  },
  openai: {
    nombre: "OpenAI (ChatGPT)",
    placeholder: "sk-…",
    urlKey: "https://platform.openai.com/api-keys",
    modelos: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]
  },
  claude: {
    nombre: "Anthropic Claude",
    placeholder: "sk-ant-…",
    urlKey: "https://console.anthropic.com/settings/keys",
    modelos: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-4-8"]
  },
  openrouter: {
    nombre: "OpenRouter (multi-modelo)",
    placeholder: "sk-or-…",
    urlKey: "https://openrouter.ai/keys",
    modelos: ["google/gemini-2.0-flash-001", "openai/gpt-4o-mini", "anthropic/claude-haiku-4.5", "meta-llama/llama-3.3-70b-instruct"]
  }
};

function iaKeyActiva(cfg) {
  const prov = cfg.proveedor || "gemini";
  return (cfg.apiKeys || {})[prov] || (prov === "gemini" ? cfg.geminiKey : "") || "";
}

// Llama al proveedor configurado. cfg = config del storage. Devuelve texto.
async function llamarIA(cfg, prompt, { maxTokens = 3000 } = {}) {
  const prov = cfg.proveedor || "gemini";
  const key = iaKeyActiva(cfg);
  if (!key) throw new Error("Falta la API key del proveedor de IA. Configúrala en ⚙️ Opciones.");
  const modelo = cfg.modelo || IA_PROVEEDORES[prov].modelos[0];

  if (prov === "gemini") return iaGemini(key, modelo, prompt, maxTokens);
  if (prov === "openai") return iaOpenAIComp("https://api.openai.com/v1/chat/completions", key, modelo, prompt, maxTokens);
  if (prov === "openrouter") return iaOpenAIComp("https://openrouter.ai/api/v1/chat/completions", key, modelo, prompt, maxTokens);
  if (prov === "claude") return iaClaude(key, modelo, prompt, maxTokens);
  throw new Error("Proveedor de IA desconocido: " + prov);
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
