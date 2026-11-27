-- Resolução de pedido de chave antiga (#220): sem notas. Os pedidos abertos com a chave anterior (itens e
-- escala diferentes) não pontuam na chave atual; a coordenação escolhe casa e totem e o servidor assina sem
-- notas (`p_scores_enc` nulo, vazio na assinatura). Igual à anterior em tudo o mais; com notas, o formato
-- continua conferido. `questionnaire_results.scores_enc` já aceita nulo (resultado antigo, sem gráfico); em
-- pedido de totem sem notas, as notas que o resultado já tem ficam.
--
-- `request_house_analysis` (abre pedido completo) não tem mais uso no app, desde a chave sem empate (#213): perde o
-- grant de `authenticated` (a função e a fila de pedidos antigos ficam).

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
     or (p_scores_enc is not null and not app.is_encrypted_value(p_scores_enc, 512)) then
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
        totem_enc = excluded.totem_enc, source = excluded.source, created_at = now(),
        -- Sem notas novas (chave antiga), pedido de totem não apaga as que o resultado já tem; pedido completo troca tudo.
        scores_enc = case when request_kind = 'totem' then coalesce(excluded.scores_enc, public.questionnaire_results.scores_enc) else excluded.scores_enc end;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'house_analysis_resolved', person);
end;
$$;

comment on function public.resolve_house_analysis(uuid, text, text, text, text, bigint, text) is
  'Resolve o pedido, assinado pelo servidor do app: grava a casa, o totem e as notas (cifrados pelo servidor; nulas em pedido de chave antiga), apaga as respostas e audita. Em pedido de totem, a casa é a do resultado. Só a coordenação nacional ou um delegado com concessão sobre a pessoa; nunca o próprio pedido (ADR 0014).';

revoke execute on function public.request_house_analysis(text, text[], text, bigint, text) from authenticated;
