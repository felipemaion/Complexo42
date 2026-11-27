# AGENTS.md — Regras para agentes de IA e desenvolvedores

Este arquivo vale para **qualquer** assistente (Claude Code, Cursor, Copilot, Codex, Gemini,
etc.) e para humanos. Se a sua ferramenta lê outro arquivo (`CLAUDE.md`, `.cursorrules`), ele
apenas aponta para cá. **Em caso de conflito, este arquivo vence.**

---

## 0. Antes de escrever qualquer código

1. Trabalhe em **uma issue por vez**. Sem issue, não há trabalho: abra uma antes.
2. Leia a issue inteira, os critérios de aceite e os documentos citados nela.
3. Leia `docs/MODELO_DADOS.md` se a tarefa tocar dados e `docs/LGPD_E_SEGURANCA.md` se tocar
   autenticação, permissões ou dados pessoais. Tocou permissão? Leia
   `docs/adr/0002-permissoes-hierarquicas.md`. Tocou nome, WhatsApp ou redes? Leia
   `docs/adr/0003-protecao-de-dados.md`.
4. Se algo estiver ambíguo, **pare e pergunte na issue**. Não invente requisito.

## 1. Regras inegociáveis (o CI bloqueia ou o revisor recusa)

| # | Regra |
|---|---|
| R1 | **Nunca** fazer commit direto na `main`. Todo código entra por Pull Request. |
| R2 | **Nenhum PR sem teste.** Toda funcionalidade nova ou bug corrigido traz teste automatizado. |
| R3 | `npm run check` (lint + tipos + testes + build) **passa localmente** antes de abrir o PR. |
| R4 | **Nenhum campo de dado pessoal novo** fora da lista em `docs/MODELO_DADOS.md`. Para adicionar um, abra um ADR e peça aprovação. CPF, RG, endereço, data de nascimento e foto de documento são **proibidos**. O e-mail só é exibido conforme o ADR 0010. |
| R5 | **Toda tabela nova tem RLS habilitada e política explícita**, com teste provando que um usuário **não** lê dados de outro. |
| R6 | **Nunca** usar a chave `service_role` (ou equivalente com acesso total) em código que roda no navegador. |
| R7 | **Nenhum segredo no repositório**: chaves, tokens e senhas ficam em `.env.local` (no `.gitignore`) e nos secrets da plataforma. |
| R8 | Mudança de banco **somente via migration versionada** em `supabase/migrations/`. Nunca editar o banco de produção pelo painel. |
| R9 | **Nenhuma dependência nova** sem justificar no PR: para que serve, por que não dá para fazer sem ela, e se é mantida. |
| R10 | Nunca desativar teste, lint ou checagem para "fazer passar". Se um teste está errado, corrija o teste e explique no PR. |
| R11 | Não logar dados pessoais (WhatsApp, nome) em `console.log`, logs de servidor ou mensagens de erro. |
| R12 | PR pequeno: idealmente **menos de 400 linhas alteradas**, um assunto só. |
| R13 | **Dado pessoal (nome, WhatsApp, redes) só é gravado cifrado**, em colunas `*_enc`, e só é cifrado e decifrado em `src/server/crypto/`, no servidor. Nunca no navegador, nunca em texto puro no banco (ADR 0003). |
| R14 | **O navegador não consulta direto as tabelas com dado pessoal.** Ele passa pelo servidor, que usa o JWT do usuário (a RLS continua valendo). |
| R15 | **Toda decisão de acesso usa as funções SQL `app.can_*`** (ADR 0002). Não reimplementar a regra de papel ou escopo no front. Esconder botão é conforto, não segurança. |
| R16 | **Todo PR que toca permissão atualiza `supabase/tests/permissions_matrix.test.sql`**, com pelo menos um caso "fora do escopo → negado". |
| R17 | **Código genérico** (ADR 0005): nomes como `unit`, `member`, `task`, `badge`. Nunca nomes de instância (ex.: "academia", "turma") fixos no código; textos da interface vêm de `config/`. |
| R18 | Arquivos críticos (`supabase/`, `src/server/crypto/`, `src/server/auth/`, `.github/`, `AGENTS.md`) só entram com **aprovação do code owner**. |
| R19 | **Custo zero.** Proibido adicionar serviço, API, plano ou dependência que gere cobrança (SMS, WhatsApp API, IA paga, upgrade de plano, add-on do marketplace). Só planos gratuitos; qualquer exceção (teto de R$ 100/mês) exige ADR aprovado pelo gestor. Na dúvida sobre custo, pergunte na issue. |

## 2. Convenções

- **Idioma:** código, nomes de variáveis, tabelas e commits em **inglês**; interface,
  documentação e issues em **português**.
- **Branch:** `tipo/numero-da-issue-descricao-curta`
  (ex.: `feat/12-cadastro-perfil`, `fix/31-filtro-bairro`).
- **Commit:** [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`), citando a issue (`refs #12`).
- **PR:** use o template e coloque `Closes #NN` na descrição.
- **TypeScript estrito.** Proibido `any` sem comentário explicando o motivo.
- **Validação de entrada** com schema (Zod) **no servidor**, sempre. Validação no cliente é
  só conforto para o usuário.

## 2.1 Estrutura do código (monólito modular)

Adaptado do ADR-001 do protótipo original do Complexo42 ([Vguedess/Complexo42](https://github.com/Vguedess/Complexo42)). Um app só, separado por domínio:

```
src/
  app/                        # rotas Next.js: só composição de telas
  modules/<dominio>/          # profiles, units, missions, points, badges, skills…
    index.ts                  # API pública do módulo (o que outros módulos podem importar)
    types.ts                  # contratos
    domain/                   # regras puras + testes (*.test.ts), sem banco nem React
    server/                   # server actions/serviços: sessão, Zod, chamadas ao Supabase
    components/               # React: só apresentação e eventos
  server/crypto/              # ADR 0003 (code owner)
  server/auth/                # sessão e helpers (code owner)
config/instance.ts            # rótulos e identidade da instância (ADR 0005)
supabase/migrations/          # SQL versionado (code owner)
supabase/tests/               # pgTAP: RLS e matriz de permissões (code owner)
```

- Um módulo **só importa o `index.ts`** de outro módulo, nunca arquivos internos.
- Componentes React **não** acessam o banco; quem acessa é `server/`.
- Regra de negócio nova vai para `domain/`, com teste, antes de ir para a tela.

## 2.2 Como escrever o código

O objetivo é que outra pessoa (ou a IA dela) entenda o trecho sem perguntar nada ao autor.
Cada item abaixo é verificável na revisão.

**Nomes**

- O nome diz **o que é**, não como é feito: `activeMembers`, não `list2` nem `data`.
- Booleanos começam com `is`, `has`, `can` ou `should`: `isExpired`, `canManageUnit`.
- Funções são verbos ou transformações: `nextFlow`, `brazilianWhatsappToE164`. Tipos e
  componentes em `PascalCase`; arquivos em `kebab-case` (`delete-account.ts`).
- Unidade no nome quando houver: `timeoutMs`, `maxLengthChars`, `ttlDays`.
- Sem abreviação inventada (`usr`, `cfg`, `tmp`). Siglas consagradas (`id`, `url`) podem.
- Nomes genéricos do domínio (R17): `unit`, `member`, `task`, nunca o rótulo da instância.

**Simplicidade (KISS, YAGNI, DRY com moderação)**

- Resolva o caso da issue, não o "e se um dia". Sem parâmetro, flag ou abstração sem uso hoje.
- **Regra de três:** duplicou uma vez, tudo bem; na terceira cópia, extraia. Abstração
  errada custa mais que repetição.
- DRY vale para **conhecimento**, não para texto parecido: uma regra de negócio mora num
  lugar só (`domain/`, `app.can_*`); dois trechos iguais por coincidência podem ficar.

**Funções**

- Pequenas e com um assunto. Passou de ~40 linhas ou de 3 níveis de `if`, divida.
- Em `domain/`, **puras**: mesma entrada, mesma saída; sem banco, rede, `Date.now()` ou
  `Math.random()` escondidos. O que varia entra por parâmetro.
- **Early return** em vez de `if` aninhado:

```ts
// assim (src/modules/profiles/domain/whatsapp.ts)
if (typeof raw !== "string" || raw.length > whatsappInputMaxLength) return null;
if (/[^\d\s()+.-]/.test(raw)) return null;

// não assim
if (typeof raw === "string") {
  if (raw.length <= 24) { /* ... três níveis depois ... */ }
}
```

- Mais de 3 parâmetros, ou dois do mesmo tipo seguidos? Use um objeto com nomes.

**Tipos e dados**

- **Tipos explícitos nas fronteiras:** retorno de função exportada, props de componente e
  saída de server action. Dentro da função, a inferência basta.
- Dado externo (formulário, URL, banco, JSON) chega como `unknown` e passa por Zod (§2).
- Estados e eventos como **união discriminada**, não booleanos soltos:

```ts
// assim (src/modules/houses/domain/flow.ts): estado impossível não compila
type Step =
  | { kind: "ask" }
  | { kind: "question"; index: number }
  | { kind: "presentation"; houseId: string; method: JoinMethod };

// não assim
type Step = { isAsking: boolean; questionIndex?: number; houseId?: string };
```

- **Imutabilidade:** `const` por padrão, `readonly` em props e arrays recebidos. Gere um
  valor novo (`{ ...state, step }`, `map`, `filter`) em vez de alterar o recebido.
- **Sem número ou texto mágico:** constante com nome e comentário de origem
  (`whatsappInputMaxLength`, `DDDS` com "plano da Anatel"). Texto de interface vem de `config/`.

**Composição em vez de herança**

- Nada de classe base nem hierarquia. Reuso é função que chama função, componente que
  recebe componente (`children`) e hook pequeno.
- **SOLID, adaptado:** o projeto é TypeScript funcional + React, não OO com classes; vale a
  ideia: um motivo para mudar por módulo, dependência entrando por parâmetro e módulos
  falando só pelo `index.ts` (§2.1).

**Erros: falhar fechado**

- Na dúvida, **negar**: permissão desconhecida, dado inválido ou erro de consulta resultam
  em "sem acesso" ou erro visível, nunca em "libera" ou lista vazia silenciosa.
- Nada de `catch {}` vazio nem `catch` que só loga e segue. Trate ou deixe subir.
- Mensagem ao usuário é genérica e em português; o detalhe técnico vai para o log do
  servidor, **sem dado pessoal** (R11).
- Erro esperado (entrada inválida) é valor de retorno (`null`, `{ ok: false, ... }`);
  `throw` fica para o que não deveria acontecer.

**Comentários**

- Comentário explica **o porquê** (regra, ADR, issue, armadilha), não repete o código.
  Cite a origem: `// ADR 0008 §2`, `// issue #12`.
- Código comentado não entra: o histórico fica no git.
- `TODO` só com issue: `// TODO(#87): ...`.

**Testes legíveis**

- O nome do teste descreve o **comportamento**, em português: `"fora do escopo → negado"`,
  não `"test 3"`.
- **Arrange / Act / Assert**: prepara, executa uma ação, confere. Uma ideia por teste.
- Teste o contrato público (o que o `index.ts` exporta), não detalhe interno.
- Dados de teste fictícios e óbvios (`"casa-b"`, `"+5511999990000"`), nunca dado real.

**Teste antes do código (TDD)**

Vale para regra de domínio (`domain/`), permissão e RLS no banco (pgTAP) e correção de bug:

1. Escreva o teste do comportamento novo e confira que ele **falha** pelo motivo certo.
2. Faça um commit só com o teste (`test: ...`), antes do código.
3. Escreva o mínimo de código para o teste passar, em outro commit, e depois refatore.
- **Bug:** o primeiro commit é um teste que reproduz o bug falhando.
- Ajuste visual de tela e mudança só de texto não precisam de teste antes.
- O revisor confere a ordem dos commits na branch, antes do squash.

**PR**

- **Um assunto por PR** (R12): refatoração e funcionalidade nova em PRs separados.
- Sem formatação ou renomeação "de passagem" em arquivo que a issue não toca.

## 3. Stack (ADR 0001 e ADR 0009)

- Next.js (App Router) + TypeScript
- Supabase (Postgres + Auth + Row Level Security): `supabase start` no local e
  auto-hospedado no servidor
- Testes: Vitest (unidade), Playwright (ponta a ponta) e testes SQL de RLS (pgTAP via `supabase test db`)

## 4. Definição de pronto (DoD)

Uma tarefa só está pronta quando:

- [ ] Todos os critérios de aceite da issue foram atendidos.
- [ ] Há testes cobrindo o caminho feliz **e** pelo menos um caso de erro ou permissão negada.
- [ ] Em regra de domínio, permissão ou bug, o teste entrou num commit anterior ao do código (§2.2).
- [ ] `npm run check` passa localmente e no CI.
- [ ] Nenhum dado pessoal novo; se a tarefa cria tabela, há teste de RLS.
- [ ] Se a mudança altera o schema (tabela, coluna, chave), o diagrama em `docs/DIAGRAMAS.md` §5 foi atualizado (o teste `tests/diagrama-modelo-de-dados.test.ts` confere as tabelas).
- [ ] O que roda em cada fase (PR, deploy, lançamento) e as lacunas conhecidas estão em
      [`docs/TESTES.md`](docs/TESTES.md); mudança que fecha uma lacuna atualiza a tabela.
- [ ] Documentação atualizada se a mudança altera comportamento, dados ou o modo de rodar.
- [ ] O PR foi revisado e aprovado por **outra pessoa** (não pelo autor nem pela IA do autor).

## 5. Como pedir trabalho à sua IA (modelo de prompt)

```
Leia AGENTS.md, docs/MODELO_DADOS.md e a issue #NN (colada abaixo).
Implemente SOMENTE o que a issue pede.
Antes de codar, liste os arquivos que vai criar ou alterar e os testes que vai escrever.
Escreva os testes primeiro, depois o código, e rode `npm run check`.
Não adicione dependências nem campos de dados sem me perguntar.
```

## 6. O que fazer quando a IA "travar"

- Se ela quiser desabilitar RLS, usar `service_role` no cliente, apagar teste, adicionar
  campo pessoal, gravar nome ou WhatsApp sem cifrar, ou checar permissão só no front:
  **recuse** e releia a seção 1.
- Se o CI falhar e a correção não for óbvia: comente o erro na issue e peça ajuda. Não force
  merge.
