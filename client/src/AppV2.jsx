import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronRight, ClipboardCheck, Code2, Download,
  ExternalLink, Eye, FileArchive, FileCode2, FileSpreadsheet, FileText, Filter, GitBranch,
  Home, Image as ImageIcon, Library, Link2, Menu, MessageSquare, Moon, PanelsTopLeft,
  Play, Plus, QrCode, Save, Search, Send, ShieldCheck, Sparkles, Star, Sun, ThumbsDown,
  ThumbsUp, Upload, UserRound, Video, Wrench, X
} from 'lucide-react';
import RichEditor from './RichEditor.jsx';
import { api, dateShort, dateTime, initials } from './api.js';
import {
  ArticleOperations, DiagnosticsPage, MobileBottomNav, OperationalHome, ProceduresPage,
  QrContent, QuickCaptureModal, ReviewsPage, ScriptsPage
} from './KnowledgeOperations.jsx';

const CONTENT_TYPES = [
  ['GUIDE', 'Passo a passo'],
  ['CONCEPT', 'Conceito'],
  ['TROUBLESHOOTING', 'Resolução de problema'],
  ['VIDEO_TRAINING', 'Treinamento em vídeo'],
  ['MANUAL', 'Documentação / manual']
];

const NAV = [
  ['home', 'Início', Home],
  ['articles', 'Base de Conhecimento', Library],
  ['problems', 'Troubleshooting', Wrench],
  ['scripts', 'Scripts', Code2],
  ['diagnostics', 'Diagnóstico Guiado', GitBranch],
  ['procedures', 'Procedimentos', ClipboardCheck],
  ['reviews', 'Revisões', ShieldCheck],
  ['favorites', 'Favoritos', Star]
];

export default function AppV2() {
  const [theme, setTheme] = useState(() => localStorage.getItem('kb-theme') || 'light');
  const [page, setPage] = useState('home');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [articles, setArticles] = useState([]);
  const [problems, setProblems] = useState([]);
  const [users, setUsers] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [quickCapture, setQuickCapture] = useState(false);
  const [qrArticle, setQrArticle] = useState(null);
  const [qrData, setQrData] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type, key: Date.now() });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('kb-theme', theme);
  }, [theme]);

  useEffect(() => {
    const beforeInstall = event => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', beforeInstall);
  }, []);

  const loadBase = useCallback(async () => {
    try {
      const [meData, dashboardData, usersData, tagsData] = await Promise.all([
        api('/api/me'), api('/api/dashboard'), api('/api/users'), api('/api/tags')
      ]);
      setMe(meData); setDashboard(dashboardData); setUsers(usersData); setTags(tagsData);
    } catch (error) { notify(error.message, 'error'); }
  }, [notify]);

  const loadArticles = useCallback(async targetPage => {
    let url = '/api/articles?status=PUBLISHED';
    if (targetPage === 'favorites') url += '&favorite=1';
    try { setArticles(await api(url)); } catch (error) { notify(error.message, 'error'); }
  }, [notify]);

  const loadProblems = useCallback(async () => {
    try { setProblems(await api('/api/problems')); } catch (error) { notify(error.message, 'error'); }
  }, [notify]);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => {
    if (['articles', 'favorites'].includes(page)) void loadArticles(page);
    if (page === 'problems') void loadProblems();
  }, [page, loadArticles, loadProblems]);

  const openArticle = useCallback(async article => {
    try {
      const data = await api(`/api/articles/${article.id || article.slug}`);
      setSelectedArticle(data);
      void api(`/api/articles/${data.id}/view`, { method: 'POST' });
      setSearchOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set('article', data.id);
      window.history.replaceState({}, '', url);
    } catch (error) { notify(error.message, 'error'); }
  }, [notify]);

  const closeArticle = () => {
    setSelectedArticle(null);
    const url = new URL(window.location.href); url.searchParams.delete('article');
    window.history.replaceState({}, '', url);
  };

  useEffect(() => {
    const articleId = new URLSearchParams(window.location.search).get('article');
    if (articleId) void openArticle({ id: articleId });
  }, []);

  useEffect(() => {
    const handler = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); document.getElementById('global-search-input')?.focus(); setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try { setSearchResults(await api(`/api/search-unified?q=${encodeURIComponent(search.trim())}`)); setSearchOpen(true); }
      catch (error) { notify(error.message, 'error'); }
    }, 220);
    return () => clearTimeout(timer);
  }, [search, notify]);

  const toggleFavorite = async articleId => {
    try {
      await api(`/api/articles/${articleId}/favorite`, { method: 'POST' });
      if (selectedArticle?.id === articleId) setSelectedArticle(await api(`/api/articles/${articleId}`));
      if (['articles', 'favorites'].includes(page)) await loadArticles(page);
      notify('Favoritos atualizados.');
    } catch (error) { notify(error.message, 'error'); }
  };

  const openCreate = () => setEditing({ id: null, title: '', description: '', type: 'GUIDE', status: 'DRAFT', tags: [], body_html: '<h2>Objetivo</h2><p>Descreva o objetivo deste conteúdo.</p>', media: [] });
  const editArticle = article => { setSelectedArticle(null); setEditing({ ...article }); };

  const saveArticle = async (draft, publish = false) => {
    setBusy(true);
    try {
      const payload = { title: draft.title, description: draft.description, type: draft.type, status: publish ? 'PUBLISHED' : draft.status, tags: draft.tags, bodyHtml: draft.body_html, mediaIds: draft.media.map(m => m.id), changeNote: draft.changeNote || '' };
      const saved = draft.id ? await api(`/api/articles/${draft.id}`, { method: 'PUT', body: payload }) : await api('/api/articles', { method: 'POST', body: payload });
      setEditing(null); await loadBase(); if (['articles','favorites'].includes(page)) await loadArticles(page);
      notify(publish ? 'Conteúdo publicado.' : 'Rascunho salvo.'); await openArticle(saved);
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  const createProblem = async payload => {
    try { await api('/api/problems', { method: 'POST', body: payload }); await loadProblems(); await loadBase(); notify('Solução de problema criada.'); }
    catch (error) { notify(error.message, 'error'); }
  };

  const openQr = async article => {
    setQrArticle(article); setQrData('');
    const url = new URL(window.location.href); url.search = ''; url.searchParams.set('article', article.id);
    try { setQrData(await QRCode.toDataURL(url.toString(), { width: 420, margin: 2 })); } catch { notify('Não foi possível gerar o QR.', 'error'); }
  };

  const handleSearchResult = result => {
    if (result.kind === 'article') return void openArticle({ id: result.entity_id });
    setSearchOpen(false); setSearch('');
    if (result.kind === 'problem') setPage('problems');
    if (result.kind === 'script') setPage('scripts');
    if (result.kind === 'diagnostic') setPage('diagnostics');
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); setInstallPrompt(null);
  };

  return <div className="app-shell app-v2">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><PanelsTopLeft /></div><div><strong>KnowBase</strong><span>Knowledge Operations</span></div></div>
      <button className="create-button" onClick={openCreate}><Plus /><span>Criar conteúdo</span></button>
      <button className="quick-capture-side" onClick={() => setQuickCapture(true)}><Sparkles /><span>Registrar solução rápida</span></button>
      <nav><div className="nav-label">Conhecimento</div>{NAV.map(([id,label,Icon]) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setMobileOpen(false); }}><Icon /><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      {installPrompt && <button className="install-app-button" onClick={installApp}><Download /> Instalar KnowBase</button>}
      <div className="user-card"><div className="avatar">{initials(me?.name)}</div><div><strong>{me?.name || 'Carregando…'}</strong><span>{roleName(me?.role)}</span></div></div>
      <div className="phase-chip"><Sparkles /> Operações v2</div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" />}

    <main className="main">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></button>
        <div className="topbar-title"><span>{pageEyebrow(page)}</span><strong>{pageTitle(page)}</strong></div>
        <div className="global-search"><Search /><input id="global-search-input" value={search} onFocus={() => setSearchOpen(true)} onChange={e => setSearch(e.target.value)} placeholder="Buscar erro, artigo, script, PDF, transcrição…" /><kbd>Ctrl K</kbd></div>
        <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
        <button className="primary-button top-create" onClick={openCreate}><Plus /> Criar</button>
      </header>

      {searchOpen && <CommandSearch search={search} setSearch={setSearch} results={searchResults} onChoose={handleSearchResult} onClose={() => setSearchOpen(false)} />}

      <section className="content">
        {page === 'home' && <HomePage dashboard={dashboard} onOpen={openArticle} onMedia={setSelectedMedia} onCreate={openCreate} notify={notify} onNavigate={setPage} onQuickCapture={() => setQuickCapture(true)} />}
        {['articles','favorites'].includes(page) && <LibraryPage title={pageTitle(page)} articles={articles} users={users} tags={tags} onOpen={openArticle} onFavorite={toggleFavorite} onCreate={openCreate} />}
        {page === 'problems' && <ProblemsPage problems={problems} onCreate={createProblem} notify={notify} onValidate={async id => { await api(`/api/problems/${id}/validate`, { method: 'POST' }); await loadProblems(); notify('Solução marcada como testada e aprovada.'); }} />}
        {page === 'scripts' && <ScriptsPage notify={notify} />}
        {page === 'diagnostics' && <DiagnosticsPage notify={notify} />}
        {page === 'procedures' && <ProceduresPage notify={notify} onOpenArticle={openArticle} />}
        {page === 'reviews' && <ReviewsPage notify={notify} onOpenArticle={openArticle} />}
      </section>
    </main>

    {selectedArticle && <ArticleModal article={selectedArticle} onClose={closeArticle} onEdit={() => editArticle(selectedArticle)} onFavorite={() => toggleFavorite(selectedArticle.id)} onMedia={setSelectedMedia} onRefresh={async () => setSelectedArticle(await api(`/api/articles/${selectedArticle.id}`))} onOpenArticle={openArticle} onQr={openQr} notify={notify} />}
    {selectedMedia && <MediaModal media={selectedMedia} onClose={() => setSelectedMedia(null)} notify={notify} />}
    {editing && <EditorModal draft={editing} setDraft={setEditing} onClose={() => setEditing(null)} onSave={saveArticle} busy={busy} notify={notify} />}
    {quickCapture && <QuickCaptureModal onClose={() => setQuickCapture(false)} notify={notify} onCreated={() => { void loadBase(); if (page === 'articles') void loadArticles(page); }} />}
    {qrArticle && <SimpleModal title="QR do conhecimento" onClose={() => setQrArticle(null)}><QrContent dataUrl={qrData} article={qrArticle} /></SimpleModal>}
    {toast && <Toast toast={toast} />}

    <MobileBottomNav page={page} setPage={setPage} onSearch={() => { setSearchOpen(true); setTimeout(() => document.getElementById('global-search-input')?.focus(), 40); }} onQuickCapture={() => setQuickCapture(true)} onMore={() => setMobileOpen(true)} />
  </div>;
}

function HomePage({ dashboard, onOpen, onMedia, onCreate, notify, onNavigate, onQuickCapture }) {
  const stats = dashboard?.stats || {};
  const requestTraining = async () => {
    const title = window.prompt('Qual treinamento ou manual você precisa?'); if (!title?.trim()) return;
    const details = window.prompt('Descreva o cenário ou objetivo (opcional):') || '';
    await api('/api/training-requests', { method: 'POST', body: { title, details } }); notify('Solicitação registrada.');
  };
  return <>
    <div className="hero"><div><div className="eyebrow">Central unificada</div><h1>Conhecimento que resolve atendimento.</h1><p>Artigos, manuais, scripts, procedimentos e soluções testadas em um único fluxo pesquisável.</p><div className="hero-actions"><button className="primary-button" onClick={onCreate}><Plus /> Criar conhecimento</button><button className="secondary-button" onClick={onQuickCapture}><Sparkles /> Solução rápida</button><button className="secondary-button" onClick={requestTraining}><MessageSquare /> Solicitar material</button><span className="hero-tip"><Search /> A busca inclui anexos e scripts.</span></div></div><div className="hero-orbit"><div className="orbit-core"><BookOpen /></div><span className="orbit-dot dot-1"><FileText /></span><span className="orbit-dot dot-2"><Code2 /></span><span className="orbit-dot dot-3"><Wrench /></span></div></div>
    <div className="stats-grid"><Stat label="Conteúdos publicados" value={stats.published || 0} icon={Library} /><Stat label="Soluções de problemas" value={stats.problems || 0} icon={Wrench} /><Stat label="Soluções validadas" value={stats.tested || 0} icon={CheckCircle2} /><Stat label="Vídeos na base" value={stats.videos || 0} icon={Video} /><Stat label="Manuais em PDF" value={stats.manuals || 0} icon={FileText} /></div>
    <OperationalHome notify={notify} onOpenArticle={onOpen} onNavigate={onNavigate} onQuickCapture={onQuickCapture} />
    <Section title="Atualizações recentes" subtitle="Conteúdo publicado ou revisado recentemente."><ArticleCards items={dashboard?.recent || []} onOpen={onOpen} /></Section>
    <div className="split-grid"><Section title="Mais acessados" subtitle="O que o time mais consulta." compact><RankList items={dashboard?.popular || []} onOpen={onOpen} /></Section><Section title="Mídias recentes" subtitle="Vídeos internos e embeds externos." compact><MediaList items={dashboard?.training || []} onMedia={onMedia} /></Section></div>
  </>;
}

function LibraryPage({ title, articles, users, onOpen, onFavorite, onCreate }) {
  const [filter, setFilter] = useState('');
  const [type, setType] = useState('ALL');
  const [media, setMedia] = useState('ALL');
  const [author, setAuthor] = useState('0');
  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return articles.filter(a => (!q || `${a.title} ${a.description} ${a.tags.join(' ')} ${a.author_name}`.toLowerCase().includes(q)) && (type === 'ALL' || a.type === type) && (!Number(author) || a.author_id === Number(author)) && (media === 'ALL' || a.media.some(m => media === 'DOCUMENT' ? ['DOCUMENT','SPREADSHEET','PRESENTATION'].includes(m.media_type) : m.media_type === media)));
  }, [articles, filter, type, media, author]);
  return <><div className="page-heading-row"><div><div className="eyebrow">Biblioteca</div><h1>{title}</h1><p>{articles.length} conteúdos disponíveis. Vídeos, PDFs e manuais agora são filtros, não áreas duplicadas.</p></div><button className="primary-button" onClick={onCreate}><Plus /> Novo conteúdo</button></div>
    <div className="library-toolbar panel advanced-library-toolbar"><div className="inline-search"><Search /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar biblioteca…" /></div><select value={type} onChange={e => setType(e.target.value)}><option value="ALL">Todos os tipos</option>{CONTENT_TYPES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><select value={media} onChange={e => setMedia(e.target.value)}><option value="ALL">Qualquer mídia</option><option value="VIDEO">Vídeo</option><option value="PDF">PDF</option><option value="DOCUMENT">Documentos</option><option value="SCRIPT">Anexo de script</option></select><select value={author} onChange={e => setAuthor(e.target.value)}><option value="0">Qualquer autor</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    {filtered.length ? <div className="article-grid">{filtered.map(article => <ArticleCard key={article.id} article={article} onOpen={onOpen} onFavorite={onFavorite} />)}</div> : <Empty title="Nada por aqui" text="Nenhum conteúdo corresponde aos filtros atuais." />}
  </>;
}

function ProblemsPage({ problems, onCreate, onValidate, notify }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ errorCode: '', errorMessage: '', rootCause: '', solutionHtml: '', validationSteps: '' });
  const [q, setQ] = useState('');
  const filtered = problems.filter(p => `${p.error_code || ''} ${p.error_message} ${p.root_cause}`.toLowerCase().includes(q.toLowerCase()));
  const submit = async e => { e.preventDefault(); await onCreate(form); setForm({ errorCode: '', errorMessage: '', rootCause: '', solutionHtml: '', validationSteps: '' }); setShowForm(false); };
  const applied = async (id, success) => { await api(`/api/problems/${id}/applied`, { method: 'POST', body: { success } }); notify(success ? 'Sucesso registrado.' : 'Falha registrada para revisão.'); };
  return <><div className="page-heading-row"><div><div className="eyebrow">Troubleshooting</div><h1>Problemas & Soluções</h1><p>Código, causa raiz, correção, validação e histórico de aplicação.</p></div><button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus /> Registrar solução</button></div>
    {showForm && <form className="panel problem-form" onSubmit={submit}><div className="form-grid"><Field label="Código do erro"><input value={form.errorCode} onChange={e => setForm({ ...form, errorCode: e.target.value })} /></Field><Field label="Mensagem do erro"><input required value={form.errorMessage} onChange={e => setForm({ ...form, errorMessage: e.target.value })} /></Field><Field label="Causa raiz" full><textarea value={form.rootCause} onChange={e => setForm({ ...form, rootCause: e.target.value })} /></Field><Field label="Solução" full><textarea value={form.solutionHtml} onChange={e => setForm({ ...form, solutionHtml: e.target.value })} /></Field><Field label="Validação" full><textarea value={form.validationSteps} onChange={e => setForm({ ...form, validationSteps: e.target.value })} /></Field></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button"><Save /> Salvar solução</button></div></form>}
    <div className="panel library-toolbar"><div className="inline-search"><Search /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Código, mensagem ou causa…" /></div></div>
    <div className="problem-list">{filtered.map(p => <article className="problem-card" key={p.id}><div className="problem-top"><div className="error-code">{p.error_code || 'SEM CÓDIGO'}</div>{p.tested ? <div className="tested-badge"><CheckCircle2 /> Testada e aprovada</div> : <div className="pending-badge">Aguardando validação</div>}</div><h3>{p.error_message}</h3><div className="problem-columns"><div><span>Causa raiz</span><p>{p.root_cause || 'Ainda não documentada.'}</p></div><div><span>Solução</span><div className="prose small" dangerouslySetInnerHTML={{ __html: p.solution_html || '<p>Não documentada.</p>' }} /></div><div><span>Validação</span><p>{p.validation_steps || 'Não informada.'}</p></div></div><div className="problem-footer"><div className="problem-use"><button onClick={() => applied(p.id, true)}><ThumbsUp /> Funcionou</button><button onClick={() => applied(p.id, false)}><ThumbsDown /> Não funcionou</button></div>{!p.tested && <button className="secondary-button" onClick={() => onValidate(p.id)}><CheckCircle2 /> Marcar testada</button>}</div></article>)}</div>
  </>;
}

function EditorModal({ draft, setDraft, onClose, onSave, busy, notify }) {
  const [external, setExternal] = useState({ open: false, url: '', name: '', transcript: '' });
  const uploadFile = async file => { const data = new FormData(); data.append('file', file); if (draft.id) data.append('articleId', draft.id); const asset = await api('/api/media/upload', { method: 'POST', body: data, raw: true }); setDraft(prev => ({ ...prev, media: [...prev.media.filter(m => m.id !== asset.id), asset] })); notify(`${file.name} anexado.`); return asset; };
  const addExternal = async () => { const asset = await api('/api/media/external', { method: 'POST', body: { ...external, articleId: draft.id || null } }); setDraft(prev => ({ ...prev, media: [...prev.media, asset] })); setExternal({ open: false, url: '', name: '', transcript: '' }); notify('Vídeo externo incorporado.'); };
  const removeMedia = async media => { await api(`/api/media/${media.id}`, { method: 'DELETE' }); setDraft(prev => ({ ...prev, media: prev.media.filter(m => m.id !== media.id) })); };
  return <div className="modal-layer"><div className="editor-modal"><div className="editor-modal-head"><div><span className="eyebrow">{draft.id ? `Editando #${draft.id}` : 'Novo conteúdo'}</span><strong>{draft.title || 'Sem título'}</strong></div><div className="head-actions"><button className="secondary-button" onClick={() => onSave(draft, false)} disabled={busy}><Save /> Salvar</button><button className="primary-button" onClick={() => onSave(draft, true)} disabled={busy || !draft.title.trim()}><Send /> Publicar</button><button className="icon-button" onClick={onClose}><X /></button></div></div>
    <div className="editor-workspace"><div className="editor-main"><input className="title-input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Título pesquisável do conteúdo" /><textarea className="description-input" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Resumo curto para busca." /><RichEditor value={draft.body_html} onChange={body_html => setDraft(prev => ({ ...prev, body_html }))} onUpload={uploadFile} /></div>
    <aside className="editor-aside"><div className="aside-block"><label>Tipo</label><select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{CONTENT_TYPES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div><div className="aside-block"><label>Status</label><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="DRAFT">Rascunho</option><option value="PUBLISHED">Publicado</option></select></div><div className="aside-block"><label>Tags</label><input value={draft.tags.join(', ')} onChange={e => setDraft({ ...draft, tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} /></div>{draft.id && <div className="aside-block"><label>Nota desta alteração</label><textarea value={draft.changeNote || ''} onChange={e => setDraft({ ...draft, changeNote: e.target.value })} placeholder="Ex.: procedimento atualizado para versão 4.8" /></div>}
    <div className="aside-block media-editor-block"><div className="aside-title"><span>Central de materiais</span><small>{draft.media.length}</small></div><label className="upload-zone"><Upload /><strong>Enviar arquivo</strong><span>PDF, DOCX, XLSX, PPTX, MP4, WEBM, ZIP, SQL, TXT e imagens</span><input type="file" hidden multiple onChange={async e => { const files = [...e.target.files]; e.target.value = ''; for (const file of files) await uploadFile(file); }} /></label><button className="secondary-button full" onClick={() => setExternal({ ...external, open: !external.open })}><Link2 /> Incorporar vídeo</button>{external.open && <div className="external-form"><input value={external.name} onChange={e => setExternal({ ...external, name: e.target.value })} placeholder="Nome" /><input value={external.url} onChange={e => setExternal({ ...external, url: e.target.value })} placeholder="YouTube, Vimeo, Loom, Stream ou Drive" /><textarea value={external.transcript} onChange={e => setExternal({ ...external, transcript: e.target.value })} placeholder="Transcrição pesquisável" /><button className="primary-button full" onClick={addExternal} disabled={!external.url.trim()}>Adicionar</button></div>}<div className="material-stack">{draft.media.map(m => <div className="material-mini" key={m.id}><MediaIcon type={m.media_type} /><div><strong>{m.original_name || m.name}</strong><span>{m.sizeLabel || mediaLabel(m.media_type)}</span></div><button onClick={() => removeMedia(m)}><X /></button></div>)}</div></div></aside></div></div></div>;
}

function ArticleModal({ article, onClose, onEdit, onFavorite, onMedia, onRefresh, onOpenArticle, onQr, notify }) {
  const [comment, setComment] = useState(''); const [suggestion, setSuggestion] = useState(''); const [showSuggestion, setShowSuggestion] = useState(false);
  return <div className="modal-layer"><article className="article-modal"><div className="article-modal-head"><button className="icon-button" onClick={onClose}><X /></button><div className="article-head-actions"><button className={`icon-button ${article.favorite ? 'favorite-on' : ''}`} onClick={onFavorite}><Star /></button><button className="secondary-button" onClick={() => onQr(article)}><QrCode /> QR</button><button className="secondary-button" onClick={onEdit}>Editar</button></div></div>
    <div className="article-layout"><div className="article-body"><div className="article-meta-row"><span className="type-badge">{typeName(article.type)}</span><span><UserRound /> {article.author_name}</span><span>{dateShort(article.updated_at)}</span><span><Eye /> {article.views}</span></div><h1>{article.title}</h1><p className="article-lead">{article.description}</p><div className="tag-row">{article.tags.map(t => <span key={t}>#{t}</span>)}</div><div className="prose" dangerouslySetInnerHTML={{ __html: article.body_html }} />
    <ArticleOperations article={article} notify={notify} onOpenArticle={onOpenArticle} onQr={onQr} onRefreshArticle={onRefresh} />
    {!!article.media.length && <div className="materials-section"><div className="section-title"><div><span className="eyebrow">Anexos</span><h2>Central de Downloads & Materiais</h2></div></div><div className="material-list">{article.media.map(m => <button className="material-row" key={m.id} onClick={() => onMedia(m)}><span className={`material-icon ${m.media_type.toLowerCase()}`}><MediaIcon type={m.media_type} /></span><span className="material-name"><strong>{m.name}</strong><small>{mediaLabel(m.media_type)} · {m.sizeLabel}</small></span><span className="material-action">{m.media_type === 'VIDEO' ? <Play /> : <Eye />}</span></button>)}</div></div>}
    <div className="feedback-box"><div><strong>Este conteúdo foi útil?</strong><span>Feedback negativo alimenta a fila de revisão.</span></div><div><button onClick={async () => { await api(`/api/articles/${article.id}/feedback`, { method: 'POST', body: { useful: true } }); await onRefresh(); }}><ThumbsUp /> Sim <b>{article.feedback.yes}</b></button><button onClick={async () => { await api(`/api/articles/${article.id}/feedback`, { method: 'POST', body: { useful: false } }); await onRefresh(); }}><ThumbsDown /> Não <b>{article.feedback.no}</b></button></div></div>
    <div className="comments-section"><div className="section-title"><div><span className="eyebrow">Colaboração</span><h2>Comentários & dúvidas</h2></div><button className="text-button" onClick={() => setShowSuggestion(!showSuggestion)}>Sugerir edição</button></div>{showSuggestion && <div className="suggestion-box"><textarea value={suggestion} onChange={e => setSuggestion(e.target.value)} /><button className="primary-button" onClick={async () => { await api(`/api/articles/${article.id}/suggestions`, { method: 'POST', body: { body: suggestion } }); setSuggestion(''); setShowSuggestion(false); notify('Sugestão enviada.'); }} disabled={!suggestion.trim()}><Send /> Enviar</button></div>}<div className="comment-list">{article.comments?.map(c => <div className="comment" key={c.id}><div className="avatar small">{initials(c.user_name)}</div><div><div className="comment-head"><strong>{c.user_name}</strong><span>{dateTime(c.created_at)}</span></div><p>{c.body}</p></div></div>)}</div><div className="comment-compose"><div className="avatar small">EU</div><textarea value={comment} onChange={e => setComment(e.target.value)} /><button className="primary-button" disabled={!comment.trim()} onClick={async () => { await api(`/api/articles/${article.id}/comments`, { method: 'POST', body: { body: comment } }); setComment(''); await onRefresh(); }}><Send /></button></div></div>
    </div><aside className="article-aside"><div className="aside-info"><span>Status</span><strong className="published"><CheckCircle2 /> Publicado</strong></div><div className="aside-info"><span>Tipo</span><strong>{typeName(article.type)}</strong></div><div className="aside-info"><span>Atualizado</span><strong>{dateTime(article.updated_at)}</strong></div><div className="aside-info"><span>Autor</span><strong>{article.author_name}</strong></div><div className="aside-info"><span>Visualizações</span><strong>{article.views}</strong></div><div className="aside-info"><span>Materiais</span><strong>{article.media.length}</strong></div></aside></div></article></div>;
}

function MediaModal({ media, onClose, notify }) {
  const [preview, setPreview] = useState(media); const [speed, setSpeed] = useState(1); const videoRef = useRef(null); const lastSaved = useRef(0);
  useEffect(() => { void api(`/api/media/${media.id}/preview`).then(setPreview).catch(() => {}); }, [media.id]);
  const saveProgress = async video => { if (!video || preview.external_url || preview.media_type !== 'VIDEO') return; const now = Date.now(); if (now - lastSaved.current < 2500 && !video.ended) return; lastSaved.current = now; try { await api(`/api/video-progress/${media.id}`, { method: 'PUT', body: { seconds: video.currentTime, duration: video.duration || 0 } }); } catch {} };
  const restoreProgress = async video => { video.playbackRate = speed; try { const p = await api(`/api/video-progress/${media.id}`); if (p.seconds > 3 && p.seconds < video.duration - 3) video.currentTime = p.seconds; } catch {} };
  const isVideo = preview.media_type === 'VIDEO', isPdf = preview.media_type === 'PDF';
  return <div className="modal-layer media-layer"><div className="media-modal"><div className="media-modal-head"><div><span className="eyebrow">{mediaLabel(preview.media_type)}</span><strong>{preview.name}</strong></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="media-stage">{isVideo && preview.external_url && <iframe src={preview.url} title={preview.name} allowFullScreen allow="autoplay; fullscreen; picture-in-picture" />}{isVideo && !preview.external_url && <video ref={videoRef} key={preview.url} src={preview.url} controls playsInline onLoadedMetadata={e => restoreProgress(e.currentTarget)} onTimeUpdate={e => saveProgress(e.currentTarget)} onPause={e => saveProgress(e.currentTarget)} onEnded={e => saveProgress(e.currentTarget)} />}{isPdf && <iframe src={preview.url} title={preview.name} />}{!isVideo && !isPdf && preview.media_type === 'IMAGE' && <img src={preview.url} alt={preview.name} />}{!isVideo && !isPdf && preview.media_type !== 'IMAGE' && <div className="document-preview"><div className="doc-preview-head"><MediaIcon type={preview.media_type} /><div><strong>{preview.name}</strong><span>{preview.sizeLabel}</span></div></div><pre>{preview.extracted_text || 'Pré-visualização textual indisponível.'}</pre></div>}</div><div className="media-footer">{isVideo && !preview.external_url && <div className="speed-control"><span>Velocidade</span>{[1,1.25,1.5,2].map(v => <button key={v} className={speed === v ? 'active' : ''} onClick={() => { setSpeed(v); if (videoRef.current) videoRef.current.playbackRate = v; }}>{v}x</button>)}</div>}{(preview.transcript || preview.extracted_text) && <details className="indexed-text"><summary>Texto indexado / transcrição</summary><p>{preview.transcript || preview.extracted_text}</p></details>}{preview.url && !preview.external_url && <a className="secondary-button" href={preview.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir arquivo</a>}</div></div></div>;
}

function CommandSearch({ search, setSearch, results, onChoose, onClose }) {
  return <div className="search-overlay command-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="search-panel command-panel"><div className="search-panel-head"><div><Search /><strong>{search ? `Resultados para “${search}”` : 'Central de Comando'}</strong></div><button className="icon-button" onClick={onClose}><X /></button></div><div className="command-input-mobile"><Search /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Erro, artigo, script, diagnóstico…" /></div><div className="search-result-list">{!search && <div className="command-hints"><span><kbd>539</kbd> códigos de erro</span><span><kbd>certificado</kbd> conhecimento</span><span><kbd>SELECT</kbd> scripts</span></div>}{search && !results.length && <Empty title="Nenhum resultado" text="Tente outra mensagem, código, comando ou palavra-chave." />}{results.map((r,i) => <button key={`${r.kind}-${r.entity_id}-${i}`} className="search-result" onClick={() => onChoose(r)}><span className={`result-icon ${r.kind}`}>{resultIcon(r.kind)}</span><span><small>{r.subtitle}</small><strong>{r.title}</strong><p dangerouslySetInnerHTML={{ __html: r.snippet || '' }} /></span><ChevronRight /></button>)}</div></div></div>;
}

function ArticleCards({ items, onOpen }) { if (!items.length) return <Empty title="Sem publicações" text="Publique o primeiro conteúdo para iniciar o feed." />; return <div className="article-grid">{items.map(a => <ArticleCard key={a.id} article={a} onOpen={onOpen} />)}</div>; }
function ArticleCard({ article, onOpen, onFavorite }) { return <article className="article-card" onClick={() => onOpen(article)}><div className="card-top"><span className="type-badge">{typeName(article.type)}</span>{onFavorite && <button className={`star-button ${article.favorite ? 'active' : ''}`} onClick={e => { e.stopPropagation(); onFavorite(article.id); }}><Star /></button>}</div><h3>{article.title}</h3><p>{article.description || 'Sem descrição.'}</p><div className="tag-row compact">{article.tags.slice(0,4).map(t => <span key={t}>#{t}</span>)}</div><div className="card-media">{article.media.slice(0,4).map(m => <span key={m.id}><MediaIcon type={m.media_type} /></span>)}</div><div className="card-footer"><span><UserRound /> {article.author_name}</span><span><Eye /> {article.views}</span><span>{dateShort(article.updated_at)}</span></div></article>; }
function RankList({ items, onOpen }) { return <div className="rank-list">{items.map((a,i) => <button key={a.id} onClick={() => onOpen(a)}><b>{String(i+1).padStart(2,'0')}</b><span><strong>{a.title}</strong><small>{a.views} visualizações · {typeName(a.type)}</small></span><ChevronRight /></button>)}</div>; }
function MediaList({ items, onMedia }) { if (!items.length) return <Empty title="Nenhuma mídia" text="Envie MP4/WEBM ou incorpore vídeo em um conteúdo." />; return <div className="media-home-list">{items.map(m => <button key={m.id} onClick={() => onMedia(m)}><span className="play-chip"><Play /></span><span><strong>{m.name}</strong><small>{m.article_title || 'Mídia avulsa'} · {m.provider || 'Vídeo nativo'}</small></span><ChevronRight /></button>)}</div>; }
function Section({ title, subtitle, children, compact=false }) { return <section className={`section ${compact ? 'compact' : ''}`}><div className="section-title"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function Stat({ label, value, icon: Icon }) { return <div className="stat-card"><span><Icon /></span><div><strong>{value}</strong><small>{label}</small></div></div>; }
function Field({ label, full, children }) { return <label className={`field ${full ? 'full' : ''}`}><span>{label}</span>{children}</label>; }
function Empty({ title, text }) { return <div className="empty-state"><BookOpen /><strong>{title}</strong><p>{text}</p></div>; }
function Toast({ toast }) { return <div className={`toast ${toast.type}`}><span>{toast.type === 'error' ? <AlertTriangle /> : <CheckCircle2 />}</span><strong>{toast.message}</strong></div>; }
function SimpleModal({ title, onClose, children }) { return <div className="modal-layer"><div className="ops-modal"><div className="ops-modal-head"><strong>{title}</strong><button className="icon-button" onClick={onClose}><X /></button></div><div className="ops-modal-body">{children}</div></div></div>; }
function MediaIcon({ type }) { if (type === 'PDF') return <FileText />; if (type === 'VIDEO') return <Video />; if (type === 'SPREADSHEET') return <FileSpreadsheet />; if (type === 'SCRIPT' || type === 'TEXT') return <FileCode2 />; if (type === 'ARCHIVE') return <FileArchive />; if (type === 'IMAGE') return <ImageIcon />; return <FileText />; }
function resultIcon(kind) { return kind === 'script' ? <Code2 /> : kind === 'diagnostic' ? <GitBranch /> : kind === 'problem' ? <Wrench /> : <BookOpen />; }
function typeName(type) { return Object.fromEntries(CONTENT_TYPES)[type] || type?.replaceAll('_',' ') || 'Conteúdo'; }
function mediaLabel(type) { return ({ PDF:'PDF / Manual', VIDEO:'Vídeo / Treinamento', SPREADSHEET:'Planilha', DOCUMENT:'Documento', PRESENTATION:'Apresentação', SCRIPT:'Script', ARCHIVE:'Arquivo compactado', IMAGE:'Imagem', TEXT:'Texto' })[type] || 'Arquivo'; }
function roleName(role) { return ({ ADMIN:'Administrador', SPECIALIST:'Especialista', CONSULTANT:'Consultor' })[role] || role || 'Usuário'; }
function pageTitle(page) { return ({ home:'Visão geral', articles:'Base de Conhecimento', problems:'Troubleshooting', scripts:'Biblioteca de Scripts', diagnostics:'Diagnóstico Guiado', procedures:'Procedimentos', reviews:'Revisões', favorites:'Favoritos' })[page] || 'KnowBase'; }
function pageEyebrow(page) { return page === 'home' ? 'Knowledge Operations' : ['scripts','diagnostics','procedures'].includes(page) ? 'Operação assistida' : 'Central de conhecimento'; }
