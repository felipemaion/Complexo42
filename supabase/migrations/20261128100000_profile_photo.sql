-- Foto do perfil (issue #308, ADR 0006 revisão de 2026-11-28).
--
-- 1. `public.profile_photos` (1:1 com `profiles`): a miniatura do rosto (WebP 192 x 256, sem metadados), em
--    base64 e CIFRADA (`photo_enc`, ADR 0003; AAD `profile_photos.photo_enc.<profile_id>`). Mora no banco, e não
--    num bucket, porque o servidor de produção não roda o serviço `storage` (ADR 0009). O servidor converte e
--    descarta o original (módulo de perfis, conversão da imagem); o banco só confere o formato cifrado e
--    um teto de tamanho (a miniatura tem até ~40 KB; 64 K caracteres com folga para o envelope).
-- 2. Só `public.save_own_photo(p_photo_enc)` grava: confere `app.can_edit_profile` (a própria pessoa, não
--    bloqueada) e o formato. A API não tem INSERT nem UPDATE na tabela. O limite de 10 envios por hora por
--    pessoa é de `public.reserve_photo_upload()` (`PT429`, contador em `app.photo_upload_attempts`, sem dado
--    da imagem): o servidor a chama ANTES de converter a imagem, então até a foto pesada ou inválida (que
--    gasta CPU no sharp e nunca chega a `save_own_photo`) consome a cota.
-- 3. RLS (R5, R15): a própria pessoa lê e APAGA a sua; todo membro ativo (casa aceita) lê a de perfil ativo,
--    por `app.can_view_photo`. Quem está na espera, sem casa ou bloqueado lê só a própria. A leitura sai
--    pela rota `/foto/<id>` do servidor, com o JWT de quem pede (R14); nunca por URL pública.
-- 4. `export_own_data()` passa a trazer `profile_photo` (ainda cifrada; o servidor decifra). Definição igual
--    à de `..._profile_background.sql`, mais a chave nova.

create table public.profile_photos (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  photo_enc text not null
    constraint profile_photos_photo_enc_format
    check (app.is_encrypted_value(photo_enc, 65536)),
  updated_at timestamptz not null default now()
);

comment on table public.profile_photos is
  'Miniatura do rosto (1:1 com profiles, #308), cifrada. Só save_own_photo grava; leitura só por membros ativos, pela rota do servidor.';

alter table public.profile_photos enable row level security;

create trigger profile_photos_set_updated_at
  before insert or update on public.profile_photos
  for each row execute function app.tg_set_updated_at();

create table app.photo_upload_attempts (
  profile_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

comment on table app.photo_upload_attempts is
  'Envios de foto por pessoa e hora, para o limite de 10 por hora (#308). Nada da imagem. Só save_own_photo usa.';

create index photo_upload_attempts_profile_idx on app.photo_upload_attempts (profile_id, attempted_at);

alter table app.photo_upload_attempts enable row level security;
revoke all on app.photo_upload_attempts from public, anon, authenticated, service_role;
create policy photo_upload_attempts_no_api_access on app.photo_upload_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

-- Quem lê: o próprio, ou membro ativo (casa aceita) vendo um perfil ativo.
create or replace function app.can_view_photo(target uuid)
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
      or (app.is_active_member() and app.is_active_profile(target))
    );
$$;

comment on function app.can_view_photo(uuid) is
  'Pode ler a foto de `target`? A própria pessoa, ou membro ativo vendo perfil ativo (#308).';

revoke execute on function app.can_view_photo(uuid) from public, anon;
grant execute on function app.can_view_photo(uuid) to authenticated;

revoke all on public.profile_photos from anon, authenticated;
grant select, delete on public.profile_photos to authenticated;

create policy profile_photos_select on public.profile_photos
  for select to authenticated
  using (app.can_view_photo(profile_id));

-- Só a própria pessoa apaga a sua (ninguém apaga a de outra).
create policy profile_photos_delete on public.profile_photos
  for delete to authenticated
  using (profile_id = (select auth.uid()) and app.can_edit_profile(profile_id));

-- Reserva um envio ANTES de converter a imagem: confere a permissão e o limite de 10 por hora por pessoa e
-- registra a tentativa (PT429 com 10 na última hora). O lock evita que envios simultâneos passem do teto.
create or replace function public.reserve_photo_upload()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_per_hour constant integer := 10;
begin
  if caller is null or not app.can_edit_profile(caller) then
    raise exception 'sem permissão para enviar a foto' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reserve_photo_upload:' || caller::text, 0));
  if (
    select count(*) from app.photo_upload_attempts as a
    where a.profile_id = caller and a.attempted_at > now() - interval '1 hour'
  ) >= max_per_hour then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;
  insert into app.photo_upload_attempts (profile_id) values (caller);
  -- Limpeza oportunista das tentativas com mais de uma hora (de todos).
  delete from app.photo_upload_attempts where attempted_at < now() - interval '1 hour';
end;
$$;

comment on function public.reserve_photo_upload() is
  'Reserva um envio de foto (#308): confere permissão e o limite de 10 por hora (PT429) e registra a tentativa. O servidor chama antes de converter a imagem.';

revoke execute on function public.reserve_photo_upload() from public, anon;
grant execute on function public.reserve_photo_upload() to authenticated;

create or replace function public.save_own_photo(p_photo_enc text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not app.can_edit_profile(caller) then
    raise exception 'sem permissão para gravar a foto' using errcode = 'insufficient_privilege';
  end if;
  if p_photo_enc is null or not app.is_encrypted_value(p_photo_enc, 65536) then
    raise exception 'foto cifrada inválida' using errcode = 'check_violation';
  end if;

  insert into public.profile_photos (profile_id, photo_enc)
  values (caller, p_photo_enc)
  on conflict (profile_id) do update set photo_enc = excluded.photo_enc;
end;
$$;

comment on function public.save_own_photo(text) is
  'Grava (ou troca) a miniatura cifrada da própria pessoa (#308): confere permissão e formato. O limite de envios é de reserve_photo_upload().';

revoke execute on function public.save_own_photo(text) from public, anon;
grant execute on function public.save_own_photo(text) to authenticated;

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
    'profile_photo', (
      select jsonb_build_object('photo_enc', f.photo_enc, 'updated_at', f.updated_at)
      from public.profile_photos as f
      where f.profile_id = caller
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
