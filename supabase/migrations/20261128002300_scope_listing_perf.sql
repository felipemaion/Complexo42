-- Listas por escopo rápidas (#74 revelou, regra da #46/R15 igual). As políticas de leitura de
-- `profiles` e `unit_members` chamavam a checagem de escopo LINHA POR LINHA (app.can_view_profile e
-- app.can_manage_unit), refazendo a busca dos papéis de quem olha a cada linha: com 2 mil perfis
-- fictícios, a lista da gestora de uma região levava ~3 s. Agora o conjunto do escopo é calculado
-- UMA vez por consulta (funções que devolvem os ids) e a política só confere "está no conjunto".
-- As condições são as mesmas de antes; app.can_view_profile e app.can_manage_unit continuam
-- existindo para as outras funções. Provas: supabase/tests/permissions_matrix.test.sql e
-- rls_matrix.test.sql (inteiros) e scripts/seed-volume-explain.sql.

-- Perfis que quem chama vê pelo escopo (monitor, gestor ou porta-voz acima do vínculo aberto da
-- pessoa), só perfis ativos. Igual ao ramo de escopo de app.can_view_profile.
create or replace function app.profiles_in_my_scope()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.profile_id
  from app.my_scopes() as s
  join public.units as u on u.path operator(extensions.<@) s.unit_path
  join public.unit_members as m on m.unit_id = u.id and m.left_at is null
  join public.profiles as p on p.id = m.profile_id and p.access_status = 'active' and p.status = 'active'
  where s.role in ('monitor', 'manager', 'spokesperson')
$$;

-- Unidades que quem chama coordena (monitor ou gestor nelas ou acima). Igual a app.can_manage_unit.
create or replace function app.units_i_coordinate()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct u.id
  from app.my_scopes() as s
  join public.units as u on u.path operator(extensions.<@) s.unit_path
  where s.role in ('monitor', 'manager')
$$;

-- Quem chama tem algum papel de coordenador de casa? Se não tem, a checagem completa por linha
-- nem roda (o ramo de casa daria falso de qualquer jeito).
create or replace function app.coordinates_any_house()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments as r
    where r.profile_id = (select auth.uid()) and r.role = 'house_coordinator' and r.revoked_at is null
  )
$$;

revoke all on function app.profiles_in_my_scope(), app.units_i_coordinate(), app.coordinates_any_house() from public, anon;
grant execute on function app.profiles_in_my_scope(), app.units_i_coordinate(), app.coordinates_any_house() to authenticated;

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select app.profiles_in_my_scope())
    -- Coordenador de casa: a checagem completa de antes, por linha (só para quem tem esse papel).
    or ((select app.coordinates_any_house()) and app.can_view_profile(id))
  );

drop policy unit_members_select on public.unit_members;
create policy unit_members_select on public.unit_members
  for select to authenticated
  using (
    (profile_id = (select auth.uid()) and (select app.is_active_member()))
    or (unit_id in (select app.units_i_coordinate()) and app.is_active_profile(profile_id))
  );

-- A busca por habilidade (#23) filtrava cada candidato com app.can_view_profile: ~7 s com 50 mil
-- perfis. Agora o escopo entra antes, pelo mesmo conjunto; o resto da função não mudou.
create or replace function public.search_people_by_skill(
  p_skill_ids uuid[],
  p_municipality_code integer default null,
  p_limit integer default 50
)
returns table (
  profile_id uuid,
  display_name_enc text,
  municipality_code integer,
  skill_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_skills as (
    -- Desduplica os identificadores solicitados para conferência estrita de cardinalidade
    select distinct s.id, s.name
    from public.skills as s
    where s.id = any(p_skill_ids)
  ),
  skill_count as (
    select count(*)::int as total
    from requested_skills
  ),
  candidate_profiles as (
    -- Filtra perfis que possuem todas as habilidades solicitadas
    select
      ps.profile_id,
      array_agg(rs.name order by rs.name) as matched_skill_names
    from public.profile_skills as ps
    join requested_skills as rs on rs.id = ps.skill_id
    cross join skill_count as sc
    -- Validação: quem chama precisa ser membro ativo e p_skill_ids deve ter entre 1 e 10 itens
    where app.is_active_member()
      -- Escopo primeiro, pelo conjunto calculado uma vez (mesma regra de leitura de profiles).
      and (
        ps.profile_id = (select auth.uid())
        or ps.profile_id in (select app.profiles_in_my_scope())
        or ((select app.coordinates_any_house()) and app.can_view_profile(ps.profile_id))
      )
      and sc.total between 1 and 10
      and cardinality(p_skill_ids) between 1 and 10
      and sc.total = cardinality(p_skill_ids)
    group by ps.profile_id, sc.total
    having count(distinct ps.skill_id) = sc.total
  ),
  total_skills_per_profile as (
    -- Contagem total de habilidades de cada perfil para ordenação de relevância
    select
      ps.profile_id,
      count(*)::int as total_skills
    from public.profile_skills as ps
    where ps.profile_id in (select cp.profile_id from candidate_profiles as cp)
    group by ps.profile_id
  )
  select
    p.id as profile_id,
    p.display_name_enc,
    p.municipality_code,
    cp.matched_skill_names as skill_names
  from candidate_profiles as cp
  join public.profiles as p on p.id = cp.profile_id
  join total_skills_per_profile as tsp on tsp.profile_id = p.id
  where app.is_active_profile(p.id)
    and (p_municipality_code is null or p.municipality_code = p_municipality_code)
  order by
    tsp.total_skills desc,
    p.id asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.search_people_by_skill(uuid[], integer, integer) from public, anon;
grant execute on function public.search_people_by_skill(uuid[], integer, integer) to authenticated;
