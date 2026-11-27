-- Escala de intensidade no questionário (issue #183, ADR 0014).
--
-- Cada resposta passa a ser uma intensidade em {-3, -2, -1, 1, 2, 3} (negativo = polo "a"); a nota
-- de cada eixo é a média normalizada para -100..100. As 4 notas ficam CIFRADAS (ADR 0003) junto do
-- resultado: `questionnaire_results.scores_enc`, AAD `questionnaire_results.scores_enc.<profile_id>`.
-- O banco não decifra: a assinatura do servidor cobre o valor cifrado, como o totem.
--
-- 1. `scores_enc` (nulo só nos resultados antigos, de antes da escala).
-- 2. Pedidos abertos com respostas na escala antiga (a, b, both) não servem mais: são fechados como
--    expirados e a pessoa refaz o questionário.
-- 3. `record_questionnaire_result` e `resolve_house_analysis` recebem `p_scores_enc` (assinado).
-- 4. `export_own_data` devolve `scores_enc` (o servidor decifra).

alter table public.questionnaire_results
  add column scores_enc text
    constraint questionnaire_results_scores_enc_format check (scores_enc is null or app.is_encrypted_value(scores_enc, 512));

comment on column public.questionnaire_results.scores_enc is
  'Notas dos 4 eixos (-100..100) como JSON cifrado pelo servidor (ADR 0003). Nulo só em resultado antigo.';

update public.house_analysis_requests
set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'expired'
where status = 'open';

drop function public.record_questionnaire_result(text, text, text, bigint, text);
drop function public.resolve_house_analysis(uuid, text, text, bigint, text);

-- Resultado conclusivo, calculado, cifrado e assinado pelo servidor do app para a pessoa da sessão.
-- `p_totem_enc` é o totem cifrado (AAD `questionnaire_results.totem_enc.<profile_id>`).
create or replace function public.record_questionnaire_result(
  p_term_version text, p_house_key text, p_totem_enc text, p_scores_enc text, p_issued_at bigint, p_signature text
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
    format('result|%s|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_totem_enc, p_scores_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256)
     or p_scores_enc is null or not app.is_encrypted_value(p_scores_enc, 512) then
    raise exception 'totem ou notas inválidos' using errcode = 'invalid_parameter_value';
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

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, scores_enc, source)
  values (caller, p_term_version, p_house_key, p_totem_enc, p_scores_enc, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, scores_enc = excluded.scores_enc, source = excluded.source, created_at = now();

  perform app.close_open_analysis(caller, 'self');
end;
$$;

comment on function public.record_questionnaire_result(text, text, text, text, bigint, text) is
  'Grava a casa sugerida, o totem e as notas dos eixos (cifrados) da pessoa da sessão, só com a assinatura do servidor do app (ADR 0014).';


create or replace function public.resolve_house_analysis(
  p_request_id uuid, p_house_key text, p_totem_enc text, p_scores_enc text, p_issued_at bigint, p_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  is_national boolean;
  person uuid;
  version text;
begin
  is_national := caller is not null and app.manages_root();
  if caller is null or not (is_national or app.holds_questionnaire_grant()) then
    raise exception 'só a coordenação nacional ou quem ela delegou resolve pedidos de análise' using errcode = 'insufficient_privilege';
  end if;
  -- O servidor do app cifra o totem e assina a resolução (pedido, casa, totem cifrado): sem isso,
  -- quem resolve, pela API direta, gravaria qualquer valor com o formato de cifrado.
  perform app.verify_server_signature(
    format('resolve|%s|%s|%s|%s|%s|%s', caller, p_request_id, p_house_key, p_totem_enc, p_scores_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256)
     or p_scores_enc is null or not app.is_encrypted_value(p_scores_enc, 512) then
    raise exception 'totem ou notas inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  select q.profile_id into person
  from public.house_analysis_requests as q
  where q.id = p_request_id and q.status = 'open';
  if person is null then
    raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
  end if;
  if person = caller then
    raise exception 'ninguém resolve o próprio pedido' using errcode = 'insufficient_privilege';
  end if;
  -- Delegado: o escopo vem ANTES de travar o perfil e de olhar se está ativo. Fora do escopo (ou de
  -- pessoa que ele nem lê, como a inativa), o pedido é inexistente: nada vaza e nada é travado.
  if not is_national then
    if not app.has_questionnaire_delegation_over(person) then
      raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
    end if;
    if not app.delegate_may_resolve_for(person) then
      raise exception 'este pedido é da coordenação nacional (a pessoa é gestora na unidade da concessão ou acima)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- Trava o perfil antes do pedido, na mesma ordem de app.lock_active_caller (a pessoa refazendo o
  -- questionário não corre com a resolução), e só resolve para quem está ativo.
  perform 1 from public.profiles as p where p.id = person for update;
  if not app.is_active_profile(person) then
    raise exception 'só pedidos de quem está ativo' using errcode = 'insufficient_privilege';
  end if;
  select q.term_version into version
  from public.house_analysis_requests as q
  where q.id = p_request_id and q.status = 'open'
  for update;
  if version is null then
    raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
  end if;

  update public.house_analysis_requests
  set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'coordination', resolved_by = caller
  where id = p_request_id;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, scores_enc, source)
  values (person, version, p_house_key, p_totem_enc, p_scores_enc, 'analysis')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, scores_enc = excluded.scores_enc, source = excluded.source, created_at = now();

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'house_analysis_resolved', person);
end;
$$;

comment on function public.resolve_house_analysis(uuid, text, text, text, bigint, text) is
  'Resolve o pedido, assinado pelo servidor do app: grava a casa, o totem e as notas (cifrados pelo servidor), apaga as respostas e audita. Só a coordenação nacional ou um delegado com concessão sobre a pessoa; nunca o próprio pedido (ADR 0014).';

revoke execute on function public.record_questionnaire_result(text, text, text, text, bigint, text) from public, anon;
revoke execute on function public.resolve_house_analysis(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.record_questionnaire_result(text, text, text, text, bigint, text) to authenticated;
grant execute on function public.resolve_house_analysis(uuid, text, text, text, bigint, text) to authenticated;

-- "Baixar meus dados" (redefinida inteira; a anterior é a de 20261127100200_profile_district_code.sql).
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
