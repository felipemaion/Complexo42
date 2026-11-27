# ADR 0012: Equipes de antes da plataforma (ex-aluno), informadas pela pessoa

- **Status:** Proposto (aguarda o gestor; R4 pede ADR para dado pessoal novo)
- **Data:** 2026-11-22
- **Issue:** #136

## Contexto

O stakeholder comentou, e o gestor pediu que ficasse registrado (2026-11-19): quem vem da
Academia ("ex-aluno") já pertenceu a equipes antes da plataforma e poderá informar isso depois do
cadastro. A issue deixou três dúvidas: que dados entram, se a pessoa pode citar colegas e se a
coordenação confirma.

O histórico real de equipes **na** plataforma já existe (`unit_members` com `left_at`, ADR 0007
§2). As equipes **de antes** são outra coisa: informadas pela pessoa e sem confirmação.

## Decisão (proposta, a mais conservadora)

1. **Dados:** `prior_teams(profile_id, team_name, period, role, position, created_at)`, no máximo
   **5 por pessoa**. `team_name` de 2 a 80 letras, `period` livre de 1 a 40 ("2023", "ciclo
   2024/1"), `role` entre `member`, `spokesperson` e `coordinator`. Texto puro: como "equipe" e
   "casa" no MODELO_DADOS, não identifica a pessoa sozinho.
2. **Sem colegas.** Citar com quem trabalhou seria dado de terceiros; fica para o "trabalhou com"
   com confirmação mútua (ADR 0007 §3), se o stakeholder quiser.
3. **Sem confirmação.** Fica como declaração. A tela da coordenação mostra "informado pela
   própria pessoa, sem confirmação".
4. **Não dá nada.** As linhas não entram em escopo, visibilidade nem acesso. Só a própria pessoa e
   a coordenação (`manager` ou `monitor`) com escopo sobre algum vínculo **aberto** dela leem
   (`prior_teams_list`), para montar equipes. Escrita só pela própria pessoa, por função
   (`add_prior_team`, `remove_prior_team`); leitura direta só da própria linha (RLS).
5. **LGPD:** a linha é dado da pessoa (`on delete cascade`) e sai no "Baixar meus dados"
   (`export_own_activity` → `equipesAnteriores`).
6. **Termo:** entra no termo de consentimento na próxima versão (`v2`), junto com os itens que já
   esperam o jurídico. Mudar o termo exige novo aceite de todos, por isso não muda sozinho aqui.

## Consequências

- A coordenação vê, no histórico da pessoa (#69), as equipes de antes da plataforma logo abaixo
  das equipes da plataforma.
- Se o stakeholder quiser confirmação ou colegas, isso vira um ADR novo; a tabela atual não muda.
- Implementação: migration `20261128002000_prior_teams.sql`, teste `supabase/tests/prior_teams.test.sql`,
  tela `/perfil/equipes-anteriores`.
