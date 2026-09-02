import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck,
  Clock3, Code2, Copy, FileClock, GitBranch, History, Play, Plus, QrCode, RefreshCw,
  RotateCcw, Save, Search, ShieldCheck, Sparkles, Star, ThumbsDown, ThumbsUp, Trash2,
  Wrench, X, Zap
} from 'lucide-react';
import { api, dateShort, dateTime } from './api.js';

export function OperationalHome({ notify, onOpenArticle, onNavigate, onQuickCapture }) {
  const [data, setData] = useState(null);
  const load = async () => {
    try { setData(await api('/api/ops/dashboard')); } catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, []);

  const stats = data?.stats || {};
  return (
    <section className="ops-home">
      <div className="section-title ops-title-row">
        <div><span className="eyebrow">Operação</span><h2>O que precisa da sua atenção</h2><p>Revisões, confiança e conhecimento mais reutilizado.</p></div>
        <button className="secondary-button" onClick={load}><RefreshCw /> Atualizar</button>
      </div>

      <div className="ops-metric-grid">
        <button onClick={() => onNavigate('reviews')}><FileClock /><strong>{stats.reviewsDue || 0}</strong><span>Revisões pendentes</span></button>
        <button onClick={() => onNavigate('scripts')}><Code2 /><strong>{stats.scripts || 0}</strong><span>Scripts na biblioteca</span></button>
        <button onClick={() => onNavigate('procedures')}><ClipboardCheck /><strong>{stats.procedures || 0}</strong><span>Procedimentos</span></button>
        <button onClick={() => onNavigate('diagnostics')}><GitBranch /><strong>{stats.diagnostics || 0}</strong><span>Fluxos de diagnóstico</span></button>
      </div>

      <div className="ops-quick-actions panel">
        <button className="primary-button" onClick={onQuickCapture}><Zap /> Registrar solução rápida</button>
        <button className="secondary-button" onClick={() => onNavigate('diagnostics')}><GitBranch /> Iniciar diagnóstico</button>
        <button className="secondary-button" onClick={() => onNavigate('scripts')}><Code2 /> Abrir scripts</button>
        <button className="secondary-button" onClick={() => onNavigate('reviews')}><FileClock /> Revisar conhecimento</button>
      </div>

      <div className="ops-dashboard-grid">
        <div className="panel ops-panel">
          <div className="ops-panel-head"><div><strong>Revisar agora</strong><span>Vencidos ou próximos do prazo.</span></div><FileClock /></div>
          <div className="ops-list">
            {(data?.due || []).length === 0 && <OpsEmpty text="Nenhuma revisão urgente." />}
            {(data?.due || []).map(item => (
              <button key={item.id} onClick={() => onOpenArticle({ id: item.id })}>
                <StatusDot status={item.review_status} />
                <span><strong>{item.title}</strong><small>{item.next_review_at ? `Revisar até ${dateShort(item.next_review_at)}` : 'Nunca revisado'}</small></span>
                <ChevronRight />
              </button>
            ))}
          </div>
        </div>

        <div className="panel ops-panel">
          <div className="ops-panel-head"><div><strong>Confiança baixa</strong><span>Conteúdos com mais feedback negativo.</span></div><AlertTriangle /></div>
          <div className="ops-list">
            {(data?.lowConfidence || []).length === 0 && <OpsEmpty text="Nenhum conteúdo sinalizado." />}
            {(data?.lowConfidence || []).map(item => (
              <button key={item.id} onClick={() => onOpenArticle({ id: item.id })}>
                <span className="ops-warning-icon"><ThumbsDown /></span>
                <span><strong>{item.title}</strong><small>{item.yes_count || 0} úteis · {item.no_count || 0} não úteis</small></span>
                <ChevronRight />
              </button>
            ))}
          </div>
        </div>

        <div className="panel ops-panel">
          <div className="ops-panel-head"><div><strong>Scripts mais usados</strong><span>Atalhos que mais entraram na operação.</span></div><Code2 /></div>
          <div className="ops-list">
            {(data?.topScripts || []).length === 0 && <OpsEmpty text="A biblioteca ainda não tem uso registrado." />}
            {(data?.topScripts || []).map(item => (
              <button key={item.id} onClick={() => onNavigate('scripts')}>
                <span className="ops-code-icon">{item.language}</span>
                <span><strong>{item.title}</strong><small>{item.usage_count} usos · {item.success_count} sucessos</small></span>
                <ChevronRight />
              </button>
            ))}
          </div>
        </div>

        <div className="panel ops-panel">
          <div className="ops-panel-head"><div><strong>Atividade recente</strong><span>Conhecimento evoluindo na equipe.</span></div><History /></div>
          <div className="activity-timeline">
            {(data?.activity || []).length === 0 && <OpsEmpty text="Sem atividade recente." />}
            {(data?.activity || []).slice(0, 7).map(item => (
              <div key={item.id}><span /><p><strong>{activityName(item.action)}</strong> {item.label || item.entity_type}<small>{item.user_name || 'Sistema'} · {dateTime(item.created_at)}</small></p></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ScriptsPage({ notify }) {
  const empty = { title: '', description: '', language: 'SQL', code: '', riskLevel: 'LOW', minVersion: '', tags: '' };
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('ALL');
  const [risk, setRisk] = useState('ALL');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const params = new URLSearchParams({ q, language, risk });
    try { setItems(await api(`/api/scripts?${params}`)); } catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { const t = setTimeout(() => void load(), 160); return () => clearTimeout(t); }, [q, language, risk]);

  const openNew = () => { setEditing('new'); setForm(empty); };
  const openEdit = item => { setEditing(item.id); setForm({ ...item, riskLevel: item.risk_level, minVersion: item.min_version }); };
  const save = async e => {
    e.preventDefault();
    try {
      if (editing === 'new') await api('/api/scripts', { method: 'POST', body: form });
      else await api(`/api/scripts/${editing}`, { method: 'PUT', body: form });
      setEditing(null); await load(); notify('Script salvo.');
    } catch (error) { notify(error.message, 'error'); }
  };
  const copied = async item => {
    await navigator.clipboard.writeText(item.code);
    await api(`/api/scripts/${item.id}/applied`, { method: 'POST', body: { success: true } });
    await load(); notify('Script copiado e uso registrado.');
  };

  return (
    <>
      <PageHead eyebrow="Conhecimento executável" title="Biblioteca de Scripts" text="SQL, PowerShell, CMD, Bash, MikroTik, JSON e outros trechos reutilizáveis." action={<button className="primary-button" onClick={openNew}><Plus /> Novo script</button>} />
      <div className="panel script-toolbar">
        <div className="inline-search"><Search /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar título, código ou tag…" /></div>
        <select value={language} onChange={e => setLanguage(e.target.value)}><option value="ALL">Todas as linguagens</option>{['SQL','POWERSHELL','CMD','BASH','MIKROTIK','JSON','XML','JAVASCRIPT'].map(x => <option key={x}>{x}</option>)}</select>
        <select value={risk} onChange={e => setRisk(e.target.value)}><option value="ALL">Qualquer risco</option><option value="LOW">Baixo</option><option value="MEDIUM">Médio</option><option value="HIGH">Alto</option></select>
      </div>

      <div className="script-grid">
        {items.map(item => {
          const rate = item.usage_count ? Math.round(item.success_count * 100 / item.usage_count) : null;
          return <article className="script-card" key={item.id}>
            <div className="script-card-head"><span className="script-language">{item.language}</span><RiskBadge risk={item.risk_level} />{item.tested ? <span className="tested-badge"><ShieldCheck /> Testado</span> : null}</div>
            <h3>{item.title}</h3><p>{item.description || 'Sem descrição.'}</p>
            <pre><code>{item.code}</code></pre>
            <div className="script-meta"><span>Versão: {item.min_version || 'qualquer'}</span><span>{item.usage_count} usos</span><span>{rate === null ? 'sem taxa' : `${rate}% sucesso`}</span></div>
            {item.tags && <div className="tag-row compact">{item.tags.split(',').map(x => x.trim()).filter(Boolean).map(t => <span key={t}>#{t}</span>)}</div>}
            <div className="script-actions">
              <button className="primary-button" onClick={() => copied(item)}><Copy /> Copiar</button>
              {!item.tested && <button className="secondary-button" onClick={async () => { await api(`/api/scripts/${item.id}/tested`, { method: 'POST' }); await load(); notify('Script marcado como testado.'); }}><CheckCircle2 /> Validar</button>}
              <button className="secondary-button" onClick={() => openEdit(item)}>Editar</button>
              <button className="icon-button danger-soft" onClick={async () => { if (confirm('Excluir este script?')) { await api(`/api/scripts/${item.id}`, { method: 'DELETE' }); await load(); } }}><Trash2 /></button>
            </div>
          </article>;
        })}
      </div>
      {!items.length && <OpsEmpty text="Nenhum script encontrado." large />}

      {editing && <Modal title={editing === 'new' ? 'Novo script' : 'Editar script'} onClose={() => setEditing(null)}>
        <form className="ops-form" onSubmit={save}>
          <label>Título<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Descrição<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <div className="form-grid">
            <label>Linguagem<select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>{['SQL','POWERSHELL','CMD','BASH','MIKROTIK','JSON','XML','JAVASCRIPT'].map(x => <option key={x}>{x}</option>)}</select></label>
            <label>Risco<select value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value })}><option value="LOW">Baixo — leitura/diagnóstico</option><option value="MEDIUM">Médio — altera configuração</option><option value="HIGH">Alto — alteração sensível</option></select></label>
          </div>
          <label>Código<textarea className="code-textarea" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></label>
          <div className="form-grid"><label>Versão mínima<input value={form.minVersion || ''} onChange={e => setForm({ ...form, minVersion: e.target.value })} /></label><label>Tags<input value={form.tags || ''} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Fiscal, SQL, consulta" /></label></div>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary-button"><Save /> Salvar</button></div>
        </form>
      </Modal>}
    </>
  );
}

export function DiagnosticsPage({ notify }) {
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', symptom: '', description: '', treeText: JSON.stringify(sampleTree(), null, 2) });
  const load = async () => { try { setItems(await api('/api/diagnostics')); } catch (e) { notify(e.message, 'error'); } };
  useEffect(() => { void load(); }, []);

  const run = async id => {
    try { setRunning(await api(`/api/diagnostics/${id}`)); } catch (error) { notify(error.message, 'error'); }
  };
  const create = async e => {
    e.preventDefault();
    try {
      await api('/api/diagnostics', { method: 'POST', body: { title: form.title, symptom: form.symptom, description: form.description, tree: JSON.parse(form.treeText) } });
      setCreating(false); setForm({ title: '', symptom: '', description: '', treeText: JSON.stringify(sampleTree(), null, 2) }); await load(); notify('Fluxo de diagnóstico criado.');
    } catch (error) { notify(error.message, 'error'); }
  };

  return <>
    <PageHead eyebrow="Troubleshooting assistido" title="Diagnóstico Guiado" text="Árvores de decisão que transformam sintomas em uma próxima ação consistente." action={<button className="primary-button" onClick={() => setCreating(true)}><Plus /> Novo fluxo</button>} />
    <div className="diagnostic-grid">
      {items.map(item => <article className="diagnostic-card" key={item.id}>
        <div className="diagnostic-icon"><GitBranch /></div><div className="type-badge">{item.active ? 'Ativo' : 'Inativo'}</div>
        <h3>{item.title}</h3><strong className="diagnostic-symptom">{item.symptom || 'Sintoma geral'}</strong><p>{item.description}</p>
        <div className="diagnostic-footer"><span>{item.runs} diagnósticos concluídos</span><button className="primary-button" onClick={() => run(item.id)}><Play /> Iniciar</button></div>
      </article>)}
    </div>
    {!items.length && <OpsEmpty large text="Nenhum fluxo cadastrado." />}
    {running && <DiagnosticRunner flow={running} onClose={() => setRunning(null)} notify={notify} />}
    {creating && <Modal title="Novo fluxo de diagnóstico" onClose={() => setCreating(false)} wide>
      <form className="ops-form" onSubmit={create}>
        <div className="form-grid"><label>Título<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label>Sintoma inicial<input value={form.symptom} onChange={e => setForm({ ...form, symptom: e.target.value })} /></label></div>
        <label>Descrição<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <label>Árvore de decisão <small>Formato estruturado. Cada pergunta aponta para outro nó ou para um resultado.</small><textarea className="json-textarea" value={form.treeText} onChange={e => setForm({ ...form, treeText: e.target.value })} /></label>
        <div className="flow-help"><strong>Estrutura:</strong> <code>startId</code>, lista <code>nodes</code>, nós <code>question</code> com <code>options</code> e nós <code>result</code>.</div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancelar</button><button className="primary-button"><Save /> Criar fluxo</button></div>
      </form>
    </Modal>}
  </>;
}

function DiagnosticRunner({ flow, onClose, notify }) {
  const [currentId, setCurrentId] = useState(flow.tree.startId);
  const [history, setHistory] = useState([]);
  const node = flow.tree.nodes.find(n => n.id === currentId);
  const choose = next => { setHistory(prev => [...prev, currentId]); setCurrentId(next); };
  const back = () => { const copy = [...history]; const last = copy.pop(); if (last) { setHistory(copy); setCurrentId(last); } };
  const complete = async () => {
    await api(`/api/diagnostics/${flow.id}/complete`, { method: 'POST', body: { result: node?.text || '' } });
    notify('Diagnóstico concluído e registrado.'); onClose();
  };
  return <Modal title={flow.title} onClose={onClose}>
    <div className="diagnostic-runner">
      <div className="runner-progress"><GitBranch /><span>{history.length ? `Etapa ${history.length + 1}` : 'Início'}</span></div>
      {!node && <OpsEmpty text="O fluxo aponta para um nó inexistente." />}
      {node?.type === 'question' && <><span className="eyebrow">Pergunta</span><h2>{node.text}</h2><div className="runner-options">{node.options.map((o, i) => <button key={`${o.label}-${i}`} onClick={() => choose(o.next)}><span>{o.label}</span><ArrowRight /></button>)}</div></>}
      {node?.type === 'result' && <div className="runner-result"><CheckCircle2 /><span className="eyebrow">Próxima ação recomendada</span><h2>{node.text}</h2><button className="primary-button" onClick={complete}><Check /> Concluir diagnóstico</button></div>}
      {history.length > 0 && node?.type !== 'result' && <button className="text-button" onClick={back}>← Voltar uma etapa</button>}
    </div>
  </Modal>;
}

export function ProceduresPage({ notify, onOpenArticle }) {
  const [items, setItems] = useState([]);
  const [articles, setArticles] = useState([]);
  const [selectedArticleId, setSelectedArticleId] = useState('');
  const [step, setStep] = useState({ title: '', detail: '', commandText: '', expectedResult: '' });
  const load = async () => {
    try {
      const [procedures, published] = await Promise.all([api('/api/procedures'), api('/api/articles?status=PUBLISHED')]);
      setItems(procedures); setArticles(published);
    } catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, []);
  const addStep = async e => {
    e.preventDefault();
    if (!selectedArticleId) return;
    try {
      await api(`/api/articles/${selectedArticleId}/procedure/steps`, { method: 'POST', body: step });
      setStep({ title: '', detail: '', commandText: '', expectedResult: '' }); await load(); notify('Passo adicionado ao procedimento.');
    } catch (error) { notify(error.message, 'error'); }
  };
  return <>
    <PageHead eyebrow="Execução assistida" title="Procedimentos" text="Checklists operacionais com comando, saída esperada e progresso por usuário." />
    <div className="panel procedure-builder">
      <div><span className="eyebrow">Adicionar passo</span><h3>Transformar um artigo em procedimento executável</h3></div>
      <form onSubmit={addStep}>
        <select required value={selectedArticleId} onChange={e => setSelectedArticleId(e.target.value)}><option value="">Selecione o artigo…</option>{articles.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select>
        <input required value={step.title} onChange={e => setStep({ ...step, title: e.target.value })} placeholder="Ex.: Confirmar código e mensagem" />
        <textarea value={step.detail} onChange={e => setStep({ ...step, detail: e.target.value })} placeholder="Como executar este passo?" />
        <div className="form-grid"><textarea className="code-mini" value={step.commandText} onChange={e => setStep({ ...step, commandText: e.target.value })} placeholder="Comando/SQL opcional" /><textarea value={step.expectedResult} onChange={e => setStep({ ...step, expectedResult: e.target.value })} placeholder="Resultado esperado" /></div>
        <button className="primary-button"><Plus /> Adicionar passo</button>
      </form>
    </div>
    <div className="procedure-grid">
      {items.map(item => <article className="procedure-card" key={item.id}>
        <div className="procedure-number"><ClipboardCheck /></div><span className="type-badge">{item.step_count} passos</span>
        <h3>{item.title}</h3><p>{item.description}</p><div className="procedure-stats"><span>{item.completed_runs} execuções concluídas</span><span>Atualizado {dateShort(item.updated_at)}</span></div>
        <button className="primary-button" onClick={() => onOpenArticle({ id: item.id })}><Play /> Abrir procedimento</button>
      </article>)}
    </div>
    {!items.length && <OpsEmpty large text="Adicione um passo a um artigo para ele aparecer aqui." />}
  </>;
}

export function ReviewsPage({ notify, onOpenArticle }) {
  const [items, setItems] = useState([]);
  const load = async () => { try { setItems(await api('/api/ops/reviews')); } catch (e) { notify(e.message, 'error'); } };
  useEffect(() => { void load(); }, []);
  return <>
    <PageHead eyebrow="Governança" title="Revisão do Conhecimento" text="Controle de validade para evitar procedimentos antigos circulando como se ainda fossem atuais." />
    <div className="review-list panel">
      <div className="review-list-head"><span>Conteúdo</span><span>Responsável</span><span>Próxima revisão</span><span>Status</span><span>Ações</span></div>
      {items.map(item => <div className="review-row" key={item.id}>
        <button className="review-title" onClick={() => onOpenArticle({ id: item.id })}><strong>{item.title}</strong><small>{item.type.replaceAll('_',' ')} · atualizado {dateShort(item.updated_at)}</small></button>
        <span>{item.author_name}</span><span>{item.next_review_at ? dateShort(item.next_review_at) : 'Nunca agendada'}</span><ReviewBadge status={item.review_status} />
        <div className="review-actions"><button className="secondary-button" onClick={async () => { await api(`/api/articles/${item.id}/review`, { method: 'POST', body: { days: item.review_interval_days || 90 } }); await load(); notify('Conteúdo revisado e validade renovada.'); }}><ShieldCheck /> Validar</button></div>
      </div>)}
    </div>
  </>;
}

export function ArticleOperations({ article, notify, onOpenArticle, onQr, onRefreshArticle }) {
  const [ops, setOps] = useState(null);
  const [versions, setVersions] = useState([]);
  const [procedure, setProcedure] = useState(null);
  const [runBusy, setRunBusy] = useState(false);
  const load = async () => {
    try {
      const [o, v, p] = await Promise.all([
        api(`/api/articles/${article.id}/operations`),
        api(`/api/articles/${article.id}/versions`),
        api(`/api/articles/${article.id}/procedure`)
      ]);
      setOps(o); setVersions(v); setProcedure(p);
    } catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, [article.id]);

  const registerUse = async success => {
    const stats = await api(`/api/articles/${article.id}/applied`, { method: 'POST', body: { success } });
    setOps(prev => ({ ...prev, solution: stats }));
    notify(success ? 'Uso bem-sucedido registrado.' : 'Falha registrada para revisão do conteúdo.');
  };
  const startProcedure = async () => {
    setRunBusy(true);
    try { await api(`/api/articles/${article.id}/procedure/start`, { method: 'POST' }); await load(); notify('Execução do procedimento iniciada.'); } catch (e) { notify(e.message, 'error'); } finally { setRunBusy(false); }
  };
  const toggleStep = async (stepId, completed) => {
    if (!procedure?.run) return;
    await api(`/api/procedure-runs/${procedure.run.id}/steps/${stepId}`, { method: 'PATCH', body: { completed } });
    await load();
  };
  const restore = async version => {
    if (!confirm(`Restaurar a versão ${version.version_number}? A versão atual será salva antes da restauração.`)) return;
    await api(`/api/articles/${article.id}/versions/${version.id}/restore`, { method: 'POST' });
    await onRefreshArticle(); await load(); notify(`Versão ${version.version_number} restaurada.`);
  };

  const solution = ops?.solution || { total: 0, successRate: null };
  return <div className="article-operations">
    <section className="article-ops-summary">
      <div><span className="eyebrow">Confiança operacional</span><strong>{solution.successRate === null ? 'Sem histórico' : `${solution.successRate}%`}</strong><small>{solution.total} aplicações registradas</small></div>
      <div className="solution-use-actions"><button onClick={() => registerUse(true)}><ThumbsUp /> Resolvi com isso</button><button onClick={() => registerUse(false)}><ThumbsDown /> Não funcionou</button></div>
    </section>

    <section className="governance-strip">
      <ReviewBadge status={ops?.governance?.review_status || 'UNKNOWN'} />
      <span>{ops?.governance?.last_reviewed_at ? `Validado em ${dateShort(ops.governance.last_reviewed_at)}` : 'Ainda não passou por revisão formal.'}</span>
      <button className="text-button" onClick={async () => { await api(`/api/articles/${article.id}/review`, { method: 'POST', body: { days: 90 } }); await load(); notify('Validade renovada por 90 dias.'); }}><ShieldCheck /> Validar agora</button>
      <button className="text-button" onClick={() => onQr(article)}><QrCode /> QR</button>
    </section>

    {(ops?.steps || []).length > 0 && <section className="procedure-run-box">
      <div className="section-title"><div><span className="eyebrow">Procedimento executável</span><h2>Checklist de execução</h2></div>{!procedure?.run || procedure.run.status === 'COMPLETED' ? <button className="primary-button" disabled={runBusy} onClick={startProcedure}><Play /> {procedure?.run?.status === 'COMPLETED' ? 'Executar novamente' : 'Iniciar'}</button> : <span className="run-status"><Clock3 /> Em andamento</span>}</div>
      <div className="procedure-step-list">
        {(ops?.steps || []).map((step, index) => {
          const state = procedure?.runSteps?.find(x => x.step_id === step.id);
          return <div className={`procedure-step ${state?.completed ? 'done' : ''}`} key={step.id}>
            <button disabled={!procedure?.run || procedure.run.status === 'COMPLETED'} onClick={() => toggleStep(step.id, !state?.completed)}>{state?.completed ? <Check /> : index + 1}</button>
            <div><strong>{step.title}</strong>{step.detail && <p>{step.detail}</p>}{step.command_text && <div className="step-command"><code>{step.command_text}</code><button onClick={() => navigator.clipboard.writeText(step.command_text)}><Copy /></button></div>}{step.expected_result && <small>Esperado: {step.expected_result}</small>}</div>
          </div>;
        })}
      </div>
    </section>}

    {(ops?.related || []).length > 0 && <section className="related-section"><div className="section-title"><div><span className="eyebrow">Contexto</span><h2>Conteúdos relacionados</h2></div></div><div className="related-grid">{ops.related.map(item => <button key={item.id} onClick={() => onOpenArticle({ id: item.id })}><BookOpen /><span><strong>{item.title}</strong><small>{item.shared_tags === 99 ? 'Relacionamento manual' : `${item.shared_tags} tags em comum`}</small></span><ChevronRight /></button>)}</div></section>}

    <details className="versions-box"><summary><History /> Histórico de versões <b>{versions.length}</b></summary><div className="version-list">{!versions.length && <OpsEmpty text="A primeira versão será criada automaticamente na próxima edição." />}{versions.map(v => <div key={v.id}><span className="version-number">v{v.version_number}</span><p><strong>{v.title}</strong><small>{v.change_note || 'Alteração registrada'} · {v.changed_by_name || 'Sistema'} · {dateTime(v.created_at)}</small></p><button className="secondary-button" onClick={() => restore(v)}><RotateCcw /> Restaurar</button></div>)}</div></details>
  </div>;
}

export function QuickCaptureModal({ onClose, notify, onCreated }) {
  const [form, setForm] = useState({ problem: '', solution: '', errorCode: '', tags: '', publish: false });
  const submit = async e => {
    e.preventDefault();
    try {
      const article = await api('/api/quick-capture', { method: 'POST', body: form });
      notify(form.publish ? 'Solução publicada.' : 'Solução capturada como rascunho.'); onClose(); onCreated?.(article);
    } catch (error) { notify(error.message, 'error'); }
  };
  return <Modal title="Registrar solução rápida" onClose={onClose}><form className="ops-form quick-capture" onSubmit={submit}>
    <div className="quick-capture-tip"><Zap /><p><strong>Capture em segundos.</strong><span>Depois você pode transformar isso em um artigo completo, anexar evidências ou criar um procedimento.</span></p></div>
    <label>Código / mensagem de erro<input value={form.errorCode} onChange={e => setForm({ ...form, errorCode: e.target.value })} placeholder="Opcional" /></label>
    <label>Problema<textarea required value={form.problem} onChange={e => setForm({ ...form, problem: e.target.value })} placeholder="O que estava acontecendo?" /></label>
    <label>Solução<textarea required value={form.solution} onChange={e => setForm({ ...form, solution: e.target.value })} placeholder="O que resolveu?" /></label>
    <label>Tags<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="NFCe, certificado, rede…" /></label>
    <label className="checkbox-line"><input type="checkbox" checked={form.publish} onChange={e => setForm({ ...form, publish: e.target.checked })} /> Publicar imediatamente</label>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button"><Save /> Registrar</button></div>
  </form></Modal>;
}

export function MobileBottomNav({ page, setPage, onSearch, onQuickCapture, onMore }) {
  return <nav className="mobile-bottom-nav">
    <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}><Sparkles /><span>Início</span></button>
    <button onClick={onSearch}><Search /><span>Buscar</span></button>
    <button className="mobile-capture" onClick={onQuickCapture}><Plus /></button>
    <button className={page === 'articles' ? 'active' : ''} onClick={() => setPage('articles')}><BookOpen /><span>Base</span></button>
    <button onClick={onMore}><Wrench /><span>Mais</span></button>
  </nav>;
}

export function QrContent({ dataUrl, article }) {
  return <div className="qr-content"><div className="qr-frame">{dataUrl ? <img src={dataUrl} alt={`QR para ${article.title}`} /> : <RefreshCw className="spin" />}</div><h3>{article.title}</h3><p>Escaneie para abrir este conhecimento diretamente no KnowBase.</p></div>;
}

function ReviewBadge({ status }) {
  const map = { CURRENT: ['current', 'Atualizado'], DUE_SOON: ['soon', 'Revisar em breve'], OVERDUE: ['overdue', 'Desatualizado'], UNKNOWN: ['unknown', 'Sem revisão'] };
  const [cls, text] = map[status] || map.UNKNOWN;
  return <span className={`review-badge ${cls}`}><span />{text}</span>;
}
function StatusDot({ status }) { return <span className={`status-dot ${String(status || 'UNKNOWN').toLowerCase()}`} />; }
function RiskBadge({ risk }) { const labels = { LOW: 'Risco baixo', MEDIUM: 'Risco médio', HIGH: 'Risco alto' }; return <span className={`risk-badge ${String(risk).toLowerCase()}`}>{labels[risk] || risk}</span>; }
function OpsEmpty({ text, large = false }) { return <div className={`ops-empty ${large ? 'large' : ''}`}><CheckCircle2 /><span>{text}</span></div>; }
function PageHead({ eyebrow, title, text, action }) { return <div className="page-heading-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{text}</p></div>{action}</div>; }
function Modal({ title, onClose, children, wide = false }) { return <div className="modal-layer"><div className={`ops-modal ${wide ? 'wide' : ''}`}><div className="ops-modal-head"><strong>{title}</strong><button className="icon-button" onClick={onClose}><X /></button></div><div className="ops-modal-body">{children}</div></div></div>; }
function activityName(action) { return ({ REVIEWED: 'Revisou', VERSION_SNAPSHOT: 'Versionou', VERSION_RESTORED: 'Restaurou', SOLUTION_SUCCESS: 'Validou na prática', SOLUTION_FAILED: 'Sinalizou falha em', SCRIPT_CREATED: 'Criou script', SCRIPT_VALIDATED: 'Validou script', QUICK_CAPTURE: 'Registrou solução', DIAGNOSTIC_COMPLETED: 'Concluiu diagnóstico', PROCEDURE_COMPLETED: 'Concluiu procedimento' })[action] || 'Atualizou'; }
function sampleTree() { return { startId: 'q1', nodes: [ { id: 'q1', type: 'question', text: 'Qual caminho seguir?', options: [{ label: 'Cenário A', next: 'r1' }, { label: 'Cenário B', next: 'r2' }] }, { id: 'r1', type: 'result', text: 'Descreva aqui a ação recomendada para o cenário A.' }, { id: 'r2', type: 'result', text: 'Descreva aqui a ação recomendada para o cenário B.' } ] }; }
