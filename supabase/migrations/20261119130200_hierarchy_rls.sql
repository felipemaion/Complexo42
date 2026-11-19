-- Grants e políticas RLS da hierarquia (issue #46). Toda decisão passa pelas funções
-- `app.can_*` (R15); os testes estão em supabase/tests/permissions_matrix.test.sql (R16).
--
-- O Supabase concede tudo em `public` a anon e authenticated por padrão. Aqui o acesso é
-- fechado e reaberto só no que cada tabela precisa. Visitante sem login (anon) não tem
-- acesso a nenhuma destas tabelas. Nenhuma tabela aceita DELETE pela API: unidade é
-- arquivada (`status`), vínculo é encerrado (`left_at`) e papel é revogado (`revoked_at`).
-- O audit_log de concessão e revogação (ADR 0002, regra 5) entra com a tabela audit_log.

revoke all on public.unit_types, public.units, public.unit_members, public.role_assignments
  from anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- unit_types: rótulos da instância, sem dado pessoal. Escrita só por migration/seed.
-- ---------------------------------------------------------------------------------------
grant select on public.unit_types to authenticated;

create policy unit_types_select on public.unit_types
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------------------
-- units: cada um vê o seu ramo e o caminho até a raiz; quem gerencia renomeia.
-- Criar, mover e arquivar unidades fica fora da API por enquanto (seed/operação).
-- ---------------------------------------------------------------------------------------
grant select on public.units to authenticated;
grant update (name) on public.units to authenticated;

create policy units_select on public.units
  for select to authenticated
  using (app.can_view_unit(id));

create policy units_update on public.units
  for update to authenticated
  using (app.can_manage_unit(id))
  with check (app.can_manage_unit(id));

-- ---------------------------------------------------------------------------------------
-- unit_members: a pessoa vê os próprios vínculos; quem gerencia a unidade vê e mantém os
-- vínculos dela (papel no grupo e encerramento). Vincular e mover pessoas não é INSERT
-- direto: a entrada inicial é o trigger `app.tg_join_state_unit` e a troca de unidade vira
-- uma função própria, que confere as duas pontas e registra `member_moved` (ADR 0007 §2).
-- ---------------------------------------------------------------------------------------
grant select on public.unit_members to authenticated;
grant update (member_role, left_at) on public.unit_members to authenticated;

create policy unit_members_select on public.unit_members
  for select to authenticated
  using (profile_id = (select auth.uid()) or app.can_manage_unit(unit_id));

-- Só vínculos abertos: um vínculo encerrado é histórico e não reabre.
create policy unit_members_update on public.unit_members
  for update to authenticated
  using (left_at is null and app.can_manage_unit(unit_id))
  with check (app.can_manage_unit(unit_id));

-- ---------------------------------------------------------------------------------------
-- role_assignments: a pessoa vê os próprios papéis; quem gerencia a unidade vê os papéis
-- nela. Conceder e revogar seguem `app.can_grant_role` (delegação só para baixo).
-- ---------------------------------------------------------------------------------------
grant select on public.role_assignments to authenticated;
grant insert (profile_id, role, unit_id, granted_by) on public.role_assignments
  to authenticated;
grant update (revoked_at) on public.role_assignments to authenticated;

create policy role_assignments_select on public.role_assignments
  for select to authenticated
  using (profile_id = (select auth.uid()) or app.can_manage_unit(unit_id));

create policy role_assignments_insert on public.role_assignments
  for insert to authenticated
  with check (
    granted_by = (select auth.uid())
    and revoked_at is null
    and app.can_grant_role(role, unit_id)
  );

-- Só revoga (nulo → data); um papel revogado não volta, concede-se outro.
create policy role_assignments_revoke on public.role_assignments
  for update to authenticated
  using (revoked_at is null and app.can_grant_role(role, unit_id))
  with check (revoked_at is not null and app.can_grant_role(role, unit_id));
