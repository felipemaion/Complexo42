-- Últimas respostas do questionário, guardadas cifradas (ADR 0014, #256, decisão do Felipe): para usar na troca de casa.
-- `answers_enc` (AES-GCM, AAD `questionnaire_results.answers_enc.<profile_id>`) fica junto do resultado, coberto pela assinatura
-- HMAC do servidor, e é SEMPRE a última resposta válida (um novo resultado a substitui; um resultado decidido pela coordenação a
-- apaga). Sem grant de leitura: nem a própria pessoa, nem a coordenação, nem a API leem a coluna; só o servidor a recebe, pela
-- função definer da própria pessoa, e decifra. Some com a conta (cascata) e entra em "Baixar meus dados".

alter table public.questionnaire_results
  add column answers_enc text
    constraint questionnaire_results_answers_enc_format check (answers_enc is null or app.is_encrypted_value(answers_enc, 4096));

comment on column public.questionnaire_results.answers_enc is
  'Última resposta válida do questionário (JSON item → intensidade), cifrada pelo servidor (ADR 0003). Sem grant de leitura: só own_questionnaire_answers_enc() e o export a entregam ao servidor.';

-- Leitura por coluna: tudo o que a API já lia, MENOS answers_enc. Coluna nova no futuro precisa de grant explícito.
revoke select on public.questionnaire_results from authenticated;
do $$
begin
  execute format(
    'grant select (%s) on public.questionnaire_results to authenticated',
    (select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
     from information_schema.columns
     where table_schema = 'public' and table_name = 'questionnaire_results' and column_name <> 'answers_enc')
  );
end;
$$;

-- Um resultado novo que não traz respostas (ex.: decidido pela coordenação) apaga as antigas: nunca ficam respostas de um
-- resultado que já não vale.
create or replace function app.tg_questionnaire_results_answers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_at is distinct from old.created_at and new.answers_enc is not distinct from old.answers_enc then
    new.answers_enc := null;
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_questionnaire_results_answers() from public, anon, authenticated;

create trigger questionnaire_results_answers
  before update on public.questionnaire_results
  for each row execute function app.tg_questionnaire_results_answers();

-- A função de gravação ganha `p_answers_enc` (opcional; sem ele, a assinatura é a de antes).
drop function public.record_questionnaire_result(text, text, text, text, bigint, text);

create or replace function public.record_questionnaire_result(
  p_term_version text, p_house_key text, p_totem_enc text, p_scores_enc text, p_issued_at bigint, p_signature text,
  p_answers_enc text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.lock_active_caller();
begin
  perform app.verify_server_signature(
    format('result|%s|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_totem_enc, p_scores_enc, p_issued_at)
      || case when p_answers_enc is null then '' else '|' || p_answers_enc end,
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256)
     or p_scores_enc is null or not app.is_encrypted_value(p_scores_enc, 512) then
    raise exception 'totem ou notas inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_answers_enc is not null and not app.is_encrypted_value(p_answers_enc, 4096) then
    raise exception 'respostas em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.questionnaire_consents as c
    where c.profile_id = caller and c.term_version = p_term_version
  ) then
    raise exception 'o questionário exige o termo desta versão aceito' using errcode = 'invalid_parameter_value';
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, scores_enc, answers_enc, source)
  values (caller, p_term_version, p_house_key, p_totem_enc, p_scores_enc, p_answers_enc, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, scores_enc = excluded.scores_enc, answers_enc = excluded.answers_enc,
        source = excluded.source, created_at = now();

  perform app.close_open_analysis(caller, 'self');
end;
$$;

comment on function public.record_questionnaire_result(text, text, text, text, bigint, text, text) is
  'Grava a casa sugerida, o totem, as notas dos eixos e, se vierem, as respostas (cifrados) da pessoa da sessão, só com a assinatura do servidor do app, que cobre também as respostas (ADR 0014).';

revoke execute on function public.record_questionnaire_result(text, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.record_questionnaire_result(text, text, text, text, bigint, text, text) to authenticated;

-- As respostas cifradas da própria pessoa, para o servidor decifrar (nunca de outra pessoa).
create or replace function public.own_questionnaire_answers_enc()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.answers_enc from public.questionnaire_results as r where r.profile_id = (select auth.uid());
$$;

comment on function public.own_questionnaire_answers_enc() is
  'Respostas cifradas do questionário da pessoa da sessão (ou nulo). Só o servidor do app as decifra (ADR 0014).';

revoke execute on function public.own_questionnaire_answers_enc() from public, anon;
grant execute on function public.own_questionnaire_answers_enc() to authenticated;

-- "Baixar meus dados" traz as respostas cifradas (o servidor as decifra).
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
