-- Catálogo de habilidades pela tela (#25): o gestor nacional (manager da unidade raiz) cria,
-- renomeia, ajusta sinônimos e desativa. Desativar não apaga os vínculos (profile_skills fica).

create or replace function app.is_national_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member() and exists (
    select 1 from public.role_assignments as r join public.units as u on u.id = r.unit_id
    where r.profile_id = (select auth.uid()) and r.revoked_at is null and r.role = 'manager' and u.parent_id is null
  )
$$;

create or replace function app.clean_aliases(p_aliases text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct a order by a), '{}')
  from (select lower(trim(x)) as a from unnest(coalesce(p_aliases, '{}')) as x) as t
  where length(a) between 2 and 80
$$;

create or replace function public.create_skill(p_name text, p_category text, p_aliases text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_national_manager() then
    raise exception 'só o gestor nacional mexe no catálogo' using errcode = '42501';
  end if;
  insert into public.skills (name, category, aliases, active)
  values (trim(p_name), trim(p_category), app.clean_aliases(p_aliases), true)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_skill(p_skill uuid, p_name text, p_category text, p_aliases text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_national_manager() then
    raise exception 'só o gestor nacional mexe no catálogo' using errcode = '42501';
  end if;
  update public.skills set name = trim(p_name), category = trim(p_category), aliases = app.clean_aliases(p_aliases)
  where id = p_skill;
  if not found then
    raise exception 'habilidade não encontrada' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.set_skill_active(p_skill uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_national_manager() then
    raise exception 'só o gestor nacional mexe no catálogo' using errcode = '42501';
  end if;
  update public.skills set active = p_active where id = p_skill;
  if not found then
    raise exception 'habilidade não encontrada' using errcode = '22023';
  end if;
end;
$$;

-- Catálogo completo (ativas e desativadas) para a tela do gestor nacional.
create or replace function public.skills_catalog()
returns table (id uuid, name text, category text, aliases text[], active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.category, s.aliases, s.active from public.skills as s
  where app.is_national_manager()
  order by s.category, s.name
$$;

revoke all on function app.is_national_manager(), app.clean_aliases(text[]) from public, anon, authenticated;
revoke all on function public.create_skill(text, text, text[]), public.update_skill(uuid, text, text, text[]),
  public.set_skill_active(uuid, boolean), public.skills_catalog() from public, anon;
grant execute on function public.create_skill(text, text, text[]), public.update_skill(uuid, text, text, text[]),
  public.set_skill_active(uuid, boolean), public.skills_catalog() to authenticated;
