# Roadmap

> Retrato das Issues abertas. **A fonte da verdade são as Issues, os Milestones e o quadro do GitHub Projects.**
> Ordem por data: o piloto (M6) vem antes de equipes, missões e medalhas, porque o cadastro abre no fim de janeiro e as equipes começam em março.

| Milestone | Data-alvo | Entrega |
|---|---|---|
| M0 · Fundação e decisões | 2026-11-30 | Staging no ar com deploy automático da `main` (ADR 0009); produção, backup e monitoramento pendentes (nova data a definir). |
| M1 · Cadastro do aluno | 2026-12-20 | Entrada: termo → questionário das casas (26 perguntas, pesos 1-3-5) → casa (sugestão com escolha livre, comparação 2×2 com média real; troca só na janela de transferência) → perfil (com formação, atividade profissional e miniatura do rosto). Login por link, Google ou senha opcional, com lista de autorizados; baixar e excluir os próprios dados. |
| M2 · Busca e painel da coordenação | 2027-01-05 | Papéis por escopo, busca por habilidade, catálogo de habilidades e seeds em volume. |
| M6 · Piloto e lançamento | 2027-01-17 | Produção pronta: revisão de segurança, carga, chaves, runbook ensaiado, teste com 10–20 pessoas e go/no-go em 17/01; lançamento no fim de janeiro. |
| M3 · Equipes e turmas | 2027-01-31 | Equipes rotativas, porta-voz, portfólio, turmas, ver contato e mapa de calor — prontos antes de março. |
| M4 · Missões e pontos | 2027-02-21 | Catálogo de missões com etapas e pontos, entregas, validação e livro-razão de pontos (ADR 0006). |
| M5 · Badges, placar e acompanhamento | 2027-03-14 | Badges revogáveis, placar de turmas por escopo e painel de acompanhamento. |
| M7 · Expansão SP/Brasil | a definir | Coordenação regional com escopo e ampliação da base de municípios. |
| M8 · Núcleos | sem data (marco futuro) | Árvore de núcleos fora do território, cargos internos, pedido de entrada, reuniões, presença e pontos (ADR 0013, aceito). |

## Marcos do stakeholder

| Quando | O quê |
|---|---|
| 30/11 | Staging e CI/CD no ar. Produção, backup e monitoramento pendentes (nova data a definir); diagrama e plano de testes |
| 20/12 | Cadastro completo no staging |
| 05/01 | Busca por habilidade e painel |
| 12–16/01 | Teste com 10–20 pessoas em produção |
| **17/01** | **Go/no-go** do lançamento (plano B: formulário) |
| fim de janeiro | Anúncio e abertura do cadastro |
| 31/01 | Equipes prontas para março |
| março | Início das atividades e missões |

## M0 · Fundação e decisões

- #6 Proteger a `main`, CODEOWNERS e MFA dos mantenedores — `pronta, seguranca, infra`
- #7 Rascunho do termo de consentimento e da página 'Seus dados' — `precisa-decisao, docs`
- #38 Épico: infraestrutura da POC em complexo42.maionesys.com (ADR 0009) — `seguranca, infra`
- #52 Ambiente de dev: scripts `npm run setup`/`db:*`, `.env.example` e devcontainer validado — `bloqueada, infra`
- #53 Validar o ONBOARDING com o primeiro dev novo — `bloqueada, bom-primeiro-issue, docs`
- #67 Diagrama da estrutura organizacional e dos papéis (ADR 0007) — `precisa-decisao, docs`
- #73 Decisão: capacidade de envio de e-mails do login (link mágico) para o cadastro em massa — `precisa-decisao, seguranca, infra`
- #82 Infra: staging com dados fictícios e deploy automático da `main` — `bloqueada, infra`
- #83 Infra: produção por release, com aprovação e página "em breve" até o lançamento — `bloqueada, seguranca, infra`
- #84 Infra: backup cifrado do Postgres, cópia fora da VPS e teste de restauração — `bloqueada, seguranca, infra`
- #85 Infra: monitoramento externo e alertas (uptime, disco, backup, certificados) — `bloqueada, infra`
- #86 Infra: borda e cabeçalhos (CSP, rate limit no login, bloqueio de varreduras) — `bloqueada, seguranca, infra`
- #95 Infra: senhas distintas por papel do Postgres antes da produção — `pronta, seguranca, infra`
- #153 CI: scan de dependências, imagem e código (npm audit, Trivy, Semgrep) — `seguranca, infra`
- #282 Deploy: marcador de aplicação pendente da infra (disco novo, containers velhos)
- #286 Deploy: o `docker-compose.app.yml` do servidor não é sincronizado nem conferido
- #293 Deps: triar os PRs do dependabot #163–#166

## M1 · Cadastro do aluno

- #15 Habilidades: seleção a partir do catálogo, sem nível, até 10, com sugestão de habilidade nova aprovada pela coordenação nacional — `frontend, backend`
- #87 Infra: provedores de login no Auth auto-hospedado (Google OAuth + relay SMTP) — `bloqueada, seguranca, backend, infra`
- #302 Janela de transferência de casa (substitui a trava de 4 meses) — `backend, frontend, seguranca`
- #303 Medalha da casa e do totem no perfil, visível aos membros — `backend, frontend, seguranca`
- #312 Perfil: exigir nome completo (nome e sobrenome) — `backend, frontend`
- #304 Perfil: formação acadêmica e atividade profissional — `backend, frontend`
- #308 Foto do perfil: miniatura guardada (~256 px WebP, ~20 KB), opcional — `backend, frontend, seguranca`
- #130 Baixar e excluir meus dados também para quem está em espera ou bloqueado (decisão do jurídico) — `precisa-decisao, frontend`
- #222 Checar no boot/healthz que a versão do termo da config existe no banco (`public.term_version_exists`)
- #288 Deploy: compose do servidor repassa `FIELD_ENCRYPTION_KEY` e `BLIND_INDEX_KEY` (destrava o login no staging)
- #289 Env: repor a exigência das chaves de cifra em produção (depende da #288; desfaz o #285)
- #290 Staging: gerar `QUESTIONNAIRE_SIGNING_KEY` e exigi-la na subida
- #291 Auth: teste negativo do login com Google
- #292 Conteúdo: pendências do Cortez (Siracusa, "Primeiros passos", texto das medalhas de totem, catálogo de habilidades, informações sobre as cortes)

## M2 · Busca e painel da coordenação

- #22 Delegação de papéis por escopo (nacional → estadual → monitor) + audit_log — `bloqueada, seguranca, backend`
- #23 Busca de pessoas por habilidade (prioridade do gestor nacional) — `bloqueada, frontend, backend`
- #25 Gestão do catálogo de habilidades (admin) — `bloqueada, frontend, backend`
- #305 Perfil público visível a todos os membros logados — `backend, frontend, seguranca`
- #307 Área de novidades na tela inicial — `frontend, backend`
- #74 Seeds em volume: 2 mil, 50 mil e 500 mil perfis fictícios para testes de desempenho — `bloqueada, backend`
- #154 Teste de RLS gerado: matriz papel × tabela × operação — `seguranca, backend`
- #155 Teste que prova que as colunas `*_enc` não guardam texto legível — `seguranca, backend`
- #156 E2E de segurança: XSS em campos de texto e rotas protegidas sem sessão — `seguranca, frontend`
- #234 Dividir o PR #167 em PRs pequenos sobre a main atual (refaz M2–M5; "núcleo" no lugar de "Corte")

## M6 · Piloto e lançamento

- #39 Revisão de segurança pré-lançamento — `bloqueada, seguranca`
- #40 Teste com grupo pequeno (10–20 alunos) e coleta de feedback — `bloqueada, docs`
- #41 Lançamento na RMSP e acompanhamento das métricas — `bloqueada, docs`
- #50 Chaves de criptografia: geração, backup offline e rotação — `bloqueada, seguranca, infra`
- #75 Testes de carga (k6) em staging e plano de capacidade antes do piloto — `bloqueada, infra`
- #88 Infra: runbook de operação e ensaio cronometrado de migração para outra máquina — `bloqueada, seguranca, infra, docs`
- #89 Decisão de go/no-go do lançamento e acionamento do plano B — `bloqueada, docs`
- #157 ZAP baseline automático no staging depois de cada deploy — `bloqueada, seguranca, infra`

## M3 · Equipes e turmas

- #24 Mapa de calor dos alunos por região — `bloqueada, bom-primeiro-issue, frontend, backend`
- #28 Criar equipe e adicionar membros a partir dos filtros — `bloqueada, frontend, backend`
- #29 Definir líder e página 'Minhas equipes' — `bloqueada, frontend, backend`
- #47 Turmas: criar, matricular (um aluno por turma), mover aluno e nomear monitor — `bloqueada, frontend, backend`
- #48 'Ver contato' com auditoria — `bloqueada, seguranca, frontend, backend`
- #56 Identidade da turma: nome, lema, cores e emblema — `bloqueada, frontend, backend`
- #69 Equipes rotativas: histórico de vínculos e porta-voz do ciclo (ADR 0007 §2) — `bloqueada, seguranca, backend`
- #70 Portfólio por links com prévia incorporada (ADR 0007 §5) — `bloqueada, seguranca, frontend`
- #306 Clãs: grupos de pessoas com feitos parecidos (tamanho inicial 14, configurável; ADR a escrever) — `precisa-decisao, backend, frontend`
- #120 Chat da equipe dentro da plataforma (ADR a escrever) — `precisa-decisao, frontend, backend`
- #136 Ex-aluno: registrar equipes anteriores à plataforma (autodeclarado) — `precisa-decisao, frontend, backend`
- #137 Papel de veterano/mentor (escopo, permissões e relação com a medalha) — `precisa-decisao, frontend, backend`

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

- #43 Expandir municípios (SP e Brasil) e reavaliar limites gratuitos — `backend, infra`. Os municípios do IBGE já entraram pela #175; resta a estimativa de uso do plano gratuito e a proposta de custo

## M8 · Núcleos

Bloqueadas por missões e pontos (M4) e pelo parecer jurídico sobre o vínculo; as perguntas 91 a 93 seguem com padrão conservador.

- #168 Núcleos: árvore, vínculo com principal, cargos, pedido de entrada e RLS (ADR 0013) — `bloqueada, seguranca, backend`
- #169 Núcleos: reuniões com pauta e presença que conta pontos (ADR 0013) — `bloqueada, seguranca, backend`
- #170 Núcleos: telas do coordenador de núcleo (ADR 0013) — `bloqueada, frontend`
