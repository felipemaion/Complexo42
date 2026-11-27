-- Draft do 2º ciclo (ata de 17/11 §6) e pedido auditado de leitura de avaliação (ADR 0007 §4).
--
-- Draft: a coordenação da região abre uma rodada com as equipes na ordem de escolha (a ordem
-- vem da avaliação dos porta-vozes, decidida pela coordenação). Na sua vez, o coordenador da
-- equipe (member_role 'lead') escolhe UMA pessoa entre as primeiras `slice_size` da lista de
-- quem está sem equipe na região ("um trecho da lista, nunca a lista inteira") e a vez passa,
-- em serpentina. Quem sobrar é distribuído pela coordenação (assign_to_team, já existente).
--
-- Avaliação: o gestor só lê avaliações de alguém por pedido com motivo obrigatório; o motivo
-- fica em evaluation_access_requests e o evento `evaluation_viewed` vai para o audit_log.

-- ---------------------------------------------------------------------------------------
-- 1. Draft
-- ---------------------------------------------------------------------------------------
create table public.draft_sessions (
  id uuid primary key default gen_random_uuid(),
  parent_unit_id uuid not null references public.units (id) on delete restrict,
  team_order uuid[] not null check (cardinality(team_order) between 2 and 50),
  slice_size integer not null default 3 check (slice_size between 1 and 20),
  picks_made integer not null default 0 check (picks_made >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index draft_sessions_one_open on public.draft_sessions (parent_unit_id) where status = 'open';

alter table public.draft_sessions enable row level security;
revoke all on public.draft_sessions from anon, authenticated;
grant select on public.draft_sessions to authenticated;
create policy draft_sessions_select on public.draft_sessions
  for select to authenticated
  using (app.is_active_member() and (app.can_manage_unit(parent_unit_id) or app.my_team() = any (team_order)));

-- Equipe da vez, em serpentina: 1,2,3,3,2,1,1,2,...
create or replace function app.draft_team_on_turn(p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (s.picks_made / cardinality(s.team_order)) % 2 = 0
      then s.team_order[(s.picks_made % cardinality(s.team_order)) + 1]
    else s.team_order[cardinality(s.team_order) - (s.picks_made % cardinality(s.team_order))]
  end
  from public.draft_sessions as s
  where s.id = p_session;
$$;

-- O trecho da lista que a equipe da vez pode escolher: as primeiras `slice_size` pessoas sem
-- equipe na região, em ordem estável (data de entrada no vínculo atual).
create or replace function app.draft_slice(p_session uuid)
returns table (profile_id uuid, display_name_enc text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name_enc
  from public.draft_sessions as s
  join public.units as parent on parent.id = s.parent_unit_id
  join public.unit_members as m on m.left_at is null
  join public.units as u on u.id = m.unit_id
  join public.unit_types as t on t.id = u.type_id
  join public.profiles as p on p.id = m.profile_id
  where s.id = p_session
    and not t.is_team
    and (u.path operator(extensions.<@) parent.path or u.path operator(extensions.@>) parent.path)
    and app.is_active_profile(p.id)
  order by m.joined_at, p.id
  limit (select slice_size from public.draft_sessions where id = p_session);
$$;

create or replace function public.open_draft(p_parent uuid, p_team_order uuid[], p_slice_size integer default 3)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session uuid;
begin
  if not app.is_active_member() or not app.can_manage_unit(p_parent) then
    raise exception 'sem permissão para abrir o draft desta região' using errcode = '42501';
  end if;
  if cardinality(p_team_order) < 2 or exists (
    select 1 from unnest(p_team_order) as o (team_id)
    left join public.units as u on u.id = o.team_id
    left join public.unit_types as t on t.id = u.type_id
    where u.id is null or u.parent_id <> p_parent or u.status <> 'active' or not coalesce(t.is_team, false)
  ) or (select count(distinct x) from unnest(p_team_order) as x) <> cardinality(p_team_order) then
    raise exception 'a ordem precisa ter 2 ou mais equipes ativas desta região, sem repetir' using errcode = '22023';
  end if;
  insert into public.draft_sessions (parent_unit_id, team_order, slice_size, created_by)
  values (p_parent, p_team_order, p_slice_size, (select auth.uid()))
  returning id into new_session;
  return new_session;
end;
$$;

create or replace function public.draft_state()
returns table (session_id uuid, team_on_turn uuid, team_on_turn_name text, is_my_turn boolean, picks_made integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, app.draft_team_on_turn(s.id), u.name,
         exists (
           select 1 from public.unit_members as m
           where m.unit_id = app.draft_team_on_turn(s.id) and m.profile_id = (select auth.uid())
             and m.left_at is null and m.member_role = 'lead'
         ),
         s.picks_made
  from public.draft_sessions as s
  join public.units as u on u.id = app.draft_team_on_turn(s.id)
  where s.status = 'open'
    and app.is_active_member()
    and (app.can_manage_unit(s.parent_unit_id) or app.my_team() = any (s.team_order));
$$;

create or replace function public.draft_options(p_session uuid)
returns table (profile_id uuid, display_name_enc text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.profile_id, o.display_name_enc
  from app.draft_slice(p_session) as o
  where exists (
    select 1 from public.draft_sessions as s
    where s.id = p_session and s.status = 'open' and app.is_active_member()
      and (app.can_manage_unit(s.parent_unit_id) or app.my_team() = any (s.team_order))
  );
$$;

create or replace function public.draft_pick(p_session uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  session public.draft_sessions%rowtype;
  turn_team uuid;
begin
  select * into session from public.draft_sessions where id = p_session for update;
  if session.id is null or session.status <> 'open' then
    raise exception 'não há draft aberto' using errcode = 'C7613';
  end if;
  turn_team := app.draft_team_on_turn(p_session);
  if not app.is_active_member() or not exists (
    select 1 from public.unit_members as m
    where m.unit_id = turn_team and m.profile_id = me and m.left_at is null and m.member_role = 'lead'
  ) then
    raise exception 'não é a vez da sua equipe' using errcode = '42501';
  end if;
  if not exists (select 1 from app.draft_slice(p_session) as o where o.profile_id = p_profile) then
    raise exception 'a pessoa não está no trecho da lista desta vez' using errcode = '22023';
  end if;
  update public.unit_members set left_at = now() where profile_id = p_profile and left_at is null;
  insert into public.unit_members (unit_id, profile_id, member_role) values (turn_team, p_profile, 'member');
  update public.draft_sessions set picks_made = picks_made + 1 where id = p_session;
end;
$$;

-- Encerra a rodada; quem sobrou fica para a coordenação distribuir (assign_to_team).
create or replace function public.close_draft(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member() or not exists (
    select 1 from public.draft_sessions as s
    where s.id = p_session and s.status = 'open' and app.can_manage_unit(s.parent_unit_id)
  ) then
    raise exception 'sem permissão ou draft já encerrado' using errcode = '42501';
  end if;
  update public.draft_sessions set status = 'closed' where id = p_session;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Pedido auditado de leitura de avaliação (ADR 0007 §4)
-- ---------------------------------------------------------------------------------------
create table public.evaluation_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users (id) on delete set null,
  -- A pessoa avaliada: o pedido some com a conta dela, junto com as avaliações.
  profile_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (length(reason) between 10 and 300),
  created_at timestamptz not null default now()
);
alter table public.evaluation_access_requests enable row level security;
revoke all on public.evaluation_access_requests from anon, authenticated;
grant select on public.evaluation_access_requests to authenticated;
create policy evaluation_access_requests_select on public.evaluation_access_requests
  for select to authenticated
  using (requester_id = (select auth.uid()));

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked', 'evaluation_viewed',
  -- eventos da coordenação do questionário (main, 20261120030000 e 20261127140000): esta migration
  -- roda depois das da main e a lista vale a união; sem eles falharia num banco que já os registrou.
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked',
  'questionnaire_result_viewed'
));

-- Só manager (gestor) com escopo sobre a unidade da pessoa; motivo de 10 a 300 caracteres.
create or replace function public.request_evaluation_access(p_profile uuid, p_reason text)
returns table (axis text, grade_enc text, note_enc text, cycle_ends_on date, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  reason text := trim(coalesce(p_reason, ''));
begin
  if not app.is_active_member() or p_profile = me or not exists (
    select 1 from public.unit_members as m
    join public.units as u on u.id = m.unit_id
    where m.profile_id = p_profile and m.left_at is null
      and app.has_scope_over(u.path, array['manager'])
  ) then
    raise exception 'só o gestor com escopo sobre a pessoa pede acesso' using errcode = '42501';
  end if;
  if length(reason) < 10 or length(reason) > 300 then
    raise exception 'o motivo é obrigatório (10 a 300 caracteres)' using errcode = '22023';
  end if;
  insert into public.evaluation_access_requests (requester_id, profile_id, reason) values (me, p_profile, reason);
  insert into public.audit_log (actor_id, event, target_id) values (me, 'evaluation_viewed', p_profile);
  return query
    select e.axis, e.grade_enc, e.note_enc, e.cycle_ends_on, e.created_at
    from public.member_evaluations as e
    where e.profile_id = p_profile
    order by e.created_at desc;
end;
$$;

revoke all on function app.draft_team_on_turn(uuid), app.draft_slice(uuid) from public, anon;
grant execute on function app.draft_team_on_turn(uuid), app.draft_slice(uuid) to authenticated;
revoke all on function public.open_draft(uuid, uuid[], integer), public.draft_state(), public.draft_options(uuid),
  public.draft_pick(uuid, uuid), public.close_draft(uuid), public.request_evaluation_access(uuid, text)
  from public, anon;
grant execute on function public.open_draft(uuid, uuid[], integer), public.draft_state(), public.draft_options(uuid),
  public.draft_pick(uuid, uuid), public.close_draft(uuid), public.request_evaluation_access(uuid, text)
  to authenticated;
