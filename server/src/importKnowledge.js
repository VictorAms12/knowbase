import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, initDb, indexArticle, setArticleTags, uniqueSlug } from './db.js';
import { initOperationsDb } from './operations.js';
import { classifyMedia, extractFileText } from './extractors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const uploadDir = path.join(serverRoot, 'uploads');

const SKIP_NAMES = [
  /^thumbs\.db$/i,
  /^desktop\.ini$/i,
  /^\.ds_store$/i
];

const SKIP_KNOWLEDGE_PATTERNS = [
  /proposta comercial/i,
  /termo de treinamento/i,
  /assinado\.pdf$/i,
  /renato não enviado/i,
  /rural pet/i
];

const TEXT_PRIORITY = new Map([
  ['.docx', 100],
  ['.odt', 95],
  ['.txt', 90],
  ['.md', 90],
  ['.pdf', 80],
  ['.sql', 75],
  ['.xml', 70],
  ['.json', 70],
  ['.doc', 40],
  ['.dot', 35]
]);

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.sql': 'text/plain',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.json': 'application/json'
};

function usage() {
  console.log(`
KnowBase — Importador de conhecimento

Uso:
  npm run import:knowledge -- "/caminho/para/PASSO A PASSO DE PROCESSOS"
  npm run import:knowledge -- "/caminho/base-nortesys.rar"

Opções:
  --draft          importa como rascunho (padrão: publicado)
  --include-ada    inclui a pasta IA ADA (normalmente duplicados/testes)
  --include-all    inclui documentos comerciais/termos que são ignorados por padrão
  --dry-run        analisa e mostra o que seria importado sem alterar o banco
  --keep-temp      não remove a pasta temporária criada ao extrair arquivo compactado
`);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter(x => x.startsWith('--')));
  const source = argv.find(x => !x.startsWith('--'));
  return {
    source,
    publish: !flags.has('--draft'),
    includeAda: flags.has('--include-ada'),
    includeAll: flags.has('--include-all'),
    dryRun: flags.has('--dry-run'),
    keepTemp: flags.has('--keep-temp')
  };
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDisplayTitle(name = '') {
  let title = path.basename(name, path.extname(name));
  title = title
    .replace(/\(\s*\d+\s*\)\s*$/g, '')
    .replace(/\s+pdf\s*$/i, '')
    .replace(/^passo a passo (de|para)?\s*/i, '')
    .replace(/\s*---+\s*n[aã]o mostra.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) title = 'Material importado';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function canonicalStem(name = '') {
  return normalize(
    cleanDisplayTitle(name)
      .replace(/\(2 arquivos mesclados\)/i, '')
      .replace(/\btestes?\s+(com\s+)?(ia\s+)?ada\b/gi, '')
      .replace(/\bia\s+ada\b/gi, '')
      .replace(/\bnortesys\b/gi, '')
  );
}

function isOpaqueAudio(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.mp3', '.m4a', '.wav', '.ogg'].includes(ext)) return false;
  const stem = path.basename(filePath, ext);
  return /^grava(c[aã]o|ndo)/i.test(stem) || /^[a-f0-9]{12,}$/i.test(stem);
}

function isOpaqueImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return false;
  const stem = path.basename(filePath, ext);
  return /^image([ _-]|\d|$)/i.test(stem) || /^[a-f0-9-]{20,}$/i.test(stem);
}

function inferCategory(text = '', relative = '') {
  const hay = normalize(`${relative} ${text}`);
  if (/\brelatorio\b/.test(hay)) return 'Relatórios';
  if (/\b(nfc|nfe|nf e|xml|sped|pis|cofins|cfop|ncm|gnre|mdf|fiscal|sefaz)\b/.test(hay)) return 'Fiscal';
  if (/\b(estoque|inventario|produto|precificacao|preco|perda|grade|promocao)\b/.test(hay)) return 'Produtos e Estoque';
  if (/\b(caixa|contas a pagar|contas a receber|boleto|duplicata|cartao|comissao|cashback|banco|tesouraria|juros|multa|adiantamento|pagamento|parcelamento)\b/.test(hay)) return 'Financeiro';
  if (/\b(venda|orcamento|frete|devolucao|troca|pre venda|faturamento)\b/.test(hay)) return 'Vendas';
  if (/\b(cadastro|usuario|funcionario|cliente|fornecedor|municipio|cidade|permiss)\b/.test(hay)) return 'Cadastros';
  if (/\b(tef|configuracao|parametro|implantacao)\b/.test(hay)) return 'Configuração e Implantação';
  return 'Nortesys';
}

function inferTags(title, category, relative) {
  const hay = normalize(`${title} ${relative}`);
  const tags = new Set(['Nortesys', 'Importado', category]);
  const map = [
    ['NFC-e', /\bnfc\b/], ['NF-e', /\bnfe\b|\bnf e\b/], ['XML', /\bxml\b/],
    ['SPED', /\bsped\b/], ['NCM', /\bncm\b/], ['SEFAZ', /\bsefaz\b/],
    ['Caixa', /\bcaixa\b/], ['Contas a Pagar', /\bcontas a pagar\b/],
    ['Contas a Receber', /\bcontas a receber\b/], ['Cartões', /\bcartao\b/],
    ['Comissão', /\bcomissao\b/], ['Cashback', /\bcashback\b/], ['TEF', /\btef\b/],
    ['Estoque', /\bestoque\b/], ['Inventário', /\binventario\b/],
    ['Vendas', /\bvenda\b/], ['Relatório', /\brelatorio\b/],
    ['Boleto', /\bboleto\b/], ['Duplicatas', /\bduplicata\b/],
    ['Clientes', /\bcliente\b/], ['Usuários', /\busuario\b/],
    ['Produtos', /\bproduto\b/], ['Frete', /\bfrete\b/], ['Devolução', /\bdevolucao\b|\btroca\b/]
  ];
  for (const [tag, regex] of map) if (regex.test(hay)) tags.add(tag);
  return [...tags].slice(0, 20);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function cleanExtractedText(value = '') {
  return String(value)
    .replace(/\u200b/g, '')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

function parseProcedureSteps(value = '') {
  const lines = cleanExtractedText(value).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const raw = [];
  const numbered = /^\s*(?:passo\s+)?(\d{1,3})\s*[\.\)\-:º°]?\s*(.*)$/i;
  let current = null;

  for (const line of lines) {
    const match = line.match(numbered);
    if (match) {
      const number = Number(match[1]);
      if (number < 1 || number > 150) continue;
      if (current) raw.push(current);
      current = { number, text: match[2].trim() };
      continue;
    }
    if (current && !/^[A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ\s/&()\-]{5,}$/.test(line)) {
      current.text = `${current.text} ${line}`.trim();
    }
  }
  if (current) raw.push(current);

  const steps = [];
  const seen = new Set();
  for (const item of raw) {
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
    const title = (firstSentence.length <= 110 ? firstSentence : `${firstSentence.slice(0, 107)}…`).trim();
    steps.push({ title: title || `Passo ${steps.length + 1}`, detail: text });
  }

  if (steps.length < 2) return [];
  return steps.slice(0, 80);
}

function textToHtml(value = '', limit = 90000) {
  const text = cleanExtractedText(value).slice(0, limit);
  if (!text) return '<p>O arquivo original foi preservado nos materiais deste conteúdo.</p>';
  const paragraphs = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return paragraphs.map(block => {
    const single = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return `<p>${escapeHtml(single)}</p>`;
  }).join('\n');
}

function makeBody({ category, steps, extractedText, files }) {
  const materialNames = files.map(x => path.basename(x.fullPath));
  const parts = [
    '<p><strong>Origem:</strong> Base de conhecimento Nortesys importada automaticamente.</p>',
    `<p><strong>Categoria:</strong> ${escapeHtml(category)}.</p>`
  ];
  if (steps.length) {
    parts.push('<h2>Passo a passo</h2>');
    parts.push(`<ol>${steps.map(s => `<li>${escapeHtml(s.detail)}</li>`).join('')}</ol>`);
  }
  if (extractedText) {
    parts.push('<h2>Conteúdo de referência</h2>');
    parts.push(textToHtml(extractedText));
  }
  if (materialNames.length) {
    parts.push('<h2>Materiais de origem</h2>');
    parts.push(`<ul>${materialNames.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`);
  }
  return parts.join('\n');
}

function bestTitleFile(files) {
  const descriptive = files.filter(x => !isOpaqueAudio(x.fullPath) && !isOpaqueImage(x.fullPath));
  const list = descriptive.length ? descriptive : files;
  return [...list].sort((a, b) => {
    const pa = TEXT_PRIORITY.get(path.extname(a.fullPath).toLowerCase()) || 0;
    const pb = TEXT_PRIORITY.get(path.extname(b.fullPath).toLowerCase()) || 0;
    return pb - pa || path.basename(a.fullPath).length - path.basename(b.fullPath).length;
  })[0];
}

function groupKeyFor(relative, fullPath) {
  if (isOpaqueAudio(fullPath)) return 'nortesys|materiais-em-audio';
  if (isOpaqueImage(fullPath)) return 'nortesys|materiais-visuais';
  const parts = relative.split(path.sep).filter(Boolean);
  const parent = parts.slice(0, -1).filter(x => !/^passo a passo de processos$/i.test(x) && !/^ia ada$/i.test(x));
  const parentKey = parent.map(normalize).filter(Boolean).join('|');
  return `${parentKey || 'nortesys'}|${canonicalStem(path.basename(relative))}`;
}

async function walk(root) {
  const out = [];
  async function visit(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) out.push(fullPath);
    }
  }
  await visit(root);
  return out;
}

function commandExists(command) {
  const result = spawnSync(command, ['--help'], { stdio: 'ignore' });
  return !result.error;
}

function runExtractor(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status === 0;
}

async function prepareSource(sourcePath) {
  const stat = await fsp.stat(sourcePath);
  if (stat.isDirectory()) return { root: sourcePath, cleanup: null };
  const ext = path.extname(sourcePath).toLowerCase();
  if (!['.rar', '.zip', '.7z'].includes(ext)) {
    return { root: path.dirname(sourcePath), singleFile: sourcePath, cleanup: null };
  }

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'knowbase-import-'));
  let ok = false;
  if (ext === '.rar') {
    if (commandExists('unrar')) ok = runExtractor('unrar', ['x', '-o+', '-y', sourcePath, `${temp}${path.sep}`]);
    if (!ok && commandExists('7z')) ok = runExtractor('7z', ['x', '-y', `-o${temp}`, sourcePath]);
    if (!ok && commandExists('7zz')) ok = runExtractor('7zz', ['x', '-y', `-o${temp}`, sourcePath]);
    if (!ok && commandExists('7za')) ok = runExtractor('7za', ['x', '-y', `-o${temp}`, sourcePath]);
    if (!ok && commandExists('unar')) ok = runExtractor('unar', ['-force-overwrite', '-output-directory', temp, sourcePath]);
  } else {
    if (commandExists('7z')) ok = runExtractor('7z', ['x', '-y', `-o${temp}`, sourcePath]);
    if (!ok && commandExists('7zz')) ok = runExtractor('7zz', ['x', '-y', `-o${temp}`, sourcePath]);
    if (!ok && commandExists('unzip')) ok = runExtractor('unzip', ['-o', sourcePath, '-d', temp]);
  }

  if (!ok) {
    await fsp.rm(temp, { recursive: true, force: true });
    throw new Error(`Não foi possível extrair ${path.basename(sourcePath)}. Instale um extrator compatível (Termux: "pkg install 7zip" ou "pkg install unrar") e execute novamente.`);
  }
  return { root: temp, cleanup: temp };
}

function shouldSkip(relative, options) {
  const base = path.basename(relative);
  if (SKIP_NAMES.some(rx => rx.test(base))) return 'sistema';
  if (!options.includeAda && /(^|[\\/])IA ADA([\\/]|$)/i.test(relative)) return 'ia-ada';
  if (!options.includeAll && SKIP_KNOWLEDGE_PATTERNS.some(rx => rx.test(relative))) return 'nao-kb';
  return null;
}

function sourceHash(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.relative.localeCompare(b.relative))) {
    const stat = fs.statSync(file.fullPath);
    hash.update(`${file.relative}|${stat.size}|${stat.mtimeMs}\n`);
  }
  return hash.digest('hex');
}

function storageName(relative) {
  const ext = path.extname(relative).toLowerCase();
  const stem = path.basename(relative, ext)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'arquivo';
  const key = crypto.createHash('sha1').update(relative).digest('hex').slice(0, 12);
  return `import-${key}-${stem}${ext}`;
}

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function articleType(files, steps) {
  if (files.some(x => ['.mp4', '.webm', '.mp3', '.m4a'].includes(path.extname(x.fullPath).toLowerCase()))) return 'VIDEO_TRAINING';
  if (steps.length) return 'GUIDE';
  return 'MANUAL';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.source || ['-h', '--help'].includes(options.source)) {
    usage();
    process.exit(options.source ? 0 : 1);
  }

  const sourcePath = path.resolve(options.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`Caminho não encontrado: ${sourcePath}`);

  const prepared = await prepareSource(sourcePath);
  const root = prepared.root;
  try {
    const allFiles = prepared.singleFile ? [prepared.singleFile] : await walk(root);
    const skipped = { sistema: 0, 'ia-ada': 0, 'nao-kb': 0 };
    const groups = new Map();

    for (const fullPath of allFiles) {
      const relative = prepared.singleFile ? path.basename(fullPath) : path.relative(root, fullPath);
      const reason = shouldSkip(relative, options);
      if (reason) { skipped[reason]++; continue; }
      const key = groupKeyFor(relative, fullPath);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ fullPath, relative });
    }

    console.log(`\nFonte: ${sourcePath}`);
    console.log(`Arquivos encontrados: ${allFiles.length}`);
    console.log(`Grupos de conhecimento: ${groups.size}`);
    console.log(`Ignorados: sistema=${skipped.sistema}, IA ADA=${skipped['ia-ada']}, não-KB=${skipped['nao-kb']}`);

    if (options.dryRun) {
      for (const [key, files] of groups) console.log(`- ${key}: ${files.map(x => path.basename(x.relative)).join(', ')}`);
      return;
    }

    await fsp.mkdir(uploadDir, { recursive: true });
    initDb();
    initOperationsDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_import_sources (
        source_key TEXT PRIMARY KEY,
        article_id INTEGER NOT NULL,
        source_path TEXT NOT NULL,
        source_hash TEXT NOT NULL DEFAULT '',
        source_group TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_import_article ON knowledge_import_sources(article_id);
    `);

    const admin = db.prepare(`SELECT id FROM users ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END,id LIMIT 1`).get();
    if (!admin) throw new Error('Nenhum usuário disponível para atribuir autoria.');

    const stats = { created: 0, skippedExisting: 0, attachments: 0, procedures: 0, steps: 0, errors: 0 };

    for (const [sourceKey, files] of groups) {
      if (db.prepare('SELECT 1 FROM knowledge_import_sources WHERE source_key=?').get(sourceKey)) {
        stats.skippedExisting++;
        continue;
      }

      try {
        const titleFile = bestTitleFile(files);
        const title = sourceKey.endsWith('|materiais-em-audio')
          ? 'Treinamentos em áudio — Nortesys'
          : sourceKey.endsWith('|materiais-visuais')
            ? 'Materiais visuais — Nortesys'
            : cleanDisplayTitle(titleFile.relative);

        const category = inferCategory(title, files.map(x => x.relative).join(' '));
        const extracted = new Map();
        const textCandidates = [...files].sort((a, b) => {
          const pa = TEXT_PRIORITY.get(path.extname(a.fullPath).toLowerCase()) || 0;
          const pb = TEXT_PRIORITY.get(path.extname(b.fullPath).toLowerCase()) || 0;
          return pb - pa;
        });

        let bestText = '';
        for (const file of textCandidates) {
          const mime = mimeFor(file.fullPath);
          const text = cleanExtractedText(await extractFileText(file.fullPath, mime, path.basename(file.fullPath)));
          extracted.set(file.fullPath, text);
          if (text.length > bestText.length) bestText = text;
        }

        const steps = parseProcedureSteps(bestText);
        const type = articleType(files, steps);
        const tags = inferTags(title, category, files.map(x => x.relative).join(' '));
        const description = steps.length
          ? `Procedimento Nortesys importado com ${steps.length} etapas. Categoria: ${category}.`
          : `Material Nortesys importado da base de conhecimento. Categoria: ${category}.`;

        const slug = uniqueSlug(title);
        const status = options.publish ? 'PUBLISHED' : 'DRAFT';
        const bodyHtml = makeBody({ category, steps, extractedText: bestText, files });
        const result = db.prepare(`
          INSERT INTO articles(title,slug,type,description,body_html,status,author_id,published_at,updated_at)
          VALUES(?,?,?,?,?,?,?,CASE WHEN ?='PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)
        `).run(title, slug, type, description, bodyHtml, status, admin.id, status);
        const articleId = Number(result.lastInsertRowid);

        setArticleTags(articleId, tags);

        if (steps.length) {
          const insertStep = db.prepare(`INSERT INTO procedure_steps(article_id,sort_order,title,detail) VALUES(?,?,?,?)`);
          steps.forEach((step, index) => insertStep.run(articleId, index + 1, step.title, step.detail));
          stats.procedures++;
          stats.steps += steps.length;
        }

        db.prepare(`
          INSERT OR IGNORE INTO article_governance(article_id,last_reviewed_at,next_review_at,reviewed_by,review_interval_days)
          VALUES(?,NULL,CURRENT_TIMESTAMP,NULL,90)
        `).run(articleId);

        for (const file of files) {
          const target = path.join(uploadDir, storageName(file.relative));
          await fsp.copyFile(file.fullPath, target);
          const stat = await fsp.stat(target);
          const mime = mimeFor(file.fullPath);
          const mediaType = classifyMedia(mime, path.basename(file.fullPath));
          const text = extracted.has(file.fullPath)
            ? extracted.get(file.fullPath)
            : cleanExtractedText(await extractFileText(file.fullPath, mime, path.basename(file.fullPath)));
          db.prepare(`
            INSERT INTO media_assets(article_id,name,original_name,mime_type,media_type,size_bytes,storage_path,extracted_text)
            VALUES(?,?,?,?,?,?,?,?)
          `).run(articleId, path.basename(file.relative), path.basename(file.relative), mime, mediaType, stat.size, target, text.slice(0, 1_500_000));
          stats.attachments++;
        }

        db.prepare(`INSERT INTO knowledge_import_sources(source_key,article_id,source_path,source_hash,source_group) VALUES(?,?,?,?,?)`)
          .run(sourceKey, articleId, sourcePath, sourceHash(files), category);

        indexArticle(articleId);
        stats.created++;
        console.log(`✓ ${title}${steps.length ? ` (${steps.length} passos)` : ''}`);
      } catch (error) {
        stats.errors++;
        console.error(`✗ ${sourceKey}: ${error.message}`);
      }
    }

    console.log('\nImportação concluída.');
    console.log(JSON.stringify(stats, null, 2));
    console.log('\nOs conteúdos importados foram marcados para revisão imediata na tela Revisões.');
  } finally {
    if (prepared.cleanup && !options.keepTemp) await fsp.rm(prepared.cleanup, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`\nErro no importador: ${error.message}`);
  process.exitCode = 1;
});
