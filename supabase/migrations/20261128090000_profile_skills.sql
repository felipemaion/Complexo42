-- Habilidades da pessoa (issue #15, decisão do Felipe de 2026-11-28).
-- 1. Sem nível: a pessoa só marca "tenho". No máximo 10 por pessoa, conferido AQUI (gatilho) e na função.
-- 2. A pessoa grava só pelo conjunto inteiro, `set_my_skills(ids)`; nada é gravado direto pela API.
-- 3. Habilidade nova: a pessoa SUGERE (`suggest_skill`) e a coordenação nacional APROVA ou rejeita
--    (`decide_skill_suggestion`) antes de entrar no catálogo; fica no lugar da opção "outra". O nome
--    sugerido é texto livre da pessoa (FINALIDADE: virar nome de habilidade do catálogo, visível a todos
--    os membros, depois da aprovação): sem caractere de controle nem invisível, 2 a 80 caracteres.
--    Limites: 3 abertas e 5 por 24 horas (de qualquer estado, para rejeitar não liberar spam).
-- 4. Os sinônimos (`skills.aliases`) ficam sem caixa e sem acento (`app.norm_text`), como o termo buscado.
-- 5. "Baixar meus dados" traz as habilidades e as sugestões; a exclusão da conta apaga as duas (cascade).

create extension if not exists unaccent with schema extensions;

-- Texto de busca: minúsculo e sem acento. IMUTÁVEL de propósito (dicionário explícito), para valer em índice.
create or replace function app.norm_text(t text)
returns text
language sql
immutable
strict
set search_path = ''
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t)) $$;

revoke execute on function app.norm_text(text) from public, anon;
grant execute on function app.norm_text(text) to authenticated;

create or replace function app.skills_per_person_max()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

revoke execute on function app.skills_per_person_max() from public, anon;
grant execute on function app.skills_per_person_max() to authenticated;

-- Nome de habilidade: 2 a 80 caracteres, sem espaço nas pontas, sem caractere de controle nem invisível
-- (largura zero, marcas de direção, hífen suave, BOM).
create or replace function app.valid_skill_name(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t is not null
    and char_length(t) between 2 and 80
    and t = btrim(t)
    and t !~ '[[:cntrl:]­​-‏‪-‮⁠-⁤⁦-⁩﻿]'
$$;

revoke execute on function app.valid_skill_name(text) from public, anon;
grant execute on function app.valid_skill_name(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Sinônimos sem caixa e sem acento
-- ---------------------------------------------------------------------------------------
create or replace function app.tg_skills_norm_aliases()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.aliases := coalesce((
    select array_agg(v order by v)
    from (select distinct app.norm_text(btrim(a)) as v from unnest(new.aliases) as a where btrim(a) <> '') as s
  ), '{}');
  return new;
end;
$$;

revoke execute on function app.tg_skills_norm_aliases() from public, anon, authenticated;

create trigger skills_norm_aliases
  before insert or update of aliases on public.skills
  for each row execute function app.tg_skills_norm_aliases();

update public.skills set aliases = aliases;

-- ---------------------------------------------------------------------------------------
-- Limite de 10 por pessoa, no banco
-- ---------------------------------------------------------------------------------------
create or replace function app.tg_profile_skills_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Trava o perfil: dois envios ao mesmo tempo não passam do limite juntos.
  perform 1 from public.profiles as p where p.id = new.profile_id for update;
  if (select count(*) from public.profile_skills as s where s.profile_id = new.profile_id) >= app.skills_per_person_max() then
    raise exception 'no máximo 10 habilidades por pessoa' using errcode = 'C7701';
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_profile_skills_limit() from public, anon, authenticated;

create trigger profile_skills_limit
  before insert on public.profile_skills
  for each row execute function app.tg_profile_skills_limit();

-- ---------------------------------------------------------------------------------------
-- Sugestões de habilidade
-- ---------------------------------------------------------------------------------------
create table public.skill_suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (app.valid_skill_name(name)),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint skill_suggestions_decided check ((status = 'open') = (decided_at is null))
);

comment on table public.skill_suggestions is
  'Sugestões de habilidade nova (#15). `name` é texto livre da pessoa, visível à coordenação nacional e, se aprovado, a todos os membros no catálogo. Apagadas com o perfil.';

create unique index skill_suggestions_open_name_idx on public.skill_suggestions (profile_id, app.norm_text(name)) where status = 'open';
create index skill_suggestions_profile_created_idx on public.skill_suggestions (profile_id, created_at);
create index skill_suggestions_open_idx on public.skill_suggestions (created_at) where status = 'open';
create index skill_suggestions_decided_by_idx on public.skill_suggestions (decided_by);

alter table public.skill_suggestions enable row level security;

revoke all on public.skill_suggestions from public, anon, authenticated;
grant select on public.skill_suggestions to authenticated;

-- A pessoa lê as próprias; a coordenação nacional lê todas (a fila).
create policy skill_suggestions_select on public.skill_suggestions
  for select to authenticated
  using (app.is_active_member() and (profile_id = (select auth.uid()) or app.manages_root()));

-- ---------------------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------------------
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
  'skill_suggestion_decided'
));

-- ---------------------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------------------
-- O conjunto inteiro das habilidades de quem chama. Só habilidade ativa entra (a que a pessoa já tem
-- e foi desativada pode ficar). Mais de 10: C7701. Devolve quantas ficaram.
create or replace function public.set_my_skills(p_skill_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  ids uuid[];
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo marca habilidades' using errcode = 'insufficient_privilege';
  end if;

  ids := coalesce(array(select distinct x from unnest(p_skill_ids) as x where x is not null), '{}');
  if cardinality(ids) > app.skills_per_person_max() then
    raise exception 'no máximo 10 habilidades por pessoa' using errcode = 'C7701';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;

  if exists (
    select 1 from unnest(ids) as i
    where not exists (
      select 1 from public.skills as s
      where s.id = i
        and (s.active or exists (select 1 from public.profile_skills as ps where ps.profile_id = caller and ps.skill_id = i))
    )
  ) then
    raise exception 'habilidade indisponível' using errcode = 'no_data_found';
  end if;

  delete from public.profile_skills where profile_id = caller and not (skill_id = any (ids));
  insert into public.profile_skills (profile_id, skill_id)
  select caller, i from unnest(ids) as i
  on conflict do nothing;
  return cardinality(ids);
end;
$$;

comment on function public.set_my_skills(uuid[]) is
  'Define o conjunto de habilidades de quem chama (até 10, só ativas). Única forma de gravar profile_skills (#15).';

-- Sugere uma habilidade nova. 22023 nome inválido; C7704 já existe (catálogo ou sugestão aberta da pessoa);
-- C7702 já tem 3 abertas; C7703 já sugeriu 5 nas últimas 24 horas (qualquer estado).
create or replace function public.suggest_skill(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean text := btrim(p_name);
  new_id uuid;
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo sugere habilidades' using errcode = 'insufficient_privilege';
  end if;
  if not app.valid_skill_name(clean) then
    raise exception 'nome de habilidade inválido' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;

  if exists (select 1 from public.skills as s where app.norm_text(s.name) = app.norm_text(clean))
     or exists (
       select 1 from public.skill_suggestions as q
       where q.profile_id = caller and q.status = 'open' and app.norm_text(q.name) = app.norm_text(clean)
     ) then
    raise exception 'essa habilidade já existe' using errcode = 'C7704';
  end if;
  if (select count(*) from public.skill_suggestions as q where q.profile_id = caller and q.status = 'open') >= 3 then
    raise exception 'já há 3 sugestões abertas' using errcode = 'C7702';
  end if;
  if (select count(*) from public.skill_suggestions as q
      where q.profile_id = caller and q.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite de sugestões por dia' using errcode = 'C7703';
  end if;

  insert into public.skill_suggestions (profile_id, name) values (caller, clean) returning id into new_id;
  return new_id;
end;
$$;

comment on function public.suggest_skill(text) is
  'A pessoa sugere uma habilidade nova (até 3 abertas e 5 por 24 horas); a coordenação nacional decide (#15).';

-- Só a coordenação nacional decide. Aprovar cria a habilidade (grupo obrigatório) ou usa a que já exista com o
-- mesmo nome, e a marca para quem sugeriu se ainda couber no limite. Grava skill_suggestion_decided.
create or replace function public.decide_skill_suggestion(p_id uuid, p_approve boolean, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  sug public.skill_suggestions;
  cat text := btrim(p_category);
  skill uuid;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional decide' using errcode = 'insufficient_privilege';
  end if;
  if p_approve is null or (p_approve and not app.valid_skill_name(cat)) then
    raise exception 'decisão inválida' using errcode = 'invalid_parameter_value';
  end if;

  select * into sug from public.skill_suggestions as q where q.id = p_id and q.status = 'open' for update;
  if not found then
    raise exception 'sugestão não encontrada ou já decidida' using errcode = 'no_data_found';
  end if;

  if p_approve then
    select s.id into skill from public.skills as s where app.norm_text(s.name) = app.norm_text(sug.name);
    if skill is null then
      insert into public.skills (name, category) values (sug.name, cat) returning id into skill;
    end if;
    perform 1 from public.profiles as p where p.id = sug.profile_id for update;
    if (select count(*) from public.profile_skills as ps where ps.profile_id = sug.profile_id) < app.skills_per_person_max() then
      insert into public.profile_skills (profile_id, skill_id) values (sug.profile_id, skill) on conflict do nothing;
    end if;
  end if;

  update public.skill_suggestions
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = caller, decided_at = now()
  where id = p_id;

  insert into public.audit_log (actor_id, event, target_id) values (caller, 'skill_suggestion_decided', sug.profile_id);
end;
$$;

comment on function public.decide_skill_suggestion(uuid, boolean, text) is
  'A coordenação nacional aprova (cria a habilidade no catálogo) ou rejeita a sugestão; audita (#15).';

revoke execute on function public.set_my_skills(uuid[]) from public, anon;
revoke execute on function public.suggest_skill(text) from public, anon;
revoke execute on function public.decide_skill_suggestion(uuid, boolean, text) from public, anon;
grant execute on function public.set_my_skills(uuid[]) to authenticated;
grant execute on function public.suggest_skill(text) to authenticated;
grant execute on function public.decide_skill_suggestion(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Baixar meus dados: com as habilidades e as sugestões da pessoa
-- ---------------------------------------------------------------------------------------

create or replace function public.export_own_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_per_hour constant integer := 5;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('export_own_data:' || caller::text, 0));
  if (
    select count(*) from public.audit_log as a
    where a.actor_id = caller
      and a.event = 'data_exported'
      and a.created_at > now() - interval '1 hour'
  ) >= max_per_hour then
    raise exception 'limite de exportações por hora atingido'
      using errcode = 'program_limit_exceeded';
  end if;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'data_exported', caller);

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'display_name_enc', p.display_name_enc,
        'municipality_code', p.municipality_code,
        'municipality_name', m.name,
        'state_code', p.state_code,
        'district_code', p.district_code,
        'district_name', d.name,
        'neighborhood_enc', p.neighborhood_enc,
        'status', p.status,
        'access_status', p.access_status,
        'consent_version', p.consent_version,
        'consent_at', p.consent_at,
        'profile_completed_at', p.profile_completed_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      from public.profiles as p
      left join public.municipalities as m on m.code = p.municipality_code
      left join public.districts as d on d.code = p.district_code
      where p.id = caller
    ),
    'contact', (
      select jsonb_build_object(
        'whatsapp_enc', c.whatsapp_enc,
        'social_links_enc', c.social_links_enc,
        'updated_at', c.updated_at
      )
      from public.profile_contacts as c
      where c.profile_id = caller
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'member_role', um.member_role,
        'joined_at', um.joined_at,
        'left_at', um.left_at
      ) order by um.joined_at, um.id)
      from public.unit_members as um
      join public.units as u on u.id = um.unit_id
      join public.unit_types as t on t.id = u.type_id
      where um.profile_id = caller
    ), '[]'::jsonb),
    'house_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'house_key', h.house_key,
        'join_method', h.join_method,
        'consent_version', h.consent_version,
        'joined_at', h.joined_at,
        'accepted_at', h.accepted_at,
        'left_at', h.left_at
      ) order by h.joined_at, h.id)
      from public.house_members as h
      where h.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'term_version', q.term_version,
        'consented_at', q.consented_at
      ) order by q.consented_at, q.term_version)
      from public.questionnaire_consents as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'consent_acceptances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', c.version,
        'accepted_at', c.accepted_at
      ) order by c.accepted_at, c.version)
      from public.consent_acceptances as c
      where c.user_id = caller
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.role,
        'unit_name', u.name,
        'unit_type', t.label,
        'house_key', r.house_key,
        'granted_at', r.granted_at,
        'revoked_at', r.revoked_at
      ) order by r.granted_at, r.id)
      from public.role_assignments as r
      join public.units as u on u.id = r.unit_id
      join public.unit_types as t on t.id = u.type_id
      where r.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_result', (
      select jsonb_build_object(
        'house_key', r.house_key,
        'totem_enc', r.totem_enc,
        'totem_state', r.totem_state,
        'scores_enc', r.scores_enc,
        'answers_enc', r.answers_enc,
        'term_version', r.term_version,
        'source', r.source,
        'created_at', r.created_at
      )
      from public.questionnaire_results as r
      where r.profile_id = caller
    ),
    'house_analysis_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', q.status,
        'resolution', q.resolution,
        'term_version', q.term_version,
        'kind', q.kind,
        'tied_axes', q.tied_axes,
        'answers_enc', q.answers_enc,
        'created_at', q.created_at,
        'resolved_at', q.resolved_at
      ) order by q.created_at, q.id)
      from public.house_analysis_requests as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_access_grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'granted_at', g.granted_at,
        'revoked_at', g.revoked_at
      ) order by g.granted_at, g.id)
      from public.questionnaire_data_grants as g
      join public.units as u on u.id = g.unit_id
      join public.unit_types as t on t.id = u.type_id
      where g.grantee_id = caller
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'category', s.category) order by s.name)
      from public.profile_skills as ps
      join public.skills as s on s.id = ps.skill_id
      where ps.profile_id = caller
    ), '[]'::jsonb),
    'skill_suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', q.name,
        'status', q.status,
        'created_at', q.created_at,
        'decided_at', q.decided_at
      ) order by q.created_at, q.id)
      from public.skill_suggestions as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', a.event,
        'reason', a.reason,
        'term_version', a.term_version,
        'house_key', a.house_key,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      where a.target_id = caller
         or (a.actor_id = caller and a.event in ('house_accepted', 'questionnaire_consented', 'consent_accepted'))
    ), '[]'::jsonb),
    'contact_views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'viewer_id', a.actor_id,
        'viewer_name_enc', p.display_name_enc,
        'kind', a.reason,
        'viewed_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      left join public.profiles as p on p.id = a.actor_id
      where a.target_id = caller
        and a.event = 'contact_viewed'
    ), '[]'::jsonb)
  );
end;
$$;
