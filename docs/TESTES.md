# Plano de testes e pentest

Só ferramentas gratuitas (R19). Escrever os testes de cada funcionalidade continua sendo
trabalho da issue dela (R2, R5, R16); aqui está **o que roda quando** e **o que ainda falta**.
Plano da #68; as lacunas viraram issues, listadas no §2.

## 1. O que roda e quando

| Quando | O que | Onde |
|---|---|---|
| **Em todo PR** (CI) | Guardrails: gitleaks, campos pessoais proibidos (R4), testes bash de `deploy/` | job `guardrails` |
| | Lint, tipos, Vitest (unidade e contratos de configuração) e build | job `app` (`npm run check`) |
| | pgTAP: RLS em toda tabela, matriz de permissões, guardas de privilégio, regras por tabela | job `database` (`supabase test db`) |
| | Playwright sem banco e com Supabase local (login, perfil, casa, contato, navegação, exclusão, fluxo completo) | jobs `e2e` e `e2e-live` |
| | Imagem Docker: sem `.env`, não-root, `/api/healthz`; Trivy (alto/crítico com correção reprova) | job `image` |
| | `npm audit --omit=dev` (alto/crítico com correção reprova; o resto, relatório) | job `dependencies` |
| | Semgrep `p/typescript` + `p/nextjs`, só relatório até a triagem (#153) | job `semgrep` |
| | Staging de mentira (#319): banco só com migrations (`migra.sh`, sem seed), app pelo compose do deploy, passos de operador pelos scripts, E2E do caminho inteiro; a matriz reverte os três consertos de 28/11 e exige a falha | job `staging` (`scripts/staging-ci.sh`) |
| **Antes do deploy** (staging, #82) | Os mesmos jobs verdes na `main`; `restore-test.sh` (#84) | CI + `deploy/` |
| **Antes do lançamento** (#39) | Pentest do §4, carga do §5, revisão manual de segurança | staging |

## 2. Cobertura por risco

| Risco | Já coberto | Lacuna |
|---|---|---|
| **RLS** | `rls_enabled`, `permissions_matrix`, um pgTAP por tabela e função; `privilege_guards` (#68): função definer com `search_path` fixo, `anon` só executa lista curta e não tem tabela | Matriz gerada papel × tabela × operação, em vez de casos à mão (#154) |
| **Cripto** (R13) | Vitest de `src/server/crypto/`; CHECK de valor cifrado; varredura de colunas em texto puro | Rotação de chave (#50); teste que lê o banco e prova que `*_enc` não é texto legível (#155) |
| **XSS** | ESLint barra `innerHTML` e afins (`tests/eslint-xss.test.ts`); `react/no-danger`; teste de redes sociais; CSP com nonce (#152): `src/server/csp.test.ts` e `e2e/csp.spec.ts` (todo `<script>` com o nonce, Turnstile carrega, nada bloqueado) | E2E que injeta `<script>` em todo campo de texto (#156) |
| **Auth** | Vitest de sessão, rotas, Turnstile e erros; E2E do link mágico e da senha (definir, entrar, senha errada genérica, recuperar, remover); política da senha; travas do compose e do Kong (`tests/senha-gotrue.test.ts` e `ci.yml`); allowlist | E2E de toda rota protegida sem sessão → login (#156); expiração e reuso do link (passo 3 do §4); reautenticação por código de e-mail para sessão com mais de 24 h (ADR 0018, fora da v1) |
| **Deploy** | Testes bash de deploy, backup e segredos; `ci-hardening` (actions por SHA); `check-image.sh`; montagem do servidor no job `staging`; npm audit, Trivy e Semgrep (§3) | O `deploy.sh` em si (pull por digest, sincronia da infra) só roda com dublês; o Semgrep ainda não reprova (passa a reprovar `ERROR` depois da triagem) |
| **Cabeçalhos HTTP** | `tests/security-headers.test.ts` (#68): nosniff, frame, referrer, permissions, HSTS; CSP do proxy com nonce novo por requisição, até no redirecionamento (#152) | Conferir no staging que o proxy de borda não remove os cabeçalhos |
| **Acessibilidade e visual** (#324) | `e2e/a11y.spec.ts`: axe (WCAG 2.2 AA) nos temas claro e escuro, em 390 e 1440 px, sem rolagem horizontal, em todas as telas (públicas sempre; logadas no job com banco); `tests/design-tokens.test.ts`: nenhuma cor ou fonte fixa nos componentes, só os tokens de `globals.css` | Capturas visuais automáticas (comparação de imagem) |
| **Desempenho** | Nada | §5 inteiro (#74, #75) |

## 3. Ferramentas

| Ferramenta | Para quê | Por que esta |
|---|---|---|
| Vitest | Unidade e contratos | Já no projeto; rápido, sem servidor |
| pgTAP | RLS, permissões, funções SQL | Testa a regra onde ela mora (R15) |
| Playwright | Ponta a ponta, XSS, rotas protegidas | Já no projeto; só Chromium |
| axe-core (`@axe-core/playwright`) | WCAG 2.2 AA nos E2E | Gratuita (MPL-2.0), roda dentro do Playwright |
| gitleaks | Segredo no histórico | Já no CI |
| `npm audit`, Trivy | Dependências e imagem | Sem conta, saída própria para CI |
| Semgrep (`p/typescript`, `p/nextjs`) | Padrão inseguro no código | Regras públicas, roda local e no CI |
| OWASP ZAP (`zap-baseline`, depois ativo) | Pentest automatizado do app | Imagem Docker; o modo baseline é passivo |
| Nuclei (modelos de exposição e configuração) | Painéis, arquivos e portas expostos | Só leitura nos modelos escolhidos |
| k6 | Carga (§5) | Script em JS |
| Lighthouse CI | Desempenho no celular (Android de entrada, 4G) | Gratuita |

## 4. Roteiro de pentest

**Alvo: somente o staging, com dados fictícios (#82). Nunca a produção**, nem para "só olhar".
Antes de cada execução, confirmar o alvo: o `/api/healthz` do endereço testado deve responder
como staging.

**Dentro do escopo:** o app web, `/auth/v1/*` e `/rest/v1/*` do staging, o proxy e os
cabeçalhos. **Fora:** produção, o servidor (SSH, painel do provedor), Cloudflare, GitHub,
engenharia social e negação de serviço. Contas: só as fictícias do seed.

> **404 não é ausência de rota.** Teste que roda contra a **URL pública** do
> staging recebe `404` em `/auth/v1/signup`, em `/rest/v1/*` e em
> `/auth/v1/admin/*` — é o Kong terminando o pedido de propósito, pelo
> `X-Forwarded-For` que o proxy acrescenta (ADR 0018 §3). Pela rede interna os
> mesmos caminhos respondem normalmente. Quem automatizar conferência de fora
> deve **esperar** esses 404 em vez de tratá-los como regressão; e quem
> precisar do `admin/generate_link` numa medição tem de chamá-lo de dentro do
> servidor.

**Regras**

1. Janela combinada com o gestor; avisar a equipe antes de começar.
2. Se aparecer dado real no staging, parar e tratar como incidente (`SECURITY.md`).
3. Achado vira reporte **privado** de vulnerabilidade no GitHub, nunca issue pública.
4. Provar, não extrair: mostrar que dá, sem baixar dados.
5. Guardar relatório e comandos fora do repositório; nada de URL de staging commitada.

**Passos, em ordem**

| # | Passo | Ferramenta | Passa quando |
|---|---|---|---|
| 1 | Cabeçalhos, TLS, cookies (`Secure`, `HttpOnly`, `SameSite`) | ZAP baseline | Nenhum alerta médio ou alto |
| 2 | Exposição: painéis, `.env`, Studio e Postgres acessíveis de fora | Nuclei + `nmap` no endereço público | Só 80 e 443 respondem |
| 3 | Auth: enumeração de e-mail, força bruta, reuso e expiração do link, rate limit | ZAP + curl | Resposta igual para e-mail existente e inexistente; 429 no limite |
| 4 | Autorização: com o JWT de cada papel, ler e escrever em tabelas e funções fora do escopo | Script contra `/rest/v1` | Tudo negado (R14, R15) |
| 5 | Injeção e XSS em campos de texto, URL e redes sociais | ZAP ativo, só nos campos do app | Nada executa; sai escapado |
| 6 | Dado pessoal: nenhuma resposta traz `*_enc` nem texto puro de outro aluno | Script sobre as respostas do passo 4 | Zero ocorrências |
| 7 | Reteste dos achados corrigidos | O mesmo passo | Issue fecha |

Roda **antes do lançamento** (#39) e de novo a cada mudança grande de auth, permissão ou proxy.
Automatizar o ZAP baseline depois de cada deploy no staging é a #157; o restante é
manual, guiado por esta tabela.

## 5. Desempenho e capacidade

Só o plano. A execução fica em #74 (seeds em volume) e #75 (carga); o limite de e-mails do
login, em #73. **Teste de carga nunca roda em produção**: usa o staging, no mesmo plano gratuito.

| Cenário | Descrição | Meta (SLO) |
|---|---|---|
| Esperado | Piloto, ~2 mil cadastrados | p95 < 500 ms, erros < 1% |
| Pico | 30–50% da base cadastrando em 15 min depois de um disparo no WhatsApp | p95 < 1,5 s, erros < 2% |
| Além da margem | Subir a carga até quebrar, para saber o que quebra primeiro | Sem meta; registrar o primeiro limite |
| Soak | Horas em carga moderada | Memória e conexões estáveis |

**Busca de pessoas por habilidade (#23).** A meta é menos de 500 ms com 50 mil perfis. A medição é manual e fica **fora do
CI**: `psql "<banco local>" -f scripts/skill-search-benchmark.sql` gera 50 mil perfis fictícios numa transação (que no fim
desfaz tudo) e imprime o `EXPLAIN (ANALYZE, BUFFERS)` do miolo da busca (uma habilidade; duas com E, em SP). Confira o
"Execution Time" e que o plano usa o índice de habilidade, não Seq Scan. O pgTAP só confere que os índices existem: com poucas
linhas o planejador escolhe Seq Scan e um teste de `EXPLAIN` ficaria instável.

Metas ainda a validar com o stakeholder. Medir os limites dos planos gratuitos: Workers
(requisições por dia, CPU por requisição) e Supabase (compute, conexões, e-mails do Auth,
egress). Banco: `EXPLAIN ANALYZE` e `pg_stat_statements`. Celular: Lighthouse CI. Saída: um
plano de capacidade ("até X usuários custa R$ 0; o primeiro limite é Y; resolver custa Z"),
comparado ao teto de R$ 100/mês (R19).

## 3. Scanners de segurança (#153)

Todos gratuitos e sem conta (R19), em paralelo aos outros jobs.

- **Quando reprovam:** só vulnerabilidade **alta ou crítica com correção disponível** (npm audit, pelo
  `scripts/audit-gate.mjs`; Trivy, com `--ignore-unfixed`). O resto aparece no resumo do job. O Semgrep
  ainda está só em relatório.
- **Exceção é uma a uma, com motivo e validade**, nunca em massa:
  - npm audit: `security/npm-audit-exceptions.json`, com `{ "id": "GHSA-…", "reason": "…", "reviewBy": "AAAA-MM-DD" }`;
  - Trivy: `security/trivyignore.yaml`, com `id`, `statement` e `expired_at`, conferido por `scripts/check-trivyignore.py`;
  - Semgrep: `// nosemgrep: <regra> -- <motivo>` na linha, nunca a regra desligada inteira.
  Exceção vencida volta a reprovar. Relatório com erro (sem rede) também reprova: não medir não é "limpo".

