-- Aceite do termo de consentimento (issue #11, docs/TERMO_CONSENTIMENTO.md).
--
-- 1. `public.consent_acceptances`: a prova do aceite, uma linha por pessoa e versão, ligada à
--    conta (`auth.users`, apagada junto com ela). Existe antes do perfil, então quem ainda não
--    tem perfil também aceita. Só leitura da própria pessoa pela API; quem grava é `accept_consent`.
-- 2. `app.current_consent_version()`: a versão vigente do termo. Fica no banco, definida por
--    migration: versão nova = `create or replace` desta função + texto novo em config/consent.ts
--    (um teste confere que os dois batem). `accept_consent` só aceita a vigente.
-- 3. `public.accept_consent(p_version)`: grava o aceite de quem chama, com auditoria
--    (`consent_accepted`). `profiles.consent_version` e `consent_at` espelham o último aceite de
--    quem já tem perfil.
-- 4. `save_own_profile` recusa (42501) quem não aceitou a versão vigente e grava o perfil já com ela.
-- 5. `export_own_data` inclui os aceites. A exclusão da conta os apaga em cascata.

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted'
));

alter table public.audit_log drop constraint audit_log_term_version_by_event;
alter table public.audit_log add constraint audit_log_term_version_by_event check (
  case
    when event in ('questionnaire_consented', 'consent_accepted') then term_version is not null
    when event = 'house_accepted' then (term_version is not null) = (reason = 'questionnaire')
    else term_version is null
  end
);

create table public.consent_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,32}$' and version <> 'none'),
  accepted_at timestamptz not null default now(),
  constraint consent_acceptances_pkey primary key (user_id, version)
);

comment on table public.consent_acceptances is
  'Aceite do termo de consentimento (#11): a versão e a data, por pessoa. Só accept_consent grava.';

alter table public.consent_acceptances enable row level security;
revoke all on public.consent_acceptances from anon, authenticated;
grant select on public.consent_acceptances to authenticated;

create policy consent_acceptances_select_own on public.consent_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A versão vigente do termo. Versão nova: `create or replace` com o valor novo, na migration.
create or replace function app.current_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$ select 'v1'::text $$;

revoke execute on function app.current_consent_version() from public, anon;
grant execute on function app.current_consent_version() to authenticated;

create function public.accept_consent(p_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  inserted integer;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_edit_profile(caller) then
    raise exception 'sem permissão para aceitar o termo' using errcode = 'insufficient_privilege';
  end if;
  -- Só a versão vigente: ninguém pré-aceita um termo futuro nem um antigo.
  if p_version is distinct from app.current_consent_version() then
    raise exception 'versão do termo inválida' using errcode = 'invalid_parameter_value';
  end if;

  -- Uma chamada por vez por pessoa: dois aceites juntos não gravam dois eventos.
  perform pg_advisory_xact_lock(hashtextextended('accept_consent:' || caller::text, 0));

  insert into public.consent_acceptances (user_id, version)
  values (caller, p_version)
  on conflict (user_id, version) do nothing;
  get diagnostics inserted = row_count;

  if inserted > 0 then
    insert into public.audit_log (actor_id, event, term_version)
    values (caller, 'consent_accepted', p_version);
    -- Quem já tem perfil: o espelho avança (o trigger grava consent_at).
    update public.profiles set consent_version = p_version where id = caller;
  end if;
  return 'accepted';
end;
$$;

comment on function public.accept_consent(text) is
  'Aceite do termo (#11): só a versão vigente, de quem chama, com auditoria. Funciona sem perfil.';

revoke execute on function public.accept_consent(text) from public, anon;
grant execute on function public.accept_consent(text) to authenticated;

create or replace function public.save_own_profile(
  p_display_name_enc text,
  p_municipality_code integer,
  p_district text,
  p_whatsapp_enc text,
  p_whatsapp_hmac text,
  p_social_links_enc text default null
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
  if p_municipality_code is null then
    raise exception 'município obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  -- Uma chamada por vez por pessoa: várias em paralelo não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtextextended('save_own_profile:' || caller::text, 0));

  -- O limite vem antes de qualquer gravação e não consulta o índice único (#127).
  if (select count(*) from app.profile_save_attempts as a
      where a.profile_id = caller and a.attempted_at > now() - duplicate_window) >= max_duplicates then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;

  begin
    insert into public.profiles (id, display_name_enc, municipality_code, district, consent_version)
    values (caller, p_display_name_enc, p_municipality_code, p_district, app.current_consent_version())
    on conflict (id) do update
      set display_name_enc = excluded.display_name_enc,
          municipality_code = excluded.municipality_code,
          district = excluded.district;

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
        'district', p.district,
        'status', p.status,
        'access_status', p.access_status,
        'consent_version', p.consent_version,
        'consent_at', p.consent_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      from public.profiles as p
      left join public.municipalities as m on m.code = p.municipality_code
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
