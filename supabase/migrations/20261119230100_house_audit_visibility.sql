-- Eventos de casa visíveis a quem tem direito (issue #132; ADR 0002, regra 5; ADR 0011).
--
-- 1. `app.can_read_audit(event, target, actor, house)` substitui a versão de dois argumentos
--    (os dois novos têm valor padrão: as chamadas antigas continuam valendo). A política de
--    SELECT de `audit_log` passa a enviar o ator e a casa da linha.
--    - Como antes: `allowlist_imported`, o gestor da raiz; evento sobre uma pessoa, o gestor
--      (manager) com escopo sobre ela (`app.manages_member`). Isso já cobre `house_accepted`
--      (o alvo agora é a pessoa) para a coordenação territorial acima dela.
--    - Novo: `house_accepted` também para o coordenador da casa do registro, dentro do seu
--      território, enquanto a pessoa estiver nessa casa (`app.is_house_coordinator_of` e a casa
--      aberta igual à do registro).
--    - Novo: a pessoa lê os próprios `house_accepted` e `questionnaire_consented` (ela é o ator).
--    `questionnaire_consented` não tem alvo: a coordenação não lê o aceite do termo.
--    Quem não está ativo não lê nada (nem os próprios; a guarda é a mesma de antes).
-- 2. `export_own_data()` (#20) passa a trazer:
--    - em `audit_events`, também os eventos em que a pessoa é o ator de `house_accepted` e
--      `questionnaire_consented`, com `term_version` e `house_key`;
--    - `house_memberships` (os vínculos de casa, inclusive encerrados);
--    - `questionnaire_consents` (as versões do termo aceitas e quando);
--    - em `roles`, a `house_key` do papel de coordenador de casa.

-- ---------------------------------------------------------------------------------------
-- 1. can_read_audit
-- ---------------------------------------------------------------------------------------
create or replace function app.can_read_audit(event text, target uuid, actor uuid default null, house text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and (
      (event = 'allowlist_imported' and app.manages_root())
      or (target is not null and app.manages_member(target))
      or (
        event in ('house_accepted', 'questionnaire_consented')
        and actor is not null
        and actor = (select auth.uid())
      )
      or (
        event = 'house_accepted'
        and target is not null
        and house is not null
        and house = app.open_house_of(target)
        and app.is_house_coordinator_of((select auth.uid()), target)
      )
    );
$$;

comment on function app.can_read_audit(text, uuid, uuid, text) is
  'Auditoria: gestores no escopo; house_accepted também pelo coordenador da casa no território; a pessoa lê os próprios eventos de casa (#132).';

alter policy audit_log_select on public.audit_log
  using (app.can_read_audit(event, target_id, actor_id, house_key));

drop function app.can_read_audit(text, uuid);

revoke execute on function app.can_read_audit(text, uuid, uuid, text) from public, anon;
grant execute on function app.can_read_audit(text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. export_own_data
-- ---------------------------------------------------------------------------------------
-- Definição igual à de `..._contact_visibility.sql`, com as mudanças do cabeçalho.
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
         or (a.actor_id = caller and a.event in ('house_accepted', 'questionnaire_consented'))
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

comment on function public.export_own_data() is
  'Dados da própria pessoa para o "Baixar meus dados" (#20), ainda cifrados: perfil, contato, vínculos (território e casa), termos do questionário, papéis, auditoria (inclusive os próprios eventos de casa, #132) e quem acessou o contato (#119). Registra data_exported; até 5 por hora.';
