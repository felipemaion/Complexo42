-- Perfil incompleto (ADR 0017, base do "casa antes de tudo").
--
-- A casa passa a vir ANTES do perfil, e `house_members`, `questionnaire_results` e afins referenciam `profiles`.
-- Por isso a linha de `profiles` nasce no primeiro login de quem tem acesso liberado (lista de autorizados),
-- ainda sem nome, município, UF nem versão do termo. Esses campos só podem ser nulos enquanto
-- `profile_completed_at` é nulo (CHECK); `save_own_profile` preenche e marca o perfil como completo, e ninguém
-- volta a incompleto (trigger). Quem NÃO está na lista não ganha linha: segue o caminho de hoje (perfil, depois
-- espera). Os perfis que já existem são todos completos.

alter table public.profiles
  add column profile_completed_at timestamptz,
  alter column display_name_enc drop not null,
  alter column municipality_code drop not null,
  alter column state_code drop not null,
  alter column consent_version drop not null;

comment on column public.profiles.profile_completed_at is
  'Quando o perfil foi completado (nome, município, UF e termo). Nulo = perfil incompleto, criado no primeiro login (ADR 0017). Só save_own_profile define; nunca volta a nulo.';

update public.profiles set profile_completed_at = created_at;

alter table public.profiles
  add constraint profiles_complete_has_fields check (
    profile_completed_at is null
    or (display_name_enc is not null and municipality_code is not null and state_code is not null and consent_version is not null)
  );

create or replace function app.tg_profiles_completed_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.profile_completed_at is not null and new.profile_completed_at is distinct from old.profile_completed_at then
    raise exception 'perfil completo não volta a incompleto' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_profiles_completed_once() from public, anon, authenticated;

create trigger profiles_completed_once
  before update on public.profiles
  for each row execute function app.tg_profiles_completed_once();

create or replace function app.tg_profiles_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Perfil incompleto (ADR 0017): sem município, sem UF.
  if new.municipality_code is null then
    new.state_code := null;
  else
    select m.state_code into new.state_code
    from public.municipalities as m
    where m.code = new.municipality_code;

    if new.state_code is null then
      raise exception 'município desconhecido'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.consent_at := now();
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.consent_at := case
      when new.consent_version is distinct from old.consent_version then now()
      else old.consent_at
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.resolve_access(p_email_hmac text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_status text;
  decided text;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_email_hmac is null or p_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava a linha: duas chamadas simultâneas não decidem duas vezes.
  select p.access_status into current_status
  from public.profiles as p
  where p.id = caller
  for update;

  if not found then
    -- Sem perfil: quem está na lista ganha a linha incompleta já liberada (ADR 0017); quem não está segue sem
    -- linha (caminho de hoje: preenche o perfil e então vai para a espera).
    if exists (select 1 from public.access_allowlist as a where a.email_hmac = p_email_hmac) then
      insert into public.profiles (id, status, access_status) values (caller, 'active', 'active')
      on conflict (id) do nothing;
      return 'active';
    end if;
    return null;
  end if;

  if current_status <> 'pending' then
    return current_status;
  end if;

  decided := case
    when exists (select 1 from public.access_allowlist as a where a.email_hmac = p_email_hmac)
      then 'active'
    else 'waitlisted'
  end;

  update public.profiles
  set access_status = decided,
      status = case when decided = 'active' and status = 'pending' then 'active' else status end
  where id = caller;

  -- Na espera: guarda o HMAC para a próxima importação que o trouxer liberar a pessoa.
  if decided = 'waitlisted' then
    insert into public.access_waitlist_hmac (profile_id, email_hmac)
    values (caller, p_email_hmac)
    on conflict (profile_id) do update set email_hmac = excluded.email_hmac, created_at = now();
  end if;

  return decided;
end;
$$;

create or replace function public.save_own_profile(
  p_display_name_enc text,
  p_municipality_code integer,
  p_district_code integer,
  p_whatsapp_enc text,
  p_whatsapp_hmac text,
  p_social_links_enc text default null,
  p_neighborhood_enc text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  -- Até 5 salvamentos com WhatsApp repetido por pessoa, por hora (#127).
  max_duplicates constant integer := 5;
  duplicate_window constant interval := interval '1 hour';
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  -- Sem o aceite da versão vigente do termo, nada é gravado (#11).
  if not exists (
    select 1 from public.consent_acceptances as c
    where c.user_id = caller and c.version = app.current_consent_version()
  ) then
    raise exception 'consent_required' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_edit_profile(caller) then
    raise exception 'sem permissão para editar este perfil' using errcode = 'insufficient_privilege';
  end if;

  -- Formato antes de tocar as tabelas (os CHECKs das colunas repetem, como segunda barreira).
  if p_display_name_enc is null or not app.is_encrypted_value(p_display_name_enc, 512) then
    raise exception 'nome em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_whatsapp_enc is null or not app.is_encrypted_value(p_whatsapp_enc, 128) then
    raise exception 'WhatsApp em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_whatsapp_hmac is null or p_whatsapp_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_social_links_enc is not null and not app.is_encrypted_value(p_social_links_enc, 4096) then
    raise exception 'redes em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_neighborhood_enc is not null and not app.is_encrypted_value(p_neighborhood_enc, 512) then
    raise exception 'bairro em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_municipality_code is null then
    raise exception 'município obrigatório' using errcode = 'invalid_parameter_value';
  end if;
  -- O distrito tem de ser do município. Município com um distrito só (a sede) não tem escolha:
  -- o distrito fica nulo. A chave estrangeira composta do perfil repete a primeira regra.
  if p_district_code is not null then
    if not exists (
      select 1 from public.districts as d
      where d.code = p_district_code and d.municipality_code = p_municipality_code
    ) then
      raise exception 'district_mismatch' using errcode = 'PT422';
    end if;
    if (select count(*) from public.districts as d where d.municipality_code = p_municipality_code) < 2 then
      p_district_code := null;
    end if;
  end if;

  -- Uma chamada por vez por pessoa: várias em paralelo não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtextextended('save_own_profile:' || caller::text, 0));

  -- O limite vem antes de qualquer gravação e não consulta o índice único (#127).
  if (select count(*) from app.profile_save_attempts as a
      where a.profile_id = caller and a.attempted_at > now() - duplicate_window) >= max_duplicates then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;

  begin
    insert into public.profiles (id, display_name_enc, municipality_code, district_code, neighborhood_enc, consent_version, profile_completed_at)
    values (caller, p_display_name_enc, p_municipality_code, p_district_code, p_neighborhood_enc, app.current_consent_version(), now())
    on conflict (id) do update
      set display_name_enc = excluded.display_name_enc,
          municipality_code = excluded.municipality_code,
          district_code = excluded.district_code,
          neighborhood_enc = excluded.neighborhood_enc,
          -- Perfil incompleto (ADR 0017) é completado aqui; o já completo mantém o que tem.
          consent_version = coalesce(public.profiles.consent_version, excluded.consent_version),
          profile_completed_at = coalesce(public.profiles.profile_completed_at, now());

    insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac, social_links_enc)
    values (caller, p_whatsapp_enc, p_whatsapp_hmac, p_social_links_enc)
    on conflict (profile_id) do update
      set whatsapp_enc = excluded.whatsapp_enc,
          whatsapp_hmac = excluded.whatsapp_hmac,
          social_links_enc = excluded.social_links_enc;
  exception
    when unique_violation then
      -- O único índice único que o bloco pode violar é o de `whatsapp_hmac` (o de `profiles.id`
      -- e o de `profile_contacts.profile_id` caem no `on conflict`).
      -- O bloco desfez o perfil e o contato desta chamada. Fica só o registro da tentativa,
      -- sem o HMAC e sem dizer de quem é o número.
      insert into app.profile_save_attempts (profile_id) values (caller);
      delete from app.profile_save_attempts as a where a.attempted_at <= now() - duplicate_window;
      return 'duplicate_whatsapp';
  end;
  return 'saved';
end;
$$;

comment on function public.save_own_profile(text, integer, integer, text, text, text, text) is
  'Única escrita de perfil e contato pela API: só a própria linha, valores já cifrados pelo servidor. '
  'Completa o perfil incompleto criado no primeiro login (ADR 0017). '
  'Devolve saved ou duplicate_whatsapp; recusa com PT429 depois de 5 repetidos na hora (#127) e '
  'com PT422 se o distrito não é do município (#175).';

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
