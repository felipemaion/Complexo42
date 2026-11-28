-- Medição da busca por habilidade com 50 mil perfis fictícios (#23, meta: < 500 ms). FORA do CI e do pgTAP: com poucas
-- linhas o planejador escolhe seq scan e um teste de EXPLAIN ficaria instável. Roda só no banco local, dentro de uma
-- transação que NO FIM DESFAZ TUDO (rollback); nada do que gera fica no banco.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/skill-search-benchmark.sql
--
-- O que mede: (1) a FUNÇÃO REAL `public.search_people_by_skills`, chamada por uma pessoa da coordenação nacional e por um gestor
-- de estado (que passa por `app.can_view_profile` em cada candidato), com `\timing`; e (2) o plano do miolo (habilidades pelo
-- índice `profile_skills_skill_id_idx`, junção com `profiles`) com EXPLAIN ANALYZE, para conferir que usa o índice de
-- habilidade (Index Scan / Bitmap Index Scan), não Seq Scan. Meta: menos de 500 ms por busca.
begin;

-- Se o volume do `npm run db:seed-volume` (#74) já está carregado (mil contas ou mais), a medição usa esse volume, que tem
-- nome e contato cifrados, município com pesos e 1 a 8 habilidades por perfil. Sem ele, gera 50 mil perfis de forma abaixo.
select count(*) >= 1000 as has_volume from auth.users where email like 'vol-%@exemplo.invalid' \gset
\if :has_volume
\echo 'usando o volume já carregado (npm run db:seed-volume)'
\else
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

\endif

analyze public.profiles;
analyze public.profile_skills;

\echo '--- a função real, como a coordenação nacional e como um gestor de estado ---'
-- Duas pessoas liberadas, com a casa aceita (exigência de membro de verdade): uma gestora da raiz e um gestor de SP.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000be001', 'bench-nacional@exemplo.invalid'),
  ('00000000-0000-0000-0000-0000000be002', 'bench-estado@exemplo.invalid');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, access_status, status)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1', 'active', 'active'
from auth.users where email in ('bench-nacional@exemplo.invalid', 'bench-estado@exemplo.invalid');
insert into public.consent_acceptances (user_id, version)
select id, 'v1' from auth.users where email in ('bench-nacional@exemplo.invalid', 'bench-estado@exemplo.invalid') on conflict do nothing;
insert into public.houses (key, active) values ('bench-casa', true) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'bench-casa', 'self', now() from auth.users where email in ('bench-nacional@exemplo.invalid', 'bench-estado@exemplo.invalid');
insert into public.role_assignments (profile_id, role, unit_id) values
  ('00000000-0000-0000-0000-0000000be001', 'manager', (select id from public.units where path = 'br'::extensions.ltree)),
  ('00000000-0000-0000-0000-0000000be002', 'manager', (select id from public.units where path = 'br.sp'::extensions.ltree));

\timing on
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000be001","role":"authenticated"}', true);
\echo 'nacional, uma habilidade, OU:'
select count(*) from public.search_people_by_skills(array(select id from public.skills order by name limit 1), 'any');
\echo 'nacional, duas habilidades, E:'
select count(*) from public.search_people_by_skills(array(select id from public.skills order by name limit 2), 'all');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000be002","role":"authenticated"}', true);
\echo 'gestor de estado (can_view_profile em cada candidato), uma habilidade, OU:'
select count(*) from public.search_people_by_skills(array(select id from public.skills order by name limit 1), 'any');
\echo 'gestor de estado, duas habilidades, E, em SP:'
select count(*) from public.search_people_by_skills(array(select id from public.skills order by name limit 2), 'all', 'SP');
reset role;
\timing off

\echo '--- plano do miolo (uma habilidade) ---'
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

rollback;
