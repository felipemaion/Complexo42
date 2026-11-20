-- Busca de pessoas por habilidade (issue #23): escopo, "todas as habilidades", suspensos fora,
-- nada para anon. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

truncate public.role_assignments, public.unit_members, public.house_members, public.units cascade;
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.slug = p_parent), p_slug, p_slug,
         p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;
select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('team', 'abc', 'team_x');
select pg_temp.add_unit('team', 'abc', 'team_y');

-- f1 monitor da equipe X | f2 equipe X, as duas habilidades | f3 equipe X, só Fotografia
-- f4 equipe X, suspensa, as duas | f5 equipe Y, as duas (fora do escopo de f1)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000f3'), ('00000000-0000-0000-0000-0000000000f4'),
  ('00000000-0000-0000-0000-0000000000f5');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000f%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000f%';
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-0000000000f4';

insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000f1', 'monitor', id from public.units where slug = 'team_x';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('team_x', '00000000-0000-0000-0000-0000000000f1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000f2'),
  ('team_x', '00000000-0000-0000-0000-0000000000f3'), ('team_x', '00000000-0000-0000-0000-0000000000f4'),
  ('team_y', '00000000-0000-0000-0000-0000000000f5')
) as v (slug, p) join public.units as u on u.slug = v.slug;

select set_config('t.a', (select id::text from public.skills where name = 'Fotografia'), true);
select set_config('t.b', (select id::text from public.skills where name <> 'Fotografia' order by name limit 1), true);
insert into public.profile_skills (profile_id, skill_id)
select p, current_setting('t.a')::uuid from unnest(array[
  '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3',
  '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5']::uuid[]) as p;
insert into public.profile_skills (profile_id, skill_id)
select p, current_setting('t.b')::uuid from unnest(array[
  '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4',
  '00000000-0000-0000-0000-0000000000f5']::uuid[]) as p;

set local role anon;
select throws_ok(
  $$ select * from public.search_people_by_skill(array[current_setting('t.a')::uuid]) $$,
  '42501', null, 'sem login, a busca não roda'
);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is_empty(
  $$ select * from public.search_people_by_skill('{}'::uuid[]) $$,
  'lista vazia de habilidades → nada'
);
select set_eq(
  $$ select profile_id from public.search_people_by_skill(array[current_setting('t.a')::uuid]) $$,
  $$ values ('00000000-0000-0000-0000-0000000000f2'::uuid), ('00000000-0000-0000-0000-0000000000f3') $$,
  'monitor acha só quem está ativo na própria equipe (a suspensa e a da outra equipe ficam fora)'
);
select set_eq(
  $$ select profile_id from public.search_people_by_skill(array[current_setting('t.a')::uuid, current_setting('t.b')::uuid]) $$,
  $$ values ('00000000-0000-0000-0000-0000000000f2'::uuid) $$,
  'com duas habilidades, só quem tem as duas'
);
select is(
  (select skill_names[1] from public.search_people_by_skill(array[current_setting('t.a')::uuid])
   where profile_id = '00000000-0000-0000-0000-0000000000f3'),
  'Fotografia',
  'o resultado traz o nome da habilidade, nunca contato'
);
select is_empty(
  $$ select * from public.search_people_by_skill(array[current_setting('t.a')::uuid], 9999999) $$,
  'filtro por município que ninguém tem → nada'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000f5');
select set_eq(
  $$ select profile_id from public.search_people_by_skill(array[current_setting('t.a')::uuid]) $$,
  $$ values ('00000000-0000-0000-0000-0000000000f5'::uuid) $$,
  'sem papel, a pessoa só acha a si mesma (fora do escopo → negado)'
);

select * from finish();
rollback;
