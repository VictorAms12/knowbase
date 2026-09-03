import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import sanitizeHtml from 'sanitize-html';
import { db } from './db.js';
import { toEmbedUrl } from './extractors.js';

const INLINE_EXTENSIONS = new Set([
  '.docx', '.odt', '.doc', '.dot',
  '.xlsx', '.xls', '.csv',
  '.pptx', '.ppt',
  '.txt', '.md', '.sql', '.log', '.xml', '.json',
  '.ps1', '.bat', '.sh', '.js', '.ts'
]);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function decodeXml(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function formatBytes(bytes = 0) {
  const n = Number(bytes || 0);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function originalUrl(row) {
  if (!row?.storage_path) return null;
  return `/uploads/${encodeURIComponent(path.basename(row.storage_path))}`;
}

function extensionFor(row) {
  return path.extname(row?.original_name || row?.name || row?.storage_path || '').toLowerCase();
}

function canRenderInline(row) {
  if (!row || row.external_url || !row.storage_path) return false;
  const ext = extensionFor(row);
  return INLINE_EXTENSIONS.has(ext)
    || ['DOCUMENT', 'SPREADSHEET', 'PRESENTATION', 'TEXT', 'SCRIPT'].includes(row.media_type);
}

function cleanPreviewHtml(html = '') {
  return sanitizeHtml(String(html), {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
      'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'a', 'span', 'div', 'section'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      '*': ['class']
    },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true)
    }
  });
}

async function renderDocx(filePath) {
  const result = await mammoth.convertToHtml({ path: filePath }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => p.subtitle:fresh"
    ]
  });
  return cleanPreviewHtml(result.value);
}

async function renderOdt(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const content = zip.files['content.xml'];
  if (!content) return '';
  const xml = await content.async('string');

  const blocks = [];
  const blockRegex = /<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/gi;
  for (const match of xml.matchAll(blockRegex)) {
    const type = match[1].toLowerCase();
    const attrs = match[2] || '';
    const level = Number(attrs.match(/text:outline-level="(\d+)"/i)?.[1] || 2);
    const text = decodeXml(match[3]
      .replace(/<text:line-break\s*\/?>/gi, '\n')
      .replace(/<text:tab\s*\/?>/gi, '\t')
      .replace(/<text:s(?:\s[^>]*)?\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '))
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '<br>')
      .trim();
    if (!text) continue;
    const h = Math.min(Math.max(level, 1), 6);
    blocks.push(type === 'h' ? `<h${h}>${text}</h${h}>` : `<p>${text}</p>`);
  }

  return cleanPreviewHtml(blocks.join('\n'));
}

function renderWorkbook(filePath) {
  const book = XLSX.readFile(filePath, { cellText: true, cellDates: true });
  const sections = [];
  for (const name of book.SheetNames.slice(0, 30)) {
    const sheet = book.Sheets[name];
    const html = XLSX.utils.sheet_to_html(sheet, {
      id: `sheet-${sections.length + 1}`,
      editable: false,
      header: '',
      footer: ''
    });
    sections.push(`<section class="sheet"><h2>${escapeHtml(name)}</h2><div class="table-scroll">${html}</div></section>`);
  }
  return cleanPreviewHtml(sections.join('\n'));
}

async function renderPptx(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));

  const slides = [];
  for (let index = 0; index < slideNames.length; index++) {
    const xml = await zip.files[slideNames[index]].async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map(match => decodeXml(match[1]).trim())
      .filter(Boolean);
    slides.push(`<section class="slide"><div class="slide-number">Slide ${index + 1}</div>${texts.length
      ? texts.map((text, textIndex) => textIndex === 0 ? `<h2>${escapeHtml(text)}</h2>` : `<p>${escapeHtml(text)}</p>`).join('')
      : '<p class="muted">Sem texto extraível neste slide.</p>'}</section>`);
  }
  return cleanPreviewHtml(slides.join('\n'));
}

async function renderTextFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return `<pre class="source-text">${escapeHtml(text.slice(0, 1_500_000))}</pre>`;
}

async function renderDocument(row) {
  const filePath = row.storage_path;
  const ext = extensionFor(row);

  if (ext === '.docx') return { title: 'Documento Word', html: await renderDocx(filePath) };
  if (ext === '.odt') return { title: 'Documento ODT', html: await renderOdt(filePath) };
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return { title: 'Planilha', html: renderWorkbook(filePath) };
  if (ext === '.pptx') return { title: 'Apresentação', html: await renderPptx(filePath) };
  if (['.txt', '.md', '.sql', '.log', '.xml', '.json', '.ps1', '.bat', '.sh', '.js', '.ts'].includes(ext)) {
    return { title: 'Arquivo de texto', html: await renderTextFile(filePath) };
  }

  if (row.extracted_text) {
    return {
      title: row.media_type === 'PRESENTATION' ? 'Apresentação' : row.media_type === 'SPREADSHEET' ? 'Planilha' : 'Documento',
      html: `<pre class="source-text">${escapeHtml(row.extracted_text.slice(0, 1_500_000))}</pre>`
    };
  }

  return {
    title: 'Documento',
    html: `<div class="empty-preview"><h2>Pré-visualização não disponível</h2><p>Este formato legado (${escapeHtml(ext || 'desconhecido')}) não possui conteúdo extraível no momento. O arquivo original continua preservado.</p></div>`
  };
}

function viewerPage({ row, title, html }) {
  const source = originalUrl(row);
  const fileName = row.original_name || row.name || 'Documento';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fileName)}</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f4f6;color:#18181b}*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#18181b}.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;border-bottom:1px solid #e4e4e7;background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.bar div{min-width:0}.bar small{display:block;color:#71717a;font-size:11px}.bar strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.bar a{flex:0 0 auto;padding:8px 11px;border:1px solid #d4d4d8;border-radius:9px;background:#fff;color:#3f3f46;text-decoration:none;font-size:11px;font-weight:700}.page{width:min(980px,calc(100% - 28px));min-height:calc(100vh - 92px);margin:16px auto 28px;padding:42px 48px;border:1px solid #e4e4e7;border-radius:12px;background:#fff;box-shadow:0 14px 50px rgba(24,24,27,.08)}h1{font-size:30px}h2{margin-top:28px;font-size:20px}h3{font-size:16px}p,li{font-size:14px;line-height:1.65}table{width:max-content;min-width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px 10px;border:1px solid #d4d4d8;vertical-align:top}th{background:#f4f4f5}.table-scroll{max-width:100%;overflow:auto}.sheet+.sheet{margin-top:42px}.slide{margin:0 auto 22px;padding:34px;aspect-ratio:16/9;border:1px solid #d4d4d8;border-radius:12px;background:linear-gradient(145deg,#fff,#f8f9fb);box-shadow:0 8px 28px rgba(24,24,27,.07);overflow:auto}.slide-number{margin-bottom:18px;color:#71717a;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}.source-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.empty-preview{padding:70px 20px;text-align:center}.empty-preview p,.muted{color:#71717a}.subtitle{color:#71717a;font-size:16px}@media(max-width:700px){.bar{padding:10px 12px}.bar a{padding:7px 9px}.page{width:100%;min-height:calc(100vh - 60px);margin:0;padding:24px 16px;border:0;border-radius:0}.slide{padding:20px;aspect-ratio:auto;min-height:260px}}@media(prefers-color-scheme:dark){:root,body{background:#0c0d11;color:#f4f4f5}.bar{border-color:#292d36;background:rgba(19,21,27,.96)}.bar small{color:#9699a3}.bar a{border-color:#3b404b;background:#181b22;color:#d4d4d8}.page{border-color:#292d36;background:#13151b;box-shadow:none}th,td{border-color:#3b404b}th{background:#20242d}.slide{border-color:#3b404b;background:linear-gradient(145deg,#181b22,#13151b)}.muted,.empty-preview p,.slide-number{color:#9699a3}}
</style>
</head>
<body>
<header class="bar"><div><small>${escapeHtml(title)} · ${formatBytes(row.size_bytes)}</small><strong>${escapeHtml(fileName)}</strong></div>${source ? `<a href="${source}" target="_blank" rel="noreferrer">Abrir original</a>` : ''}</header>
<main class="page">${html || '<div class="empty-preview"><h2>Documento vazio</h2><p>Nenhum conteúdo foi extraído deste arquivo.</p></div>'}</main>
</body>
</html>`;
}

export async function renderMediaDocument(req, res) {
  const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).send('Arquivo não encontrado.');
  if (!canRenderInline(row)) return res.redirect(originalUrl(row) || '/');

  try {
    await fs.access(row.storage_path);
    const preview = await renderDocument(row);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(viewerPage({ row, ...preview }));
  } catch (error) {
    res.status(500).send(viewerPage({
      row,
      title: 'Documento',
      html: `<div class="empty-preview"><h2>Não foi possível renderizar</h2><p>${escapeHtml(error.message)}</p></div>`
    }));
  }
}

export function enhancedMediaPreview(req, res) {
  const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Arquivo não encontrado.' });

  const source = originalUrl(row);
  const inline = canRenderInline(row);
  res.json({
    ...row,
    url: inline ? `/api/media/${row.id}/render` : (row.external_url ? toEmbedUrl(row.external_url, row.provider) : source),
    original_url: source,
    media_type: inline ? 'PDF' : row.media_type,
    preview_media_type: row.media_type,
    inline_preview: inline,
    sizeLabel: formatBytes(row.size_bytes),
    extracted_text: row.extracted_text || '',
    transcript: row.transcript || ''
  });
}
