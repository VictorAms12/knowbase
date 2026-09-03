# KnowBase

Central operacional de conhecimento para equipes de suporte, documentação e treinamento.

O KnowBase reúne artigos, troubleshooting, documentos, vídeos, scripts e procedimentos em uma base pesquisável. A evolução **Knowledge Operations v2** adiciona recursos para transformar a base em ferramenta de trabalho diário, sem incluir sistema de tickets/chamados.

## Stack

- **Frontend:** React + Vite + TipTap
- **Backend:** Node.js 22 + Express
- **Banco:** SQLite nativo do Node (`node:sqlite`)
- **Busca:** SQLite FTS5 + busca unificada operacional
- **Arquivos:** storage local em `server/uploads/`
- **Extração:** PDF, DOCX, ODT, XLSX/CSV, PPTX, TXT/SQL/scripts
- **Mobile:** layout responsivo + PWA instalável

## Base de conhecimento e multimídia

- artigos com título, tipo, descrição, rich text, autor, status e visualizações;
- editor TipTap com headings, listas, código, citação, links, imagens e tabelas;
- upload de PDF, DOCX, XLSX, PPTX, MP4, WEBM, ZIP, SQL, TXT e imagens;
- `Ctrl+V` para prints e drag-and-drop de arquivos;
- player MP4/WEBM com 1x, 1.25x, 1.5x e 2x;
- incorporação de YouTube, Vimeo, Loom, Google Drive e Microsoft Stream;
- leitor PDF inline;
- preview textual de documentos, planilhas, apresentações e scripts;
- texto de anexos e transcrições incluído na pesquisa;
- tags globais, favoritos, comentários e tema claro/escuro.

Vídeos, manuais e PDFs não possuem mais menus redundantes: permanecem na Base de Conhecimento e podem ser filtrados por mídia.

## Troubleshooting

- código/mensagem do erro;
- causa raiz;
- solução;
- passos de validação;
- selo **Solução testada e aprovada**;
- feedback útil Sim/Não;
- registro de aplicação prática da solução;
- sucesso ou falha registrado para alimentar confiança e revisão.

## Biblioteca de Scripts

Scripts deixam de ser somente anexos e possuem uma biblioteca própria.

Suporta, entre outros:

- SQL;
- PowerShell;
- CMD;
- Bash;
- MikroTik;
- JSON;
- XML;
- JavaScript.

Cada script pode ter:

- descrição;
- nível de risco;
- versão mínima;
- tags;
- validação/teste;
- contador de uso;
- contador/taxa de sucesso;
- ação rápida de copiar.

## Diagnóstico Guiado

Fluxos em árvore ajudam o analista a transformar um sintoma em perguntas discriminantes e uma próxima ação.

Os fluxos possuem:

- sintoma inicial;
- perguntas;
- múltiplas opções;
- navegação entre nós;
- resultados/recomendações;
- contador de diagnósticos concluídos.

Um fluxo de triagem geral é criado como exemplo no banco novo.

## Procedimentos Executáveis

Qualquer artigo publicado pode receber uma sequência operacional de passos.

Cada passo pode conter:

- título;
- explicação;
- comando/SQL opcional;
- resultado esperado.

O usuário pode iniciar o procedimento, marcar etapas e concluir a execução. O progresso é persistido individualmente.

## Importação de bases legadas

O KnowBase possui um importador para transformar pastas ou arquivos compactados de documentação em conteúdos pesquisáveis no banco local.

Ele aceita:

- diretórios já extraídos;
- `.rar`;
- `.zip`;
- `.7z`.

Durante a importação ele:

- agrupa versões equivalentes do mesmo material para reduzir duplicidade;
- extrai texto de PDF, DOCX, ODT, planilhas, apresentações, TXT, SQL, XML e JSON;
- cria artigos com título, descrição, categoria e tags inferidas;
- transforma listas numeradas em **procedimentos executáveis** quando identifica pelo menos duas etapas;
- preserva os arquivos originais em `server/uploads/` e os vincula ao artigo;
- inclui o texto extraído no índice de busca;
- classifica vídeos e áudios como materiais do conhecimento;
- marca todo conteúdo importado para revisão imediata;
- registra a origem em `knowledge_import_sources`, evitando duplicação quando o mesmo pacote é importado novamente.

### Importar uma pasta

```bash
npm run import:knowledge -- "/caminho/PASSO A PASSO DE PROCESSOS"
```

### Importar um RAR

```bash
npm run import:knowledge -- "/caminho/base-nortesys.rar"
```

Por padrão, os conteúdos são publicados. Para importar primeiro como rascunho:

```bash
npm run import:knowledge -- "/caminho/base-nortesys.rar" --draft
```

Para apenas analisar o pacote sem alterar o banco:

```bash
npm run import:knowledge -- "/caminho/base-nortesys.rar" --dry-run
```

Opções adicionais:

- `--include-ada`: inclui a pasta `IA ADA`, normalmente ignorada por conter cópias/testes;
- `--include-all`: inclui também documentos comerciais/termos ignorados por padrão;
- `--keep-temp`: mantém a pasta temporária criada na extração.

### Termux / Android

No Termux, dê acesso aos arquivos compartilhados e instale o extrator 7-Zip:

```bash
pkg update
pkg install 7zip
termux-setup-storage
```

Depois, supondo que o RAR esteja em Downloads:

```bash
cd ~/knowbase
git pull origin main
npm install
npm run import:knowledge -- "$HOME/storage/downloads/base-nortesys.rar"
npm run dev
```

Se o arquivo tiver outro nome, substitua apenas o último caminho pelo nome real do RAR.

> O banco e os anexos continuam locais. Portanto, o importador deve ser executado no computador/servidor que será a fonte persistente do KnowBase. Depois de importar, faça backup de `server/data/` e `server/uploads/`.

## Versionamento e governança

Antes de cada edição de um artigo existente, o KnowBase salva automaticamente um snapshot da versão atual.

Recursos:

- histórico de versões;
- autor/data da mudança;
- nota da alteração;
- restauração de versão antiga;
- backup automático da versão atual antes de restaurar;
- última revisão formal;
- próxima revisão;
- intervalo de validade;
- estados **Atualizado**, **Revisar em breve**, **Desatualizado** e **Sem revisão**.

A tela de Revisões concentra conteúdos que precisam de validação.

## Relacionamento entre conteúdos

O KnowBase sugere conteúdos relacionados usando tags compartilhadas. Também existe estrutura para relações manuais.

Isso permite que um artigo de certificado, por exemplo, leve naturalmente a erros SSL/TLS, procedimentos, scripts e manuais relacionados.

## Captura Rápida

O botão **Registrar solução rápida** permite salvar conhecimento sem preencher um artigo completo.

Campos mínimos:

- problema;
- solução;
- código/mensagem opcional;
- tags.

Pode ser salvo como rascunho ou publicado imediatamente e depois enriquecido no editor completo.

## Dashboard operacional

Além das métricas gerais, a Home mostra:

- revisões vencidas/próximas;
- conteúdos com confiança baixa;
- scripts mais usados;
- atividade recente;
- quantidade de procedimentos e fluxos de diagnóstico;
- atalhos para ações frequentes.

## Busca / Central de Comando

`Ctrl + K` pesquisa de forma unificada:

- artigos;
- troubleshooting;
- códigos de erro;
- anexos e texto extraído;
- scripts e código interno;
- diagnósticos guiados.

Exemplos:

```text
539
certificado
SELECT
spooler
NFCE
```

## QR por conteúdo

Artigos podem gerar um QR Code que abre diretamente o conteúdo através do parâmetro `?article=ID`.

Isso permite usar o KnowBase em etiquetas ou documentação física de máquinas, setores e equipamentos sem criar um sistema paralelo de inventário.

## Mobile e PWA

O desktop mantém a mesma linguagem visual original. No celular foram adicionados:

- barra inferior de navegação;
- busca central;
- botão destacado de captura rápida;
- menu completo pela ação **Mais**;
- formulários e painéis em uma coluna;
- modais adaptados para bottom sheet;
- editor em tela cheia quando necessário;
- visualizador de mídia em tela cheia;
- tabelas administrativas convertidas para cartões;
- suporte a `safe-area`;
- manifest e service worker para instalação como PWA;
- histórico de reprodução de vídeos locais.

## Fora do escopo propositalmente

Esta versão **não implementa**:

- sistema de tickets/chamados;
- trilhas de aprendizado;
- laboratórios;
- IA/busca semântica da Fase 4.

A ideia é integrar futuramente com ferramentas corporativas existentes em vez de duplicá-las.

## Requisitos

- Node.js **22.13+**
- npm 10+

## Executar em desenvolvimento

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3333`

## Build de produção

```bash
npm install
npm run build
npm start
```

Quando `client/dist` existe, o Express serve a SPA e os assets da PWA.

## Persistência

Na primeira inicialização:

```text
server/data/knowbase.db
server/uploads/
```

As tabelas das funcionalidades novas são criadas automaticamente sem apagar os dados anteriores.

## Estrutura principal

```text
knowbase/
├── client/
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── sw.js
│   │   └── knowbase-icon.svg
│   └── src/
│       ├── App.jsx              # primeira interface preservada no histórico
│       ├── AppV2.jsx            # integração atual
│       ├── KnowledgeOperations.jsx
│       ├── RichEditor.jsx
│       ├── api.js
│       ├── styles.css           # identidade visual original
│       └── operations.css       # extensões operacionais/mobile
├── server/
│   └── src/
│       ├── bootstrap.js
│       ├── operations.js
│       ├── db.js
│       ├── extractors.js
│       ├── importKnowledge.js
│       └── index.js
└── .github/workflows/ci.yml
```

## CI

O GitHub Actions executa:

1. instalação das dependências;
2. validação sintática do backend;
3. build Vite;
4. smoke test do importador, incluindo idempotência e criação de procedimentos;
5. inicialização real do servidor;
6. smoke tests de health, dashboard operacional, scripts, diagnósticos, procedimentos, captura rápida e busca unificada.
