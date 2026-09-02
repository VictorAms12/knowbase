import sanitizeHtml from 'sanitize-html';
import { db, getArticleTags, setArticleTags, indexArticle, searchKnowledge, stripHtml, uniqueSlug } from './db.js';

let initialized = false;

const schema = `
CREATE TABLE IF NOT EXISTS article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  changed_by INTEGER,
  change_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, version_number),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(changed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS article_governance (
  article_id INTEGER PRIMARY KEY,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  reviewed_by INTEGER,
  review_interval_days INTEGER NOT NULL DEFAULT 90,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS article_relations (
  article_id INTEGER NOT NULL,
  related_article_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'RELATED',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(article_id, related_article_id),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(related_article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS solution_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  problem_id INTEGER,
  user_id INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(problem_id) REFERENCES troubleshooting(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'SQL',
  code TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'LOW',
  min_version TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  tested INTEGER NOT NULL DEFAULT 0,
  tested_by INTEGER,
  tested_at TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(tested_by) REFERENCES users(id),
  FOREIGN KEY(author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS diagnostic_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  symptom TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tree_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  runs INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS procedure_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  command_text TEXT NOT NULL DEFAULT '',
  expected_result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS procedure_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS procedure_run_steps (
  run_id INTEGER NOT NULL,
  step_id INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  PRIMARY KEY(run_id, step_id),
  FOREIGN KEY(run_id) REFERENCES procedure_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(step_id) REFERENCES procedure_steps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_versions_article ON article_versions(article_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_governance_next ON article_governance(next_review_at);
CREATE INDEX IF NOT EXISTS idx_scripts_updated ON scripts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_diag_updated ON diagnostic_flows(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_steps_article ON procedure_steps(article_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_applications_article ON solution_applications(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created ON knowledge_activity(created_at DESC);
`;

function userFrom(req) {
  const requested = Number(req.header('x-user-id') || 1);
  return db.prepare('SELECT * FROM users WHERE id=?').get(requested)
    || db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
}

function cleanHtml(html = '') {
  return sanitizeHtml(String(html), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'h1', 'h2', 'h3', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'mark', 'hr'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      code: ['class']
    },
    allowedSchemes: ['http', 'https', 'data']
  });
}

function logActivity(userId, action, entityType, entityId, label = '') {
  try {
    db.prepare(`INSERT INTO knowledge_activity(user_id,action,entity_type,entity_id,label) VALUES(?,?,?,?,?)`)
      .run(userId || null, action, entityType, entityId || null, String(label || '').slice(0, 300));
  } catch {}
}

function ensureGovernance(articleId) {
  const existing = db.prepare('SELECT * FROM article_governance WHERE article_id=?').get(articleId);
  if (existing) return existing;
  db.prepare(`
    INSERT OR IGNORE INTO article_governance(article_id,next_review_at,review_interval_days)
    VALUES(?,datetime('now','+90 days'),90)
  `).run(articleId);
  return db.prepare('SELECT * FROM article_governance WHERE article_id=?').get(articleId);
}

function governanceStatus(row) {
  if (!row?.next_review_at) return 'UNKNOWN';
  const next = new Date(`${row.next_review_at.replace(' ', 'T')}Z`).getTime();
  const now = Date.now();
  if (next < now) return 'OVERDUE';
  if (next - now <= 14 * 86400000) return 'DUE_SOON';
  return 'CURRENT';
}

function nextVersionNumber(articleId) {
  return Number(db.prepare('SELECT COALESCE(MAX(version_number),0)+1 n FROM article_versions WHERE article_id=?').get(articleId)?.n || 1);
}

export function initOperationsDb() {
  if (initialized) return;
  db.exec(schema);
  initialized = true;

  const diagCount = Number(db.prepare('SELECT COUNT(*) c FROM diagnostic_flows').get().c || 0);
  if (!diagCount) {
    const admin = db.prepare(`SELECT id FROM users ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END,id LIMIT 1`).get();
    if (admin) {
      const tree = {
        startId: 'q1',
        nodes: [
          { id: 'q1', type: 'question', text: 'Existe um código ou mensagem de erro específica?', options: [
            { label: 'Sim', next: 'q2' }, { label: 'Não', next: 'q3' }
          ]},
          { id: 'q2', type: 'question', text: 'O erro acontece em todas as estações?', options: [
            { label: 'Sim', next: 'r1' }, { label: 'Não, apenas em uma', next: 'r2' }
          ]},
          { id: 'q3', type: 'question', text: 'Outros usuários conseguem acessar normalmente?', options: [
            { label: 'Sim', next: 'r2' }, { label: 'Não', next: 'r1' }
          ]},
          { id: 'r1', type: 'result', text: 'Priorize serviço central, servidor, banco, conectividade externa ou regra sistêmica. Colete horário, escopo e logs antes de alterar configuração.' },
          { id: 'r2', type: 'result', text: 'Priorize estação, perfil, cache, permissões, rede local e dependências específicas. Compare com uma estação funcional.' }
        ]
      };
      db.prepare(`INSERT INTO diagnostic_flows(title,symptom,description,tree_json,author_id) VALUES(?,?,?,?,?)`)
        .run('Triagem geral de falha em sistema', 'Sistema não funciona como esperado', 'Fluxo inicial para separar falha local de falha sistêmica.', JSON.stringify(tree), admin.id);
    }
  }
}

export function snapshotArticleMiddleware(req, _res, next) {
  try {
    initOperationsDb();
    const id = Number(req.params.id);
    const article = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
    if (article) {
      const user = userFrom(req);
      const version = nextVersionNumber(id);
      db.prepare(`
        INSERT INTO article_versions(article_id,version_number,title,description,type,status,body_html,tags_json,changed_by,change_note)
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, version, article.title, article.description, article.type, article.status, article.body_html,
        JSON.stringify(getArticleTags(id)), user?.id || null, String(req.body?.changeNote || 'Versão anterior salva automaticamente').slice(0, 500)
      );
      ensureGovernance(id);
      logActivity(user?.id, 'VERSION_SNAPSHOT', 'article', id, article.title);
    }
  } catch (error) {
    console.error('KnowBase version snapshot:', error);
  }
  next();
}

function articleMini(id) {
  return db.prepare(`
    SELECT a.id,a.title,a.slug,a.type,a.description,a.updated_at,a.views,u.name author_name
    FROM articles a JOIN users u ON u.id=a.author_id WHERE a.id=?
  `).get(id);
}

function relatedArticles(articleId, limit = 6) {
  const manual = db.prepare(`
    SELECT a.id,a.title,a.slug,a.type,a.description,a.updated_at,99 shared_tags,'MANUAL' relation_source
    FROM article_relations r JOIN articles a ON a.id=r.related_article_id
    WHERE r.article_id=? AND a.status='PUBLISHED'
    ORDER BY r.created_at DESC LIMIT ?
  `).all(articleId, limit);

  const auto = db.prepare(`
    SELECT a.id,a.title,a.slug,a.type,a.description,a.updated_at,COUNT(*) shared_tags,'AUTO' relation_source
    FROM article_tags mine
    JOIN article_tags other ON other.tag_id=mine.tag_id AND other.article_id<>mine.article_id
    JOIN articles a ON a.id=other.article_id
    WHERE mine.article_id=? AND a.status='PUBLISHED'
    GROUP BY a.id
    ORDER BY shared_tags DESC,a.updated_at DESC LIMIT ?
  `).all(articleId, limit);

  const seen = new Set();
  return [...manual, ...auto].filter(item => !seen.has(item.id) && seen.add(item.id)).slice(0, limit);
}

function solutionStats({ articleId = null, problemId = null }) {
  const row = articleId
    ? db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) successes FROM solution_applications WHERE article_id=?`).get(articleId)
    : db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) successes FROM solution_applications WHERE problem_id=?`).get(problemId);
  const total = Number(row?.total || 0);
  const successes = Number(row?.successes || 0);
  return { total, successes, successRate: total ? Math.round(successes * 100 / total) : null };
}

function safeTree(value) {
  const tree = typeof value === 'string' ? JSON.parse(value) : value;
  if (!tree || !Array.isArray(tree.nodes) || !tree.startId) throw new Error('Fluxo inválido. Informe startId e nodes.');
  for (const node of tree.nodes) {
    if (!node?.id || !['question', 'result'].includes(node.type) || !String(node.text || '').trim()) throw new Error('Cada nó precisa de id, type e text.');
    if (node.type === 'question' && !Array.isArray(node.options)) throw new Error('Nós de pergunta precisam de options.');
  }
  return tree;
}

export function registerOperations(app) {
  initOperationsDb();

  app.get('/api/ops/dashboard', (_req, res) => {
    const due = db.prepare(`
      SELECT a.id,a.title,a.type,g.next_review_at,g.last_reviewed_at,u.name author_name
      FROM articles a
      LEFT JOIN article_governance g ON g.article_id=a.id
      JOIN users u ON u.id=a.author_id
      WHERE a.status='PUBLISHED' AND (g.next_review_at IS NULL OR datetime(g.next_review_at)<=datetime('now','+14 days'))
      ORDER BY CASE WHEN g.next_review_at IS NULL THEN 0 ELSE 1 END,g.next_review_at ASC LIMIT 8
    `).all().map(x => ({ ...x, review_status: governanceStatus(x) }));

    const lowConfidence = db.prepare(`
      SELECT a.id,a.title,
        SUM(CASE WHEN f.useful=1 THEN 1 ELSE 0 END) yes_count,
        SUM(CASE WHEN f.useful=0 THEN 1 ELSE 0 END) no_count
      FROM articles a JOIN feedback f ON f.article_id=a.id
      GROUP BY a.id HAVING no_count>yes_count
      ORDER BY no_count DESC LIMIT 6
    `).all();

    const topScripts = db.prepare(`SELECT id,title,language,risk_level,usage_count,success_count FROM scripts ORDER BY usage_count DESC,updated_at DESC LIMIT 5`).all();
    const topSolutions = db.prepare(`
      SELECT a.id,a.title,COUNT(sa.id) uses,SUM(CASE WHEN sa.success=1 THEN 1 ELSE 0 END) successes
      FROM solution_applications sa JOIN articles a ON a.id=sa.article_id
      GROUP BY a.id ORDER BY uses DESC LIMIT 5
    `).all();
    const activity = db.prepare(`
      SELECT ka.*,u.name user_name FROM knowledge_activity ka LEFT JOIN users u ON u.id=ka.user_id
      ORDER BY ka.created_at DESC LIMIT 10
    `).all();
    const stats = {
      reviewsDue: Number(db.prepare(`SELECT COUNT(*) c FROM articles a LEFT JOIN article_governance g ON g.article_id=a.id WHERE a.status='PUBLISHED' AND (g.next_review_at IS NULL OR datetime(g.next_review_at)<=datetime('now','+14 days'))`).get().c || 0),
      scripts: Number(db.prepare('SELECT COUNT(*) c FROM scripts').get().c || 0),
      procedures: Number(db.prepare('SELECT COUNT(DISTINCT article_id) c FROM procedure_steps').get().c || 0),
      diagnostics: Number(db.prepare('SELECT COUNT(*) c FROM diagnostic_flows WHERE active=1').get().c || 0),
      openRequests: Number(db.prepare(`SELECT (SELECT COUNT(*) FROM edit_suggestions WHERE status='OPEN')+(SELECT COUNT(*) FROM training_requests WHERE status='OPEN') c`).get().c || 0)
    };
    res.json({ stats, due, lowConfidence, topScripts, topSolutions, activity });
  });

  app.get('/api/ops/reviews', (_req, res) => {
    const rows = db.prepare(`
      SELECT a.id,a.title,a.slug,a.type,a.updated_at,u.name author_name,
             g.last_reviewed_at,g.next_review_at,g.review_interval_days,ru.name reviewed_by_name
      FROM articles a JOIN users u ON u.id=a.author_id
      LEFT JOIN article_governance g ON g.article_id=a.id
      LEFT JOIN users ru ON ru.id=g.reviewed_by
      WHERE a.status='PUBLISHED' ORDER BY COALESCE(g.next_review_at,'1900-01-01') ASC
    `).all();
    res.json(rows.map(r => ({ ...r, review_status: governanceStatus(r) })));
  });

  app.post('/api/articles/:id/review', (req, res) => {
    const user = userFrom(req);
    const articleId = Number(req.params.id);
    const days = Math.max(7, Math.min(730, Number(req.body?.days || 90)));
    db.prepare(`
      INSERT INTO article_governance(article_id,last_reviewed_at,next_review_at,reviewed_by,review_interval_days)
      VALUES(?,CURRENT_TIMESTAMP,datetime('now',?),?,?)
      ON CONFLICT(article_id) DO UPDATE SET last_reviewed_at=CURRENT_TIMESTAMP,next_review_at=datetime('now',excluded.review_interval_days || ' days'),reviewed_by=excluded.reviewed_by,review_interval_days=excluded.review_interval_days
    `).run(articleId, `+${days} days`, user.id, days);
    const row = ensureGovernance(articleId);
    logActivity(user.id, 'REVIEWED', 'article', articleId, articleMini(articleId)?.title || '');
    res.json({ ...row, review_status: governanceStatus(row) });
  });

  app.get('/api/articles/:id/versions', (req, res) => {
    res.json(db.prepare(`
      SELECT v.*,u.name changed_by_name FROM article_versions v LEFT JOIN users u ON u.id=v.changed_by
      WHERE v.article_id=? ORDER BY v.version_number DESC
    `).all(Number(req.params.id)));
  });

  app.post('/api/articles/:id/versions/:versionId/restore', (req, res) => {
    const user = userFrom(req);
    const articleId = Number(req.params.id);
    const version = db.prepare('SELECT * FROM article_versions WHERE id=? AND article_id=?').get(Number(req.params.versionId), articleId);
    if (!version) return res.status(404).json({ error: 'Versão não encontrada.' });
    const current = db.prepare('SELECT * FROM articles WHERE id=?').get(articleId);
    if (!current) return res.status(404).json({ error: 'Artigo não encontrado.' });

    db.prepare(`INSERT INTO article_versions(article_id,version_number,title,description,type,status,body_html,tags_json,changed_by,change_note) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(articleId, nextVersionNumber(articleId), current.title, current.description, current.type, current.status, current.body_html, JSON.stringify(getArticleTags(articleId)), user.id, `Backup antes de restaurar v${version.version_number}`);

    db.prepare(`UPDATE articles SET title=?,slug=?,description=?,type=?,status=?,body_html=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(version.title, uniqueSlug(version.title, articleId), version.description, version.type, version.status, version.body_html, articleId);
    try { setArticleTags(articleId, JSON.parse(version.tags_json || '[]')); } catch { setArticleTags(articleId, []); }
    indexArticle(articleId);
    logActivity(user.id, 'VERSION_RESTORED', 'article', articleId, `v${version.version_number} — ${version.title}`);
    res.json({ ok: true, article: articleMini(articleId) });
  });

  app.get('/api/articles/:id/related', (req, res) => res.json(relatedArticles(Number(req.params.id))));

  app.post('/api/articles/:id/relations', (req, res) => {
    const user = userFrom(req);
    const id = Number(req.params.id);
    const related = Number(req.body?.relatedArticleId);
    if (!related || related === id) return res.status(400).json({ error: 'Conteúdo relacionado inválido.' });
    db.prepare(`INSERT OR REPLACE INTO article_relations(article_id,related_article_id,relation_type,created_by,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`)
      .run(id, related, String(req.body?.relationType || 'RELATED').toUpperCase(), user.id);
    res.json({ ok: true });
  });

  app.get('/api/articles/:id/operations', (req, res) => {
    const articleId = Number(req.params.id);
    const governance = ensureGovernance(articleId);
    const steps = db.prepare(`SELECT * FROM procedure_steps WHERE article_id=? ORDER BY sort_order,id`).all(articleId);
    const versionCount = Number(db.prepare('SELECT COUNT(*) c FROM article_versions WHERE article_id=?').get(articleId).c || 0);
    res.json({
      governance: { ...governance, review_status: governanceStatus(governance) },
      solution: solutionStats({ articleId }),
      versionCount,
      steps,
      related: relatedArticles(articleId)
    });
  });

  app.post('/api/articles/:id/applied', (req, res) => {
    const user = userFrom(req);
    const articleId = Number(req.params.id);
    const success = req.body?.success === false ? 0 : 1;
    db.prepare(`INSERT INTO solution_applications(article_id,user_id,success,note) VALUES(?,?,?,?)`)
      .run(articleId, user.id, success, String(req.body?.note || '').slice(0, 2000));
    logActivity(user.id, success ? 'SOLUTION_SUCCESS' : 'SOLUTION_FAILED', 'article', articleId, articleMini(articleId)?.title || '');
    res.json(solutionStats({ articleId }));
  });

  app.post('/api/problems/:id/applied', (req, res) => {
    const user = userFrom(req);
    const problemId = Number(req.params.id);
    const success = req.body?.success === false ? 0 : 1;
    db.prepare(`INSERT INTO solution_applications(problem_id,user_id,success,note) VALUES(?,?,?,?)`)
      .run(problemId, user.id, success, String(req.body?.note || '').slice(0, 2000));
    res.json(solutionStats({ problemId }));
  });

  app.post('/api/quick-capture', (req, res) => {
    const user = userFrom(req);
    const problem = String(req.body?.problem || '').trim();
    const solution = String(req.body?.solution || '').trim();
    if (!problem || !solution) return res.status(400).json({ error: 'Problema e solução são obrigatórios.' });
    const code = String(req.body?.errorCode || '').trim();
    const title = String(req.body?.title || '').trim() || `${code ? `${code} — ` : ''}${problem}`.slice(0, 160);
    const status = String(req.body?.publish ? 'PUBLISHED' : 'DRAFT');
    const bodyHtml = cleanHtml(`<h2>Problema</h2><p>${escapeHtml(problem)}</p><h2>Solução registrada</h2><p>${escapeHtml(solution)}</p>${code ? `<h3>Código / mensagem</h3><p>${escapeHtml(code)}</p>` : ''}`);
    const result = db.prepare(`INSERT INTO articles(title,slug,type,description,body_html,status,author_id,published_at,updated_at) VALUES(?,?,?,?,?,?,?,CASE WHEN ?='PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)`)
      .run(title, uniqueSlug(title), 'TROUBLESHOOTING', problem.slice(0, 300), bodyHtml, status, user.id, status);
    const id = Number(result.lastInsertRowid);
    const tags = Array.isArray(req.body?.tags) ? req.body.tags : String(req.body?.tags || '').split(',').map(x => x.trim()).filter(Boolean);
    setArticleTags(id, tags);
    ensureGovernance(id);
    indexArticle(id);
    logActivity(user.id, 'QUICK_CAPTURE', 'article', id, title);
    res.status(201).json(articleMini(id));
  });

  app.get('/api/scripts', (req, res) => {
    const q = String(req.query.q || '').trim();
    const language = String(req.query.language || 'ALL').toUpperCase();
    const risk = String(req.query.risk || 'ALL').toUpperCase();
    const like = `%${q}%`;
    res.json(db.prepare(`
      SELECT s.*,u.name author_name,tu.name tested_by_name FROM scripts s
      JOIN users u ON u.id=s.author_id LEFT JOIN users tu ON tu.id=s.tested_by
      WHERE (?='' OR s.title LIKE ? OR s.description LIKE ? OR s.code LIKE ? OR s.tags LIKE ?)
        AND (?='ALL' OR upper(s.language)=?) AND (?='ALL' OR s.risk_level=?)
      ORDER BY s.updated_at DESC
    `).all(q, like, like, like, like, language, language, risk, risk));
  });

  app.post('/api/scripts', (req, res) => {
    const user = userFrom(req);
    const title = String(req.body?.title || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!title || !code) return res.status(400).json({ error: 'Título e código são obrigatórios.' });
    const result = db.prepare(`INSERT INTO scripts(title,description,language,code,risk_level,min_version,tags,author_id) VALUES(?,?,?,?,?,?,?,?)`)
      .run(title, String(req.body?.description || '').trim(), String(req.body?.language || 'SQL').toUpperCase(), code.slice(0, 500000), String(req.body?.riskLevel || 'LOW').toUpperCase(), String(req.body?.minVersion || '').trim(), String(req.body?.tags || '').trim(), user.id);
    const id = Number(result.lastInsertRowid);
    logActivity(user.id, 'SCRIPT_CREATED', 'script', id, title);
    res.status(201).json(db.prepare('SELECT * FROM scripts WHERE id=?').get(id));
  });

  app.put('/api/scripts/:id', (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM scripts WHERE id=?').get(id);
    if (!old) return res.status(404).json({ error: 'Script não encontrado.' });
    db.prepare(`UPDATE scripts SET title=?,description=?,language=?,code=?,risk_level=?,min_version=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(String(req.body?.title ?? old.title).trim(), String(req.body?.description ?? old.description).trim(), String(req.body?.language ?? old.language).toUpperCase(), String(req.body?.code ?? old.code), String(req.body?.riskLevel ?? old.risk_level).toUpperCase(), String(req.body?.minVersion ?? old.min_version).trim(), String(req.body?.tags ?? old.tags).trim(), id);
    res.json(db.prepare('SELECT * FROM scripts WHERE id=?').get(id));
  });

  app.delete('/api/scripts/:id', (req, res) => { db.prepare('DELETE FROM scripts WHERE id=?').run(Number(req.params.id)); res.status(204).end(); });

  app.post('/api/scripts/:id/tested', (req, res) => {
    const user = userFrom(req);
    const id = Number(req.params.id);
    db.prepare(`UPDATE scripts SET tested=1,tested_by=?,tested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(user.id, id);
    logActivity(user.id, 'SCRIPT_VALIDATED', 'script', id, db.prepare('SELECT title FROM scripts WHERE id=?').get(id)?.title || '');
    res.json(db.prepare('SELECT * FROM scripts WHERE id=?').get(id));
  });

  app.post('/api/scripts/:id/applied', (req, res) => {
    const id = Number(req.params.id);
    const success = req.body?.success === false ? 0 : 1;
    db.prepare(`UPDATE scripts SET usage_count=usage_count+1,success_count=success_count+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(success, id);
    res.json(db.prepare('SELECT usage_count,success_count FROM scripts WHERE id=?').get(id));
  });

  app.get('/api/diagnostics', (_req, res) => {
    res.json(db.prepare(`SELECT d.id,d.title,d.symptom,d.description,d.active,d.runs,d.created_at,d.updated_at,u.name author_name FROM diagnostic_flows d JOIN users u ON u.id=d.author_id ORDER BY d.updated_at DESC`).all());
  });

  app.get('/api/diagnostics/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM diagnostic_flows WHERE id=?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Fluxo não encontrado.' });
    res.json({ ...row, tree: JSON.parse(row.tree_json) });
  });

  app.post('/api/diagnostics', (req, res) => {
    const user = userFrom(req);
    try {
      const tree = safeTree(req.body?.tree);
      const result = db.prepare(`INSERT INTO diagnostic_flows(title,symptom,description,tree_json,author_id) VALUES(?,?,?,?,?)`)
        .run(String(req.body?.title || '').trim(), String(req.body?.symptom || '').trim(), String(req.body?.description || '').trim(), JSON.stringify(tree), user.id);
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  app.put('/api/diagnostics/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const old = db.prepare('SELECT * FROM diagnostic_flows WHERE id=?').get(id);
      if (!old) return res.status(404).json({ error: 'Fluxo não encontrado.' });
      const tree = req.body?.tree ? safeTree(req.body.tree) : JSON.parse(old.tree_json);
      db.prepare(`UPDATE diagnostic_flows SET title=?,symptom=?,description=?,tree_json=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(String(req.body?.title ?? old.title).trim(), String(req.body?.symptom ?? old.symptom).trim(), String(req.body?.description ?? old.description).trim(), JSON.stringify(tree), req.body?.active === false ? 0 : 1, id);
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  app.delete('/api/diagnostics/:id', (req, res) => { db.prepare('DELETE FROM diagnostic_flows WHERE id=?').run(Number(req.params.id)); res.status(204).end(); });

  app.post('/api/diagnostics/:id/complete', (req, res) => {
    const user = userFrom(req);
    const id = Number(req.params.id);
    db.prepare('UPDATE diagnostic_flows SET runs=runs+1 WHERE id=?').run(id);
    logActivity(user.id, 'DIAGNOSTIC_COMPLETED', 'diagnostic', id, String(req.body?.result || '').slice(0, 200));
    res.json({ ok: true });
  });

  app.get('/api/procedures', (_req, res) => {
    res.json(db.prepare(`
      SELECT a.id,a.title,a.slug,a.description,a.type,a.updated_at,u.name author_name,
             COUNT(ps.id) step_count,
             (SELECT COUNT(*) FROM procedure_runs pr WHERE pr.article_id=a.id AND pr.status='COMPLETED') completed_runs
      FROM procedure_steps ps JOIN articles a ON a.id=ps.article_id JOIN users u ON u.id=a.author_id
      WHERE a.status='PUBLISHED' GROUP BY a.id ORDER BY a.updated_at DESC
    `).all());
  });

  app.get('/api/articles/:id/procedure', (req, res) => {
    const user = userFrom(req);
    const articleId = Number(req.params.id);
    const steps = db.prepare(`SELECT * FROM procedure_steps WHERE article_id=? ORDER BY sort_order,id`).all(articleId);
    const run = db.prepare(`SELECT * FROM procedure_runs WHERE article_id=? AND user_id=? ORDER BY id DESC LIMIT 1`).get(articleId, user.id);
    const runSteps = run ? db.prepare(`SELECT prs.*,ps.title,ps.sort_order FROM procedure_run_steps prs JOIN procedure_steps ps ON ps.id=prs.step_id WHERE prs.run_id=? ORDER BY ps.sort_order,ps.id`).all(run.id) : [];
    res.json({ steps, run: run || null, runSteps });
  });

  app.post('/api/articles/:id/procedure/steps', (req, res) => {
    const articleId = Number(req.params.id);
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Título do passo é obrigatório.' });
    const order = Number(req.body?.sortOrder ?? db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 n FROM procedure_steps WHERE article_id=?').get(articleId).n);
    const result = db.prepare(`INSERT INTO procedure_steps(article_id,sort_order,title,detail,command_text,expected_result) VALUES(?,?,?,?,?,?)`)
      .run(articleId, order, title, String(req.body?.detail || '').trim(), String(req.body?.commandText || '').trim(), String(req.body?.expectedResult || '').trim());
    res.status(201).json(db.prepare('SELECT * FROM procedure_steps WHERE id=?').get(Number(result.lastInsertRowid)));
  });

  app.put('/api/procedure-steps/:id', (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM procedure_steps WHERE id=?').get(id);
    if (!old) return res.status(404).json({ error: 'Passo não encontrado.' });
    db.prepare(`UPDATE procedure_steps SET sort_order=?,title=?,detail=?,command_text=?,expected_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(Number(req.body?.sortOrder ?? old.sort_order), String(req.body?.title ?? old.title).trim(), String(req.body?.detail ?? old.detail).trim(), String(req.body?.commandText ?? old.command_text).trim(), String(req.body?.expectedResult ?? old.expected_result).trim(), id);
    res.json(db.prepare('SELECT * FROM procedure_steps WHERE id=?').get(id));
  });

  app.delete('/api/procedure-steps/:id', (req, res) => { db.prepare('DELETE FROM procedure_steps WHERE id=?').run(Number(req.params.id)); res.status(204).end(); });

  app.post('/api/articles/:id/procedure/start', (req, res) => {
    const user = userFrom(req);
    const articleId = Number(req.params.id);
    const steps = db.prepare('SELECT id FROM procedure_steps WHERE article_id=? ORDER BY sort_order,id').all(articleId);
    if (!steps.length) return res.status(400).json({ error: 'Este conteúdo ainda não possui passos.' });
    const result = db.prepare(`INSERT INTO procedure_runs(article_id,user_id) VALUES(?,?)`).run(articleId, user.id);
    const runId = Number(result.lastInsertRowid);
    const insert = db.prepare(`INSERT INTO procedure_run_steps(run_id,step_id) VALUES(?,?)`);
    for (const step of steps) insert.run(runId, step.id);
    res.status(201).json({ id: runId, status: 'IN_PROGRESS' });
  });

  app.patch('/api/procedure-runs/:runId/steps/:stepId', (req, res) => {
    const runId = Number(req.params.runId);
    const stepId = Number(req.params.stepId);
    const completed = req.body?.completed ? 1 : 0;
    db.prepare(`UPDATE procedure_run_steps SET completed=?,note=?,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE run_id=? AND step_id=?`)
      .run(completed, String(req.body?.note || '').slice(0, 2000), completed, runId, stepId);
    const counts = db.prepare(`SELECT COUNT(*) total,SUM(completed) done FROM procedure_run_steps WHERE run_id=?`).get(runId);
    if (Number(counts.total) > 0 && Number(counts.done) === Number(counts.total)) {
      db.prepare(`UPDATE procedure_runs SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP WHERE id=?`).run(runId);
      const run = db.prepare('SELECT * FROM procedure_runs WHERE id=?').get(runId);
      if (run) logActivity(run.user_id, 'PROCEDURE_COMPLETED', 'article', run.article_id, articleMini(run.article_id)?.title || '');
    } else {
      db.prepare(`UPDATE procedure_runs SET status='IN_PROGRESS',completed_at=NULL WHERE id=?`).run(runId);
    }
    res.json({ total: Number(counts.total), done: Number(counts.done || 0), completed: Number(counts.done) === Number(counts.total) });
  });

  app.get('/api/search-unified', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const results = [];
    for (const hit of searchKnowledge(q, 30)) {
      if (hit.entity_type === 'article') {
        const article = articleMini(Number(hit.entity_id));
        if (article) results.push({ kind: 'article', entity_id: article.id, title: article.title, subtitle: article.type, snippet: hit.snippet || article.description });
      } else if (hit.entity_type === 'problem') {
        const p = db.prepare('SELECT id,error_code,error_message,root_cause FROM troubleshooting WHERE id=?').get(Number(hit.entity_id));
        if (p) results.push({ kind: 'problem', entity_id: p.id, title: `${p.error_code ? `${p.error_code} — ` : ''}${p.error_message}`, subtitle: 'Troubleshooting', snippet: p.root_cause });
      }
    }
    const like = `%${q}%`;
    for (const s of db.prepare(`SELECT id,title,description,language,risk_level FROM scripts WHERE title LIKE ? OR description LIKE ? OR code LIKE ? OR tags LIKE ? ORDER BY usage_count DESC LIMIT 10`).all(like, like, like, like)) {
      results.push({ kind: 'script', entity_id: s.id, title: s.title, subtitle: `${s.language} · risco ${s.risk_level}`, snippet: s.description });
    }
    for (const d of db.prepare(`SELECT id,title,symptom,description FROM diagnostic_flows WHERE active=1 AND (title LIKE ? OR symptom LIKE ? OR description LIKE ?) LIMIT 6`).all(like, like, like)) {
      results.push({ kind: 'diagnostic', entity_id: d.id, title: d.title, subtitle: 'Diagnóstico guiado', snippet: d.symptom || d.description });
    }
    res.json(results.slice(0, 40));
  });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
