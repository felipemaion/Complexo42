-- Gestão do catálogo (#25), acompanhamento: mesclar com id inexistente, o limite de 10 ao mesclar e aprovar uma
-- sugestão cujo nome é de uma habilidade mesclada (vai para a que ficou, sem reativar a antiga). Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000f1', 'cat.root@exemplo.org'),
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000f2', 'cat.sp@exemplo.org'),
  ('p_a',      '00000000-0000-0000-0000-0000000000f3', 'cat.a@exemplo.org'),
  ('p_b',      '00000000-0000-0000-0000-0000000000f4', 'cat.b@exemplo.org'),
  ('p_c',      '00000000-0000-0000-0000-0000000000f5', 'cat.c@exemplo.org'),
  ('p_d',      '00000000-0000-0000-0000-0000000000f6', 'cat.d@exemplo.org');
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp'));
insert into public.houses (key, active) select 'c-' || id::text, true from people on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'c-' || id::text, 'self', now() from people on conflict do nothing;

-- A e B (duplicadas) e 9 de enchimento.
create temp table sk (tag text primary key, id uuid not null);
grant select on sk to authenticated;
with ins as (
  insert into public.skills (name, category, aliases)
  select 'Cat ' || t, 'Cat Grupo', '{}' from unnest(array['A', 'B', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']) as t
  returning id, name
)
insert into sk select lower(substr(name, 5)), id from ins;
create function pg_temp.sk(p text) returns uuid language sql stable as $$ select id from sk where tag = p $$;
grant execute on function pg_temp.sk(text) to authenticated;

-- p_c: 10 habilidades com A e sem B (A e F1 a F9). p_d: 10 com A e B (A, B e F1 a F8).
insert into public.profile_skills (profile_id, skill_id)
select pg_temp.person('p_c'), id from sk where tag <> 'b';
insert into public.profile_skills (profile_id, skill_id)
select pg_temp.person('p_d'), id from sk where tag <> 'f9';
-- p_a sugeriu o nome de A antes da mescla.
insert into public.skill_suggestions (profile_id, name) values (pg_temp.person('p_a'), 'Cat A');

set local role authenticated;
select pg_temp.login('root_mgr');

select throws_ok($$ select public.merge_skills(pg_temp.sk('a'), '00000000-0000-0000-0000-000000000999') $$, 'P0002', null, 'mesclar para um id que não existe: P0002');
select throws_ok($$ select public.merge_skills('00000000-0000-0000-0000-000000000999', pg_temp.sk('b')) $$, 'P0002', null, 'mesclar um id que não existe: P0002');

select is(public.merge_skills(pg_temp.sk('a'), pg_temp.sk('b')), 1, 'mescla A em B: só p_c passa a ter B (p_d já tinha)');
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_c')), 10, 'p_c segue com 10: a troca não passa do limite');
select is((select count(*)::int from public.profile_skills where profile_id = pg_temp.person('p_d')), 9, 'p_d, que tinha as duas, fica com 9');
select ok(
  exists (select 1 from public.profile_skills where profile_id = pg_temp.person('p_c') and skill_id = pg_temp.sk('b'))
  and not exists (select 1 from public.profile_skills where skill_id = pg_temp.sk('a')),
  'ninguém ficou com A'
);

-- A sugestão aberta com o nome de A: aprovar dá B, sem reativar A nem criar outra.
select lives_ok($$ select public.decide_skill_suggestion((select id from public.skill_suggestions where name = 'Cat A'), true, 'Cat Grupo') $$,
  'aprovar a sugestão com o nome da habilidade mesclada não dá erro');
select ok(exists (select 1 from public.profile_skills where profile_id = pg_temp.person('p_a') and skill_id = pg_temp.sk('b')), 'a pessoa recebeu B (o destino da mescla)');
select ok(not (select active from public.skills where id = pg_temp.sk('a')), 'A continua desativada (a mescla não foi desfeita)');
select is((select count(*)::int from public.skills where name ilike 'cat a'), 1, 'e não nasceu uma habilidade repetida');

select * from finish();
rollback;
