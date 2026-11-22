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
| | Playwright sem banco e com Supabase local (login, perfil, casa, contato, exclusão, fluxo completo) | jobs `e2e` e `e2e-live` |
| | Imagem Docker: sem `.env`, não-root, `/api/healthz` | job `image` |
| **Antes do deploy** (staging, #82) | Os mesmos jobs verdes na `main`; `restore-test.sh` (#84) | CI + `deploy/` |
| **Antes do lançamento** (#39) | Pentest do §4, carga do §5, revisão manual de segurança | staging |

## 2. Cobertura por risco

| Risco | Já coberto | Lacuna |
|---|---|---|
| **RLS** | `rls_enabled`, `permissions_matrix`, um pgTAP por tabela e função; `privilege_guards` (#68): função definer com `search_path` fixo, `anon` só executa lista curta e não tem tabela; **`rls_matrix` (#154)**: matriz gerada do catálogo (tabela × leitura/escrita, falha fechado para tabela nova) e varredura de aluno, líder e coordenador contra pessoa fora do escopo | — |
| **Cripto** (R13) | Vitest de `src/server/crypto/`; CHECK de valor cifrado; varredura de colunas em texto puro; **`e2e/encrypted-columns-live.spec.ts` (#155)**: salva pela tela e varre todas as colunas de texto do banco, também depois de exportar e de excluir a conta | Rotação de chave (#50) |
| **XSS** | ESLint barra `innerHTML` e afins (`tests/eslint-xss.test.ts`); `react/no-danger`; teste de redes sociais; **CSP com nonce (#152)**; **`e2e/xss-live.spec.ts` (#156)**: código em nome (fila da coordenação), portfólio, equipes anteriores e catálogo de habilidades | Novos campos de texto mostrados a outra pessoa entram no `xss-live` |
| **Auth** | Vitest de sessão, rotas, Turnstile e erros; E2E do link mágico; allowlist; **`e2e/protected-routes.spec.ts` (#156)**: toda rota de `src/app` fora da lista pública manda para o login (rota nova entra sozinha) | Expiração e reuso do link (passo 3 do §4) |
| **Deploy** | Testes bash de deploy, backup e segredos; `ci-hardening` (actions por SHA); `check-image.sh` | Scan de dependências e imagem (`npm audit`, Trivy) e de código (Semgrep) no CI (#153) |
| **Cabeçalhos HTTP** | `tests/security-headers.test.ts` (#68) e `src/server/csp.test.ts` (#152): nosniff, frame, referrer, permissions, HSTS e a CSP montada no proxy | Conferir no staging que o proxy de borda não remove os cabeçalhos (no túnel da demonstração, a CSP chega inteira) |
| **Desempenho** | **Seed em volume e medição (#74, §5.1)** | Carga com k6 (#75) |

## 3. Ferramentas

| Ferramenta | Para quê | Por que esta |
|---|---|---|
| Vitest | Unidade e contratos | Já no projeto; rápido, sem servidor |
| pgTAP | RLS, permissões, funções SQL | Testa a regra onde ela mora (R15) |
| Playwright | Ponta a ponta, XSS, rotas protegidas | Já no projeto; só Chromium |
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

Metas ainda a validar com o stakeholder. Medir os limites dos planos gratuitos: Workers
(requisições por dia, CPU por requisição) e Supabase (compute, conexões, e-mails do Auth,
egress). Banco: `EXPLAIN ANALYZE` e `pg_stat_statements`. Celular: Lighthouse CI. Saída: um
plano de capacidade ("até X usuários custa R$ 0; o primeiro limite é Y; resolver custa Z"),
comparado ao teto de R$ 100/mês (R19).

### 5.1 Base em volume (#74)

Numa base limpa (`npm run db:reset`): `npm run db:seed-volume -- --n 2000` (ou 50000, 500000).
Pessoas 100% fictícias (`volume-NNNNNN@example.com`, telefones `+5511900` + 6 dígitos), nome e
WhatsApp cifrados com as chaves de teste pelo mesmo código do app (`src/server/crypto`). Municípios
da RMSP com pesos (São Paulo pesa mais), equipes de 10 em 10 regiões, 1 a 8 habilidades por
pessoa, 20 missões com entregas aprovadas e pendentes, e os pontos no livro-razão. Recusa
`NODE_ENV=production` e banco que não seja o local ou um staging com "staging" no endereço
(`SEED_VOLUME_DB_URL`, com `psql` instalado). Medição: `scripts/seed-volume-explain.sql`.

Medido em 22/11/2026 no servidor da demonstração (2 núcleos ARM, carregado):

| Base | Tempo | Espaço | Perfis da região (gestora) | Busca por habilidade | Vínculos da região |
|---|---|---|---|---|---|
| 2 mil | 3 s | — | 10 ms | 292 ms | 3 ms |
| 50 mil | 4 min 34 s | 122 MB | ~50 ms | 67–105 ms | 80–96 ms |
| 500 mil | não rodado aqui (estimativa: ~45 min e ~1,2 GB) | | | | |

O seed revelou que as políticas de leitura de `profiles` e `unit_members` e a busca (#23)
checavam o escopo linha por linha: com só 2 mil perfis, a lista da gestora levava 2,9 s e a busca
com 50 mil levava 7,4 s. A migration `20261122000300_scope_listing_perf.sql` calcula o conjunto do
escopo uma vez por consulta, com as mesmas condições (a matriz de permissões inteira passa igual).
No staging (plano gratuito, 500 MB), rode 2 mil e 50 mil; 500 mil não cabe.
