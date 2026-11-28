-- Medição da busca por habilidade com 50 mil perfis fictícios (#23, meta: < 500 ms). FORA do CI e do pgTAP: com poucas
-- linhas o planejador escolhe seq scan e um teste de EXPLAIN ficaria instável. Roda só no banco local, dentro de uma
-- transação que NO FIM DESFAZ TUDO (rollback); nada do que gera fica no banco.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/skill-search-benchmark.sql
--
-- O que mede: o miolo de `public.search_people_by_skills` (habilidades pelo índice `profile_skills_skill_id_idx`, E e OU,
-- junção com `profiles`), para a coordenação nacional (sem `can_view_profile` por linha). O caso de quem tem escopo
-- menor soma `app.can_view_profile` só nos candidatos que sobraram do filtro de habilidade. Veja "Execution Time" no fim
-- de cada plano e confira que o plano usa o índice de habilidade (Index Scan / Bitmap Index Scan), não Seq Scan.
begin;

-- 50 mil contas e perfis fictícios (o nome cifrado é um valor de forma, não um nome).
insert into auth.users (id, email)
select gen_random_uuid(), 'bench-' || g || '@exemplo.invalid' from generate_series(1, 50000) as g;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version, access_status, status)
select u.id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1', 'active', 'active'
from auth.users as u where u.email like 'bench-%@exemplo.invalid';

-- 4 habilidades por perfil, sorteadas do catálogo.
insert into public.profile_skills (profile_id, skill_id)
select p.id, s.id
from public.profiles as p
cross join lateral (select id from public.skills order by random() limit 4) as s
where p.id in (select id from auth.users where email like 'bench-%@exemplo.invalid');

analyze public.profiles;
analyze public.profile_skills;

\echo '--- uma habilidade (OU) ---'
explain (analyze, buffers)
with hits as (
  select ps.profile_id as pid, count(*)::integer as common
  from public.profile_skills as ps
  where ps.skill_id = any (array(select id from public.skills order by name limit 1))
  group by ps.profile_id
)
select p.id, h.common
from hits as h join public.profiles as p on p.id = h.pid
where p.access_status = 'active' and p.status = 'active'
order by h.common desc, p.id
limit 21;

\echo '--- duas habilidades, todas (E), em SP ---'
explain (analyze, buffers)
with hits as (
  select ps.profile_id as pid, count(*)::integer as common
  from public.profile_skills as ps
  where ps.skill_id = any (array(select id from public.skills order by name limit 2))
  group by ps.profile_id
  having count(*) = 2
)
select p.id, h.common
from hits as h join public.profiles as p on p.id = h.pid
where p.access_status = 'active' and p.status = 'active' and p.state_code = 'SP'
order by h.common desc, p.id
limit 21;

rollback;
