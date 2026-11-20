-- Delegar papéis pela tela (#22, ADR 0002). As regras são as de app.can_grant_role/can_revoke_role
-- (só para baixo, dentro do escopo, nunca a si mesmo). Aqui: a pessoa precisa estar na unidade
-- (ou abaixo dela), papel técnico nunca pela tela, e toda concessão e revogação vai para o
-- audit_log por gatilho (vale também para inserção direta permitida pelo RLS).

create or replace function app.trg_role_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, event, target_id) values ((select auth.uid()), 'role_granted', new.profile_id);
  elsif new.revoked_at is not null and old.revoked_at is null then
    insert into public.audit_log (actor_id, event, target_id) values ((select auth.uid()), 'role_revoked', new.profile_id);
  end if;
  return null;
end;
$$;

create trigger trg_role_assignments_audit
after insert or update of revoked_at on public.role_assignments
for each row execute function app.trg_role_audit();

create or replace function public.grant_role(p_profile uuid, p_role text, p_unit uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path extensions.ltree;
  v_id uuid;
begin
  select path into v_path from public.units where id = p_unit;
  if v_path is null or not app.is_active_member() or p_role not in ('monitor', 'manager', 'spokesperson')
     or not app.can_grant_role(p_role, p_unit, p_profile)
     or not app.is_active_profile(p_profile)
     or not exists (
       select 1 from public.unit_members as m join public.units as u on u.id = m.unit_id
       where m.profile_id = p_profile and m.left_at is null and u.path operator(extensions.<@) v_path
     ) then
    raise exception 'sem permissão para conceder este papel a esta pessoa nesta unidade' using errcode = '42501';
  end if;

  insert into public.role_assignments (profile_id, role, unit_id, granted_by)
  values (p_profile, p_role, p_unit, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revoke_role(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit uuid;
  v_granter uuid;
begin
  select unit_id, granted_by into v_unit, v_granter
  from public.role_assignments where id = p_assignment and revoked_at is null;
  if v_unit is null or not app.can_revoke_role(v_unit, v_granter) then
    raise exception 'sem permissão para revogar este papel' using errcode = '42501';
  end if;
  update public.role_assignments set revoked_at = now() where id = p_assignment;
end;
$$;

-- Papéis ativos nas unidades que quem pede coordena (o nome vai cifrado; o app decifra).
create or replace function public.roles_in_my_scope()
returns table (id uuid, profile_id uuid, display_name_enc text, role text, unit_id uuid, unit_name text, granted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.profile_id, p.display_name_enc, r.role, u.id, u.name, r.granted_at
  from public.role_assignments as r
  join public.units as u on u.id = r.unit_id
  join public.profiles as p on p.id = r.profile_id
  where r.revoked_at is null and r.role <> 'tech_admin' and app.is_active_member() and app.can_manage_unit(r.unit_id)
  order by u.path, r.granted_at
$$;

revoke all on function app.trg_role_audit() from public, anon, authenticated;
revoke all on function public.grant_role(uuid, text, uuid), public.revoke_role(uuid), public.roles_in_my_scope() from public, anon;
grant execute on function public.grant_role(uuid, text, uuid), public.revoke_role(uuid), public.roles_in_my_scope() to authenticated;
