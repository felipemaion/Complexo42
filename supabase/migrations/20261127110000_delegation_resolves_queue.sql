-- A delegação do questionário passa a incluir RESOLVER a fila de análise (issue #180, ADR 0014 §4).
--
-- Antes só a coordenação nacional resolvia. Agora também resolve quem recebeu da nacional uma
-- concessão (`questionnaire_data_grants`) que cobre a pessoa do pedido: as mesmas regras de escopo e
-- de papel ativo da leitura (`app.has_questionnaire_delegation_over`). Não muda: a assinatura do
-- servidor sobre a resolução, negar o próprio pedido e negar pessoa inativa. Para o delegado, o
-- escopo é conferido logo ao ler o pedido (antes de travar o perfil e de olhar se está ativo): fora
-- do escopo, ou de pessoa que ele nem lê (inativa), o pedido aparece como inexistente (P0002), sem
-- vazar nada nem travar perfil alheio. Regra conservadora (ADR 0014 §4): o delegado NÃO resolve o
-- pedido de quem é gestor ativo na raiz ou em unidade igual ou acima da unidade da concessão (nem
-- de outro delegado nessa condição); esses a coordenação nacional resolve.

-- Quem chama tem alguma concessão válida (qualquer escopo)? Corta cedo quem não é nem da nacional.
create or replace function app.holds_questionnaire_grant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.questionnaire_data_grants as g
      join public.units as gu on gu.id = g.unit_id
      join public.role_assignments as r
        on r.id = g.role_assignment_id and r.profile_id = g.grantee_id and r.unit_id = g.unit_id
           and r.role = 'manager' and r.revoked_at is null
      where g.grantee_id = (select auth.uid()) and g.revoked_at is null and gu.parent_id is not null
    );
$$;

comment on function app.holds_questionnaire_grant() is
  'Quem chama tem uma concessão de acesso ao questionário ainda válida (o papel de gestor a que ela foi amarrada segue ativo).';

revoke execute on function app.holds_questionnaire_grant() from public, anon, authenticated;

-- O delegado pode resolver o pedido desta pessoa? Alguma concessão válida dele a cobre, e a pessoa
-- NÃO é gestora ativa na raiz nem em unidade igual ou acima da unidade dessa concessão. Quem é
-- gestor numa unidade abaixo da concessão pode ser resolvido.
create or replace function app.delegate_may_resolve_for(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and target is not null
    and target <> (select auth.uid())
    and app.is_active_profile(target)
    and exists (
      select 1
      from public.questionnaire_data_grants as g
      join public.units as gu on gu.id = g.unit_id
      join public.role_assignments as r
        on r.id = g.role_assignment_id and r.profile_id = g.grantee_id and r.unit_id = g.unit_id
           and r.role = 'manager' and r.revoked_at is null
      join public.unit_members as m on m.profile_id = target and m.left_at is null
      join public.units as mu on mu.id = m.unit_id
      where g.grantee_id = (select auth.uid()) and g.revoked_at is null and gu.parent_id is not null
        and mu.path operator(extensions.<@) gu.path
        and not exists (
          select 1
          from public.role_assignments as tr
          join public.units as tu on tu.id = tr.unit_id
          where tr.profile_id = target and tr.role = 'manager' and tr.revoked_at is null
            and tu.path operator(extensions.@>) gu.path
        )
    );
$$;

comment on function app.delegate_may_resolve_for(uuid) is
  'Quem chama tem concessão válida que cobre a pessoa e ela não é gestora ativa na raiz nem em unidade igual ou acima da unidade da concessão (ADR 0014 §4).';

revoke execute on function app.delegate_may_resolve_for(uuid) from public, anon, authenticated;

create or replace function public.resolve_house_analysis(
  p_request_id uuid, p_house_key text, p_totem_enc text, p_issued_at bigint, p_signature text
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
    format('resolve|%s|%s|%s|%s|%s', caller, p_request_id, p_house_key, p_totem_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256) then
    raise exception 'totem inválido' using errcode = 'invalid_parameter_value';
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

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
  values (person, version, p_house_key, p_totem_enc, 'analysis')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, source = excluded.source, created_at = now();

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'house_analysis_resolved', person);
end;
$$;

comment on function public.resolve_house_analysis(uuid, text, text, bigint, text) is
  'Resolve o pedido, assinado pelo servidor do app: grava a casa e o totem (cifrado pelo servidor), apaga as respostas e audita. Só a coordenação nacional ou um delegado com concessão sobre a pessoa; nunca o próprio pedido (ADR 0014).';
