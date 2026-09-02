# KnowBase

Central operacional de conhecimento para equipes de suporte, documentação e treinamento.

A primeira entrega do projeto implementa as **Fases 1, 2 e 3**: artigos e mídia, base de troubleshooting e colaboração, busca/indexação e central multimídia.

## Stack

- **Frontend:** React + Vite + TipTap
- **Backend:** Node.js 22 + Express
- **Banco:** SQLite nativo do Node (`node:sqlite`)
- **Busca:** SQLite FTS5 com fallback automático para busca textual
- **Arquivos:** storage local em `server/uploads/` no desenvolvimento
- **Extração:** PDF, DOCX, XLSX/CSV, PPTX, TXT/SQL/scripts

O uso de `node:sqlite` evita dependências nativas como `better-sqlite3`, `node-gyp` ou Python.

## O que já está implementado

### Fase 1 — Fundação
- artigos com título, tipo, descrição, rich text, autor, status e visualizações;
- editor TipTap com headings, listas, código, citação, links, imagens e tabelas;
- upload de PDF, DOCX, XLSX, PPTX, MP4, WEBM, ZIP, SQL, TXT e imagens;
- colagem de prints com `Ctrl+V`;
- drag-and-drop de arquivos no editor;
- player nativo para MP4/WEBM com velocidades 1x, 1.25x, 1.5x e 2x;
- incorporação de YouTube, Vimeo, Loom, Google Drive e Microsoft Stream;
- leitor PDF inline;
- preview textual de DOCX/XLSX/PPTX/scripts;
- tags globais, favoritos e tema claro/escuro;
- layout responsivo.

### Fase 2 — Base de conhecimento
- base estruturada de Problemas & Soluções;
- código/mensagem do erro, causa raiz, solução e validação;
- marcador **Solução testada e aprovada**;
- comentários e dúvidas em artigos;
- feedback útil Sim/Não;
- sugestão de edição;
- solicitação de novo treinamento/manual;
- feed de conteúdos recentes e mais acessados.

### Fase 3 — Multimídia e busca
- extração automática de texto de PDFs;
- extração de texto de DOCX;
- extração de planilhas XLSX/CSV;
- extração de texto de apresentações PPTX;
- indexação de TXT, SQL e scripts;
- nome de arquivos e conteúdo extraído incluídos no índice;
- transcrição/descrição de vídeo pesquisável;
- busca Full Text Search (FTS5) por artigo, tag, erro e anexos;
- filtros de busca por tipo de conteúdo, tipo de mídia e autor;
- endpoint de progresso de reprodução preparado para histórico de vídeos.

> **Transcrição automática de fala:** nesta fase a transcrição fica associada ao vídeo e entra na busca, porém nenhum provedor pago de speech-to-text é obrigatório. A integração automática poderá ser adicionada na Fase 4 sem alterar a estrutura dos artigos.

## Requisitos

- Node.js **22.13+**
- npm 10+

## Executar em desenvolvimento

```bash
npm install
npm run dev
```

A aplicação abre em:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3333`

O Vite redireciona `/api` e `/uploads` para a API durante o desenvolvimento.

## Build de produção

```bash
npm install
npm run build
npm start
```

Quando `client/dist` existe, o Express também serve o frontend compilado.

## Configuração opcional

```env
PORT=3333
MAX_UPLOAD_MB=500
```

## Persistência

Na primeira inicialização o servidor cria:

```text
server/data/knowbase.db
server/uploads/
```

Essas pastas ficam fora do Git.

## Estrutura

```text
knowbase/
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── RichEditor.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   └── vite.config.js
├── server/
│   └── src/
│       ├── db.js
│       ├── extractors.js
│       └── index.js
└── .github/workflows/ci.yml
```

## Próxima fase

A Fase 4 deve concentrar o polimento e evolução:

- autenticação real e RBAC completo;
- histórico/versionamento de artigos;
- analytics de consumo;
- ranking de treinamentos;
- sugestões automáticas de conteúdos relacionados;
- storage S3/MinIO;
- filas/workers para arquivos grandes;
- transcrição automática opcional;
- Meilisearch ou busca semântica quando o volume justificar;
- revisão editorial/aprovação;
- observabilidade e auditoria.
