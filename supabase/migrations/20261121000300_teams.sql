-- supabase/migrations/20261121000300_teams.sql

-- ============================================================================
-- Montagem de equipes do 1º ciclo (Ata 17/11, Issues #28 e #29)
-- ============================================================================

-- 1. team_parents: lista nós ancestrais/pais aptos a abrigar equipes (Issue #28)
create or replace function public.team_parents()
returns table (
  id uuid,
  name text,
  depth integer
)
language sql
security definer
set search_path = ''
as $$
  select
    u.id,
    u.name,
    extensions.nlevel(u.path) as depth
  from public.units u
  join public.unit_types ut on ut.id = u.type_id
  where u.status = 'active'
    and ut.is_team = false
    and app.is_active_member()
    and app.can_manage_unit(u.id)
  order by u.path;
$$;

-- 2. create_team: criação de equipe sob uma unidade pai (Issue #28)
create or replace function public.create_team(
  p_parent uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trimmed_name text := trim(p_name);
  v_parent_is_team boolean;
  v_team_type_id uuid;
  v_slug text;
  v_new_id uuid;
begin
  if not app.is_active_member() or not app.can_manage_unit(p_parent) then
    raise exception 'Acesso negado para gerenciar unidade pai' using errcode = '42501';
  end if;

  select ut.is_team
  into v_parent_is_team
  from public.units u
  join public.unit_types ut on ut.id = u.type_id
  where u.id = p_parent
    and u.status = 'active';

  if v_parent_is_team is null or v_parent_is_team = true then
    raise exception 'Unidade pai inválida ou já é uma equipe' using errcode = '42501';
  end if;

  if length(v_trimmed_name) < 2 or length(v_trimmed_name) > 60 then
    raise exception 'Nome da equipe deve ter entre 2 e 60 caracteres' using errcode = '22023';
  end if;

  select ut.id
  into v_team_type_id
  from public.unit_types ut
  where ut.is_team = true
  order by ut.level asc
  limit 1;

  if v_team_type_id is null then
    raise exception 'Tipo de equipe não configurado no sistema' using errcode = 'P0002';
  end if;

  v_slug := 'equipe_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  insert into public.units (
    type_id,
    parent_id,
    slug,
    name,
    path
  ) values (
    v_team_type_id,
    p_parent,
    v_slug,
    v_trimmed_name,
    v_slug::extensions.ltree
  )
  returning units.id into v_new_id;

  return v_new_id;
end;
$$;

-- 3. my_teams: lista equipes ativas gerenciadas pelo coordenador (Issue #28)
create or replace function public.my_teams()
returns table (
  id uuid,
  name text,
  parent_id uuid,
  parent_name text,
  member_count integer
)
language sql
security definer
set search_path = ''
as $$
  select
    u.id,
    u.name,
    u.parent_id,
    p.name as parent_name,
    count(m.id)::integer as member_count
  from public.units u
  join public.unit_types ut on ut.id = u.type_id
  left join public.units p on p.id = u.parent_id
  left join public.unit_members m on m.unit_id = u.id and m.left_at is null
  where u.status = 'active'
    and ut.is_team = true
    and app.is_active_member()
    and app.can_manage_unit(u.id)
  group by u.id, u.name, p.name, u.parent_id
  order by p.name asc nulls last, u.name asc;
$$;

-- 4. team_members: membros ativos de uma equipe com ordenação por liderança (Issue #29)
create or replace function public.team_members(p_team uuid)
returns table (
  profile_id uuid,
  display_name_enc text,
  is_lead boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member() or not (
    app.can_manage_unit(p_team)
    or exists (
      select 1
      from public.unit_members um
      where um.unit_id = p_team
        and um.profile_id = auth.uid()
        and um.left_at is null
    )
  ) then
    return;
  end if;

  return query
  select
    p.id as profile_id,
    p.display_name_enc,
    (m.member_role = 'lead') as is_lead
  from public.unit_members m
  join public.profiles p on p.id = m.profile_id
  where m.unit_id = p_team
    and m.left_at is null
    and app.is_active_profile(m.profile_id)
  order by (m.member_role = 'lead') desc, m.joined_at asc;
end;
$$;

-- 5. unassigned_people: pessoas disponíveis na árvore para distribuição (Issue #29)
create or replace function public.unassigned_people(p_parent uuid)
returns table (
  profile_id uuid,
  display_name_enc text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_path extensions.ltree;
begin
  if not app.is_active_member() or not app.can_manage_unit(p_parent) then
    return;
  end if;

  select path into v_parent_path
  from public.units
  where id = p_parent;

  if v_parent_path is null then
    return;
  end if;

  return query
  select
    p.id as profile_id,
    p.display_name_enc
  from public.unit_members m
  join public.units u on u.id = m.unit_id
  join public.unit_types ut on ut.id = u.type_id
  join public.profiles p on p.id = m.profile_id
  where m.left_at is null
    and ut.is_team = false
    and (u.path operator(extensions.<@) v_parent_path or u.path operator(extensions.@>) v_parent_path)
    and app.is_active_profile(p.id)
    and app.can_view_profile(p.id)
  limit 200;
end;
$$;

-- 6. assign_to_team: alocação de perfil ativo na equipe (Issue #29)
create or replace function public.assign_to_team(
  p_profile uuid,
  p_team uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_team boolean;
  v_current_unit uuid;
begin
  select ut.is_team
  into v_is_team
  from public.units u
  join public.unit_types ut on ut.id = u.type_id
  where u.id = p_team
    and u.status = 'active';

  if v_is_team is distinct from true
     or not app.is_active_member()
     or not app.can_manage_unit(p_team)
     or not app.can_view_profile(p_profile)
     or not app.is_active_profile(p_profile) then
    raise exception 'Operação não permitida ou perfil inválido' using errcode = '42501';
  end if;

  select unit_id
  into v_current_unit
  from public.unit_members
  where profile_id = p_profile
    and left_at is null;

  if v_current_unit = p_team then
    return;
  end if;

  update public.unit_members
  set left_at = now()
  where profile_id = p_profile
    and left_at is null;

  insert into public.unit_members (
    unit_id,
    profile_id,
    member_role
  ) values (
    p_team,
    p_profile,
    'member'
  );
end;
$$;

-- 7. remove_from_team: remoção de membro e retorno à unidade pai (Issue #29)
create or replace function public.remove_from_team(
  p_profile uuid,
  p_team uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_id uuid;
begin
  if not app.is_active_member() or not app.is_active_member()
     or not app.can_manage_unit(p_team) then
    raise exception 'Acesso negado para gerenciar a equipe' using errcode = '42501';
  end if;

  select parent_id
  into v_parent_id
  from public.units
  where id = p_team;

  if v_parent_id is null then
    raise exception 'Equipe sem unidade pai' using errcode = '22023';
  end if;

  update public.unit_members
  set left_at = now()
  where profile_id = p_profile
    and unit_id = p_team
    and left_at is null;

  -- Só devolve ao pai quem estava mesmo nesta equipe: sem isso, daria para mover qualquer
  -- pessoa para a unidade de cima.
  if not found then
    raise exception 'a pessoa não está nesta equipe' using errcode = '42501';
  end if;

  insert into public.unit_members (
    unit_id,
    profile_id,
    member_role
  ) values (
    v_parent_id,
    p_profile,
    'member'
  );
end;
$$;

-- 8. set_team_lead: definição do papel de liderança na equipe (Issue #29)
create or replace function public.set_team_lead(
  p_team uuid,
  p_profile uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member() or not app.is_active_member()
     or not app.can_manage_unit(p_team) then
    raise exception 'Acesso negado para gerenciar a equipe' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.unit_members
    where unit_id = p_team
      and profile_id = p_profile
      and left_at is null
  ) then
    raise exception 'Perfil não possui vínculo aberto nesta equipe' using errcode = '42501';
  end if;

  update public.unit_members
  set member_role = case
    when profile_id = p_profile then 'lead'
    else 'member'
  end
  where unit_id = p_team
    and left_at is null;
end;
$$;

-- ============================================================================
-- Permissões
-- ============================================================================

revoke all on function public.team_parents() from public, anon;
grant execute on function public.team_parents() to authenticated;

revoke all on function public.create_team(uuid, text) from public, anon;
grant execute on function public.create_team(uuid, text) to authenticated;

revoke all on function public.my_teams() from public, anon;
grant execute on function public.my_teams() to authenticated;

revoke all on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated;

revoke all on function public.unassigned_people(uuid) from public, anon;
grant execute on function public.unassigned_people(uuid) to authenticated;

revoke all on function public.assign_to_team(uuid, uuid) from public, anon;
grant execute on function public.assign_to_team(uuid, uuid) to authenticated;

revoke all on function public.remove_from_team(uuid, uuid) from public, anon;
grant execute on function public.remove_from_team(uuid, uuid) to authenticated;

revoke all on function public.set_team_lead(uuid, uuid) from public, anon;
grant execute on function public.set_team_lead(uuid, uuid) to authenticated;
