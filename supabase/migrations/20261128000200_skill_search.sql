-- supabase/migrations/20261128000200_skill_search.sql
-- Busca de pessoas por habilidades (issue #23, R14/R15).
-- Retorna membros ativos visíveis pelo solicitante que possuam todas as habilidades solicitadas.

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
  where app.can_view_profile(p.id)
    and app.is_active_profile(p.id)
    and (p_municipality_code is null or p.municipality_code = p_municipality_code)
  order by
    tsp.total_skills desc,
    p.id asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

comment on function public.search_people_by_skill(uuid[], integer, integer) is
  'Busca membros ativos por habilidades com verificação de escopo e privacidade. Nunca expõe contatos.';

revoke all on function public.search_people_by_skill(uuid[], integer, integer) from public, anon;
grant execute on function public.search_people_by_skill(uuid[], integer, integer) to authenticated;
