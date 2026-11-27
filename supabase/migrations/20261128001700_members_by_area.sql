-- Mapa de onde estão as pessoas (#24, RF08). Só contagens por município e por distrito da capital
-- (nunca localização precisa), só de quem está dentro do escopo de coordenação de quem vê.
-- Menos de 5 pessoas numa área sai sem número (people nulo, a tela mostra "< 5").

create or replace function public.members_by_area()
returns table (kind text, code integer, label text, people integer)
language sql
stable
security definer
set search_path = ''
as $$
  with scoped as (
    select distinct p.id, p.municipality_code, p.district_code
    from public.profiles as p
    join public.unit_members as m on m.profile_id = p.id and m.left_at is null
    join public.units as u on u.id = m.unit_id
    where app.is_active_member()
      and p.status = 'active'
      and exists (
        select 1 from app.my_scopes() as s
        where s.role in ('manager', 'monitor') and u.path operator(extensions.<@) s.unit_path
      )
  ),
  areas as (
    select 'municipio'::text as kind, s.municipality_code as code, mu.name as label, count(*)::integer as n
    from scoped as s join public.municipalities as mu on mu.code = s.municipality_code
    group by s.municipality_code, mu.name
    union all
    -- distrito pelo código (main, 20261127100200: a coluna de texto virou district_code + public.districts)
    select 'distrito'::text, s.district_code, d.name, count(*)::integer
    from scoped as s
    join public.districts as d on d.municipality_code = s.municipality_code and d.code = s.district_code
    where s.municipality_code = 3550308
    group by s.district_code, d.name
  )
  select a.kind, a.code, a.label, case when a.n >= 5 then a.n else null end
  from areas as a
$$;

revoke all on function public.members_by_area() from public, anon;
grant execute on function public.members_by_area() to authenticated;
