-- Busca de pessoas por habilidade (issue #23, prioridade do gestor nacional).
-- `search_people_by_skills` roda no banco (habilidades indexadas) e só devolve quem a pessoa que chama pode ver:
-- a coordenação nacional (`manages_root`) vê todos os perfis ativos; os demais passam por `app.can_view_profile`,
-- aplicado depois de o filtro de habilidade reduzir os candidatos. Habilidades combinam com E (todas) ou OU
-- (qualquer uma), de 1 a 5. Filtros: UF, município, distrito, turma e "sem turma" (UF, município e distrito estão
-- em texto puro, MODELO_DADOS). A lista traz o nome CIFRADO (o servidor decifra só o da página), a turma, a quantidade
-- de habilidades em comum e os ids das habilidades da pessoa; nunca contato (o contato é da #48, auditado).
-- Paginação por cursor (em comum, id), até 50 por página. Limite de 60 buscas por hora por pessoa (54000) e cada
-- busca grava `skills_searched` (só o ator: nem o termo nem as habilidades vão para o log).

-- O predicado é o de `app.is_active_profile` (liberado E conta ativa), o que a função filtra: o índice cobre só o que ela pode devolver.
-- O motor da busca é o índice de habilidade; este ajuda quando UF ou município cortam muito.
create index profiles_active_location_idx on public.profiles (state_code, municipality_code) where access_status = 'active' and status = 'active';

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
  'questionnaire_result_viewed', 'house_changed',
  'house_window_opened', 'house_window_closed',
  'skill_suggestion_decided', 'skill_reactivated',
  'skills_searched'
));

create or replace function public.search_people_by_skills(
  p_skill_ids uuid[],
  p_mode text default 'all',
  p_state text default null,
  p_municipality integer default null,
  p_district integer default null,
  p_unit uuid default null,
  p_no_team boolean default false,
  p_limit integer default 20,
  p_after_common integer default null,
  p_after_id uuid default null
)
returns table (
  profile_id uuid,
  display_name_enc text,
  state_code text,
  municipality_code integer,
  team_name text,
  common_count integer,
  skill_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  ids uuid[];
  page_size integer;
  national boolean;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  ids := array(select distinct x from unnest(p_skill_ids) as x where x is not null);
  if cardinality(ids) = 0 or cardinality(ids) > 5 or p_mode is null or p_mode not in ('all', 'any') then
    raise exception 'busca inválida' using errcode = 'invalid_parameter_value';
  end if;

  -- Quem não está liberado, ou não tem a casa, não busca: lista vazia, não erro.
  if not app.is_active_member() then
    return;
  end if;

  -- Trava por pessoa: duas buscas ao mesmo tempo não contam as mesmas linhas e passam juntas do limite (como em view_contact).
  perform pg_advisory_xact_lock(hashtextextended('search_people_by_skills:' || caller::text, 0));
  if (select count(*) from public.audit_log as a
      where a.actor_id = caller and a.event = 'skills_searched' and a.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'limite de buscas por hora' using errcode = 'program_limit_exceeded';
  end if;
  insert into public.audit_log (actor_id, event) values (caller, 'skills_searched');

  page_size := greatest(1, least(coalesce(p_limit, 20), 50));
  national := app.manages_root();

  return query
  with hits as (
    select ps.profile_id as pid, count(*)::integer as common
    from public.profile_skills as ps
    where ps.skill_id = any (ids)
    group by ps.profile_id
    having p_mode = 'any' or count(*) = cardinality(ids)
  )
  select
    p.id,
    p.display_name_enc,
    p.state_code::text,
    p.municipality_code,
    team.name,
    h.common,
    array(select s.skill_id from public.profile_skills as s where s.profile_id = p.id order by s.skill_id)
  from hits as h
  join public.profiles as p on p.id = h.pid
  left join lateral (
    select u.name
    from public.unit_members as m
    join public.units as u on u.id = m.unit_id
    join public.unit_types as t on t.id = u.type_id
    where m.profile_id = p.id and m.left_at is null and t.is_team
    limit 1
  ) as team on true
  where app.is_active_profile(p.id)
    and (p_state is null or p.state_code = p_state)
    and (p_municipality is null or p.municipality_code = p_municipality)
    and (p_district is null or p.district_code = p_district)
    and (p_unit is null or exists (
      select 1 from public.unit_members as m where m.profile_id = p.id and m.left_at is null and m.unit_id = p_unit
    ))
    and (not coalesce(p_no_team, false) or team.name is null)
    and (p_after_common is null or p_after_id is null or h.common < p_after_common or (h.common = p_after_common and p.id > p_after_id))
    and (national or app.can_view_profile(p.id))
  order by h.common desc, p.id
  limit page_size + 1;
end;
$$;

comment on function public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid) is
  'Busca de pessoas por habilidade (#23): no banco, no escopo de quem chama, sem contato, paginada por cursor, 60 por hora, auditada.';

revoke execute on function public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid) to authenticated;
