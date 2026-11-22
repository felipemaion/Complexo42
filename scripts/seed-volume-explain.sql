-- Medição com a base em volume (#74, meta da #23/#46): rode depois de `npm run db:seed-volume`.
--   docker exec -i supabase_db_complexo42 psql -U postgres < scripts/seed-volume-explain.sql | grep -E 'consulta|Execution Time'
-- A pessoa volume-000001 vira gestora da região vol_r01 só dentro desta transação (rollback no fim)
-- e as consultas rodam como ela, com a RLS valendo (papel authenticated).
begin;
insert into public.role_assignments (profile_id, role, unit_id)
select p.id, 'manager', u.id
from auth.users as p, public.units as u
where p.email = 'volume-000001@example.com' and u.slug = 'vol_r01';
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'volume-000001@example.com'), 'role', 'authenticated')::text, true);
set local role authenticated;

\echo 'consulta 1: perfis que a gestora da região vê (RLS com app.can_view_profile)'
explain (analyze, summary) select id from public.profiles;

\echo 'consulta 2: pessoas da região com uma habilidade (busca #23)'
explain (analyze, summary)
select * from public.search_people_by_skill((select array_agg(id) from (select id from public.skills where active order by name limit 1) as s), null, 50);

\echo 'consulta 3: vínculos de equipe que a gestora vê (RLS de unit_members)'
explain (analyze, summary) select unit_id, profile_id from public.unit_members where left_at is null;
rollback;
