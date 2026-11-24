# Roadmap

> Retrato das Issues abertas. **A fonte da verdade são as Issues, os Milestones e o quadro do GitHub Projects.**
> Ordem por data: o piloto (M6) vem antes de equipes, missões e medalhas, porque o cadastro abre no fim de janeiro e as equipes começam em março.

| Milestone | Data-alvo | Entrega |
|---|---|---|
| M0 · Fundação e decisões | 2026-11-30 | Esqueleto no ar em complexo42.maionesys.com: infra (ADR 0009), scaffold, Supabase, CI/CD, staging, backup, monitoramento e decisões pendentes. |
| M1 · Cadastro do aluno | 2026-12-20 | Login (Google + link mágico), lista de autorizados, casa de formação, termo, perfil e habilidades; baixar e excluir os próprios dados. |
| M2 · Busca e painel da coordenação | 2027-01-05 | Papéis por escopo, busca por habilidade, catálogo de habilidades e seeds em volume. |
| M6 · Piloto e lançamento | 2027-01-17 | Produção pronta: revisão de segurança, carga, chaves, runbook ensaiado, teste com 10–20 pessoas e go/no-go em 17/01; lançamento no fim de janeiro. |
| M3 · Equipes e turmas | 2027-01-31 | Equipes rotativas, porta-voz, portfólio, turmas, ver contato e mapa de calor — prontos antes de março. |
| M4 · Missões e pontos | 2027-02-21 | Catálogo de missões com etapas e pontos, entregas, validação e livro-razão de pontos (ADR 0006). |
| M5 · Badges, placar e acompanhamento | 2027-03-14 | Badges revogáveis, placar de turmas por escopo e painel de acompanhamento. |
| M7 · Expansão SP/Brasil | a definir | Coordenação regional com escopo e ampliação da base de municípios. |
| M8 · Núcleos | sem data (marco futuro) | Árvore de núcleos fora do território, cargos internos, pedido de entrada, reuniões, presença e pontos (ADR 0013, proposto). |

## Marcos do stakeholder

| Quando | O quê |
|---|---|
| 30/11 | Esqueleto no ar (produção e staging), CI/CD, backup e monitoramento; diagrama e plano de testes |
| 20/12 | Cadastro completo no staging |
| 05/01 | Busca por habilidade e painel |
| 12–16/01 | Teste com 10–20 pessoas em produção |
| **17/01** | **Go/no-go** do lançamento (plano B: formulário) |
| fim de janeiro | Anúncio e abertura do cadastro |
| 31/01 | Equipes prontas para março |
| março | Início das atividades e missões |

## M0 · Fundação e decisões

- #2 Aprovar os ADRs 0001 (stack) e 0009 (hospedagem) — `precisa-decisao, infra, docs`
- #3 Scaffold: Next.js + TypeScript estrito + Tailwind + Zod + Vitest + `npm run check` — `bloqueada, infra`
- #4 Supabase local + migrations + teste 'toda tabela pública tem RLS' — `bloqueada, seguranca, backend, infra`
- #5 Playwright configurado com um teste E2E de fumaça no CI — `bloqueada, infra`
- #6 Proteger a `main`, CODEOWNERS e MFA dos mantenedores — `pronta, seguranca, infra`
- #7 Rascunho do termo de consentimento e da página 'Seus dados' — `precisa-decisao, docs`
- #8 Seeds: municípios da RMSP, catálogo inicial de habilidades e dados fictícios — `bloqueada, bom-primeiro-issue, backend`
- #38 Épico: infraestrutura da POC em complexo42.maionesys.com (ADR 0009) — `seguranca, infra`
- #45 Módulo de criptografia de campo (`src/server/crypto`) + HMAC — `bloqueada, seguranca, backend`
- #52 Ambiente de dev: scripts `npm run setup`/`db:*`, `.env.example` e devcontainer validado — `bloqueada, infra`
- #53 Validar o ONBOARDING com o primeiro dev novo — `bloqueada, bom-primeiro-issue, docs`
- #60 Endurecer o CI: fixar actions por SHA e `persist-credentials: false` — `pronta, seguranca, bom-primeiro-issue, infra`
- #67 Diagrama da estrutura organizacional e dos papéis (ADR 0007) — `precisa-decisao, docs`
- #68 Plano de testes automatizados e pentest — `pronta, seguranca, infra`
- #73 Decisão: capacidade de envio de e-mails do login (link mágico) para o cadastro em massa — `precisa-decisao, seguranca, infra`
- #78 Infra: provisionar o projeto no servidor (DNS, usuário de deploy, Caddy e página "em breve") — `pronta, seguranca, infra`
- #79 Infra: Supabase auto-hospedado mínimo em Docker Compose (db, auth, rest, kong) — `bloqueada, seguranca, backend, infra`
- #80 Infra: imagem Docker do app (Next.js standalone, ARM64, não-root) e `/api/healthz` — `bloqueada, backend, infra`
- #81 Infra: pipeline de build e deploy (GHCR ARM64 + SSH restrito + migrations + rollback) — `bloqueada, seguranca, infra`
- #82 Infra: staging com dados fictícios e deploy automático da `main` — `bloqueada, infra`
- #83 Infra: produção por release, com aprovação e página "em breve" até o lançamento — `bloqueada, seguranca, infra`
- #84 Infra: backup cifrado do Postgres, cópia fora da VPS e teste de restauração — `bloqueada, seguranca, infra`
- #85 Infra: monitoramento externo e alertas (uptime, disco, backup, certificados) — `bloqueada, infra`
- #86 Infra: borda e cabeçalhos (CSP, rate limit no login, bloqueio de varreduras) — `bloqueada, seguranca, infra`

## M1 · Cadastro do aluno

- #9 Login (Google + link mágico) com link de convite — `bloqueada, seguranca, frontend, backend`
- #10 Tabela `profiles` com dados pessoais cifrados + RLS por escopo — `bloqueada, seguranca, backend`
- #11 Tela de consentimento obrigatória antes do perfil — `bloqueada, frontend`
- #12 Formulário de perfil: nome, WhatsApp e localização — `bloqueada, frontend`
- #15 Habilidades: seleção a partir do catálogo — `bloqueada, frontend, backend`
- #17 Redes sociais (cifradas) com proteção contra XSS — `bloqueada, seguranca, frontend`
- #18 Excluir minha conta (exclusão real) — `bloqueada, seguranca, frontend, backend`
- #20 Baixar meus dados (JSON) — `bloqueada, bom-primeiro-issue, frontend, backend`
- #21 E2E do fluxo completo de cadastro — `bloqueada, infra`
- #26 Lista de autorizados e lista de espera no cadastro (ADR 0008 §1) — `bloqueada, seguranca, frontend, backend`
- #46 Hierarquia genérica: unit_types, units (ltree), unit_members, role_assignments + funções `app.can_*` + matriz de testes — `bloqueada, seguranca, backend`
- #54 Configuração da instância (`config/instance.ts`) e rótulos — `bloqueada, frontend, backend`
- #76 Casa de formação: escolha, questionário e aceite no cadastro (ADR 0008 §2) — `bloqueada, frontend, backend`
- #87 Infra: provedores de login no Auth auto-hospedado (Google OAuth + relay SMTP) — `bloqueada, seguranca, backend, infra`

## M2 · Busca e painel da coordenação

- #22 Delegação de papéis por escopo (nacional → estadual → monitor) + audit_log — `bloqueada, seguranca, backend`
- #23 Busca de pessoas por habilidade (prioridade do gestor nacional) — `bloqueada, frontend, backend`
- #25 Gestão do catálogo de habilidades (admin) — `bloqueada, frontend, backend`
- #74 Seeds em volume: 2 mil, 50 mil e 500 mil perfis fictícios para testes de desempenho — `bloqueada, backend`

## M6 · Piloto e lançamento

- #39 Revisão de segurança pré-lançamento — `bloqueada, seguranca`
- #40 Teste com grupo pequeno (10–20 alunos) e coleta de feedback — `bloqueada, docs`
- #41 Lançamento na RMSP e acompanhamento das métricas — `bloqueada, docs`
- #50 Chaves de criptografia: geração, backup offline e rotação — `bloqueada, seguranca, infra`
- #75 Testes de carga (k6) em staging e plano de capacidade antes do piloto — `bloqueada, infra`
- #88 Infra: runbook de operação e ensaio cronometrado de migração para outra máquina — `bloqueada, seguranca, infra, docs`
- #89 Decisão de go/no-go do lançamento e acionamento do plano B — `bloqueada, docs`

## M3 · Equipes e turmas

- #24 Mapa de calor dos alunos por região — `bloqueada, bom-primeiro-issue, frontend, backend`
- #28 Criar equipe e adicionar membros a partir dos filtros — `bloqueada, frontend, backend`
- #29 Definir líder e página 'Minhas equipes' — `bloqueada, frontend, backend`
- #47 Turmas: criar, matricular (um aluno por turma), mover aluno e nomear monitor — `bloqueada, frontend, backend`
- #48 'Ver contato' com auditoria — `bloqueada, seguranca, frontend, backend`
- #56 Identidade da turma: nome, lema, cores e emblema — `bloqueada, frontend, backend`
- #69 Equipes rotativas: histórico de vínculos e porta-voz do ciclo (ADR 0007 §2) — `bloqueada, seguranca, backend`
- #70 Portfólio por links com prévia incorporada (ADR 0007 §5) — `bloqueada, seguranca, frontend`

## M4 · Missões e pontos

- #30 Missões: tabelas missions, mission_steps, mission_runs, step_submissions + RLS — `bloqueada, seguranca, backend`
- #31 Telas de missões da turma: disponíveis, em andamento e concluídas — `bloqueada, frontend`
- #32 Validação de entregas e lançamento de pontos (`app.approve_submission`) — `bloqueada, frontend, backend`
- #33 Publicar missão para um escopo (turma, estado ou nacional) — `bloqueada, frontend, backend`
- #57 Propostas de missão pela turma — `bloqueada, frontend, backend`

## M5 · Badges, placar e acompanhamento

- #34 Tabelas `badges` e `profile_badges` + RLS — `bloqueada, seguranca, backend`
- #35 Concessão manual de medalha com justificativa — `bloqueada, frontend, backend`
- #36 Badges automáticos: missão concluída e limite de pontos — `bloqueada, backend`
- #37 Exibir medalhas no perfil — `bloqueada, bom-primeiro-issue, frontend`
- #49 Painel de acompanhamento por escopo — `bloqueada, frontend, backend`
- #58 Placar de turmas por escopo e período — `bloqueada, frontend, backend`
- #71 Novos tipos de medalha: evento, "trabalhou com", marco e presença (ADR 0007 §3) — `bloqueada, backend`
- #72 Avaliação reservada com acesso por pedido auditado (ADR 0007 §4) — `bloqueada, seguranca, backend`

## M7 · Expansão SP/Brasil

- #43 Expandir municípios (SP e Brasil) e reavaliar limites gratuitos — `backend, infra`

## M8 · Núcleos

Aguardam o stakeholder (perguntas 87 a 89) e o parecer jurídico sobre o vínculo.

- #168 Núcleos: árvore, vínculo com principal, cargos, pedido de entrada e RLS (ADR 0013) — `bloqueada, precisa-decisao, seguranca, backend`
- #169 Núcleos: reuniões com pauta e presença que conta pontos (ADR 0013) — `bloqueada, precisa-decisao, seguranca, backend`
- #170 Núcleos: telas do coordenador de núcleo (ADR 0013) — `bloqueada, precisa-decisao, frontend`
