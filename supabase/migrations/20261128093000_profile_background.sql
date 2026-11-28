-- Formação acadêmica e atividade profissional (issue #304).
--
-- 1. `public.profile_background` (1:1 com `profiles`, no molde de `profile_contacts`): nível de formação,
--    "qual?" e atividade profissional, tudo OPCIONAL e só cifrado (`*_enc`, ADR 0003; AAD
--    `profile_background.<coluna>.<profile_id>`). O banco só confere o formato cifrado e um teto de
--    tamanho; a lista fechada de níveis e os limites de texto são do Zod, no servidor. Sem busca nem
--    filtro por esses campos (se a #23 precisar filtrar por nível, rever a cifra de `education_level`).
-- 2. RLS (R5, R15): o dono lê e grava a própria linha (`app.can_edit_profile`); a coordenação do escopo
--    (monitor/gestor pelo território, ou coordenador da casa) lê a de membro `active`, por
--    `app.can_view_background`. Porta-voz, admin técnico e colegas não leem. Nada é apagado pela API: a
--    linha some com a conta (cascata).
-- 3. `export_own_data()` passa a trazer `background` (ainda cifrado; o servidor decifra). Definição
--    igual à de `..._profile_skills.sql`, mais a chave nova.

create table public.profile_background (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- Um de elementary, high_school, college_incomplete, college_complete, postgraduate (~20 caracteres): ~70 cifrado.
  education_level_enc text
    constraint profile_background_education_level_enc_format
    check (education_level_enc is null or app.is_encrypted_value(education_level_enc, 128)),
  -- Texto livre de até 80 caracteres (até ~320 bytes em UTF-8): ~480 cifrado.
  education_detail_enc text
    constraint profile_background_education_detail_enc_format
    check (education_detail_enc is null or app.is_encrypted_value(education_detail_enc, 640)),
  occupation_enc text
    constraint profile_background_occupation_enc_format
    check (occupation_enc is null or app.is_encrypted_value(occupation_enc, 640)),
  updated_at timestamptz not null default now()
);

comment on table public.profile_background is
  'Formação e atividade profissional (1:1 com profiles, #304), só cifradas e opcionais. Vistas pelo dono e pela coordenação do escopo.';

alter table public.profile_background enable row level security;

create trigger profile_background_set_updated_at
  before insert or update on public.profile_background
  for each row execute function app.tg_set_updated_at();

-- Quem lê: o próprio, ou a coordenação do escopo de um membro ativo (monitor/gestor pelo
-- território da equipe, ou o coordenador da casa; as mesmas ramas do contato, sem a escolha de
-- colegas: formação e atividade não são "contato").
create or replace function app.can_view_background(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target is not null
    and (
      target = (select auth.uid())
      or (
        app.is_active_member()
        and app.is_active_profile(target)
        and (
          exists (
            select 1
            from public.unit_members as m
            join public.units as u on u.id = m.unit_id
            where m.profile_id = target
              and m.left_at is null
              and app.has_scope_over(u.path, array['monitor', 'manager'])
          )
          or app.is_house_coordinator_of((select auth.uid()), target)
        )
      )
    );
$$;

comment on function app.can_view_background(uuid) is
  'Pode ler a formação e a atividade de `target`? Titular ou coordenação do escopo (#304).';

revoke execute on function app.can_view_background(uuid) from public, anon;
grant execute on function app.can_view_background(uuid) to authenticated;

revoke all on public.profile_background from anon, authenticated;
grant select on public.profile_background to authenticated;
grant insert (profile_id, education_level_enc, education_detail_enc, occupation_enc)
  on public.profile_background to authenticated;
-- `profile_id` entra no UPDATE porque o `upsert` do PostgREST faz `ON CONFLICT DO UPDATE SET profile_id = ...`.
-- Não abre nada: a política exige `app.can_edit_profile(profile_id)` antes e depois, então a linha nunca
-- aponta para outra pessoa.
grant update (profile_id, education_level_enc, education_detail_enc, occupation_enc)
  on public.profile_background to authenticated;

create policy profile_background_select on public.profile_background
  for select to authenticated
  using (app.can_view_background(profile_id));

create policy profile_background_insert on public.profile_background
  for insert to authenticated
  with check (app.can_edit_profile(profile_id));

create policy profile_background_update on public.profile_background
  for update to authenticated
  using (app.can_edit_profile(profile_id))
  with check (app.can_edit_profile(profile_id));

-- ---------------------------------------------------------------------------------------
-- export_own_data
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
    'background', (
      select jsonb_build_object(
        'education_level_enc', b.education_level_enc,
        'education_detail_enc', b.education_detail_enc,
        'occupation_enc', b.occupation_enc,
        'updated_at', b.updated_at
      )
      from public.profile_background as b
      where b.profile_id = caller
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
