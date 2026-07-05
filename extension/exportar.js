// ============================================================
// Norma Watch Perú — módulo de exportación
// Formatos: PDF (vía reporte imprimible), Word, Excel, Markdown, JSON
// ============================================================

function expDescargar(nombre, mime, contenido) {
  const url = URL.createObjectURL(new Blob([contenido], { type: mime }));
  chrome.downloads.download({ url, filename: nombre, saveAs: true }, () => URL.revokeObjectURL(url));
}

const expFecha = () => new Date().toISOString().slice(0, 10);
const expEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// dataset = { titulo, subtitulo, normas: [{entidad,titulo,sumilla,fecha,keywords?,fuente?,urlFicha,urlPdf}], analisis? }
function expMarkdown(d) {
  let md = `# ⚖️ ${d.titulo}\n\n_${d.subtitulo || ""}_\n\n`;
  if (d.analisis) md += `## ✨ Análisis IA\n\n${d.analisis}\n\n---\n\n`;
  md += `## 📑 Normas (${d.normas.length})\n\n`;
  d.normas.forEach((n) => {
    md += `### ${n.titulo}\n\n- **Entidad:** ${n.entidad}\n- **Fecha:** ${n.fecha || "s/f"}\n`;
    if (n.fuente) md += `- **Fuente:** ${n.fuente}\n`;
    if (n.keywords?.length) md += `- **Palabras clave:** ${n.keywords.join(", ")}\n`;
    if (n.sumilla) md += `- **Sumilla:** ${n.sumilla}\n`;
    if (n.urlFicha) md += `- **Ficha:** ${n.urlFicha}\n`;
    if (n.urlPdf) md += `- **PDF oficial:** ${n.urlPdf}\n`;
    md += "\n";
  });
  md += `\n---\nGenerado por Norma Watch Perú · ${new Date().toLocaleString("es-PE")} · Autor: Pierre R. (peru.labs.pe@gmail.com)\n`;
  return md;
}

function expHtmlCuerpo(d) {
  let h = `<h1 style="color:#b91c1c">⚖️ ${expEsc(d.titulo)}</h1><p><i>${expEsc(d.subtitulo || "")}</i></p>`;
  if (d.analisis) h += `<h2 style="color:#4f46e5">✨ Análisis IA</h2><div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #ddd;padding:10px">${expEsc(d.analisis)}</div>`;
  h += `<h2 style="color:#4f46e5">📑 Normas (${d.normas.length})</h2>`;
  h += `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:12px">
    <tr style="background:#b91c1c;color:#fff"><th>Entidad</th><th>Norma</th><th>Sumilla</th><th>Fecha</th><th>Fuente</th><th>Enlaces</th></tr>`;
  d.normas.forEach((n) => {
    h += `<tr><td>${expEsc(n.entidad)}</td><td><b>${expEsc(n.titulo)}</b>${n.keywords?.length ? "<br><small>🏷️ " + expEsc(n.keywords.join(", ")) + "</small>" : ""}</td><td>${expEsc(n.sumilla)}</td><td>${expEsc(n.fecha || "s/f")}</td><td>${expEsc(n.fuente || "El Peruano")}</td><td>${n.urlFicha ? `<a href="${expEsc(n.urlFicha)}">Ficha</a>` : ""} ${n.urlPdf ? `<a href="${expEsc(n.urlPdf)}">PDF</a>` : ""}</td></tr>`;
  });
  h += `</table><p style="font-size:10px;color:#888">Generado por Norma Watch Perú · ${new Date().toLocaleString("es-PE")} · Autor: Pierre R. (peru.labs.pe@gmail.com)</p>`;
  return h;
}

function expWord(d) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]--><title>${expEsc(d.titulo)}</title></head>
<body style="font-family:Calibri,Arial,sans-serif">${expHtmlCuerpo(d)}</body></html>`;
}

function expExcel(d) {
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Normas</x:Name><x:WorksheetOptions/></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body>${expHtmlCuerpo(d)}</body></html>`;
}

// Exporta texto suelto (interpretaciones, líneas de tiempo, comparaciones)
function expTextoDataset(titulo, texto) {
  return { titulo, subtitulo: `Generado el ${new Date().toLocaleString("es-PE")}`, normas: [], analisis: texto };
}

// formato: pdf | word | excel | md | json
async function exportarDataset(formato, d) {
  const base = `NormaWatch-${d.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ -]/g, "").replace(/\s+/g, "_").slice(0, 50)}-${expFecha()}`;
  if (formato === "json") {
    expDescargar(base + ".json", "application/json", JSON.stringify(d, null, 2));
  } else if (formato === "md") {
    expDescargar(base + ".md", "text/markdown", expMarkdown(d));
  } else if (formato === "word") {
    expDescargar(base + ".doc", "application/msword", "﻿" + expWord(d));
  } else if (formato === "excel") {
    expDescargar(base + ".xls", "application/vnd.ms-excel", "﻿" + expExcel(d));
  } else if (formato === "pdf") {
    // guarda el dataset y abre el reporte imprimible → Guardar como PDF
    await chrome.storage.local.set({ exportData: d });
    chrome.tabs.create({ url: chrome.runtime.getURL("report.html?vista=export") });
  }
}
