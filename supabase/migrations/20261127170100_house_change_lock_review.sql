-- Revisão do #210 (ADR 0016).
-- 1. `coordination_set_house`: alcance só por `can_manage_house_member`; a delegação de leitura dos
--    resultados não vira poder de escrita. Trava o perfil da pessoa, como `accept_house`, para as
--    duas funções não correrem uma contra a outra.
-- 2. `accept_house`: lê o vínculo aberto com `for update`; se ainda assim a troca concorrente
--    atropelar (índice de um vínculo aberto), SQLSTATE próprio (`C7604`), não erro genérico.
-- 3. `locked_until` = 4 meses a partir do MAIS TARDE entre o aceite do termo do questionário e o
--    aceite da casa (sem termo, o aceite da casa): ninguém entra com a trava já vencida.
-- 4. `export_own_data` traz `locked_until` de cada vínculo (o histórico `house_changed` já vem em
--    `audit_events`, que lê as linhas em que a pessoa é o alvo).

create or replace function app.tg_house_members_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_at is not null and new.locked_until is null then
    new.locked_until := greatest(
      coalesce((select min(c.consented_at) from public.questionnaire_consents as c where c.profile_id = new.profile_id), new.accepted_at),
      new.accepted_at
    ) + app.house_lock_interval();
  end if;
  return new;
end;
$$;

create or replace function public.accept_house(p_house_key text, p_join_method text, p_term_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  consent_ver text;
  open_id uuid;
  open_house text;
  open_accepted timestamptz;
  open_locked timestamptz;
  new_id uuid;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_active_member() then
    raise exception 'só quem está ativo escolhe a casa' using errcode = 'insufficient_privilege';
  end if;

  if p_join_method is null or p_join_method not in ('self', 'questionnaire') then
    raise exception 'forma de entrada inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_join_method = 'questionnaire' then
    if not exists (
      select 1 from public.questionnaire_consents as c
      where c.profile_id = caller and c.term_version = p_term_version
    ) then
      raise exception 'o questionário exige o termo desta versão aceito'
        using errcode = 'invalid_parameter_value';
    end if;
    consent_ver := p_term_version;
  end if;

  select h.id, h.house_key, h.accepted_at, h.locked_until
  into open_id, open_house, open_accepted, open_locked
  from public.house_members as h
  where h.profile_id = caller and h.left_at is null
  for update;

  if open_accepted is not null then
    if open_house is not distinct from p_house_key then
      return open_id;
    end if;
    if now() < open_locked then
      raise exception 'a casa só pode ser trocada pela própria pessoa depois de %',
        to_char(open_locked at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
        using errcode = 'C7603', hint = to_char(open_locked at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.house_members as h
    where h.profile_id = caller
      and h.left_at is not null
      and not h.moved
      and h.ended_by is distinct from caller
  ) then
    raise exception 'a coordenação encerrou a sua casa; a volta é com ela' using errcode = 'C7602';
  end if;

  begin
    if open_id is not null then
      update public.house_members set left_at = now(), moved = (open_accepted is not null) where id = open_id;
    end if;

    insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version, locked_until)
    values (
      caller, p_house_key, p_join_method, now(), consent_ver,
      case when open_accepted is not null then now() + app.house_lock_interval() end
    )
    returning id into new_id;
  exception when unique_violation then
    raise exception 'a casa mudou enquanto a troca era feita; tente de novo' using errcode = 'C7604';
  end;

  if open_accepted is not null then
    insert into public.audit_log (actor_id, event, target_id, reason, house_key)
    values (caller, 'house_changed', caller, 'self', p_house_key);
  else
    insert into public.audit_log (actor_id, event, target_id, reason, term_version, house_key)
    values (caller, 'house_accepted', caller, p_join_method, consent_ver, p_house_key);
  end if;
  return new_id;
end;
$$;

create or replace function public.coordination_set_house(p_profile uuid, p_house_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  open_id uuid;
  open_house text;
  open_locked timestamptz;
  new_id uuid;
begin
  if caller is null or not app.is_active_member() or p_profile is null or p_profile = caller then
    raise exception 'sem alcance sobre esta pessoa' using errcode = 'insufficient_privilege';
  end if;

  -- O mesmo trinco de accept_house: as duas funções não correm uma contra a outra.
  perform 1 from public.profiles as p where p.id = p_profile for update;

  select h.id, h.house_key, h.locked_until into open_id, open_house, open_locked
  from public.house_members as h
  where h.profile_id = p_profile and h.left_at is null and h.accepted_at is not null
  for update;

  -- Só gestão de quem pode gerir o vínculo (unidade ou coordenação da casa): ler os resultados por
  -- delegação não dá poder de trocar a casa.
  if open_id is null or not app.can_manage_house_member(p_profile, open_house) then
    raise exception 'sem alcance sobre esta pessoa' using errcode = 'insufficient_privilege';
  end if;

  if open_house is not distinct from p_house_key then
    return open_id;
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  update public.house_members set left_at = now(), moved = true where id = open_id;
  insert into public.house_members (profile_id, house_key, join_method, accepted_at, locked_until)
  values (p_profile, p_house_key, 'self', now(), open_locked)
  returning id into new_id;

  insert into public.audit_log (actor_id, event, target_id, reason, house_key)
  values (caller, 'house_changed', p_profile, 'coordination', p_house_key);
  return new_id;
end;
$$;

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
        'left_at', h.left_at,
        'locked_until', h.locked_until
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
