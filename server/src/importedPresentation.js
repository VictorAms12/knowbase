function cleanImportedBody(html = '') {
  const source = String(html || '');
  if (!/Base de conhecimento Nortesys importada automaticamente/i.test(source)) return source;
  if (!/<h2[^>]*>\s*Conteúdo de referência\s*<\/h2>/i.test(source)) return source;

  const note = [
    '<blockquote>',
    '<p><strong>Visualização do conteúdo:</strong> o texto extraído automaticamente foi ocultado desta página para não distorcer documentos com formatação irregular.</p>',
    '<p>Use os materiais anexados abaixo para consultar o documento no visualizador interno. O texto extraído continua indexado e pesquisável pela busca do KnowBase.</p>',
    '</blockquote>'
  ].join('');

  return source.replace(
    /<h2[^>]*>\s*Conteúdo de referência\s*<\/h2>[\s\S]*?(?=<h2[^>]*>\s*Materiais de origem\s*<\/h2>|$)/i,
    note
  );
}

function transformArticle(article) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) return article;
  if (typeof article.body_html !== 'string') return article;
  return { ...article, body_html: cleanImportedBody(article.body_html) };
}

function transformPayload(payload) {
  if (Array.isArray(payload)) return payload.map(transformArticle);
  return transformArticle(payload);
}

export function importedArticlePresentation(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = payload => originalJson(transformPayload(payload));
  next();
}

export { cleanImportedBody };
