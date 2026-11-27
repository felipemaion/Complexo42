-- Telas da coordenação do questionário (issue #174, ADR 0014).
--
-- 1. `questionnaire_coordination_access()`: o que quem chama pode fazer nas telas (nacional: lê,
--    resolve e delega; delegado: lê e resolve no escopo da concessão). Só alimenta o menu e o 404 das
--    telas: quem lê e quem resolve continua sendo decidido pelas políticas e funções de sempre.
-- 2. Evento de auditoria `questionnaire_result_viewed`: quem abriu o resultado de quem, sem conteúdo
--    (nada de casa, totem, notas ou respostas). Só a coordenação nacional o lê pelo log; o gestor
--    territorial, o delegado e a pessoa vista não (esta o encontra no "Baixar meus dados").
-- 3. `log_questionnaire_view(alvo)`: registra o evento, só para quem pode ler os dados do alvo (a
--    nacional ou o delegado sobre pessoa ativa do escopo) e nunca sobre si mesmo.

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked',
  'questionnaire_result_viewed'
));

-- Os eventos da fila leem a nacional e quem ela delegou sobre aquela pessoa; os da delegação e as
-- visualizações de resultado, só a coordenação nacional (nem pelo alvo, nem pelo ator).
create or replace function app.can_read_audit(event text, target uuid, actor uuid default null, house text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and (
      (event = 'allowlist_imported' and app.manages_root())
      or (event in ('house_analysis_requested', 'house_analysis_resolved') and app.manages_root())
      or (
        event in ('house_analysis_requested', 'house_analysis_resolved')
        and target is not null
        and app.has_questionnaire_delegation_over(target)
      )
      or (event in ('questionnaire_access_granted', 'questionnaire_access_revoked', 'questionnaire_result_viewed') and app.manages_root())
      or (
        target is not null
        and event not in ('house_analysis_requested', 'house_analysis_resolved',
                          'questionnaire_access_granted', 'questionnaire_access_revoked',
                          'questionnaire_result_viewed')
        and app.manages_member(target)
      )
      or (
        event in ('house_accepted', 'questionnaire_consented')
        and actor is not null
        and actor = (select auth.uid())
      )
      or (
        event = 'house_accepted'
        and target is not null
        and house is not null
        and house = app.open_house_of(target)
        and app.is_house_coordinator_of((select auth.uid()), target)
      )
    );
$$;

create or replace function public.questionnaire_coordination_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object('national', app.manages_root(), 'delegate', app.holds_questionnaire_grant());
end;
$$;

comment on function public.questionnaire_coordination_access() is
  'O que quem chama pode fazer nas telas da coordenação do questionário: national (nacional) e delegate (concessão válida). Só para o menu e o 404 das telas (ADR 0014).';

create or replace function public.log_questionnaire_view(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  -- Mesma resposta para alvo nulo, inexistente, de fora do escopo ou inativo: nada diz se a pessoa existe.
  if caller is null or p_target is null or p_target = caller or not app.can_read_questionnaire_data(p_target) then
    raise exception 'sem acesso ao resultado desta pessoa' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'questionnaire_result_viewed', p_target);
end;
$$;

comment on function public.log_questionnaire_view(uuid) is
  'Registra que quem chama abriu o resultado do alvo (ator e alvo, sem conteúdo), só para quem pode lê-lo; nunca sobre si mesmo (ADR 0014).';

revoke execute on function public.questionnaire_coordination_access() from public, anon;
revoke execute on function public.log_questionnaire_view(uuid) from public, anon;
grant execute on function public.questionnaire_coordination_access() to authenticated;
grant execute on function public.log_questionnaire_view(uuid) to authenticated;
