-- Limite de "autorizar um e-mail à mão" no banco (issue #86). Antes, o freio era só na memória
-- do processo do app (30 a cada 10 minutos por gestor): zerava a cada deploy e cada réplica
-- contava sozinha. Agora a regra mora no RPC, com o mesmo padrão do limite de exportação e de
-- contatos vistos: o próprio `audit_log` (só inserções) é o contador, e um lock por gestor
-- impede que pedidos simultâneos passem do teto.
--
-- - Só a inclusão à mão (`p_reason = 'manual'`) conta e é limitada: 30 a cada 10 minutos por
--   gestor. A importação por arquivo tem os seus próprios tetos (50000 itens, 1,5 MB).
-- - Passou do teto: `program_limit_exceeded` (54000), que o app traduz numa mensagem genérica,
--   sem dizer quantas inclusões faltam.
-- - O índice `audit_log_actor_event_created_idx` (da exportação) já atende a contagem.

create or replace function public.import_allowlist(p_email_hmacs text[], p_source text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  manual_max constant integer := 30;
  manual_window constant interval := interval '10 minutes';
  received integer;
  added integer;
  promoted integer;
begin
  if not app.can_import_allowlist() then
    raise exception 'só o gestor importa a lista' using errcode = 'insufficient_privilege';
  end if;
  if p_source is null or p_source not in ('form', 'academy', 'manual') then
    raise exception 'origem inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or p_reason not in ('manual', 'import') then
    raise exception 'motivo inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_email_hmacs is null or cardinality(p_email_hmacs) = 0
     or cardinality(p_email_hmacs) > 50000 then
    raise exception 'a lista precisa ter de 1 a 50000 itens' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from unnest(p_email_hmacs) as h(v)
    where h.v is null or h.v !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;

  if p_reason = 'manual' then
    perform pg_advisory_xact_lock(hashtextextended('allowlist_manual:' || (select auth.uid())::text, 0));
    if (
      select count(*) from public.audit_log as a
      where a.actor_id = (select auth.uid())
        and a.event = 'allowlist_imported'
        and a.reason = 'manual'
        and a.created_at > now() - manual_window
    ) >= manual_max then
      raise exception 'limite de inclusões à mão atingido'
        using errcode = 'program_limit_exceeded';
    end if;
  end if;

  select count(distinct h.v)::integer into received from unnest(p_email_hmacs) as h(v);
  with inserted as (
    insert into public.access_allowlist (email_hmac, source, added_by)
    select distinct h.v, p_source, (select auth.uid())
    from unnest(p_email_hmacs) as h(v)
    on conflict (email_hmac) do nothing
    returning 1
  )
  select count(*)::integer into added from inserted;

  insert into public.audit_log (actor_id, event, item_count, reason)
  values ((select auth.uid()), 'allowlist_imported', received,
          case when p_reason = 'manual' then 'manual' else null end);

  with released as (
    update public.profiles as p
    set access_status = 'active', status = 'active'
    from public.access_waitlist_hmac as w
    where w.profile_id = p.id
      and p.access_status = 'waitlisted'
      and p.status <> 'suspended'
      and w.email_hmac = any (p_email_hmacs)
    returning p.id
  ),
  forgotten as (
    delete from public.access_waitlist_hmac as w
    using released as r
    where w.profile_id = r.id
  ),
  audited as (
    insert into public.audit_log (actor_id, event, target_id, reason)
    select (select auth.uid()), 'access_granted', r.id, 'import' from released as r
  )
  select count(*)::integer into promoted from released;

  return jsonb_build_object('received', received, 'promoted', promoted, 'added', added);
end;
$$;

comment on function public.import_allowlist(text[], text, text) is
  'Importação ou inclusão à mão pelo gestor da raiz: só HMACs; devolve também quantos eram novos; o motivo manual vai para a auditoria e tem teto de 30 a cada 10 minutos por gestor.';
