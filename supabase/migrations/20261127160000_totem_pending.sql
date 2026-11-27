-- Empate só no totem não trava a casa (issue #197, ADR 0014 §1 e §3).
--
-- Se os eixos 1 e 2 definem a casa, a casa sai na hora; se só os eixos 3 ou 4 empatam, o totem
-- fica pendente e a coordenação decide só o totem.
--
-- 1. `questionnaire_results.totem_enc` passa a aceitar nulo (totem pendente).
-- 2. `house_analysis_requests.kind`: 'full' (casa e totem) ou 'totem' (só o totem; os eixos
--    empatados são só os do totem).
-- 3. `record_totem_pending`: o servidor registra, numa chamada só, a casa com o totem nulo e o pedido
--    de totem. A assinatura cobre o tipo (prefixo `totem_pending`), a casa, as notas, os eixos e as
--    respostas cifradas. Sem o limite de 1 hora: a casa já é conclusiva, e o pedido é um só por pessoa.
-- 4. `request_house_analysis` (pedido completo) grava `kind = 'full'`.
-- 5. `resolve_house_analysis`: em pedido de totem, a casa tem de ser a do resultado (a coordenação decide
--    só o totem).
-- 6. Aceitar a casa fecha só o pedido da casa ('full'); o de totem segue aberto.
-- 7. Prazo e limites (revisão do #198): `opened_at` é a primeira abertura do pedido e nunca muda; o prazo de
--    30 dias conta dele (renovar não estende a guarda das respostas). `created_at` segue sendo o último envio
--    e serve só ao limite, que agora é por tipo: pedido completo, 1 hora entre envios completos; totem
--    pendente, 10 segundos entre envios de totem. Um tipo não segura o outro.
-- 8. `questionnaire_results.totem_state` (`decided`, `pending`, `undecided`): o totem nulo nunca fica órfão.
--    Se o pedido de totem vence ou a pessoa é bloqueada, o resultado vira `undecided` ("totem não decidido"),
--    explícito na tela da coordenação e no "Baixar meus dados".

alter table public.questionnaire_results alter column totem_enc drop not null;
alter table public.questionnaire_results drop constraint questionnaire_results_totem_enc_format;
alter table public.questionnaire_results
  add constraint questionnaire_results_totem_enc_format check (totem_enc is null or app.is_encrypted_value(totem_enc, 256));

alter table public.questionnaire_results
  add column totem_state text not null default 'decided'
    constraint questionnaire_results_totem_state_check check (totem_state in ('decided', 'pending', 'undecided')),
  add constraint questionnaire_results_totem_state_matches check ((totem_state = 'decided') = (totem_enc is not null));

comment on column public.questionnaire_results.totem_state is
  'decided: totem gravado. pending: o pedido de totem está aberto. undecided: o pedido venceu ou foi encerrado sem decisão (ADR 0014).';

-- Totem gravado (função de resultado ou resolução) é sempre "decided", sem cada função precisar lembrar.
create or replace function app.tg_questionnaire_results_totem_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.totem_enc is not null then
    new.totem_state := 'decided';
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_questionnaire_results_totem_state() from public, anon, authenticated;

create trigger questionnaire_results_totem_state
  before insert or update on public.questionnaire_results
  for each row execute function app.tg_questionnaire_results_totem_state();

comment on column public.questionnaire_results.totem_enc is
  'Totem cifrado pelo servidor (ADR 0003). Nulo enquanto pendente: o empate nos eixos do totem espera a coordenação (ADR 0014).';

alter table public.house_analysis_requests
  add column opened_at timestamptz not null default now(),
  add column kind text not null default 'full'
    constraint house_analysis_requests_kind_check check (kind in ('full', 'totem')),
  add constraint house_analysis_requests_totem_axes
    check (kind = 'full' or tied_axes <@ array['totem1', 'totem2']);

update public.house_analysis_requests set opened_at = created_at;

comment on column public.house_analysis_requests.opened_at is
  'Primeira abertura do pedido; nunca muda. O prazo de 30 dias conta daqui; created_at é o último envio (limite de renovação).';

-- O pedido vencido some da leitura pela primeira abertura (não pelo último envio).
drop policy house_analysis_requests_select on public.house_analysis_requests;
create policy house_analysis_requests_select on public.house_analysis_requests
  for select to authenticated
  using (
    app.can_read_questionnaire_data(profile_id)
    and (status = 'resolved' or opened_at > now() - app.analysis_max_age())
  );

-- Fecha o pedido aberto sem as respostas; pedido de totem encerrado sem decisão deixa o totem "não decidido".
create or replace function app.close_open_analysis(person uuid, how text)
returns void
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.house_analysis_requests
    set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = how
    where profile_id = person and status = 'open'
    returning profile_id, kind
  )
  update public.questionnaire_results as r
  set totem_state = 'undecided'
  from closed as c
  where r.profile_id = c.profile_id and c.kind = 'totem' and how in ('inactive', 'expired') and r.totem_enc is null;
$$;

create or replace function app.purge_expired_analysis()
returns void
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.house_analysis_requests
    set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'expired'
    where status = 'open' and opened_at <= now() - app.analysis_max_age()
    returning profile_id, kind
  )
  update public.questionnaire_results as r
  set totem_state = 'undecided'
  from expired as e
  where r.profile_id = e.profile_id and e.kind = 'totem' and r.totem_enc is null;
$$;

comment on column public.house_analysis_requests.kind is
  'full: a coordenação decide casa e totem. totem: a casa já saiu pelos eixos 1 e 2; falta só o totem.';

-- Pedido completo (resultado inconclusivo): igual ao anterior, mas grava o tipo 'full'.
create or replace function public.request_house_analysis(
  p_term_version text, p_tied_axes text[], p_answers_enc text, p_issued_at bigint, p_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.lock_active_caller();
  request_id uuid;
  open_since timestamptz;
begin
  perform app.verify_server_signature(
    format('analysis|%s|%s|%s|%s|%s', caller, p_term_version, array_to_string(p_tied_axes, ','), p_answers_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_tied_axes is null or cardinality(p_tied_axes) not between 1 and 4
     or not (p_tied_axes <@ array['house1', 'house2', 'totem1', 'totem2'])
     or cardinality(p_tied_axes) <> (select count(distinct axis) from unnest(p_tied_axes) as axis) then
    raise exception 'eixos inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_answers_enc is null or not app.is_encrypted_value(p_answers_enc, 8192) then
    raise exception 'respostas inválidas' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.questionnaire_consents as c
    where c.profile_id = caller and c.term_version = p_term_version
  ) then
    raise exception 'o questionário exige o termo desta versão aceito' using errcode = 'invalid_parameter_value';
  end if;

  select q.created_at into open_since
  from public.house_analysis_requests as q where q.profile_id = caller and q.status = 'open' and q.kind = 'full';
  if open_since is not null and open_since > now() - interval '1 hour' then
    raise exception 'pedido renovado há pouco; tente mais tarde' using errcode = 'program_limit_exceeded';
  end if;

  update public.house_analysis_requests
  set term_version = p_term_version, kind = 'full', tied_axes = p_tied_axes, answers_enc = p_answers_enc, created_at = now()
  where profile_id = caller and status = 'open'
  returning id into request_id;

  if request_id is null then
    insert into public.house_analysis_requests (profile_id, term_version, kind, tied_axes, answers_enc)
    values (caller, p_term_version, 'full', p_tied_axes, p_answers_enc)
    returning id into request_id;
    insert into public.audit_log (actor_id, event, target_id)
    values (caller, 'house_analysis_requested', caller);
  end if;

  -- Um resultado anterior deixa de valer: o último questionário foi inconclusivo.
  delete from public.questionnaire_results where profile_id = caller;
  return request_id;
end;
$$;

-- Totem pendente: a casa saiu pelos eixos 1 e 2; só o totem espera a coordenação. O servidor do app
-- pontua, cifra as notas e as respostas e assina (prefixo `totem_pending`, que distingue o tipo).
create or replace function public.record_totem_pending(
  p_term_version text, p_house_key text, p_scores_enc text, p_tied_axes text[], p_answers_enc text,
  p_issued_at bigint, p_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.lock_active_caller();
  request_id uuid;
  open_since timestamptz;
begin
  perform app.verify_server_signature(
    format('totem_pending|%s|%s|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_scores_enc,
           array_to_string(p_tied_axes, ','), p_answers_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_tied_axes is null or cardinality(p_tied_axes) not between 1 and 2
     or not (p_tied_axes <@ array['totem1', 'totem2'])
     or cardinality(p_tied_axes) <> (select count(distinct axis) from unnest(p_tied_axes) as axis) then
    raise exception 'eixos inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_scores_enc is null or not app.is_encrypted_value(p_scores_enc, 512)
     or p_answers_enc is null or not app.is_encrypted_value(p_answers_enc, 8192) then
    raise exception 'notas ou respostas inválidas' using errcode = 'invalid_parameter_value';
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

  -- Limite curto, só entre envios de totem (o pedido completo tem o seu, de 1 hora): antes de gravar nada.
  select q.created_at into open_since
  from public.house_analysis_requests as q where q.profile_id = caller and q.status = 'open' and q.kind = 'totem';
  if open_since is not null and open_since > now() - interval '10 seconds' then
    raise exception 'totem pendente enviado há pouco; tente em instantes' using errcode = 'program_limit_exceeded';
  end if;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, totem_state, scores_enc, source)
  values (caller, p_term_version, p_house_key, null, 'pending', p_scores_enc, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = null, totem_state = 'pending', scores_enc = excluded.scores_enc, source = excluded.source, created_at = now();

  update public.house_analysis_requests
  set term_version = p_term_version, kind = 'totem', tied_axes = p_tied_axes, answers_enc = p_answers_enc, created_at = now()
  where profile_id = caller and status = 'open'
  returning id into request_id;

  if request_id is null then
    insert into public.house_analysis_requests (profile_id, term_version, kind, tied_axes, answers_enc)
    values (caller, p_term_version, 'totem', p_tied_axes, p_answers_enc)
    returning id into request_id;
    insert into public.audit_log (actor_id, event, target_id)
    values (caller, 'house_analysis_requested', caller);
  end if;
  return request_id;
end;
$$;

comment on function public.record_totem_pending(text, text, text, text[], text, bigint, text) is
  'Grava a casa (totem nulo) e abre o pedido de totem da pessoa da sessão, só com a assinatura do servidor do app (ADR 0014).';

revoke execute on function public.record_totem_pending(text, text, text, text[], text, bigint, text) from public, anon;
grant execute on function public.record_totem_pending(text, text, text, text[], text, bigint, text) to authenticated;

-- Resolução: igual à anterior, mas em pedido de totem a casa tem de ser a do resultado.
create or replace function public.resolve_house_analysis(
  p_request_id uuid, p_house_key text, p_totem_enc text, p_scores_enc text, p_answers_hash text,
  p_issued_at bigint, p_signature text
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
  request_kind text;
  current_hash text;
begin
  is_national := caller is not null and app.manages_root();
  if caller is null or not (is_national or app.holds_questionnaire_grant()) then
    raise exception 'só a coordenação nacional ou quem ela delegou resolve pedidos de análise' using errcode = 'insufficient_privilege';
  end if;
  perform app.verify_server_signature(
    format('resolve|%s|%s|%s|%s|%s|%s|%s', caller, p_request_id, p_house_key, p_totem_enc, p_scores_enc, p_answers_hash, p_issued_at),
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
  if not is_national then
    if not app.has_questionnaire_delegation_over(person) then
      raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
    end if;
    if not app.delegate_may_resolve_for(person) then
      raise exception 'este pedido é da coordenação nacional (a pessoa é gestora na unidade da concessão ou acima)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  perform 1 from public.profiles as p where p.id = person for update;
  if not app.is_active_profile(person) then
    raise exception 'só pedidos de quem está ativo' using errcode = 'insufficient_privilege';
  end if;
  select q.term_version, q.kind, encode(extensions.digest(convert_to(q.answers_enc, 'utf8'), 'sha256'), 'hex')
  into version, request_kind, current_hash
  from public.house_analysis_requests as q
  where q.id = p_request_id and q.status = 'open'
  for update;
  if version is null then
    raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
  end if;
  if p_answers_hash is distinct from current_hash then
    raise exception 'o pedido mudou desde a leitura; leia de novo' using errcode = 'serialization_failure';
  end if;
  -- Pedido de totem: a casa já saiu pelos eixos 1 e 2; a coordenação decide só o totem.
  if request_kind = 'totem' and not exists (
    select 1 from public.questionnaire_results as r where r.profile_id = person and r.house_key = p_house_key
  ) then
    raise exception 'pedido de totem: a casa é a do resultado' using errcode = 'invalid_parameter_value';
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

comment on function public.resolve_house_analysis(uuid, text, text, text, text, bigint, text) is
  'Resolve o pedido, assinado pelo servidor do app: grava a casa, o totem e as notas (cifrados pelo servidor), apaga as respostas e audita. Em pedido de totem, a casa é a do resultado. Só a coordenação nacional ou um delegado com concessão sobre a pessoa; nunca o próprio pedido (ADR 0014).';

-- Aceitar a casa fecha só o pedido da casa ('full'): o pedido de totem segue aberto.
create or replace function app.tg_house_members_close_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is not null then
    update public.house_analysis_requests
    set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'self'
    where profile_id = new.profile_id and status = 'open' and kind = 'full';
  end if;
  return null;
end;
$$;

-- "Baixar meus dados" (redefinida inteira; a anterior é a de 20261127130000_questionnaire_intensity_scale.sql):
-- agora traz `totem_state` e o tipo do pedido.
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
