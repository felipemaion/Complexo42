-- Autorizar um e-mail à mão (issue #258): o MESMO RPC do import, agora com um motivo
-- (`manual` ou `import`) e a contagem de HMACs realmente novos (`added`), para a tela dizer
-- "já estava na lista". Só o gestor da raiz (a regra de sempre); só HMAC, nunca e-mail.
--
-- - `import_allowlist(text[], text, text)`: a versão completa. O motivo vai para o
--   `allowlist_imported` do `audit_log` (onde o motivo é opcional: só a inclusão à mão o traz).
-- - `import_allowlist(text[], text)`: continua existindo e continua devolvendo só
--   `received` e `promoted`; é a de 3 argumentos com motivo `import`.

-- A regra vigente (`audit_log_reason_by_event`, da trava de casa) ganha uma linha: o
-- `allowlist_imported` pode trazer o motivo `manual` (inclusão de um e-mail à mão) ou nenhum.
alter table public.audit_log
  drop constraint audit_log_reason_by_event,
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then coalesce(reason in ('manual', 'import'), false)
      when event = 'house_accepted' then coalesce(reason in ('self', 'questionnaire'), false)
      when event = 'house_changed' then coalesce(reason in ('self', 'coordination'), false)
      when event = 'contact_viewed' then coalesce(reason in ('whatsapp', 'social', 'email'), false)
      when event = 'member_blocked' then reason is null or reason in ('impersonation', 'conduct', 'other')
      when event = 'allowlist_imported' then reason is null or reason = 'manual'
      else reason is null
    end
  );

create or replace function public.import_allowlist(p_email_hmacs text[], p_source text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  'Importação ou inclusão à mão pelo gestor da raiz: só HMACs; devolve também quantos eram novos; o motivo manual vai para a auditoria.';

create or replace function public.import_allowlist(p_email_hmacs text[], p_source text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('received', r.v -> 'received', 'promoted', r.v -> 'promoted')
  from (select public.import_allowlist(p_email_hmacs, p_source, 'import') as v) as r;
$$;

comment on function public.import_allowlist(text[], text) is
  'Importação pelo gestor da raiz: só HMACs; audita a quantidade e libera quem espera com HMAC importado.';

revoke execute on function public.import_allowlist(text[], text, text) from public, anon;
grant execute on function public.import_allowlist(text[], text, text) to authenticated;
