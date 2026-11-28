-- Bootstrap da primeira coordenação (issue #295): num banco novo ninguém pode autorizar ninguém,
-- porque a lista e o papel de gestor da raiz só mudam pelas mãos de um gestor da raiz.
--
-- `app.bootstrap_root_manager(hmac, email, adicionar_outro)` é só do operador (supabase_admin, pelo
-- `deploy/bootstrap-coordenacao.sh`): nenhum grant para a API.
--  - o HMAC vem calculado pelo app (container do app, com a chave dele); o banco só guarda e compara;
--  - o e-mail em claro serve APENAS para achar a conta em auth.users e nunca é gravado nem auditado;
--  - põe o HMAC na lista (origem `manual`, sem autor), libera quem esperava (como `import_allowlist`)
--    e, se a pessoa já tem perfil ativo, cria o papel `manager` na raiz com `granted_by` nulo
--    ("nasceu fora da API", nunca a própria pessoa);
--  - idempotente: repetir não duplica lista, papel nem auditoria (trava de transação + checagem);
--  - recusa se a raiz já tem gestor ativo, salvo `adicionar_outro` (acrescenta, nunca substitui).
-- Resultado `role`: `granted`, `already`, `waiting_profile` (a pessoa ainda precisa entrar uma vez)
-- ou `not_active` (perfil bloqueado ou suspenso). O papel só passa a valer quando a pessoa é membro de
-- verdade (termo, perfil completo e casa aceita): `app.is_active_member()` segue exigido.
create or replace function app.bootstrap_root_manager(p_email_hmac text, p_email text, p_add_another boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  root_id uuid;
  target uuid;
  target_access text;
  target_status text;
  has_role boolean := false;
  added boolean := false;
  promoted integer := 0;
  result_role text;
begin
  if p_email_hmac is null or p_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_email is null or length(p_email) > 254 or p_email !~ '^[^\s@]+@[^\s@]+$' then
    raise exception 'e-mail inválido' using errcode = 'invalid_parameter_value';
  end if;

  select u.id into root_id from public.units as u where u.parent_id is null;
  if root_id is null then
    raise exception 'a instância não tem unidade raiz' using errcode = 'no_data_found';
  end if;

  -- Mesma trava do gatilho de bootstrap da raiz: duas execuções simultâneas não passam juntas.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('app.root_manager_bootstrap'));

  -- Quem é a pessoa: conta com este e-mail já confirmado, ou o perfil que esperou com este HMAC.
  select p.id into target
  from auth.users as u
  join public.profiles as p on p.id = u.id
  where lower(u.email) = lower(p_email) and u.email_confirmed_at is not null
  limit 1;
  if target is null then
    select w.profile_id into target from public.access_waitlist_hmac as w where w.email_hmac = p_email_hmac;
  end if;

  if target is not null then
    select exists (
      select 1 from public.role_assignments as r
      where r.profile_id = target and r.role = 'manager' and r.unit_id = root_id and r.revoked_at is null
    ) into has_role;
  end if;

  if not has_role and not coalesce(p_add_another, false) and exists (
    select 1 from public.role_assignments as r
    where r.role = 'manager' and r.unit_id = root_id and r.revoked_at is null
  ) then
    raise exception 'a raiz já tem gestor ativo; use a flag para acrescentar outro';
  end if;

  with inserted as (
    insert into public.access_allowlist (email_hmac, source, added_by)
    values (p_email_hmac, 'manual', null)
    on conflict (email_hmac) do nothing
    returning 1
  )
  select count(*) > 0 into added from inserted;
  if added then
    insert into public.audit_log (actor_id, event, item_count, reason)
    values (null, 'allowlist_imported', 1, 'manual');
  end if;

  -- Quem esperava com este HMAC sai da espera, como na importação da lista.
  with released as (
    update public.profiles as p
    set access_status = 'active', status = 'active'
    from public.access_waitlist_hmac as w
    where w.profile_id = p.id
      and w.email_hmac = p_email_hmac
      and p.access_status = 'waitlisted'
      and p.status <> 'suspended'
    returning p.id
  ),
  forgotten as (
    delete from public.access_waitlist_hmac as w using released as r where w.profile_id = r.id
  ),
  audited as (
    insert into public.audit_log (actor_id, event, target_id, reason)
    select null, 'access_granted', r.id, 'manual' from released as r
  )
  select count(*)::integer into promoted from released;

  if target is null then
    result_role := 'waiting_profile';
  else
    select p.access_status, p.status into target_access, target_status from public.profiles as p where p.id = target;
    if target_access <> 'active' or target_status <> 'active' then
      result_role := 'not_active';
    elsif has_role then
      result_role := 'already';
    else
      insert into public.role_assignments (profile_id, role, unit_id, granted_by)
      values (target, 'manager', root_id, null);
      insert into public.audit_log (actor_id, event, target_id) values (null, 'role_granted', target);
      result_role := 'granted';
    end if;
  end if;

  return jsonb_build_object('allowlisted', added, 'promoted', promoted, 'role', result_role);
end;
$$;

comment on function app.bootstrap_root_manager(text, text, boolean) is
  'Só o operador: autoriza o HMAC de um e-mail, libera quem esperava e cria o gestor da raiz (granted_by nulo). Idempotente; recusa se a raiz já tem gestor, salvo a flag.';

revoke all on function app.bootstrap_root_manager(text, text, boolean) from public, anon, authenticated, service_role;
