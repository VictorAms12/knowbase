import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'knowbase.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

let ftsEnabled = false;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'CONSULTANT',
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'GUIDE',
  description TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  author_id INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  media_type TEXT NOT NULL DEFAULT 'DOCUMENT',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT,
  external_url TEXT,
  provider TEXT,
  extracted_text TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS troubleshooting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_code TEXT,
  error_message TEXT NOT NULL,
  root_cause TEXT NOT NULL DEFAULT '',
  solution_html TEXT NOT NULL DEFAULT '',
  validation_steps TEXT NOT NULL DEFAULT '',
  article_id INTEGER,
  tested INTEGER NOT NULL DEFAULT 0,
  tested_by INTEGER,
  tested_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL,
  FOREIGN KEY (tested_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  useful INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, user_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS favorites (
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(article_id, user_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS edit_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS training_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS video_progress (
  media_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(media_id, user_id),
  FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_status_updated ON articles(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_article ON media_assets(article_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media_assets(media_type);
CREATE INDEX IF NOT EXISTS idx_troubleshooting_code ON troubleshooting(error_code);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id, created_at DESC);
`;

export function slugify(value = '') {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `artigo-${Date.now()}`;
}

export function initDb() {
  db.exec(schema);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        title,
        content,
        tags,
        files,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    ftsEnabled = true;
  } catch {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_fts (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        files TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_search_entity ON search_fts(entity_type, entity_id);
    `);
  }

  seed();
  rebuildSearchIndex();
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    db.prepare(`INSERT INTO users(name,email,role) VALUES(?,?,?)`)
      .run('Administrador KnowBase', 'admin@knowbase.local', 'ADMIN');
    db.prepare(`INSERT INTO users(name,email,role) VALUES(?,?,?)`)
      .run('Consultor Demo', 'consultor@knowbase.local', 'CONSULTANT');
  }

  const articleCount = db.prepare('SELECT COUNT(*) AS c FROM articles').get().c;
  if (articleCount === 0) {
    const adminId = db.prepare(`SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1`).get().id;
    const insert = db.prepare(`
      INSERT INTO articles(title,slug,type,description,body_html,status,author_id,published_at)
      VALUES(?,?,?,?,?,'PUBLISHED',?,CURRENT_TIMESTAMP)
    `);
    insert.run(
      'Como documentar uma solução de suporte',
      'como-documentar-uma-solucao-de-suporte',
      'GUIDE',
      'Modelo de artigo reutilizável para transformar atendimentos em conhecimento pesquisável.',
      `<h2>Antes de começar</h2><p>Registre a mensagem de erro exata, o ambiente e o impacto.</p>
       <h2>Estrutura recomendada</h2><ol><li>Sintoma</li><li>Causa</li><li>Diagnóstico</li><li>Solução</li><li>Validação</li></ol>
       <pre><code>Inclua comandos, consultas e saídas esperadas quando forem relevantes.</code></pre>`,
      adminId
    );
    insert.run(
      'Treinamento: triagem de incidentes',
      'treinamento-triagem-de-incidentes',
      'VIDEO_TRAINING',
      'Fluxo de triagem para identificar impacto, escopo, evidência e próxima camada de investigação.',
      `<h2>Objetivo</h2><p>Reduzir repasses sem evidência e padronizar o diagnóstico inicial.</p>
       <p>Use a área de materiais para anexar vídeo, transcrição, checklist e manual.</p>`,
      adminId
    );
  }

  const troubleshootingCount = db.prepare('SELECT COUNT(*) AS c FROM troubleshooting').get().c;
  if (troubleshootingCount === 0) {
    db.prepare(`
      INSERT INTO troubleshooting(error_code,error_message,root_cause,solution_html,validation_steps,article_id,tested,tested_by,tested_at)
      VALUES(?,?,?,?,?,?,1,1,CURRENT_TIMESTAMP)
    `).run(
      '539',
      'Duplicidade de NF-e com diferença na Chave de Acesso',
      'Numeração já utilizada com campos que alteram a chave de acesso.',
      '<p>Confirme chave, série, número, ambiente e XML antes de qualquer alteração. Siga o procedimento fiscal autorizado para o cenário.</p>',
      'Consultar novamente o documento na SEFAZ e validar que a sequência documental permaneceu íntegra.',
      null
    );
  }
}

export function setArticleTags(articleId, tagNames = []) {
  db.prepare('DELETE FROM article_tags WHERE article_id=?').run(articleId);
  const clean = [...new Set(tagNames.map(t => String(t).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 30);
  const insertTag = db.prepare('INSERT INTO tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING');
  const tagId = db.prepare('SELECT id FROM tags WHERE name=?');
  const link = db.prepare('INSERT OR IGNORE INTO article_tags(article_id,tag_id) VALUES(?,?)');
  for (const name of clean) {
    insertTag.run(name);
    const row = tagId.get(name);
    if (row) link.run(articleId, row.id);
  }
}

export function getArticleTags(articleId) {
  return db.prepare(`
    SELECT t.name FROM tags t
    JOIN article_tags at ON at.tag_id=t.id
    WHERE at.article_id=? ORDER BY t.name
  `).all(articleId).map(r => r.name);
}

function searchDelete(entityType, entityId) {
  db.prepare('DELETE FROM search_fts WHERE entity_type=? AND entity_id=?')
    .run(entityType, String(entityId));
}

function searchInsert(entityType, entityId, title, content, tags = '', files = '') {
  db.prepare(`
    INSERT INTO search_fts(entity_type,entity_id,title,content,tags,files)
    VALUES(?,?,?,?,?,?)
  `).run(entityType, String(entityId), title || '', content || '', tags || '', files || '');
}

export function indexArticle(articleId) {
  const a = db.prepare(`
    SELECT a.*, u.name author_name
    FROM articles a JOIN users u ON u.id=a.author_id WHERE a.id=?
  `).get(articleId);
  if (!a) return;
  const tags = getArticleTags(articleId).join(' ');
  const media = db.prepare(`
    SELECT original_name, extracted_text, transcript FROM media_assets WHERE article_id=?
  `).all(articleId);
  const fileNames = media.map(m => m.original_name).join(' ');
  const attachmentText = media.map(m => `${m.extracted_text || ''} ${m.transcript || ''}`).join(' ');
  searchDelete('article', articleId);
  searchInsert(
    'article',
    articleId,
    a.title,
    `${a.description} ${stripHtml(a.body_html)} ${attachmentText} ${a.author_name}`,
    tags,
    fileNames
  );
}

export function indexTroubleshooting(id) {
  const t = db.prepare('SELECT * FROM troubleshooting WHERE id=?').get(id);
  if (!t) return;
  searchDelete('problem', id);
  searchInsert(
    'problem',
    id,
    `${t.error_code ? `${t.error_code} — ` : ''}${t.error_message}`,
    `${t.root_cause} ${stripHtml(t.solution_html)} ${t.validation_steps}`,
    'troubleshooting problema erro',
    ''
  );
}

export function rebuildSearchIndex() {
  db.exec('DELETE FROM search_fts');
  for (const row of db.prepare('SELECT id FROM articles').all()) indexArticle(row.id);
  for (const row of db.prepare('SELECT id FROM troubleshooting').all()) indexTroubleshooting(row.id);
}

export function searchKnowledge(query, limit = 30) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (ftsEnabled) {
    const terms = q.split(/\s+/).map(x => x.replace(/["']/g, '')).filter(Boolean);
    if (!terms.length) return [];
    const match = terms.map(t => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
    try {
      return db.prepare(`
        SELECT entity_type, entity_id, title,
               snippet(search_fts, 3, '<mark>', '</mark>', '…', 18) AS snippet,
               bm25(search_fts, 1.0, 4.0, 1.2, 1.5) AS rank
        FROM search_fts WHERE search_fts MATCH ?
        ORDER BY rank LIMIT ?
      `).all(match, limit);
    } catch {
      // malformed user input falls through to LIKE search
    }
  }
  const like = `%${q}%`;
  return db.prepare(`
    SELECT entity_type, entity_id, title,
           substr(content,1,260) AS snippet, 0 AS rank
    FROM search_fts
    WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? OR files LIKE ?
    LIMIT ?
  `).all(like, like, like, like, limit);
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function uniqueSlug(title, currentId = null) {
  const base = slugify(title);
  let candidate = base;
  let n = 2;
  while (true) {
    const row = currentId
      ? db.prepare('SELECT id FROM articles WHERE slug=? AND id<>?').get(candidate, currentId)
      : db.prepare('SELECT id FROM articles WHERE slug=?').get(candidate);
    if (!row) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export function isFtsEnabled() {
  return ftsEnabled;
}
