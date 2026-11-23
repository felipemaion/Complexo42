# Entrega: visual e módulos de M2 a M5 (proposta para revisão)

Feito sobre a `main` em `7b5c30e` (19/11), **sem alterar o que já existia**, em commits pequenos e
separados por assunto, para você aceitar aos poucos (um PR por commit, se preferir). Está no ramo
`entrega/plataforma-completa` do GitHub; a `main` não foi tocada.

## O que entra

| Assunto | Issues | Onde |
|---|---|---|
| Visual de site (preto e dourado, largura de 1240 px com colunas no computador, cabeçalho com menu em abas, faixa de destaque e rodapé com "Minha conta"), pensado para pessoas mais velhas (fonte Atkinson Hyperlegible, 18 px, nada abaixo disso, botões de 56 px, contraste alto) | ata 17/11 §10 | `src/app/globals.css`, `src/modules/ui`, `src/app/(conta)/layout.tsx`, `/inicio` |
| Missões, etapas, execuções, entregas, validação e livro-razão de pontos | #30 #31 #32 #33 | migrations `…000000/000100`, `src/modules/missions`, `/missoes`, `/coordenacao/missoes` |
| Busca de pessoas por habilidade (todas as marcadas, só no escopo, sem contato) | #23 | `…000200`, `src/modules/search`, `/coordenacao/busca` |
| Montagem das equipes do 1º ciclo (criar, distribuir, coordenador da equipe) | #28 #29 | `…000300`, `src/modules/teams`, `/coordenacao/equipes` |
| Medalhas (criar, conceder com motivo, revogar, coleção no perfil) | #34 #35 #37 | `…000400`, `src/modules/badges`, `/coordenacao/medalhas` |
| Painel por equipe, avaliação reservada, conversa da equipe, tela "Minha equipe" | #49 #120 | `…000500/000600`, `src/modules/collab`, `/equipe` |
| Draft do 2º ciclo e leitura de avaliação por pedido auditado (`evaluation_viewed`) | ata §6, #72 | `…000700`, `src/modules/collab/server/draft.ts` |
| Medalhas automáticas: missão concluída e limite de pontos (o banco concede, uma vez só) | #36 | `…000800`, tela de medalhas |
| Identidade da equipe: lema, 2–3 cores e emblema, com "bandeira" (sem upload no POC) | #56 | `…000900`, `src/modules/collab/identity.ts`, `/equipe` |
| Portfólio por links (até 3, link cifrado, prévia só do YouTube sem cookies, CSP `frame-src` fechada) | #70 | `…001000`, `src/modules/portfolio`, `/perfil/portfolio` |
| "Baixar meus dados" também com medalhas, portfólio, pontos, entregas e mensagens | #20 (LGPD) | `…001100`, `src/modules/privacy/domain/activity.ts` |
| Propostas de missão pela equipe; a coordenação ajusta pontos e publica ou recusa com justificativa | #57 | `…001200`, `/equipe`, `/coordenacao/missoes` |
| Placar de equipes por região e período (7, 30, 90 dias ou tudo), sem ranking de pessoas | #58 | `…001300`, `/placar` |
| Delegar papéis pela tela (só para baixo, nunca a si mesmo), com `role_granted`/`role_revoked` no audit_log | #22 | `…001400`, `/coordenacao/papeis` |
| Mover a pessoa de equipe (o vínculo antigo fecha com `left_at`), com `member_moved` no audit_log | #47 | `…001500`, `/coordenacao/equipes` |
| Histórico de equipes da pessoa, com os porta-vozes de cada período (só a coordenação do escopo) | #69 | `…001600`, `/coordenacao/historico/[id]` |
| Mapa: onde as pessoas estão, por cidade da região metropolitana e distrito da capital; número abaixo de 5 aparece como "< 5" | #24 | `…001700`, `src/modules/map`, `/coordenacao/mapa` |
| Medalhas de evento e de marco (o marco guarda quem chegou primeiro e a história) | #71 | `…001800`, `/coordenacao/medalhas` |
| Catálogo de habilidades pela tela do gestor nacional (criar, renomear, sinônimos, desativar sem apagar) | #25 | `…001900`, `/coordenacao/habilidades` |
| Equipes de antes da plataforma (ex-aluno): a pessoa informa até 5, sem confirmação e sem colegas; não dão acesso; a coordenação vê no histórico; saem no "Baixar meus dados". **ADR 0012 proposto** (R4) | #136 | `20261122000000`, `/perfil/equipes-anteriores` |
| A pessoa marca as próprias habilidades do catálogo (até 12, só ativas; busca por nome, área ou sinônimo, pensada para o celular); saem no "Baixar meus dados" | #15 | `…000200`, `src/modules/search/server/my-skills.ts`, `/perfil/habilidades` |
| Medalha "trabalhou com": cada porta-voz tem a sua (nasce sozinha), só ele dá, a quem esteve na equipe dele no mesmo período; a concessão manual não a dá; o nome do porta-voz é decifrado só na tela | #71 | `…000400`, `/equipe` |
| CSP completa com nonce por requisição (sem `unsafe-inline` em script; Turnstile só em `/entrar`, YouTube só no portfólio; `CSP_REPORT_ONLY=1` só avisa, para o staging) | #152 | `src/server/csp.ts`, `src/proxy.ts` |
| Matriz de RLS gerada do catálogo (falha fechado para tabela nova) com varredura de aluno, líder e coordenador contra pessoa de fora | #154 | `supabase/tests/rls_matrix.test.sql` |
| E2E: colunas cifradas sem texto legível (também depois de exportar e excluir); XSS em campos mostrados a outra pessoa; toda rota protegida sem sessão vai ao login | #155 #156 | `e2e/encrypted-columns-live.spec.ts`, `e2e/xss-live.spec.ts`, `e2e/protected-routes.spec.ts` |
| Entrada "Cinema" e acabamento do interior (22/11): cortina, ondas douradas em canvas que acompanham a rolagem, frase gigante, lista [01]–[04] que abre sem JavaScript, faixa dourada que se abre com a rolagem (CSS ligado à rolagem, sem biblioteca nova); títulos em caixa alta com a última palavra em itálico dourado; som opcional (desligado até a pessoa ligar, Web Audio, sem arquivo); troca de tela com View Transition; número que conta; confete da medalha nova; ícone da aba gerado da configuração. Tudo parado com "menos movimento" | — | `src/app/page.tsx`, `src/modules/landing`, `src/modules/ui` (SoundToggle, CountUp, BackLink, Tag), `src/app/(conta)/template.tsx` |
| Base em volume (2 mil, 50 mil, 500 mil) e medição; o seed revelou listas e busca por escopo lentas (checagem por linha) e elas ficaram rápidas com as mesmas regras | #74 (#23, #46) | `scripts/seed-volume.*`, `…000300`, `docs/TESTES.md` §5.1 |

## Ligado e desligado (config/instance.ts)

- `evaluations.enabled: false`: o ADR 0007 §4 exige parecer do jurídico (LGPD art. 18, II).
- `teamChat.enabled: false`: decisão aberta na #120 (moderação e guarda; o ADR 0006 deixou fora do POC,
  a ata de 17/11 pediu). O banco já guarda só texto cifrado pelo app, com limite anti-spam.
- Draft do 2º ciclo pronto (ata §6): a coordenação abre a rodada, cada coordenador de equipe escolhe na sua vez
  num trecho da lista, em serpentina; quem sobra a coordenação distribui. Tela em `/coordenacao/equipes` e `/equipe`.

## Regras seguidas

- Toda tabela nova com RLS e teste "fora do escopo → negado"; ações só por funções `security definer`
  com `search_path = ''`; sem `service_role` no navegador; dado pessoal novo só com ADR (o único é o
  das equipes de antes da plataforma, ADR 0012, ainda **proposto**, e entra no termo só na `v2`); nomes, mensagens e
  avaliações só cifrados pelo app (`src/server/crypto`).
- Exclusão de conta testada com os dados novos (cascata ou `set null`, conforme o MODELO_DADOS).
- Uma mudança em teste existente: `truncate ... public.units` ganhou `cascade` em 5 testes, porque as
  tabelas novas apontam para `units`.

## Demonstração local

`npm run db:reset && npm run db:seed-profiles`, depois
`psql "$(npx supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')" -f scripts/demo/seed-demo.sql`.
Cria equipes, missões, entregas, medalhas e identidades com pessoas fictícias, tudo pelas funções do
app. Com `DEMO_MODE=1`, `/demo?papel=membro|coordenacao` entra direto (perfil-ficticio-07 e -04).

## Provas

- `supabase test db` (banco limpo, 22/11): 37 arquivos, 1572 testes passando (os seus e os novos), com 17 linhas novas na
  matriz de permissões (R16: publicar missão e ver pontos da unidade, com casos negados).
- `vitest`: 791 testes (22/11, depois do visual). `tsc`, `eslint --max-warnings 0` e `next build` sem erro.
- Visual (22/11): revisão por critérios do júri da Awwwards, nota 9,0 na entrada e no interior, com o
  movimento conferido em vídeo de celular quadro a quadro (sem clarão branco na abertura, número sem
  piscar, confete à vista). Guardas novas: `tests/no-js-loading.test.ts` (nada de `loading.tsx`: sem
  JavaScript o esqueleto nunca dava lugar ao conteúdo) e "sem medalha, nada no `localStorage`" (ADR 0008).
- Playwright com o Supabase local (22/11): 82 passam. 3 dos seus (`auth-live`, `fluxo-completo`, `profile`)
  leem o link do e-mail, que aponta para a porta 3000 do `site_url`; aqui a 3000 está ocupada por outro
  serviço e o teste rodou na 3100, então eles não chegaram ao app. No CI (porta 3000) rodam normalmente.
- Guarda `tests/visual-tokens.test.ts`: reprova cor fora do tema, texto sem o fundo certo (branco sem
  primário, letra clara no amarelo) e letra abaixo da base (`text-xs`, `text-sm`).
- Fotos em 1440 px e 390 px de todas as telas, nas duas visões: nada passa da largura da tela e a menor
  letra tem 18 px.
- Fluxo completo no navegador (produção local, pessoas fictícias do seed): criar equipe → distribuir →
  buscar → dar medalha → publicar missão → entregar → validar → pontos e medalha no perfil; e o draft
  (abrir → vez da equipe → escolher → a vez passa).

## Pendências conhecidas

- **ADR 0012 (equipes de antes da plataforma) está proposto**: precisa do seu OK (R4). O termo de
  consentimento não mudou; o item entra na `v2`, junto com o que espera o jurídico.
- **Esperam decisão de outra pessoa:** papel de mentor (#137, as 4 perguntas da issue ao stakeholder);
  medalha de presença (#71: falta definir reuniões e quem registra a presença); baixar/excluir dados
  para quem está na espera ou bloqueado (#130, jurídico); termo (#7, jurídico); conversa da equipe
  (#120, ligada por configuração); pontos × "feito/não feito" (retorno do stakeholder em 21/11,
  diferente do ADR 0006).
- As políticas de leitura de `profiles` e `unit_members` mudaram de forma, não de regra
  (`…000300`): o escopo é calculado uma vez por consulta. A matriz de permissões passa inteira.
- Conserto já incluído: tirar um item do portfólio podia dar "chave repetida" com as linhas guardadas
  fora de ordem (`…20261122000100`, com teste que reproduzia a falha).

- Velocidade no celular (Lighthouse): a entrada nova ficou tão leve quanto `/entrar` (73 × 75 na mesma
  força de máquina), com o maior texto na primeira pintura. A nota oficial do PageSpeed não foi medida:
  a cota grátis acabou em 22/11 e o PageSpeed não abre endereços `trycloudflare`. Medir no endereço final.
