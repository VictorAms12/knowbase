import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';
import {
  db,
  initDb,
  getArticleTags,
  setArticleTags,
  indexArticle,
  indexTroubleshooting,
  searchKnowledge,
  uniqueSlug,
  isFtsEnabled
} from './db.js';
import {
  classifyMedia,
  extractFileText,
  detectProvider,
  toEmbedUrl
} from './extractors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const uploadDir = path.join(serverRoot, 'uploads');
const clientDist = path.resolve(serverRoot, '../../client/dist');

fs.mkdirSync(uploadDir, { recursive: true });
initDb();

const app = express();
const port = Number(process.env.PORT || 3333);

app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir, {
  immutable: false,
  maxAge: '1h',
  fallthrough: true
}));

const allowedExtensions = new Set([
  '.pdf', '.docx', '.xlsx', '.xls', '.csv', '.pptx',
  '.mp4', '.webm', '.zip', '.sql', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.xml', '.json', '.log', '.ps1', '.bat', '.sh', '.js', '.ts'
]);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const stem = path.basename(file.originalname, ext)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 80) || 'arquivo';
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${stem}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedExtensions.has(ext));
  }
});

function currentUser(req) {
  const requested = Number(req.header('x-user-id') || 1);
  return db.prepare('SELECT * FROM users WHERE id=?').get(requested)
    || db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
}

function cleanHtml(html = '') {
  return sanitizeHtml(String(html), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'h1', 'h2', 'h3', 'h4', 'h5', 'pre', 'code',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'img', 'figure', 'figcaption', 'mark', 'hr'
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class']
    },
    allowedSchemes: ['http', 'https', 'data'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)
    }
  });
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map(v => v.trim().replace(/^#/, ''))
    .filter(Boolean);
}

function mediaUrl(row) {
  if (!row) return null;
  if (row.external_url) return toEmbedUrl(row.external_url, row.provider);
  if (!row.storage_path) return null;
  return `/uploads/${path.basename(row.storage_path)}`;
}

function hydrateMedia(row) {
  if (!row) return row;
  return {
    ...row,
    url: mediaUrl(row),
    sizeLabel: formatBytes(row.size_bytes)
  };
}

function hydrateArticle(row, userId = 1, full = false) {
  if (!row) return null;
  const tags = getArticleTags(row.id);
  const media = db.prepare(`
    SELECT * FROM media_assets WHERE article_id=? ORDER BY created_at DESC
  `).all(row.id).map(hydrateMedia);
  const feedback = db.prepare(`
    SELECT
      SUM(CASE WHEN useful=1 THEN 1 ELSE 0 END) yes_count,
      SUM(CASE WHEN useful=0 THEN 1 ELSE 0 END) no_count
    FROM feedback WHERE article_id=?
  `).get(row.id);
  const favorite = Boolean(db.prepare(`
    SELECT 1 FROM favorites WHERE article_id=? AND user_id=?
  `).get(row.id, userId));
  const base = {
    ...row,
    tags,
    media,
    feedback: {
      yes: Number(feedback?.yes_count || 0),
      no: Number(feedback?.no_count || 0)
    },
    favorite
  };
  if (full) {
    base.comments = db.prepare(`
      SELECT c.*, u.name user_name, u.role user_role, u.avatar_url
      FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.article_id=? ORDER BY c.created_at ASC
    `).all(row.id);
  }
  return base;
}

function getArticleRow(idOrSlug) {
  const numeric = /^\d+$/.test(String(idOrSlug));
  return numeric
    ? db.prepare(`
        SELECT a.*, u.name author_name, u.email author_email
        FROM articles a JOIN users u ON u.id=a.author_id WHERE a.id=?
      `).get(Number(idOrSlug))
    : db.prepare(`
        SELECT a.*, u.name author_name, u.email author_email
        FROM articles a JOIN users u ON u.id=a.author_id WHERE a.slug=?
      `).get(String(idOrSlug));
}

function articleMediaFilter(article, mediaFilter) {
  if (!mediaFilter || mediaFilter === 'ALL') return true;
  if (mediaFilter === 'VIDEO') return article.media.some(m => m.media_type === 'VIDEO');
  if (mediaFilter === 'PDF') return article.media.some(m => m.media_type === 'PDF');
  if (mediaFilter === 'DOCUMENT') return article.media.some(m => ['DOCUMENT', 'SPREADSHEET', 'PRESENTATION'].includes(m.media_type));
  return article.media.some(m => m.media_type === mediaFilter);
}

function formatBytes(bytes = 0) {
  const n = Number(bytes || 0);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'knowbase-api',
    fts: isFtsEnabled(),
    node: process.version
  });
});

app.get('/api/me', (req, res) => {
  res.json(currentUser(req));
});

app.get('/api/users', (_req, res) => {
  res.json(db.prepare(`
    SELECT id,name,email,role,avatar_url,created_at FROM users ORDER BY name
  `).all());
});

app.get('/api/dashboard', (req, res) => {
  const user = currentUser(req);
  const stats = {
    published: db.prepare(`SELECT COUNT(*) c FROM articles WHERE status='PUBLISHED'`).get().c,
    drafts: db.prepare(`SELECT COUNT(*) c FROM articles WHERE status='DRAFT'`).get().c,
    videos: db.prepare(`SELECT COUNT(*) c FROM media_assets WHERE media_type='VIDEO'`).get().c,
    manuals: db.prepare(`SELECT COUNT(*) c FROM media_assets WHERE media_type='PDF'`).get().c,
    problems: db.prepare(`SELECT COUNT(*) c FROM troubleshooting`).get().c,
    tested: db.prepare(`SELECT COUNT(*) c FROM troubleshooting WHERE tested=1`).get().c
  };
  const recent = db.prepare(`
    SELECT a.*,u.name author_name
    FROM articles a JOIN users u ON u.id=a.author_id
    WHERE a.status='PUBLISHED'
    ORDER BY a.updated_at DESC LIMIT 6
  `).all().map(r => hydrateArticle(r, user.id));
  const popular = db.prepare(`
    SELECT a.*,u.name author_name
    FROM articles a JOIN users u ON u.id=a.author_id
    WHERE a.status='PUBLISHED'
    ORDER BY a.views DESC, a.updated_at DESC LIMIT 6
  `).all().map(r => hydrateArticle(r, user.id));
  const training = db.prepare(`
    SELECT m.*,a.title article_title,a.slug article_slug
    FROM media_assets m
    LEFT JOIN articles a ON a.id=m.article_id
    WHERE m.media_type='VIDEO'
    ORDER BY m.created_at DESC LIMIT 6
  `).all().map(hydrateMedia);
  res.json({ stats, recent, popular, training });
});

app.get('/api/articles', (req, res) => {
  const user = currentUser(req);
  const status = String(req.query.status || 'PUBLISHED').toUpperCase();
  const type = String(req.query.type || 'ALL').toUpperCase();
  const author = Number(req.query.author || 0);
  const tag = String(req.query.tag || '').trim().toLowerCase();
  const favoriteOnly = String(req.query.favorite || '') === '1';
  const media = String(req.query.media || 'ALL').toUpperCase();

  let rows = db.prepare(`
    SELECT a.*,u.name author_name,u.email author_email
    FROM articles a JOIN users u ON u.id=a.author_id
    WHERE (?='ALL' OR a.status=?)
      AND (?='ALL' OR a.type=?)
      AND (?=0 OR a.author_id=?)
    ORDER BY a.updated_at DESC
  `).all(status, status, type, type, author, author);

  let articles = rows.map(r => hydrateArticle(r, user.id));
  if (tag) articles = articles.filter(a => a.tags.some(t => t.toLowerCase() === tag));
  if (favoriteOnly) articles = articles.filter(a => a.favorite);
  if (media !== 'ALL') articles = articles.filter(a => articleMediaFilter(a, media));
  res.json(articles);
});

app.get('/api/articles/:idOrSlug', (req, res) => {
  const user = currentUser(req);
  const row = getArticleRow(req.params.idOrSlug);
  if (!row) return res.status(404).json({ error: 'Artigo não encontrado.' });
  res.json(hydrateArticle(row, user.id, true));
});

app.post('/api/articles', (req, res) => {
  const user = currentUser(req);
  const {
    title,
    type = 'GUIDE',
    description = '',
    bodyHtml = '',
    status = 'DRAFT',
    tags = [],
    mediaIds = []
  } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Título é obrigatório.' });

  const slug = uniqueSlug(title);
  const result = db.prepare(`
    INSERT INTO articles(title,slug,type,description,body_html,status,author_id,published_at,updated_at)
    VALUES(?,?,?,?,?,?,?,CASE WHEN ?='PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)
  `).run(
    String(title).trim(),
    slug,
    String(type).toUpperCase(),
    String(description || '').trim(),
    cleanHtml(bodyHtml),
    String(status).toUpperCase(),
    user.id,
    String(status).toUpperCase()
  );
  const id = Number(result.lastInsertRowid);
  setArticleTags(id, parseTags(tags));
  if (Array.isArray(mediaIds) && mediaIds.length) {
    const stmt = db.prepare('UPDATE media_assets SET article_id=? WHERE id=?');
    for (const mediaId of mediaIds) stmt.run(id, Number(mediaId));
  }
  indexArticle(id);
  res.status(201).json(hydrateArticle(getArticleRow(id), user.id, true));
});

app.put('/api/articles/:id', (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  const existing = getArticleRow(id);
  if (!existing) return res.status(404).json({ error: 'Artigo não encontrado.' });

  const {
    title = existing.title,
    type = existing.type,
    description = existing.description,
    bodyHtml = existing.body_html,
    status = existing.status,
    tags = getArticleTags(id),
    mediaIds
  } = req.body || {};
  const nextStatus = String(status).toUpperCase();
  const nextTitle = String(title).trim() || existing.title;
  const nextSlug = uniqueSlug(nextTitle, id);

  db.prepare(`
    UPDATE articles
    SET title=?,slug=?,type=?,description=?,body_html=?,status=?,updated_at=CURRENT_TIMESTAMP,
        published_at=CASE
          WHEN ?='PUBLISHED' AND published_at IS NULL THEN CURRENT_TIMESTAMP
          WHEN ?<>'PUBLISHED' THEN NULL
          ELSE published_at
        END
    WHERE id=?
  `).run(
    nextTitle,
    nextSlug,
    String(type).toUpperCase(),
    String(description || '').trim(),
    cleanHtml(bodyHtml),
    nextStatus,
    nextStatus,
    nextStatus,
    id
  );

  setArticleTags(id, parseTags(tags));
  if (Array.isArray(mediaIds)) {
    db.prepare('UPDATE media_assets SET article_id=NULL WHERE article_id=?').run(id);
    const attach = db.prepare('UPDATE media_assets SET article_id=? WHERE id=?');
    for (const mediaId of mediaIds) attach.run(id, Number(mediaId));
  }
  indexArticle(id);
  res.json(hydrateArticle(getArticleRow(id), user.id, true));
});

app.delete('/api/articles/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getArticleRow(id);
  if (!existing) return res.status(404).json({ error: 'Artigo não encontrado.' });
  db.prepare('DELETE FROM search_fts WHERE entity_type=? AND entity_id=?').run('article', String(id));
  db.prepare('DELETE FROM articles WHERE id=?').run(id);
  res.status(204).end();
});

app.post('/api/articles/:id/view', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE articles SET views=views+1 WHERE id=?').run(id);
  res.json({ ok: true });
});

app.post('/api/articles/:id/feedback', (req, res) => {
  const user = currentUser(req);
  const articleId = Number(req.params.id);
  const useful = req.body?.useful ? 1 : 0;
  db.prepare(`
    INSERT INTO feedback(article_id,user_id,useful) VALUES(?,?,?)
    ON CONFLICT(article_id,user_id) DO UPDATE SET useful=excluded.useful,created_at=CURRENT_TIMESTAMP
  `).run(articleId, user.id, useful);
  res.json(hydrateArticle(getArticleRow(articleId), user.id));
});

app.post('/api/articles/:id/comments', (req, res) => {
  const user = currentUser(req);
  const articleId = Number(req.params.id);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comentário vazio.' });
  const result = db.prepare(`
    INSERT INTO comments(article_id,user_id,body) VALUES(?,?,?)
  `).run(articleId, user.id, body.slice(0, 5000));
  const comment = db.prepare(`
    SELECT c.*,u.name user_name,u.role user_role,u.avatar_url
    FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?
  `).get(Number(result.lastInsertRowid));
  res.status(201).json(comment);
});

app.post('/api/articles/:id/favorite', (req, res) => {
  const user = currentUser(req);
  const articleId = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM favorites WHERE article_id=? AND user_id=?')
    .get(articleId, user.id);
  if (exists) {
    db.prepare('DELETE FROM favorites WHERE article_id=? AND user_id=?').run(articleId, user.id);
    return res.json({ favorite: false });
  }
  db.prepare('INSERT INTO favorites(article_id,user_id) VALUES(?,?)').run(articleId, user.id);
  res.json({ favorite: true });
});

app.post('/api/articles/:id/suggestions', (req, res) => {
  const user = currentUser(req);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Descreva a sugestão.' });
  const result = db.prepare(`
    INSERT INTO edit_suggestions(article_id,user_id,body) VALUES(?,?,?)
  `).run(Number(req.params.id), user.id, body.slice(0, 8000));
  res.status(201).json({ id: Number(result.lastInsertRowid), status: 'OPEN' });
});

app.get('/api/tags', (_req, res) => {
  res.json(db.prepare(`
    SELECT t.id,t.name,COUNT(at.article_id) usage_count
    FROM tags t LEFT JOIN article_tags at ON at.tag_id=t.id
    GROUP BY t.id,t.name ORDER BY usage_count DESC,t.name ASC
  `).all());
});

app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado ou formato não permitido.' });
  const articleId = req.body?.articleId ? Number(req.body.articleId) : null;
  const mediaType = classifyMedia(req.file.mimetype, req.file.originalname);
  const extractedText = await extractFileText(req.file.path, req.file.mimetype, req.file.originalname);
  const transcript = String(req.body?.transcript || '').slice(0, 1_500_000);

  const result = db.prepare(`
    INSERT INTO media_assets(
      article_id,name,original_name,mime_type,media_type,size_bytes,storage_path,extracted_text,transcript
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    articleId,
    req.file.originalname,
    req.file.originalname,
    req.file.mimetype || 'application/octet-stream',
    mediaType,
    req.file.size,
    req.file.path,
    extractedText,
    transcript
  );
  const id = Number(result.lastInsertRowid);
  if (articleId) indexArticle(articleId);
  res.status(201).json(hydrateMedia(db.prepare('SELECT * FROM media_assets WHERE id=?').get(id)));
});

app.post('/api/media/external', (req, res) => {
  const {
    url,
    name = 'Vídeo externo',
    articleId = null,
    transcript = ''
  } = req.body || {};
  if (!String(url || '').trim()) return res.status(400).json({ error: 'URL é obrigatória.' });
  const provider = detectProvider(url);
  const result = db.prepare(`
    INSERT INTO media_assets(
      article_id,name,original_name,mime_type,media_type,size_bytes,external_url,provider,transcript
    ) VALUES(?,?,?,?,?,0,?,?,?)
  `).run(
    articleId ? Number(articleId) : null,
    String(name).trim(),
    String(name).trim(),
    'text/uri-list',
    'VIDEO',
    String(url).trim(),
    provider,
    String(transcript || '').slice(0, 1_500_000)
  );
  const id = Number(result.lastInsertRowid);
  if (articleId) indexArticle(Number(articleId));
  res.status(201).json(hydrateMedia(db.prepare('SELECT * FROM media_assets WHERE id=?').get(id)));
});

app.get('/api/media/:id/preview', (req, res) => {
  const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.json({
    ...hydrateMedia(row),
    extracted_text: row.extracted_text || '',
    transcript: row.transcript || ''
  });
});

app.patch('/api/media/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Mídia não encontrada.' });
  const transcript = req.body?.transcript === undefined ? row.transcript : String(req.body.transcript || '').slice(0, 1_500_000);
  const name = req.body?.name === undefined ? row.name : String(req.body.name || '').trim() || row.name;
  db.prepare('UPDATE media_assets SET name=?,transcript=? WHERE id=?').run(name, transcript, id);
  if (row.article_id) indexArticle(row.article_id);
  res.json(hydrateMedia(db.prepare('SELECT * FROM media_assets WHERE id=?').get(id)));
});

app.delete('/api/media/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Mídia não encontrada.' });
  if (row.storage_path) {
    try { fs.unlinkSync(row.storage_path); } catch {}
  }
  db.prepare('DELETE FROM media_assets WHERE id=?').run(id);
  if (row.article_id) indexArticle(row.article_id);
  res.status(204).end();
});

app.get('/api/problems', (_req, res) => {
  const q = String(_req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = q
    ? db.prepare(`
        SELECT t.*,u.name tested_by_name
        FROM troubleshooting t LEFT JOIN users u ON u.id=t.tested_by
        WHERE t.error_code LIKE ? OR t.error_message LIKE ? OR t.root_cause LIKE ? OR t.solution_html LIKE ?
        ORDER BY t.updated_at DESC
      `).all(like, like, like, like)
    : db.prepare(`
        SELECT t.*,u.name tested_by_name
        FROM troubleshooting t LEFT JOIN users u ON u.id=t.tested_by
        ORDER BY t.updated_at DESC
      `).all();
  res.json(rows);
});

app.post('/api/problems', (req, res) => {
  const {
    errorCode = '',
    errorMessage,
    rootCause = '',
    solutionHtml = '',
    validationSteps = '',
    articleId = null
  } = req.body || {};
  if (!String(errorMessage || '').trim()) return res.status(400).json({ error: 'Mensagem do erro é obrigatória.' });
  const result = db.prepare(`
    INSERT INTO troubleshooting(error_code,error_message,root_cause,solution_html,validation_steps,article_id)
    VALUES(?,?,?,?,?,?)
  `).run(
    String(errorCode || '').trim(),
    String(errorMessage).trim(),
    String(rootCause || '').trim(),
    cleanHtml(solutionHtml),
    String(validationSteps || '').trim(),
    articleId ? Number(articleId) : null
  );
  const id = Number(result.lastInsertRowid);
  indexTroubleshooting(id);
  res.status(201).json(db.prepare('SELECT * FROM troubleshooting WHERE id=?').get(id));
});

app.put('/api/problems/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM troubleshooting WHERE id=?').get(id);
  if (!old) return res.status(404).json({ error: 'Problema não encontrado.' });
  const body = req.body || {};
  db.prepare(`
    UPDATE troubleshooting SET
      error_code=?,error_message=?,root_cause=?,solution_html=?,validation_steps=?,article_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    String(body.errorCode ?? old.error_code ?? '').trim(),
    String(body.errorMessage ?? old.error_message).trim(),
    String(body.rootCause ?? old.root_cause ?? '').trim(),
    cleanHtml(body.solutionHtml ?? old.solution_html ?? ''),
    String(body.validationSteps ?? old.validation_steps ?? '').trim(),
    body.articleId === undefined ? old.article_id : (body.articleId ? Number(body.articleId) : null),
    id
  );
  indexTroubleshooting(id);
  res.json(db.prepare('SELECT * FROM troubleshooting WHERE id=?').get(id));
});

app.post('/api/problems/:id/validate', (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  db.prepare(`
    UPDATE troubleshooting
    SET tested=1,tested_by=?,tested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(user.id, id);
  indexTroubleshooting(id);
  res.json(db.prepare(`
    SELECT t.*,u.name tested_by_name
    FROM troubleshooting t LEFT JOIN users u ON u.id=t.tested_by WHERE t.id=?
  `).get(id));
});

app.get('/api/search', (req, res) => {
  const user = currentUser(req);
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);

  const type = String(req.query.type || 'ALL').toUpperCase();
  const media = String(req.query.media || 'ALL').toUpperCase();
  const author = Number(req.query.author || 0);
  const from = safeDate(req.query.from);
  const to = safeDate(req.query.to);

  const hits = searchKnowledge(q, 60);
  const results = [];
  for (const hit of hits) {
    if (hit.entity_type === 'article') {
      const row = getArticleRow(hit.entity_id);
      if (!row || row.status !== 'PUBLISHED') continue;
      const article = hydrateArticle(row, user.id);
      if (type !== 'ALL' && article.type !== type) continue;
      if (author && article.author_id !== author) continue;
      if (!articleMediaFilter(article, media)) continue;
      const updated = safeDate(article.updated_at);
      if (from && updated && updated < from) continue;
      if (to && updated && updated > to) continue;
      results.push({ kind: 'article', ...hit, article });
    } else if (hit.entity_type === 'problem') {
      if (type !== 'ALL' && type !== 'TROUBLESHOOTING') continue;
      if (media !== 'ALL' || author) continue;
      const problem = db.prepare(`
        SELECT t.*,u.name tested_by_name
        FROM troubleshooting t LEFT JOIN users u ON u.id=t.tested_by WHERE t.id=?
      `).get(Number(hit.entity_id));
      if (problem) results.push({ kind: 'problem', ...hit, problem });
    }
  }
  res.json(results.slice(0, 30));
});

app.post('/api/training-requests', (req, res) => {
  const user = currentUser(req);
  const title = String(req.body?.title || '').trim();
  const details = String(req.body?.details || '').trim();
  if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });
  const result = db.prepare(`
    INSERT INTO training_requests(user_id,title,details) VALUES(?,?,?)
  `).run(user.id, title, details.slice(0, 8000));
  res.status(201).json({ id: Number(result.lastInsertRowid), status: 'OPEN' });
});

app.get('/api/requests', (_req, res) => {
  res.json({
    edits: db.prepare(`
      SELECT s.*,a.title article_title,u.name user_name
      FROM edit_suggestions s JOIN articles a ON a.id=s.article_id JOIN users u ON u.id=s.user_id
      ORDER BY s.created_at DESC
    `).all(),
    training: db.prepare(`
      SELECT r.*,u.name user_name
      FROM training_requests r JOIN users u ON u.id=r.user_id
      ORDER BY r.created_at DESC
    `).all()
  });
});

app.get('/api/video-progress/:mediaId', (req, res) => {
  const user = currentUser(req);
  const row = db.prepare(`
    SELECT * FROM video_progress WHERE media_id=? AND user_id=?
  `).get(Number(req.params.mediaId), user.id);
  res.json(row || { media_id: Number(req.params.mediaId), user_id: user.id, seconds: 0, duration: 0 });
});

app.put('/api/video-progress/:mediaId', (req, res) => {
  const user = currentUser(req);
  const mediaId = Number(req.params.mediaId);
  const seconds = Math.max(0, Number(req.body?.seconds || 0));
  const duration = Math.max(0, Number(req.body?.duration || 0));
  db.prepare(`
    INSERT INTO video_progress(media_id,user_id,seconds,duration)
    VALUES(?,?,?,?)
    ON CONFLICT(media_id,user_id)
    DO UPDATE SET seconds=excluded.seconds,duration=excluded.duration,updated_at=CURRENT_TIMESTAMP
  `).run(mediaId, user.id, seconds, duration);
  res.json({ ok: true });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o limite configurado.' : err.message });
  }
  res.status(500).json({ error: 'Erro interno do KnowBase.' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`KnowBase API em http://localhost:${port}`);
  console.log(`Busca FTS5: ${isFtsEnabled() ? 'ativa' : 'fallback LIKE'}`);
});
