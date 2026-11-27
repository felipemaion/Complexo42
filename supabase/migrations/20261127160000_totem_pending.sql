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

alter table public.questionnaire_results alter column totem_enc drop not null;
alter table public.questionnaire_results drop constraint questionnaire_results_totem_enc_format;
alter table public.questionnaire_results
  add constraint questionnaire_results_totem_enc_format check (totem_enc is null or app.is_encrypted_value(totem_enc, 256));

comment on column public.questionnaire_results.totem_enc is
  'Totem cifrado pelo servidor (ADR 0003). Nulo enquanto pendente: o empate nos eixos do totem espera a coordenação (ADR 0014).';

alter table public.house_analysis_requests
  add column kind text not null default 'full'
    constraint house_analysis_requests_kind_check check (kind in ('full', 'totem')),
  add constraint house_analysis_requests_totem_axes
    check (kind = 'full' or tied_axes <@ array['totem1', 'totem2']);

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
     or not (p_tied_axes <@ array['house1', 'house2', 'totem1', 'totem2']) then
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
  from public.house_analysis_requests as q where q.profile_id = caller and q.status = 'open';
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
begin
  perform app.verify_server_signature(
    format('totem_pending|%s|%s|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_scores_enc,
           array_to_string(p_tied_axes, ','), p_answers_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_tied_axes is null or cardinality(p_tied_axes) not between 1 and 2
     or not (p_tied_axes <@ array['totem1', 'totem2']) then
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

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, scores_enc, source)
  values (caller, p_term_version, p_house_key, null, p_scores_enc, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = null, scores_enc = excluded.scores_enc, source = excluded.source, created_at = now();

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
