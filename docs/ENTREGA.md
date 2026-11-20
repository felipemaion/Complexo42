# Entrega: visual e módulos de M2 a M5 (proposta para revisão)

Feito sobre a `main` em `7b5c30e` (19/11), **sem alterar o que já existia**, em commits pequenos e
separados por assunto, para você aceitar aos poucos (um PR por commit, se preferir). Nada foi
enviado ao GitHub: chega como bundle (`git fetch complexo42-entrega.bundle entrega/plataforma-completa`).

## O que entra

| Assunto | Issues | Onde |
|---|---|---|
| Visual para pessoas mais velhas (tokens, fonte Atkinson Hyperlegible, 18 px, botões de 56 px) aplicado em todas as telas | ata 17/11 §10 | `src/app/globals.css`, `src/modules/ui` |
| Missões, etapas, execuções, entregas, validação e livro-razão de pontos | #30 #31 #32 #33 | migrations `…000000/000100`, `src/modules/missions`, `/missoes`, `/coordenacao/missoes` |
| Busca de pessoas por habilidade (todas as marcadas, só no escopo, sem contato) | #23 | `…000200`, `src/modules/search`, `/coordenacao/busca` |
| Montagem das equipes do 1º ciclo (criar, distribuir, coordenador da equipe) | #28 #29 | `…000300`, `src/modules/teams`, `/coordenacao/equipes` |
| Medalhas (criar, conceder com motivo, revogar, coleção no perfil) | #34 #35 #37 | `…000400`, `src/modules/badges`, `/coordenacao/medalhas` |
| Painel por equipe, avaliação reservada, conversa da equipe, tela "Minha equipe" | #49 #120 | `…000500/000600`, `src/modules/collab`, `/equipe` |

## Ligado e desligado (config/instance.ts)

- `evaluations.enabled: false`: o ADR 0007 §4 exige parecer do jurídico (LGPD art. 18, II).
- `teamChat.enabled: false`: decisão aberta na #120 (moderação e guarda; o ADR 0006 deixou fora do POC,
  a ata de 17/11 pediu). O banco já guarda só texto cifrado pelo app, com limite anti-spam.
- Draft do 2º ciclo não foi feito: a ata diz que no início não há draft.

## Regras seguidas

- Toda tabela nova com RLS e teste "fora do escopo → negado"; ações só por funções `security definer`
  com `search_path = ''`; sem `service_role` no navegador; nada de dado pessoal novo; nomes, mensagens e
  avaliações só cifrados pelo app (`src/server/crypto`).
- Exclusão de conta testada com os dados novos (cascata ou `set null`, conforme o MODELO_DADOS).
- Uma mudança em teste existente: `truncate ... public.units` ganhou `cascade` em 5 testes, porque as
  tabelas novas apontam para `units`.

## Provas

- `supabase test db`: 20 arquivos, 1375 testes passando (os seus e os novos).
- `vitest`: 78 arquivos, 691 testes. `tsc`, `eslint --max-warnings 0` e `next build` sem erro.
- Novo guarda `tests/visual-tokens.test.ts`: reprova cor fora do tema e texto branco sem fundo.
- Fluxo completo no navegador (produção local, pessoas fictícias do seed): criar equipe → distribuir →
  buscar → dar medalha → publicar missão → entregar → validar → pontos e medalha no perfil.

## Pendências conhecidas

- `tests/eslint-xss.test.ts` às vezes estoura os 5 s em máquina lenta (já acontecia antes).
- Matriz `permissions_matrix.test.sql` (R16) ainda sem linhas das tabelas novas; os testes de cada
  módulo cobrem os casos negados.
- Pedido auditado de acesso à avaliação pelo gestor (`evaluation_viewed`) não foi feito.
